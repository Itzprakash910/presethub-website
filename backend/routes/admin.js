const express = require('express');
const auth = require('../middleware/auth');
const { getDB } = require('../db/db');
const { publicPreset } = require('../utils/helpers');

const router = express.Router();
const isAdmin = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only' });

router.use(auth, isAdmin);

router.get('/users', async (req, res) => {
  const db = await getDB();
  res.json(db.data.users.map(({ password, ...u }) => u));
});

// All presets incl. pending / rejected (the public list only shows approved)
router.get('/presets', async (req, res) => {
  const db = await getDB();
  res.json(db.data.presets.map(publicPreset));
});

router.put('/presets/:id/status', async (req, res) => {
  const { status } = req.body || {};
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'Status must be approved, rejected or pending' });
  }
  const db = await getDB();
  const preset = db.data.presets.find(p => p.id === req.params.id);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  preset.status = status;
  await db.write();
  res.json(publicPreset(preset));
});

router.get('/analytics', async (req, res) => {
  const { users, presets, orders = [] } = (await getDB()).data;
  res.json({
    totalUsers: users.length,
    totalPresets: presets.length,
    pendingPresets: presets.filter(p => p.status === 'pending').length,
    totalDownloads: presets.reduce((s, p) => s + (p.downloads || 0), 0),
    totalRevenue: orders.filter(o => o.status === 'paid').reduce((s, o) => s + (o.amount || 0), 0)  // only PAID orders
  });
});

module.exports = router;
