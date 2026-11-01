/* Grants the admin role to an account by email. Sign-in itself is handled by Clerk.
   Usage: node create-admin.js you@example.com   (run with MONGODB_URI set)
   If the account does not exist yet, it is created with role "admin" and links to the Clerk login on first sign-in. */
require('dotenv').config();
const mongoose = require('mongoose');
const { User } = require('./models');
(async () => {
  const email = String(process.argv[2] || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error('Usage: node create-admin.js you@example.com'); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI);
  const u = await User.findOneAndUpdate({ email }, { $set: { role: 'admin', status: 'active' }, $setOnInsert: { name: 'Admin', username: 'admin' } }, { upsert: true, new: true });
  console.log(`Admin role set for ${u.email}. Sign in with Clerk using this email (verified) to use the admin panel.`);
  await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
