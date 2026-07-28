// backend/bot.js
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { getDB } = require('./config/db');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN not set in .env');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const API_BASE = process.env.API_BASE || 'http://localhost:4000/api';

// ==================== HELPERS ====================

// In-memory login state (chatId -> { step, email })
const loginStates = new Map();

async function getUserByTelegramId(telegramId) {
  const db = await getDB();
  return db.data.users.find(u => u.telegramId === String(telegramId));
}

// Save or update Telegram user details (temporary or linked)
async function saveTelegramUser(ctx) {
  const db = await getDB();
  const from = ctx.from;
  let user = db.data.users.find(u => u.telegramId === String(from.id));

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
      verified: false,
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
    };
    db.data.users.push(newUser);
    await db.write();
    user = newUser;
  }
  return user;
}

// Link temporary telegram user to actual registered user
async function linkTelegramId(userId, telegramId, token, ctx) {
  const db = await getDB();
  const from = ctx.from;

  // Remove temporary user if exists
  const tempUser = db.data.users.find(u => u.telegramId === String(telegramId));
  if (tempUser && tempUser.id !== userId) {
    const tempIndex = db.data.users.indexOf(tempUser);
    if (tempIndex > -1) db.data.users.splice(tempIndex, 1);
  }

  // Find actual user
  const user = db.data.users.find(u => u.id === userId);
  if (!user) throw new Error('User not found');

  // Update with telegram data
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
  const user = db.data.users.find(u => u.telegramId === String(telegramId));
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
  ctx.dbUser = await getUserByTelegramId(ctx.from.id);
  await next();
});

// ==================== MAIN MENU KEYBOARD ====================

const mainMenu = Markup.keyboard([
  ['🔍 खोजें', '📂 श्रेणियाँ'],
  ['🔥 लोकप्रिय', '🆕 नए'],
  ['👤 मेरा अकाउंट', '🛒 मेरे ऑर्डर'],
  ['📊 एडमिन पैनल']
]).resize();

// ==================== COMMANDS ====================

// Start
bot.start(async (ctx) => {
  await ctx.sendChatAction('typing');
  const welcome = `
🎨 *PresetHub Bot – Lightroom Presets*

नमस्ते ${ctx.from.first_name}! 👋
मैं आपको हजारों प्रीसेट्स खोजने, डाउनलोड करने और प्रबंधित करने में मदद करूँगा।

🔹 *कमांड्स:*
/search <क्वेरी> – प्रीसेट खोजें
/categories – श्रेणियाँ देखें
/category <नाम> – श्रेणी के प्रीसेट
/popular – लोकप्रिय प्रीसेट
/recent – नए प्रीसेट
/top – टॉप क्रिएटर्स
/preset <आईडी> – प्रीसेट विवरण
/download <आईडी> – प्रीसेट डाउनलोड करें
/login – अकाउंट लिंक करें
/logout – अकाउंट अनलिंक करें
/myorders – मेरे ऑर्डर
/admin – एडमिन पैनल

📌 *नीचे दिए बटन भी इस्तेमाल करें*
  `;
  await ctx.replyWithMarkdown(welcome, mainMenu);
});

// ==================== LOGIN (MANUAL STATE WITH MAP) ====================

bot.command('login', async (ctx) => {
  await ctx.sendChatAction('typing');
  
  if (ctx.dbUser && ctx.dbUser.token) {
    return ctx.reply('✅ आप पहले से लिंक हैं।', mainMenu);
  }

  loginStates.set(ctx.chat.id, { step: 'email', email: null });
  await ctx.reply('📧 कृपया अपना ईमेल दर्ज करें (रद्द करने के लिए /cancel):');
});

// Logout
bot.command('logout', async (ctx) => {
  await ctx.sendChatAction('typing');
  if (!ctx.dbUser || !ctx.dbUser.telegramId) {
    return ctx.reply('आप लॉगिन नहीं हैं।', mainMenu);
  }
  await unlinkTelegramId(ctx.from.id);
  ctx.dbUser = null;
  ctx.reply('✅ आप लॉगआउट हो गए।', mainMenu);
});

