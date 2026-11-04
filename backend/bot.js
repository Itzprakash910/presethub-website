'use strict';
/**
 * PresetHub Telegram bot v2 (runs inside the web server).
 *
 * Design
 *  - ONE command registry (COMMANDS) drives: command handlers, /help, the Telegram "/" menu,
 *    "did you mean" suggestions and the inline buttons (callback "m:<command>").
 *  - Every handler runs inside guard(): errors are classified (utils/botKit.js), the user gets a clear message
 *    with a reference code, and serious errors are sent to the admin (Telegram + in-app + email) with that same reference.
 *  - Security rules: private chats only, per-user rate limits, validated IDs, sanitised text, HTML-escaped output,
 *    admin = role + optional ADMIN_TELEGRAM_IDS allow-list, confirmation before destructive admin actions,
 *    link codes are hashed, attempt-limited, and the user's /link message is deleted.
 *  - Paid presets are bought on the website (payments never happen inside Telegram).
 */
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const K = require('./utils/botKit');
const { User, SupportRequest, TextPost, AlertLog, TEXT_CATEGORIES } = require('./models');
const { getPlans } = require('./utils/plans');
const { adminAlert, getDbUsage } = require('./utils/alerts');
const { connectDB } = require('./config/db');

const { h, clean, cut } = K;

// ====================================================================================
// Config
// ====================================================================================
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ADMIN_CHAT_ID = String(process.env.ADMIN_CHAT_ID || '').trim();
// Admin commands need role=admin AND (if any ID is configured) a Telegram ID from this allow-list.
const ADMIN_IDS = new Set([ADMIN_CHAT_ID, ...String(process.env.ADMIN_TELEGRAM_IDS || '').split(',')].map(s => s.trim()).filter(Boolean));
const SITE_URL = (process.env.CLIENT_URL || 'https://presethub.site').replace(/\/+$/, '');
const API_BASE = (process.env.API_BASE || `${SITE_URL}/api`).replace(/\/+$/, '');

const PAGE_SIZE = 8;
const TG_DOWNLOAD_LIMIT = 20 * 1024 * 1024;   // Telegram: bots can download files up to 20 MB
const TG_SEND_LIMIT = 49 * 1024 * 1024;       // Telegram: bots can send files up to 50 MB
const PRESET_EXTS = ['.xmp', '.dng', '.lrtemplate', '.cube', '.3dl', '.look', '.costyle', '.xml', '.json', '.zip'];
const LIMITS = {
  events: [30, 30 * 1000],        // any update
  heavy: [6, 60 * 1000],          // downloads / uploads
  writes: [12, 60 * 1000],        // likes, saves, posts
  search: [15, 60 * 1000],
  link: [5, 10 * 60 * 1000]       // /link attempts per Telegram user
};
const SUPPORT_PER_HOUR = 3;
const PRICE_CHOICES = [0, 29, 49, 99];

// ====================================================================================
// State (in memory; safe to lose on restart)
// ====================================================================================
const convo = new K.TtlStore(20 * 60 * 1000);   // chatId -> { type, step, data }
const lists = new K.TtlStore(30 * 60 * 1000);   // chatId -> list context for paging/filters
const picks = new K.TtlStore(30 * 60 * 1000);   // chatId -> temporary lookup tables (categories, admin items)
const limiter = new K.RateLimiter();
const stats = new K.BotStats();
const lastTouch = new Map();
const globalLink = { n: 0, first: Date.now() };

let bot = null;
let botStarted = false;
let botStarting = false;
let botStopping = false;
let botUsername = '';
let restartTimer = null;
let restartAttempt = 0;

