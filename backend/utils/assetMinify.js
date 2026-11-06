'use strict';
/**
 * On-the-fly minification + compression for the frontend's own .js / .css files.
 *
 * Why: PageSpeed reported "Minify JavaScript/CSS" and "Reduce unused CSS/JS" and the origin sent
 * un-minified, un-compressed files. The sources in /frontend stay readable (and the self-tests that
 * read them keep working); the minified bytes are produced once per file version, kept in memory and
 * served with gzip/brotli and a long cache lifetime for versioned URLs (?v=...).
 *
 * `esbuild` is an optional dependency. If it is not installed the middleware still serves the original
 * file (compressed), so deployment can never break because of it.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

let esbuild = null;
try { esbuild = require('esbuild'); } catch (_) { /* optional */ }

// Never touch these: the service worker must stay byte-exact and always revalidate.
const SKIP = new Set(['sw.js']);
const cache = new Map(); // abs path -> { mtimeMs, size, raw, gzip, br, etag, type }
const MAX_FILE = 2 * 1024 * 1024;

function build(file, ext) {
  const src = fs.readFileSync(file, 'utf8');
  let out = src;
  if (esbuild) {
    try {
      out = esbuild.transformSync(src, { loader: ext === '.css' ? 'css' : 'js', minify: true, legalComments: 'none', charset: 'utf8', target: ext === '.css' ? 'chrome90' : 'es2019' }).code;
    } catch (e) {
      console.warn('assetMinify: could not minify', path.basename(file), '-', e.message.split('\n')[0]);
      out = src;
    }
  }
  const raw = Buffer.from(out, 'utf8');
  return {
    raw,
    gzip: zlib.gzipSync(raw, { level: 9 }),
    br: zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }),
    etag: 'W/"' + require('crypto').createHash('sha1').update(raw).digest('base64').slice(0, 22) + '"',
    type: ext === '.css' ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8'
  };
}

function assetMinify(frontendRoot) {
  const root = path.resolve(frontendRoot);
  return function assetMinifyMiddleware(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const ext = path.extname(req.path).toLowerCase();
    if (ext !== '.js' && ext !== '.css') return next();
    let rel;
    try { rel = decodeURIComponent(req.path).replace(/^\/+/, ''); } catch (_) { return next(); }
    if (SKIP.has(rel) || rel.endsWith('.min.js') || rel.endsWith('.min.css')) return next();
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) return next();
    let st;
    try { st = fs.statSync(file); } catch (_) { return next(); }
    if (!st.isFile() || st.size > MAX_FILE) return next();
    try {
      let entry = cache.get(file);
      if (!entry || entry.mtimeMs !== st.mtimeMs || entry.size !== st.size) {
        entry = { mtimeMs: st.mtimeMs, size: st.size, ...build(file, ext) };
        cache.set(file, entry);
      }
      // ?v=<version> URLs are immutable (the version changes with every release); unversioned ones revalidate.
      res.setHeader('Cache-Control', req.query && req.query.v ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate');
      res.setHeader('ETag', entry.etag);
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.headers['if-none-match'] === entry.etag) return res.status(304).end();
      const accept = String(req.headers['accept-encoding'] || '');
      let body = entry.raw;
      if (/\bbr\b/.test(accept)) { body = entry.br; res.setHeader('Content-Encoding', 'br'); }
      else if (/\bgzip\b/.test(accept)) { body = entry.gzip; res.setHeader('Content-Encoding', 'gzip'); }
      res.setHeader('Content-Type', entry.type);
      res.setHeader('Content-Length', body.length);
      return res.end(req.method === 'HEAD' ? undefined : body);
    } catch (e) {
      return next(); // fall back to express.static
    }
  };
}

module.exports = { assetMinify, hasEsbuild: !!esbuild };
