/**
 * PresetHub admin alert system.
 * Every alert is (1) stored in MongoDB (AlertLog), (2) pushed into admin in-app notifications,
 * (3) sent to the admin on Telegram (BOT_TOKEN + ADMIN_CHAT_ID) and (4) e-mailed to the admin
 * (RESEND_API_KEY + ADMIN_ALERT_EMAIL / ADMIN_EMAIL). Repeated identical alerts are throttled.
 */
const mongoose = require('mongoose');
const crypto = require('crypto');

const SITE_URL = () => (process.env.CLIENT_URL || 'https://presethub.site').replace(/\/+$/, '');
const THROTTLE_MS = Number(process.env.ALERT_THROTTLE_MS || 10 * 60 * 1000);
const recent = new Map(); // fingerprint -> last external-send timestamp

const ICON = { info: 'ℹ️', warning: '⚠️', critical: '🚨' };
const TYPE_LABEL = {
  new_user: '👤 New user', security: '🛡️ Security', error: '🐞 Error', database: '🗄️ Database',
  payment: '💳 Payment', subscription: '👑 Subscription', system: '⚙️ System', viral: '🔥 Viral'
};

function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function clip(v, n = 300) { const s = typeof v === 'string' ? v : JSON.stringify(v); return String(s ?? '').slice(0, n); }

// Never leak secrets/passwords/tokens into alert text.
function scrub(details) {
  const out = {};
  for (const [k, v] of Object.entries(details || {})) {
    if (/pass|secret|token|authorization|cookie|key/i.test(k)) continue;
    out[k] = typeof v === 'object' && v !== null ? clip(v, 500) : (typeof v === 'string' ? v.slice(0, 500) : v);
  }
  return out;
}

function detailsText(details) {
  return Object.entries(details || {}).map(([k, v]) => `${k}: ${clip(v, 300)}`).join('\n');
}

async function sendTelegram(text) {
  const token = process.env.BOT_TOKEN, chat = process.env.ADMIN_CHAT_ID;
  if (!token || !chat) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: text.slice(0, 3900), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000)
    });
    return r.ok;
  } catch (_) { return false; }
}

async function sendEmail(subject, html) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ADMIN_ALERT_EMAIL || process.env.ADMIN_EMAIL;
  if (!key || !to) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM || 'PresetHub Alerts <alerts@presethub.site>', to: [to], subject, html }),
      signal: AbortSignal.timeout(10000)
    });
    return r.ok;
  } catch (_) { return false; }
}

async function notifyAdminsInApp(type, title, message) {
  try {
    const { User } = require('../models');
    const { createNotification } = require('./notifications');
    const admins = await User.find({ role: 'admin' }).select('_id').limit(10).lean();
    for (const a of admins) await createNotification(a._id, `admin-${type}`, `${title}: ${message}`.slice(0, 480), '/admin', `PresetHub Admin · ${title}`);
  } catch (_) {}
}

/**
 * adminAlert({ type, severity, title, details, fingerprint, throttleMs, email })
 * Never throws; safe to call from error paths.
 */
