// PresetHub Telegram Bot
// Uses the same MongoDB models/JWT/API as the main PresetHub backend.
require('dotenv').config();

const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { connectDB } = require('./config/db');
const { User, Preset } = require('./models');

const BOT_TOKEN = String(process.env.BOT_TOKEN || '').trim();
const ADMIN_CHAT_ID = String(process.env.ADMIN_CHAT_ID || '').trim();
const API_BASE = String(process.env.API_BASE || 'https://presethub.site/api').replace(/\/+$/, '');
const SITE_URL = String(process.env.CLIENT_URL || 'https://presethub.site').replace(/\/+$/, '');
const JWT_SECRET = String(process.env.JWT_SECRET || '');

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is missing. Telegram bot worker will not start.');
  process.exit(1);
}
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('❌ JWT_SECRET must be configured and at least 32 characters long.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN, {
  handlerTimeout: 30_000,
});

const loginStates = new Map();
const uploadStates = new Map();

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function apiHeaders(user) {
  return user?.token ? { Authorization: `Bearer ${user.token}` } : {};
}

function issueToken(user) {
  return jwt.sign(
    { id: user._id.toString(), email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

async function getUserByTelegramId(telegramId) {
  await connectDB();
  return User.findOne({ telegramId: String(telegramId) });
}

async function saveTelegramUser(ctx) {
  if (!ctx.from) return null;
  await connectDB();

  const telegramId = String(ctx.from.id);
  let user = await User.findOne({ telegramId });

  if (!user) {
    const email = `telegram_${telegramId}@telegram.presethub.site`;
    const usernameBase = String(ctx.from.username || `telegram_${telegramId}`)
      .toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24) || `telegram_${telegramId}`;

    let username = usernameBase;
    let suffix = 1;
    while (await User.exists({ username })) {
      username = `${usernameBase.slice(0, 20)}_${suffix++}`;
    }

    const password = await bcrypt.hash(`${telegramId}:${Date.now()}:${Math.random()}`, 12);
    user = await User.create({
      email,
      password,
      name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || 'Telegram User',
      username,
      role: 'user',
      verified: true,
      telegramId,
      telegram: {
        firstName: ctx.from.first_name || '',
        lastName: ctx.from.last_name || '',
        username: ctx.from.username || '',
        languageCode: ctx.from.language_code || '',
      },
      lastActive: new Date(),
      commandsCount: 1,
    });
  } else {
    user.telegram = {
      firstName: ctx.from.first_name || '',
      lastName: ctx.from.last_name || '',
      username: ctx.from.username || '',
      languageCode: ctx.from.language_code || '',
    };
    user.lastActive = new Date();
    user.commandsCount = Number(user.commandsCount || 0) + 1;
    await user.save();
  }

  // Refresh the stored API token when missing or expired. This lets Telegram users
  // keep using authenticated API actions after a bot restart / token expiry.
  let tokenValid = false;
  if (user.token) {
    try { jwt.verify(user.token, JWT_SECRET); tokenValid = true; } catch (_) {}
  }
  if (!tokenValid) {
    user.token = issueToken(user);
    await user.save();
  }

  return user;
}

async function linkTelegramId(userId, telegramId, token, ctx) {
  await connectDB();
  const current = await User.findById(userId);
  if (!current) throw new Error('User not found');

  const oldLink = await User.findOne({ telegramId: String(telegramId), _id: { $ne: current._id } });
  if (oldLink) {
    // Only remove bot-created synthetic accounts; never delete a real account.
    if (String(oldLink.email || '').endsWith('@telegram.presethub.site')) {
      await oldLink.deleteOne();
    } else {
      oldLink.telegramId = undefined;
      oldLink.telegram = undefined;
      oldLink.token = '';
      await oldLink.save();
    }
  }

  current.telegramId = String(telegramId);
  current.token = token;
  current.telegram = {
    firstName: ctx.from.first_name || '',
    lastName: ctx.from.last_name || '',
    username: ctx.from.username || '',
    languageCode: ctx.from.language_code || '',
  };
  current.lastActive = new Date();
  current.commandsCount = Number(current.commandsCount || 0) + 1;
  await current.save();
  return current;
}

async function unlinkTelegramId(telegramId) {
  await connectDB();
  const user = await User.findOne({ telegramId: String(telegramId) });
  if (!user) return;

  if (String(user.email || '').endsWith('@telegram.presethub.site')) {
    await user.deleteOne();
  } else {
    user.telegramId = undefined;
    user.telegram = undefined;
    user.token = '';
    await user.save();
  }
}

function publicPresetLine(p) {
  const price = Number(p.price || 0) === 0 ? 'मुफ्त' : `₹${Number(p.price).toFixed(2)}`;
  const tags = Array.isArray(p.tags) && p.tags.length ? `\n   🏷️ ${p.tags.slice(0, 4).map(escapeHtml).join(', ')}` : '';
  return `• <b>${escapeHtml(p.name)}</b> — ${escapeHtml(p.author || 'Creator')}\n   💰 ${price} | ⭐ ${Number(p.avgRating || 0).toFixed(1)} | ⬇️ ${Number(p.downloads || 0)}${tags}\n   🆔 <code>${escapeHtml(p.id)}</code>`;
}

async function handleDownload(ctx, presetId) {
  const user = ctx.dbUser || await getUserByTelegramId(ctx.from?.id);
  if (!user?.token) {
    return ctx.reply('कृपया पहले /login करें।');
  }

  await ctx.sendChatAction('typing');
  try {
    const res = await axios.post(
      `${API_BASE}/presets/${encodeURIComponent(presetId)}/download`,
      {},
      { headers: apiHeaders(user), timeout: 20_000 }
    );

    const { downloadUrl, originalName } = res.data || {};
    if (!downloadUrl) throw new Error('Download URL missing from API response');

    // Telegram fetches the short-lived signed/local download URL directly.
    await ctx.replyWithDocument(
      { url: downloadUrl, filename: originalName || 'preset.xmp' },
      { caption: `✅ ${escapeHtml(originalName || 'Preset')} डाउनलोड हो गया।`, parse_mode: 'HTML' }
    );
  } catch (err) {
    const status = err?.response?.status;
    const apiError = err?.response?.data?.error;
    console.error('Download error:', status || '', apiError || err.message);
    if (status === 401) return ctx.reply('🔐 आपका Telegram login expire हो गया है। /login दोबारा करें।');
    if (status === 403) return ctx.reply('⛔ यह paid preset है। पहले वेबसाइट पर purchase करें।');
    if (status === 404) return ctx.reply('❌ Preset/file server पर नहीं मिली।');
    return ctx.reply('❌ Download विफल हुआ। कृपया थोड़ी देर बाद फिर कोशिश करें।');
  }
}

const mainMenu = Markup.keyboard([
  ['🔍 खोजें', '📂 श्रेणियाँ'],
  ['🔥 लोकप्रिय', '🆕 नए'],
  ['👤 मेरा अकाउंट', '🛒 मेरे ऑर्डर'],
  ['📋 मेरे प्रीसेट', '🌐 वेबसाइट'],
  ['📤 अपलोड करें', '📊 एडमिन पैनल'],
]).resize();

// ==================== DATABASE MIDDLEWARE ====================
bot.use(async (ctx, next) => {
  try {
    if (ctx.from) ctx.dbUser = await saveTelegramUser(ctx);
    await next();
  } catch (err) {
    console.error('Bot middleware error:', err);
    try { await next(); } catch (nextErr) { console.error('Bot next error:', nextErr); }
  }
});

// ==================== START ====================
bot.start(async (ctx) => {
  await ctx.sendChatAction('typing');
  const welcome = `🎨 <b>PresetHub Bot – Lightroom Presets</b>\n\nनमस्ते ${escapeHtml(ctx.from.first_name || 'Creator')}! 👋\n\nयहाँ आप presets खोज, डाउनलोड, wishlist और अपने account को manage कर सकते हैं।\n\n<b>Quick commands</b>\n/search &lt;query&gt;\n/categories\n/popular\n/recent\n/top\n/preset &lt;id&gt;\n/download &lt;id&gt;\n/login\n/logout\n/myorders\n/mypresets\n/subscription\n/referral\n/earnings\n\n🌐 <a href="${SITE_URL}">PresetHub Website</a>`;
  await ctx.reply(welcome, { parse_mode: 'HTML', ...mainMenu });

  if (ADMIN_CHAT_ID && String(ctx.chat.id) !== ADMIN_CHAT_ID) {
    try {
      await bot.telegram.sendMessage(
        ADMIN_CHAT_ID,
        `👤 New Telegram user: ${escapeHtml(ctx.from.first_name || '')} (@${escapeHtml(ctx.from.username || 'No username')})\nID: <code>${ctx.from.id}</code>`,
        { parse_mode: 'HTML' }
      );
    } catch (e) {
      console.error('Admin notification failed:', e.message);
    }
  }
});

// ==================== SEARCH ====================
bot.command('search', async (ctx) => {
  const query = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!query) return ctx.reply('उदाहरण: /search sunset');

  try {
    const res = await axios.get(`${API_BASE}/search`, { params: { q: query }, timeout: 15_000 });
    const data = res.data || {};
    const presets = Array.isArray(data.presets) ? data.presets : [];
    const users = Array.isArray(data.users) ? data.users : [];
    const categories = Array.isArray(data.categories) ? data.categories : [];

    if (!presets.length && !users.length && !categories.length) return ctx.reply('😕 कोई result नहीं मिला।');

    let msg = `🔍 <b>Search: ${escapeHtml(query)}</b>\n\n`;
    if (presets.length) {
      msg += '<b>Presets</b>\n' + presets.slice(0, 8).map(publicPresetLine).join('\n\n') + '\n\n';
    }
    if (users.length) {
      msg += '<b>Creators</b>\n' + users.slice(0, 5).map(u => `• ${escapeHtml(u.name || 'Creator')} ${u.username ? `(@${escapeHtml(u.username)})` : ''}`).join('\n') + '\n\n';
    }
    if (categories.length) {
      msg += '<b>Categories</b>\n' + categories.slice(0, 5).map(c => `• ${escapeHtml(c.name)} (${c.count || 0})`).join('\n');
    }
    await ctx.reply(msg, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('Search error:', err.response?.data || err.message);
    await ctx.reply('❌ Search service अभी उपलब्ध नहीं है।');
  }
});

// ==================== CATEGORIES ====================
bot.command('categories', async (ctx) => {
  try {
    await connectDB();
    const categories = await Preset.aggregate([
      { $match: { status: 'approved' } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 30 },
    ]);
    if (!categories.length) return ctx.reply('📂 अभी कोई category उपलब्ध नहीं है।');
    const msg = '📂 <b>Categories</b>\n\n' + categories.map(c => `• ${escapeHtml(c._id || 'General')} — ${c.count}`).join('\n');
    await ctx.reply(msg, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('Categories error:', err.message);
    await ctx.reply('❌ Categories load नहीं हुईं।');
  }
});

bot.command('category', async (ctx) => {
  const cat = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!cat) return ctx.reply('उदाहरण: /category wedding');
  try {
    const res = await axios.get(`${API_BASE}/presets`, { params: { category: cat, limit: 10 }, timeout: 15_000 });
    const presets = Array.isArray(res.data?.presets) ? res.data.presets : [];
    if (!presets.length) return ctx.reply(`❌ ${cat} में कोई approved preset नहीं मिला।`);
    await ctx.reply(`📂 <b>${escapeHtml(cat)}</b>\n\n${presets.map(publicPresetLine).join('\n\n')}`, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('Category error:', err.response?.data || err.message);
    await ctx.reply('❌ Category load नहीं हुई।');
  }
});

// ==================== POPULAR / RECENT / TOP ====================
async function listPresets(ctx, title, params) {
  try {
    const res = await axios.get(`${API_BASE}/presets`, { params: { limit: 10, ...params }, timeout: 15_000 });
    const presets = Array.isArray(res.data?.presets) ? res.data.presets : [];
    if (!presets.length) return ctx.reply('अभी कोई preset नहीं मिला।');
    await ctx.reply(`${title}\n\n${presets.map(publicPresetLine).join('\n\n')}`, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('Preset list error:', err.response?.data || err.message);
    await ctx.reply('❌ Presets load नहीं हुए।');
  }
}

bot.command('popular', ctx => listPresets(ctx, '🔥 <b>Popular Presets</b>', { sort: 'popular' }));
bot.command('recent', ctx => listPresets(ctx, '🆕 <b>New Presets</b>', { sort: 'newest' }));

bot.command('top', async (ctx) => {
  try {
    const res = await axios.get(`${API_BASE}/users/top`, { timeout: 15_000 });
    const creators = Array.isArray(res.data) ? res.data : [];
    if (!creators.length) return ctx.reply('अभी कोई creator नहीं मिला।');
    const msg = '🏆 <b>Top Creators</b>\n\n' + creators.slice(0, 10).map((c, i) =>
      `${i + 1}. <b>${escapeHtml(c.name || 'Creator')}</b>${c.username ? ` (@${escapeHtml(c.username)})` : ''}\n   Presets: ${c.presetCount || 0} | Downloads: ${c.totalDownloads || 0}`
    ).join('\n\n');
    await ctx.reply(msg, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('Top error:', err.message);
    await ctx.reply('❌ Creators load नहीं हुए।');
  }
});

// ==================== PRESET DETAIL ====================
bot.command('preset', async (ctx) => {
  const id = ctx.message.text.split(' ')[1];
  if (!id) return ctx.reply('उदाहरण: /preset <id>');
  try {
    const res = await axios.get(`${API_BASE}/presets/${encodeURIComponent(id)}`, { timeout: 15_000 });
    const p = res.data;
    const tags = Array.isArray(p.tags) && p.tags.length ? `\n🏷️ ${p.tags.map(escapeHtml).join(', ')}` : '';
    const msg = `📦 <b>${escapeHtml(p.name)}</b>\n\n✍️ ${escapeHtml(p.author || 'Creator')}\n📂 ${escapeHtml(p.category || 'General')}\n💰 ${Number(p.price || 0) === 0 ? 'मुफ्त' : `₹${Number(p.price).toFixed(2)}`}\n⭐ ${Number(p.avgRating || 0).toFixed(1)}\n⬇️ ${Number(p.downloads || 0)}\n📝 ${escapeHtml(p.description || 'No description')}${tags}\n\n🆔 <code>${escapeHtml(p.id)}</code>`;
    const buttons = [
      [Markup.button.callback('⬇️ Download', `download_${p.id}`), Markup.button.callback('❤️ Wishlist', `wishlist_${p.id}`)],
      [Markup.button.url('🌐 Open on PresetHub', `${SITE_URL}/preset/${encodeURIComponent(p.id)}`)],
    ];
    await ctx.reply(msg, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
  } catch (err) {
    console.error('Preset detail error:', err.response?.data || err.message);
    await ctx.reply('❌ Preset नहीं मिला।');
  }
});

// ==================== DOWNLOAD ====================
bot.command('download', async (ctx) => {
  const id = ctx.message.text.split(' ')[1];
  if (!id) return ctx.reply('उदाहरण: /download <id>');
  await handleDownload(ctx, id);
});

// ==================== LOGIN / LOGOUT ====================
bot.command('login', async (ctx) => {
  if (ctx.dbUser?.token) return ctx.reply('✅ आपका Telegram account पहले से linked है।', mainMenu);
  loginStates.set(ctx.chat.id, { step: 'email' });
  await ctx.reply('📧 Website वाला email दर्ज करें।\nरद्द करने के लिए /cancel');
});

bot.command('logout', async (ctx) => {
  if (!ctx.dbUser?.telegramId) return ctx.reply('आपका account linked नहीं है।', mainMenu);
  await unlinkTelegramId(ctx.from.id);
  ctx.dbUser = null;
  await ctx.reply('✅ Telegram unlink हो गया।', mainMenu);
});

// ==================== MY ORDERS ====================
bot.command('myorders', async (ctx) => {
  if (!ctx.dbUser?.token) return ctx.reply('कृपया पहले /login करें।');
  try {
    const res = await axios.get(`${API_BASE}/payments/my-orders`, { headers: apiHeaders(ctx.dbUser), timeout: 15_000 });
    const orders = Array.isArray(res.data) ? res.data : [];
    if (!orders.length) return ctx.reply('🛒 आपके कोई orders नहीं हैं।');
    const msg = '🛒 <b>My Orders</b>\n\n' + orders.slice(0, 20).map(o =>
      `• Preset: <code>${escapeHtml(o.presetId)}</code>\n  ₹${Number(o.amount || 0).toFixed(2)} — ${escapeHtml(o.status || '')}\n  ${o.createdAt ? new Date(o.createdAt).toLocaleDateString('en-IN') : ''}`
    ).join('\n\n');
    await ctx.reply(msg, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('My orders error:', err.response?.data || err.message);
    await ctx.reply('❌ Orders load नहीं हुए।');
  }
});

// ==================== ADMIN ====================
bot.command('admin', async (ctx) => {
  if (!ctx.dbUser?.token) return ctx.reply('⛔ पहले /login करें।');
  if (ctx.dbUser.role !== 'admin') return ctx.reply('⛔ आप admin नहीं हैं।');
  try {
    const res = await axios.get(`${API_BASE}/admin/analytics`, { headers: apiHeaders(ctx.dbUser), timeout: 15_000 });
    const d = res.data || {};
    await ctx.reply(
      `🛠️ <b>PresetHub Admin</b>\n\n👥 Users: ${d.totalUsers || 0}\n📦 Presets: ${d.totalPresets || 0}\n⬇️ Downloads: ${d.totalDownloads || 0}\n💰 Revenue: ₹${Number(d.totalRevenue || 0).toFixed(2)}\n⭐ Avg rating: ${Number(d.avgRating || 0).toFixed(2)}`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error('Admin error:', err.response?.data || err.message);
    await ctx.reply('❌ Admin data नहीं मिला।');
  }
});

// ==================== UPLOAD FLOW ====================
bot.command('upload', async (ctx) => {
  if (!ctx.dbUser?.token) return ctx.reply('कृपया पहले /login करें।');
  uploadStates.set(ctx.chat.id, { step: 'name', data: {} });
  await ctx.reply('📝 Preset name दें।\nरद्द: /cancel');
});

bot.command('cancel', async (ctx) => {
  const chatId = ctx.chat.id;
  if (uploadStates.delete(chatId)) return ctx.reply('❌ Upload cancelled।', mainMenu);
  if (loginStates.delete(chatId)) return ctx.reply('❌ Login cancelled।', mainMenu);
  return ctx.reply('कोई active action नहीं है।');
});

// ==================== TEXT FLOW ====================
bot.on('text', async (ctx, next) => {
  const chatId = ctx.chat.id;
  const text = String(ctx.message.text || '').trim();

  // Ignore Telegram commands here; their command handlers run separately.
  if (text.startsWith('/')) return next();

  const loginState = loginStates.get(chatId);
  if (loginState) {
    if (loginState.step === 'email') {
      if (!/^\S+@\S+\.\S+$/.test(text)) return ctx.reply('❌ सही email दर्ज करें।');
      loginState.email = text.toLowerCase();
      loginState.step = 'password';
      return ctx.reply('🔑 Website password दर्ज करें।');
    }
    if (loginState.step === 'password') {
      try {
        const res = await axios.post(`${API_BASE}/auth/login`, { email: loginState.email, password: text }, { timeout: 15_000 });
        const token = res.data?.token;
        const user = res.data?.user;
        if (!token || !user?.id) throw new Error('Invalid login response');
        await linkTelegramId(user.id, ctx.from.id, token, ctx);
        loginStates.delete(chatId);
        ctx.dbUser = await getUserByTelegramId(ctx.from.id);
        return ctx.reply(`✅ Login सफल! स्वागत है ${escapeHtml(user.name || user.username || 'Creator')}`, { parse_mode: 'HTML', ...mainMenu });
      } catch (err) {
        console.error('Login error:', err.response?.data || err.message);
        loginStates.delete(chatId);
        return ctx.reply('❌ Email/password गलत है या login service unavailable है।');
      }
    }
  }

  const uploadState = uploadStates.get(chatId);
  if (uploadState) {
    if (uploadState.step === 'name') {
      uploadState.data.name = text.slice(0, 100);
      uploadState.step = 'category';
      return ctx.reply('📂 Category दें, जैसे Wedding / Cinematic / Portrait');
    }
    if (uploadState.step === 'category') {
      uploadState.data.category = text.slice(0, 50);
      uploadState.step = 'price';
      return ctx.reply('💰 Price दें (0 = free):');
    }
    if (uploadState.step === 'price') {
      const price = Number(text);
      if (!Number.isFinite(price) || price < 0) return ctx.reply('❌ सही price दें, जैसे 0 या 99');
      uploadState.data.price = Math.min(price, 999999.99);
      uploadState.step = 'description';
      return ctx.reply('📝 Description दें या skip लिखें:');
    }
    if (uploadState.step === 'description') {
      uploadState.data.description = text.toLowerCase() === 'skip' ? '' : text.slice(0, 500);
      uploadState.step = 'file';
      return ctx.reply('📎 अब .xmp / .lrtemplate / .dng file भेजें।\nPoster/preview के लिए website upload page इस्तेमाल करें।');
    }
  }

  const actions = {
    '🔍 खोजें': () => ctx.reply('🔎 Search: /search <query>'),
    '📂 श्रेणियाँ': () => ctx.reply('/categories'),
    '🔥 लोकप्रिय': () => ctx.reply('/popular'),
    '🆕 नए': () => ctx.reply('/recent'),
    '👤 मेरा अकाउंट': () => showProfile(ctx),
    '🛒 मेरे ऑर्डर': () => ctx.reply('/myorders'),
    '📋 मेरे प्रीसेट': () => ctx.reply('/mypresets'),
    '🌐 वेबसाइट': () => ctx.reply(SITE_URL),
    '📤 अपलोड करें': () => ctx.reply('/upload'),
    '📊 एडमिन पैनल': () => ctx.reply('/admin'),
  };
  if (actions[text]) return actions[text]();
  return next();
});

// ==================== FILE HANDLER ====================
bot.on('document', async (ctx) => {
  const chatId = ctx.chat.id;
  const state = uploadStates.get(chatId);
  if (!state || state.step !== 'file') return;

  const doc = ctx.message.document;
  const name = doc.file_name || 'preset';
  const ext = name.toLowerCase().slice(name.lastIndexOf('.'));
  if (!['.dng', '.xmp', '.lrtemplate'].includes(ext)) {
    return ctx.reply('❌ सिर्फ .dng, .xmp या .lrtemplate file भेजें।');
  }

  // Telegram uploads are intentionally not pushed directly into the website API here,
  // because the API expects multipart file + preview fields. We keep this flow explicit
  // and direct the creator to the website upload page rather than silently losing files.
  uploadStates.delete(chatId);
  await ctx.reply(
    `✅ File received: ${escapeHtml(name)}\n\n🌐 Complete upload (poster, tags, description, price और publish) के लिए:\n${SITE_URL}/#upload`,
    { parse_mode: 'HTML', ...mainMenu }
  );
});

// ==================== PROFILE ====================
async function showProfile(ctx) {
  const u = ctx.dbUser;
  if (!u) return ctx.reply('कृपया पहले /login करें।');
  const msg = `👤 <b>My Account</b>\n\nनाम: ${escapeHtml(u.name)}\nUsername: ${u.username ? `@${escapeHtml(u.username)}` : 'N/A'}\nRole: ${escapeHtml(u.role)}\nTelegram: ${u.telegramId ? '✅ Linked' : '❌ Not linked'}`;
  await ctx.reply(msg, { parse_mode: 'HTML' });
}

// ==================== INLINE ACTIONS ====================
bot.action(/^download_(.+)$/, async (ctx) => {
  try { await ctx.answerCbQuery('Download शुरू हो रहा है…'); } catch (_) {}
  await handleDownload(ctx, ctx.match[1]);
});

bot.action(/^wishlist_(.+)$/, async (ctx) => {
  const user = ctx.dbUser;
  if (!user?.token) return ctx.answerCbQuery('पहले /login करें');
  try {
    await axios.post(`${API_BASE}/users/me/wishlist/${encodeURIComponent(ctx.match[1])}`, {}, { headers: apiHeaders(user), timeout: 15_000 });
    await ctx.answerCbQuery('❤️ Wishlist updated');
  } catch (err) {
    console.error('Wishlist error:', err.response?.data || err.message);
    await ctx.answerCbQuery('Wishlist update failed');
  }
});

// ==================== EXTRA COMMANDS ====================
bot.command('subscription', async (ctx) => {
  if (!ctx.dbUser?.token) return ctx.reply('पहले /login करें।');
  try {
    const res = await axios.get(`${API_BASE}/users/me/subscription`, { headers: apiHeaders(ctx.dbUser), timeout: 15_000 });
    const s = res.data || {};
    await ctx.reply(`👑 <b>Subscription</b>\n\nStatus: ${s.isPremium ? '✅ Premium' : 'Free'}\nAd Watches: ${s.adWatchCount || 0}\nReferral Code: ${escapeHtml(s.referralCode || 'Not generated')}`, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('Subscription error:', err.response?.data || err.message);
    await ctx.reply('❌ Subscription load नहीं हुआ।');
  }
});

bot.command('referral', async (ctx) => {
  if (!ctx.dbUser?.token) return ctx.reply('पहले /login करें।');
  try {
    const res = await axios.post(`${API_BASE}/users/referrals/generate`, {}, { headers: apiHeaders(ctx.dbUser), timeout: 15_000 });
    await ctx.reply(`🔗 Referral Code:\n<code>${escapeHtml(res.data?.referralCode || '')}</code>`, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('Referral error:', err.response?.data || err.message);
    await ctx.reply('❌ Referral code generate नहीं हुआ।');
  }
});

bot.command('earnings', async (ctx) => {
  if (!ctx.dbUser?.token) return ctx.reply('पहले /login करें।');
  try {
    const res = await axios.get(`${API_BASE}/users/${encodeURIComponent(ctx.dbUser.id)}/earnings`, { headers: apiHeaders(ctx.dbUser), timeout: 15_000 });
    const e = res.data || {};
    await ctx.reply(`💰 <b>Earnings</b>\n\nTotal Revenue: ₹${Number(e.totalRevenue || 0).toFixed(2)}\nDownloads: ${e.totalDownloads || 0}\nImpressions: ${e.totalImpressions || 0}\nWithdraw available: ${e.canWithdraw ? 'Yes' : 'No'}`, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('Earnings error:', err.response?.data || err.message);
    await ctx.reply('❌ Earnings load नहीं हुई।');
  }
});

bot.command('mypresets', async (ctx) => {
  if (!ctx.dbUser?.token) return ctx.reply('पहले /login करें।');
  try {
    const res = await axios.get(`${API_BASE}/users/${encodeURIComponent(ctx.dbUser.id)}/presets`, { headers: apiHeaders(ctx.dbUser), timeout: 15_000 });
    const presets = Array.isArray(res.data) ? res.data : [];
    if (!presets.length) return ctx.reply('📋 आपने अभी तक कोई preset upload नहीं किया।');
    const msg = '📋 <b>My Presets</b>\n\n' + presets.slice(0, 20).map(p => `• <b>${escapeHtml(p.name)}</b> — ${escapeHtml(p.status || 'approved')}\n  <code>${escapeHtml(p.id)}</code>`).join('\n\n');
    await ctx.reply(msg, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('My presets error:', err.response?.data || err.message);
    await ctx.reply('❌ My presets load नहीं हुए।');
  }
});

// ==================== ERROR HANDLING / LAUNCH ====================
bot.catch(async (err, ctx) => {
  console.error('Telegram handler error:', err);
  try { await ctx.reply('⚠️ Bot में temporary error आया। कृपया दोबारा कोशिश करें।'); } catch (_) {}
});

async function start() {
  await connectDB();
  const me = await bot.telegram.getMe();
  console.log(`🤖 Telegram bot: @${me.username || me.first_name} (${me.id})`);
  console.log(`🌐 API: ${API_BASE}`);
  console.log(`🌐 Site: ${SITE_URL}`);
  await bot.launch({ dropPendingUpdates: true });
  console.log('✅ Telegram bot polling started.');
}

start().catch((err) => {
  console.error('❌ Telegram bot startup failed:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = bot;
