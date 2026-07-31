// backend/bot.js
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { getDB } = require('./config/db');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN not set in .env');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const API_BASE = process.env.API_BASE || 'https://presethub.site/api';

const loginStates = new Map();
const uploadStates = new Map();

async function getUserByTelegramId(telegramId) {
  const db = await getDB();
  return db.data.users.find(u => 
    u.telegramId === String(telegramId) || u.id === `tele_${telegramId}`
  );
}

async function saveTelegramUser(ctx) {
  const db = await getDB();
  const from = ctx.from;
  let user = db.data.users.find(u => 
    u.telegramId === String(from.id) || u.id === `tele_${from.id}`
  );

  if (user) {
    user.telegram = {
      firstName: from.first_name,
      lastName: from.last_name || '',
      username: from.username || '',
      languageCode: from.language_code || '',
    };
    user.lastActive = new Date().toISOString();
    user.commandsCount = (user.commandsCount || 0) + 1;
    await db.write();
  } else {
    const newUser = {
      id: `tele_${from.id}`,
      email: '',
      password: '',
      name: from.first_name || 'Telegram User',
      username: from.username || '',
      role: 'user',
      createdAt: new Date().toISOString(),
      verified: true,
      bio: '',
      avatar: '',
      socialLinks: { instagram: '', youtube: '', twitter: '', website: '' },
      followers: [],
      following: [],
      wishlist: [],
      telegramId: String(from.id),
      telegram: {
        firstName: from.first_name,
        lastName: from.last_name || '',
        username: from.username || '',
        languageCode: from.language_code || '',
      },
      lastActive: new Date().toISOString(),
      commandsCount: 1,
      token: '',
      subscription: { tier: 'free', expiry: null, adWatchCount: 0, adRewardDays: 0, lastAdWatch: null },
      referral: { code: null, referredBy: null, referralCount: 0, referralRewardDays: 0 },
      notifications: []
    };
    db.data.users.push(newUser);
    await db.write();
    user = newUser;
  }
  return user;
}

async function linkTelegramId(userId, telegramId, token, ctx) {
  const db = await getDB();
  const from = ctx.from;

  // Remove temporary telegram user if exists
  const tempUser = db.data.users.find(u => 
    (u.telegramId === String(telegramId) || u.id === `tele_${telegramId}`) && u.id !== userId
  );
  if (tempUser) {
    const idx = db.data.users.indexOf(tempUser);
    if (idx > -1) db.data.users.splice(idx, 1);
  }

  const user = db.data.users.find(u => u.id === userId);
  if (!user) throw new Error('User not found');

  user.telegramId = String(telegramId);
  user.token = token;
  user.telegram = {
    firstName: from.first_name,
    lastName: from.last_name || '',
    username: from.username || '',
    languageCode: from.language_code || '',
  };
  user.lastActive = new Date().toISOString();
  user.commandsCount = (user.commandsCount || 0) + 1;
  await db.write();
  return user;
}

async function unlinkTelegramId(telegramId) {
  const db = await getDB();
  const user = db.data.users.find(u => 
    u.telegramId === String(telegramId) || u.id === `tele_${telegramId}`
  );
  if (user) {
    delete user.telegramId;
    delete user.token;
    await db.write();
  }
}

// ==================== MIDDLEWARE ====================
bot.use(async (ctx, next) => {
  if (ctx.from) {
    await saveTelegramUser(ctx);
  }
  ctx.dbUser = await getUserByTelegramId(ctx.from?.id);
  await next();
});

// ==================== MAIN MENU ====================
const mainMenu = Markup.keyboard([
  ['🔍 खोजें', '📂 श्रेणियाँ'],
  ['🔥 लोकप्रिय', '🆕 नए'],
  ['👤 मेरा अकाउंट', '🛒 मेरे ऑर्डर'],
  ['📤 अपलोड करें', '📋 मेरे प्रीसेट'],
  ['📊 एडमिन पैनल']
]).resize();

