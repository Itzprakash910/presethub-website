const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../db.json');
let dbData = null;
let dbPromise = null;

// ===== MIGRATION FUNCTION =====
function migrateData(data) {
  let changed = false;

  // Users: subscription, referral, notifications
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
  });

  // Presets: views, likes, shares, adImpressions, totalRevenue
  data.presets.forEach(preset => {
    if (preset.views === undefined) { preset.views = 0; changed = true; }
    if (!preset.likes) { preset.likes = []; changed = true; }
    if (preset.shares === undefined) { preset.shares = 0; changed = true; }
    if (preset.adImpressions === undefined) { preset.adImpressions = 0; changed = true; }
    if (preset.totalRevenue === undefined) { preset.totalRevenue = 0; changed = true; }
  });

  if (changed) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    console.log('✅ Database migrated with new fields');
  }
}

function loadData() {
  if (!fs.existsSync(DB_PATH)) {
    // Create fresh db with all fields
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
    // Run migration to add missing fields
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
    console.log('✅ Admin user created with new fields');
  }
}

initAdmin().catch(console.error);

module.exports = { getDB };