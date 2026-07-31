const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../db.json');
let dbData = null;
let dbPromise = null;

// ===== MIGRATION FUNCTION =====
function migrateData(data) {
  let changed = false;

  if (!data.users) data.users = [];
  if (!data.presets) data.presets = [];
  if (!data.downloads) data.downloads = [];
  if (!data.orders) data.orders = [];
  if (!data.categories) {
    data.categories = ['सनसेट', 'ब्लैक & व्हाइट', 'नैचुरल', 'विंटेज', 'सिटीस्केप'];
    changed = true;
  }

  data.users.forEach(user => {
    if (!user.subscription) {
      user.subscription = { tier: 'free', expiry: null, adWatchCount: 0, adRewardDays: 0, lastAdWatch: null };
      changed = true;
    }
    if (!user.referral) {
      user.referral = { code: null, referredBy: null, referralCount: 0, referralRewardDays: 0 };
      changed = true;
    }
    if (!user.notifications) {
      user.notifications = [];
      changed = true;
    }
    if (!user.followers) user.followers = [];
    if (!user.following) user.following = [];
    if (!user.wishlist) user.wishlist = [];
  });

  data.presets.forEach(preset => {
    if (preset.views === undefined) { preset.views = 0; changed = true; }
    if (!preset.likes) { preset.likes = []; changed = true; }
    if (preset.shares === undefined) { preset.shares = 0; changed = true; }
    if (preset.adImpressions === undefined) { preset.adImpressions = 0; changed = true; }
    if (preset.totalRevenue === undefined) { preset.totalRevenue = 0; changed = true; }
    if (!preset.status) { preset.status = 'approved'; changed = true; }
  });

  // Remove duplicate telegram users (keep the latest one)
  const seenTelegram = new Map();
  const cleanedUsers = [];
  for (const user of data.users) {
    if (user.telegramId || (user.id && user.id.startsWith('tele_'))) {
      const key = user.telegramId || user.id;
      if (seenTelegram.has(key)) {
        // Keep the one with more data / later lastActive
        const existing = seenTelegram.get(key);
        const existingTime = new Date(existing.lastActive || existing.createdAt || 0);
        const currentTime = new Date(user.lastActive || user.createdAt || 0);
        if (currentTime > existingTime) {
          seenTelegram.set(key, user);
        }
      } else {
        seenTelegram.set(key, user);
      }
    } else {
      cleanedUsers.push(user);
    }
  }
  // Add cleaned telegram users
  for (const user of seenTelegram.values()) {
    cleanedUsers.push(user);
  }
  if (cleanedUsers.length !== data.users.length) {
    data.users = cleanedUsers;
    changed = true;
    console.log('✅ Cleaned duplicate Telegram users');
  }

  if (changed) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    console.log('✅ Database migrated / cleaned');
  }
}

function loadData() {
  if (!fs.existsSync(DB_PATH)) {
    dbData = {
      users: [],
      presets: [],
      downloads: [],
      orders: [],
      categories: ['सनसेट', 'ब्लैक & व्हाइट', 'नैचुरल', 'विंटेज', 'सिटीस्केप']
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(dbData, null, 2));
  } else {
    const content = fs.readFileSync(DB_PATH, 'utf8');
    dbData = JSON.parse(content);
    migrateData(dbData);
  }
}

function saveData() {
  fs.writeFileSync(DB_PATH, JSON.stringify(dbData, null, 2));
}

async function getDB() {
  if (!dbPromise) {
    dbPromise = (async () => {
      loadData();
      return {
        data: dbData,
        write: async () => { saveData(); },
        read: () => { loadData(); }
      };
    })();
  }
  return dbPromise;
}

// Initialize admin if not exists
async function initAdmin() {
  const db = await getDB();
  const adminExists = db.data.users.find(u => u.email === 'admin@presethub.com');
  if (!adminExists) {
    const bcrypt = require('bcryptjs');
    const hashed = await bcrypt.hash('admin123', 10);
    db.data.users.push({
      id: 'admin1',
      email: 'admin@presethub.com',
      password: hashed,
      name: 'Admin',
      username: 'admin',
      role: 'admin',
      createdAt: new Date().toISOString(),
      verified: true,
      bio: 'Platform administrator',
      avatar: '',
      socialLinks: { instagram: '', youtube: '', twitter: '', website: '' },
      followers: [],
      following: [],
      wishlist: [],
      subscription: { tier: 'free', expiry: null, adWatchCount: 0, adRewardDays: 0, lastAdWatch: null },
      referral: { code: null, referredBy: null, referralCount: 0, referralRewardDays: 0 },
      notifications: []
    });
    await db.write();
    console.log('✅ Admin user created');
  }
}

initAdmin().catch(console.error);

module.exports = { getDB };