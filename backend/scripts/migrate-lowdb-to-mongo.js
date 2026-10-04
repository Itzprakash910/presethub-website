require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { connectDB } = require('../config/db');
const { User, Preset, Order, Download } = require('../models');

const DB_PATH = path.join(__dirname, '../../db.json');

async function migrate() {
  console.log('🔄 Migrating LowDB → MongoDB...');
  await connectDB();

  if (!fs.existsSync(DB_PATH)) {
    console.log('⚠️  No db.json found. Skipping.');
    process.exit(0);
  }

  const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  console.log(`📊 Found ${data.users?.length || 0} users, ${data.presets?.length || 0} presets`);

  const userIdMap = {};
  for (const u of data.users || []) {
    try {
      const existing = await User.findOne({ email: u.email });
      if (existing) { userIdMap[u.id] = existing._id; continue; }

      const newUser = await User.create({
        email: u.email || `migrated_${Date.now()}_${Math.random()}@placeholder.local`,
        password: u.password || await bcrypt.hash(crypto.randomBytes(32).toString('base64url'), 12),
        name: u.name || u.username || 'User',
        username: u.username,
        role: u.role || 'user',
        verified: u.verified !== false,
        bio: u.bio || '', avatar: u.avatar || '',
        socialLinks: u.socialLinks || {},
        subscription: u.subscription || {},
        referral: u.referral || {},
        createdAt: u.createdAt || new Date()
      });
      userIdMap[u.id] = newUser._id;
    } catch (err) { console.error(`User migration failed (${u.email}):`, err.message); }
  }
  console.log(`✅ Migrated ${Object.keys(userIdMap).length} users`);

  let count = 0;
  for (const p of data.presets || []) {
    try {
      const authorId = userIdMap[p.authorId];
      if (!authorId) { console.warn(`Skipping "${p.name}" — no author`); continue; }
      if (await Preset.exists({ name: p.name, authorId })) continue;

      await Preset.create({
        name: p.name, description: p.description || '',
        category: p.category || 'General', tags: p.tags || [],
        price: p.price || 0, author: p.author || 'Creator', authorId,
        fileUrl: p.fileUrl || '', previewImage: p.previewImage || '',
        size: p.size || 0, originalName: p.originalName || '',
        downloads: p.downloads || 0, avgRating: p.avgRating || 0,
        reviews: (p.reviews || []).map(r => ({
          userName: r.userName, rating: r.rating, comment: r.comment,
          helpful: r.helpful || 0, createdAt: r.createdAt || new Date()
        })),
        views: p.views || 0, shares: p.shares || 0,
        adImpressions: p.adImpressions || 0, totalRevenue: p.totalRevenue || 0,
        status: p.status === 'rejected' ? 'rejected' : 'approved',
        createdAt: p.createdAt || new Date()
      });
      count++;
    } catch (err) { console.error(`Preset "${p.name}" failed:`, err.message); }
  }
  console.log(`✅ Migrated ${count} presets`);
  console.log('🎉 Done!');
  process.exit(0);
}

migrate().catch(err => { console.error('Migration error:', err); process.exit(1); });