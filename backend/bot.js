// PresetHub Telegram Bot — website-integrated production bot
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ADMIN_CHAT_ID = String(process.env.ADMIN_CHAT_ID || '');
const API_BASE = (process.env.API_BASE || `${process.env.CLIENT_URL || 'https://presethub.site'}/api`).replace(/\/$/, '');
const SITE_URL = (process.env.CLIENT_URL || 'https://presethub.site').replace(/\/$/, '');

const { User, Preset, Download, SupportRequest } = require('./models');
const { connectDB } = require('./config/db');

let botStarted = false;
let botStarting = false;
let bot = null;
const loginStates = new Map();
const uploadStates = new Map();
const telegramApiTokens = new Map();

function mainMenu(user) {
  const rows = [
    ['🏠 Dashboard', '🔍 Search'],
    ['🆕 Latest', '📦 Presets'],
    ['⬇️ Downloads', '🔔 Notifications'],
    ['👤 Profile', '📤 Upload Preset'],
    ['🔗 Share Preset', '🛒 My Orders'],
    ['🆘 Account Help', '❓ Help']
  ];
  if (user?.role === 'admin') rows.push(['🛠️ Admin Dashboard', '👥 Admin Users']);
  return Markup.keyboard(rows).resize();
}

function inlineRows(items, perRow = 3) {
  const rows = [];
  for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow));
  return rows;
}

function safeText(v, max = 800) {
  return String(v ?? '').replace(/[<>]/g, '').slice(0, max);
}
function money(v) { return Number(v || 0) <= 0 ? 'Free' : `₹${Number(v).toFixed(2)}`; }
function apiHeaders(user) { const token = user?.telegramId ? telegramApiTokens.get(String(user.telegramId)) : ''; return token ? { Authorization: `Bearer ${token}` } : {}; }
function loggedIn(ctx) { return !!(ctx.dbUser?.telegramId && telegramApiTokens.has(String(ctx.dbUser.telegramId))); }
function requireLogin(ctx) {
  if (!loggedIn(ctx)) { ctx.reply('🔐 पहले `/login` करें या website पर account बनाएं।', { parse_mode: 'Markdown' }); return false; }
  return true;
}
function requireAdmin(ctx) {
  if (!requireLogin(ctx)) return false;
  if (ctx.dbUser.role !== 'admin') { ctx.reply('⛔ यह section केवल admin के लिए है।'); return false; }
  return true;
}

async function getUserByTelegramId(id) { return User.findOne({ telegramId: String(id) }); }
async function saveTelegramUser(ctx) {
  if (!ctx.from) return null;
  const tid = String(ctx.from.id);
  const telegram = { firstName: ctx.from.first_name || '', lastName: ctx.from.last_name || '', username: ctx.from.username || '', languageCode: ctx.from.language_code || '' };
  let user = await User.findOne({ telegramId: tid });
  if (user) {
    user.telegram = telegram;
    user.lastActive = new Date();
    user.commandsCount = (user.commandsCount || 0) + 1;
    await user.save();
    return user;
  }
  return User.create({
    email: `telegram_${tid}@users.presethub.local`, password: '',
    name: ctx.from.first_name || 'Telegram User', username: `tg_${tid.slice(-12)}`,
    role: 'user', verified: true, telegramId: tid, telegram,
    lastActive: new Date(), commandsCount: 1
  });
}
async function linkTelegramId(userId, telegramId, token, ctx) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  user.telegramId = String(telegramId);
  if (token) telegramApiTokens.set(String(telegramId), token);
  user.telegram = { firstName: ctx.from.first_name || '', lastName: ctx.from.last_name || '', username: ctx.from.username || '', languageCode: ctx.from.language_code || '' };
  user.lastActive = new Date();
  await user.save();
  return user;
}
async function unlinkTelegramId(telegramId) {
  telegramApiTokens.delete(String(telegramId));
  await User.updateOne({ telegramId: String(telegramId) }, { $unset: { telegramId: 1, token: 1 } });
}

async function submitAccountHelp(ctx, type = 'account_access', message = '') {
  const user = ctx.dbUser || await getUserByTelegramId(ctx.from?.id);
  const text = String(message || '').trim().slice(0, 1000);
  const request = await SupportRequest.create({
    userId: user?._id || null, telegramId: String(ctx.from?.id || ''),
    name: user?.name || ctx.from?.first_name || 'Telegram User', email: user?.email || '',
    type, message: text || 'User requested account assistance from Telegram.'
  });
  if (ADMIN_CHAT_ID) {
    const label = { password_reset:'Password reset', delete_account:'Delete account', account_access:'Account access', block_review:'Block review', other:'Other' }[type] || 'Account help';
    await bot.telegram.sendMessage(ADMIN_CHAT_ID, `🆘 *Account request*\n\nType: ${label}\nUser: ${safeText(user?.name || ctx.from?.first_name)}\nTelegram: ${ctx.from?.id}\nEmail: ${safeText(user?.email || '—')}\n\n${safeText(text || 'No extra details') }\n\nRequest ID: ${request._id}`, { parse_mode:'Markdown' }).catch(()=>{});
  }
  return request;
}