// ====================================================================================
// Small UI helpers
// ====================================================================================
const HTML = { parse_mode: 'HTML', disable_web_page_preview: true };
const cb = (text, data) => {
  if (Buffer.byteLength(data) > 64) throw new Error(`callback_data too long: ${data}`);
  return Markup.button.callback(text, data);
};
const urlBtn = (text, url) => (K.isButtonUrl(url) ? Markup.button.url(text, url) : null);
const kb = rows => Markup.inlineKeyboard(rows.map(r => r.filter(Boolean)).filter(r => r.length));
const homeBtn = () => cb('🏠 Menu', 'm:menu');
const presetUrl = (id, name) => `${SITE_URL}/preset/${id}/${name ? K.slugify(name) + '/' : ''}`;
const maskEmail = e => { const [u = '', d = ''] = String(e || '').split('@'); return u ? `${u.slice(0, 2)}${'•'.repeat(Math.max(2, Math.min(6, u.length - 2)))}@${d}` : '—'; };
const stripUrlOrigin = u => String(u || '').replace(/^https?:\/\//, '');

const MENU = {
  search: '🔍 Search', latest: '🆕 Latest', trending: '🔥 Trending', categories: '📂 Categories',
  shayari: '✍️ Shayari', pro: '👑 Pro', account: '🏠 My Account', upload: '📤 Upload', help: '❓ Help', admin: '🛠️ Admin Panel'
};
function mainMenu(user) {
  const rows = [
    [MENU.search, MENU.latest], [MENU.trending, MENU.categories],
    [MENU.shayari, MENU.pro], [MENU.account, MENU.upload], [MENU.help]
  ];
  if (user && user.role === 'admin' && accountState(user) === 'linked') rows[4].push(MENU.admin);
  const k = Markup.keyboard(rows).resize();
  return typeof k.placeholder === 'function' ? k.placeholder('Search presets or tap a button…') : k;
}

async function reply(ctx, html, extra = {}) {
  const opts = { ...HTML, ...extra };
  try { return await ctx.reply(html, opts); }
  catch (e) {
    if (/can't parse entities|unsupported start tag|can't find end tag/i.test(String(e.description || e.message))) {
      const { parse_mode, ...rest } = opts; // never lose a message because of formatting
      return ctx.reply(K.stripTags(html), rest);
    }
    throw e;
  }
}
// For navigation: edit the current message when the tap came from a text message, otherwise send a new one.
async function show(ctx, html, extra = {}) {
  const m = ctx.callbackQuery && ctx.callbackQuery.message;
  if (m && typeof m.text === 'string') {
    try { return await ctx.editMessageText(html, { ...HTML, ...extra }); }
    catch (e) {
      const d = String(e.description || e.message || '');
      if (/message is not modified/i.test(d)) return null;
    }
  }
  return reply(ctx, html, extra);
}
async function replyChunks(ctx, lines, extraLast = {}) {
  const chunks = K.chunkLines(lines, 3800);
  for (let i = 0; i < chunks.length; i++) await reply(ctx, chunks[i], i === chunks.length - 1 ? extraLast : {});
}
const typing = (ctx, action = 'typing') => { try { const p = ctx.sendChatAction && ctx.sendChatAction(action); if (p && p.catch) p.catch(() => {}); } catch (_) {} };
async function toast(ctx, text = '', alert = false) {
  if (!ctx.callbackQuery || ctx.state.answered) return;
  ctx.state.answered = true;
  try { await ctx.answerCbQuery(text ? cut(text, 190) : undefined, alert ? { show_alert: true } : undefined); } catch (_) {}
}
// Replaces the label of one inline button (used for ❤️ / 🔖 toggles) without re-sending the message.
async function patchButton(ctx, prefix, label) {
  try {
    const rows = ctx.callbackQuery.message.reply_markup.inline_keyboard.map(r => r.map(b => (b.callback_data && b.callback_data.startsWith(prefix) ? { ...b, text: label } : b)));
    await ctx.editMessageReplyMarkup({ inline_keyboard: rows });
  } catch (_) { /* message too old / not modified: harmless */ }
}

// ====================================================================================
// Accounts, auth and API access
// ====================================================================================
function accountState(u) {
  if (!u || !u.email || /@users\.presethub\.local$/i.test(u.email)) return 'guest';
  if (u.status === 'blocked') return 'blocked';
  if (u.status === 'deactivated') return 'deactivated';
  return 'linked';
}
const isLinked = u => accountState(u) === 'linked';

// The bot runs inside the web server, so it signs a short-lived JWT for the linked account itself.
function apiHeaders(user) {
  if (!isLinked(user) || !process.env.JWT_SECRET) return {};
  const token = jwt.sign({ purpose: 'bot', id: String(user._id), email: user.email, role: user.role, ver: Number(user.sessionVersion || 0) }, process.env.JWT_SECRET, { expiresIn: '10m', algorithm: 'HS256' });
  return { Authorization: `Bearer ${token}` };
}
async function api(ctx, method, url, { data, params, auth = true, timeout = 20000 } = {}) {
  const headers = auth ? apiHeaders(ctx.dbUser) : {};
  if (auth && !headers.Authorization) throw new K.BotError('AUTH_REQUIRED');
  const r = await axios({ method, url: `${API_BASE}${url}`, data, params, headers, timeout, validateStatus: s => s >= 200 && s < 300 });
  return r.data;
}

const TG_PROFILE = f => ({ firstName: f.first_name || '', lastName: f.last_name || '', username: f.username || '', languageCode: f.language_code || '' });
const USER_FIELDS = 'name username email role status verified telegramId telegram sessionVersion subscription createdAt';

// Loads the linked PresetHub account for this Telegram ID, or null.
// Data minimisation: people who have only chatted with the bot get NO stored profile; messages are processed to reply only.
const knownVisitors = new Set();
async function loadUser(ctx) {
  const tid = String(ctx.from.id);
  const user = await User.findOne({ telegramId: tid }).select(USER_FIELDS).sort({ updatedAt: -1 }).lean();
  if (user) {
    const now = Date.now();
    if (!lastTouch.has(tid) || now - lastTouch.get(tid) > 60 * 1000) { // at most one write per minute per user
      lastTouch.set(tid, now);
      if (lastTouch.size > 20000) lastTouch.clear();
      User.updateOne({ _id: user._id }, { $set: { telegram: TG_PROFILE(ctx.from), lastActive: new Date() }, $inc: { commandsCount: 1 } }).catch(() => {});
    }
  }
  ctx.state.newUser = !user && !knownVisitors.has(tid);
  if (!user) { knownVisitors.add(tid); if (knownVisitors.size > 20000) knownVisitors.clear(); }
  return user || null;
}
// Old versions stored a placeholder profile for every visitor. They hold nothing useful, so they are deleted.
async function purgeLegacyGuestProfiles() {
  try {
    const r = await User.deleteMany({ role: 'user', email: /@users\.presethub\.local$/i });
    if (r && r.deletedCount) console.log(`🧹 Removed ${r.deletedCount} legacy Telegram guest profiles.`);
    return (r && r.deletedCount) || 0;
  } catch (e) { console.warn('Guest profile purge failed:', e.message); return 0; }
}
async function linkTelegramId(userId, ctx) {
  const tid = String(ctx.from.id);
  // Drop the auto-created placeholder and detach any other account that held this Telegram ID.
  await User.deleteMany({ _id: { $ne: userId }, telegramId: tid, email: /@users\.presethub\.local$/i });
  await User.updateMany({ _id: { $ne: userId }, telegramId: tid }, { $unset: { telegramId: 1 } });
  await User.updateOne({ _id: userId }, { $set: { telegramId: tid, telegram: TG_PROFILE(ctx.from), lastActive: new Date() } });
}
const unlinkTelegramId = tid => User.updateOne({ telegramId: String(tid) }, { $unset: { telegramId: 1, telegram: 1, token: 1 } });

function adminAllowed(ctx) {
  return ADMIN_IDS.size === 0 || ADMIN_IDS.has(String(ctx.from.id)) || (ctx.chat && ADMIN_IDS.has(String(ctx.chat.id)));
}
async function requireLogin(ctx) {
  const s = accountState(ctx.dbUser);
  if (s === 'linked') return true;
  await toast(ctx);
  if (s === 'blocked' || s === 'deactivated') {
    await reply(ctx, `${K.MSG.ACCOUNT_BLOCKED}`, kb([[cb('🆘 Block review माँगें', 'ah:block_review')], [homeBtn()]]));
  } else {
    await reply(ctx, `${K.MSG.AUTH_REQUIRED}\n\nLink करने में 1 मिनट लगता है।`, kb([[cb('🔗 Account link करें', 'm:login')], [urlBtn('📝 Sign up', `${SITE_URL}/?action=signup`)], [homeBtn()]]));
  }
  return false;
}
async function requireAdmin(ctx) {
  if (!(await requireLogin(ctx))) return false;
  if (ctx.dbUser.role !== 'admin' || !adminAllowed(ctx)) {
    await toast(ctx, '⛔ Admin only', true);
    await reply(ctx, K.MSG.ADMIN_ONLY);
    adminAlert({ type: 'security', severity: 'warning', title: 'Telegram bot: admin command attempted by a non-admin', fingerprint: `bot-admin-denied:${ctx.from.id}`, throttleMs: 60 * 60 * 1000, email: false, details: { telegramUser: ctx.from.id, username: ctx.from.username || '', role: ctx.dbUser.role, command: cut(ctx.message && ctx.message.text || (ctx.callbackQuery && ctx.callbackQuery.data) || '', 60) } });
    return false;
  }
  return true;
}

// ====================================================================================
// Error handling (user message + admin report, same reference code)
// ====================================================================================
async function handleError(ctx, err, where) {
  const info = K.classifyError(err);
  const ref = K.newRef();
  stats.recordError(info.code, where, ref, err && err.message);
  try { await toast(ctx); } catch (_) {}
  if (info.ignore) return;
  console.error(`[bot ${ref}] ${where} -> ${info.code}${info.status ? ' ' + info.status : ''}: ${String(err && err.message).slice(0, 200)}`);
  if (info.report) {
    adminAlert({
      type: 'error', severity: info.severity === 'critical' ? 'critical' : 'warning',
      title: `Telegram bot: ${info.code} in ${where}`, fingerprint: `bot:${info.code}:${where}`, email: info.severity === 'critical',
      details: { ref, where, code: info.code, httpStatus: info.status || '', telegramUser: ctx.from && ctx.from.id, account: ctx.dbUser && ctx.dbUser.username || '', message: String(err && err.message || '').slice(0, 200), stack: String(err && err.stack || '').split('\n').slice(1, 4).join(' | ').slice(0, 400) }
    });
  }
  let text = info.userMessage || K.MSG.INTERNAL;
  if (info.detail && !['UPSTREAM_ERROR', 'UPSTREAM_DOWN', 'DB_ERROR', 'INTERNAL'].includes(info.code)) text += `\n<i>${h(info.detail)}</i>`;
  if (info.code === 'USAGE' && err.extra && err.extra.usage) text += `\n\n<b>Usage:</b> <code>${h(err.extra.usage)}</code>${err.extra.example ? `\n<b>Example:</b> <code>${h(err.extra.example)}</code>` : ''}`;
  if (info.report) text += `\n\n<code>Ref: ${ref}</code>`;
  const rows = [];
  if (info.code === 'AUTH_REQUIRED' || info.code === 'AUTH_EXPIRED') rows.push([cb('🔗 Account link करें', 'm:login')]);
  rows.push([homeBtn()]);
  try { await reply(ctx, text, kb(rows)); } catch (_) { /* user may have blocked the bot */ }
}
const guard = (where, fn) => async (ctx, ...rest) => {
  try { return await fn(ctx, ...rest); }
  catch (err) { return handleError(ctx, err, where); }
};

// ====================================================================================
// Welcome, hub, help
// ====================================================================================
async function sendWelcome(ctx, payload = '') {
  const state = accountState(ctx.dbUser);
  const name = h(clean(ctx.from.first_name || 'दोस्त', 40));
  if (/^preset_[a-f0-9]{24}$/i.test(payload)) return sendPresetCard(ctx, payload.slice(7));

  const feats = [
    '🔍 Presets खोजें, preview देखें और download करें',
    '🔥 Trending, नए और free presets',
    '✍️ Shayari पढ़ें, copy और share करें',
    '📤 अपने presets upload करें और कमाएँ',
    '👑 Pro: ads नहीं, Pro badge, bulk download और priority support'
  ];
  let text, rows;
  if (state === 'linked') {
    text = [`🎨 <b>वापसी पर स्वागत है, ${name}!</b>`, '', 'आपका account linked है। नीचे से सीधे काम शुरू करें 👇', '', ...feats.slice(0, 3).map(x => '• ' + x)].join('\n');
    rows = [
      [cb('🏠 My Account', 'm:account'), cb('🔍 Search', 'm:search')],
      [cb('🆕 Latest', 'm:latest'), cb('🔥 Trending', 'm:trending')],
      [cb('📤 Upload', 'm:upload'), cb('✍️ Shayari', 'm:shayari')],
      [cb('👑 Pro', 'm:pro'), cb('❓ Help', 'm:help')]
    ];
    if (ctx.dbUser.role === 'admin' && adminAllowed(ctx)) rows.push([cb('🛠️ Admin Panel', 'm:admin')]);
  } else if (state === 'blocked' || state === 'deactivated') {
    text = [`🎨 <b>PresetHub</b>`, '', K.MSG.ACCOUNT_BLOCKED].join('\n');
    rows = [[cb('🆘 Block review माँगें', 'ah:block_review')], [urlBtn('🌐 Website', SITE_URL)]];
  } else {
    text = [
      `🎨 <b>PresetHub में आपका स्वागत है, ${name}!</b>`, '',
      'Lightroom presets, shayari और creator tools — सब एक जगह।', '',
      '<b>आप यहाँ क्या कर सकते हैं</b>', ...feats, '',
      '🔐 Download, upload और account tools के लिए पहले अपना account link करें (सिर्फ 1 मिनट)।', '',
      '🔒 Account link किए बिना हम आपका कोई profile store नहीं करते। Details: /privacy'
    ].join('\n');
    rows = [
      [cb('🔗 Account link करें', 'm:login'), urlBtn('📝 Sign up', `${SITE_URL}/?action=signup`)],
      [cb('🆕 Presets देखें', 'm:latest'), cb('🔥 Trending', 'm:trending')],
      [cb('✍️ Shayari', 'm:shayari'), cb('👑 Pro', 'm:pro')],
      [cb('❓ Help', 'm:help'), cb('🔒 Privacy', 'm:privacy')],
      [urlBtn('🌐 Website', SITE_URL)]
    ];
  }
  await reply(ctx, text, kb(rows));
  await reply(ctx, '👇 नीचे का menu हमेशा उपलब्ध है। Preset का नाम सीधे लिखकर भी search कर सकते हैं।', mainMenu(ctx.dbUser));
  if (ctx.state.newUser && ADMIN_CHAT_ID && String(ctx.chat.id) !== ADMIN_CHAT_ID) {
    adminAlert({ type: 'new_user', severity: 'info', title: 'New Telegram bot visitor', fingerprint: `bot-new:${ctx.from.id}`, throttleMs: 30 * 24 * 60 * 60 * 1000, email: false, details: { note: 'No personal data is stored for visitors who do not link an account.' } });
  }
}

async function showHub(ctx) {
  if (isLinked(ctx.dbUser)) return showAccountHub(ctx);
  await show(ctx, '🏠 <b>PresetHub Menu</b>\n\nBrowse करने के लिए account की ज़रूरत नहीं। Download, upload और account tools के लिए link करें।', kb([
    [cb('🔍 Search', 'm:search'), cb('🆕 Latest', 'm:latest')],
    [cb('🔥 Trending', 'm:trending'), cb('🆓 Free', 'm:free')],
    [cb('📂 Categories', 'm:categories'), cb('🏆 Top creators', 'm:top')],
    [cb('✍️ Shayari', 'm:shayari'), cb('👑 Pro', 'm:pro')],
    [cb('🔗 Account link करें', 'm:login'), cb('❓ Help', 'm:help')]
  ]));
}
async function showAccountHub(ctx) {
  if (!(await requireLogin(ctx))) return;
  const u = ctx.dbUser;
  const rows = [
    [cb('📊 Dashboard', 'm:dashboard'), cb('👤 Profile', 'm:profile')],
    [cb('📦 My Presets', 'm:mypresets'), cb('⬇️ Downloads', 'm:downloads')],
    [cb('🔖 Saved', 'm:wishlist'), cb('🛒 Orders', 'm:myorders')],
    [cb('🔔 Notifications', 'm:notifications'), cb('💰 Earnings', 'm:earnings')],
    [cb('👑 Subscription', 'm:subscription'), cb('🎁 Referral', 'm:referral')],
    [cb('📤 Upload', 'm:upload'), cb('🆘 Account help', 'm:accounthelp')],
    [cb('🔌 Unlink Telegram', 'm:logout'), cb('🔍 Search', 'm:search')]
  ];
  if (u.role === 'admin' && adminAllowed(ctx)) rows.push([cb('🛠️ Admin Panel', 'm:admin')]);
  await show(ctx, `🏠 <b>My Account</b>\n\n👤 ${h(u.name)} · @${h(u.username || 'user')}\nकिस काम के लिए खोल रहे हैं?`, kb(rows));
}

const GROUP_TITLES = { browse: '🔍 Browse & Search', account: '👤 My Account', creator: '🎨 Creator Tools', shayari: '✍️ Shayari', pro: '👑 Pro', help: '🆘 Help & Account', admin: '🛠️ Admin' };
async function showHelp(ctx, p) {
  const arg = (p.args[0] || '').replace(/^\//, '').toLowerCase();
  if (arg) {
    const spec = findSpec(arg);
    if (!spec || (spec.admin && !(ctx.dbUser && ctx.dbUser.role === 'admin'))) throw new K.BotError('NOT_FOUND', 'यह command मौजूद नहीं है। /help देखें।');
    return reply(ctx, [`<b>/${spec.name}</b> — ${h(spec.desc)}`, spec.usage ? `\n<b>Usage:</b> <code>${h(spec.usage)}</code>` : '', spec.example ? `<b>Example:</b> <code>${h(spec.example)}</code>` : '', spec.aliases && spec.aliases.length ? `<b>Aliases:</b> ${spec.aliases.map(a => '/' + a).join(', ')}` : '', spec.login ? '🔐 Account link ज़रूरी' : ''].filter(Boolean).join('\n'), kb([[homeBtn()]]));
  }
  const isAdmin = ctx.dbUser && ctx.dbUser.role === 'admin' && isLinked(ctx.dbUser) && adminAllowed(ctx);
  const lines = ['❓ <b>PresetHub Help</b>', 'ज़्यादातर काम buttons से हो जाते हैं। Commands भी चलते हैं:', ''];
  for (const g of Object.keys(GROUP_TITLES)) {
    if (g === 'admin' && !isAdmin) continue;
    const items = COMMANDS.filter(c => c.group === g && !c.hidden);
    if (!items.length) continue;
    lines.push(`<b>${GROUP_TITLES[g]}</b>`);
    for (const c of items) lines.push(`/${c.name}${c.usage ? ' ' + h(c.usage.replace(/^\/\w+\s*/, '')) : ''} — ${h(c.desc)}`);
    lines.push('');
  }
  lines.push('ℹ️ किसी command की detail: <code>/help search</code>');
  await replyChunks(ctx, lines, kb([[cb('🏠 Menu', 'm:menu'), cb('🆘 Account help', 'm:accounthelp')], [urlBtn('🌐 Website', SITE_URL)]]));
}

// ====================================================================================
// Presets: lists, cards, actions
// ====================================================================================
const statusIcon = s => ({ approved: '✅', pending: '⏳', rejected: '❌' }[s] || '•');

async function openList(ctx, spec, page = 1) {
  typing(ctx);
  const data = await api(ctx, 'get', '/presets', { params: { ...spec.params, page, limit: PAGE_SIZE }, auth: false });
  const items = Array.isArray(data) ? data : (data.presets || []);
  const total = Number(data.total != null ? data.total : items.length);
  const totalPages = Math.max(1, Number(data.totalPages || Math.ceil(total / PAGE_SIZE) || 1));
  lists.set(ctx.chat.id, { ...spec, page, totalPages });
  if (!items.length) {
    return show(ctx, `😕 <b>${h(spec.title)}</b>\n\nकोई preset नहीं मिला।${spec.browse ? '' : '\nकिसी दूसरे शब्द से try करें।'}`, kb([[cb('📂 Categories', 'm:categories'), cb('🔍 नया search', 'm:search')], [homeBtn()]]));
  }
  const lines = [`<b>${h(spec.title)}</b> · page ${page}/${totalPages} · ${total} presets`, ''];
  items.forEach((p, i) => lines.push(`<b>${i + 1}.</b> ${h(cut(p.name, 40))} — ${K.fmtMoney(p.price)} · ${K.rating(p.avgRating)}\n     👤 ${h(cut(p.author || 'Creator', 24))} · ⬇️ ${K.compact(p.downloads)}`));
  const nums = items.map((p, i) => cb(String(i + 1), `p:${p.id}`));
  const rows = [];
  for (let i = 0; i < nums.length; i += 4) rows.push(nums.slice(i, i + 4));
  const nav = [];
  if (page > 1) nav.push(cb('⬅️ Prev', `pg:${page - 1}`));
  nav.push(cb(`${page}/${totalPages}`, 'noop'));
  if (page < totalPages) nav.push(cb('Next ➡️', `pg:${page + 1}`));
  rows.push(nav);
  if (spec.browse) {
    const pr = spec.params.price || 'all', so = spec.params.sort || 'newest';
    rows.push([cb(`${pr === 'all' ? '✓ ' : ''}All`, 'fl:all'), cb(`${pr === 'free' ? '✓ ' : ''}🆓 Free`, 'fl:free'), cb(`${pr === 'paid' ? '✓ ' : ''}💎 Paid`, 'fl:paid')]);
    rows.push([cb(`${so === 'newest' ? '✓ ' : ''}🆕 New`, 'so:newest'), cb(`${so === 'popular' ? '✓ ' : ''}🔥 Popular`, 'so:popular'), cb(`${so === 'rating' ? '✓ ' : ''}⭐ Rated`, 'so:rating')]);
  }
  rows.push([cb('🔍 Search', 'm:search'), homeBtn()]);
  await show(ctx, lines.join('\n'), kb(rows));
}
const browseList = (title, params) => ({ title, params, browse: true });

async function sendPresetCard(ctx, id) {
  if (!K.isObjectId(id)) throw new K.BotError('USAGE', 'Preset ID सही नहीं है।', { usage: '/preset <id>' });
  typing(ctx);
  const p = await api(ctx, 'get', `/presets/${id}`, { auth: false });
  const meta = [`🎨 <b>${h(cut(p.name, 100))}</b>`, `👤 ${h(cut(p.author || 'Creator', 60))} · 📂 ${h(cut(p.category || 'General', 40))}`, `💰 <b>${K.fmtMoney(p.price)}</b>   ${K.rating(p.avgRating)}`, `👁 ${K.compact(p.views)} · ⬇️ ${K.compact(p.downloads)} · ❤️ ${K.compact(p.likesCount)}`];
  const desc = p.description ? `\n${h(cut(clean(p.description, 300), 140))}` : '';
  let caption = meta.join('\n') + desc;
  if (caption.length > 1000) caption = meta.join('\n');
  const paid = Number(p.price) > 0;
  const keyboard = kb([
    [cb(paid ? `⬇️ Get ${K.fmtMoney(p.price)}` : '⬇️ Download', `dl:${p.id}`), cb('❤️ Like', `lk:${p.id}`), cb('🔖 Save', `ws:${p.id}`)],
    [cb('🔗 Share', `sh:${p.id}`), urlBtn('🌐 Open', presetUrl(p.id, p.name))]
  ]);
  await toast(ctx);
  if (p.previewImage && K.isButtonUrl(p.previewImage) && caption.length <= 1000) {
    try { return await ctx.replyWithPhoto(p.previewImage, { caption, ...HTML, ...keyboard }); } catch (_) { /* preview not reachable: send text card */ }
  }
  return reply(ctx, caption, keyboard);
}

async function downloadPreset(ctx, id) {
  if (!K.isObjectId(id)) throw new K.BotError('USAGE', 'Preset ID सही नहीं है।', { usage: '/download <id>' });
  if (!(await requireLogin(ctx))) return;
  const rl = limiter.hit(`dl:${ctx.from.id}`, ...LIMITS.heavy);
  if (!rl.ok) throw new K.BotError('RATE_LIMITED', `करीब ${Math.ceil(rl.retryAfterMs / 1000)} सेकंड बाद फिर try करें।`);
  await toast(ctx, '⬇️ Download तैयार हो रहा है…');
  typing(ctx, 'upload_document');
  let ticket;
  try { ticket = await api(ctx, 'post', `/presets/${id}/download`, { data: {} }); }
  catch (err) {
    if (err.response && err.response.status === 403) {
      return reply(ctx, '🔒 <b>यह paid preset है</b>\n\nPayment website पर होता है। खरीदने के बाद यहाँ से download कर पाएँगे।', kb([[urlBtn('🛒 Website पर खरीदें', presetUrl(id))], [cb('🔙 Preset', `p:${id}`), homeBtn()]]));
    }
    throw err;
  }
  if (!ticket || !ticket.downloadUrl) throw new K.BotError('NOT_FOUND', 'Download link उपलब्ध नहीं है।');
  let file;
  try { file = await axios.get(ticket.downloadUrl, { responseType: 'arraybuffer', timeout: 60000, maxContentLength: TG_SEND_LIMIT, maxBodyLength: TG_SEND_LIMIT }); }
  catch (err) {
    if (/maxContentLength|maxBodyLength/i.test(String(err.message))) {
      return reply(ctx, '📦 File Telegram की 50 MB limit से बड़ी है। Website से download करें।', kb([[urlBtn('🌐 Website पर खोलें', presetUrl(id))]]));
    }
    throw err;
  }
  const filename = K.safeFilename(ticket.originalName, `presethub-${id}.xmp`);
  await ctx.replyWithDocument({ source: Buffer.from(file.data), filename }, { caption: '✅ <b>Preset download हो गया</b>\nLightroom में import करके use करें।', ...HTML, ...kb([[cb('❤️ Like', `lk:${id}`), cb('🔗 Share', `sh:${id}`)], [homeBtn()]]) });
}

async function writeLimit(ctx) {
  const rl = limiter.hit(`w:${ctx.from.id}`, ...LIMITS.writes);
  if (!rl.ok) throw new K.BotError('RATE_LIMITED', `करीब ${Math.ceil(rl.retryAfterMs / 1000)} सेकंड बाद फिर try करें।`);
}
async function likePreset(ctx, id) {
  if (!K.isObjectId(id)) return toast(ctx, 'Invalid preset');
  if (!isLinked(ctx.dbUser)) return toast(ctx, '🔐 Like करने के लिए account link करें (/login)', true);
  await writeLimit(ctx);
  const r = await api(ctx, 'post', `/presets/${id}/like`, { data: {} });
  await toast(ctx, r.liked ? '❤️ Liked' : '💔 Like हटाया');
  await patchButton(ctx, 'lk:', `${r.liked ? '💖 Liked' : '❤️ Like'}${r.likes ? ' ' + K.compact(r.likes) : ''}`);
}
async function savePreset(ctx, id) {
  if (!K.isObjectId(id)) return toast(ctx, 'Invalid preset');
  if (!isLinked(ctx.dbUser)) return toast(ctx, '🔐 Save करने के लिए account link करें (/login)', true);
  await writeLimit(ctx);
  const r = await api(ctx, 'post', `/users/me/wishlist/${id}`, { data: {} });
  const saved = (r.wishlist || []).includes(id);
  await toast(ctx, saved ? '🔖 Saved' : 'Saved list से हटाया');
  await patchButton(ctx, 'ws:', saved ? '✅ Saved' : '🔖 Save');
}
async function sharePreset(ctx, id) {
  if (!K.isObjectId(id)) throw new K.BotError('USAGE', 'Preset ID सही नहीं है।', { usage: '/share <id>' });
  if (!(await requireLogin(ctx))) return;
  await writeLimit(ctx);
  await toast(ctx);
  const r = await api(ctx, 'post', '/share/create', { data: { presetId: id, platform: 'telegram' } });
  const link = r.shortUrl || r.fullUrl;
  const tgShare = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('🎨 Lightroom preset देखें — PresetHub')}`;
  await reply(ctx, `🔗 <b>आपका share link</b>\n\n<code>${h(link)}</code>\n\nLink पर tap करके copy करें।`, kb([[urlBtn('📤 Telegram पर share करें', tgShare)], [cb('🔙 Preset', `p:${id}`), homeBtn()]]));
}

// Non-paged list of presets (my presets, downloads, saved)
async function presetListView(ctx, title, items, { empty, extra = [] } = {}) {
  if (!items.length) return show(ctx, `${title}\n\n${empty}`, kb([...extra, [homeBtn()]]));
  const shown = items.slice(0, PAGE_SIZE);
  const lines = [`${title} · ${items.length}`, ''];
  shown.forEach((p, i) => lines.push(`<b>${i + 1}.</b> ${p.status ? statusIcon(p.status) + ' ' : ''}${h(cut(p.name, 40))} — ${K.fmtMoney(p.price)}${p.downloads != null ? ' · ⬇️ ' + K.compact(p.downloads) : ''}`));
  if (items.length > shown.length) lines.push('', `…और ${items.length - shown.length}। पूरी list website पर देखें।`);
  const nums = shown.map((p, i) => cb(String(i + 1), `p:${p.id}`));
  const rows = [];
  for (let i = 0; i < nums.length; i += 4) rows.push(nums.slice(i, i + 4));
  await show(ctx, lines.join('\n'), kb([...rows, ...extra, [homeBtn()]]));
}

// ====================================================================================
// Account screens
// ====================================================================================
async function showDashboard(ctx) {
  const d = await api(ctx, 'get', '/users/me/dashboard');
  const s = d.stats || {};
  const text = [
    `📊 <b>Dashboard</b>`, `👤 ${h(d.user && d.user.name)} · @${h(d.user && d.user.username || 'user')}`, '',
    `📦 My presets: <b>${(d.presets || []).length}</b>`, `⬇️ आपके downloads: <b>${d.downloads || 0}</b>`,
    `👥 Followers: <b>${d.followers || 0}</b> · Following: <b>${d.following || 0}</b>`, `🔔 Unread: <b>${d.unreadNotifications || 0}</b>`, '',
    `<b>आपके presets के stats</b>`, `⬇️ ${K.compact(s.downloads)} · 👁 ${K.compact(s.views)} · ❤️ ${K.compact(s.likes)} · ↗️ ${K.compact(s.shares)}`
  ].join('\n');
  await show(ctx, text, kb([[cb('📦 My Presets', 'm:mypresets'), cb('⬇️ Downloads', 'm:downloads')], [cb(`🔔 Notifications${d.unreadNotifications ? ' (' + d.unreadNotifications + ')' : ''}`, 'm:notifications'), cb('💰 Earnings', 'm:earnings')], [cb('📤 Upload', 'm:upload'), homeBtn()]]));
}
async function showProfile(ctx) {
  const u = ctx.dbUser;
  const proUntil = u.subscription && u.subscription.expiry && new Date(u.subscription.expiry) > new Date() ? K.fmtDate(u.subscription.expiry) : '';
  await show(ctx, [
    '👤 <b>Profile</b>', '',
    `नाम: <b>${h(u.name)}</b>`, `Username: @${h(u.username || 'user')}`, `Email: ${h(maskEmail(u.email))}`,
    `Role: ${h(u.role)}${u.verified ? ' ✅ verified' : ''}`, `Pro: ${proUntil ? '👑 ' + proUntil + ' तक' : 'Free plan'}`,
    `Telegram: @${h(u.telegram && u.telegram.username || ctx.from.username || 'private')}`,
    `Member since: ${K.fmtDate(u.createdAt)}`
  ].join('\n'), kb([[urlBtn('✏️ Website पर edit करें', `${SITE_URL}/?action=login`)], [cb('🔌 Unlink Telegram', 'm:logout'), homeBtn()]]));
}
async function showMyPresets(ctx) {
  const d = await api(ctx, 'get', '/users/me/dashboard');
  await presetListView(ctx, '📦 <b>My Presets</b>', d.presets || [], { empty: 'आपने अभी कोई preset upload नहीं किया।', extra: [[cb('📤 Upload करें', 'm:upload')]] });
}
async function showDownloads(ctx) {
  const rows = await api(ctx, 'get', '/users/me/downloads');
  await presetListView(ctx, '⬇️ <b>My Downloads</b>', Array.isArray(rows) ? rows : [], { empty: 'अभी कोई preset download नहीं किया।', extra: [[cb('🆕 Latest देखें', 'm:latest')]] });
}
async function showWishlist(ctx) {
  const rows = await api(ctx, 'get', '/users/me/wishlist/presets');
  await presetListView(ctx, '🔖 <b>Saved presets</b>', Array.isArray(rows) ? rows : [], { empty: 'कोई preset save नहीं किया। Preset card पर 🔖 Save दबाएँ।', extra: [[cb('🔥 Trending', 'm:trending')]] });
}
async function showNotifications(ctx) {
  const rows = await api(ctx, 'get', '/users/me/notifications');
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return show(ctx, '🔔 <b>Notifications</b>\n\nअभी कोई notification नहीं है।', kb([[homeBtn()]]));
  const lines = ['🔔 <b>Notifications</b>', '', ...list.slice(0, 10).map(n => `${n.read ? '✓' : '•'} ${h(cut(clean(n.message, 300), 200))}\n   <i>${K.fmtDateTime(n.createdAt)}</i>`)];
  await show(ctx, K.chunkLines(lines)[0], kb([[cb('🔄 Refresh', 'm:notifications'), homeBtn()]]));
  api(ctx, 'post', '/users/notifications/read-all', { data: {} }).catch(() => {});
}
async function showOrders(ctx) {
  const rows = await api(ctx, 'get', '/payments/my-orders');
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return show(ctx, '🛒 <b>My Orders</b>\n\nअभी कोई order नहीं है।', kb([[cb('🔥 Trending', 'm:trending'), homeBtn()]]));
  const icon = { paid: '✅', created: '⏳', failed: '❌', refunded: '↩️', expired: '⌛', suspicious: '⚠️' };
  const lines = ['🛒 <b>My Orders</b>', '', ...list.slice(0, 10).map(o => `${icon[o.status] || '•'} ${h(o.kind === 'subscription' ? 'Pro ' + (o.plan || '') : o.kind)} · ${K.fmtRupees(o.amount)} · ${K.fmtDate(o.createdAt)}${o.presetId ? `\n   /preset ${o.presetId}` : ''}`)];
  if (list.length > 10) lines.push('', `…और ${list.length - 10} orders website पर।`);
  await show(ctx, K.chunkLines(lines)[0], kb([[homeBtn()]]));
}
async function showSubscription(ctx) {
  const r = await api(ctx, 'get', '/users/me/subscription');
  if (r.isPro) {
    return show(ctx, `👑 <b>आप Pro हैं</b>\n\nPlan: ${h(r.plan || 'Pro')}\nValid till: <b>${K.fmtDate(r.expiry)}</b>\n\nRenew या plan बदलने के लिए website खोलें।`, kb([[urlBtn('🔄 Renew / Upgrade', SITE_URL)], [homeBtn()]]));
  }
  await show(ctx, '👑 <b>आप अभी Free plan पर हैं</b>\n\nPro लेने पर: ads नहीं, Pro badge, bulk download और priority support।', kb([[cb('👑 Pro plans देखें', 'm:pro')], [homeBtn()]]));
}
async function showReferral(ctx) {
  const r = await api(ctx, 'post', '/users/referrals/generate', { data: {} });
  const code = r.referralCode || r.code;
  if (!code) throw new K.BotError('NOT_FOUND', 'Referral code नहीं मिला।');
  const tgShare = `https://t.me/share/url?url=${encodeURIComponent(SITE_URL)}&text=${encodeURIComponent(`PresetHub join करें और मेरा referral code use करें: ${code}`)}`;
  await show(ctx, `🎁 <b>आपका referral code</b>\n\n<code>${h(code)}</code>\n\nदोस्त signup के समय यह code डालें — दोनों को reward मिलता है।`, kb([[urlBtn('📤 दोस्तों को भेजें', tgShare)], [homeBtn()]]));
}
async function showEarnings(ctx) {
  const d = await api(ctx, 'get', '/creator/dashboard');
  const m = d.money || {}, t = d.totals || {};
  const pays = (d.payouts || []).slice(0, 3).map(p => `• ${K.fmtRupees(p.amount)} — ${h(p.status)} (${K.fmtDate(p.createdAt)})`);
  await show(ctx, [
    '💰 <b>Creator Earnings</b>', '',
    `कुल कमाई: <b>${K.fmtRupees(m.earned)}</b>`, `✅ Withdraw के लिए ready: <b>${K.fmtRupees(m.available)}</b>`, `⏳ Pending: ${K.fmtRupees(m.pending)}`, `💸 Paid out: ${K.fmtRupees(m.paid)}`, '',
    `🛍 Sales: ${m.sales ? m.sales.count : 0} · 💝 Tips: ${m.tips ? m.tips.count : 0}`, `📦 Presets: ${t.presets || 0} · ⬇️ ${K.compact(t.downloads)} · 👁 ${K.compact(t.presetViews)}`,
    pays.length ? `\n<b>Latest payouts</b>\n${pays.join('\n')}` : '',
    `\nMinimum payout: ${K.fmtRupees(m.minPayout)} (आपका हिस्सा ${m.sharePercent || 80}%)`, 'Payout request और bank/UPI details सुरक्षा के लिए सिर्फ website पर होते हैं.'
  ].filter(x => x !== '').join('\n'), kb([[urlBtn('💳 Payout request (website)', `${SITE_URL}/creator.html`)], [homeBtn()]]));
}

// ====================================================================================
// Privacy
// ====================================================================================
async function showPrivacy(ctx) {
  const linked = isLinked(ctx.dbUser);
  const lines = [
    '🔒 <b>Privacy — PresetHub bot</b>', '',
    '<b>हम क्या store करते हैं</b>',
    linked ? '• आपके account से जुड़ा Telegram ID, नाम, username, भाषा और last activity का समय (bot चलाने के लिए)।' : '• Account link किए बिना: <b>कुछ नहीं</b>। Messages सिर्फ जवाब देने के लिए process होते हैं।',
    '• Support request भेजने पर: आपका Telegram ID, नाम और message (1 साल बाद अपने आप हटते हैं)।', '',
    '<b>आपके अधिकार</b>', '• Access, correction, erasure: website पर Profile से, या support@presethub.site',
    '• Telegram data हटाने के लिए /forgetme', '• Account पूरा delete करने के लिए website पर Profile → Delete account', '',
    'Payment कभी Telegram में नहीं होता; सिर्फ website पर होता है।'
  ];
  await show(ctx, lines.join('\n'), kb([[urlBtn('📜 Privacy Policy', `${SITE_URL}/privacy.html`), urlBtn('📧 Grievance / Contact', `${SITE_URL}/privacy.html#grievance`)], [cb('🗑 मेरा Telegram data हटाएँ', 'fg:ask'), homeBtn()]]));
}
async function forgetMe(ctx) {
  convo.delete(ctx.chat.id); lists.delete(ctx.chat.id); picks.delete(ctx.chat.id);
  if (!isLinked(ctx.dbUser)) {
    return show(ctx, '✅ <b>आपका कोई Telegram data हमारे पास stored नहीं है।</b>\n\nइस chat की temporary state अभी साफ़ कर दी गई है। Support request हटवाने के लिए support@presethub.site पर लिखें।', kb([[homeBtn()]]));
  }
  await show(ctx, '🗑 <b>Telegram data हटाएँ?</b>\n\nइससे इस Telegram chat का link और आपके account पर stored Telegram profile (ID, नाम, username) हट जाएगा। आपका PresetHub account बना रहेगा। Account पूरा delete करने के लिए website पर Profile → Delete account।', kb([[cb('✅ हाँ, हटाएँ', 'lo:y'), cb('✖ रहने दें', 'lo:n')]]));
}

// ====================================================================================
// Link / unlink
// ====================================================================================
async function showLogin(ctx) {
  if (isLinked(ctx.dbUser)) return show(ctx, '✅ आपका account पहले से linked है।', kb([[cb('🏠 My Account', 'm:account')]]));
  await show(ctx, [
    '🔐 <b>Telegram को account से जोड़ें</b>', '',
    `1️⃣ Website पर login करें (account नहीं है तो Sign up)`, '2️⃣ Profile → <b>Telegram link code</b> दबाएँ', '3️⃣ यहाँ भेजें: <code>/link 123456</code>', '',
    '⏱ Code कुछ मिनट में expire हो जाता है। Code किसी को न बताएँ।'
  ].join('\n'), kb([[urlBtn('🌐 Login करें', `${SITE_URL}/?action=login`), urlBtn('📝 Sign up', `${SITE_URL}/?action=signup`)], [homeBtn()]]));
}
async function linkAccount(ctx, p) {
  const code = (p.args[0] || '').replace(/\D/g, '');
  // The message holds a one-time secret: remove it from the chat as soon as we have read it.
  try { await ctx.deleteMessage(); } catch (_) {}
  if (!/^\d{6}$/.test(code)) throw new K.BotError('USAGE', 'Code 6 अंकों का होना चाहिए।', { usage: '/link 123456', example: '/link 482913' });
  if (isLinked(ctx.dbUser)) return reply(ctx, '✅ आपका account पहले से linked है। दूसरा account जोड़ने के लिए पहले /logout करें।', mainMenu(ctx.dbUser));
  const now = Date.now();
  const rl = limiter.hit(`link:${ctx.from.id}`, ...LIMITS.link);
  if (!rl.ok) throw new K.BotError('RATE_LIMITED', `बहुत ज़्यादा कोशिशें। ${Math.ceil(rl.retryAfterMs / 60000)} मिनट बाद फिर try करें।`);
  // Global ceiling stops guessing the 6-digit code from many throw-away Telegram accounts.
  if (now - globalLink.first > 10 * 60 * 1000) { globalLink.n = 0; globalLink.first = now; }
  if (++globalLink.n > 40) throw new K.BotError('RATE_LIMITED', 'Linking अभी busy है। कुछ मिनट बाद फिर try करें।');
  const hash = crypto.createHash('sha256').update(code).digest('hex');
  const u = await User.findOne({ botLinkHash: hash, botLinkExpires: { $gt: new Date() }, status: 'active' }).select('name email username role').lean();
  if (!u) return reply(ctx, '❌ Code गलत है या expire हो चुका है। Website से नया code बनाएँ।', kb([[cb('ℹ️ Code कैसे मिलेगा', 'm:login')]]));
  await linkTelegramId(u._id, ctx);
  await User.updateOne({ _id: u._id }, { $unset: { botLinkHash: 1, botLinkExpires: 1 } });
  ctx.dbUser = await User.findOne({ telegramId: String(ctx.from.id) }).select(USER_FIELDS).lean();
  limiter.m.delete(`link:${ctx.from.id}`);
  await reply(ctx, `✅ <b>Account linked!</b>\n\n👤 ${h(clean(u.name || u.username, 60))}\n\nअब download, upload और account tools इस्तेमाल कर सकते हैं।`, mainMenu(ctx.dbUser));
  await reply(ctx, 'आगे क्या करें?', kb([[cb('🏠 My Account', 'm:account'), cb('🔍 Search', 'm:search')], [cb('📤 Upload', 'm:upload'), cb('🆕 Latest', 'm:latest')]]));
}
async function askLogout(ctx) {
  if (!isLinked(ctx.dbUser)) return show(ctx, 'आप linked नहीं हैं।', kb([[cb('🔗 Account link करें', 'm:login')]]));
  await show(ctx, '🔌 <b>Telegram unlink करें?</b>\n\nआपका PresetHub account सुरक्षित रहेगा; सिर्फ यह Telegram chat उससे अलग होगा।', kb([[cb('✅ हाँ, unlink करें', 'lo:y'), cb('✖ रहने दें', 'lo:n')]]));
}

// ====================================================================================
// Upload wizard
// ====================================================================================
async function startUpload(ctx) {
  if (!(await requireLogin(ctx))) return;
  convo.set(ctx.chat.id, { type: 'upload', step: 'name', data: {} });
  await reply(ctx, '📤 <b>Preset Upload</b> (1/7)\n\nPreset का <b>नाम</b> भेजें।\n<i>Cancel: /cancel</i>', kb([[cb('✖ Cancel', 'cv:cancel')]]));
}
async function askCategory(ctx) {
  let cats = [];
  try { const r = await api(ctx, 'get', '/presets/categories', { auth: false }); cats = (Array.isArray(r) ? r : []).map(x => (Array.isArray(x) ? x[0] : x)).filter(Boolean).slice(0, 8).map(c => cut(String(c), 24)); } catch (_) { /* typed category is still possible */ }
  if (!cats.includes('General')) cats.push('General');
  picks.set(ctx.chat.id, { ...(picks.get(ctx.chat.id) || {}), cats });
  const rows = [];
  for (let i = 0; i < cats.length; i += 2) rows.push(cats.slice(i, i + 2).map((c, j) => cb(c, `uc:${i + j}`)));
  rows.push([cb('✖ Cancel', 'cv:cancel')]);
  await reply(ctx, '📂 <b>Category</b> (2/7)\n\nनीचे से चुनें या अपनी category लिखकर भेजें।', kb(rows));
}
async function askPrice(ctx) {
  const row = PRICE_CHOICES.map(v => cb(v === 0 ? '🆓 Free' : `₹${v}`, `up:${v}`));
  await reply(ctx, '💰 <b>Price</b> (3/7)\n\nFree रखें, चुनें या अपनी price (₹) लिखकर भेजें।\n<i>Paid presets की sale 80% creator share के साथ होती है।</i>', kb([row, [cb('✖ Cancel', 'cv:cancel')]]));
}
async function askDescription(ctx) {
  await reply(ctx, '📝 <b>Description</b> (4/7)\n\nPreset के बारे में 1-2 line लिखें।', kb([[cb('⏭ Skip', 'us:desc'), cb('✖ Cancel', 'cv:cancel')]]));
}
async function askTags(ctx) {
  await reply(ctx, '🏷 <b>Tags</b> (5/7)\n\nComma से अलग करके लिखें (जैसे: <code>sunset, warm, travel</code>)।', kb([[cb('⏭ Skip', 'us:tags'), cb('✖ Cancel', 'cv:cancel')]]));
}
async function askFile(ctx) {
  await reply(ctx, `📎 <b>Preset file</b> (6/7)\n\nFile को <b>Document</b> की तरह भेजें।\nAllowed: ${PRESET_EXTS.join(' ')}\nMax size: 20 MB (Telegram limit). बड़ी file website से upload करें।`, kb([[cb('✖ Cancel', 'cv:cancel')]]));
}
async function askPreview(ctx) {
  await reply(ctx, '🖼 <b>Preview image</b> (7/7)\n\nBefore/after या result की एक photo भेजें।', kb([[cb('⏭ Skip', 'us:preview'), cb('✖ Cancel', 'cv:cancel')]]));
}
async function askConfirm(ctx, st) {
  const d = st.data;
  st.step = 'confirm';
  await reply(ctx, [
    '✅ <b>Upload से पहले जाँच लें</b>', '',
    `🎨 ${h(d.name)}`, `📂 ${h(d.category)}`, `💰 ${K.fmtMoney(d.price)}`, `📝 ${h(cut(d.description || '—', 120))}`, `🏷 ${h(d.tags || '—')}`,
    `📎 ${h(d.fileName)} (${(d.fileBuffer.length / 1024).toFixed(0)} KB)`, `🖼 Preview: ${d.previewBuffer ? 'हाँ' : 'नहीं'}`
  ].join('\n'), kb([[cb('🚀 Publish', 'uf:ok'), cb('✖ Cancel', 'cv:cancel')]]));
}
async function finishUpload(ctx) {
  const st = convo.get(ctx.chat.id);
  if (!st || st.type !== 'upload' || !st.data.fileBuffer) throw new K.BotError('NOT_FOUND', 'Upload session खत्म हो गया। /upload से फिर शुरू करें।');
  const rl = limiter.hit(`up:${ctx.from.id}`, ...LIMITS.heavy);
  if (!rl.ok) throw new K.BotError('RATE_LIMITED', `करीब ${Math.ceil(rl.retryAfterMs / 1000)} सेकंड बाद फिर try करें।`);
  const d = st.data;
  const form = new FormData();
  form.append('name', d.name); form.append('category', d.category || 'General'); form.append('price', String(d.price || 0));
  form.append('description', d.description || ''); form.append('tags', d.tags || '');
  form.append('uploadId', `tg-${ctx.from.id}-${Date.now()}`);
  form.append('file', d.fileBuffer, { filename: d.fileName, contentType: d.fileMime || 'application/octet-stream' });
  if (d.previewBuffer) form.append('previewImage', d.previewBuffer, { filename: d.previewName || 'preview.jpg', contentType: d.previewMime || 'image/jpeg' });
  typing(ctx, 'upload_document');
  await reply(ctx, '⏳ Preset server पर upload हो रहा है…');
  const r = await axios.post(`${API_BASE}/presets`, form, { headers: { ...form.getHeaders(), ...apiHeaders(ctx.dbUser) }, maxContentLength: Infinity, maxBodyLength: Infinity, timeout: 120000 });
  convo.delete(ctx.chat.id);
  const id = r.data.id;
  await reply(ctx, `🎉 <b>Upload complete!</b>\n\n🎨 ${h(r.data.name)}\n📂 ${h(r.data.category)} · 💰 ${K.fmtMoney(r.data.price)}`, kb([[cb('👁 Preset देखें', `p:${id}`), cb('🔗 Share', `sh:${id}`)], [cb('📤 एक और upload', 'm:upload'), homeBtn()]]));
}

async function convoCancel(ctx, silent = false) {
  const had = convo.get(ctx.chat.id);
  convo.delete(ctx.chat.id);
  if (!silent) await reply(ctx, had ? '✖ Cancel कर दिया।' : 'कोई action चल नहीं रहा था।', mainMenu(ctx.dbUser));
}

// Text typed while a conversation (search / upload / post / support) is active
async function handleConvoText(ctx, st, text) {
  convo.touch(ctx.chat.id);
  const d = st.data;
  if (st.type === 'search') { convo.delete(ctx.chat.id); return doSearch(ctx, text); }
  if (st.type === 'support') { convo.delete(ctx.chat.id); return submitSupport(ctx, 'other', text); }
  if (st.type === 'shayari') {
    if (st.step === 'text') {
      if (text.length < 5) return reply(ctx, '✍️ कम से कम 5 अक्षर लिखें।');
      d.text = clean(text, 2000);
      return reply(ctx, `✍️ <b>Post preview</b>\n\n${h(cut(d.text, 600))}\n\n#${h(d.category)}`, kb([[cb('🚀 Post करें', 'sf:ok'), cb('✖ Cancel', 'cv:cancel')]]));
    }
    return reply(ctx, 'ऊपर के buttons से category चुनें।');
  }
  if (st.type === 'adminsearch') { convo.delete(ctx.chat.id); return adminUsers(ctx, text); }
  if (st.type === 'upload') {
    switch (st.step) {
      case 'name': if (text.length < 2) return reply(ctx, '❌ नाम कम से कम 2 अक्षर का हो।'); d.name = clean(text, 100); st.step = 'category'; return askCategory(ctx);
      case 'category': d.category = clean(text, 40) || 'General'; st.step = 'price'; return askPrice(ctx);
      case 'price': { const n = Number(text.replace(/[₹,\s]/g, '')); if (!Number.isFinite(n) || n < 0 || n > 999999) return reply(ctx, '❌ सही price भेजें, जैसे 0 या 49।'); d.price = Math.round(n * 100) / 100; st.step = 'description'; return askDescription(ctx); }
      case 'description': d.description = clean(text, 500); st.step = 'tags'; return askTags(ctx);
      case 'tags': d.tags = text.split(',').map(t => clean(t, 30).toLowerCase()).filter(Boolean).slice(0, 10).join(','); st.step = 'file'; return askFile(ctx);
      case 'file': return reply(ctx, '📎 अब preset file को <b>Document</b> की तरह भेजें (text नहीं)।');
      case 'preview': return reply(ctx, '🖼 Photo भेजें, या Skip दबाएँ।', kb([[cb('⏭ Skip', 'us:preview')]]));
      case 'confirm': return reply(ctx, 'ऊपर के buttons से Publish या Cancel चुनें।');
      default: return;
    }
  }
}
async function downloadTelegramFile(ctx, fileId, maxBytes) {
  const link = await ctx.telegram.getFileLink(fileId);
  const r = await axios.get(String(link), { responseType: 'arraybuffer', timeout: 120000, maxContentLength: maxBytes, maxBodyLength: maxBytes });
  return Buffer.from(r.data);
}

// ====================================================================================
// Search & categories
// ====================================================================================
async function searchPrompt(ctx) {
  convo.set(ctx.chat.id, { type: 'search', step: 'q', data: {} });
  await reply(ctx, '🔍 <b>क्या खोजना है?</b>\n\nPreset का नाम, creator या tag लिखकर भेजें।\nजैसे: <code>sunset</code>, <code>moody</code>, <code>wedding</code>', kb([[cb('📂 Categories', 'm:categories'), cb('✖ Cancel', 'cv:cancel')]]));
}
async function doSearch(ctx, raw) {
  const q = clean(raw, 80);
  if (q.length < 2) throw new K.BotError('USAGE', 'कम से कम 2 अक्षर लिखें।', { usage: '/search <शब्द>', example: '/search sunset' });
  const rl = limiter.hit(`s:${ctx.from.id}`, ...LIMITS.search);
  if (!rl.ok) throw new K.BotError('RATE_LIMITED', `करीब ${Math.ceil(rl.retryAfterMs / 1000)} सेकंड बाद फिर search करें।`);
  await openList(ctx, { title: `🔍 “${q}”`, params: { q }, browse: false });
}
async function showCategories(ctx) {
  const r = await api(ctx, 'get', '/presets/categories', { auth: false });
  const cats = (Array.isArray(r) ? r : []).map(x => (Array.isArray(x) ? { name: x[0], count: x[1] } : { name: x })).filter(c => c.name).slice(0, 24);
  if (!cats.length) return show(ctx, '📂 अभी कोई category नहीं है।', kb([[homeBtn()]]));
  picks.set(ctx.chat.id, { ...(picks.get(ctx.chat.id) || {}), browseCats: cats.map(c => String(c.name)) });
  const rows = [];
  for (let i = 0; i < cats.length; i += 2) rows.push(cats.slice(i, i + 2).map((c, j) => cb(cut(`${c.name}${c.count ? ' (' + c.count + ')' : ''}`, 26), `bc:${i + j}`)));
  rows.push([homeBtn()]);
  await show(ctx, '📂 <b>Categories</b>\n\nकोई category चुनें 👇', kb(rows));
}

async function showTop(ctx) {
  const r = await api(ctx, 'get', '/users/top', { auth: false });
  const rows = (Array.isArray(r) ? r : []).slice(0, 10);
  if (!rows.length) return show(ctx, '🏆 अभी कोई data नहीं है।', kb([[homeBtn()]]));
  const lines = ['🏆 <b>Top Creators</b>', '', ...rows.map((u, i) => `${['🥇', '🥈', '🥉'][i] || (i + 1) + '.'} ${u.id ? `<a href="${h(SITE_URL)}/profile/${h(u.id)}">${h(cut(u.name || u.username, 30))}</a>` : h(cut(u.name || u.username, 30))} — ${u.presetCount || 0} presets · ⬇️ ${K.compact(u.totalDownloads)}`)];
  await show(ctx, lines.join('\n'), kb([[cb('🔥 Trending presets', 'm:trending'), homeBtn()]]));
}

// ====================================================================================
// Shayari
// ====================================================================================
async function shayariCategories(ctx) {
  const rows = [];
  for (let i = 0; i < TEXT_CATEGORIES.length; i += 3) rows.push(TEXT_CATEGORIES.slice(i, i + 3).map(c => cb(cut(c, 14), `sc:${c}:1`)));
  rows.unshift([cb('🆕 Latest सब', 'sc:all:1')]);
  rows.push([cb('✍️ Shayari post करें', 'sn:start'), homeBtn()]);
  await show(ctx, '✍️ <b>Shayari</b>\n\nCategory चुनें 👇', kb(rows));
}
async function sendTexts(ctx, cat, page = 1) {
  const filter = { status: 'approved', ...(cat && cat !== 'all' ? { category: cat } : {}) };
  if (cat && cat !== 'all' && !TEXT_CATEGORIES.includes(cat)) throw new K.BotError('NOT_FOUND', 'Category नहीं मिली। /shayari देखें।');
  page = Math.max(1, Math.min(200, Number(page) || 1));
  const rows = await TextPost.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 5).limit(6).lean();
  const more = rows.length > 5;
  const items = rows.slice(0, 5);
  await toast(ctx);
  if (!items.length) return reply(ctx, `😕 कोई post नहीं मिला।\nपहली shayari आप डालें 👇`, kb([[cb('✍️ Post करें', 'sn:start'), cb('📂 Categories', 'm:shayari')]]));
  for (const t of items) {
    await reply(ctx, `${t.title ? `<b>${h(t.title)}</b>\n\n` : ''}${h(cut(t.text, 1500))}\n\n— ${h(t.author)} · #${h(t.category)}\n❤️ ${(t.likes || []).length}  📋 ${t.copies || 0}  ↗️ ${t.shares || 0}`, kb([[cb('❤️ Like', `tl:${t._id}`), cb('📋 Copy', `tc:${t._id}`), urlBtn('🔗 Open', `${SITE_URL}/shayari/${t._id}/`)]]));
  }
  await reply(ctx, '👇', kb([[more ? cb('➡️ और दिखाएँ', `sc:${cat || 'all'}:${page + 1}`) : null, cb('📂 Categories', 'm:shayari')], [cb('✍️ Post करें', 'sn:start'), homeBtn()]]));
}
async function startShayariPost(ctx, cat) {
  if (!(await requireLogin(ctx))) return;
  if (!cat) {
    const rows = [];
    for (let i = 0; i < TEXT_CATEGORIES.length; i += 3) rows.push(TEXT_CATEGORIES.slice(i, i + 3).map(c => cb(cut(c, 14), `sn:${c}`)));
    rows.push([cb('✖ Cancel', 'cv:cancel')]);
    return reply(ctx, '✍️ <b>Shayari post</b>\n\nपहले category चुनें 👇', kb(rows));
  }
  if (!TEXT_CATEGORIES.includes(cat)) throw new K.BotError('NOT_FOUND', 'Category नहीं मिली।');
  convo.set(ctx.chat.id, { type: 'shayari', step: 'text', data: { category: cat } });
  await reply(ctx, `✍️ <b>#${h(cat)}</b>\n\nअपनी shayari / text भेजें (5-2000 अक्षर)।`, kb([[cb('✖ Cancel', 'cv:cancel')]]));
}

