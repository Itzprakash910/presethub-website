const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');
const uploadFields = require('../middleware/upload');
const { PRIVATE_DIR, PREVIEW_DIR } = uploadFields;
const { getDB } = require('../db/db');
const { str, removeFiles, isRealImage, publicPreset } = require('../utils/helpers');

const router = express.Router();
const CATEGORIES_MAX = 40;
const visible = p => p.status === 'approved';

// Multer wrapper so upload errors come back as clean JSON
const upload = (req, res, next) => uploadFields(req, res, err => {
  if (err) return res.status(400).json({ error: err.message });
  next();
});

// GET /presets – only approved ones are public
router.get('/', async (req, res) => {
  const db = await getDB();
  let presets = (db.data.presets || []).filter(visible);
  const q = str(String(req.query.q ?? ''), 100).toLowerCase();
  const category = str(String(req.query.category ?? ''), CATEGORIES_MAX);
  const { price, sort } = req.query;
  const rating = parseFloat(req.query.rating);

  if (q) {
    presets = presets.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.author || '').toLowerCase().includes(q) ||
      (p.tags || []).some(t => t.toLowerCase().includes(q)) ||
      (p.description || '').toLowerCase().includes(q));
  }
  if (category) presets = presets.filter(p => p.category === category);
  if (price === 'free') presets = presets.filter(p => p.price === 0);
  if (price === 'paid') presets = presets.filter(p => p.price > 0);
  if (!Number.isNaN(rating)) presets = presets.filter(p => (p.avgRating || 0) >= rating);

  switch (sort) {
    case 'popular': presets.sort((a, b) => (b.downloads || 0) - (a.downloads || 0)); break;
    case 'rating': presets.sort((a, b) => (b.avgRating || 0) - (a.avgRating || 0)); break;
    default: presets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  res.json(presets.map(publicPreset));
});

// Smart search
router.get('/search', async (req, res) => {
  const lowerQ = str(String(req.query.q ?? ''), 100).toLowerCase();
  if (lowerQ.length < 2) return res.json([]);
  const db = await getDB();
  const results = (db.data.presets || []).filter(visible)
    .map(p => {
      let score = 0;
      const name = (p.name || '').toLowerCase();
      if (name.includes(lowerQ)) score += 10;
      if (name.startsWith(lowerQ)) score += 5;
      if ((p.author || '').toLowerCase().includes(lowerQ)) score += 3;
      if ((p.tags || []).some(t => t.toLowerCase().includes(lowerQ))) score += 2;
      if ((p.description || '').toLowerCase().includes(lowerQ)) score += 1;
      return { ...publicPreset(p), score };
    })
    .filter(p => p.score > 0).sort((a, b) => b.score - a.score).slice(0, 10);
  res.json(results);
});

// Featured pack (must be BEFORE '/:id/...' routes, otherwise "featured" is treated as an id)
router.post('/featured/download', auth, (req, res) => {
  res.status(404).json({ error: 'Featured pack is not available yet' });
});

// Upload preset (+ optional preview image)
router.post('/', auth, upload, async (req, res) => {
  const name = str(req.body.name, 80);
  const description = str(req.body.description, 1000);
  const category = str(req.body.category, CATEGORIES_MAX) || 'General';
  const tags = str(req.body.tags, 200).split(',').map(t => t.trim().slice(0, 30)).filter(Boolean).slice(0, 10);
  const price = Math.round((parseFloat(req.body.price) || 0) * 100) / 100;

  const fail = (code, error) => { removeFiles(req.files); return res.status(code).json({ error }); };

  if (name.length < 3) return fail(400, 'Name must be at least 3 characters');
  if (price < 0 || price > 100000) return fail(400, 'Price must be between 0 and 100000');
  if (price > 0 && price < 1) return fail(400, 'Minimum paid price is ₹1');

  const file = req.files?.file?.[0];
  const preview = req.files?.previewImage?.[0];
  if (!file) return fail(400, 'Preset file is required');
  if (preview && !isRealImage(preview.path)) return fail(400, 'Preview is not a valid image');

  const db = await getDB();
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return fail(404, 'User not found');

  const preset = {
    id: uuidv4(), name, description, category, tags, price,
    author: user.name, authorId: user.id,
    createdAt: new Date().toISOString(),
    downloads: 0, avgRating: 0, reviews: [],
    fileUrl: file.filename,                                   // stored privately, never exposed
    previewImage: preview ? `/uploads/previews/${preview.filename}` : '',
    status: user.role === 'admin' ? 'approved' : 'pending'    // moderation required
  };
  db.data.presets.push(preset);
  await db.write();
  res.status(201).json(publicPreset(preset));
});

// Authenticated download (paid presets need a paid order)
router.post('/:id/download', auth, async (req, res) => {
  const db = await getDB();
  const preset = db.data.presets.find(p => p.id === req.params.id);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });

  const isOwner = preset.authorId === req.user.id;
  const isAdmin = req.user.role === 'admin';
  if (!visible(preset) && !isOwner && !isAdmin) return res.status(404).json({ error: 'Preset not found' });

  if (preset.price > 0 && !isOwner && !isAdmin) {
    const hasPaid = (db.data.orders || []).some(
      o => o.presetId === preset.id && o.userId === req.user.id && o.status === 'paid');
    if (!hasPaid) return res.status(403).json({ error: 'Please purchase this preset first' });
  }

  // path.basename blocks ../ traversal even if DB were tampered with
  const filePath = preset.fileUrl ? path.join(PRIVATE_DIR, path.basename(preset.fileUrl)) : null;
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'File not available' });

  db.data.downloads = db.data.downloads || [];
  const first = !db.data.downloads.some(d => d.userId === req.user.id && d.presetId === preset.id);
  if (first) preset.downloads = (preset.downloads || 0) + 1;   // one count per user
  db.data.downloads.push({ id: uuidv4(), userId: req.user.id, presetId: preset.id, downloadedAt: new Date().toISOString() });
  await db.write();

  const safeName = preset.name.replace(/[^\p{L}\p{N}\-_. ]/gu, '').trim() || 'preset';
  res.download(filePath, `${safeName}${path.extname(filePath)}`, err => {
    if (err && !res.headersSent) res.status(500).json({ error: 'Download failed' });
  });
});

// Delete (owner or admin) – also removes files from disk
router.delete('/:id', auth, async (req, res) => {
  const db = await getDB();
  const i = db.data.presets.findIndex(p => p.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Preset not found' });
  const p = db.data.presets[i];
  if (p.authorId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  if (p.fileUrl) fs.unlink(path.join(PRIVATE_DIR, path.basename(p.fileUrl)), () => {});
  if (p.previewImage) fs.unlink(path.join(PREVIEW_DIR, path.basename(p.previewImage)), () => {});
  db.data.presets.splice(i, 1);
  await db.write();
  res.json({ success: true });
});

module.exports = router;