async function sendPresetCard(ctx, p) {
  const caption = `🎨 ${safeText(p.name, 100)}\n👤 ${safeText(p.author || 'Creator', 80)}\n📂 ${safeText(p.category || 'General', 40)}\n💰 ${money(p.price)}\n⭐ ${Number(p.avgRating || 0).toFixed(1)} · 👁 ${p.views || 0} · ❤️ ${p.likesCount || 0} · 💬 ${p.commentsCount || 0} · ↗️ ${p.shares || 0} · ⬇️ ${p.downloads || 0}\n\n${safeText(p.description || 'Lightroom preset', 500)}\n\n🔗 ${SITE_URL}/preset/${p.id}/`;
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('👁 View', `preset_${p.id}`), Markup.button.callback('⬇️ Download', `download_${p.id}`), Markup.button.callback('❤️ Wishlist', `wishlist_${p.id}`)],
    [Markup.button.callback('🔗 Share', `share_${p.id}`)]
  ]);
  if (p.previewImage && /^https?:\/\//i.test(p.previewImage)) {
    try { return ctx.replyWithPhoto(p.previewImage, { caption, ...kb }); } catch (_) {}
  }
  return ctx.reply(caption, { ...kb, parse_mode: 'HTML' });
}

async function listPresets(ctx, endpoint, title, limit = 18) {
  try {
    const res = await axios.get(`${API_BASE}${endpoint}${endpoint.includes('?') ? '&' : '?'}limit=${limit}`);
    const presets = res.data.presets || res.data || [];
    if (!presets.length) return ctx.reply(`😕 ${title}: कोई preset नहीं मिला।`, mainMenu(ctx.dbUser));
    await ctx.reply(`📦 *${title}* — ${presets.length} results`, { parse_mode: 'Markdown' });
    const buttons = presets.map(p => Markup.button.callback(`${(p.name || 'Preset').slice(0, 18)}`, `preset_${p.id}`));
    await ctx.reply('नीचे preset चुनें:', Markup.inlineKeyboard(inlineRows(buttons, 3)));
  } catch (e) {
    console.error('Preset list error:', e.message);
    await ctx.reply('❌ Presets load नहीं हो सके।');
  }
}

async function handleDownload(ctx, presetId) {
  if (!requireLogin(ctx)) return;
  try {
    const result = await axios.post(`${API_BASE}/presets/${presetId}/download`, {}, { headers: apiHeaders(ctx.dbUser), timeout: 20000 });
    const url = result.data.downloadUrl;
    if (!url) return ctx.reply('❌ Download link उपलब्ध नहीं है।');
    const file = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
    const filename = result.data.originalName || `presethub-${presetId}.xmp`;
    await ctx.replyWithDocument({ source: Buffer.from(file.data), filename }, { caption: '✅ Preset download हो गया।' });
  } catch (err) {
    const status = err.response?.status;
    if (status === 401) return ctx.reply('🔐 Login required. `/login` करें।', { parse_mode: 'Markdown' });
    if (status === 403) return ctx.reply('🔒 यह paid preset है या purchase required है।');
    if (status === 404) return ctx.reply('❌ Preset/file server पर उपलब्ध नहीं है।');
    console.error('Download error:', err.message);
    await ctx.reply('❌ Download failed. कुछ देर बाद फिर प्रयास करें।');
  }
}

async function showDashboard(ctx) {
  if (!requireLogin(ctx)) return;
  try {
    const r = await axios.get(`${API_BASE}/users/me/dashboard`, { headers: apiHeaders(ctx.dbUser) });
    const d = r.data;
    const msg = `🏠 *PresetHub Dashboard*\n\n👤 ${safeText(d.user?.name || 'User')}\n@${safeText(d.user?.username || 'user')}\n\n📦 My Presets: ${(d.presets || []).length}\n⬇️ Downloads: ${d.downloads || 0}\n👥 Followers: ${d.followers || 0}\n👤 Following: ${d.following || 0}\n👁 Views: ${d.stats?.views || 0}\n❤️ Likes: ${d.stats?.likes || 0}\n↗️ Shares: ${d.stats?.shares || 0}\n🔔 Unread: ${d.unreadNotifications || 0}`;
    await ctx.replyWithMarkdown(msg, Markup.inlineKeyboard([
      [Markup.button.callback('📦 My Presets', 'my_presets'), Markup.button.callback('⬇️ Downloads', 'my_downloads'), Markup.button.callback('🔔 Notifications', 'notifications')],
      [Markup.button.callback('👤 Profile', 'profile'), Markup.button.callback('📤 Upload', 'upload_start')]
    ]));
  } catch (e) { console.error('Dashboard:', e.message); ctx.reply('❌ Dashboard load नहीं हुआ।'); }
}