// Search
bot.command('search', async (ctx) => {
  await ctx.sendChatAction('typing');
  const query = ctx.message.text.split(' ').slice(1).join(' ');
  if (!query) {
    return ctx.reply('कृपया खोज शब्द दें: `/search सनसेट`', { parse_mode: 'Markdown' });
  }
  try {
    const res = await axios.get(`${API_BASE}/presets/search?q=${encodeURIComponent(query)}`);
    const presets = res.data;
    if (!presets.length) {
      return ctx.reply('😕 कोई प्रीसेट नहीं मिला।');
    }
    let msg = `🔍 *"${query}"* के लिए परिणाम:\n\n`;
    presets.slice(0, 10).forEach((p, i) => {
      msg += `${i+1}. *${p.name}* – ${p.author} (${p.category})\n   💰 ${p.price === 0 ? 'मुफ्त' : '₹'+p.price} ⭐ ${p.avgRating||0}\n   \`${p.id}\`\n`;
    });
    msg += '\nविस्तार देखने के लिए `/preset <आईडी>`';
    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    console.error(err);
    ctx.reply('❌ खोज में त्रुटि। कृपया बाद में प्रयास करें।');
  }
});

// Categories
bot.command('categories', async (ctx) => {
  await ctx.sendChatAction('typing');
  try {
    const db = await getDB();
    const cats = db.data.categories || [];
    let msg = '📂 *श्रेणियाँ:*\n\n';
    cats.forEach(c => { msg += `• ${c}\n`; });
    msg += '\nकिसी श्रेणी के प्रीसेट देखने के लिए `/category <नाम>`';
    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    ctx.reply('❌ श्रेणियाँ लोड नहीं हुईं।');
  }
});

// Category
bot.command('category', async (ctx) => {
  await ctx.sendChatAction('typing');
  const cat = ctx.message.text.split(' ').slice(1).join(' ');
  if (!cat) return ctx.reply('श्रेणी नाम दें: `/category सनसेट`', { parse_mode: 'Markdown' });
  try {
    const res = await axios.get(`${API_BASE}/presets?category=${encodeURIComponent(cat)}&limit=10`);
    const presets = res.data.presets || [];
    if (!presets.length) {
      return ctx.reply(`"${cat}" श्रेणी में कोई प्रीसेट नहीं।`);
    }
    let msg = `📂 *${cat}* – ${presets.length} प्रीसेट:\n\n`;
    presets.forEach(p => {
      msg += `• *${p.name}* – ${p.author} (${p.price===0?'मुफ्त':'₹'+p.price})\n   ⭐ ${p.avgRating||0} | डाउनलोड: ${p.downloads||0}\n   \`${p.id}\`\n`;
    });
    msg += '\nविस्तार: `/preset <आईडी>`';
    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    console.error(err);
    ctx.reply('❌ श्रेणी लोड नहीं हुई।');
  }
});

// Popular
bot.command('popular', async (ctx) => {
  await ctx.sendChatAction('typing');
  try {
    const res = await axios.get(`${API_BASE}/presets?sort=popular&limit=10`);
    const presets = res.data.presets || [];
    let msg = '🔥 *लोकप्रिय प्रीसेट:*\n\n';
    presets.forEach(p => {
      msg += `• *${p.name}* – ${p.author} (${p.category})\n   ⭐ ${p.avgRating||0} | डाउनलोड: ${p.downloads||0}\n   \`${p.id}\`\n`;
    });
    msg += '\nविस्तार: `/preset <आईडी>`';
    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    ctx.reply('❌ लोड नहीं हुए।');
  }
});

// Recent
bot.command('recent', async (ctx) => {
  await ctx.sendChatAction('typing');
  try {
    const res = await axios.get(`${API_BASE}/presets?sort=newest&limit=10`);
    const presets = res.data.presets || [];
    let msg = '🆕 *नए प्रीसेट:*\n\n';
    presets.forEach(p => {
      msg += `• *${p.name}* – ${p.author} (${p.category})\n   ⭐ ${p.avgRating||0} | डाउनलोड: ${p.downloads||0}\n   \`${p.id}\`\n`;
    });
    msg += '\nविस्तार: `/preset <आईडी>`';
    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    ctx.reply('❌ लोड नहीं हुए।');
  }
});

