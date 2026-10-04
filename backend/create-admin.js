require('dotenv').config();
const bcrypt = require('bcryptjs');
const { connectDB } = require('./config/db');
const { User } = require('./models');

(async () => {
  try {
    const email = String(process.env.ADMIN_EMAIL || '').toLowerCase().trim();
    const password = String(process.env.ADMIN_PASSWORD || '');
    if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD');
    if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');
    await connectDB();
    let user = await User.findOne({ email });
    const usernameBase = email.split('@')[0].replace(/[^a-z0-9_]/g, '').slice(0, 24) || 'admin';
    if (!user) {
      let username = usernameBase;
      for (let i = 1; await User.exists({ username }) && i < 1000; i++) username = `${usernameBase}${i}`;
      user = new User({ email, username, name: 'PresetHub Admin', role: 'admin', verified: true, status: 'active' });
    }
    user.password = await bcrypt.hash(password, 12);
    user.role = 'admin';
    user.verified = true;
    user.status = 'active';
    user.sessionVersion = Number(user.sessionVersion || 0) + 1;
    await user.save();
    console.log(`Admin ready: ${email}`);
    process.exit(0);
  } catch (err) {
    console.error('Create admin failed:', err.message);
    process.exit(1);
  }
})();