async function showDownloads(ctx) {
  if (!requireLogin(ctx)) return;
  try {
    const r = await axios.get(`${API_BASE}/users/me/downloads`, { headers: apiHeaders(ctx.dbUser) });
    const rows = r.data || [];
    if (!rows.length) return ctx.reply('⬇️ अभी कोई downloaded preset नहीं है।');
    await ctx.reply(`⬇️ *My Downloads* — ${rows.length} presets`, { parse_mode: 'Markdown' });
    const buttons = rows.slice(0, 30).map(p => Markup.button.callback(`⬇️ ${(p.name || 'Preset').slice(0, 16)}`, `download_${p.id}`));
    await ctx.reply('Preview/list:', Markup.inlineKeyboard(inlineRows(buttons, 3)));
    for (const p of rows.slice(0, 6)) if (p.previewImage && /^https?:\/\//i.test(p.previewImage)) {
      try { await ctx.replyWithPhoto(p.previewImage, { caption: `🎨 ${safeText(p.name)} · ${money(p.price)} · ⭐ ${Number(p.avgRating || 0).toFixed(1)}` }); } catch (_) {}
    }
  } catch (e) { console.error('Downloads:', e.message); ctx.reply('❌ Downloads load नहीं हुए।'); }
}

async function showNotifications(ctx) {
  if (!requireLogin(ctx)) return;
  try {
    const r = await axios.get(`${API_BASE}/users/me/notifications`, { headers: apiHeaders(ctx.dbUser) });
    const rows = r.data || [];
    if (!rows.length) return ctx.reply('🔔 कोई notification नहीं है।');
    const msg = rows.slice(0, 20).map((n, i) => `${i + 1}. ${n.read ? '✓' : '•'} ${safeText(n.message, 220)}\n   ${n.createdAt ? new Date(n.createdAt).toLocaleString('en-IN') : ''}`).join('\n\n');
    await ctx.reply(`🔔 *Notifications*\n\n${msg}`, { parse_mode: 'Markdown' });
    await axios.post(`${API_BASE}/users/notifications/read-all`, {}, { headers: apiHeaders(ctx.dbUser) }).catch(() => {});
  } catch (e) { console.error('Notifications:', e.message); ctx.reply('❌ Notifications load नहीं हुए।'); }
}

async function showProfile(ctx) {
  if (!requireLogin(ctx)) return;
  const u = ctx.dbUser;
  const msg = `👤 *Profile*\n\nनाम: ${safeText(u.name)}\nUsername: @${safeText(u.username || 'user')}\nEmail: ${safeText(u.email)}\nRole: ${u.role}\nTelegram: @${safeText(u.telegram?.username || ctx.from.username || 'private')}\nStatus: ${u.status || 'active'}\nCommands: ${u.commandsCount || 0}\nLast active: ${u.lastActive ? new Date(u.lastActive).toLocaleString('en-IN') : 'now'}`;
  await ctx.replyWithMarkdown(msg, mainMenu(u));
}

async function showMyPresets(ctx) {
  if (!requireLogin(ctx)) return;
  try {
    const r = await axios.get(`${API_BASE}/users/me/dashboard`, { headers: apiHeaders(ctx.dbUser) });
    const rows = r.data.presets || [];
    if (!rows.length) return ctx.reply('📦 आपने अभी कोई preset upload नहीं किया।');
    const buttons = rows.slice(0, 30).map(p => Markup.button.callback(`${p.status === 'approved' ? '✅' : '⏳'} ${(p.name || 'Preset').slice(0, 16)}`, `preset_${p.id}`));
    await ctx.reply(`📦 *My Presets* — ${rows.length} shown`, { parse_mode: 'Markdown' });
    await ctx.reply('3-column list:', Markup.inlineKeyboard(inlineRows(buttons, 3)));
  } catch (e) { console.error('My presets:', e.message); ctx.reply('❌ My presets load नहीं हुए।'); }
}

async function showLatest(ctx) { return listPresets(ctx, '/presets?sort=newest', 'Latest Presets', 18); }
async function showAllPresets(ctx) { return listPresets(ctx, '/presets?sort=popular', 'Popular / Total Presets', 18); }

async function sharePreset(ctx, id) {
  if (!requireLogin(ctx)) return;
  try {
    const r = await axios.post(`${API_BASE}/share/create`, { presetId: id, platform: 'telegram' }, { headers: apiHeaders(ctx.dbUser) });
    await ctx.reply(`🔗 *Share link*\n\n${r.data.shortUrl || r.data.fullUrl}`, { parse_mode: 'Markdown' });
  } catch (e) { console.error('Share:', e.message); ctx.reply('❌ Share link नहीं बना।'); }
}

async function startUpload(ctx) {
  if (!requireLogin(ctx)) return;
  uploadStates.set(ctx.chat.id, { step: 'name', data: {} });
  await ctx.reply('📤 *Upload Preset*\n\n1/5 — Preset का नाम भेजें।\n/cancel से cancel करें।', { parse_mode: 'Markdown' });
}