// Top creators
bot.command('top', async (ctx) => {
  await ctx.sendChatAction('typing');
  try {
    const res = await axios.get(`${API_BASE}/users/top`);
    const creators = res.data;
    if (!creators.length) return ctx.reply('कोई क्रिएटर नहीं।');
    let msg = '🏆 *टॉप क्रिएटर्स:*\n\n';
    creators.slice(0, 5).forEach((c, i) => {
      msg += `${i+1}. *${c.name}* – ${c.presetCount} प्रीसेट, ${c.totalDownloads} डाउनलोड, ${c.followers} फॉलोअर्स\n`;
    });
    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    ctx.reply('❌ लोड नहीं हुए।');
  }
});

// Preset details
bot.command('preset', async (ctx) => {
  await ctx.sendChatAction('typing');
  const id = ctx.message.text.split(' ')[1];
  if (!id) return ctx.reply('आईडी दें: `/preset 123`', { parse_mode: 'Markdown' });
  try {
    const res = await axios.get(`${API_BASE}/presets/${id}`);
    const p = res.data;
    let msg = `📦 *${p.name}*\n`;
    msg += `✍️ *${p.author}*\n`;
    msg += `📂 ${p.category}  |  ${p.tags?.join(', ') || ''}\n`;
    msg += `💰 ${p.price === 0 ? 'मुफ्त' : '₹'+p.price}\n`;
    msg += `⭐ ${p.avgRating||0} (${p.reviews?.length||0} समीक्षाएँ)\n`;
    msg += `⬇️ ${p.downloads||0} डाउनलोड\n`;
    msg += `📝 ${p.description || 'कोई विवरण नहीं'}\n\n`;
    msg += `🆔 \`${p.id}\``;
    await ctx.replyWithMarkdown(msg, Markup.inlineKeyboard([
      Markup.button.callback('⬇️ डाउनलोड', `download_${p.id}`),
      Markup.button.callback('❤️ पसंद', `wishlist_${p.id}`)
    ]));
  } catch (err) {
    ctx.reply('❌ प्रीसेट नहीं मिला।');
  }
});

// Download command
bot.command('download', async (ctx) => {
  await ctx.sendChatAction('typing');
  const id = ctx.message.text.split(' ')[1];
  if (!id) return ctx.reply('आईडी दें: `/download 123`', { parse_mode: 'Markdown' });
  await handleDownload(ctx, id);
});

// My orders
bot.command('myorders', async (ctx) => {
  await ctx.sendChatAction('typing');
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
      msg += `• ${o.presetId} – ₹${o.amount} – ${o.status}\n   ${new Date(o.createdAt).toLocaleDateString()}\n`;
    });
    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    console.error(err);
    ctx.reply('❌ ऑर्डर लोड नहीं हुए। कृपया बाद में प्रयास करें।');
  }
});

// Admin
bot.command('admin', async (ctx) => {
  await ctx.sendChatAction('typing');
  
  if (!ctx.dbUser || !ctx.dbUser.token) {
    return ctx.reply('⛔ कृपया पहले `/login` करें।', { parse_mode: 'Markdown' });
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
    msg += `👥 उपयोगकर्ता: ${data.totalUsers}\n`;
    msg += `📦 प्रीसेट: ${data.totalPresets}\n`;
    msg += `⬇️ डाउनलोड: ${data.totalDownloads}\n`;
    msg += `💰 राजस्व: ₹${data.totalRevenue}\n`;
    msg += `⭐ औसत रेटिंग: ${data.avgRating}\n\n`;
    msg += `🔹 *कमांड्स:*\n`;
    msg += `/pending – लंबित प्रीसेट\n`;
    msg += `/approve <id> – स्वीकार\n`;
    msg += `/reject <id> – अस्वीकार\n`;
    msg += `/users – सभी उपयोगकर्ता\n`;
    msg += `/stats – विस्तृत आँकड़े\n`;
    msg += `/user <id> – किसी यूज़र की जानकारी`;

    await ctx.replyWithMarkdown(msg, Markup.inlineKeyboard([
      [Markup.button.callback('📊 लंबित प्रीसेट', 'admin_pending')],
      [Markup.button.callback('👥 सभी यूज़र', 'admin_users')],
      [Markup.button.callback('📈 आँकड़े', 'admin_stats')]
    ]));
  } catch (err) {
    console.error(err);
    ctx.reply('❌ एडमिन डेटा नहीं मिला। कृपया बाद में प्रयास करें।');
  }
});

// ==================== ADMIN COMMANDS ====================

