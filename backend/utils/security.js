/**
 * Central security helpers:
 *  - per-account login lockout (after repeated wrong passwords)
 *  - strict rate limiters for uploads, signup, password reset, bulk actions
 *  - scanner / bot user-agent blocking
 *  - zip-bomb and zip-slip inspection for preset ZIP uploads
 */
const rateLimit = require('express-rate-limit');
const { securityAlert } = require('./alerts');

// ---------- login lockout ----------
const LOCK_AFTER = Number(process.env.LOGIN_LOCK_AFTER || 8);     // wrong passwords
const LOCK_WINDOW_MS = 15 * 60 * 1000;                              // counting window
const LOCK_FOR_MS = 20 * 60 * 1000;                                 // lock duration
const lockState = new Map(); // email -> { n, first, lockedUntil }

function lockKey(email) { return String(email || '').toLowerCase().trim(); }
function isLockedOut(email) {
  const s = lockState.get(lockKey(email));
  if (!s) return 0;
  if (s.lockedUntil && s.lockedUntil > Date.now()) return Math.ceil((s.lockedUntil - Date.now()) / 60000);
  if (s.lockedUntil && s.lockedUntil <= Date.now()) lockState.delete(lockKey(email));
  return 0;
}
function noteLoginFailure(email, req) {
  const k = lockKey(email); if (!k) return;
  const now = Date.now();
  let s = lockState.get(k);
  if (!s || now - s.first > LOCK_WINDOW_MS) s = { n: 0, first: now, lockedUntil: 0 };
  s.n++;
  if (s.n >= LOCK_AFTER) {
    s.lockedUntil = now + LOCK_FOR_MS;
    securityAlert(req, 'Account temporarily locked after repeated wrong passwords', { email: k, failures: s.n, lockMinutes: LOCK_FOR_MS / 60000 }, 'critical', 10 * 60 * 1000);
  }
  lockState.set(k, s);
  if (lockState.size > 5000) for (const [key, v] of lockState) if (now - v.first > LOCK_WINDOW_MS && (!v.lockedUntil || v.lockedUntil < now)) lockState.delete(key);
}
function clearLoginFailures(email) { lockState.delete(lockKey(email)); }

// ---------- rate limiters ----------
const json429 = (msg) => (req, res, next, options) => res.status(429).json({ error: msg, retryAfterSeconds: Math.ceil(options.windowMs / 1000) });
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: Number(process.env.UPLOAD_PER_HOUR || 30),
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `u:${req.user.id}` : `ip:${req.ip}`),
  handler: (req, res, next, o) => { securityAlert(req, 'Upload rate limit hit (possible spam / abuse)', { limit: o.max, window: '1 hour' }, 'warning', 30 * 60 * 1000); json429('Too many uploads. Please try again later.')(req, res, next, o); }
});
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: Number(process.env.SIGNUP_PER_HOUR || 10),
  standardHeaders: true, legacyHeaders: false,
  handler: (req, res, next, o) => { securityAlert(req, 'Signup rate limit hit (possible bot account creation)', { limit: o.max, window: '1 hour' }, 'critical', 30 * 60 * 1000); json429('Too many accounts created from this network. Try again later.')(req, res, next, o); }
});
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 6,
  standardHeaders: true, legacyHeaders: false,
  handler: (req, res, next, o) => { securityAlert(req, 'Password-reset flood blocked', { limit: o.max, window: '1 hour' }, 'warning', 30 * 60 * 1000); json429('Too many reset requests. Try again later.')(req, res, next, o); }
});
const bulkLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `u:${req.user.id}` : `ip:${req.ip}`),
  handler: json429('Too many bulk requests. Please slow down.')
});
const textPostLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 40,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `u:${req.user.id}` : `ip:${req.ip}`),
  handler: json429('Posting limit reached. Please try again later.')
});

// ---------- bot / scanner blocking ----------
const BAD_UA = /(sqlmap|nikto|nmap|masscan|acunetix|netsparker|nessus|openvas|wpscan|dirbuster|gobuster|havij|zgrab|python-requests\/2\.[0-9]+ .*scan)/i;
const GOOGLE_CRAWLER = /(Googlebot|Google-InspectionTool|AdsBot-Google|APIs-Google|Storebot-Google|Google-Extended)/i;
const PROBE_PATH = /(\.\.(\/|%2f|%5c)|\/\.(env|git|svn|hg|ds_store|aws|docker)|wp-(admin|login|content|includes)|phpmyadmin|\/cgi-bin\/|\.php(\?|$)|\/etc\/(passwd|shadow)|\/proc\/self|web\.config|\.bak$|\.sql$|\.old$)/i;
function botGuard(req, res, next) {
  const ua = String(req.headers['user-agent'] || '');
  let path = String(req.originalUrl || '').slice(0, 1000);
  try { path = decodeURIComponent(path); } catch (_) { /* malformed encoding is itself suspicious */ return res.status(400).type('text').send('Bad request'); }
  // Google's own crawlers are never blocked by the user-agent rule (their pages must stay reachable for indexing).
  const isGoogleCrawler = GOOGLE_CRAWLER.test(ua);
  if ((!isGoogleCrawler && BAD_UA.test(ua)) || PROBE_PATH.test(path)) {
    securityAlert(req, 'Scanner / exploit probe blocked', { userAgent: ua.slice(0, 160), path: path.slice(0, 200) }, 'warning', 10 * 60 * 1000);
    return res.status(403).type('text').send('Forbidden');
  }
  next();
}

// ---------- ZIP inspection (zip bomb + zip slip) ----------
const MAX_ENTRIES = 300;
const MAX_UNCOMPRESSED = 400 * 1024 * 1024;
const MAX_RATIO = 60;
function zipSafety(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('Invalid ZIP preset file');
  // find End Of Central Directory record (search last 64 KB)
  const minPos = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minPos; i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('Invalid ZIP preset file');
  const entries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdOffset === 0xffffffff) throw new Error('ZIP64 archives are not allowed');
  if (entries > MAX_ENTRIES) throw new Error(`ZIP contains too many files (max ${MAX_ENTRIES})`);
  if (cdOffset + cdSize > buf.length) throw new Error('Invalid ZIP preset file');
  let p = cdOffset, total = 0, compressed = 0, count = 0;
  while (p + 46 <= cdOffset + cdSize && count < entries) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Invalid ZIP preset file');
    const comp = buf.readUInt32LE(p + 20);
    const uncomp = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen).replace(/\\/g, '/');
    if (name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.split('/').includes('..') || name.includes('\0'))
      throw new Error('ZIP contains unsafe file paths');
    total += uncomp; compressed += comp; count++;
    if (total > MAX_UNCOMPRESSED) throw new Error('ZIP expands to an unsafe size');
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (compressed > 0 && total / compressed > MAX_RATIO && total > 5 * 1024 * 1024) throw new Error('ZIP compression ratio is not allowed');
  return { entries: count, uncompressedBytes: total };
}

module.exports = {
  isLockedOut, noteLoginFailure, clearLoginFailures,
  uploadLimiter, signupLimiter, resetLimiter, bulkLimiter, textPostLimiter,
  botGuard, zipSafety
};
