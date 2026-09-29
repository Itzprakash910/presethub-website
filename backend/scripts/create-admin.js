// Usage: set ADMIN_EMAIL and ADMIN_PASSWORD in .env, then: npm run create-admin
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db/db');

(async () => {
  const email = (process.env.ADMIN_EMAIL || '').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || password.length < 12) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD (min 12 chars) in backend/.env');
    process.exit(1);
  }
  const db = await getDB();
  const hash = await bcrypt.hash(password, 12);
  let user = db.data.users.find(u => u.email === email);
  if (user) { user.password = hash; user.role = 'admin'; }
  else {
    db.data.users.push({
      id: uuidv4(), email, password: hash, name: 'Admin', username: 'admin', role: 'admin',
      createdAt: new Date().toISOString(), verified: true, bio: '', avatar: '',
      socialLinks: { instagram: '', youtube: '', twitter: '', website: '' },
      followers: [], following: [], wishlist: []
    });
  }
  await db.write();
  console.log(`Admin ready: ${email}. Now REMOVE ADMIN_PASSWORD from .env`);
})();