bot.command('pending', async (ctx) => {
  await ctx.sendChatAction('typing');
  if (!ctx.dbUser || ctx.dbUser.role !== 'admin') return;
  try {
    const res = await axios.get(`${API_BASE}/admin/presets`, {
      headers: { Authorization: `Bearer ${ctx.dbUser.token}` }
    });
    const presets = res.data.filter(p => p.status === 'pending');
    if (!presets.length) return ctx.reply('✅ कोई लंबित प्रीसेट नहीं।');
    let msg = '⏳ *लंबित प्रीसेट:*\n\n';
    presets.forEach(p => {
      msg += `• *${p.name}* – ${p.author}\n   \`${p.id}\`\n`;
    });
    msg += '\nस्वीकार/अस्वीकार: `/approve <id>` या `/reject <id>`';
    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    ctx.reply('❌ लोड नहीं हुए।');
  }
});

bot.command('approve', async (ctx) => {
  await ctx.sendChatAction('typing');
  if (!ctx.dbUser || ctx.dbUser.role !== 'admin') return;
  const id = ctx.message.text.split(' ')[1];
  if (!id) return ctx.reply('आईडी दें: `/approve 123`');
  try {
    await axios.put(`${API_BASE}/admin/presets/${id}/status`, { status: 'approved' }, {
      headers: { Authorization: `Bearer ${ctx.dbUser.token}` }
    });
    ctx.reply(`✅ प्रीसेट ${id} स्वीकृत।`);
  } catch (err) {
    ctx.reply('❌ असफल। कृपया सही आईडी दें।');
  }
});

bot.command('reject', async (ctx) => {
  await ctx.sendChatAction('typing');
  if (!ctx.dbUser || ctx.dbUser.role !== 'admin') return;
  const id = ctx.message.text.split(' ')[1];
  if (!id) return ctx.reply('आईडी दें: `/reject 123`');
  try {
    await axios.put(`${API_BASE}/admin/presets/${id}/status`, { status: 'rejected' }, {
      headers: { Authorization: `Bearer ${ctx.dbUser.token}` }
    });
    ctx.reply(`❌ प्रीसेट ${id} अस्वीकृत।`);
  } catch (err) {
    ctx.reply('❌ असफल। कृपया सही आईडी दें।');
  }
});

bot.command('stats', async (ctx) => {
  await ctx.sendChatAction('typing');
  if (!ctx.dbUser || ctx.dbUser.role !== 'admin') {
    return ctx.reply('⛔ आप एडमिन नहीं हैं।');
  }
  try {
    const db = await getDB();
    const users = db.data.users;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);

    const activeToday = users.filter(u => u.lastActive && new Date(u.lastActive) >= today).length;
    const onlineNow = users.filter(u => u.lastActive && new Date(u.lastActive) >= fiveMinAgo).length;
    const totalCommands = users.reduce((sum, u) => sum + (u.commandsCount || 0), 0);
    const linkedUsers = users.filter(u => u.telegramId && u.token).length;

    let msg = `📊 *बॉट आँकड़े*\n\n`;
    msg += `👥 कुल उपयोगकर्ता: ${users.length}\n`;
    msg += `🔗 लिंक किए गए: ${linkedUsers}\n`;
    msg += `🟢 ऑनलाइन (5 मिनट): ${onlineNow}\n`;
    msg += `📅 आज सक्रिय: ${activeToday}\n`;
    msg += `📝 कुल कमांड्स: ${totalCommands}\n`;
    msg += `📦 कुल प्रीसेट: ${db.data.presets.length}\n`;
    msg += `💰 राजस्व: ₹${(db.data.orders || []).filter(o => o.status === 'paid').reduce((s,o) => s + o.amount, 0)}`;

    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    console.error(err);
    ctx.reply('❌ आँकड़े लोड नहीं हुए।');
  }
});

bot.command('users', async (ctx) => {
  await ctx.sendChatAction('typing');
  if (!ctx.dbUser || ctx.dbUser.role !== 'admin') return;
  try {
    const db = await getDB();
    const users = db.data.users;
    if (!users.length) return ctx.reply('कोई उपयोगकर्ता नहीं।');
    let msg = '👥 *सभी उपयोगकर्ता*\n\n';
    users.slice(0, 20).forEach(u => {
      const name = u.name || u.telegram?.firstName || 'Unknown';
      const tg = u.telegram?.username ? `@${u.telegram.username}` : (u.telegramId ? '✅' : '❌');
      const linked = u.token ? '🔗' : '⛔';
      msg += `• ${name} (${u.email || 'no email'}) ${tg} ${linked}\n`;
    });
    if (users.length > 20) msg += `\n... और ${users.length - 20} उपयोगकर्ता।`;
    msg += '\n\nकिसी specific user की detail के लिए `/user <telegramId>`';
    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    console.error(err);
    ctx.reply('❌ नहीं मिले।');
  }
});