async function finishUpload(ctx) {
  const st = uploadStates.get(ctx.chat.id);
  if (!st?.data?.fileBuffer) return ctx.reply('❌ Preset file missing. फिर `/upload` करें।');
  const form = new FormData();
  form.append('name', st.data.name);
  form.append('category', st.data.category || 'General');
  form.append('price', String(st.data.price || 0));
  form.append('description', st.data.description || '');
  form.append('tags', st.data.tags || '');
  form.append('uploadId', `tg-${ctx.from.id}-${Date.now()}`);
  form.append('file', st.data.fileBuffer, { filename: st.data.fileName, contentType: st.data.fileMime || 'application/octet-stream' });
  if (st.data.previewBuffer) form.append('previewImage', st.data.previewBuffer, { filename: st.data.previewName || 'preview.jpg', contentType: st.data.previewMime || 'image/jpeg' });
  try {
    await ctx.reply('⏳ Preset server पर upload हो रहा है…');
    const r = await axios.post(`${API_BASE}/presets`, form, { headers: { ...form.getHeaders(), ...apiHeaders(ctx.dbUser) }, maxContentLength: Infinity, maxBodyLength: Infinity, timeout: 120000 });
    uploadStates.delete(ctx.chat.id);
    await ctx.reply(`✅ *Upload complete!*\n\n🎨 ${safeText(r.data.name)}\n📂 ${safeText(r.data.category)}\n💰 ${money(r.data.price)}\n🆔 ${r.data.id}`, { parse_mode: 'Markdown', ...mainMenu(ctx.dbUser) });
  } catch (e) {
    console.error('Upload API:', e.response?.data || e.message);
    await ctx.reply(`❌ Upload failed: ${safeText(e.response?.data?.error || e.message, 300)}`);
  }
}

async function adminDashboard(ctx) {
  if (!requireAdmin(ctx)) return;
  try {
    const r = await axios.get(`${API_BASE}/admin/analytics`, { headers: apiHeaders(ctx.dbUser) });
    const d = r.data;
    const msg = `🛠️ *PresetHub Admin Dashboard*\n\n👥 Users: ${d.totalUsers || 0}\n📦 Presets: ${d.totalPresets || 0}\n⬇️ Downloads: ${d.totalDownloads || 0}\n👁 Views: ${d.totalViews || 0}\n❤️ Likes: ${d.totalLikes || 0}\n↗️ Shares: ${d.totalShares || 0}\n⭐ Avg Rating: ${d.avgRating || 0}\n💰 Revenue: ₹${Number(d.totalRevenue || 0).toFixed(2)}`;
    await ctx.replyWithMarkdown(msg, Markup.inlineKeyboard([
      [Markup.button.callback('👥 Users', 'admin_users'), Markup.button.callback('📦 Presets', 'admin_presets'), Markup.button.callback('📊 Analytics', 'admin_refresh')],
      [Markup.button.callback('🔔 Broadcast', 'admin_broadcast_help')]
    ]));
  } catch (e) { console.error('Admin dashboard:', e.message); ctx.reply('❌ Admin data load नहीं हुआ।'); }
}

async function adminUsers(ctx) {
  if (!requireAdmin(ctx)) return;
  try {
    const r = await axios.get(`${API_BASE}/admin/users?limit=30`, { headers: apiHeaders(ctx.dbUser) });
    const users = r.data?.items || r.data?.users || (Array.isArray(r.data) ? r.data : []);
    if (!users.length) return ctx.reply('👥 कोई user नहीं मिला।');
    const buttons = users.slice(0, 30).map(u => Markup.button.callback(`${u.role === 'admin' ? '👑' : '👤'} ${(u.name || u.username || 'User').slice(0, 16)}`, `admin_user_${u.id}`));
    await ctx.reply(`👥 *Users* — ${users.length}`, { parse_mode: 'Markdown' });
    await ctx.reply('3-column user list:', Markup.inlineKeyboard(inlineRows(buttons, 3)));
  } catch (e) { console.error('Admin users:', e.message); ctx.reply('❌ Users load नहीं हुए।'); }
}

async function adminPresets(ctx) {
  if (!requireAdmin(ctx)) return;
  try {
    const r = await axios.get(`${API_BASE}/admin/presets?limit=30`, { headers: apiHeaders(ctx.dbUser) });
    const presets = r.data?.items || r.data?.presets || (Array.isArray(r.data) ? r.data : []);
    if (!presets.length) return ctx.reply('📦 कोई preset नहीं मिला।');
    const buttons = presets.slice(0, 30).map(p => Markup.button.callback(`${p.status === 'approved' ? '✅' : p.status === 'rejected' ? '❌' : '⏳'} ${(p.name || 'Preset').slice(0, 16)}`, `preset_${p.id}`));
    await ctx.reply(`📦 *Admin Presets* — ${presets.length}`, { parse_mode: 'Markdown' });
    await ctx.reply('3-column list:', Markup.inlineKeyboard(inlineRows(buttons, 3)));
  } catch (e) { console.error('Admin presets:', e.message); ctx.reply('❌ Presets load नहीं हुए।'); }
}