async function adminAlert({ type = 'system', severity = 'info', title, details = {}, fingerprint, throttleMs, email = true }) {
  try {
    const { AlertLog } = require('../models');
    const clean = scrub(details);
    const fp = fingerprint || crypto.createHash('sha1').update(`${type}|${title}`).digest('hex').slice(0, 20);
    const now = Date.now();
    const windowMs = throttleMs ?? THROTTLE_MS;

    if (mongoose.connection.readyState === 1) {
      const existing = await AlertLog.findOneAndUpdate(
        { fingerprint: fp, lastAt: { $gte: new Date(now - windowMs) } },
        { $inc: { count: 1 }, $set: { lastAt: new Date(), details: clean, read: false } }
      ).catch(() => null);
      if (existing) return { throttled: true };
      await AlertLog.create({ type, severity, title: String(title).slice(0, 200), details: clean, fingerprint: fp, lastAt: new Date() }).catch(() => {});
    } else if (recent.get(fp) && now - recent.get(fp) < windowMs) {
      return { throttled: true };
    }
    recent.set(fp, now);
    if (recent.size > 500) for (const [k, t] of recent) if (now - t > windowMs) recent.delete(k);

    const label = TYPE_LABEL[type] || type;
    const body = detailsText(clean);
    const text = `${ICON[severity] || ''} PresetHub · ${label}\n${title}\n\n${body}\n\n🕒 ${new Date().toISOString()}\n🔗 ${SITE_URL()}/admin`;
    sendTelegram(text);
    if (email && severity !== 'info') {
      sendEmail(`[PresetHub ${severity.toUpperCase()}] ${title}`,
        `<div style="font-family:system-ui,Arial;max-width:560px"><h2 style="margin:0 0 8px">${ICON[severity] || ''} ${esc(title)}</h2><p style="color:#666;margin:0 0 12px">${esc(label)} · ${esc(new Date().toUTCString())}</p><pre style="background:#f6f6f6;padding:12px;border-radius:8px;white-space:pre-wrap">${esc(body)}</pre><p><a href="${esc(SITE_URL())}/admin">Open admin panel</a></p></div>`);
    } else if (email && type === 'new_user') {
      sendEmail(`New PresetHub user: ${clean.name || clean.email || ''}`,
        `<div style="font-family:system-ui,Arial;max-width:560px"><h2 style="margin:0 0 8px">👤 New user joined PresetHub</h2><pre style="background:#f6f6f6;padding:12px;border-radius:8px;white-space:pre-wrap">${esc(body)}</pre><p><a href="${esc(SITE_URL())}/admin">Open admin panel</a></p></div>`);
    }
    if (severity !== 'info' || type === 'new_user') notifyAdminsInApp(type, title, body.replace(/\n/g, ' · '));
    return { sent: true };
  } catch (e) {
    console.warn('adminAlert failed:', e.message);
    return { error: true };
  }
}

function requestInfo(req) {
  if (!req) return {};
  return {
    ip: req.ip, method: req.method, path: String(req.originalUrl || '').split('?')[0].slice(0, 200),
    userAgent: String(req.headers?.['user-agent'] || '').slice(0, 160), userId: req.user?.id || ''
  };
}

// ------------------------------------------------------------
// Security helpers
// ------------------------------------------------------------
const failedLogins = new Map(); // key -> { n, first }
function recordFailedLogin(req, email) {
  const key = `${req.ip}|${String(email || '').toLowerCase()}`;
  const ipKey = `ip|${req.ip}`;
  const now = Date.now();
  for (const k of [key, ipKey]) {
    const cur = failedLogins.get(k);
    if (!cur || now - cur.first > 10 * 60 * 1000) failedLogins.set(k, { n: 1, first: now });
    else cur.n++;
  }
  if (failedLogins.size > 2000) for (const [k, v] of failedLogins) if (now - v.first > 10 * 60 * 1000) failedLogins.delete(k);
  const a = failedLogins.get(key), b = failedLogins.get(ipKey);
  if (a.n === 5 || b.n === 10) {
    adminAlert({
      type: 'security', severity: a.n >= 5 ? 'critical' : 'warning',
      title: 'Possible brute-force login attempt',
      fingerprint: `bf-${req.ip}`,
      details: { ...requestInfo(req), targetEmail: String(email || '').slice(0, 120), failedAttemptsForAccount: a.n, failedAttemptsFromIp: b.n, window: '10 minutes' }
    });
  }
}
function clearFailedLogins(req, email) { failedLogins.delete(`${req.ip}|${String(email || '').toLowerCase()}`); }

function securityAlert(req, title, extra = {}, severity = 'warning', throttleMs) {
  return adminAlert({ type: 'security', severity, title, throttleMs, fingerprint: `sec-${title}-${req?.ip || ''}`, details: { ...requestInfo(req), ...extra } });
}