// ==================== START ====================
bot.start(async (ctx) => {
  await ctx.sendChatAction('typing');
  const welcome = `
🎨 *PresetHub Bot – Lightroom Presets*

नमस्ते ${ctx.from.first_name}! 👋

मैं आपको हजारों प्रीसेट्स खोजने, डाउनलोड करने, अपलोड करने और प्रबंधित करने में मदद करूँगा।

🔹 *कमांड्स:*
/start - Restart
/search <query> – खोजें
/categories – श्रेणियाँ
/popular – लोकप्रिय
/recent – नए
/top – टॉप क्रिएटर्स
/preset <id> – विवरण
/download <id> – डाउनलोड
/login – अकाउंट लिंक करें
/logout – अनलिंक
/myorders – मेरे ऑर्डर
/admin – एडमिन पैनल
/upload – अपलोड
/mypresets – मेरे प्रीसेट
/subscription – सब्सक्रिप्शन
/referral – रेफरल
/earnings – कमाई
  `;
  await ctx.replyWithMarkdown(welcome, mainMenu);
});

// ==================== SEARCH ====================
bot.command('search', async (ctx) => {
  await ctx.sendChatAction('typing');
  const query = ctx.message.text.split(' ').slice(1).join(' ');
  if (!query) {
    return ctx.reply('कृपया खोज शब्द दें:\n`/search सनसेट`', { parse_mode: 'Markdown' });
  }
  try {
    const res = await axios.get(`\( {API_BASE}/presets/search?q= \){encodeURIComponent(query)}`);
    const presets = res.data;
    if (!presets.length) return ctx.reply('😕 कोई प्रीसेट नहीं मिला।');

    let msg = `🔍 *"${query}"* के परिणाम:\n\n`;
    presets.slice(0, 10).forEach((p, i) => {
      msg += `\( {i + 1}. * \){p.name}* – ${p.author}\n   💰 ${p.price === 0 ? 'मुफ्त' : '₹' + p.price} ⭐ \( {p.avgRating || 0}\n   \` \){p.id}\`\n\n`;
    });
    msg += 'विस्तार: `/preset <id>`';
    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    console.error(err);
    ctx.reply('❌ खोज में त्रुटि।');
  }
});

// ==================== CATEGORIES ====================
bot.command('categories', async (ctx) => {
  await ctx.sendChatAction('typing');
  try {
    const db = await getDB();
    const cats = db.data.categories || [];
    let msg = '📂 *श्रेणियाँ:*\n\n';
    cats.forEach(c => { msg += `• ${c}\n`; });
    msg += '\n`/category <नाम>` से देखें';
    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    ctx.reply('❌ श्रेणियाँ लोड नहीं हुईं।');
  }
});

bot.command('category', async (ctx) => {
  await ctx.sendChatAction('typing');
  const cat = ctx.message.text.split(' ').slice(1).join(' ');
  if (!cat) return ctx.reply('श्रेणी नाम दें:\n`/category सनसेट`', { parse_mode: 'Markdown' });

  try {
    const res = await axios.get(`\( {API_BASE}/presets?category= \){encodeURIComponent(cat)}&limit=10`);
    const presets = res.data.presets || [];
    if (!presets.length) return ctx.reply(`"${cat}" में कोई प्रीसेट नहीं।`);

    let msg = `📂 *${cat}* – ${presets.length} प्रीसेट:\n\n`;
    presets.forEach(p => {
      msg += `• *${p.name}* – ${p.author}\n   ${p.price === 0 ? 'मुफ्त' : '₹' + p.price} ⭐ \( {p.avgRating || 0}\n   \` \){p.id}\`\n`;
    });
    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    ctx.reply('❌ लोड नहीं हुए।');
  }
});

// ==================== POPULAR / RECENT / TOP ====================
bot.command('popular', async (ctx) => {
  await ctx.sendChatAction('typing');
  try {
    const res = await axios.get(`${API_BASE}/presets?sort=popular&limit=10`);
    const presets = res.data.presets || [];
    if (!presets.length) return ctx.reply('कोई लोकप्रिय प्रीसेट नहीं।');

    let msg = '🔥 *लोकप्रिय प्रीसेट:*\n\n';
    presets.forEach(p => {
      msg += `• *${p.name}* – ${p.author}\n   ⭐ ${p.avgRating || 0} | ⬇️ \( {p.downloads || 0}\n   \` \){p.id}\`\n`;
    });
    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    ctx.reply('❌ लोड नहीं हुए।');
  }
});

