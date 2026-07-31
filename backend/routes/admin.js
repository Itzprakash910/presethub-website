const express = require('express');
const auth = require('../middleware/auth');
const { getDB } = require('../config/db');

const router = express.Router();

const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

router.use(auth, isAdmin);

// Get all users
router.get('/users', async (req, res) => {
  const db = await getDB();
  const users = db.data.users.map(({ password, ...rest }) => rest);
  res.json(users);
});

router.get('/users/:id', async (req, res) => {
  const db = await getDB();
  const user = db.data.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { password, ...safeUser } = user;
  res.json(safeUser);
});

router.put('/users/:id/role', async (req, res) => {
  const { role } = req.body;
  if (!['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  const db = await getDB();
  const user = db.data.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.role = role;
  await db.write();
  const { password, ...safeUser } = user;
  res.json(safeUser);
});

router.delete('/users/:id', async (req, res) => {
  const db = await getDB();
  const index = db.data.users.findIndex(u => u.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'User not found' });
  if (db.data.users[index].role === 'admin') {
    return res.status(400).json({ error: 'Cannot delete admin user' });
  }
  db.data.users.splice(index, 1);
  await db.write();
  res.json({ success: true });
});

router.put('/users/:id/verify', async (req, res) => {
  const { verified } = req.body;
  const db = await getDB();
  const user = db.data.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.verified = verified;
  await db.write();
  res.json({ success: true, verified });
});

router.put('/users/:id', async (req, res) => {
  const { name, username, email, bio, role, verified } = req.body;
  const db = await getDB();
  const user = db.data.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (username && username !== user.username) {
    const existing = db.data.users.find(u => u.username === username && u.id !== req.params.id);
    if (existing) return res.status(409).json({ error: 'Username already taken' });
  }
  if (email && email !== user.email) {
    const existing = db.data.users.find(u => u.email === email && u.id !== req.params.id);
    if (existing) return res.status(409).json({ error: 'Email already taken' });
  }

  if (name) user.name = name;
  if (username) user.username = username;
  if (email) user.email = email;
  if (bio !== undefined) user.bio = bio;
  if (role) user.role = role;
  if (verified !== undefined) user.verified = verified;

  await db.write();
  const { password, ...safeUser } = user;
  res.json(safeUser);
});

router.put('/orders/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['refunded', 'cancelled', 'paid', 'created'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const db = await getDB();
  const order = (db.data.orders || []).find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  order.status = status;
  await db.write();
  res.json(order);
});

router.put('/presets/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const db = await getDB();
  const preset = db.data.presets.find(p => p.id === req.params.id);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  preset.status = status;
  await db.write();
  res.json(preset);
});

router.get('/presets', async (req, res) => {
  const db = await getDB();
  res.json(db.data.presets);
});

// Analytics
router.get('/analytics', async (req, res) => {
  const db = await getDB();
  const totalUsers = db.data.users.length;
  const totalPresets = db.data.presets.length;
  const totalDownloads = db.data.presets.reduce((sum, p) => sum + (p.downloads || 0), 0);
  const totalRevenue = (db.data.orders || [])
    .filter(o => o.status === 'paid')
    .reduce((sum, o) => sum + (o.amount || 0), 0);
  const freePresets = db.data.presets.filter(p => p.price === 0).length;
  const paidPresets = db.data.presets.filter(p => p.price > 0).length;

  const ratedPresets = db.data.presets.filter(p => p.avgRating > 0);
  const avgRating = ratedPresets.length
    ? ratedPresets.reduce((sum, p) => sum + p.avgRating, 0) / ratedPresets.length
    : 0;

  const totalSubscribed = db.data.users.filter(u => {
    const expiry = u.subscription?.expiry ? new Date(u.subscription.expiry) : null;
    return expiry && expiry > new Date();
  }).length;

  const totalReferrals = db.data.users.reduce((sum, u) => sum + (u.referral?.referralCount || 0), 0);
  const totalAdWatches = db.data.users.reduce((sum, u) => sum + (u.subscription?.adWatchCount || 0), 0);
  const totalPlatformRevenue = db.data.presets.reduce((sum, p) => sum + (p.totalRevenue || 0), 0);
  const totalAdImpressions = db.data.presets.reduce((sum, p) => sum + (p.adImpressions || 0), 0);

  const creatorEarnings = {};
  db.data.presets.forEach(p => {
    if (!creatorEarnings[p.authorId]) {
      creatorEarnings[p.authorId] = { name: p.author, revenue: 0, presets: 0 };
    }
    creatorEarnings[p.authorId].revenue += p.totalRevenue || 0;
    creatorEarnings[p.authorId].presets += 1;
  });

  const topCreators = Object.values(creatorEarnings)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  res.json({
    totalUsers,
    totalPresets,
    totalDownloads,
    totalRevenue,
    freePresets,
    paidPresets,
    avgRating: avgRating.toFixed(1),
    totalSubscribed,
    totalReferrals,
    totalAdWatches,
    totalPlatformRevenue,
    totalAdImpressions,
    topCreators
  });
});

router.get('/orders', async (req, res) => {
  const db = await getDB();
  const orders = db.data.orders || [];
  const populatedOrders = orders.map(order => {
    const user = db.data.users.find(u => u.id === order.userId);
    const preset = db.data.presets.find(p => p.id === order.presetId);
    return {
      ...order,
      user: user ? { id: user.id, name: user.name, email: user.email } : null,
      preset: preset ? { id: preset.id, name: preset.name } : null
    };
  });
  res.json(populatedOrders);
});

router.get('/stats', async (req, res) => {
  const db = await getDB();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const newUsersToday = db.data.users.filter(u => new Date(u.createdAt) >= today).length;
  const newPresetsToday = db.data.presets.filter(p => new Date(p.createdAt) >= today).length;
  const downloadsToday = (db.data.downloads || []).filter(d => new Date(d.downloadedAt) >= today).length;

  res.json({
    newUsersToday,
    newPresetsToday,
    downloadsToday,
    totalUsers: db.data.users.length,
    totalPresets: db.data.presets.length,
    totalDownloads: (db.data.downloads || []).length,
    totalOrders: db.data.orders?.length || 0
  });
});

module.exports = router;