bot.command('user', async (ctx) => {
  await ctx.sendChatAction('typing');
  if (!ctx.dbUser || ctx.dbUser.role !== 'admin') {
    return ctx.reply('⛔ आप एडमिन नहीं हैं।');
  }
  const tgId = ctx.message.text.split(' ')[1];
  if (!tgId) return ctx.reply('कृपया Telegram ID दें: `/user 123456789`');
  try {
    const db = await getDB();
    const user = db.data.users.find(u => u.telegramId === String(tgId));
    if (!user) return ctx.reply('❌ इस ID वाला कोई उपयोगकर्ता नहीं मिला।');
    const isOnline = user.lastActive && (new Date() - new Date(user.lastActive) < 5 * 60 * 1000);
    let msg = `👤 *उपयोगकर्ता विवरण*\n\n`;
    msg += `🆔 Telegram ID: \`${user.telegramId || 'N/A'}\`\n`;
    msg += `👤 नाम: ${user.name || 'N/A'}\n`;
    msg += `📧 ईमेल: ${user.email || 'N/A'}\n`;
    msg += `📛 यूज़रनेम: ${user.username || 'N/A'}\n`;
    msg += `🔗 लिंक: ${user.token ? '✅ हाँ' : '❌ नहीं'}\n`;
    msg += `🟢 स्थिति: ${isOnline ? '🟢 ऑनलाइन' : '⚪ ऑफलाइन'}\n`;
    msg += `📅 अंतिम सक्रियता: ${user.lastActive ? new Date(user.lastActive).toLocaleString() : 'N/A'}\n`;
    msg += `📝 कमांड्स: ${user.commandsCount || 0}\n`;
    msg += `👥 फॉलोअर्स: ${user.followers?.length || 0}\n`;
    msg += `📦 विशलिस्ट: ${user.wishlist?.length || 0}\n`;
    if (user.telegram) {
      msg += `\n📱 *Telegram Details*\n`;
      msg += `पहला नाम: ${user.telegram.firstName || 'N/A'}\n`;
      msg += `अंतिम नाम: ${user.telegram.lastName || 'N/A'}\n`;
      msg += `यूज़रनेम: ${user.telegram.username || 'N/A'}\n`;
      msg += `भाषा: ${user.telegram.languageCode || 'N/A'}\n`;
    }
    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    console.error(err);
    ctx.reply('❌ उपयोगकर्ता जानकारी नहीं मिली।');
  }
});

// ==================== ADMIN INLINE BUTTON HANDLERS ====================

bot.action('admin_pending', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.sendChatAction('typing');
  if (!ctx.dbUser || ctx.dbUser.role !== 'admin') {
    return ctx.reply('⛔ आप एडमिन नहीं हैं।');
  }
  try {
    const res = await axios.get(`${API_BASE}/admin/presets`, {
      headers: { Authorization: `Bearer ${ctx.dbUser.token}` }
    });
    const presets = res.data.filter(p => p.status === 'pending');
    if (!presets.length) {
      return ctx.reply('✅ कोई लंबित प्रीसेट नहीं।');
    }
    let msg = '⏳ *लंबित प्रीसेट:*\n\n';
    presets.forEach(p => {
      msg += `• *${p.name}* – ${p.author}\n   \`${p.id}\`\n`;
    });
    msg += '\nस्वीकार/अस्वीकार: `/approve <id>` या `/reject <id>`';
    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    ctx.reply('❌ लोड नहीं हुए।');
  }
});

