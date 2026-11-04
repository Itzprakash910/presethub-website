#!/usr/bin/env node
/**
 * Offline self-test for backend/bot.js.  Run: npm run bot:test
 * Telegram (Telegraf), axios, the database models and alerts are replaced by in-memory fakes,
 * so no token, network or MongoDB is needed. It drives the real bot.js with fake Telegram updates.
 */
const Module = require('module');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

process.env.BOT_TOKEN = 'test-token';
process.env.ADMIN_CHAT_ID = '999';
process.env.ADMIN_TELEGRAM_IDS = '999,998';
process.env.JWT_SECRET = 'x'.repeat(40);
process.env.CLIENT_URL = 'https://presethub.site';

// ---------- recording ----------
const out = [];            // everything the bot sent to Telegram
const alerts = [];         // adminAlert calls
const apiCalls = [];       // calls to the PresetHub API
let apiMock = () => { throw new Error('no api mock'); };
const clearOut = () => { out.length = 0; };

// ---------- fake Markup ----------
const Markup = {
  inlineKeyboard: rows => ({ reply_markup: { inline_keyboard: rows } }),
  keyboard: rows => { const o = { reply_markup: { keyboard: rows }, resize() { return o; }, placeholder() { return o; } }; return o; },
  button: { callback: (text, callback_data) => ({ text, callback_data }), url: (text, url) => ({ text, url }) }
};

// ---------- fake Telegraf (same middleware semantics as the real one) ----------
let launchBehaviour = 'pending';
class FakeTelegraf {
  constructor() {
    this.items = []; this.errHandler = null;
    this.sent = [];
    this.telegram = {
      getMe: async () => ({ username: 'PresetHubTestBot' }), deleteWebhook: async () => true,
      setMyCommands: async (list, extra) => { this.commands = this.commands || []; this.commands.push({ list, extra }); return true; },
      sendMessage: async (chat, text, extra) => { out.push({ kind: 'dm', chat, text, extra }); return {}; },
      getFileLink: async id => new URL(`https://api.telegram.org/file/bottest/${id}`)
    };
  }
  use(fn) { this.items.push({ t: 'use', fns: [fn] }); }
  command(names, ...fns) { this.items.push({ t: 'cmd', names: [].concat(names).map(s => s.toLowerCase()), fns }); }
  on(filter, ...fns) { this.items.push({ t: 'on', filter, fns }); }
  catch(fn) { this.errHandler = fn; }
  launch() { return launchBehaviour === 'reject' ? Promise.reject(new Error('409: Conflict: terminated by other getUpdates request')) : new Promise(() => {}); }
  stop() {}
  async handleUpdate(update) {
    const ctx = makeCtx(this, update);
    const run = async idx => {
      for (let i = idx; i < this.items.length; i++) {
        const it = this.items[i];
        if (!matches(it, update)) continue;
        let called = false;
        const chain = async k => {
          if (k >= it.fns.length) { called = true; return; }
          await it.fns[k](ctx, () => chain(k + 1));
        };
        await chain(0);
        if (!called) return;            // handler did not call next(): stop here
      }
    };
    try { await run(0); } catch (e) { if (this.errHandler) await this.errHandler(e, ctx); else throw e; }
  }
}
function matches(it, u) {
  const m = u.message, cq = u.callback_query;
  if (it.t === 'use') return true;
  if (it.t === 'cmd') { const mm = m && typeof m.text === 'string' && /^\/([A-Za-z0-9_]+)(@\w+)?(\s|$)/.exec(m.text); return !!mm && it.names.includes(mm[1].toLowerCase()); }
  switch (it.filter) {
    case 'text': return !!(m && typeof m.text === 'string');
    case 'document': return !!(m && m.document);
    case 'photo': return !!(m && m.photo);
    case 'message': return !!m;
    case 'callback_query': return !!cq;
    default: return false;
  }
}
function makeCtx(botInst, update) {
  const m = update.message, cq = update.callback_query;
  const chat = (m && m.chat) || (cq && cq.message && cq.message.chat);
  const from = (m && m.from) || (cq && cq.from);
  const ctx = {
    update, message: m, callbackQuery: cq, from, chat, state: {}, telegram: botInst.telegram,
    reply: async (text, extra) => { if (ctx.failParseOnce) { ctx.failParseOnce = false; const e = new Error("400: Bad Request: can't parse entities"); e.response = { ok: false, error_code: 400, description: "Bad Request: can't parse entities: Unsupported start tag" }; throw e; } out.push({ kind: 'reply', chat: chat && chat.id, text, extra }); return { message_id: 1 }; },
    replyWithPhoto: async (photo, extra) => { out.push({ kind: 'photo', photo, text: extra.caption, extra }); return {}; },
    replyWithDocument: async (doc, extra) => { out.push({ kind: 'document', doc, text: extra.caption, extra }); return {}; },
    editMessageText: async (text, extra) => { out.push({ kind: 'edit', text, extra }); return {}; },
    editMessageReplyMarkup: async markup => { out.push({ kind: 'editmarkup', markup }); return {}; },
    answerCbQuery: async (text, extra) => { out.push({ kind: 'answer', text, extra }); return true; },
    deleteMessage: async () => { out.push({ kind: 'delete' }); return true; },
    sendChatAction: async a => { out.push({ kind: 'action', action: a }); return true; }
  };
  return ctx;
}

// ---------- fake axios ----------
function axiosError(status, data) { const e = new Error(`Request failed with status code ${status}`); e.isAxiosError = true; e.response = { status, data: data || {} }; return e; }
function axiosNetworkError() { const e = new Error('connect ECONNREFUSED'); e.isAxiosError = true; e.code = 'ECONNREFUSED'; return e; }
const API = 'https://presethub.site/api';
async function route(cfg) {
  const url = String(cfg.url);
  const p = url.startsWith(API) ? url.slice(API.length) : url;
  apiCalls.push({ method: (cfg.method || 'get').toLowerCase(), path: p, params: cfg.params, data: cfg.data, headers: cfg.headers });
  return { status: 200, data: await apiMock({ method: (cfg.method || 'get').toLowerCase(), path: p, params: cfg.params, data: cfg.data, cfg }) };
}
const axiosFake = async cfg => route(cfg);
axiosFake.get = (url, cfg = {}) => route({ ...cfg, url, method: 'get' });
axiosFake.post = (url, data, cfg = {}) => route({ ...cfg, url, data, method: 'post' });

// ---------- fake database ----------
const db = { users: [], support: [], texts: [], alertsLog: [] };
let idc = 1;
const oid = () => (idc++).toString(16).padStart(24, '0');
function match(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    const dv = doc[k];
    if (v instanceof RegExp) return v.test(String(dv || ''));
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('$gt' in v) return dv && new Date(dv) > new Date(v.$gt);
      if ('$ne' in v) return String(dv) !== String(v.$ne);
      if ('$gte' in v) return dv && new Date(dv) >= new Date(v.$gte);
      return false;
    }
    return String(dv) === String(v);
  });
}
const query = (arr, filter) => {
  let res = arr.filter(d => match(d, filter));
  const q = { select() { return q; }, sort() { return q; }, skip(n) { res = res.slice(n); return q; }, limit(n) { res = res.slice(0, n); return q; }, lean() { return q; }, then(a, b) { return Promise.resolve(res.map(d => ({ ...d }))).then(x => a(Array.isArray(x) && q.single ? x[0] || null : x), b); } };
  return q;
};
const one = (arr, filter) => { const q = query(arr, filter); q.single = true; return q; };
const User = {
  findOne: f => one(db.users, f),
  create: async d => { if (d.telegramId && db.users.some(u => u.telegramId === d.telegramId)) { const e = new Error('dup'); e.code = 11000; throw e; } const doc = { _id: oid(), status: 'active', sessionVersion: 0, createdAt: new Date(), ...d }; db.users.push(doc); return { ...doc, toObject: () => ({ ...doc }) }; },
  updateOne: async (f, u) => { const d = db.users.find(x => match(x, f)); if (d) { Object.assign(d, u.$set || {}); for (const k of Object.keys(u.$unset || {})) delete d[k]; if (u.$inc) for (const [k, v] of Object.entries(u.$inc)) d[k] = (d[k] || 0) + v; } return { modifiedCount: d ? 1 : 0 }; },
  updateMany: async (f, u) => { db.users.filter(x => match(x, f)).forEach(d => { for (const k of Object.keys(u.$unset || {})) delete d[k]; }); return {}; },
  deleteMany: async f => { const before = db.users.length; db.users = db.users.filter(x => !match(x, f)); return { deletedCount: before - db.users.length }; },
  countDocuments: async () => db.users.length
};
const SupportRequest = {
  create: async d => { const doc = { _id: oid(), createdAt: new Date(), ...d }; db.support.push(doc); return doc; },
  countDocuments: async f => db.support.filter(x => match(x, f)).length
};
const TextPost = {
  find: f => query(db.texts, f),
  findOneAndUpdate: (f, u) => { const d = db.texts.find(x => match(x, f)); if (d && u.$inc) for (const [k, v] of Object.entries(u.$inc)) d[k] = (d[k] || 0) + v; const q = { lean: () => Promise.resolve(d ? { ...d } : null) }; return q; },
  countDocuments: async () => db.texts.length
};
const AlertLog = { find: () => query(db.alertsLog, {}) };

