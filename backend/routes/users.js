const express = require('express');
const auth = require('../middleware/auth');
const { getDB } = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// ===== HELPER: create notification =====
async function createNotification(userId, type, message, link) {
  const db = await getDB();
  const user = db.data.users.find(u => u.id === userId);
  if (!user) return;
  if (!user.notifications) user.notifications = [];

  const exists = user.notifications.some(n => n.message === message && n.type === type && !n.read);
  if (exists) return;

  user.notifications.push({
    id: uuidv4(),
    type,
    message,
    read: false,
    createdAt: new Date().toISOString(),
    link: link || '/'
  });
  await db.write();
}

// ===== AVATAR UPLOAD =====
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const avatarDir = path.join(__dirname, '../../uploads/avatars');
    if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });
    cb(null, avatarDir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const avatarFilter = (req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) cb(null, true);
  else cb(new Error('Only images allowed'), false);
};

const uploadAvatar = multer({
  storage: avatarStorage,
  fileFilter: avatarFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
}).single('avatar');

// ===== GET /users (public) =====
router.get('/', async (req, res) => {
  const db = await getDB();
  const users = db.data.users.map(({ password, ...rest }) => ({
    id: rest.id,
    name: rest.name,
    username: rest.username,
    avatar: rest.avatar,
    followers: rest.followers?.length || 0,
    presetCount: db.data.presets.filter(p => p.authorId === rest.id).length
  }));
  res.json(users);
});

// ===== GET own profile =====
router.get('/me', auth, async (req, res) => {
  const db = await getDB();
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { password, ...safeUser } = user;
  res.json(safeUser);
});

// ===== UPDATE profile =====
router.put('/me', auth, async (req, res) => {
  const { name, username, bio, avatar, socialLinks, email } = req.body;
  const db = await getDB();
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (username && username !== user.username) {
    const existing = db.data.users.find(u => u.username === username && u.id !== req.user.id);
    if (existing) return res.status(409).json({ error: 'Username taken' });
  }
  if (email && email !== user.email) {
    const existing = db.data.users.find(u => u.email === email && u.id !== req.user.id);
    if (existing) return res.status(409).json({ error: 'Email taken' });
  }

  if (name) user.name = name;
  if (username) user.username = username;
  if (bio !== undefined) user.bio = bio;
  if (avatar) user.avatar = avatar;
  if (email) user.email = email;
  if (socialLinks) user.socialLinks = { ...user.socialLinks, ...socialLinks };

  await db.write();
  const { password, ...safeUser } = user;
  res.json(safeUser);
});

// ===== UPLOAD avatar =====
router.put('/me/avatar', auth, (req, res) => {
  uploadAvatar(req, res, async function (err) {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file' });

    const db = await getDB();
    const user = db.data.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.avatar && user.avatar.startsWith('/uploads/avatars/')) {
      const oldPath = path.join(__dirname, '../..', user.avatar);
      if (fs.existsSync(oldPath)) {
        try { fs.unlinkSync(oldPath); } catch (e) {}
      }
    }

    user.avatar = `/uploads/avatars/${req.file.filename}`;
    await db.write();
    res.json({ avatar: user.avatar });
  });
});

// ===== GET top creators =====
router.get('/top', async (req, res) => {
  const db = await getDB();
  const users = db.data.users;
  const presets = db.data.presets;

  const top = users.map(u => {
    const userPresets = presets.filter(p => p.authorId === u.id);
    const totalDownloads = userPresets.reduce((sum, p) => sum + (p.downloads || 0), 0);
    return {
      id: u.id,
      name: u.name,
      username: u.username || u.email?.split('@')[0] || '',
      avatar: u.avatar,
      presetCount: userPresets.length,
      totalDownloads,
      followers: u.followers?.length || 0,
    };
  })
  .sort((a, b) => b.presetCount - a.presetCount || b.totalDownloads - a.totalDownloads)
  .slice(0, 5);

  res.json(top);
});

// ===== GET public profile =====
router.get('/:id', async (req, res) => {
  const db = await getDB();
  const user = db.data.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { password, ...safeUser } = user;
  const presets = db.data.presets.filter(p => p.authorId === user.id);
  const totalDownloads = presets.reduce((sum, p) => sum + (p.downloads || 0), 0);

  res.json({
    ...safeUser,
    totalPresets: presets.length,
    totalDownloads,
    followers: user.followers?.length || 0,
    following: user.following?.length || 0,
  });
});

// ===== GET presets by user =====
router.get('/:id/presets', async (req, res) => {
  const db = await getDB();
  const presets = db.data.presets.filter(p => p.authorId === req.params.id);
  res.json(presets);
});