bot.command('recent', async (ctx) => {
  await ctx.sendChatAction('typing');
  try {
    const res = await axios.get(`${API_BASE}/presets?sort=newest&limit=10`);
    const presets = res.data.presets || [];
    if (!presets.length) return ctx.reply('कोई नए प्रीसेट नहीं।');

    let msg = '🆕 *नए प्रीसेट:*\n\n';
    presets.forEach(p => {
      msg += `• *${p.name}* – ${p.author}\n   ⭐ \( {p.avgRating || 0}\n   \` \){p.id}\`\n`;
    });
    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    ctx.reply('❌ लोड नहीं हुए।');
  }
});

bot.command('top', async (ctx) => {
  await ctx.sendChatAction('typing');
  try {
    const res = await axios.get(`${API_BASE}/users/top`);
    const creators = res.data;
    if (!creators.length) return ctx.reply('कोई क्रिएटर नहीं।');

    let msg = '🏆 *टॉप क्रिएटर्स:*\n\n';
    creators.slice(0, 5).forEach((c, i) => {
      msg += `\( {i + 1}. * \){c.name}* – ${c.presetCount} प्रीसेट, ${c.totalDownloads} डाउनलोड\n`;
    });
    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    ctx.reply('❌ लोड नहीं हुए।');
  }
});

// ==================== PRESET DETAIL ====================
bot.command('preset', async (ctx) => {
  await ctx.sendChatAction('typing');
  const id = ctx.message.text.split(' ')[1];
  if (!id) return ctx.reply('आईडी दें:\n`/preset <id>`', { parse_mode: 'Markdown' });

  try {
    const res = await axios.get(`\( {API_BASE}/presets/ \){id}`);
    const p = res.data;
    let msg = `📦 *${p.name}*\n`;
    msg += `✍️ ${p.author}\n`;
    msg += `📂 ${p.category}\n`;
    msg += `💰 ${p.price === 0 ? 'मुफ्त' : '₹' + p.price}\n`;
    msg += `⭐ \( {p.avgRating || 0} ( \){p.reviews?.length || 0} reviews)\n`;
    msg += `⬇️ ${p.downloads || 0} downloads\n`;
    msg += `📝 ${p.description || 'No description'}\n\n`;
    msg += `🆔 \`${p.id}\``;

    await ctx.replyWithMarkdown(msg, Markup.inlineKeyboard([
      Markup.button.callback('⬇️ डाउनलोड', `download_${p.id}`),
      Markup.button.callback('❤️ Wishlist', `wishlist_${p.id}`)
    ]));
  } catch (err) {
    ctx.reply('❌ प्रीसेट नहीं मिला।');
  }
});

// ==================== DOWNLOAD ====================
bot.command('download', async (ctx) => {
  const id = ctx.message.text.split(' ')[1];
  if (!id) return ctx.reply('आईडी दें:\n`/download <id>`', { parse_mode: 'Markdown' });
  await handleDownload(ctx, id);
});

async function handleDownload(ctx, presetId) {
  if (!ctx.dbUser || !ctx.dbUser.token) {
    return ctx.reply('कृपया पहले `/login` करें।', { parse_mode: 'Markdown' });
  }

  await ctx.sendChatAction('typing');
  try {
    const res = await axios.post(`\( {API_BASE}/presets/ \){presetId}/download`, {}, {
      headers: { Authorization: `Bearer ${ctx.dbUser.token}` },
      responseType: 'arraybuffer'
    });

    const fileName = res.headers['content-disposition']?.match(/filename="(.+)"/)?.[1] || 'preset.xmp';
    await ctx.replyWithDocument(
      { source: Buffer.from(res.data), filename: fileName },
      { caption: '✅ प्रीसेट डाउनलोड हो गया!' }
    );
  } catch (err) {
    console.error(err?.response?.data || err.message);
    if (err.response?.status === 403) {
      ctx.reply('⛔ इस प्रीसेट को खरीदना होगा।');
    } else if (err.response?.status === 404) {
      ctx.reply('❌ फ़ाइल सर्वर पर नहीं मिली।');
    } else {
      ctx.reply('❌ डाउनलोड विफल।');
    }
  }
}