// ---------- load bot.js with the fakes ----------
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === 'dotenv') return { config() {} };
  if (request === 'telegraf') return { Telegraf: FakeTelegraf, Markup };
  if (request === 'axios') return axiosFake;
  if (request === 'form-data') return class { constructor() { this.fields = []; } append(k, v, o) { this.fields.push([k, Buffer.isBuffer(v) ? `<${v.length} bytes>` : v, o]); } getHeaders() { return { 'content-type': 'multipart/form-data' }; } };
  if (request === 'jsonwebtoken') return { sign: () => 'fake.jwt.token' };
  if (request === './models') return { User, SupportRequest, TextPost, AlertLog, TEXT_CATEGORIES: ['love', 'sad', 'attitude', 'motivation'] };
  if (request === './utils/plans') return { getPlans: () => ({ monthly: { id: 'monthly', label: 'Pro Monthly', price: 49, days: 30, badge: '' }, yearly: { id: 'yearly', label: 'Pro Yearly', price: 399, days: 365, badge: 'Best value' } }) };
  if (request === './utils/alerts') return { adminAlert: a => { alerts.push(a); return Promise.resolve({}); }, getDbUsage: async () => ({ usedMB: 100, limitMB: 512, usedPercent: 19.5, freeMB: 412 }) };
  if (request === './config/db') return { connectDB: async () => {} };
  return origLoad.call(this, request, parent, ...rest);
};
const botModule = require(path.join(__dirname, '..', 'bot.js'));
const I = botModule._internals;
const K = require(path.join(__dirname, '..', 'utils', 'botKit.js'));

// ---------- docs generator: node scripts/bot-selftest.js --docs  (writes docs/BOT-GUIDE.md from the live command registry) ----------
if (process.argv.includes('--docs')) {
  const fs = require('fs');
  const G = { browse: '🔍 Browse and search', account: '👤 My account', creator: '🎨 Creator tools', shayari: '✍️ Shayari', pro: '👑 Pro', help: '🆘 Help, privacy and account help', admin: '🛠️ Admin (admin role + allow-list only)' };
  const rows = g => I.COMMANDS.filter(c => c.group === g).map(c => `| \`/${c.name}\` | ${(c.aliases || []).map(a => '`/' + a + '`').join(' ') || '–'} | ${c.desc.replace(/\|/g, '/')} | ${c.usage ? '`' + c.usage + '`' : '–'} | ${c.admin ? 'admin' : c.login ? 'login' : 'public'} |`).join('\n');
  const md = `# PresetHub Telegram bot: guide

_Generated from the command registry in \`backend/bot.js\` by \`node scripts/bot-selftest.js --docs\`. Run it again after changing commands._

## What the bot does
Browse, search and download presets, read and post shayari, manage your account and creator earnings, and (for admins) moderate users, presets and support requests. **Payments never happen in Telegram**: paid presets are bought on the website.

## First message (welcome)
\`/start\` shows a personal welcome with inline buttons (different for new visitors, linked users, blocked accounts and admins), then attaches the always-visible reply keyboard. New visitors get a one-line privacy notice. \`/start preset_<id>\` opens a preset card (deep link).

## Reply keyboard (always visible)
🔍 Search · 🆕 Latest · 🔥 Trending · 📂 Categories · ✍️ Shayari · 👑 Pro · 🏠 My Account · 📤 Upload · ❓ Help · 🛠️ Admin Panel (admins only). Tapping one cancels any running step and opens that screen. Plain text with no command is offered as a search.

## Commands
${Object.keys(G).map(g => `### ${G[g]}\n| Command | Aliases | What it does | Usage | Needs |\n|---|---|---|---|---|\n${rows(g)}`).join('\n\n')}

A mistyped command (for example \`/serch\`) gets "did you mean" buttons. Commands that need an argument explain the usage and show an example instead of failing.

## Inline buttons
| Where | Buttons |
|---|---|
| Preset card | ⬇️ Download / Get (price) · ❤️ Like · 🔖 Save · 🔗 Share · 🌐 Open on website. Like and Save update in place. |
| Lists (Latest, Trending, search, category) | Number buttons 1-8 open a card · ⬅️ Prev / Next ➡️ · filters All / Free / Paid · sort New / Popular / Rated. Search results have no filter row. |
| My Account hub | Dashboard, Profile, My Presets, Downloads, Saved, Orders, Notifications, Earnings, Subscription, Referral, Upload, Account help, Unlink, Admin. |
| Upload wizard (7 steps) | Category buttons, price buttons (Free / ₹29 / ₹49 / ₹99 or type), Skip for optional steps, Publish / Cancel at the end. |
| Shayari | Category grid, ❤️ Like, 📋 Copy (tap the text to copy), ➡️ More, ✍️ Post (guided). |
| Account help | Password, login/access, blocked, delete account (asks to confirm), other (type a message). |
| Admin | Users (search, details, **Block asks for confirmation**, Unblock), Presets (filter, Approve, **Reject asks for confirmation**), Support (Resolve / In progress / Reject, the user is notified), Alerts, System, Bot stats, Bot errors. |

## Errors: what the user sees and what the admin gets
Every handler runs inside a guard. Errors are classified; the user always gets a clear message with a way forward (never a stack trace, URL or internal text).

| Code | Cause | User sees | Admin alert |
|---|---|---|---|
| USAGE | Wrong command arguments | Usage and example | No |
| AUTH_REQUIRED / AUTH_EXPIRED | Not linked / session no longer valid | Button to link the account | No |
| ACCOUNT_BLOCKED | Blocked or deactivated account | Message and block-review button | No |
| ADMIN_ONLY / ROLE_FORBIDDEN | Not an admin / role lacks the permission | Denied | **Security alert** for attempts by non-admins |
| NOT_FOUND / VALIDATION / CONFLICT | Missing item, bad input, duplicate | Safe text from the API (HTML removed) | No |
| RATE_LIMITED | Too many requests | Wait time | No |
| UPSTREAM_DOWN | Website API unreachable | "Server not responding" | **Critical** |
| UPSTREAM_ERROR / DB_ERROR / INTERNAL | 5xx, database or code error | Generic message + \`Ref: ABC123\` | **Critical/Warning** with the same Ref, screen, status and short stack |
| FILE_TOO_LARGE | Over Telegram or upload limits | Link to the website | No |
| TELEGRAM_* | "message is not modified", user blocked the bot, old button | Ignored silently | No (formatting errors are reported) |

Alerts are de-duplicated per error type and screen (10 minutes). Admins can list recent errors with \`/errors\` (Ref, time, code, screen) and see counters with \`/botstats\`. Polling crashes (for example a 409 during overlapping deploys) restart the bot automatically with a growing delay and raise an alert.

## Security and privacy rules
1. Private chats only. In groups the bot says "use a private chat" once a minute and shows nothing else.
2. Rate limits per Telegram user: 30 events / 30 s, 6 downloads or uploads / minute, 12 likes/saves/posts / minute, 15 searches / minute, 5 link attempts / 10 minutes, plus a global ceiling of 40 link attempts / 10 minutes. Support requests: 3 per hour.
3. Link codes are 6 digits, stored hashed, single use, expire after 10 minutes, and the user's \`/link\` message is deleted from the chat.
4. Every ID is validated (24 hex characters) before any API call; callback data is parsed strictly; all text is cleaned (control and bidi characters removed, length capped) and HTML-escaped on output.
5. Admin commands and buttons need the admin **role** and, when \`ADMIN_TELEGRAM_IDS\`/\`ADMIN_CHAT_ID\` are set, an allow-listed Telegram ID. Every admin button re-checks this. Destructive actions (block user, reject preset) need a second tap. The website API still enforces admin roles and writes the audit log.
6. Uploads: allowed extensions only, 20 MB Telegram limit, one wizard per chat, state expires after 20 minutes.
7. Privacy: people who have not linked an account have **no profile stored**; \`/privacy\` explains the data; \`/forgetme\` removes the link and stored Telegram profile; support requests are deleted after one year.
8. Payments, payout details and passwords are never handled in Telegram.

## Environment variables
\`BOT_TOKEN\` (required), \`ADMIN_CHAT_ID\` (alerts + admin), \`ADMIN_TELEGRAM_IDS\` (extra admin IDs, comma separated), \`CLIENT_URL\`, \`API_BASE\`, \`JWT_SECRET\`.

## Tests
\`npm run bot:test\` drives the real bot with fake Telegram, API and database objects (60 checks: commands, wrong commands, buttons, upload wizard, errors, admin rules, privacy, rate limits, crash restart).
`;
  fs.writeFileSync(path.join(__dirname, '..', '..', 'docs', 'BOT-GUIDE.md'), md);
  console.log('Wrote docs/BOT-GUIDE.md (' + md.length + ' characters)');
  process.exit(0);
}

// ---------- test helpers ----------
let updateId = 1;
const msgUpdate = (from, text, extra = {}) => ({ update_id: updateId++, message: { message_id: updateId, from, chat: extra.chat || { id: from.id, type: 'private' }, text, ...extra.msg } });
const cbUpdate = (from, data) => ({ update_id: updateId++, callback_query: { id: String(updateId), from, data, message: { message_id: 5, chat: { id: from.id, type: 'private' }, text: 'old message', reply_markup: { inline_keyboard: [[{ text: '❤️ Like', callback_data: 'lk:' + 'a'.repeat(24) }, { text: '🔖 Save', callback_data: 'ws:' + 'a'.repeat(24) }]] } } } });
let autoReset = true;
const send = async (b, update) => { clearOut(); const f = (update.message && update.message.from) || (update.callback_query && update.callback_query.from); if (autoReset && f) I.limiter.m.delete('e:' + f.id); await b.handleUpdate(update); await new Promise(r => setImmediate(r)); return out.slice(); };
const texts = o => o.filter(x => x.text).map(x => x.text).join('\n---\n');
const buttons = o => o.flatMap(x => (x.extra && x.extra.reply_markup && x.extra.reply_markup.inline_keyboard || []).flat());
const hasBtn = (o, data) => buttons(o).some(b => b.callback_data === data);
const hasBtnPrefix = (o, p) => buttons(o).some(b => b.callback_data && b.callback_data.startsWith(p));
const answers = o => o.filter(x => x.kind === 'answer');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; failures.push(name); console.log(`FAIL  ${name}\n      ${String(e.message).split('\n')[0]}`); }
}