// ====================================================================================
// Pro
// ====================================================================================
async function showPro(ctx) {
  const plans = Object.values(getPlans());
  await show(ctx, [
    '👑 <b>PresetHub Pro</b>', '',
    ...plans.map(p => `• <b>${h(p.label)}</b>: ₹${p.price} / ${p.days} दिन${p.badge ? ' — ' + h(p.badge) : ''}`), '',
    '✅ Zero ads', '✅ Pro badge', '✅ Bulk download (एक बार में 30)', '✅ Priority support', '✅ Pro themes', '',
    'Payment सुरक्षित रूप से website पर होता है; Pro तुरंत चालू हो जाता है।'
  ].join('\n'), kb([[urlBtn('👑 Website पर Pro लें', SITE_URL)], [isLinked(ctx.dbUser) ? cb('👑 मेरा plan', 'm:subscription') : cb('🔗 Account link करें', 'm:login'), homeBtn()]]));
}

// ====================================================================================
// Account help (support requests to the admin)
// ====================================================================================
const SUPPORT_LABEL = { password_reset: 'Password reset', delete_account: 'Account delete', account_access: 'Account access', block_review: 'Block review', other: 'Other' };
async function accountHelpMenu(ctx) {
  await show(ctx, '🆘 <b>Account help</b>\n\nकिस बारे में मदद चाहिए?', kb([
    [cb('🔑 Password भूल गया', 'ah:password_reset'), cb('🚪 Login नहीं हो रहा', 'ah:account_access')],
    [cb('🚫 Account blocked है', 'ah:block_review'), cb('🗑 Account delete', 'ah:delete_account')],
    [cb('💬 कुछ और (लिखकर)', 'ah:other'), homeBtn()]
  ]));
}
async function submitSupport(ctx, type, message) {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await SupportRequest.countDocuments({ telegramId: String(ctx.from.id), createdAt: { $gte: since } });
  if (recent >= SUPPORT_PER_HOUR) throw new K.BotError('RATE_LIMITED', 'आपकी requests पहले ही admin तक पहुँच चुकी हैं। कृपया जवाब का इंतज़ार करें।');
  const u = ctx.dbUser;
  const text = clean(message || 'User requested help from Telegram.', 1000);
  const reqDoc = await SupportRequest.create({ userId: isLinked(u) ? u._id : (u && u._id) || null, telegramId: String(ctx.from.id), name: clean((u && u.name) || ctx.from.first_name || 'Telegram User', 100), email: (u && u.email && !/@users\.presethub\.local$/i.test(u.email)) ? u.email : '', type, message: text });
  if (ADMIN_CHAT_ID && bot) {
    const lines = ['🆘 <b>Account request</b>', '', `Type: <b>${SUPPORT_LABEL[type] || 'Help'}</b>`, `User: ${h(clean(u && u.name || ctx.from.first_name, 60))}`, `Telegram: <code>${ctx.from.id}</code>${ctx.from.username ? ' @' + h(ctx.from.username) : ''}`, `Email: ${h(maskEmail(u && u.email))}`, '', h(cut(text, 500))];
    bot.telegram.sendMessage(ADMIN_CHAT_ID, lines.join('\n'), { ...HTML, ...kb([[cb('📋 Open requests', 'm:support')]]) }).catch(() => {});
  }
  await reply(ctx, `✅ <b>Request admin को भेज दी गई</b>\n\nType: ${SUPPORT_LABEL[type] || 'Help'}\nRef: <code>${String(reqDoc._id).slice(-6).toUpperCase()}</code>\n\nजवाब Telegram या email पर मिलेगा।`, kb([[homeBtn()]]));
}