// Blocks NoSQL operator injection ({"$ne":..}), prototype pollution and absurd payloads.
function hasDangerousKey(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  for (const k of Object.keys(obj)) {
    if (k.startsWith('$') || k === '__proto__' || k === 'constructor' || k.includes('.$')) return k;
    const inner = hasDangerousKey(obj[k], depth + 1);
    if (inner) return inner;
  }
  return null;
}
function securityGuard(req, res, next) {
  const bad = hasDangerousKey(req.body) || hasDangerousKey(req.query) || hasDangerousKey(req.params);
  if (bad) {
    securityAlert(req, 'Blocked injection attempt (NoSQL/prototype keys)', { offendingKey: bad }, 'critical', 5 * 60 * 1000);
    return res.status(400).json({ error: 'Invalid request.' });
  }
  const url = decodeURIComponent(String(req.originalUrl || '').slice(0, 2000)).toLowerCase();
  if (/(\.\.\/|\.\.\\|<script|union\s+select|\/etc\/passwd|\.env\b|wp-admin|phpmyadmin)/.test(url)) {
    securityAlert(req, 'Suspicious URL probe blocked', { url: url.slice(0, 200) }, 'warning', 5 * 60 * 1000);
    return res.status(404).end();
  }
  next();
}

// ------------------------------------------------------------
// Database usage monitor
// ------------------------------------------------------------
let lastDbLevel = 0;
async function getDbUsage() {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return null;
  const db = mongoose.connection.db;
  const stats = await db.stats();
  const limitMb = Number(process.env.DB_LIMIT_MB || 512);
  const usedBytes = Number(stats.storageSize || 0) + Number(stats.indexSize || 0);
  let gridfsBytes = 0, gridfsFiles = 0;
  try {
    const agg = await db.collection('presethub_media.files').aggregate([{ $group: { _id: null, bytes: { $sum: '$length' }, n: { $sum: 1 } } }]).toArray();
    gridfsBytes = agg[0]?.bytes || 0; gridfsFiles = agg[0]?.n || 0;
  } catch (_) {}
  const limitBytes = limitMb * 1024 * 1024;
  return {
    database: db.databaseName, collections: stats.collections, objects: stats.objects,
    dataMB: +(Number(stats.dataSize || 0) / 1048576).toFixed(2),
    storageMB: +(Number(stats.storageSize || 0) / 1048576).toFixed(2),
    indexMB: +(Number(stats.indexSize || 0) / 1048576).toFixed(2),
    usedMB: +(usedBytes / 1048576).toFixed(2), limitMB: limitMb,
    freeMB: +Math.max(0, (limitBytes - usedBytes) / 1048576).toFixed(2),
    usedPercent: +Math.min(100, (usedBytes / limitBytes) * 100).toFixed(1),
    mediaFiles: gridfsFiles, mediaMB: +(gridfsBytes / 1048576).toFixed(2)
  };
}
async function checkDatabaseUsage() {
  try {
    const u = await getDbUsage();
    if (!u) return null;
    const level = u.usedPercent >= 95 ? 95 : u.usedPercent >= 85 ? 85 : u.usedPercent >= 70 ? 70 : 0;
    if (level > lastDbLevel) {
      await adminAlert({
        type: 'database', severity: level >= 85 ? 'critical' : 'warning',
        title: `Database ${u.usedPercent}% full (${u.usedMB} MB of ${u.limitMB} MB)`,
        fingerprint: `db-${level}`, throttleMs: 6 * 60 * 60 * 1000,
        details: { used: `${u.usedMB} MB`, free: `${u.freeMB} MB`, limit: `${u.limitMB} MB`, mediaFiles: u.mediaFiles, mediaSize: `${u.mediaMB} MB`, objects: u.objects, advice: 'Delete unused uploads/old backups or upgrade the MongoDB plan.' }
      });
    }
    lastDbLevel = level;
    return u;
  } catch (e) { console.warn('DB usage check failed:', e.message); return null; }
}
let dbTimer = null;
function startMonitors() {
  if (dbTimer) return;
  setTimeout(checkDatabaseUsage, 20000);
  dbTimer = setInterval(checkDatabaseUsage, 30 * 60 * 1000);
  dbTimer.unref?.();
  mongoose.connection.on('disconnected', () => adminAlert({ type: 'database', severity: 'critical', title: 'MongoDB disconnected', fingerprint: 'mongo-down', throttleMs: 15 * 60 * 1000, details: { note: 'Mongoose will retry automatically.' } }));
  mongoose.connection.on('reconnected', () => adminAlert({ type: 'database', severity: 'info', title: 'MongoDB reconnected', fingerprint: 'mongo-up', throttleMs: 15 * 60 * 1000 }));
}

