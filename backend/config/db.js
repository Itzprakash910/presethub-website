const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../db.json');
let dbData = null;
let dbPromise = null;

function migrateData(data) {
  let changed = false;

  if (!data.users) { data.users = []; changed = true; }
  if (!data.presets) { data.presets = []; changed = true; }
  if (!data.downloads) { data.downloads = []; changed = true; }
  if (!data.orders) { data.orders = []; changed = true; }
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
    if (!user.notifications) { user.notifications = []; changed = true; }
    if (!user.followers) { user.followers = []; changed = true; }
    if (!user.following) { user.following = []; changed = true; }
    if (!user.wishlist) { user.wishlist = []; changed = true; }
    if (!user.socialLinks) {
      user.socialLinks = { instagram: '', youtube: '', twitter: '', website: '' };
      changed = true;
    }
    if (user.verified === undefined) { user.verified = true; changed = true; }
  });

  data.presets.forEach(preset => {
    if (preset.views === undefined) { preset.views = 0; changed = true; }
    if (!preset.likes) { preset.likes = []; changed = true; }
    if (preset.shares === undefined) { preset.shares = 0; changed = true; }
    if (preset.adImpressions === undefined) { preset.adImpressions = 0; changed = true; }
    if (preset.totalRevenue === undefined) { preset.totalRevenue = 0; changed = true; }
    if (!preset.status) { preset.status = 'pending'; changed = true; }
    if (!preset.reviews) { preset.reviews = []; changed = true; }
    if (!preset.tags) { preset.tags = []; changed = true; }
  });

  data.orders.forEach(order => {
    if (!order.status) { order.status = 'created'; changed = true; }
    if (!order.createdAt) { order.createdAt = new Date().toISOString(); changed = true; }
  });

  data.downloads.forEach(download => {
    if (!download.downloadedAt) { download.downloadedAt = new Date().toISOString(); changed = true; }
  });

  if (changed) {
    try {
      fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
      console.log('✅ Database migrated successfully');
    } catch (err) {
      console.error('❌ Failed to save migrated data:', err);
    }
  }
}

function loadData() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      dbData = {
        users: [],
        presets: [],
        downloads: [],
        orders: [],
        categories: ['सनसेट', 'ब्लैक & व्हाइट', 'नैचुरल', 'विंटेज', 'सिटीस्केप']
      };
      fs.writeFileSync(DB_PATH, JSON.stringify(dbData, null, 2));
      console.log('✅ New database created');
    } else {
      const content = fs.readFileSync(DB_PATH, 'utf8');
      dbData = JSON.parse(content);
      migrateData(dbData);
    }
  } catch (err) {
    console.error('❌ Error loading database:', err);
    dbData = {
      users: [],
      presets: [],
      downloads: [],
      orders: [],
      categories: ['सनसेट', 'ब्लैक & व्हाइट', 'नैचुरल', 'विंटेज', 'सिटीस्केप']
    };
  }
}

function saveData() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(dbData, null, 2));
  } catch (err) {
    console.error('❌ Error saving database:', err);
    throw err;
  }
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

async function initAdmin() {
  try {
    const db = await getDB();
    const adminExists = db.data.users.find(u => u.email === 'admin@presethub.com');
    if (!adminExists) {
      const bcrypt = require('bcryptjs');
      const hashed = await bcrypt.hash('admin123', 10);
      const adminUser = {
        id: 'admin_' + Date.now(),
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
      };
      db.data.users.push(adminUser);
      await db.write();
      console.log('✅ Admin user created successfully');
      console.log('📧 Email: admin@presethub.com');
      console.log('🔑 Password: admin123');
    }
  } catch (err) {
    console.error('❌ Error creating admin:', err);
  }
}

initAdmin().catch(console.error);

module.exports = { getDB };