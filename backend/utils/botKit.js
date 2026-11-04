'use strict';
/**
 * Pure helpers for the Telegram bot. Nothing here talks to Telegram, the database or the network,
 * so everything can be unit-tested (see backend/scripts/bot-selftest.js).
 */
const crypto = require('crypto');

// ---------- text safety ----------
// Telegram HTML mode: only & < > must be escaped in text. Attributes also need quotes escaped.
const h = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ha = v => h(v).replace(/"/g, '&quot;');
// Removes control characters and bidi-override characters (used to spoof text), then trims and caps length.
function clean(v, max = 500) {
  return String(v ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .trim()
    .slice(0, max);
}
const cut = (v, n) => { const s = String(v ?? ''); return s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s; };
const stripTags = s => String(s ?? '').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

const ID_RE = /^[a-f0-9]{24}$/i;
const isObjectId = v => ID_RE.test(String(v || ''));

// Telegram only accepts public https URLs for url buttons (no localhost, no plain http).
function isButtonUrl(u) {
  try {
    const x = new URL(String(u));
    return x.protocol === 'https:' && x.hostname.includes('.') && !/^(localhost|127\.|10\.|192\.168\.|0\.0\.0\.0)/i.test(x.hostname);
  } catch (_) { return false; }
}

function slugify(v) {
  return String(v || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'preset';
}
function safeFilename(name, fallback = 'preset.xmp') {
  const s = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001F]+/g, '_').replace(/^\.+/, '').trim().slice(0, 100);
  return s || fallback;
}

// ---------- command parsing ----------
// "/Search@PresetHubBot sunset beach" -> { cmd:'search', bot:'PresetHubBot', argText:'sunset beach', args:['sunset','beach'] }
function parseCommand(text) {
  const m = /^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]{3,64}))?(?:[ \t\r\n]+([\s\S]*))?$/.exec(String(text || '').trim());
  if (!m) return null;
  const argText = clean(m[3] || '', 2100);
  return { cmd: m[1].toLowerCase(), bot: m[2] || '', argText, args: argText ? argText.split(/\s+/).filter(Boolean) : [] };
}