async function adminUserDetails(ctx, id) {
  if (!requireAdmin(ctx)) return;
  try {
    const r = await axios.get(`${API_BASE}/admin/users/${id}/details`, { headers: apiHeaders(ctx.dbUser) });
    const u = r.data.user || r.data;
    const msg = `👤 *User Details*\n\nName: ${safeText(u.name)}\nUsername: @${safeText(u.username || 'user')}\nEmail: ${safeText(u.email)}\nRole: ${u.role}\nStatus: ${u.status}\nVerified: ${u.verified ? 'Yes' : 'No'}\nTelegram: ${u.telegramId ? 'Linked' : 'No'}\nPresets: ${u.stats?.totalPresets ?? u.totalPresets ?? 0}\nDownloads: ${u.stats?.totalDownloads ?? u.totalDownloads ?? 0}\nViews: ${u.stats?.views ?? 0}\nLikes: ${u.stats?.likes ?? 0}\nShares: ${u.stats?.shares ?? 0}`;
    await ctx.replyWithMarkdown(msg);
  } catch (e) { console.error('Admin user detail:', e.message); ctx.reply('❌ User details नहीं मिले।'); }
}

function registerHandlers() {
  bot.use(async (ctx, next) => {
    try {
      if (ctx.from) await saveTelegramUser(ctx);
      ctx.dbUser = ctx.from ? await getUserByTelegramId(ctx.from.id) : null;
    } catch (e) { console.error('Bot middleware DB:', e.message); }
    return next();
  });

  bot.start(async ctx => {
    await ctx.reply(`🎨 *PresetHub Bot*\n\nनमस्ते ${safeText(ctx.from.first_name || 'Creator')} 👋\n\nWebsite के presets खोजें, preview करें, download करें, upload करें और अपना dashboard manage करें।\n\n🌐 ${SITE_URL}`, { parse_mode: 'Markdown', ...mainMenu(ctx.dbUser) });
    if (ADMIN_CHAT_ID && String(ctx.chat.id) !== ADMIN_CHAT_ID) bot.telegram.sendMessage(ADMIN_CHAT_ID, `👤 New bot user: ${safeText(ctx.from.first_name)} (@${safeText(ctx.from.username || 'No username')})`).catch(() => {});
  });

  bot.command('help', ctx => ctx.reply(`📚 *Commands*\n\n/start\n/signup\n/login\n/logout\n/profile\n/dashboard\n/search <query>\n/latest\n/presets\n/categories\n/category <name>\n/popular\n/top\n/preset <id>\n/download <id>\n/downloads\n/myorders\n/mypresets\n/notifications\n/share <preset-id>\n/upload\n/subscription\n/referral\n/earnings\n/accounthelp\n/admin`, { parse_mode: 'Markdown', ...mainMenu(ctx.dbUser) }));
  bot.command('signup', ctx => ctx.reply(`📝 Website पर account बनाएं:\n${SITE_URL}/?action=signup`, mainMenu(ctx.dbUser)));
  bot.command('login', async ctx => {
    if (ctx.dbUser?.token) return ctx.reply('✅ आपका account पहले से linked है।', mainMenu(ctx.dbUser));
    loginStates.set(ctx.chat.id, { step: 'email' });
    await ctx.reply('📧 Account email भेजें।\n/cancel से cancel करें।');
  });
  bot.command('logout', async ctx => { if (!ctx.dbUser?.telegramId) return ctx.reply('आप linked नहीं हैं।'); await unlinkTelegramId(ctx.from.id); ctx.dbUser = null; await ctx.reply('✅ Telegram account unlink हो गया।', mainMenu(null)); });
  bot.command('profile', showProfile);
  bot.command('dashboard', showDashboard);
  bot.command('downloads', showDownloads);
  bot.command('notifications', showNotifications);
  bot.command('mypresets', showMyPresets);
  bot.command('latest', showLatest);
  bot.command('recent', showLatest);
  bot.command('presets', showAllPresets);
  bot.command('popular', ctx => listPresets(ctx, '/presets?sort=popular', 'Popular Presets', 18));
  bot.command('top', async ctx => {
    try { const r = await axios.get(`${API_BASE}/users/top`); const rows=r.data||[]; await ctx.reply(`🏆 *Top Creators*\n\n${rows.map((u,i)=>`${i+1}. ${safeText(u.name||u.username)} · ${u.presetCount||0} presets · ${u.totalDownloads||0} downloads`).join('\n')||'No creators yet.'}`, {parse_mode:'Markdown'}); } catch(e){ctx.reply('❌ Creators load नहीं हुए।');}
  });
  bot.command('categories', async ctx => { try { const cats=await Preset.distinct('category',{status:'approved'}); await ctx.reply(`📂 *Categories*\n\n${cats.map(c=>`• ${safeText(c)}`).join('\n')||'No categories.'}\n\n/category <name>`,{parse_mode:'Markdown'}); } catch(e){ctx.reply('❌ Categories load नहीं हुईं।');} });
  bot.command('category', async ctx => { const cat=ctx.message.text.split(' ').slice(1).join(' '); if(!cat)return ctx.reply('Usage: /category <name>'); return listPresets(ctx,`/presets?category=${encodeURIComponent(cat)}&sort=popular`,`Category: ${cat}`,18); });
  bot.command('search', async ctx => { const q=ctx.message.text.split(' ').slice(1).join(' ').trim(); if(!q)return ctx.reply('Usage: /search <query>'); try { const r=await axios.get(`${API_BASE}/presets/global-search?q=${encodeURIComponent(q)}`); const rows=r.data.presets||[]; if(!rows.length)return ctx.reply('😕 No results.'); const buttons=rows.slice(0,18).map(p=>Markup.button.callback(`${(p.name||'Preset').slice(0,18)}`,`preset_${p.id}`)); await ctx.reply(`🔍 *${safeText(q)}* — ${rows.length} presets`,{parse_mode:'Markdown'}); await ctx.reply('Results:',Markup.inlineKeyboard(inlineRows(buttons,3))); } catch(e){ctx.reply('❌ Search failed.');} });
  bot.command('preset', async ctx => { const id=ctx.message.text.split(' ')[1]; if(!id)return ctx.reply('Usage: /preset <id>'); try { const r=await axios.get(`${API_BASE}/presets/${id}`); return sendPresetCard(ctx,r.data); } catch(e){ctx.reply('❌ Preset नहीं मिला।');} });
  bot.command('download', async ctx => { const id=ctx.message.text.split(' ')[1]; if(!id)return ctx.reply('Usage: /download <id>'); return handleDownload(ctx,id); });
  bot.command('share', async ctx => { const id=ctx.message.text.split(' ')[1]; if(!id)return ctx.reply('Usage: /share <preset-id>'); return sharePreset(ctx,id); });
  bot.command('myorders', async ctx => { if(!requireLogin(ctx))return; try { const r=await axios.get(`${API_BASE}/payments/my-orders`,{headers:apiHeaders(ctx.dbUser)}); const rows=r.data||[]; await ctx.reply(`🛒 *My Orders*\n\n${rows.map(o=>`• ${o.presetId}\n  ₹${o.amount} · ${o.status} · ${new Date(o.createdAt).toLocaleDateString('en-IN')}`).join('\n\n')||'No orders yet.'}`,{parse_mode:'Markdown'}); } catch(e){ctx.reply('❌ Orders load नहीं हुए।');} });
  bot.command('subscription', async ctx => { if(!requireLogin(ctx))return; try { const r=await axios.get(`${API_BASE}/users/me/subscription`,{headers:apiHeaders(ctx.dbUser)}); const s=r.data; await ctx.reply(`👑 *Subscription*\n\nStatus: ${s.isPremium?'Premium':'Free'}\nExpiry: ${s.expiry||'—'}\nAd Watches: ${s.adWatchCount||0}\nReferral: ${s.referralCode||'—'}`,{parse_mode:'Markdown'}); } catch(e){ctx.reply('❌ Subscription load नहीं हुआ।');} });
  bot.command('referral', async ctx => { if(!requireLogin(ctx))return; try { const r=await axios.post(`${API_BASE}/users/referrals/generate`,{}, {headers:apiHeaders(ctx.dbUser)}); await ctx.reply(`🔗 Referral code: \`${r.data.referralCode}\``,{parse_mode:'Markdown'}); } catch(e){ctx.reply('❌ Referral code नहीं बना।');} });
  bot.command('earnings', async ctx => { if(!requireLogin(ctx))return; try { const r=await axios.get(`${API_BASE}/users/${ctx.dbUser.id}/earnings`,{headers:apiHeaders(ctx.dbUser)}); const e=r.data; await ctx.reply(`💰 *Earnings*\n\nRevenue: ₹${Number(e.totalRevenue||0).toFixed(2)}\nDownloads: ${e.totalDownloads||0}\nImpressions: ${e.totalImpressions||0}`,{parse_mode:'Markdown'}); } catch(e){ctx.reply('❌ Earnings load नहीं हुई।');} });
  bot.command('accounthelp', async ctx => { await ctx.reply('🆘 Account help\n\nReply with one of these exact commands:\n/passwordhelp — forgot password\n/deletehelp — request account deletion\n/accesshelp — account access issue\n/blockhelp — review a blocked account'); });
  bot.command('passwordhelp', async ctx => { await submitAccountHelp(ctx, 'password_reset', 'I forgot my password and need a password reset.'); await ctx.reply('✅ Password reset request admin को भेज दी गई है.'); });
  bot.command('deletehelp', async ctx => { await submitAccountHelp(ctx, 'delete_account', 'I want to request account deletion.'); await ctx.reply('✅ Account deletion request admin को भेज दी गई है.'); });
  bot.command('accesshelp', async ctx => { await submitAccountHelp(ctx, 'account_access', 'I cannot access my account.'); await ctx.reply('✅ Account access request admin को भेज दी गई है.'); });
  bot.command('blockhelp', async ctx => { await submitAccountHelp(ctx, 'block_review', 'Please review my blocked account.'); await ctx.reply('✅ Block review request admin को भेज दी गई है.'); });
  bot.command('upload', startUpload);
  bot.command('cancel', async ctx => { loginStates.delete(ctx.chat.id); uploadStates.delete(ctx.chat.id); await ctx.reply('❌ Current action cancelled.', mainMenu(ctx.dbUser)); });

  bot.command('admin', adminDashboard);
  bot.command('adminusers', adminUsers);

  bot.on('text', async (ctx, next) => {
    const chatId=ctx.chat.id, text=ctx.message.text.trim();
    const login=loginStates.get(chatId);
    if(login){
      if(login.step==='email'){ login.email=text.toLowerCase(); login.step='password'; return ctx.reply('🔑 Password भेजें। (यह केवल temporary bot session में रहेगा)'); }
      if(login.step==='password'){
        try { const r=await axios.post(`${API_BASE}/auth/login`,{email:login.email,password:text}); const setCookie = r.headers?.['set-cookie']?.find(x => x.startsWith('ph_auth=')) || ''; const token = setCookie.split(';',1)[0].replace(/^ph_auth=/,''); if(!token) throw new Error('Login session unavailable'); await linkTelegramId(r.data.user.id,ctx.from.id,token,ctx); loginStates.delete(chatId); ctx.dbUser=await getUserByTelegramId(ctx.from.id); return ctx.reply(`✅ Login successful — ${safeText(r.data.user.name)}`,mainMenu(ctx.dbUser)); }
        catch(e){ loginStates.delete(chatId); return ctx.reply('❌ Email/password गलत है या server unavailable है।'); }
      }
    }
    const up=uploadStates.get(chatId);
    if(up){
      if(up.step==='name'){up.data.name=text.slice(0,100);up.step='category';return ctx.reply('📂 2/5 — Category भेजें।');}
      if(up.step==='category'){up.data.category=text.slice(0,50)||'General';up.step='price';return ctx.reply('💰 3/5 — Price भेजें (0 = Free)।');}
      if(up.step==='price'){const n=Number(text);if(!Number.isFinite(n)||n<0)return ctx.reply('❌ Valid price भेजें, जैसे 0 या 49.');up.data.price=Math.min(999999.99,n);up.step='description';return ctx.reply('📝 4/5 — Description भेजें या `skip` लिखें।',{parse_mode:'Markdown'});}
      if(up.step==='description'){up.data.description=text.toLowerCase()==='skip'?'':text.slice(0,500);up.step='file';return ctx.reply('📎 5/5 — अब preset file (.xmp/.dng/.lrtemplate/.cube/.zip आदि) document के रूप में भेजें।');}
      if(up.step==='preview'){ if(text.toLowerCase()==='/skip'){up.step='done';return finishUpload(ctx);} return ctx.reply('🖼️ Preview image भेजें या /skip लिखें।'); }
    }
    const actions={
      '🏠 Dashboard':()=>showDashboard(ctx),'🔍 Search':()=>ctx.reply('🔍 Search: `/search sunset`',{parse_mode:'Markdown'}),'🆕 Latest':()=>showLatest(ctx),'📦 Presets':()=>showAllPresets(ctx),
      '⬇️ Downloads':()=>showDownloads(ctx),'🔔 Notifications':()=>showNotifications(ctx),'👤 Profile':()=>showProfile(ctx),'📤 Upload Preset':()=>startUpload(ctx),
      '🔗 Share Preset':()=>ctx.reply('🔗 Share: `/share <preset-id>`',{parse_mode:'Markdown'}),'🛒 My Orders':()=>ctx.reply('🛒 `/myorders`',{parse_mode:'Markdown'}),'❓ Help':()=>ctx.replyWithMarkdown('/help'),
      '🛠️ Admin Dashboard':()=>adminDashboard(ctx),'👥 Admin Users':()=>adminUsers(ctx),
      '🆘 Account Help':async()=>{await ctx.reply('🆘 Account help: /passwordhelp, /deletehelp, /accesshelp, /blockhelp');}
    };
    if(actions[text]) return actions[text]();
    return next();
  });

  bot.on('document', async ctx => {
    const up=uploadStates.get(ctx.chat.id); if(!up || up.step!=='file') return;
    const doc=ctx.message.document; const ext=path.extname(doc.file_name||'').toLowerCase();
    const allowed=['.dng','.xmp','.lrtemplate','.cube','.3dl','.look','.costyle','.xml','.json','.zip'];
    if(!allowed.includes(ext)) return ctx.reply(`❌ Unsupported file. Allowed: ${allowed.join(', ')}`);
    try { const url=await ctx.telegram.getFileLink(doc.file_id); const r=await axios.get(url,{responseType:'arraybuffer',timeout:120000}); up.data.fileBuffer=Buffer.from(r.data);up.data.fileName=doc.file_name;up.data.fileMime=doc.mime_type||'application/octet-stream';up.step='preview'; await ctx.reply('✅ Preset file received. अब preview image भेजें या /skip करें।'); }
    catch(e){console.error('Telegram file:',e.message);ctx.reply('❌ Telegram file download नहीं हो पाया।');}
  });
  bot.on('photo', async ctx => {
    const up=uploadStates.get(ctx.chat.id); if(!up || up.step!=='preview') return;
    try { const photo=ctx.message.photo[ctx.message.photo.length-1]; const url=await ctx.telegram.getFileLink(photo.file_id); const r=await axios.get(url,{responseType:'arraybuffer',timeout:60000}); up.data.previewBuffer=Buffer.from(r.data);up.data.previewName=`telegram-${Date.now()}.jpg`;up.data.previewMime='image/jpeg';await finishUpload(ctx); }
    catch(e){console.error('Telegram photo:',e.message);ctx.reply('❌ Preview upload नहीं हो पाया। /skip करके continue कर सकते हैं।');}
  });

  bot.action(/^preset_(.+)$/, async ctx => { try { const r=await axios.get(`${API_BASE}/presets/${ctx.match[1]}`); await ctx.answerCbQuery(); return sendPresetCard(ctx,r.data); } catch(e){await ctx.answerCbQuery('Preset नहीं मिला');} });
  bot.action(/^download_(.+)$/, async ctx => { await ctx.answerCbQuery('Downloading…'); return handleDownload(ctx,ctx.match[1]); });
  bot.action(/^share_(.+)$/, async ctx => { await ctx.answerCbQuery(); return sharePreset(ctx,ctx.match[1]); });
  bot.action(/^wishlist_(.+)$/, async ctx => { if(!requireLogin(ctx))return ctx.answerCbQuery('Login required'); try { await axios.post(`${API_BASE}/users/me/wishlist/${ctx.match[1]}`,{}, {headers:apiHeaders(ctx.dbUser)}); await ctx.answerCbQuery('❤️ Wishlist updated'); } catch(e){await ctx.answerCbQuery('Failed');} });
  bot.action('my_downloads', async ctx=>{await ctx.answerCbQuery();return showDownloads(ctx);});
  bot.action('my_presets', async ctx=>{await ctx.answerCbQuery();return showMyPresets(ctx);});
  bot.action('notifications', async ctx=>{await ctx.answerCbQuery();return showNotifications(ctx);});
  bot.action('profile', async ctx=>{await ctx.answerCbQuery();return showProfile(ctx);});
  bot.action('upload_start', async ctx=>{await ctx.answerCbQuery();return startUpload(ctx);});
  bot.action('admin_users', async ctx=>{await ctx.answerCbQuery();return adminUsers(ctx);});
  bot.action('admin_presets', async ctx=>{await ctx.answerCbQuery();return adminPresets(ctx);});
  bot.action('admin_refresh', async ctx=>{await ctx.answerCbQuery();return adminDashboard(ctx);});
  bot.action('admin_broadcast_help', async ctx=>{await ctx.answerCbQuery();return ctx.reply('📣 Broadcast is available from the secure website Admin Panel. Telegram admin broadcast execution is intentionally not enabled by default.');});
  bot.action(/^admin_user_(.+)$/, async ctx=>{await ctx.answerCbQuery();return adminUserDetails(ctx,ctx.match[1]);});
}

