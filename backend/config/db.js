const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../db.json');
let dbData = null;
let dbPromise = null;

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

// Initialize with admin user if not exists
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
      socialLinks: {
        instagram: '',
        youtube: '',
        twitter: '',
        website: ''
      },
      followers: [],
      following: [],
      wishlist: []
    });
    await db.write();
    console.log('✅ Admin user created');
  }
}

// Call init on startup
initAdmin().catch(console.error);

module.exports = { getDB };