// ==================== LOGIN / LOGOUT ====================
bot.command('login', async (ctx) => {
  if (ctx.dbUser && ctx.dbUser.token) {
    return ctx.reply('✅ आप पहले से लिंक हैं।', mainMenu);
  }
  loginStates.set(ctx.chat.id, { step: 'email' });
  await ctx.reply('📧 अपना ईमेल दर्ज करें (रद्द: /cancel):');
});

bot.command('logout', async (ctx) => {
  if (!ctx.dbUser || !ctx.dbUser.telegramId) {
    return ctx.reply('आप लॉगिन नहीं हैं।', mainMenu);
  }
  await unlinkTelegramId(ctx.from.id);
  ctx.dbUser = null;
  ctx.reply('✅ लॉगआउट हो गया।', mainMenu);
});

// ==================== MY ORDERS ====================
bot.command('myorders', async (ctx) => {
  if (!ctx.dbUser || !ctx.dbUser.token) {
    return ctx.reply('कृपया पहले `/login` करें।', { parse_mode: 'Markdown' });
  }
  try {
    const res = await axios.get(`${API_BASE}/payments/my-orders`, {
      headers: { Authorization: `Bearer ${ctx.dbUser.token}` }
    });
    const orders = res.data;
    if (!orders.length) return ctx.reply('आपके कोई ऑर्डर नहीं।');

    let msg = '🛒 *मेरे ऑर्डर:*\n\n';
    orders.forEach(o => {
      msg += `• \( {o.presetId}\n  ₹ \){o.amount} – ${o.status}\n  ${new Date(o.createdAt).toLocaleDateString()}\n\n`;
    });
    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    ctx.reply('❌ ऑर्डर लोड नहीं हुए।');
  }
});

// ==================== ADMIN ====================
bot.command('admin', async (ctx) => {
  if (!ctx.dbUser || !ctx.dbUser.token) {
    return ctx.reply('⛔ पहले `/login` करें।', { parse_mode: 'Markdown' });
  }
  if (ctx.dbUser.role !== 'admin') {
    return ctx.reply('⛔ आप एडमिन नहीं हैं।');
  }

  try {
    const res = await axios.get(`${API_BASE}/admin/analytics`, {
      headers: { Authorization: `Bearer ${ctx.dbUser.token}` }
    });
    const data = res.data;
    let msg = `🛠️ *एडमिन डैशबोर्ड*\n\n`;
    msg += `👥 Users: ${data.totalUsers}\n`;
    msg += `📦 Presets: ${data.totalPresets}\n`;
    msg += `⬇️ Downloads: ${data.totalDownloads}\n`;
    msg += `💰 Revenue: ₹${data.totalRevenue}\n`;
    msg += `⭐ Avg Rating: ${data.avgRating}\n`;
    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    ctx.reply('❌ एडमिन डेटा नहीं मिला।');
  }
});

// ==================== UPLOAD FLOW ====================
bot.command('upload', async (ctx) => {
  if (!ctx.dbUser || !ctx.dbUser.token) {
    return ctx.reply('कृपया पहले `/login` करें।', { parse_mode: 'Markdown' });
  }
  uploadStates.set(ctx.chat.id, { step: 'name', data: {} });
  await ctx.reply('📝 प्रीसेट का नाम दें (/cancel से रद्द करें):');
});

bot.command('cancel', async (ctx) => {
  const chatId = ctx.chat.id;
  if (uploadStates.has(chatId)) {
    uploadStates.delete(chatId);
    await ctx.reply('❌ अपलोड रद्द।', mainMenu);
  } else if (loginStates.has(chatId)) {
    loginStates.delete(chatId);
    await ctx.reply('❌ लॉगिन रद्द।', mainMenu);
  } else {
    await ctx.reply('कोई सक्रिय कार्य नहीं।');
  }
});