async function startBot() {
  if (!BOT_TOKEN) { console.warn('⚠️ Telegram bot disabled: BOT_TOKEN not configured.'); return false; }
  if (botStarted || botStarting) return botStarted;
  botStarting=true;
  try {
    await connectDB();
    if (!bot) { bot=new Telegraf(BOT_TOKEN); registerHandlers(); }
    await bot.launch({ dropPendingUpdates: true });
    await bot.telegram.setMyCommands([
      {command:'start',description:'Open PresetHub bot'}, {command:'signup',description:'Create account on website'},
      {command:'login',description:'Link your PresetHub account'}, {command:'profile',description:'View profile'},
      {command:'dashboard',description:'Open dashboard'}, {command:'search',description:'Search presets/users/tags'},
      {command:'latest',description:'Latest presets'}, {command:'presets',description:'Browse presets'},
      {command:'downloads',description:'My downloaded presets'}, {command:'mypresets',description:'My uploaded presets'},
      {command:'notifications',description:'View notifications'}, {command:'share',description:'Create preset share link'},
      {command:'upload',description:'Upload a preset'}, {command:'myorders',description:'My orders'},
      {command:'admin',description:'Admin dashboard (admin only)'}
    ]).catch(e => console.warn('Telegram command menu setup failed:', e.message));
    botStarted=true;
    console.log('✅ Telegram bot started inside PresetHub web server.');
    return true;
  } catch(e) {
    console.error('❌ Telegram bot launch error:', e.message);
    botStarted=false;
    return false;
  } finally { botStarting=false; }
}
async function stopBot(signal='SIGTERM') { if(!botStarted || !bot)return; try{bot.stop(signal);}catch(_){} botStarted=false; }
function getBotStatus(){ return { configured:!!BOT_TOKEN, started:botStarted, apiBase:API_BASE }; }

if (require.main === module) { startBot(); process.once('SIGINT',()=>stopBot('SIGINT'));process.once('SIGTERM',()=>stopBot('SIGTERM')); }
module.exports={ startBot, stopBot, getBotStatus };