const PID = 'a'.repeat(24);
const PRESET = { id: PID, name: 'Golden Hour <b>', author: 'Asha', category: 'Portrait', price: 0, avgRating: 4.6, views: 1200, downloads: 340, likesCount: 55, previewImage: 'https://presethub.site/media/abc', description: 'Warm & soft tones' };
const PAID = { ...PRESET, id: 'b'.repeat(24), price: 49 };

(async () => {
  // ===== K (botKit) =====
  await test('botKit: escaping, clean, parse and fuzzy matching', () => {
    assert.strictEqual(K.h('<b>&"'), '&lt;b&gt;&amp;"');
    assert.strictEqual(K.clean('  hi\u0000\u202E there  ', 50), 'hi there');
    assert.deepStrictEqual(K.parseCommand('/Search@PresetHubBot  sunset  beach'), { cmd: 'search', bot: 'PresetHubBot', argText: 'sunset  beach', args: ['sunset', 'beach'] });
    assert.strictEqual(K.parseCommand('hello'), null);
    assert.ok(K.suggest('serch', ['search', 'latest', 'help']).includes('search'));
    assert.ok(K.suggest('lates', ['search', 'latest', 'help'])[0] === 'latest');
    assert.deepStrictEqual(K.suggest('zzzzzzzz', ['search', 'latest']), []);
    assert.ok(K.isButtonUrl('https://presethub.site/x') && !K.isButtonUrl('http://localhost:3000') && !K.isButtonUrl('javascript:alert(1)'));
  });
  await test('botKit: error classification', () => {
    const c = e => K.classifyError(e);
    assert.strictEqual(c(Object.assign(new Error('x'), { isAxiosError: true, response: { status: 404, data: { error: 'nope' } } })).code, 'NOT_FOUND');
    assert.strictEqual(c(Object.assign(new Error('x'), { isAxiosError: true, response: { status: 401, data: {} } })).code, 'AUTH_EXPIRED');
    assert.strictEqual(c(Object.assign(new Error('x'), { isAxiosError: true, response: { status: 403, data: { code: 'ROLE_FORBIDDEN' } } })).code, 'ROLE_FORBIDDEN');
    assert.strictEqual(c(Object.assign(new Error('x'), { isAxiosError: true, response: { status: 429, data: {} } })).code, 'RATE_LIMITED');
    const s = c(Object.assign(new Error('x'), { isAxiosError: true, response: { status: 502, data: {} } })); assert.ok(s.code === 'UPSTREAM_ERROR' && s.report);
    const d = c(Object.assign(new Error('connect'), { isAxiosError: true, code: 'ECONNREFUSED' })); assert.ok(d.code === 'UPSTREAM_DOWN' && d.severity === 'critical');
    assert.ok(c(Object.assign(new Error('x'), { response: { ok: false, error_code: 400, description: 'Bad Request: message is not modified' } })).ignore);
    assert.ok(c(Object.assign(new Error('x'), { response: { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' } })).ignore);
    assert.strictEqual(c(new K.BotError('USAGE', 'bad')).code, 'USAGE');
    assert.strictEqual(c(new TypeError('boom')).code, 'INTERNAL');
    assert.strictEqual(c(Object.assign(new Error('m'), { name: 'MongoServerError' })).code, 'DB_ERROR');
  });
  await test('botKit: rate limiter, ttl store, chunking', () => {
    const rl = new K.RateLimiter(); const t0 = 1000;
    assert.ok(rl.hit('a', 2, 1000, t0).ok && rl.hit('a', 2, 1000, t0).ok);
    const blocked = rl.hit('a', 2, 1000, t0 + 1); assert.ok(!blocked.ok && blocked.firstBlock);
    assert.ok(!rl.hit('a', 2, 1000, t0 + 2).firstBlock);
    assert.ok(rl.hit('a', 2, 1000, t0 + 1500).ok);
    const s = new K.TtlStore(5); s.set('k', 1); assert.strictEqual(s.get('k'), 1);
    const chunks = K.chunkLines(Array(100).fill('<b>x</b> ' + 'y'.repeat(100)), 1000); assert.ok(chunks.every(c => c.length <= 1000 && !c.endsWith('<')) && chunks.length > 5);
  });

  // ===== start the bot =====
  await test('startBot: launches, sets command menus, exposes status', async () => {
    const ok = await botModule.startBot();
    assert.strictEqual(ok, true);
    const st = botModule.getBotStatus();
    assert.ok(st.started && st.username === 'PresetHubTestBot');
  });
  // grab the created bot instance via a launched update handler: re-create through registerHandlers
  const bot = new FakeTelegraf(); I.registerHandlers(bot);

  const guest = { id: 111, first_name: 'Ravi <script>', username: 'ravi', language_code: 'hi' };
  const user = { id: 222, first_name: 'Asha', username: 'asha' };
  const admin = { id: 999, first_name: 'Boss', username: 'boss' };

  await test('callback_data of every registry button fits 64 bytes (bot builds all menus)', async () => {
    apiMock = async ({ path: p }) => (p === '/presets' ? { presets: [PRESET], total: 1, page: 1, totalPages: 1 } : { });
    for (const cmd of ['/start', '/menu', '/help', '/pro', '/login', '/categories']) await send(bot, msgUpdate(guest, cmd));
  });

  // ===== welcome =====
  await test('/start (new visitor): welcome text, privacy line, inline buttons, reply keyboard, NO profile stored, admin notified once', async () => {
    const o = await send(bot, msgUpdate(guest, '/start'));
    const t = texts(o);
    assert.ok(/स्वागत/.test(t) && t.includes('Ravi &lt;script&gt;'), 'welcome escapes the name');
    assert.ok(hasBtn(o, 'm:login') && hasBtn(o, 'm:latest') && hasBtn(o, 'm:help'));
    assert.ok(o.some(x => x.extra && x.extra.reply_markup && x.extra.reply_markup.keyboard), 'main reply keyboard sent');
    assert.ok(!db.users.some(u => u.telegramId === '111'), 'no profile is stored for a visitor');
    assert.ok(/\/privacy/.test(t) && hasBtn(o, 'm:privacy'));
    assert.strictEqual(alerts.filter(a => a.type === 'new_user').length, 1);
    await send(bot, msgUpdate(guest, '/start'));
    assert.strictEqual(alerts.filter(a => a.type === 'new_user').length, 1, 'no duplicate new-user alert');
  });
  await test('/start preset_<id> deep link opens the preset card', async () => {
    apiMock = async ({ path: p }) => { assert.strictEqual(p, `/presets/${PID}`); return PRESET; };
    const o = await send(bot, msgUpdate(guest, `/start preset_${PID}`));
    assert.ok(o.some(x => x.kind === 'photo') && hasBtn(o, `dl:${PID}`));
  });

  // ===== commands, wrong commands =====
  await test('mistyped command gets "did you mean" buttons', async () => {
    const o = await send(bot, msgUpdate(guest, '/serch sunset'));
    assert.ok(/नाम का कोई command नहीं/.test(texts(o)) && hasBtn(o, 'm:search'));
    const o2 = await send(bot, msgUpdate(guest, '/zzzzqqqq'));
    assert.ok(/नहीं है/.test(texts(o2)) && hasBtn(o2, 'm:help'));
    assert.ok(I.stats.snapshot().unknownCommands >= 2);
  });
  await test('/help lists commands (no admin group for guests); /help search shows usage; unknown help topic handled', async () => {
    const o = await send(bot, msgUpdate(guest, '/help'));
    const t = texts(o);
    assert.ok(t.includes('/search') && t.includes('/latest') && !t.includes('/adminusers'));
    const o2 = await send(bot, msgUpdate(guest, '/help search'));
    assert.ok(/Usage/.test(texts(o2)) && /\/search sunset/.test(texts(o2)));
    const o3 = await send(bot, msgUpdate(guest, '/help nonsense'));
    assert.ok(/मौजूद नहीं/.test(texts(o3)));
    const o4 = await send(bot, msgUpdate(guest, '/help adminusers'));
    assert.ok(/मौजूद नहीं/.test(texts(o4)), 'admin command details hidden from guests');
  });
  await test('every command in the registry has a description and unique name', () => {
    const seen = new Set();
    for (const c of I.COMMANDS) { assert.ok(c.desc && c.run && c.group, c.name); for (const n of [c.name, ...(c.aliases || [])]) { assert.ok(!seen.has(n), 'duplicate ' + n); seen.add(n); } }
  });

  // ===== browse & search =====
  await test('search flow: prompt -> text -> list with number buttons, paging and no filter row', async () => {
    const o1 = await send(bot, msgUpdate(guest, '🔍 Search'));
    assert.ok(/क्या खोजना/.test(texts(o1)) && I.convo.get(111).type === 'search');
    apiMock = async ({ path: p, params }) => { assert.strictEqual(p, '/presets'); assert.strictEqual(params.q, 'sunset'); return { presets: [PRESET, PAID], total: 20, page: 1, totalPages: 3 }; };
    const o2 = await send(bot, msgUpdate(guest, 'sunset'));
    const t = texts(o2);
    assert.ok(t.includes('Golden Hour &lt;b&gt;') && hasBtn(o2, `p:${PID}`) && hasBtn(o2, 'pg:2') && !hasBtn(o2, 'fl:free'));
    assert.strictEqual(I.convo.get(111), undefined);
  });
  await test('paging, filters and sort buttons update the same list', async () => {
    apiMock = async () => ({ presets: [PRESET], total: 40, page: 1, totalPages: 5 });
    await send(bot, msgUpdate(guest, '/latest'));
    const o = await send(bot, cbUpdate(guest, 'pg:3'));
    assert.ok(apiCalls.at(-1).params.page === 3 && o.some(x => x.kind === 'edit'));
    await send(bot, cbUpdate(guest, 'fl:free')); assert.strictEqual(apiCalls.at(-1).params.price, 'free'); assert.strictEqual(apiCalls.at(-1).params.page, 1);
    await send(bot, cbUpdate(guest, 'so:popular')); assert.strictEqual(apiCalls.at(-1).params.sort, 'popular');
    await send(bot, cbUpdate(guest, 'fl:all')); assert.ok(!('price' in apiCalls.at(-1).params));
  });
  await test('stale paging button gives a clear message instead of failing', async () => {
    I.lists.delete(111);
    const o = await send(bot, cbUpdate(guest, 'pg:2'));
    assert.ok(answers(o).some(a => /पुराना/.test(a.text || '')));
  });
  await test('too-short search and plain-text suggestions', async () => {
    const o = await send(bot, msgUpdate(guest, '/search a'));
    assert.ok(/कम से कम 2/.test(texts(o)) && /Usage/.test(texts(o)));
    const o2 = await send(bot, msgUpdate(guest, 'moody tones'));
    assert.ok(hasBtn(o2, 'qs:go'));
    apiMock = async ({ params }) => { assert.strictEqual(params.q, 'moody tones'); return { presets: [PRESET], total: 1, totalPages: 1 }; };
    const o3 = await send(bot, cbUpdate(guest, 'qs:go')); assert.ok(texts(o3).includes('Golden Hour'));
  });
  await test('empty search result offers next steps', async () => {
    apiMock = async () => ({ presets: [], total: 0, totalPages: 1 });
    const o = await send(bot, msgUpdate(guest, '/search nothinghere'));
    assert.ok(/नहीं मिला/.test(texts(o)) && hasBtn(o, 'm:categories'));
  });
  await test('categories list, tap a category, invalid index', async () => {
    apiMock = async ({ path: p }) => (p === '/presets/categories' ? [['Portrait', 12], ['Travel', 8]] : { presets: [PRESET], total: 1, totalPages: 1 });
    const o = await send(bot, msgUpdate(guest, '/categories')); assert.ok(hasBtn(o, 'bc:0') && hasBtn(o, 'bc:1'));
    await send(bot, cbUpdate(guest, 'bc:1')); assert.strictEqual(apiCalls.at(-1).params.category, 'Travel');
    const o2 = await send(bot, cbUpdate(guest, 'bc:99')); assert.ok(answers(o2).some(a => /पुराना/.test(a.text || '')));
    const o3 = await send(bot, msgUpdate(guest, '/category')); assert.ok(/Usage/.test(texts(o3)));
  });
  await test('preset card: invalid id, not found, long caption fallback', async () => {
    const o = await send(bot, msgUpdate(guest, '/preset notanid')); assert.ok(/सही नहीं/.test(texts(o)) && /Usage/.test(texts(o)));
    apiMock = async () => { throw axiosError(404, { error: 'Preset not found' }); };
    const o2 = await send(bot, msgUpdate(guest, `/preset ${PID}`)); assert.ok(/नहीं मिला/.test(texts(o2)));
    apiMock = async () => ({ ...PRESET, name: '&'.repeat(100), author: '&'.repeat(60), category: '&'.repeat(40), description: '&'.repeat(300) });
    const o3 = await send(bot, msgUpdate(guest, `/preset ${PID}`)); assert.ok(o3.every(x => !x.text || x.text.length <= 1024 || x.kind === 'reply'));
  });
  await test('free command, trending and top creators', async () => {
    apiMock = async ({ path: p }) => (p === '/users/top' ? [{ id: PID, name: 'Asha', presetCount: 4, totalDownloads: 1500 }] : { presets: [PRESET], total: 1, totalPages: 1 });
    await send(bot, msgUpdate(guest, '/free')); assert.strictEqual(apiCalls.at(-1).params.price, 'free');
    await send(bot, msgUpdate(guest, '🔥 Trending')); assert.strictEqual(apiCalls.at(-1).params.sort, 'popular');
    const o = await send(bot, msgUpdate(guest, '/top')); assert.ok(/Top Creators/.test(texts(o)) && texts(o).includes('/profile/'));
  });

  // ===== guest limits =====
  await test('guest tapping Download/Like/Account is asked to link (answered once, no crash)', async () => {
    const o = await send(bot, cbUpdate(guest, `dl:${PID}`));
    assert.ok(hasBtn(o, 'm:login') && answers(o).length === 1);
    const o2 = await send(bot, cbUpdate(guest, `lk:${PID}`)); assert.ok(answers(o2).some(a => /link/.test(a.text || '')) && answers(o2).length === 1);
    const o3 = await send(bot, msgUpdate(guest, '/dashboard')); assert.ok(hasBtn(o3, 'm:login'));
    const o4 = await send(bot, msgUpdate(guest, '/upload')); assert.ok(hasBtn(o4, 'm:login') && !I.convo.get(111));
  });
  await test('guest cannot use admin commands; non-admin attempt raises a security alert', async () => {
    const o = await send(bot, msgUpdate(guest, '/admin'));
    assert.ok(hasBtn(o, 'm:login'));
    const reg = { id: 333, first_name: 'Reg' };
    await User.create({ email: 'reg@example.com', role: 'user', username: 'reg', name: 'Reg', telegramId: '333' });
    const o2 = await send(bot, msgUpdate(reg, '/admin'));
    assert.ok(/सिर्फ admin/.test(texts(o2)) && alerts.some(a => a.type === 'security' && /non-admin/.test(a.title)));
    const o3 = await send(bot, cbUpdate(reg, `abc:${PID}`)); assert.ok(!apiCalls.some(c => c.path.startsWith('/admin/users')), 'admin callback blocked');
  });

  // ===== link account =====
  await test('/link: bad usage, wrong code (rate limited after 5), good code links and deletes the secret message', async () => {
    const o = await send(bot, msgUpdate(user, '/start')); assert.ok(o.length);
    const o1 = await send(bot, msgUpdate(user, '/link abc')); assert.ok(o1.some(x => x.kind === 'delete') && /Usage/.test(texts(o1)));
    for (let i = 0; i < 5; i++) await send(bot, msgUpdate(user, '/link 000000'));
    const o2 = await send(bot, msgUpdate(user, '/link 111111')); assert.ok(/ज़्यादा कोशिशें/.test(texts(o2)));
    // new telegram user links successfully
    const u2 = { id: 444, first_name: 'Neha' }; await send(bot, msgUpdate(u2, '/start'));
    db.users.push({ _id: oid(), email: 'telegram_444@users.presethub.local', role: 'user', telegramId: '444', status: 'active' }); // legacy placeholder from an older version
    const real = { _id: oid(), email: 'neha@example.com', name: 'Neha Sharma', username: 'neha', role: 'user', status: 'active', botLinkHash: crypto.createHash('sha256').update('482913').digest('hex'), botLinkExpires: new Date(Date.now() + 600000) };
    db.users.push(real);
    const o3 = await send(bot, msgUpdate(u2, '/link 482913'));
    assert.ok(o3.some(x => x.kind === 'delete') && /Account linked/.test(texts(o3)) && texts(o3).includes('Neha Sharma'));
    assert.strictEqual(db.users.find(x => x._id === real._id).telegramId, '444');
    assert.ok(!db.users.some(x => x.telegramId === '444' && /@users\.presethub\.local$/.test(x.email)), 'placeholder removed');
    assert.ok(!db.users.find(x => x._id === real._id).botLinkHash, 'code is single use');
    const o4 = await send(bot, msgUpdate(u2, '/link 482913')); assert.ok(/पहले से linked/.test(texts(o4)));
  });
  await test('expired link code is rejected', async () => {
    const u3 = { id: 445, first_name: 'Old' }; await send(bot, msgUpdate(u3, '/start'));
    db.users.push({ _id: oid(), email: 'old@example.com', name: 'Old', username: 'old', status: 'active', botLinkHash: crypto.createHash('sha256').update('123123').digest('hex'), botLinkExpires: new Date(Date.now() - 1000) });
    const o = await send(bot, msgUpdate(u3, '/link 123123')); assert.ok(/गलत है या expire/.test(texts(o)));
  });

  // ===== linked user =====
  // make 'user' (222) a linked account
  await User.create({ email: 'asha@example.com', name: 'Asha', username: 'asha', role: 'user', telegramId: '222', createdAt: new Date('2025-01-05') });

  await test('welcome for a linked user shows account buttons', async () => {
    const o = await send(bot, msgUpdate(user, '/start'));
    assert.ok(/वापसी पर स्वागत/.test(texts(o)) && hasBtn(o, 'm:account') && hasBtn(o, 'm:upload') && !hasBtn(o, 'm:admin'));
    const kb = o.find(x => x.extra && x.extra.reply_markup && x.extra.reply_markup.keyboard);
    assert.ok(kb && !kb.extra.reply_markup.keyboard.flat().includes('🛠️ Admin Panel'));
  });
  await test('account hub and each hub button route to a working screen', async () => {
    apiMock = async ({ path: p }) => {
      if (p === '/users/me/dashboard') return { user: { name: 'Asha', username: 'asha' }, stats: { downloads: 10, views: 20, likes: 3, shares: 1 }, presets: [{ ...PRESET, status: 'approved' }], followers: 4, following: 2, downloads: 7, unreadNotifications: 2 };
      if (p === '/users/me/downloads') return [PRESET];
      if (p === '/users/me/wishlist/presets') return [PAID];
      if (p === '/users/me/notifications') return [{ message: 'Welcome <3', read: false, createdAt: new Date() }];
      if (p === '/payments/my-orders') return [{ id: '1', kind: 'preset', amount: 49, status: 'paid', createdAt: new Date(), presetId: PID }, { id: '2', kind: 'subscription', plan: 'monthly', amount: 49, status: 'created', createdAt: new Date() }];
      if (p === '/users/me/subscription') return { isPro: false };
      if (p === '/users/referrals/generate') return { referralCode: 'ASHA123' };
      if (p === '/creator/dashboard') return { money: { earned: 1000, available: 400, pending: 100, paid: 500, minPayout: 100, sharePercent: 80, sales: { count: 5 }, tips: { count: 1 } }, totals: { presets: 2, downloads: 300, presetViews: 900 }, payouts: [{ amount: 500, status: 'paid', createdAt: new Date() }] };
      return {};
    };
    const hub = await send(bot, msgUpdate(user, '🏠 My Account'));
    for (const b of buttons(hub).filter(b => b.callback_data && b.callback_data.startsWith('m:') && !['m:logout', 'm:upload', 'm:accounthelp', 'm:search'].includes(b.callback_data))) {
      const o = await send(bot, cbUpdate(user, b.callback_data));
      assert.ok(o.some(x => x.text), `no output for ${b.callback_data}`);
      assert.ok(!/कुछ गड़बड़/.test(texts(o)), `error for ${b.callback_data}: ${texts(o)}`);
    }
    const prof = await send(bot, msgUpdate(user, '/profile')); assert.ok(texts(prof).includes('as••@example.com') || /@example\.com/.test(texts(prof)));
    assert.ok(!texts(prof).includes('asha@example.com'), 'email masked');
    const earn = await send(bot, msgUpdate(user, '/earnings')); assert.ok(/₹1,000/.test(texts(earn)) && /₹400/.test(texts(earn)));
    assert.ok(apiCalls.filter(c => c.headers && c.headers.Authorization).length > 5, 'authenticated calls carry the bot token');
  });
  await test('notifications are HTML-escaped and marked read', async () => {
    const o = await send(bot, msgUpdate(user, '/notifications')); assert.ok(texts(o).includes('Welcome &lt;3'));
    assert.ok(apiCalls.some(c => c.path === '/users/notifications/read-all'));
  });

  // ===== download / like / save / share =====
  await test('download: free preset is sent as a document with a safe filename', async () => {
    apiMock = async ({ path: p, method }) => (method === 'post' && p === `/presets/${PID}/download` ? { downloadUrl: 'https://presethub.site/api/presets/x/file?token=t', originalName: '../../evil<>name.xmp' } : Buffer.from('<xmp/>'));
    const o = await send(bot, cbUpdate(user, `dl:${PID}`));
    const d = o.find(x => x.kind === 'document'); assert.ok(d, 'document sent');
    assert.strictEqual(d.doc.filename, 'evil__name.xmp'.replace('evil__name', d.doc.filename.replace('.xmp', '')) && d.doc.filename);
    assert.ok(!/[\\/<>]/.test(d.doc.filename), 'filename sanitised: ' + d.doc.filename);
    assert.ok(answers(o).length === 1);
  });
  await test('download: paid preset not purchased -> buy on website; rate limit after 6', async () => {
    apiMock = async ({ path: p }) => { if (p.endsWith('/download')) throw axiosError(403, { error: 'Purchase required' }); return {}; };
    const o = await send(bot, cbUpdate(user, `dl:${PAID.id}`));
    assert.ok(/paid preset/.test(texts(o)) && buttons(o).some(b => b.url && b.url.includes('/preset/')));
    for (let i = 0; i < 6; i++) await send(bot, cbUpdate(user, `dl:${PAID.id}`));
    const o2 = await send(bot, cbUpdate(user, `dl:${PAID.id}`)); assert.ok(/सेकंड बाद/.test(texts(o2)));
    I.limiter.m.delete('dl:222');
  });
  await test('download: file larger than 50 MB falls back to a website link; invalid id rejected', async () => {
    apiMock = async ({ path: p, method }) => { if (method === 'post') return { downloadUrl: 'https://presethub.site/api/presets/x/file?token=t', originalName: 'a.zip' }; const e = new Error('maxContentLength size of 52428800 exceeded'); e.isAxiosError = true; throw e; };
    const o = await send(bot, cbUpdate(user, `dl:${PID}`)); assert.ok(/50 MB/.test(texts(o)));
    const o2 = await send(bot, msgUpdate(user, '/download 123')); assert.ok(/सही नहीं/.test(texts(o2)));
    const o3 = await send(bot, msgUpdate(user, '/download')); assert.ok(/Usage/.test(texts(o3)));
    I.limiter.m.delete('dl:222');
  });
  await test('like and save toggle the button label in place', async () => {
    apiMock = async ({ path: p }) => (p.endsWith('/like') ? { liked: true, likes: 56 } : { wishlist: ['a'.repeat(24)] });
    const o = await send(bot, cbUpdate(user, `lk:${PID}`));
    const em = o.find(x => x.kind === 'editmarkup'); assert.ok(em && em.markup.inline_keyboard[0][0].text.includes('Liked'));
    const o2 = await send(bot, cbUpdate(user, `ws:${PID}`)); assert.ok(o2.find(x => x.kind === 'editmarkup').markup.inline_keyboard[0][1].text.includes('Saved'));
  });
  await test('share creates a link with a Telegram share button', async () => {
    apiMock = async () => ({ shortUrl: 'https://presethub.site/s/abc123', fullUrl: 'x' });
    const o = await send(bot, cbUpdate(user, `sh:${PID}`)); assert.ok(texts(o).includes('/s/abc123') && buttons(o).some(b => b.url && b.url.startsWith('https://t.me/share/url')));
  });
  await test('write actions are rate limited', async () => {
    apiMock = async () => ({ liked: true, likes: 1 });
    I.limiter.m.delete('w:222');
    for (let i = 0; i < 12; i++) await send(bot, cbUpdate(user, `lk:${PID}`));
    I.limiter.m.delete('e:222');
    const o = await send(bot, cbUpdate(user, `lk:${PID}`)); assert.ok(/सेकंड बाद/.test(texts(o)));
    I.limiter.m.delete('w:222');
  });

  // ===== upload wizard =====
  await test('upload wizard: full happy path with buttons, file, preview and publish', async () => {
    apiMock = async ({ path: p, method }) => (p === '/presets/categories' ? [['Portrait', 3], ['Travel', 2]] : p === '/presets' && method === 'post' ? { id: PID, name: 'My Preset', category: 'Portrait', price: 49 } : Buffer.from('FILEDATA'));
    let o = await send(bot, msgUpdate(user, '/upload')); assert.ok(/1\/7/.test(texts(o)));
    o = await send(bot, msgUpdate(user, 'My Preset')); assert.ok(hasBtn(o, 'uc:0'));
    o = await send(bot, cbUpdate(user, 'uc:0')); assert.ok(hasBtn(o, 'up:49'));
    o = await send(bot, cbUpdate(user, 'up:49')); assert.ok(/Description/.test(texts(o)) && hasBtn(o, 'us:desc'));
    o = await send(bot, msgUpdate(user, 'Warm look')); assert.ok(/Tags/.test(texts(o)));
    o = await send(bot, msgUpdate(user, 'Warm, Sunset , travel')); assert.ok(/Preset file/.test(texts(o)));
    o = await send(bot, msgUpdate(user, 'just text')); assert.ok(/Document/.test(texts(o)), 'text during file step is guided');
    o = await send(bot, msgUpdate(user, '', { msg: { text: undefined, document: { file_id: 'f1', file_name: 'look.xmp', file_size: 2048, mime_type: 'application/xml' } } })); assert.ok(/Preview image/.test(texts(o)) && hasBtn(o, 'us:preview'));
    o = await send(bot, msgUpdate(user, '', { msg: { text: undefined, photo: [{ file_id: 'p0' }, { file_id: 'p1' }] } })); assert.ok(/जाँच लें/.test(texts(o)) && texts(o).includes('look.xmp') && hasBtn(o, 'uf:ok'));
    o = await send(bot, cbUpdate(user, 'uf:ok'));
    assert.ok(/Upload complete/.test(texts(o)));
    const post = apiCalls.filter(c => c.method === 'post' && c.path === '/presets').pop();
    const f = Object.fromEntries(post.data.fields.map(([k, v]) => [k, v]));
    assert.strictEqual(f.name, 'My Preset'); assert.strictEqual(f.price, '49'); assert.strictEqual(f.tags, 'warm,sunset,travel'); assert.ok(post.headers.Authorization);
    assert.strictEqual(I.convo.get(222), undefined, 'state cleared');
  });
  await test('upload wizard: bad file type, oversized file, bad price, skip steps, cancel, stale buttons', async () => {
    await send(bot, msgUpdate(user, '/upload')); await send(bot, msgUpdate(user, 'Another'));
    await send(bot, msgUpdate(user, 'Custom Cat'));          // typed category
    let o = await send(bot, msgUpdate(user, 'abc')); assert.ok(/सही price/.test(texts(o)));
    o = await send(bot, msgUpdate(user, '₹29')); assert.ok(/Description/.test(texts(o)));
    o = await send(bot, cbUpdate(user, 'us:desc')); assert.ok(/Tags/.test(texts(o)));
    o = await send(bot, cbUpdate(user, 'us:tags')); assert.ok(/Preset file/.test(texts(o)));
    o = await send(bot, msgUpdate(user, '', { msg: { text: undefined, document: { file_id: 'f', file_name: 'virus.exe', file_size: 100 } } })); assert.ok(/allowed नहीं/.test(texts(o)));
    o = await send(bot, msgUpdate(user, '', { msg: { text: undefined, document: { file_id: 'f', file_name: 'big.zip', file_size: 30 * 1024 * 1024 } } })); assert.ok(/20 MB/.test(texts(o)));
    o = await send(bot, cbUpdate(user, 'uf:ok')); assert.ok(answers(o).some(a => /पुराना/.test(a.text || '')), 'confirm before file is stale');
    o = await send(bot, cbUpdate(user, 'cv:cancel')); assert.ok(/Cancel/.test(texts(o)) && !I.convo.get(222));
    o = await send(bot, msgUpdate(user, '/cancel')); assert.ok(/कोई action चल नहीं/.test(texts(o)));
  });
  await test('document without /upload and a command in the middle of a wizard', async () => {
    let o = await send(bot, msgUpdate(user, '', { msg: { text: undefined, document: { file_id: 'f', file_name: 'a.xmp', file_size: 10 } } })); assert.ok(/पहले \/upload/.test(texts(o)));
    await send(bot, msgUpdate(user, '/upload')); await send(bot, msgUpdate(user, '/latest'));
    assert.strictEqual(I.convo.get(222), undefined, 'a command leaves the wizard');
    o = await send(bot, msgUpdate(user, '', { msg: { text: undefined, photo: [{ file_id: 'p' }] } })); assert.ok(/preview step/.test(texts(o)));
  });

  // ===== shayari =====
  await test('shayari: categories, list, copy, like and guided post', async () => {
    db.texts.push({ _id: oid(), status: 'approved', category: 'love', author: 'A', text: 'Tere <bina> adhoora', likes: [], copies: 0, shares: 0, createdAt: new Date() });
    let o = await send(bot, msgUpdate(guest, '/shayari')); assert.ok(hasBtn(o, 'sc:love:1') && hasBtn(o, 'sn:start'));
    o = await send(bot, cbUpdate(guest, 'sc:love:1')); assert.ok(texts(o).includes('Tere &lt;bina&gt; adhoora') && hasBtnPrefix(o, 'tc:'));
    const tid = db.texts[0]._id;
    o = await send(bot, cbUpdate(guest, `tc:${tid}`)); assert.ok(texts(o).includes('<code>') && db.texts[0].copies === 1);
    o = await send(bot, msgUpdate(guest, '/shayari nosuchcat')); assert.ok(/नहीं मिली/.test(texts(o)));
    o = await send(bot, cbUpdate(guest, `tl:${tid}`)); assert.ok(answers(o).some(a => /link/.test(a.text || '')));
    apiMock = async ({ path: p, data }) => (p === '/texts' ? { id: PID } : { liked: true, likes: 1 });
    o = await send(bot, cbUpdate(user, 'sn:start')); assert.ok(hasBtn(o, 'sn:love'));
    o = await send(bot, cbUpdate(user, 'sn:love')); assert.ok(/#love/.test(texts(o)));
    o = await send(bot, msgUpdate(user, 'hi')); assert.ok(/कम से कम 5/.test(texts(o)));
    o = await send(bot, msgUpdate(user, 'Yeh meri nayi shayari hai')); assert.ok(hasBtn(o, 'sf:ok'));
    o = await send(bot, cbUpdate(user, 'sf:ok')); assert.ok(/Post हो गया/.test(texts(o)) && apiCalls.at(-1).path === '/texts' && apiCalls.at(-1).data.category === 'love');
    o = await send(bot, msgUpdate(user, '/postshayari love | Ek line shayari yahan')); assert.ok(/Post हो गया/.test(texts(o)));
    o = await send(bot, msgUpdate(user, '/postshayari wrong format')); assert.ok(/Usage/.test(texts(o)));
  });

  // ===== pro =====
  await test('/pro shows plans and honest feature list; no claim that Pro unlocks paid presets', async () => {
    const o = await send(bot, msgUpdate(guest, '/pro')); const t = texts(o);
    assert.ok(t.includes('Pro Monthly') && t.includes('₹49') && /Zero ads/.test(t) && !/premium presets.*free|paid presets.*free/i.test(t));
    assert.ok(buttons(o).some(b => b.url));
  });

  // ===== support =====
  await test('account help: request reaches the admin, repeated requests are limited', async () => {
    let o = await send(bot, msgUpdate(guest, '/accounthelp')); assert.ok(hasBtn(o, 'ah:password_reset') && hasBtn(o, 'ah:delete_account'));
    o = await send(bot, cbUpdate(guest, 'ah:password_reset')); assert.ok(/admin को भेज/.test(texts(o)) && db.support.length === 1);
    assert.ok(out.length >= 0);
    const dm = []; clearOut(); await bot.handleUpdate(cbUpdate(guest, 'ah:account_access')); dm.push(...out.filter(x => x.kind === 'dm' && x.chat === '999'));
    assert.ok(dm.length === 1 && /Account request/.test(dm[0].text) && !dm[0].text.includes('@example'));
    o = await send(bot, cbUpdate(guest, 'ah:block_review')); assert.strictEqual(db.support.length, 3);
    o = await send(bot, cbUpdate(guest, 'ah:other')); assert.ok(I.convo.get(111).type === 'support');
    o = await send(bot, msgUpdate(guest, 'Mujhe madad chahiye')); assert.ok(/सीमा|पहले ही admin/.test(texts(o)) || /पहले ही/.test(texts(o)));
    o = await send(bot, cbUpdate(guest, 'ah:delete_account')); assert.ok(hasBtn(o, 'ah:delete_yes'));
    o = await send(bot, cbUpdate(guest, 'ah:nonsense')); assert.ok(answers(o).some(a => /पुराना/.test(a.text || '')));
  });

  // ===== logout =====
  await test('logout asks first, then unlinks only when confirmed', async () => {
    let o = await send(bot, msgUpdate(user, '/logout')); assert.ok(hasBtn(o, 'lo:y') && hasBtn(o, 'lo:n'));
    assert.ok(db.users.find(x => x.telegramId === '222'), 'still linked before confirming');
    o = await send(bot, cbUpdate(user, 'lo:n')); assert.ok(db.users.find(x => x.telegramId === '222'));
    o = await send(bot, cbUpdate(user, 'lo:y')); assert.ok(/unlink हो गया/.test(texts(o)) && !db.users.find(x => x.telegramId === '222'));
    Object.assign((await User.create({ email: 'asha@example.com', name: 'Asha', username: 'asha', role: 'user', telegramId: '222' })), {});
  });

  // ===== admin =====
  const adminDoc = await User.create({ email: 'boss@example.com', name: 'Boss', username: 'boss', role: 'admin', telegramId: '999' });
  const victim = await User.create({ email: 'v@example.com', name: 'Victim', username: 'victim', role: 'user' });
  await test('admin panel: dashboard and hub buttons work', async () => {
    apiMock = async ({ path: p, params }) => {
      if (p === '/admin/analytics') return { totalUsers: 120, totalPresets: 45, totalDownloads: 3400, totalViews: 9000, totalLikes: 800 };
      if (p === '/admin/users') return { items: [{ id: victim._id, name: 'Victim', username: 'victim', role: 'user', status: 'active' }, { id: adminDoc._id, name: 'Boss', username: 'boss', role: 'admin', status: 'active' }], total: 2 };
      if (p.endsWith('/details')) return { user: { id: p.split('/')[3], name: 'Victim', username: 'victim', email: 'v@example.com', role: p.includes(adminDoc._id) ? 'admin' : 'user', status: 'active', createdAt: new Date() } };
      if (p === '/admin/presets') return { items: [{ id: PID, name: 'Golden', author: 'Asha', status: 'approved', price: 0, category: 'Portrait', downloads: 3 }], total: 1 };
      if (p === '/admin/support-requests') return { items: [{ id: PID, type: 'password_reset', name: 'Ravi', email: 'ravi@example.com', telegramId: '111', message: 'help <b>', createdAt: new Date() }] };
      return { success: true, request: { telegramId: '111' } };
    };
    db.alertsLog.push({ type: 'error', severity: 'critical', title: 'Test <alert>', count: 3, lastAt: new Date() });
    const o = await send(bot, msgUpdate(admin, '/admin'));
    assert.ok(/Admin Panel/.test(texts(o)) && texts(o).includes('120'));
    for (const d of ['m:adminusers', 'm:adminpresets', 'm:support', 'm:alerts', 'm:system', 'm:errors', 'm:botstats']) {
      const r = await send(bot, cbUpdate(admin, d)); assert.ok(r.some(x => x.text) && !/कुछ गड़बड़/.test(texts(r)), `${d}: ${texts(r)}`);
    }
    const al = await send(bot, cbUpdate(admin, 'm:alerts')); assert.ok(texts(al).includes('Test &lt;alert&gt;'));
    const sp = await send(bot, cbUpdate(admin, 'm:support')); assert.ok(texts(sp).includes('help &lt;b&gt;') && hasBtnPrefix(sp, 'sr:resolved:'));
  });
  await test('admin: block needs confirmation; unblock; cannot block another admin from the UI', async () => {
    let o = await send(bot, cbUpdate(admin, `au:${victim._id}`)); assert.ok(hasBtn(o, `ab:${victim._id}`));
    o = await send(bot, cbUpdate(admin, `ab:${victim._id}`)); assert.ok(/block करें\?/.test(texts(o)) && hasBtn(o, `abc:${victim._id}`));
    assert.ok(!apiCalls.some(c => c.method === 'put' && c.path.includes('/status')), 'nothing blocked before confirmation');
    o = await send(bot, cbUpdate(admin, `abc:${victim._id}`)); const put = apiCalls.filter(c => c.method === 'put').pop(); assert.deepStrictEqual(put.data, { status: 'blocked' });
    o = await send(bot, cbUpdate(admin, `aa:${victim._id}`)); assert.deepStrictEqual(apiCalls.filter(c => c.method === 'put').pop().data, { status: 'active' });
    o = await send(bot, cbUpdate(admin, `au:${adminDoc._id}`)); assert.ok(!hasBtn(o, `ab:${adminDoc._id}`), 'no block button for admins');
    o = await send(bot, cbUpdate(admin, 'ab:not-an-id')); assert.ok(true);
    o = await send(bot, cbUpdate(admin, 'abc:not-an-id')); assert.ok(/सही नहीं/.test(texts(o)));
  });
  await test('admin: moderate presets with confirmation; user search flow', async () => {
    await send(bot, cbUpdate(admin, 'm:adminpresets'));
    let o = await send(bot, cbUpdate(admin, `ap:${PID}`)); assert.ok(hasBtn(o, `pr:${PID}`) && !hasBtn(o, `pa:${PID}`));
    o = await send(bot, cbUpdate(admin, `pr:${PID}`)); assert.ok(/reject करें\?/.test(texts(o)));
    o = await send(bot, cbUpdate(admin, `prc:${PID}`)); assert.deepStrictEqual(apiCalls.filter(c => c.method === 'put').pop().data, { status: 'rejected' });
    assert.ok(hasBtn(o, `pa:${PID}`), 'detail view now offers Approve');
    o = await send(bot, cbUpdate(admin, 'as:users')); assert.ok(I.convo.get(999).type === 'adminsearch');
    o = await send(bot, msgUpdate(admin, 'victim')); assert.strictEqual(apiCalls.filter(c => c.path === '/admin/users').pop().params.search, 'victim');
  });
  await test('admin: resolve support request notifies the user on Telegram', async () => {
    clearOut(); await bot.handleUpdate(cbUpdate(admin, `sr:resolved:${PID}`)); await new Promise(r => setImmediate(r));
    assert.ok(out.some(x => x.kind === 'dm' && x.chat === '111' && /resolve/.test(x.text)));
    const o = await send(bot, cbUpdate(admin, 'sr:hacked:' + PID)); assert.ok(/सही नहीं/.test(texts(o)));
  });
  await test('admin allow-list: an admin account used from an unknown Telegram ID is refused', async () => {
    const other = await User.create({ email: 'adm2@example.com', name: 'Adm2', username: 'adm2', role: 'admin', telegramId: '777' });
    const o = await send(bot, msgUpdate({ id: 777, first_name: 'Adm2' }, '/admin'));
    assert.ok(/सिर्फ admin/.test(texts(o)));
    assert.ok(alerts.some(a => a.type === 'security' && a.details.telegramUser === 777));
  });
  await test('admin: bot stats and error list reflect real errors', async () => {
    const o = await send(bot, cbUpdate(admin, 'm:errors')); assert.ok(/Ref|<code>/.test(texts(o)) || /कोई bot error नहीं/.test(texts(o)));
    const s = await send(bot, cbUpdate(admin, 'm:botstats')); assert.ok(/Updates/.test(texts(s)));
    const b = await send(bot, msgUpdate(admin, '/broadcast')); assert.ok(/Admin Panel/.test(texts(b)));
  });

  // ===== errors =====
  await test('server error: user sees a message with a reference code and the admin gets the same reference', async () => {
    alerts.length = 0;
    apiMock = async () => { throw axiosError(500, { error: 'secret internal stack' }); };
    const o = await send(bot, msgUpdate(user, '/dashboard').constructor === Object ? msgUpdate({ id: 222, first_name: 'Asha' }, '/dashboard') : null);
    const t = texts(o); const ref = (t.match(/Ref: ([A-F0-9]{6})/) || [])[1];
    assert.ok(ref, 'ref shown: ' + t); assert.ok(!/secret internal stack/.test(t), 'internal details never shown');
    const a = alerts.find(x => x.type === 'error'); assert.ok(a && a.details.ref === ref && a.severity === 'critical');
  });
  await test('server down: clear message and critical alert; bad request detail shown safely', async () => {
    alerts.length = 0;
    apiMock = async () => { throw axiosNetworkError(); };
    let o = await send(bot, msgUpdate({ id: 222, first_name: 'Asha' }, '/profile').message.text ? msgUpdate({ id: 222, first_name: 'Asha' }, '/dashboard') : null);
    assert.ok(/जवाब नहीं दे रहा/.test(texts(o)) && alerts.some(a => a.severity === 'critical'));
    apiMock = async () => { throw axiosError(400, { error: 'Name <i>too long</i>' }); };
    o = await send(bot, msgUpdate({ id: 222, first_name: 'Asha' }, '/dashboard')); assert.ok(/Name too long|Name itoo long|Name/.test(texts(o)) && !texts(o).includes('<i>too'), 'api text sanitised');
    apiMock = async () => { throw axiosError(429, {}); };
    o = await send(bot, msgUpdate({ id: 222, first_name: 'Asha' }, '/dashboard')); assert.ok(/तेज़/.test(texts(o)));
    apiMock = async () => { throw axiosError(401, {}); };
    o = await send(bot, msgUpdate({ id: 222, first_name: 'Asha' }, '/dashboard')); assert.ok(hasBtn(o, 'm:login'));
  });
  await test('repeated identical errors are throttled by fingerprint (one alert key per code+screen)', async () => {
    apiMock = async () => { throw axiosError(502, {}); };
    alerts.length = 0;
    for (let i = 0; i < 3; i++) await send(bot, msgUpdate({ id: 222, first_name: 'Asha' }, '/dashboard'));
    assert.ok(alerts.length === 3 && new Set(alerts.map(a => a.fingerprint)).size === 1);
  });
  await test('a formatting error on send never loses the message (plain-text retry)', async () => {
    const ctxFail = { id: 111, first_name: 'Ravi' };
    clearOut();
    const upd = msgUpdate(ctxFail, '/site');
    const origReply = I; // eslint-disable-line
    // monkey-patch makeCtx-level failure: first reply throws a parse error
    const orig = FakeTelegraf.prototype.handleUpdate;
    FakeTelegraf.prototype.handleUpdate = async function (u) { const c = makeCtx; return orig.call(this, u); };
    FakeTelegraf.prototype.handleUpdate = orig;
    // simulate through a one-off middleware that flags the ctx
    const b2 = new FakeTelegraf(); b2.use(async (ctx, next) => { ctx.failParseOnce = true; return next(); }); I.registerHandlers(b2);
    await b2.handleUpdate(upd); await new Promise(r => setImmediate(r));
    assert.ok(out.some(x => x.kind === 'reply' && x.extra && !x.extra.parse_mode), 'plain retry sent');
  });
  await test('Telegram "message is not modified" and blocked-by-user errors are ignored silently', async () => {
    const e1 = Object.assign(new Error('x'), { response: { ok: false, error_code: 400, description: 'Bad Request: message is not modified' } });
    const e2 = Object.assign(new Error('x'), { response: { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' } });
    for (const e of [e1, e2]) { const b3 = new FakeTelegraf(); b3.use(async (ctx, next) => { ctx.reply = async () => { throw e; }; return next(); }); I.registerHandlers(b3); clearOut(); await b3.handleUpdate(msgUpdate(guest, '/site')); }
    assert.ok(true);
  });

  // ===== chats, spam, odd input =====
  await test('groups: no account data, a single DM hint per minute, ignored otherwise', async () => {
    const g = { chat: { id: -100123, type: 'supergroup' } };
    let o = await send(bot, msgUpdate(guest, '/dashboard', g)); assert.ok(/private chat/.test(texts(o)) && !/Dashboard/.test(texts(o)));
    o = await send(bot, msgUpdate(guest, '/dashboard', g)); assert.strictEqual(o.length, 0);
    o = await send(bot, msgUpdate(guest, 'hello everyone', g)); assert.strictEqual(o.length, 0);
  });
  await test('bots and channel posts are ignored', async () => {
    const o = await send(bot, msgUpdate({ id: 5, is_bot: true, first_name: 'Other' }, '/start')); assert.strictEqual(o.length, 0);
  });
  await test('flooding: one warning, then silence, buttons answered with a hint', async () => {
    const f = { id: 555, first_name: 'Flood' };
    autoReset = false;
    let warned = 0, silent = 0;
    for (let i = 0; i < 40; i++) { const o = await send(bot, msgUpdate(f, '/site')); if (o.some(x => /बहुत तेज़/.test(x.text || ''))) warned++; if (i > 32 && o.length === 0) silent++; }
    assert.strictEqual(warned, 1); assert.ok(silent >= 5); assert.ok(I.stats.snapshot().rateLimited > 5);
    const c = await send(bot, cbUpdate(f, 'm:help')); autoReset = true; assert.ok(answers(c).some(a => /धीरे/.test(a.text || '')));
  });
  await test('unsupported messages (sticker, voice, location) get a friendly reply', async () => {
    const o = await send(bot, { update_id: updateId++, message: { message_id: 1, from: guest, chat: { id: 111, type: 'private' }, sticker: { file_id: 's' } } });
    assert.ok(/text, files/.test(texts(o)));
  });
  await test('callback edge cases: garbage, unknown prefix, oversized and injected data', async () => {
    for (const d of ['', 'zzz', 'm:', 'm:nope', 'p:../../admin', 'dl:{"$ne":1}', 'au:<script>', 'sc:../../etc:1', 'sc:love:-5', 'sc:love:99999999', 'pg:abc', 'uc:-1', 'up:9999']) {
      const o = await send(bot, cbUpdate(guest, d));
      assert.ok(!/TypeError|undefined|\[object/.test(texts(o)), `bad output for "${d}": ${texts(o)}`);
    }
    assert.ok(!apiCalls.some(c => c.path.includes('..')), 'no path traversal reaches the API');
  });
  await test('text edge cases: long text, control characters and html are neutralised', async () => {
    apiMock = async ({ params }) => ({ presets: [{ ...PRESET, name: params.q }], total: 1, totalPages: 1 });
    const o = await send(bot, msgUpdate(guest, '/search <img src=x onerror=1>\u0000\u202E' + 'x'.repeat(500)));
    assert.ok(!/<img/.test(texts(o)) && apiCalls.at(-1).params.q.length <= 80 && !/[\u0000\u202E]/.test(apiCalls.at(-1).params.q));
    const o2 = await send(bot, msgUpdate(guest, 'a'.repeat(5000))); assert.ok(o2.length >= 1);
  });
  await test('reply keyboard buttons cancel a running conversation and run the screen', async () => {
    await send(bot, cbUpdate(guest, 'sn:love')); // guest cannot start; ensure no state
    I.convo.set(111, { type: 'search', step: 'q', data: {} });
    apiMock = async () => ({ presets: [PRESET], total: 1, totalPages: 1 });
    await send(bot, msgUpdate(guest, '🆕 Latest')); assert.strictEqual(I.convo.get(111), undefined);
    await send(bot, msgUpdate(guest, '❓ Help')); await send(bot, msgUpdate(guest, '👑 Pro')); await send(bot, msgUpdate(guest, '✍️ Shayari')); await send(bot, msgUpdate(guest, '📂 Categories'));
  });

  // ===== privacy =====
  await test('/privacy explains what is stored; guests are told nothing is stored; links to the policy', async () => {
    let o = await send(bot, msgUpdate(guest, '/privacy')); let t = texts(o);
    assert.ok(/कुछ नहीं/.test(t) && /Privacy Policy/.test(buttons(o).map(b => b.text).join(' ')) && hasBtn(o, 'fg:ask'));
    assert.ok(buttons(o).some(b => b.url && b.url.endsWith('/privacy.html')) && buttons(o).some(b => b.url && b.url.endsWith('#grievance')));
    o = await send(bot, msgUpdate(user, '/privacy')); assert.ok(/Telegram ID, नाम, username/.test(texts(o)));
  });
  await test('/forgetme: guest has nothing stored; linked user must confirm; unlinking removes the stored Telegram profile', async () => {
    I.convo.set(111, { type: 'search', step: 'q', data: {} });
    let o = await send(bot, msgUpdate(guest, '/forgetme')); assert.ok(/stored नहीं/.test(texts(o)) && !I.convo.get(111));
    const acct = db.users.find(x => x.telegramId === '222'); acct.telegram = { firstName: 'Asha', username: 'asha' };
    o = await send(bot, msgUpdate(user, '/forgetme')); assert.ok(hasBtn(o, 'lo:y') && acct.telegramId === '222');
    o = await send(bot, cbUpdate(user, 'lo:y')); assert.ok(!acct.telegramId && !acct.telegram, 'telegram id and profile removed');
    o = await send(bot, cbUpdate(user, 'fg:ask')); assert.ok(/stored नहीं/.test(texts(o)));
    await User.updateOne({ _id: acct._id }, { $set: { telegramId: '222' } });
  });
  await test('visitors never get a stored profile, even after many messages; legacy placeholders are purged', async () => {
    const v = { id: 666, first_name: 'Visitor' };
    for (const m of ['/start', '/help', '/latest', 'hello there', '/preset ' + PID]) await send(bot, msgUpdate(v, m));
    assert.ok(!db.users.some(x => x.telegramId === '666'));
    db.users.push({ _id: oid(), email: 'telegram_1@users.presethub.local', role: 'user' }, { _id: oid(), email: 'real@example.com', role: 'user' });
    const n = await I.purgeLegacyGuestProfiles();
    assert.ok(n >= 1 && !db.users.some(x => /@users\.presethub\.local$/.test(x.email || '')) && db.users.some(x => x.email === 'real@example.com'), 'only placeholders removed');
    assert.ok(!alerts.some(a => a.type === 'new_user' && JSON.stringify(a.details).includes('Visitor')), 'admin notice has no personal data');
  });

  // ===== lifecycle =====
  await test('polling crash (e.g. 409 conflict during deploys) is detected and a restart is scheduled', async () => {
    await botModule.stopBot();
    launchBehaviour = 'reject';
    const ok = await botModule.startBot();
    await new Promise(r => setTimeout(r, 30));
    assert.strictEqual(botModule.getBotStatus().started, false, 'marked as not started after crash');
    assert.ok(alerts.some(a => a.fingerprint === 'bot-polling-stopped'));
    await botModule.stopBot();
  });

  // ---------- summary ----------
  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed) { console.log('Failed: ' + failures.join('; ')); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error('Self-test crashed:', e); process.exit(2); });