bot.action('admin_users', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.sendChatAction('typing');
  if (!ctx.dbUser || ctx.dbUser.role !== 'admin') return;
  try {
    const db = await getDB();
    const users = db.data.users;
    if (!users.length) return ctx.reply('कोई उपयोगकर्ता नहीं।');
    let msg = '👥 *सभी उपयोगकर्ता*\n\n';
    users.slice(0, 20).forEach(u => {
      const name = u.name || u.telegram?.firstName || 'Unknown';
      const tg = u.telegram?.username ? `@${u.telegram.username}` : (u.telegramId ? '✅' : '❌');
      const linked = u.token ? '🔗' : '⛔';
      msg += `• ${name} (${u.email || 'no email'}) ${tg} ${linked}\n`;
    });
    if (users.length > 20) msg += `\n... और ${users.length - 20} उपयोगकर्ता।`;
    msg += '\n\nकिसी specific user की detail के लिए `/user <telegramId>`';
    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    ctx.reply('❌ नहीं मिले।');
  }
});

bot.action('admin_stats', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.sendChatAction('typing');
  if (!ctx.dbUser || ctx.dbUser.role !== 'admin') return;
  try {
    const db = await getDB();
    const users = db.data.users;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);

    const activeToday = users.filter(u => u.lastActive && new Date(u.lastActive) >= today).length;
    const onlineNow = users.filter(u => u.lastActive && new Date(u.lastActive) >= fiveMinAgo).length;
    const totalCommands = users.reduce((sum, u) => sum + (u.commandsCount || 0), 0);
    const linkedUsers = users.filter(u => u.telegramId && u.token).length;

    let msg = `📊 *बॉट आँकड़े*\n\n`;
    msg += `👥 कुल उपयोगकर्ता: ${users.length}\n`;
    msg += `🔗 लिंक किए गए: ${linkedUsers}\n`;
    msg += `🟢 ऑनलाइन (5 मिनट): ${onlineNow}\n`;
    msg += `📅 आज सक्रिय: ${activeToday}\n`;
    msg += `📝 कुल कमांड्स: ${totalCommands}\n`;
    msg += `📦 कुल प्रीसेट: ${db.data.presets.length}\n`;
    msg += `💰 राजस्व: ₹${(db.data.orders || []).filter(o => o.status === 'paid').reduce((s,o) => s + o.amount, 0)}`;

    await ctx.replyWithMarkdown(msg);
  } catch (err) {
    console.error(err);
    ctx.reply('❌ आँकड़े लोड नहीं हुए।');
  }
});

// ==================== INLINE KEYBOARD HANDLERS ====================

bot.action(/download_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.sendChatAction('typing');
  const id = ctx.match[1];
  await handleDownload(ctx, id);
});

bot.action(/wishlist_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const id = ctx.match[1];
  if (!ctx.dbUser || !ctx.dbUser.token) {
    return ctx.answerCbQuery('कृपया पहले /login करें', { show_alert: true });
  }
  try {
    await axios.post(`${API_BASE}/users/me/wishlist/${id}`, {}, {
      headers: { Authorization: `Bearer ${ctx.dbUser.token}` }
    });
    ctx.answerCbQuery('❤️ विशलिस्ट अपडेट!');
  } catch (err) {
    console.error(err);
    ctx.answerCbQuery('❌ त्रुटि', { show_alert: true });
  }
});

// ==================== DOWNLOAD LOGIC ====================

async function handleDownload(ctx, presetId) {
  if (!ctx.dbUser || !ctx.dbUser.token) {
    return ctx.reply('कृपया पहले `/login` करें।', { parse_mode: 'Markdown' });
  }
  await ctx.sendChatAction('typing');
  try {
    const res = await axios.post(`${API_BASE}/presets/${presetId}/download`, {}, {
      headers: { Authorization: `Bearer ${ctx.dbUser.token}` },
      responseType: 'arraybuffer'
    });
    const fileName = res.headers['content-disposition']?.match(/filename="(.+)"/)?.[1] || 'preset.xmp';
    await ctx.replyWithDocument(
      { source: Buffer.from(res.data), filename: fileName },
      { caption: '✅ प्रीसेट डाउनलोड हो गया! 🎉' }
    );
  } catch (err) {
    console.error(err);
    if (err.response && err.response.status === 403) {
      ctx.reply('⛔ आपके पास इस प्रीसेट को डाउनलोड करने की अनुमति नहीं है। कृपया इसे पहले खरीदें।');
    } else if (err.response && err.response.status === 404) {
      ctx.reply('❌ प्रीसेट फ़ाइल सर्वर पर नहीं मिली। कृपया बाद में प्रयास करें।');
    } else {
      ctx.reply('❌ डाउनलोड विफल। कृपया बाद में प्रयास करें।');
    }
  }
}

// ==================== PROFILE (for keyboard) ====================

