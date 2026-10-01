const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const { User, Preset, Order, Download } = require('../models');

const router = express.Router();
const isAdmin = (req, res, next) => req.user.role === 'admin'
  ? next()
  : res.status(403).json({ error: 'Admin access required' });
router.use(auth, isAdmin);

function paginate(page, limit) {
  const p = Math.max(1, parseInt(page) || 1);
  const l = Math.min(500, Math.max(1, parseInt(limit) || 50));
  return { skip: (p - 1) * l, limit: l, page: p };
}

router.get('/users', async (req, res) => {
  const { skip, limit, page } = paginate(req.query.page, req.query.limit);
  const [users, total] = await Promise.all([
    User.find({}).select('-password').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments()
  ]);
  res.json({
    items: users.map(u => ({ ...u, id: u._id.toString() })),
    total, page, totalPages: Math.ceil(total / limit), limit
  });
});

router.get('/users/:id', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id))
    return res.status(400).json({ error: 'Invalid ID' });
  const user = await User.findById(req.params.id).select('-password').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ ...user, id: user._id.toString() });
});

router.put('/users/:id/role', async (req, res) => {
  const { role } = req.body;
  if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true }).select('-password').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ ...user, id: user._id.toString() });
});

router.delete('/users/:id', async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'admin') return res.status(400).json({ error: 'Cannot delete admin' });
  await User.deleteOne({ _id: user._id });
  res.json({ success: true });
});

router.put('/users/:id/verify', async (req, res) => {
  await User.updateOne({ _id: req.params.id }, { verified: !!req.body.verified });
  res.json({ success: true });
});

router.put('/users/:id', async (req, res) => {
  const { name, username, email, bio, role, verified } = req.body;
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (username && username !== user.username) {
    if (await User.exists({ username: username.toLowerCase(), _id: { $ne: user._id } }))
      return res.status(409).json({ error: 'Username taken' });
  }
  if (email && email !== user.email) {
    if (await User.exists({ email: email.toLowerCase(), _id: { $ne: user._id } }))
      return res.status(409).json({ error: 'Email taken' });
  }

  if (name) user.name = name;
  if (username) user.username = username.toLowerCase();
  if (email) user.email = email.toLowerCase();
  if (bio !== undefined) user.bio = bio;
  if (role) user.role = role;
  if (verified !== undefined) user.verified = verified;
  await user.save();

  const safe = user.toObject();
  delete safe.password;
  safe.id = safe._id.toString();
  res.json(safe);
});

router.put('/presets/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['approved', 'rejected', 'pending'].includes(status))
    return res.status(400).json({ error: 'Invalid status' });
  const preset = await Preset.findByIdAndUpdate(req.params.id, { status }, { new: true }).lean();
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  res.json({ ...preset, id: preset._id.toString() });
});

router.post('/presets/bulk-status', async (req, res) => {
  const { ids, status } = req.body;
  if (!Array.isArray(ids) || !['approved', 'rejected', 'pending'].includes(status))
    return res.status(400).json({ error: 'Invalid input' });
  const result = await Preset.updateMany({ _id: { $in: ids } }, { status });
  res.json({ success: true, modified: result.modifiedCount });
});

router.get('/presets', async (req, res) => {
  const { skip, limit, page } = paginate(req.query.page, req.query.limit);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const [presets, total] = await Promise.all([
    Preset.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Preset.countDocuments(filter)
  ]);
  res.json({
    items: presets.map(p => ({ ...p, id: p._id.toString(), authorId: p.authorId.toString() })),
    total, page, totalPages: Math.ceil(total / limit), limit
  });
});

router.get('/analytics', async (req, res) => {
  const [totalUsers, totalPresets, totalDownloads, totalOrders, revenueAgg, freePresets, paidPresets, ratingAgg] = await Promise.all([
    User.countDocuments(),
    Preset.countDocuments(),
    Download.countDocuments(),
    Order.countDocuments(),
    Order.aggregate([{ $match: { status: 'paid' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Preset.countDocuments({ price: 0 }),
    Preset.countDocuments({ price: { $gt: 0 } }),
    Preset.aggregate([
      { $match: { avgRating: { $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: '$avgRating' } } }
    ])
  ]);

  const topCreators = await Preset.aggregate([
    { $match: { status: 'approved' } },
    { $group: { _id: '$authorId', name: { $first: '$author' }, revenue: { $sum: '$totalRevenue' }, presets: { $sum: 1 } } },
    { $sort: { revenue: -1 } }, { $limit: 5 }
  ]);

  res.json({
    totalUsers, totalPresets, totalDownloads, totalOrders,
    totalRevenue: revenueAgg[0]?.total || 0,
    freePresets, paidPresets,
    avgRating: (ratingAgg[0]?.avg || 0).toFixed(1),
    topCreators: topCreators.map(c => ({ id: c._id.toString(), name: c.name, revenue: c.revenue, presets: c.presets }))
  });
});

router.get('/orders', async (req, res) => {
  const { skip, limit, page } = paginate(req.query.page, req.query.limit);
  const [orders, total] = await Promise.all([
    Order.find({}).populate('userId', 'name email').populate('presetId', 'name')
      .sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Order.countDocuments()
  ]);
  res.json({
    items: orders.map(o => ({
      id: o._id.toString(), amount: o.amount, status: o.status, createdAt: o.createdAt,
      user: o.userId ? { id: o.userId._id?.toString(), name: o.userId.name, email: o.userId.email } : null,
      preset: o.presetId ? { id: o.presetId._id?.toString(), name: o.presetId.name } : null
    })),
    total, page, totalPages: Math.ceil(total / limit), limit
  });
});

router.put('/orders/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['refunded', 'cancelled', 'paid', 'created'].includes(status))
    return res.status(400).json({ error: 'Invalid status' });
  const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true }).lean();
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ ...order, id: order._id.toString() });
});

router.get('/stats', async (req, res) => {
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const [newUsersToday, newPresetsToday, downloadsToday, totalUsers, totalPresets, totalDownloads, totalOrders] = await Promise.all([
    User.countDocuments({ createdAt: { $gte: startOfDay } }),
    Preset.countDocuments({ createdAt: { $gte: startOfDay } }),
    Download.countDocuments({ downloadedAt: { $gte: startOfDay } }),
    User.countDocuments(),
    Preset.countDocuments(),
    Download.countDocuments(),
    Order.countDocuments()
  ]);
  res.json({ newUsersToday, newPresetsToday, downloadsToday, totalUsers, totalPresets, totalDownloads, totalOrders });
});

module.exports = router;