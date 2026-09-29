const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db/db');

// If ADMIN_EMAIL + ADMIN_PASSWORD (12+ chars) are set, make sure that admin exists.
// Never overwrites an existing password. Remove ADMIN_PASSWORD after first boot.
async function ensureAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !password) return;
  if (password.length < 12) return console.warn('ADMIN_PASSWORD must be 12+ chars - admin not created');
  const db = await getDB();
  const existing = db.data.users.find(u => u.email === email);
  if (existing) {
    if (existing.role !== 'admin') { existing.role = 'admin'; await db.write(); console.log('Promoted to admin:', email); }
    return;
  }
  db.data.users.push({
    id: uuidv4(), email, password: await bcrypt.hash(password, 12), name: 'Admin', username: 'admin', role: 'admin',
    createdAt: new Date().toISOString(), verified: true, bio: '', avatar: '',
    socialLinks: { instagram: '', youtube: '', twitter: '', website: '' }, followers: [], following: [], wishlist: []
  });
  await db.write();
  console.log('Admin created:', email);
}
module.exports = { ensureAdmin };
