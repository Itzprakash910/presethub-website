'use strict';
/**
 * Optional on-demand thumbnails for PUBLIC preview images stored in GridFS (/media/:id?w=480).
 * Lighthouse reported multi-MB preview images displayed at ~500px. `sharp` is an optional dependency:
 * when it is missing (or anything fails) callers simply stream the original image, so nothing breaks.
 */
let sharp = null;
try { sharp = require('sharp'); sharp.cache(false); sharp.concurrency(1); } catch (_) { /* optional */ }

const WIDTHS = new Set([320, 480, 640, 800, 1200]);
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const MAX_CACHE_BYTES = 40 * 1024 * 1024;
const cache = new Map(); // key -> Buffer (insertion order = age)
let cacheBytes = 0;
let running = 0;
const waiting = [];

function acquire() {
  if (running < 2) { running++; return Promise.resolve(); }
  return new Promise(r => waiting.push(r)).then(() => { running++; });
}
function release() { running--; const next = waiting.shift(); if (next) next(); }

function remember(key, buf) {
  if (buf.length > MAX_CACHE_BYTES / 4) return;
  cache.set(key, buf); cacheBytes += buf.length;
  while (cacheBytes > MAX_CACHE_BYTES && cache.size) {
    const [k, v] = cache.entries().next().value;
    cache.delete(k); cacheBytes -= v.length;
  }
}

function canResize(width, contentType, length) {
  return !!sharp && WIDTHS.has(Number(width)) && /^image\/(jpeg|png|webp)$/.test(String(contentType || '')) &&
    Number(length) > 0 && Number(length) <= MAX_SOURCE_BYTES;
}

async function readAll(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

/** Returns a WebP Buffer no wider than `width` (never enlarges). */
async function resizedWebp(key, width, openStream) {
  const hit = cache.get(key);
  if (hit) return hit;
  await acquire();
  try {
    const again = cache.get(key);
    if (again) return again;
    const source = await readAll(openStream());
    const out = await sharp(source, { failOn: 'none' }).rotate().resize({ width: Number(width), withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    remember(key, out);
    return out;
  } finally { release(); }
}

module.exports = { canResize, resizedWebp, hasSharp: !!sharp };