// ==================== TEXT HANDLER ====================
bot.on('text', async (ctx, next) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text.trim();

  // Login flow
  const loginState = loginStates.get(chatId);
  if (loginState) {
    if (loginState.step === 'email') {
      loginState.email = text.toLowerCase();
      loginState.step = 'password';
      await ctx.reply('🔑 पासवर्ड दर्ज करें:');
      return;
    }
    if (loginState.step === 'password') {
      try {
        const res = await axios.post(`${API_BASE}/auth/login`, {
          email: loginState.email,
          password: text
        });
        const { token, user } = res.data;
        await linkTelegramId(user.id, ctx.from.id, token, ctx);
        loginStates.delete(chatId);
        ctx.dbUser = await getUserByTelegramId(ctx.from.id);
        await ctx.reply(`✅ लॉगिन सफल! स्वागत है ${user.name}`, mainMenu);
      } catch (err) {
        loginStates.delete(chatId);
        await ctx.reply('❌ गलत ईमेल या पासवर्ड।');
      }
      return;
    }
  }

  // Upload flow
  const uploadState = uploadStates.get(chatId);
  if (uploadState) {
    if (uploadState.step === 'name') {
      uploadState.data.name = text;
      uploadState.step = 'category';
      await ctx.reply('📂 श्रेणी चुनें (सनसेट / नैचुरल / विंटेज / ब्लैक & व्हाइट / सिटीस्केप):');
      return;
    }
    if (uploadState.step === 'category') {
      uploadState.data.category = text;
      uploadState.step = 'price';
      await ctx.reply('💰 कीमत (0 = मुफ्त):');
      return;
    }
    if (uploadState.step === 'price') {
      uploadState.data.price = parseFloat(text) || 0;
      uploadState.step = 'description';
      await ctx.reply('📝 विवरण दें (या "skip"):');
      return;
    }
    if (uploadState.step === 'description') {
      uploadState.data.description = text === 'skip' ? '' : text;
      uploadState.step = 'file';
      await ctx.reply('📎 अब .dng / .xmp फ़ाइल भेजें:');
      return;
    }
  }

  // Menu buttons
  const actions = {
    '🔍 खोजें': () => ctx.reply('खोज शब्द:\n/search <query>'),
    '📂 श्रेणियाँ': () => ctx.reply('/categories'),
    '🔥 लोकप्रिय': () => ctx.reply('/popular'),
    '🆕 नए': () => ctx.reply('/recent'),
    '👤 मेरा अकाउंट': () => showProfile(ctx),
    '🛒 मेरे ऑर्डर': () => ctx.reply('/myorders'),
    '📤 अपलोड करें': () => ctx.reply('/upload'),
    '📋 मेरे प्रीसेट': () => ctx.reply('/mypresets'),
    '📊 एडमिन पैनल': () => ctx.reply('/admin'),
  };

  if (actions[text]) {
    await actions[text]();
    return;
  }

  await next();
});

// ==================== FILE HANDLERS ====================
bot.on('document', async (ctx) => {
  const chatId = ctx.chat.id;
  const uploadState = uploadStates.get(chatId);
  if (!uploadState || uploadState.step !== 'file') return;

  const doc = ctx.message.document;
  const fileName = doc.file_name || '';
  const ext = path.extname(fileName).toLowerCase();

  if (!['.dng', '.xmp', '.lrtemplate'].includes(ext)) {
    return ctx.reply('❌ सिर्फ .dng, .xmp या .lrtemplate फ़ाइल भेजें।');
  }

  try {
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    // For simplicity we just store metadata. Real file upload to server needs FormData.
    uploadState.data.fileName = fileName;
    uploadState.data.fileId = doc.file_id;
    uploadState.step = 'done';

    await ctx.reply('✅ फ़ाइल मिल गई। अब /mypresets से चेक करें या वेबसाइट पर पूरा अपलोड करें।');
    uploadStates.delete(chatId);
  } catch (err) {
    console.error(err);
    ctx.reply('❌ फ़ाइल प्रोसेस नहीं हो पाई।');
  }
});

// ==================== PROFILE ====================
async function showProfile(ctx) {
  if (!ctx.dbUser) {
    return ctx.reply('कृपया पहले `/login` करें।', { parse_mode: 'Markdown' });
  }
  const u = ctx.dbUser;
  let msg = `👤 *मेरा अकाउंट*\n\n`;
  msg += `नाम: ${u.name}\n`;
  msg += `यूज़रनेम: ${u.username || 'N/A'}\n`;
  msg += `रोल: ${u.role}\n`;
  msg += `लिंक: ${u.token ? '✅' : '❌'}\n`;
  await ctx.replyWithMarkdown(msg);
}