// ===== FOLLOW / UNFOLLOW =====
router.post('/:id/follow', auth, async (req, res) => {
  const db = await getDB();
  const target = db.data.users.find(u => u.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Cannot follow self' });

  const current = db.data.users.find(u => u.id === req.user.id);
  if (!current) return res.status(404).json({ error: 'User not found' });

  if (!target.followers) target.followers = [];
  if (!current.following) current.following = [];

  const isFollowing = target.followers.includes(current.id);

  if (isFollowing) {
    target.followers = target.followers.filter(id => id !== current.id);
    current.following = current.following.filter(id => id !== target.id);
    await db.write();
    return res.json({
      following: false,
      followersCount: target.followers.length,
      followingCount: current.following.length
    });
  } else {
    target.followers.push(current.id);
    current.following.push(target.id);
    await db.write();
    await createNotification(target.id, 'follow', `${current.name} started following you!`, `/profile/${current.id}`);
    return res.json({
      following: true,
      followersCount: target.followers.length,
      followingCount: current.following.length
    });
  }
});

// ===== GET downloads history =====
router.get('/me/downloads', auth, async (req, res) => {
  const db = await getDB();
  const downloads = (db.data.downloads || []).filter(d => d.userId === req.user.id);
  const presetIds = downloads.map(d => d.presetId);
  const presets = db.data.presets.filter(p => presetIds.includes(p.id));
  res.json(presets);
});

// ===== TOGGLE wishlist =====
router.post('/me/wishlist/:presetId', auth, async (req, res) => {
  const db = await getDB();
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (!user.wishlist) user.wishlist = [];
  const idx = user.wishlist.indexOf(req.params.presetId);

  if (idx === -1) user.wishlist.push(req.params.presetId);
  else user.wishlist.splice(idx, 1);

  await db.write();
  res.json({ wishlist: user.wishlist });
});

// ===== SUBSCRIPTION =====
router.get('/me/subscription', auth, async (req, res) => {
  const db = await getDB();
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const sub = user.subscription || {};
  const ref = user.referral || {};
  const now = new Date();
  const isPremium = sub.expiry && new Date(sub.expiry) > now;

  res.json({
    isPremium,
    expiry: sub.expiry || null,
    adWatchCount: sub.adWatchCount || 0,
    adRewardDays: sub.adRewardDays || 0,
    referralCode: ref.code || null,
    referralCount: ref.referralCount || 0,
    referralRewardDays: ref.referralRewardDays || 0
  });
});

// ===== AD WATCHED =====
router.post('/ads/watched', auth, async (req, res) => {
  const db = await getDB();
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const sub = user.subscription || {};
  const last = sub.lastAdWatch ? new Date(sub.lastAdWatch) : null;

  if (last && (Date.now() - last.getTime()) < 5000) {
    return res.status(429).json({ error: 'Please wait before watching another ad' });
  }

  sub.adWatchCount = (sub.adWatchCount || 0) + 1;
  sub.lastAdWatch = new Date().toISOString();

  if (sub.adWatchCount % 10 === 0) {
    const now = new Date();
    let expiry = sub.expiry ? new Date(sub.expiry) : now;
    if (expiry < now) expiry = now;
    expiry.setDate(expiry.getDate() + 10);
    sub.expiry = expiry.toISOString();
    sub.adRewardDays = (sub.adRewardDays || 0) + 10;
  }

  user.subscription = sub;
  await db.write();

  res.json({
    adWatchCount: sub.adWatchCount,
    expiry: sub.expiry,
    daysEarned: sub.adRewardDays || 0
  });
});

// ===== GENERATE REFERRAL =====
router.post('/referrals/generate', auth, async (req, res) => {
  const db = await getDB();
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (!user.referral) {
    user.referral = { code: null, referredBy: null, referralCount: 0, referralRewardDays: 0 };
  }

  if (!user.referral.code) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    user.referral.code = code;
  }

  await db.write();
  res.json({ referralCode: user.referral.code });
});

// ===== NOTIFICATIONS =====
router.get('/me/notifications', auth, async (req, res) => {
  const db = await getDB();
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user.notifications || []);
});

router.post('/notifications/read/:id', auth, async (req, res) => {
  const db = await getDB();
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const notif = (user.notifications || []).find(n => n.id === req.params.id);
  if (notif) notif.read = true;
  await db.write();
  res.json({ success: true });
});

router.post('/notifications/read-all', auth, async (req, res) => {
  const db = await getDB();
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  (user.notifications || []).forEach(n => n.read = true);
  await db.write();
  res.json({ success: true });
});

// ===== EARNINGS =====
router.get('/:id/earnings', auth, async (req, res) => {
  const userId = req.params.id;
  if (req.user.id !== userId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const db = await getDB();
  const user = db.data.users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const presets = db.data.presets.filter(p => p.authorId === userId);
  const presetStats = presets.map(p => ({
    id: p.id,
    name: p.name,
    category: p.category,
    downloads: p.downloads || 0,
    impressions: p.adImpressions || 0,
    revenue: p.totalRevenue || 0
  }));

  const totalImpressions = presetStats.reduce((sum, p) => sum + p.impressions, 0);
  const totalRevenue = presetStats.reduce((sum, p) => sum + p.revenue, 0);
  const totalDownloads = presetStats.reduce((sum, p) => sum + p.downloads, 0);

  res.json({
    user: { id: user.id, name: user.name, email: user.email },
    totalImpressions,
    totalRevenue,
    totalDownloads,
    presets: presetStats,
    canWithdraw: totalRevenue >= 100,
    withdrawalStatus: user.withdrawalStatus || null
  });
});

module.exports = router;
module.exports.createNotification = createNotification;