// ====================================================================================
// Admin
// ====================================================================================
const pickItems = d => (d && (d.items || d.users || d.presets)) || (Array.isArray(d) ? d : []);
async function adminDashboard(ctx) {
  if (!(await requireAdmin(ctx))) return;
  const d = await api(ctx, 'get', '/admin/analytics');
  await show(ctx, [
    '🛠️ <b>Admin Panel</b>', '',
    `👥 Users: <b>${d.totalUsers || 0}</b>`, `📦 Presets: <b>${d.totalPresets || 0}</b>`, `⬇️ Downloads: <b>${K.compact(d.totalDownloads)}</b>`,
    `👁 Views: <b>${K.compact(d.totalViews)}</b> · ❤️ Likes: <b>${K.compact(d.totalLikes)}</b>`
  ].join('\n'), kb([
    [cb('👥 Users', 'm:adminusers'), cb('📦 Presets', 'm:adminpresets')],
    [cb('🆘 Support', 'm:support'), cb('🚨 Alerts', 'm:alerts')],
    [cb('⚙️ System', 'm:system'), cb('🐞 Bot errors', 'm:errors')],
    [cb('📈 Bot stats', 'm:botstats'), cb('🔄 Refresh', 'm:admin')],
    [urlBtn('🌐 Web admin panel', `${SITE_URL}/admin`), homeBtn()]
  ]));
}
async function adminUsers(ctx, query = '') {
  if (!(await requireAdmin(ctx))) return;
  const q = clean(query, 60);
  const d = await api(ctx, 'get', '/admin/users', { params: { limit: PAGE_SIZE, page: 1, ...(q ? { search: q } : {}) } });
  const users = pickItems(d);
  if (!users.length) return show(ctx, `👥 कोई user नहीं मिला${q ? ` “${h(q)}”` : ''}।`, kb([[cb('🔍 User खोजें', 'as:users'), cb('🛠️ Admin', 'm:admin')]]));
  picks.set(ctx.chat.id, { ...(picks.get(ctx.chat.id) || {}), adminUsers: Object.fromEntries(users.map(u => [String(u.id || u._id), true])) });
  const lines = [`👥 <b>Users</b>${q ? ` — “${h(q)}”` : ''} · ${d.total || users.length}`, '', ...users.map((u, i) => `<b>${i + 1}.</b> ${u.role === 'admin' ? '👑' : '👤'} ${h(cut(u.name || u.username, 24))} · @${h(u.username || '-')} ${u.status && u.status !== 'active' ? '· 🚫 ' + h(u.status) : ''}`)];
  const nums = users.map((u, i) => cb(String(i + 1), `au:${u.id || u._id}`));
  const rows = [];
  for (let i = 0; i < nums.length; i += 4) rows.push(nums.slice(i, i + 4));
  rows.push([cb('🔍 User खोजें', 'as:users'), cb('🛠️ Admin', 'm:admin')]);
  await show(ctx, lines.join('\n'), kb(rows));
}
async function adminUserDetails(ctx, id) {
  if (!(await requireAdmin(ctx))) return;
  if (!K.isObjectId(id)) throw new K.BotError('USAGE', 'User ID सही नहीं है।');
  const r = await api(ctx, 'get', `/admin/users/${id}/details`);
  const u = r.user || r;
  const blocked = u.status === 'blocked';
  const rows = [];
  if (u.role !== 'admin') rows.push([blocked ? cb('✅ Unblock', `aa:${id}`) : cb('🚫 Block', `ab:${id}`)]);
  rows.push([cb('🔙 Users', 'm:adminusers'), cb('🛠️ Admin', 'm:admin')]);
  await show(ctx, [
    '👤 <b>User details</b>', '',
    `नाम: <b>${h(u.name)}</b>`, `Username: @${h(u.username || '-')}`, `Email: ${h(u.email)}`, `Role: ${h(u.role)} · Status: <b>${h(u.status)}</b>`,
    `Verified: ${u.verified ? 'Yes' : 'No'} · Telegram: ${u.telegramId ? 'Linked' : 'No'}`, `Joined: ${K.fmtDate(u.createdAt)}`,
    r.profile ? `Followers: ${r.profile.followers || 0} · Wishlist: ${r.profile.wishlist || 0}` : ''
  ].filter(Boolean).join('\n'), kb(rows));
}
async function adminSetUserStatus(ctx, id, status) {
  if (!(await requireAdmin(ctx))) return;
  if (!K.isObjectId(id)) throw new K.BotError('USAGE', 'User ID सही नहीं है।');
  await api(ctx, 'put', `/admin/users/${id}/status`, { data: { status } });
  await toast(ctx, status === 'blocked' ? '🚫 User blocked' : '✅ User unblocked');
  return adminUserDetails(ctx, id);
}
async function adminPresets(ctx, filter = '') {
  if (!(await requireAdmin(ctx))) return;
  const params = { limit: PAGE_SIZE, page: 1 };
  if (['approved', 'rejected'].includes(filter)) params.status = filter;
  const d = await api(ctx, 'get', '/admin/presets', { params });
  const items = pickItems(d);
  if (!items.length) return show(ctx, '📦 कोई preset नहीं मिला।', kb([[cb('🛠️ Admin', 'm:admin')]]));
  picks.set(ctx.chat.id, { ...(picks.get(ctx.chat.id) || {}), adminPresets: Object.fromEntries(items.map(p => [String(p.id), { name: p.name, author: p.author, status: p.status, price: p.price, category: p.category, downloads: p.downloads }])) });
  const lines = [`📦 <b>Presets</b>${filter ? ' — ' + h(filter) : ''} · ${d.total || items.length}`, '', ...items.map((p, i) => `<b>${i + 1}.</b> ${statusIcon(p.status)} ${h(cut(p.name, 30))} — ${K.fmtMoney(p.price)} · ${h(cut(p.author, 18))}`)];
  const nums = items.map((p, i) => cb(String(i + 1), `ap:${p.id}`));
  const rows = [];
  for (let i = 0; i < nums.length; i += 4) rows.push(nums.slice(i, i + 4));
  rows.push([cb('All', 'af:all'), cb('✅ Approved', 'af:approved'), cb('❌ Rejected', 'af:rejected')], [cb('🛠️ Admin', 'm:admin')]);
  await show(ctx, lines.join('\n'), kb(rows));
}
async function adminPresetDetails(ctx, id) {
  if (!(await requireAdmin(ctx))) return;
  if (!K.isObjectId(id)) throw new K.BotError('USAGE', 'Preset ID सही नहीं है।');
  const p = (picks.get(ctx.chat.id) || {}).adminPresets?.[id];
  if (!p) return show(ctx, 'ℹ️ List पुरानी हो गई। फिर खोलें।', kb([[cb('📦 Presets', 'm:adminpresets')]]));
  await show(ctx, ['📦 <b>Preset</b>', '', `🎨 ${h(p.name)}`, `👤 ${h(p.author)} · 📂 ${h(p.category)}`, `💰 ${K.fmtMoney(p.price)} · ⬇️ ${K.compact(p.downloads)}`, `Status: ${statusIcon(p.status)} <b>${h(p.status)}</b>`].join('\n'),
    kb([[p.status !== 'approved' ? cb('✅ Approve', `pa:${id}`) : null, p.status !== 'rejected' ? cb('❌ Reject', `pr:${id}`) : null], [urlBtn('🌐 Open', presetUrl(id, p.name))], [cb('🔙 Presets', 'm:adminpresets'), cb('🛠️ Admin', 'm:admin')]]));
}
async function adminSetPresetStatus(ctx, id, status) {
  if (!(await requireAdmin(ctx))) return;
  if (!K.isObjectId(id)) throw new K.BotError('USAGE', 'Preset ID सही नहीं है।');
  await api(ctx, 'put', `/admin/presets/${id}/status`, { data: { status } });
  const cached = (picks.get(ctx.chat.id) || {}).adminPresets?.[id];
  if (cached) cached.status = status;
  await toast(ctx, status === 'approved' ? '✅ Approved' : '❌ Rejected');
  return adminPresetDetails(ctx, id);
}
async function adminSupport(ctx) {
  if (!(await requireAdmin(ctx))) return;
  const d = await api(ctx, 'get', '/admin/support-requests', { params: { status: 'open' } });
  const items = pickItems(d).slice(0, 5);
  if (!items.length) return show(ctx, '✅ <b>कोई open support request नहीं है।</b>', kb([[cb('🛠️ Admin', 'm:admin')]]));
  await toast(ctx);
  await reply(ctx, `🆘 <b>Open requests</b> (${pickItems(d).length})`);
  for (const r of items) {
    await reply(ctx, [`<b>${SUPPORT_LABEL[r.type] || 'Help'}</b> · ${K.fmtDateTime(r.createdAt)}`, `👤 ${h(cut(r.name, 40))}${r.email ? ' · ' + h(maskEmail(r.email)) : ''}`, `TG: <code>${h(r.telegramId || '-')}</code>`, '', h(cut(r.message, 400))].join('\n'),
      kb([[cb('✅ Resolve', `sr:resolved:${r.id}`), cb('⏳ In progress', `sr:in_progress:${r.id}`), cb('❌ Reject', `sr:rejected:${r.id}`)]]));
  }
}
async function adminSupportSet(ctx, status, id) {
  if (!(await requireAdmin(ctx))) return;
  if (!K.isObjectId(id) || !['resolved', 'in_progress', 'rejected'].includes(status)) throw new K.BotError('USAGE', 'Request सही नहीं है।');
  const r = await api(ctx, 'put', `/admin/support-requests/${id}`, { data: { status, adminNote: 'Handled from Telegram' } });
  await toast(ctx, `Status: ${status}`);
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: `Status: ${status}`, callback_data: 'noop' }]] }); } catch (_) {}
  const tg = r && r.request && r.request.telegramId;
  if (tg && ['resolved', 'rejected'].includes(status)) {
    bot.telegram.sendMessage(tg, status === 'resolved' ? '✅ <b>आपकी support request resolve हो गई है।</b> अब login करके देखें; ज़रूरत हो तो फिर /accounthelp भेजें।' : 'ℹ️ आपकी support request पर admin ने action ले लिया है। विवरण के लिए email देखें।', HTML).catch(() => {});
  }
}
async function adminAlerts(ctx) {
  if (!(await requireAdmin(ctx))) return;
  const rows = await AlertLog.find({}).sort({ lastAt: -1 }).limit(10).lean();
  if (!rows.length) return show(ctx, '✅ कोई alert नहीं है।', kb([[cb('🛠️ Admin', 'm:admin')]]));
  const icon = { critical: '🚨', warning: '⚠️', info: 'ℹ️' };
  const lines = ['🚨 <b>Latest alerts</b>', '', ...rows.map(a => `${icon[a.severity] || 'ℹ️'} [${h(a.type)}] ${h(cut(a.title, 90))}${a.count > 1 ? ` ×${a.count}` : ''}\n   <i>${K.fmtDateTime(a.lastAt)}</i>`)];
  await show(ctx, K.chunkLines(lines)[0], kb([[cb('🔄 Refresh', 'm:alerts'), cb('🛠️ Admin', 'm:admin')]]));
}
async function adminSystem(ctx) {
  if (!(await requireAdmin(ctx))) return;
  const u = await getDbUsage().catch(() => null);
  const [users, texts] = await Promise.all([User.countDocuments({}), TextPost.countDocuments({})]);
  const s = stats.snapshot();
  await show(ctx, ['⚙️ <b>System</b>', '', `👥 Users: ${users} · ✍️ Posts: ${texts}`,
    u ? `🗄️ DB: ${u.usedMB} / ${u.limitMB} MB (${u.usedPercent}%) — free ${u.freeMB} MB` : '🗄️ DB usage उपलब्ध नहीं',
    `🤖 Bot uptime: ${K.fmtDuration(s.uptimeSec)} · Node ${process.version}`].join('\n'), kb([[cb('🔄 Refresh', 'm:system'), cb('📈 Bot stats', 'm:botstats')], [cb('🛠️ Admin', 'm:admin')]]));
}
async function adminBotStats(ctx) {
  if (!(await requireAdmin(ctx))) return;
  const s = stats.snapshot();
  const codes = Object.entries(s.byCode).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}: ${v}`).join(' · ');
  await show(ctx, ['📈 <b>Bot stats</b>', '', `⏱ Uptime: ${K.fmtDuration(s.uptimeSec)}`, `📨 Updates: ${s.updates} · Commands: ${s.commands} · Buttons: ${s.callbacks}`, `👥 Active today: ${s.activeToday}`,
    `🐞 Errors: ${s.errors}${codes ? '\n   ' + h(codes) : ''}`, `⏳ Rate-limited: ${s.rateLimited} · ❓ Unknown commands: ${s.unknownCommands}`, `🔌 Bot: @${h(botUsername || '-')}`].join('\n'), kb([[cb('🔄 Refresh', 'm:botstats'), cb('🐞 Errors', 'm:errors')], [cb('🛠️ Admin', 'm:admin')]]));
}
async function adminErrors(ctx) {
  if (!(await requireAdmin(ctx))) return;
  const list = stats.recent.slice(0, 10);
  if (!list.length) return show(ctx, '✅ <b>अभी तक कोई bot error नहीं</b> (restart के बाद से)।', kb([[cb('🛠️ Admin', 'm:admin')]]));
  const lines = ['🐞 <b>Recent bot errors</b>', '', ...list.map(e => `<code>${e.ref}</code> ${K.fmtDateTime(e.at)}\n   ${h(e.code)} · ${h(e.where)}\n   <i>${h(cut(e.message, 100))}</i>`)];
  await show(ctx, K.chunkLines(lines)[0], kb([[cb('🔄 Refresh', 'm:errors'), cb('🛠️ Admin', 'm:admin')]]));
}

// ====================================================================================
// Unknown input
// ====================================================================================
async function unknownCommand(ctx, parsed) {
  stats.unknownCommands++;
  const names = COMMANDS.filter(c => !c.admin || (ctx.dbUser && ctx.dbUser.role === 'admin')).flatMap(c => [c.name, ...(c.aliases || [])]);
  const near = K.suggest(parsed.cmd, names, 3).map(n => findSpec(n)).filter((s, i, a) => s && a.indexOf(s) === i);
  const rows = near.map(s => [cb(`/${s.name} — ${cut(s.desc, 26)}`, `m:${s.name}`)]);
  rows.push([cb('❓ सभी commands', 'm:help'), homeBtn()]);
  await reply(ctx, `❓ <code>/${h(cut(parsed.cmd, 30))}</code> नाम का कोई command नहीं है।${near.length ? '\n\nक्या आपका मतलब यह था?' : '\n\n/help में सभी commands देखें।'}`, kb(rows));
}
async function smartReply(ctx, text) {
  if (text.length >= 2 && text.length <= 80) {
    // A plain message is most likely a search. Offer it instead of ignoring the user.
    picks.set(ctx.chat.id, { ...(picks.get(ctx.chat.id) || {}), lastText: text });
    return reply(ctx, `🔍 <b>“${h(cut(text, 60))}”</b> search करें?`, kb([[cb('🔍 हाँ, search करें', 'qs:go'), cb('✖ नहीं', 'cv:cancel')], [cb('❓ Help', 'm:help')]]));
  }
  await reply(ctx, '🙂 मैं छोटे text/commands समझता हूँ। नीचे menu से चुनें या /help देखें।', mainMenu(ctx.dbUser));
}

// ====================================================================================
// Command registry (single source of truth)
// ====================================================================================
const run = fn => async (ctx, p) => fn(ctx, p);
const COMMANDS = [
  // --- browse ---
  { name: 'start', group: 'browse', desc: 'PresetHub खोलें', run: (ctx, p) => sendWelcome(ctx, p.argText) },
  { name: 'menu', aliases: ['home'], group: 'browse', desc: 'Main menu', run: ctx => showHub(ctx) },
  { name: 'search', group: 'browse', desc: 'Presets खोजें', usage: '/search <शब्द>', example: '/search sunset', run: (ctx, p) => (p.argText ? doSearch(ctx, p.argText) : searchPrompt(ctx)) },
  { name: 'latest', aliases: ['recent', 'new'], group: 'browse', desc: 'नए presets', run: ctx => openList(ctx, browseList('🆕 Latest presets', { sort: 'newest' })) },
  { name: 'trending', aliases: ['popular', 'viral', 'presets'], group: 'browse', desc: 'Trending presets', run: ctx => openList(ctx, browseList('🔥 Trending presets', { sort: 'popular' })) },
  { name: 'toprated', group: 'browse', desc: 'सबसे ज़्यादा rating वाले', run: ctx => openList(ctx, browseList('⭐ Top rated presets', { sort: 'rating' })) },
  { name: 'free', group: 'browse', desc: 'Free presets', run: ctx => openList(ctx, browseList('🆓 Free presets', { price: 'free', sort: 'popular' })) },
  { name: 'categories', group: 'browse', desc: 'Categories देखें', run: ctx => showCategories(ctx) },
  { name: 'category', group: 'browse', desc: 'किसी category के presets', usage: '/category <नाम>', example: '/category Portrait', run: (ctx, p) => { if (!p.argText) throw new K.BotError('USAGE', 'Category का नाम लिखें।', { usage: '/category <नाम>', example: '/category Portrait' }); return openList(ctx, browseList(`📂 ${cut(p.argText, 30)}`, { category: p.argText.slice(0, 50), sort: 'popular' })); } },
  { name: 'preset', group: 'browse', desc: 'Preset card खोलें', usage: '/preset <id>', run: (ctx, p) => { if (!p.args[0]) throw new K.BotError('USAGE', 'Preset ID दें।', { usage: '/preset <id>' }); return sendPresetCard(ctx, p.args[0]); } },
  { name: 'top', group: 'browse', desc: 'Top creators', run: ctx => showTop(ctx) },
  { name: 'download', group: 'browse', desc: 'Preset download करें', usage: '/download <id>', login: true, heavy: true, run: (ctx, p) => { if (!p.args[0]) throw new K.BotError('USAGE', 'Preset ID दें।', { usage: '/download <id>' }); return downloadPreset(ctx, p.args[0]); } },
  { name: 'share', group: 'browse', desc: 'Preset का share link', usage: '/share <id>', login: true, run: (ctx, p) => { if (!p.args[0]) throw new K.BotError('USAGE', 'Preset ID दें।', { usage: '/share <id>' }); return sharePreset(ctx, p.args[0]); } },
  // --- account ---
  { name: 'account', group: 'account', desc: 'My Account hub', login: true, run: ctx => showAccountHub(ctx) },
  { name: 'dashboard', group: 'account', desc: 'आपके stats', login: true, run: ctx => showDashboard(ctx) },
  { name: 'profile', group: 'account', desc: 'आपकी profile', login: true, run: ctx => showProfile(ctx) },
  { name: 'mypresets', group: 'account', desc: 'आपके presets', login: true, run: ctx => showMyPresets(ctx) },
  { name: 'downloads', group: 'account', desc: 'आपके downloads', login: true, run: ctx => showDownloads(ctx) },
  { name: 'wishlist', aliases: ['saved'], group: 'account', desc: 'Saved presets', login: true, run: ctx => showWishlist(ctx) },
  { name: 'notifications', group: 'account', desc: 'Notifications', login: true, run: ctx => showNotifications(ctx) },
  { name: 'myorders', aliases: ['orders'], group: 'account', desc: 'आपके orders', login: true, run: ctx => showOrders(ctx) },
  { name: 'subscription', group: 'account', desc: 'Pro plan status', login: true, run: ctx => showSubscription(ctx) },
  { name: 'referral', group: 'account', desc: 'Referral code', login: true, run: ctx => showReferral(ctx) },
  { name: 'login', group: 'account', desc: 'Telegram account link करें', run: ctx => showLogin(ctx) },
  { name: 'signup', group: 'account', desc: 'नया account बनाएँ', run: ctx => reply(ctx, '📝 <b>नया account</b>\n\nWebsite पर email से account बनाएँ, फिर Telegram link करें।', kb([[urlBtn('📝 Sign up', `${SITE_URL}/?action=signup`)], [cb('🔗 Link कैसे करें', 'm:login')]])) },
  { name: 'link', group: 'account', desc: 'Link code से account जोड़ें', usage: '/link 123456', example: '/link 482913', hidden: true, run: linkAccount },
  { name: 'logout', aliases: ['unlink'], group: 'account', desc: 'Telegram unlink करें', login: true, run: ctx => askLogout(ctx) },
  // --- creator ---
  { name: 'upload', group: 'creator', desc: 'Preset upload करें', login: true, heavy: true, run: ctx => startUpload(ctx) },
  { name: 'earnings', group: 'creator', desc: 'Creator कमाई और payouts', login: true, run: ctx => showEarnings(ctx) },
  { name: 'cancel', group: 'creator', desc: 'चल रहा action रोकें', run: ctx => convoCancel(ctx) },
  { name: 'skip', group: 'creator', desc: 'Optional step छोड़ें', hidden: true, run: async ctx => { const st = convo.get(ctx.chat.id); if (!st) return reply(ctx, 'अभी कुछ skip करने को नहीं है।'); return skipStep(ctx, st); } },
  // --- shayari ---
  { name: 'shayari', group: 'shayari', desc: 'Shayari पढ़ें', usage: '/shayari [category]', example: '/shayari love', run: (ctx, p) => (p.argText ? sendTexts(ctx, p.argText.toLowerCase().replace(/\s+/g, '-'), 1) : shayariCategories(ctx)) },
  { name: 'latestshayari', group: 'shayari', desc: 'नई shayari', run: ctx => sendTexts(ctx, 'all', 1) },
  { name: 'postshayari', group: 'shayari', desc: 'Shayari post करें', usage: '/postshayari <category> | <text>', example: '/postshayari love | आपकी shayari', login: true, run: async (ctx, p) => {
    const m = p.argText.match(/^([a-z-]+)\s*\|\s*([\s\S]{5,2000})$/i);
    if (!p.argText) return startShayariPost(ctx);
    if (!m || !TEXT_CATEGORIES.includes(m[1].toLowerCase())) throw new K.BotError('USAGE', 'Format सही नहीं है।', { usage: '/postshayari <category> | <text>', example: '/postshayari love | आपकी shayari' });
    await writeLimit(ctx);
    const r = await api(ctx, 'post', '/texts', { data: { category: m[1].toLowerCase(), text: clean(m[2], 2000) } });
    await reply(ctx, `✅ <b>Post हो गया!</b>\n🔗 ${SITE_URL}/shayari/${h(r.id)}/`, kb([[homeBtn()]]));
  } },
  // --- pro ---
  { name: 'pro', aliases: ['plans'], group: 'pro', desc: 'Pro plans', run: ctx => showPro(ctx) },
  // --- help ---
  { name: 'help', group: 'help', desc: 'मदद और commands', usage: '/help [command]', example: '/help search', run: showHelp },
  { name: 'accounthelp', group: 'help', desc: 'Account की मदद (admin तक)', run: ctx => accountHelpMenu(ctx) },
  { name: 'passwordhelp', group: 'help', desc: 'Password reset मदद', hidden: true, run: ctx => submitSupport(ctx, 'password_reset', 'I forgot my password and need a password reset.') },
  { name: 'accesshelp', group: 'help', desc: 'Login/access मदद', hidden: true, run: ctx => submitSupport(ctx, 'account_access', 'I cannot access my account.') },
  { name: 'blockhelp', group: 'help', desc: 'Blocked account review', hidden: true, run: ctx => submitSupport(ctx, 'block_review', 'Please review my blocked account.') },
  { name: 'deletehelp', group: 'help', desc: 'Account delete request', hidden: true, run: ctx => reply(ctx, '🗑 <b>Account delete request?</b>\nयह admin review के बाद होगा।', kb([[cb('✅ हाँ, request भेजें', 'ah:delete_yes'), cb('✖ नहीं', 'cv:cancel')]])) },
  { name: 'privacy', group: 'help', desc: 'Privacy और आपका data', run: ctx => showPrivacy(ctx) },
  { name: 'forgetme', aliases: ['deletedata'], group: 'help', desc: 'Telegram data हटाएँ', run: ctx => forgetMe(ctx) },
  { name: 'site', aliases: ['website'], group: 'help', desc: 'Website खोलें', run: ctx => reply(ctx, '🌐 <b>PresetHub Website</b>', kb([[urlBtn('🌐 Open', SITE_URL)]])) },
  // --- admin ---
  { name: 'admin', group: 'admin', desc: 'Admin panel', admin: true, run: ctx => adminDashboard(ctx) },
  { name: 'adminusers', group: 'admin', desc: 'Users (search)', admin: true, usage: '/adminusers [नाम/email]', run: (ctx, p) => adminUsers(ctx, p.argText) },
  { name: 'adminpresets', group: 'admin', desc: 'Presets moderation', admin: true, run: ctx => adminPresets(ctx) },
  { name: 'support', group: 'admin', desc: 'Open support requests', admin: true, run: ctx => adminSupport(ctx) },
  { name: 'alerts', group: 'admin', desc: 'Latest alerts', admin: true, run: ctx => adminAlerts(ctx) },
  { name: 'system', group: 'admin', desc: 'Server और DB status', admin: true, run: ctx => adminSystem(ctx) },
  { name: 'botstats', group: 'admin', desc: 'Bot usage stats', admin: true, run: ctx => adminBotStats(ctx) },
  { name: 'errors', group: 'admin', desc: 'Recent bot errors', admin: true, run: ctx => adminErrors(ctx) },
  { name: 'broadcast', group: 'admin', desc: 'Broadcast (website पर)', admin: true, run: ctx => reply(ctx, '📣 Broadcast सुरक्षा के लिए सिर्फ website के Admin Panel से होता है।', kb([[urlBtn('🌐 Admin panel', `${SITE_URL}/admin`)]])) }
];
function findSpec(name) {
  const n = String(name || '').toLowerCase();
  return COMMANDS.find(c => c.name === n || (c.aliases || []).includes(n)) || null;
}
// Runs a registry command with all of its rules (admin / login / heavy).
async function runSpec(ctx, spec, p) {
  if (spec.admin && !(await requireAdmin(ctx))) return;
  if (spec.login && !(await requireLogin(ctx))) return;
  await spec.run(ctx, p || { args: [], argText: '', cmd: spec.name });
}

async function skipStep(ctx, st) {
  if (st.type !== 'upload') return reply(ctx, 'अभी कुछ skip करने को नहीं है।');
  if (st.step === 'description') { st.step = 'tags'; return askTags(ctx); }
  if (st.step === 'tags') { st.step = 'file'; return askFile(ctx); }
  if (st.step === 'preview') return askConfirm(ctx, st);
  return reply(ctx, 'यह step skip नहीं हो सकता।');
}

// ====================================================================================
// Callback buttons
// ====================================================================================
async function handleCallback(ctx) {
  stats.callbacks++;
  const data = String((ctx.callbackQuery && ctx.callbackQuery.data) || '');
  const i = data.indexOf(':');
  const key = i === -1 ? data : data.slice(0, i);
  const rest = i === -1 ? '' : data.slice(i + 1);
  const chatId = ctx.chat && ctx.chat.id;
  const stale = () => toast(ctx, 'यह button पुराना हो गया है। Menu से दोबारा खोलें।', true);

  switch (key) {
    case 'noop': return;
    case 'fg': await toast(ctx); return forgetMe(ctx);
    case 'm': { // m:<command>
      const spec = findSpec(rest);
      if (!spec) return stale();
      if (spec.name !== 'cancel') convo.delete(chatId);
      await toast(ctx);
      return runSpec(ctx, spec, { cmd: spec.name, args: [], argText: '' });
    }
    case 'p': await toast(ctx); return sendPresetCard(ctx, rest);
    case 'dl': return downloadPreset(ctx, rest);
    case 'lk': return likePreset(ctx, rest);
    case 'ws': return savePreset(ctx, rest);
    case 'sh': return sharePreset(ctx, rest);
    case 'pg': case 'fl': case 'so': {
      const l = lists.get(chatId);
      if (!l) return stale();
      await toast(ctx);
      if (key === 'fl') { const p = { ...l.params }; if (rest === 'all') delete p.price; else p.price = rest === 'paid' ? 'paid' : 'free'; return openList(ctx, { ...l, params: p }, 1); }
      if (key === 'so') return openList(ctx, { ...l, params: { ...l.params, sort: ['popular', 'rating'].includes(rest) ? rest : 'newest' } }, 1);
      return openList(ctx, l, Math.max(1, Math.min(l.totalPages, Number(rest) || 1)));
    }
    case 'bc': { // browse category by index
      const cats = (picks.get(chatId) || {}).browseCats;
      const name = cats && cats[Number(rest)];
      if (!name) return stale();
      await toast(ctx);
      return openList(ctx, browseList(`📂 ${cut(name, 30)}`, { category: name, sort: 'popular' }));
    }
    case 'qs': { // quick search from plain text
      const t = (picks.get(chatId) || {}).lastText;
      if (!t) return stale();
      await toast(ctx);
      return doSearch(ctx, t);
    }
    case 'cv': await toast(ctx, '✖ Cancel'); return convoCancel(ctx);
    case 'lo': {
      await toast(ctx);
      if (rest === 'y') { await unlinkTelegramId(ctx.from.id); ctx.dbUser = null; return show(ctx, '✅ <b>Telegram unlink हो गया।</b>\nदोबारा जोड़ने के लिए /login।', kb([[cb('🔗 फिर से link करें', 'm:login')]])); }
      return show(ctx, 'ठीक है, account linked रहेगा। 👍', kb([[homeBtn()]]));
    }
    // upload wizard
    case 'uc': { const st = convo.get(chatId); const cats = (picks.get(chatId) || {}).cats; if (!st || st.type !== 'upload' || st.step !== 'category' || !cats || !cats[Number(rest)]) return stale(); await toast(ctx); st.data.category = cats[Number(rest)]; st.step = 'price'; return askPrice(ctx); }
    case 'up': { const st = convo.get(chatId); if (!st || st.type !== 'upload' || st.step !== 'price') return stale(); const n = Number(rest); if (!PRICE_CHOICES.includes(n)) return stale(); await toast(ctx); st.data.price = n; st.step = 'description'; return askDescription(ctx); }
    case 'us': { const st = convo.get(chatId); if (!st || st.type !== 'upload') return stale(); await toast(ctx); if (rest === 'desc' && st.step === 'description') { st.step = 'tags'; return askTags(ctx); } if (rest === 'tags' && st.step === 'tags') { st.step = 'file'; return askFile(ctx); } if (rest === 'preview' && st.step === 'preview') return askConfirm(ctx, st); return stale(); }
    case 'uf': { const st = convo.get(chatId); if (!st || st.type !== 'upload' || st.step !== 'confirm') return stale(); await toast(ctx, '🚀 Upload शुरू…'); return finishUpload(ctx); }
    // shayari
    case 'sc': { const [cat, page] = rest.split(':'); return sendTexts(ctx, cat, Number(page) || 1); }
    case 'sn': { await toast(ctx); return rest === 'start' ? startShayariPost(ctx) : startShayariPost(ctx, rest); }
    case 'sf': {
      const st = convo.get(chatId);
      if (!st || st.type !== 'shayari' || !st.data.text) return stale();
      await writeLimit(ctx);
      const r = await api(ctx, 'post', '/texts', { data: { category: st.data.category, text: st.data.text } });
      convo.delete(chatId);
      await toast(ctx, '✅ Posted');
      return reply(ctx, `✅ <b>Post हो गया!</b>\n🔗 ${SITE_URL}/shayari/${h(r.id)}/`, kb([[homeBtn()]]));
    }
    case 'tl': {
      if (!K.isObjectId(rest)) return stale();
      if (!isLinked(ctx.dbUser)) return toast(ctx, '🔐 Like के लिए account link करें (/login)', true);
      await writeLimit(ctx);
      const r = await api(ctx, 'post', `/texts/${rest}/like`, { data: {} });
      return toast(ctx, r.liked ? `❤️ Liked (${r.likes})` : `Unliked (${r.likes})`);
    }
    case 'tc': {
      if (!K.isObjectId(rest)) return stale();
      const t = await TextPost.findOneAndUpdate({ _id: rest, status: 'approved' }, { $inc: { copies: 1 } }, { new: true }).lean();
      if (!t) return toast(ctx, 'Post नहीं मिला', true);
      await toast(ctx, '📋 नीचे text भेजा — tap करके copy करें');
      return reply(ctx, `<code>${h(cut(t.text, 3500))}</code>`);
    }
    // support
    case 'ah': {
      if (!['other', 'delete_account', 'delete_yes', 'password_reset', 'account_access', 'block_review'].includes(rest)) return stale();
      await toast(ctx);
      if (rest === 'other') { convo.set(chatId, { type: 'support', step: 'text', data: {} }); return reply(ctx, '💬 अपनी समस्या एक message में लिखें (अधिकतम 1000 अक्षर)।', kb([[cb('✖ Cancel', 'cv:cancel')]])); }
      if (rest === 'delete_account') return reply(ctx, '🗑 <b>Account delete request?</b>\nयह admin review के बाद होगा।', kb([[cb('✅ हाँ, request भेजें', 'ah:delete_yes'), cb('✖ नहीं', 'cv:cancel')]]));
      if (rest === 'delete_yes') return submitSupport(ctx, 'delete_account', 'I want to request account deletion.');
      const msgs = { password_reset: 'I forgot my password and need a password reset.', account_access: 'I cannot access my account.', block_review: 'Please review my blocked account.' };
      return submitSupport(ctx, rest, msgs[rest]);
    }
    // admin (every branch re-checks admin rights)
    case 'as': { if (!(await requireAdmin(ctx))) return; await toast(ctx); convo.set(chatId, { type: 'adminsearch', step: 'q', data: {} }); return reply(ctx, '🔍 User का नाम, username या email लिखें:', kb([[cb('✖ Cancel', 'cv:cancel')]])); }
    case 'au': await toast(ctx); return adminUserDetails(ctx, rest);
    case 'ab': { if (!(await requireAdmin(ctx))) return; await toast(ctx); return show(ctx, '🚫 <b>इस user को block करें?</b>\nUser login और API इस्तेमाल नहीं कर पाएगा।', kb([[cb('✅ हाँ, block करें', `abc:${rest}`), cb('✖ रहने दें', `au:${rest}`)]])); }
    case 'abc': return adminSetUserStatus(ctx, rest, 'blocked');
    case 'aa': return adminSetUserStatus(ctx, rest, 'active');
    case 'ap': await toast(ctx); return adminPresetDetails(ctx, rest);
    case 'af': await toast(ctx); return adminPresets(ctx, rest);
    case 'pa': return adminSetPresetStatus(ctx, rest, 'approved');
    case 'pr': { if (!(await requireAdmin(ctx))) return; await toast(ctx); return show(ctx, '❌ <b>यह preset reject करें?</b>\nयह public listing से हट जाएगा।', kb([[cb('✅ हाँ, reject करें', `prc:${rest}`), cb('✖ रहने दें', `ap:${rest}`)]])); }
    case 'prc': return adminSetPresetStatus(ctx, rest, 'rejected');
    case 'sr': { const [status, id] = rest.split(':'); return adminSupportSet(ctx, status, id); }
    default: return stale();
  }
}

// ====================================================================================
// Wiring
// ====================================================================================
function registerHandlers(b) {
  // 1) Base middleware: private chats only, rate limit, load account
  b.use(async (ctx, next) => {
    stats.updates++;
    ctx.state = ctx.state || {};
    if (!ctx.from || ctx.from.is_bot) return;
    stats.seen(ctx.from.id);
    if (ctx.chat && ctx.chat.type !== 'private') {
      // Never show account data in groups/channels. Point people to the private chat (at most once a minute per chat).
      if (limiter.hit(`g:${ctx.chat.id}`, 1, 60 * 1000).ok && ctx.message && typeof ctx.message.text === 'string' && ctx.message.text.startsWith('/')) {
        try { await ctx.reply(`ℹ️ PresetHub bot को private chat में इस्तेमाल करें।${botUsername ? ' @' + botUsername : ''}`); } catch (_) {}
      }
      return;
    }
    const rl = limiter.hit(`e:${ctx.from.id}`, ...LIMITS.events);
    if (!rl.ok) {
      stats.rateLimited++;
      if (ctx.callbackQuery) { try { await ctx.answerCbQuery('⏳ थोड़ा धीरे…'); } catch (_) {} }
      else if (rl.firstBlock) { try { await ctx.reply(`⏳ बहुत तेज़ messages। ${Math.ceil(rl.retryAfterMs / 1000)} सेकंड रुकें।`); } catch (_) {} }
      return;
    }
    try { ctx.dbUser = await loadUser(ctx); }
    catch (e) { ctx.dbUser = null; stats.recordError('DB_ERROR', 'loadUser', K.newRef(), e.message); console.error('Bot loadUser failed:', e.message); adminAlert({ type: 'database', severity: 'critical', title: 'Telegram bot cannot load users from the database', fingerprint: 'bot-loaduser', details: { message: String(e.message).slice(0, 200) } }); }
    return next();
  });

  // 2) Commands from the registry
  for (const spec of COMMANDS) {
    b.command([spec.name, ...(spec.aliases || [])], guard(`/${spec.name}`, async ctx => {
      stats.commands++;
      const p = K.parseCommand(ctx.message.text) || { cmd: spec.name, args: [], argText: '' };
      if (!['cancel', 'skip'].includes(spec.name)) convo.delete(ctx.chat.id);
      if (spec.heavy) { const rl = limiter.hit(`h:${ctx.from.id}`, ...LIMITS.heavy); if (!rl.ok) throw new K.BotError('RATE_LIMITED', `करीब ${Math.ceil(rl.retryAfterMs / 1000)} सेकंड बाद फिर try करें।`); }
      await runSpec(ctx, spec, p);
    }));
  }

  // 3) Reply-keyboard buttons + free text
  const MENU_ROUTES = new Map(Object.entries(MENU).map(([name, label]) => [label, name]));
  b.on('text', guard('text', async ctx => {
    const text = clean(ctx.message.text, 4000);
    if (!text) return;
    const parsed = K.parseCommand(text);
    if (parsed) return unknownCommand(ctx, parsed);               // known commands were handled above
    const menuName = MENU_ROUTES.get(text);
    if (menuName) { convo.delete(ctx.chat.id); return runSpec(ctx, findSpec(menuName), { cmd: menuName, args: [], argText: '' }); }
    const st = convo.get(ctx.chat.id);
    if (st) return handleConvoText(ctx, st, text);
    return smartReply(ctx, text);
  }));

  // 4) Files and photos (only meaningful inside the upload wizard)
  b.on('document', guard('document', async ctx => {
    const st = convo.get(ctx.chat.id);
    if (!st || st.type !== 'upload' || st.step !== 'file') return reply(ctx, '📎 File लेने के लिए पहले /upload शुरू करें।', kb([[cb('📤 Upload', 'm:upload')]]));
    const doc = ctx.message.document;
    const ext = path.extname(doc.file_name || '').toLowerCase();
    if (!PRESET_EXTS.includes(ext)) return reply(ctx, `❌ यह file type allowed नहीं है।\nAllowed: ${PRESET_EXTS.join(' ')}`);
    if (doc.file_size && doc.file_size > TG_DOWNLOAD_LIMIT) return reply(ctx, '📦 File 20 MB से बड़ी है। Telegram bot इतनी बड़ी file नहीं ले सकता — website से upload करें।', kb([[urlBtn('🌐 Website', SITE_URL)]]));
    typing(ctx, 'typing');
    st.data.fileBuffer = await downloadTelegramFile(ctx, doc.file_id, TG_DOWNLOAD_LIMIT + 1024);
    st.data.fileName = K.safeFilename(doc.file_name, 'preset' + ext); st.data.fileMime = doc.mime_type || 'application/octet-stream';
    st.step = 'preview';
    convo.touch(ctx.chat.id);
    await askPreview(ctx);
  }));
  b.on('photo', guard('photo', async ctx => {
    const st = convo.get(ctx.chat.id);
    if (!st || st.type !== 'upload' || st.step !== 'preview') return reply(ctx, '🖼 Photo सिर्फ upload के preview step में चाहिए। /upload से शुरू करें।');
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    typing(ctx, 'typing');
    st.data.previewBuffer = await downloadTelegramFile(ctx, photo.file_id, 10 * 1024 * 1024);
    st.data.previewName = 'preview.jpg'; st.data.previewMime = 'image/jpeg';
    convo.touch(ctx.chat.id);
    await askConfirm(ctx, st);
  }));

  // 5) Inline buttons
  b.on('callback_query', async ctx => {
    try { await handleCallback(ctx); }
    catch (err) { await handleError(ctx, err, `button:${String((ctx.callbackQuery && ctx.callbackQuery.data) || '').split(':')[0]}`); }
    finally { await toast(ctx); }
  });

  // 6) Everything else (stickers, voice, location, ...)
  b.on('message', guard('message', ctx => reply(ctx, '🙂 मैं text, files (upload के समय) और buttons समझता हूँ। नीचे menu से चुनें।', mainMenu(ctx.dbUser))));

  b.catch((err, ctx) => { handleError(ctx || { state: {} }, err, 'bot.catch'); });
}

// ====================================================================================
// Start / stop
// ====================================================================================
async function setupCommandMenu() {
  const publicList = COMMANDS.filter(c => !c.admin && !c.hidden && ['start', 'menu', 'search', 'latest', 'trending', 'categories', 'shayari', 'pro', 'account', 'upload', 'help', 'login'].includes(c.name));
  const toMenu = list => list.map(c => ({ command: c.name, description: cut(c.desc.replace(/[^\x20-\x7E\u0900-\u097F]/g, '') || c.name, 250) }));
  await bot.telegram.setMyCommands(toMenu(publicList)).catch(e => console.warn('Telegram command menu setup failed:', e.message));
  if (ADMIN_CHAT_ID && /^-?\d+$/.test(ADMIN_CHAT_ID)) {
    const adminList = [...publicList, ...COMMANDS.filter(c => ['admin', 'support', 'alerts', 'system', 'botstats', 'errors'].includes(c.name))];
    await bot.telegram.setMyCommands(toMenu(adminList), { scope: { type: 'chat', chat_id: Number(ADMIN_CHAT_ID) } }).catch(e => console.warn('Telegram admin menu setup failed:', e.message));
  }
}
function scheduleRestart(reason) {
  if (botStopping || restartTimer) return;
  restartAttempt++;
  const wait = Math.min(5 * 60 * 1000, 10 * 1000 * 2 ** Math.min(restartAttempt, 5));
  console.warn(`⚠️ Telegram bot will restart in ${Math.round(wait / 1000)}s (${reason})`);
  restartTimer = setTimeout(() => { restartTimer = null; bot = null; botStarted = false; startBot(); }, wait);
  if (restartTimer.unref) restartTimer.unref();
}
async function startBot() {
  if (!BOT_TOKEN) { console.warn('⚠️ Telegram bot disabled: BOT_TOKEN not configured.'); return false; }
  if (botStarted || botStarting) return botStarted;
  botStarting = true; botStopping = false;
  try {
    await connectDB();
    purgeLegacyGuestProfiles();
    bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 120000 });
    registerHandlers(bot);
    const me = await bot.telegram.getMe();           // fails fast on a wrong token
    botUsername = me.username || '';
    await bot.telegram.deleteWebhook({ drop_pending_updates: true }).catch(() => {});
    // launch() keeps running while polling; it only settles when polling stops or crashes (e.g. 409 during overlapping deploys).
    let pollFailed = false;
    const running = bot.launch({ dropPendingUpdates: true });
    Promise.resolve(running).then(() => { if (!botStopping) { pollFailed = true; botStarted = false; scheduleRestart('polling ended'); } })
      .catch(err => {
        pollFailed = true;
        botStarted = false;
        console.error('❌ Telegram polling stopped:', err && err.message);
        adminAlert({ type: 'error', severity: 'warning', title: 'Telegram bot polling stopped', fingerprint: 'bot-polling-stopped', email: false, details: { message: String(err && err.message).slice(0, 200) } });
        scheduleRestart(String(err && err.message).slice(0, 80));
      });
    await setupCommandMenu();
    if (pollFailed) return false;                    // polling already crashed while we were setting up; a restart is scheduled
    botStarted = true; restartAttempt = 0;
    console.log(`✅ Telegram bot started inside PresetHub web server (@${botUsername}).`);
    return true;
  } catch (e) {
    console.error('❌ Telegram bot launch error:', e.message);
    botStarted = false; bot = null;
    scheduleRestart(e.message);
    return false;
  } finally { botStarting = false; }
}
async function stopBot(signal = 'SIGTERM') {
  botStopping = true;
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  if (!bot) return;
  try { bot.stop(signal); } catch (_) {}
  botStarted = false;
}
function getBotStatus() {
  const s = stats.snapshot();
  return { configured: !!BOT_TOKEN, started: botStarted, username: botUsername, apiBase: API_BASE, uptimeSec: s.uptimeSec, updates: s.updates, errors: s.errors, lastError: stats.recent[0] || null };
}

if (require.main === module) { startBot(); process.once('SIGINT', () => stopBot('SIGINT')); process.once('SIGTERM', () => stopBot('SIGTERM')); }
module.exports = { startBot, stopBot, getBotStatus, _internals: { purgeLegacyGuestProfiles, COMMANDS, findSpec, registerHandlers, stats, convo, lists, picks, limiter, accountState } };