// ------------------------------------------------------------
// Error helpers
// ------------------------------------------------------------
function errorAlert(err, req, extra = {}) {
  if (req?.res?.locals) req.res.locals.alerted = true;
  const stack = String(err?.stack || '').split('\n').slice(0, 4).join(' | ').slice(0, 500);
  const msg = String(err?.message || err || 'Unknown error').slice(0, 300);
  return adminAlert({
    type: 'error', severity: 'critical', title: `Server error: ${msg.slice(0, 120)}`,
    fingerprint: `err-${crypto.createHash('sha1').update(msg + (req?.originalUrl || '').split('?')[0]).digest('hex').slice(0, 16)}`,
    details: { message: msg, ...requestInfo(req), stack, ...extra }
  });
}
function installProcessHandlers() {
  process.on('unhandledRejection', reason => { console.error('unhandledRejection', reason); errorAlert(reason instanceof Error ? reason : new Error(String(reason)), null, { source: 'unhandledRejection' }); });
  process.on('uncaughtException', err => { console.error('uncaughtException', err); errorAlert(err, null, { source: 'uncaughtException' }); });
}

// Catches every 5xx (including ones routes handle themselves with try/catch).
function status5xxWatcher(req, res, next) {
  res.on('finish', () => {
    // Google crawlers getting 403/429 hurts indexing: report it to the admin so it can be traced.
    if ((res.statusCode === 403 || res.statusCode === 429) && /Google/i.test(String(req.headers['user-agent'] || ''))) {
      adminAlert({
        type: 'system', severity: 'warning', title: `Google crawler got HTTP ${res.statusCode} on ${String(req.originalUrl).split('?')[0].slice(0, 100)}`,
        fingerprint: `gbot-${res.statusCode}-${String(req.originalUrl).split('?')[0].slice(0, 80)}`, throttleMs: 60 * 60 * 1000, email: false,
        details: { ...requestInfo(req), status: res.statusCode, note: 'If this comes from the Render/CDN edge, it never reached the app. Check Render logs and any Cloudflare/WAF rules.' }
      });
    }
    if (res.statusCode >= 500 && !res.locals.alerted && !String(req.originalUrl).startsWith('/healthz')) {
      adminAlert({
        type: 'error', severity: res.statusCode === 503 ? 'warning' : 'critical',
        title: `HTTP ${res.statusCode} on ${req.method} ${String(req.originalUrl).split('?')[0].slice(0, 100)}`,
        fingerprint: `http-${res.statusCode}-${req.method}-${String(req.originalUrl).split('?')[0]}`,
        details: { ...requestInfo(req), status: res.statusCode, note: 'Check server logs for the stack trace.' }
      });
    }
  });
  next();
}

// Posts to the public Telegram channel (TELEGRAM_CHANNEL_ID, e.g. @presethub or -100…). Never throws.
async function postToChannel(text, link) {
  const token = process.env.BOT_TOKEN, chat = process.env.TELEGRAM_CHANNEL_ID;
  if (!token || !chat) return false;
  try {
    const body = { chat_id: chat, text: String(text).slice(0, 3900), disable_web_page_preview: false };
    if (link) body.reply_markup = { inline_keyboard: [[{ text: '👉 Open on PresetHub', url: link }]] };
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000)
    });
    return r.ok;
  } catch (_) { return false; }
}

module.exports = { postToChannel, status5xxWatcher, adminAlert, requestInfo, recordFailedLogin, clearFailedLogins, securityAlert, securityGuard, getDbUsage, checkDatabaseUsage, startMonitors, errorAlert, installProcessHandlers, sendTelegram };