async function showProfile(ctx) {
  if (ctx.dbUser && ctx.dbUser.token) {
    const user = ctx.dbUser;
    const isAdmin = user.role === 'admin' ? '✅ हाँ' : '❌ नहीं';
    const linked = user.telegramId ? '✅ हाँ' : '❌ नहीं';
    let msg = `👤 *आपका प्रोफ़ाइल*\n\n`;
    msg += `👤 नाम: ${user.name || 'N/A'}\n`;
    msg += `📧 ईमेल: ${user.email || 'N/A'}\n`;
    msg += `📛 यूज़रनेम: ${user.username || 'N/A'}\n`;
    msg += `🔗 लिंक: ${linked}\n`;
    msg += `🛡️ एडमिन: ${isAdmin}\n`;
    msg += `📝 कमांड्स: ${user.commandsCount || 0}\n`;
    msg += `📦 विशलिस्ट: ${user.wishlist?.length || 0}\n`;
    await ctx.replyWithMarkdown(msg);
  } else {
    ctx.reply('आप लॉगिन नहीं हैं। /login करें।');
  }
}

// ==================== TEXT HANDLER (FALLBACK – Keyboard & Login) ====================
// This must be defined AFTER all command handlers, so it acts as a fallback
bot.on('text', async (ctx, next) => {
  const text = ctx.message.text.trim();
  const chatId = ctx.chat.id;

  // ---- Check Login State ----
  const state = loginStates.get(chatId);
  if (state) {
    // Cancel
    if (text === '/cancel') {
      loginStates.delete(chatId);
      return ctx.reply('❌ लॉगिन रद्द किया।', mainMenu);
    }

    if (state.step === 'email') {
      state.email = text;
      state.step = 'password';
      return ctx.reply('🔑 अब अपना पासवर्ड दर्ज करें:');
    }

    if (state.step === 'password') {
      const email = state.email;
      const password = text;
      
      // Clear state immediately to avoid re-trigger
      loginStates.delete(chatId);
      
      await ctx.sendChatAction('typing');
      
      try {
        const res = await axios.post(`${API_BASE}/auth/login`, { email, password });
        if (res.data.token) {
          const user = res.data.user;
          const updatedUser = await linkTelegramId(user.id, ctx.from.id, res.data.token, ctx);
          ctx.dbUser = updatedUser;
          await ctx.reply(
            `✅ आपका अकाउंट लिंक हो गया! स्वागत है ${user.name} 🎉\n\nअब आप /download, /myorders, /admin आदि का उपयोग कर सकते हैं।`,
            mainMenu
          );
        } else {
          ctx.reply('❌ गलत ईमेल या पासवर्ड। /login फिर से करें।');
        }
      } catch (err) {
        console.error('Login error:', err.response?.data || err.message);
        let errorMsg = '❌ लॉगिन विफल।';
        if (err.response && err.response.status === 401) {
          errorMsg = '❌ गलत ईमेल या पासवर्ड। कृपया /login से पुनः प्रयास करें।';
        } else if (err.response && err.response.status === 404) {
          errorMsg = '❌ यह ईमेल पंजीकृत नहीं है। कृपया पहले साइन अप करें।';
        } else {
          errorMsg = '❌ सर्वर से कनेक्ट नहीं हो पाया। कृपया बाद में प्रयास करें।';
        }
        ctx.reply(errorMsg);
      }
      return;
    }
  }

  // ---- Not in login – handle keyboard actions ----
  const actions = {
    '🔍 खोजें': () => ctx.reply('खोज शब्द टाइप करें: /search <क्वेरी>'),
    '📂 श्रेणियाँ': () => ctx.reply('/categories'),
    '🔥 लोकप्रिय': () => ctx.reply('/popular'),
    '🆕 नए': () => ctx.reply('/recent'),
    '👤 मेरा अकाउंट': () => showProfile(ctx),
    '🛒 मेरे ऑर्डर': () => ctx.reply('/myorders'),
    '📊 एडमिन पैनल': () => ctx.reply('/admin'),
  };
  
  if (actions[text]) {
    await actions[text]();
    return; // handled, don't call next
  }

  // ---- If not handled, let other handlers (commands) process ----
  await next();
});

// ==================== START BOT ====================

bot.launch()
  .then(() => console.log('🤖 Telegram bot started'))
  .catch(err => console.error('Bot launch error', err));

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));