// ---------- fuzzy matching for mistyped commands ----------
function levenshtein(a, b) {
  a = String(a); b = String(b);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
function suggest(input, names, limit = 3) {
  const q = String(input || '').toLowerCase();
  if (!q) return [];
  const scored = [];
  for (const n of new Set(names)) {
    const d = levenshtein(q, n);
    const prefix = n.startsWith(q) || q.startsWith(n);
    const max = Math.max(2, Math.floor(Math.max(q.length, n.length) / 3));
    if (prefix || d <= max) scored.push({ n, score: prefix ? d - 1 : d });
  }
  return scored.sort((a, b) => a.score - b.score || a.n.length - b.n.length).slice(0, limit).map(x => x.n);
}

// ---------- rate limiting ----------
class RateLimiter {
  constructor(maxKeys = 5000) { this.m = new Map(); this.maxKeys = maxKeys; }
  // Counts one hit. firstBlock is true only on the first blocked hit of a window (so we warn the user once, not on every tap).
  hit(key, limit, windowMs, now = Date.now()) {
    let e = this.m.get(key);
    if (!e || now - e.start >= windowMs) { e = { n: 0, start: now, warned: false, windowMs }; this.m.set(key, e); }
    e.n++;
    if (this.m.size > this.maxKeys) this.prune(now);
    const ok = e.n <= limit;
    const firstBlock = !ok && !e.warned;
    if (!ok) e.warned = true;
    return { ok, firstBlock, count: e.n, retryAfterMs: ok ? 0 : Math.max(0, e.start + windowMs - now) };
  }
  prune(now = Date.now()) {
    for (const [k, e] of this.m) if (now - e.start >= e.windowMs) this.m.delete(k);
    if (this.m.size > this.maxKeys) this.m.clear();
  }
}

// ---------- small in-memory store with expiry (conversation state, list context) ----------
class TtlStore {
  constructor(ttlMs = 20 * 60 * 1000, maxKeys = 5000) { this.ttl = ttlMs; this.maxKeys = maxKeys; this.m = new Map(); }
  set(key, value, ttlMs = this.ttl) {
    this.m.set(String(key), { v: value, exp: Date.now() + ttlMs });
    if (this.m.size > this.maxKeys) this.prune();
    return value;
  }
  get(key) {
    const e = this.m.get(String(key));
    if (!e) return undefined;
    if (e.exp < Date.now()) { this.m.delete(String(key)); return undefined; }
    return e.v;
  }
  touch(key, ttlMs = this.ttl) { const e = this.m.get(String(key)); if (e) e.exp = Date.now() + ttlMs; }
  delete(key) { return this.m.delete(String(key)); }
  has(key) { return this.get(key) !== undefined; }
  prune() { const now = Date.now(); for (const [k, e] of this.m) if (e.exp < now) this.m.delete(k); if (this.m.size > this.maxKeys) this.m.clear(); }
  get size() { return this.m.size; }
}

// ---------- errors ----------
class BotError extends Error {
  constructor(code, message = '', extra = {}) { super(message || code); this.name = 'BotError'; this.code = code; this.extra = extra; }
}
const newRef = () => crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();

const MSG = {
  USAGE: '❓ Command सही से नहीं लिखा गया।',
  AUTH_REQUIRED: '🔐 यह feature इस्तेमाल करने के लिए पहले अपना account link करें।',
  AUTH_EXPIRED: '🔐 आपका account verify नहीं हो पाया। कृपया /login से दोबारा link करें।',
  ACCOUNT_BLOCKED: '🚫 आपका account अभी blocked है। Review के लिए /blockhelp भेजें।',
  FORBIDDEN: '🔒 आपको इस काम की अनुमति नहीं है।',
  ADMIN_ONLY: '⛔ यह section सिर्फ admin के लिए है।',
  ROLE_FORBIDDEN: '⛔ आपके admin role को यह action करने की अनुमति नहीं है।',
  NOT_FOUND: '😕 जो आप खोज रहे हैं वह नहीं मिला (हट गया हो सकता है)।',
  VALIDATION: '⚠️ दी गई जानकारी सही नहीं है।',
  CONFLICT: '⚠️ यह काम पहले ही हो चुका है या अभी possible नहीं है।',
  RATE_LIMITED: '⏳ बहुत तेज़ requests। थोड़ा रुककर फिर try करें।',
  UPSTREAM_DOWN: '🔌 PresetHub server अभी जवाब नहीं दे रहा। कुछ देर बाद फिर try करें।',
  UPSTREAM_ERROR: '⚠️ Server पर कुछ गड़बड़ हुई। हमें alert मिल गया है, कृपया थोड़ी देर बाद फिर try करें।',
  FILE_TOO_LARGE: '📦 File बहुत बड़ी है।',
  DB_ERROR: '⚠️ Data load नहीं हो सका। हमें alert मिल गया है, कृपया फिर try करें।',
  INTERNAL: '⚠️ कुछ गड़बड़ हुई। हमें alert मिल गया है, कृपया फिर try करें।'
};

/**
 * Turns any error (our own, axios, Telegram, Mongo, unknown) into a stable shape:
 *   { code, status, userMessage, detail, report, severity, ignore }
 * detail = a safe, short message from our own API (never raw stack, never URLs/tokens).
 */
function classifyError(err) {
  const out = (code, extra = {}) => ({ code, status: 0, userMessage: MSG[code] || MSG.INTERNAL, detail: '', report: false, severity: 'warning', ignore: false, ...extra });
  if (!err) return out('INTERNAL', { report: true });

  if (err instanceof BotError || err.name === 'BotError') {
    return out(err.code || 'INTERNAL', { detail: err.message && err.message !== err.code ? String(err.message).slice(0, 300) : '', report: ['INTERNAL', 'DB_ERROR', 'UPSTREAM_ERROR', 'UPSTREAM_DOWN'].includes(err.code) });
  }

  // Telegram API errors (Telegraf TelegramError): err.response = { ok:false, error_code, description }
  const tg = err.response && err.response.ok === false ? err.response : (err.name === 'TelegramError' ? err : null);
  if (tg) {
    const status = Number(tg.error_code || err.code || 0);
    const desc = String(tg.description || err.description || err.message || '');
    if (/message is not modified/i.test(desc)) return out('TELEGRAM_IGNORED', { status, ignore: true, userMessage: '' });
    if (/query is too old|query ID is invalid|message to edit not found|message can't be edited|message to delete not found/i.test(desc)) return out('TELEGRAM_IGNORED', { status, ignore: true, userMessage: '' });
    if (status === 403 || /bot was blocked|user is deactivated|chat not found|bot can't initiate/i.test(desc)) return out('TELEGRAM_BLOCKED', { status, ignore: true, userMessage: '' });
    if (/can't parse entities|unsupported start tag|can't find end tag/i.test(desc)) return out('TELEGRAM_FORMAT', { status, report: true, severity: 'warning', userMessage: MSG.INTERNAL });
    if (status === 429) return out('TELEGRAM_RATE', { status, userMessage: MSG.RATE_LIMITED, report: true, severity: 'warning' });
    if (/file is too big/i.test(desc)) return out('FILE_TOO_LARGE', { status, userMessage: '📦 Telegram bot सिर्फ 20 MB तक की file ले सकता है। बड़ी file website से upload करें।' });
    return out('TELEGRAM_ERROR', { status, userMessage: MSG.INTERNAL, report: true, detail: desc.slice(0, 200) });
  }

  // HTTP errors from our own API (axios)
  if (err.isAxiosError || err.response || /^(ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ERR_NETWORK|ECONNABORTED)/.test(String(err.code || ''))) {
    const res = err.response;
    if (!res) {
      if (/maxContentLength|maxBodyLength/i.test(String(err.message))) return out('FILE_TOO_LARGE');
      return out('UPSTREAM_DOWN', { report: true, severity: 'critical' });
    }
    const status = Number(res.status || 0);
    const data = res.data && typeof res.data === 'object' ? res.data : {};
    const apiMsg = typeof data.error === 'string' ? data.error.replace(/[<>]/g, '').slice(0, 200) : '';
    const apiCode = String(data.code || '');
    if (status === 401) return out('AUTH_EXPIRED', { status, detail: apiMsg });
    if (status === 403) {
      if (/ROLE_FORBIDDEN|REFUND_NEEDS_SUPER/.test(apiCode)) return out('ROLE_FORBIDDEN', { status, detail: apiMsg });
      if (/blocked|deactivated/i.test(apiMsg)) return out('ACCOUNT_BLOCKED', { status, detail: apiMsg });
      return out('FORBIDDEN', { status, detail: apiMsg });
    }
    if (status === 404) return out('NOT_FOUND', { status, detail: apiMsg });
    if (status === 409) return out('CONFLICT', { status, detail: apiMsg });
    if (status === 413) return out('FILE_TOO_LARGE', { status, detail: apiMsg });
    if (status === 429) return out('RATE_LIMITED', { status, detail: apiMsg });
    if (status >= 500) return out('UPSTREAM_ERROR', { status, report: true, severity: status === 503 ? 'warning' : 'critical', detail: '' });
    if (status >= 400) return out('VALIDATION', { status, detail: apiMsg });
    return out('UPSTREAM_ERROR', { status, report: true });
  }

  if (/^(Mongo|Mongoose)/.test(String(err.name)) || /ValidationError|CastError/.test(String(err.name))) {
    return out('DB_ERROR', { report: true, severity: 'critical' });
  }
  return out('INTERNAL', { report: true, severity: 'warning' });
}

// ---------- stats ----------
class BotStats {
  constructor() {
    this.startedAt = Date.now();
    this.updates = 0; this.commands = 0; this.callbacks = 0; this.errors = 0; this.rateLimited = 0; this.unknownCommands = 0;
    this.byCode = {};
    this.recent = []; // last errors
    this.day = this.today(); this.users = new Set();
  }
  today() { return new Date().toISOString().slice(0, 10); }
  seen(userId) {
    if (this.day !== this.today()) { this.day = this.today(); this.users = new Set(); }
    if (userId && this.users.size < 20000) this.users.add(String(userId));
  }
  recordError(code, where, ref, message) {
    this.errors++;
    this.byCode[code] = (this.byCode[code] || 0) + 1;
    this.recent.unshift({ at: Date.now(), code, where, ref, message: String(message || '').slice(0, 160) });
    if (this.recent.length > 50) this.recent.length = 50;
  }
  snapshot() {
    return {
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000), updates: this.updates, commands: this.commands,
      callbacks: this.callbacks, errors: this.errors, rateLimited: this.rateLimited, unknownCommands: this.unknownCommands,
      activeToday: this.users.size, byCode: { ...this.byCode }
    };
  }
}

// ---------- formatting ----------
const fmtMoney = v => (Number(v || 0) <= 0 ? 'Free' : `₹${Number(v).toFixed(Number(v) % 1 ? 2 : 0)}`);
const fmtRupees = v => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
function fmtDate(d) {
  if (!d) return '—';
  const x = new Date(d);
  if (isNaN(x)) return '—';
  return x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}
function fmtDateTime(d) {
  if (!d) return '—';
  const x = new Date(d);
  if (isNaN(x)) return '—';
  return x.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}
function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400), hr = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return [d ? `${d}d` : '', hr ? `${hr}h` : '', `${m}m`].filter(Boolean).join(' ');
}
const compact = n => { n = Number(n || 0); return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n); };
const rating = v => (Number(v) > 0 ? `⭐ ${Number(v).toFixed(1)}` : '⭐ New');

// Joins self-contained HTML lines into chunks below Telegram's 4096 limit (never splits inside a tag).
function chunkLines(lines, max = 3800, sep = '\n') {
  const out = []; let cur = '';
  for (const line of lines) {
    const piece = String(line);
    if (cur && (cur.length + sep.length + piece.length) > max) { out.push(cur); cur = piece; }
    else cur = cur ? cur + sep + piece : piece;
  }
  if (cur) out.push(cur);
  return out;
}

module.exports = {
  h, ha, clean, cut, stripTags, isObjectId, isButtonUrl, slugify, safeFilename, parseCommand,
  levenshtein, suggest, RateLimiter, TtlStore, BotError, newRef, classifyError, BotStats, MSG,
  fmtMoney, fmtRupees, fmtDate, fmtDateTime, fmtDuration, compact, rating, chunkLines
};