// ==================== INLINE ACTIONS ====================
bot.action(/download_(.+)/, async (ctx) => {
  await handleDownload(ctx, ctx.match[1]);
  await ctx.answerCbQuery();
});

bot.action(/wishlist_(.+)/, async (ctx) => {
  if (!ctx.dbUser || !ctx.dbUser.token) {
    await ctx.answerCbQuery('पहले लॉगिन करें');
    return;
  }
  try {
    await axios.post(`\( {API_BASE}/users/me/wishlist/ \){ctx.match[1]}`, {}, {
      headers: { Authorization: `Bearer ${ctx.dbUser.token}` }
    });
    await ctx.answerCbQuery('❤️ Wishlist updated');
  } catch (err) {
    await ctx.answerCbQuery('Failed');
  }
});

// ==================== EXTRA COMMANDS ====================
bot.command('subscription', async (ctx) => {
  if (!ctx.dbUser || !ctx.dbUser.token) {
    return ctx.reply('पहले `/login` करें।', { parse_mode: 'Markdown' });
  }
  try {
    const res = await axios.get(`${API_BASE}/users/me/subscription`, {
      headers: { Authorization: `Bearer ${ctx.dbUser.token}` }
    });
    const s = res.data;
    let msg = `👑 *Subscription*\n\n`;
    msg += `Status: ${s.isPremium ? '✅ Premium' : 'Free'}\n`;
    msg += `Ad Watches: ${s.adWatchCount}\n`;
    msg += `Referral Code: ${s.referralCode || 'Not generated'}\n`;
    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    ctx.reply('❌ Failed to load subscription.');
  }
});

bot.command('referral', async (ctx) => {
  if (!ctx.dbUser || !ctx.dbUser.token) {
    return ctx.reply('पहले `/login` करें।', { parse_mode: 'Markdown' });
  }
  try {
    const res = await axios.post(`${API_BASE}/users/referrals/generate`, {}, {
      headers: { Authorization: `Bearer ${ctx.dbUser.token}` }
    });
    await ctx.reply(`🔗 आपका Referral Code:\n\`${res.data.referralCode}\``, { parse_mode: 'Markdown' });
  } catch (err) {
    ctx.reply('❌ Failed.');
  }
});

bot.command('earnings', async (ctx) => {
  if (!ctx.dbUser || !ctx.dbUser.token) {
    return ctx.reply('पहले `/login` करें।', { parse_mode: 'Markdown' });
  }
  try {
    const res = await axios.get(`\( {API_BASE}/users/ \){ctx.dbUser.id}/earnings`, {
      headers: { Authorization: `Bearer ${ctx.dbUser.token}` }
    });
    const e = res.data;
    let msg = `💰 *Earnings*\n\n`;
    msg += `Total Revenue: ₹${e.totalRevenue.toFixed(2)}\n`;
    msg += `Downloads: ${e.totalDownloads}\n`;
    msg += `Impressions: ${e.totalImpressions}\n`;
    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    ctx.reply('❌ Failed to load earnings.');
  }
});

bot.command('mypresets', async (ctx) => {
  if (!ctx.dbUser || !ctx.dbUser.token) {
    return ctx.reply('पहले `/login` करें।', { parse_mode: 'Markdown' });
  }
  try {
    const res = await axios.get(`\( {API_BASE}/users/ \){ctx.dbUser.id}/presets`, {
      headers: { Authorization: `Bearer ${ctx.dbUser.token}` }
    });
    const presets = res.data;
    if (!presets.length) return ctx.reply('आपने अभी तक कोई प्रीसेट अपलोड नहीं किया।');

    let msg = '📋 *मेरे प्रीसेट:*\n\n';
    presets.forEach(p => {
      msg += `• *\( {p.name}* ( \){p.status})\n  \`${p.id}\`\n`;
    });
    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    ctx.reply('❌ Failed.');
  }
});

// ==================== LAUNCH ====================
bot.launch()
  .then(() => console.log('🤖 Telegram bot started successfully'))
  .catch(err => console.error('Bot launch error:', err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));