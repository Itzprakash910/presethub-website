const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');
const { uploadFields } = require('../middleware/upload');
const { getDB } = require('../config/db');
const { validate, presetValidation } = require('../utils/validators');
const { createNotification } = require('./users');

const router = express.Router();

// ===== GET all presets (with filters) =====
router.get('/', async (req, res) => {
  const db = await getDB();
  let presets = db.data.presets || [];
  const { category, price, rating, sort, q, page = 1, limit = 20 } = req.query;

  if (q) {
    const lowerQ = q.toLowerCase();
    presets = presets.filter(p =>
      p.name.toLowerCase().includes(lowerQ) ||
      p.author.toLowerCase().includes(lowerQ) ||
      (p.tags && p.tags.some(t => t.toLowerCase().includes(lowerQ))) ||
      p.description?.toLowerCase().includes(lowerQ)
    );
  }
  if (category) presets = presets.filter(p => p.category === category);
  if (price === 'free') presets = presets.filter(p => p.price === 0);
  if (price === 'paid') presets = presets.filter(p => p.price > 0);
  if (rating) presets = presets.filter(p => (p.avgRating || 0) >= parseFloat(rating));

  switch (sort) {
    case 'popular': presets.sort((a, b) => (b.downloads || 0) - (a.downloads || 0)); break;
    case 'rating': presets.sort((a, b) => (b.avgRating || 0) - (a.avgRating || 0)); break;
    case 'price-low': presets.sort((a, b) => a.price - b.price); break;
    case 'price-high': presets.sort((a, b) => b.price - a.price); break;
    case 'newest':
    default: presets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); break;
  }

  const start = (parseInt(page) - 1) * parseInt(limit);
  const paginated = presets.slice(start, start + parseInt(limit));
  res.json({ 
    presets: paginated, 
    total: presets.length, 
    page: parseInt(page), 
    totalPages: Math.ceil(presets.length / parseInt(limit)), 
    limit: parseInt(limit) 
  });
});

// ===== SMART SEARCH (must be before /:id) =====
router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);
  const db = await getDB();
  const presets = db.data.presets || [];
  const lowerQ = q.toLowerCase();

  const results = presets.map(p => {
    let score = 0;
    const nameLower = p.name.toLowerCase();
    const authorLower = p.author.toLowerCase();
    const tagsLower = p.tags?.map(t => t.toLowerCase()) || [];
    const descLower = p.description?.toLowerCase() || '';

    if (nameLower.includes(lowerQ)) score += 10;
    if (nameLower.startsWith(lowerQ)) score += 5;
    if (authorLower.includes(lowerQ)) score += 3;
    if (tagsLower.some(t => t.includes(lowerQ))) score += 2;
    if (descLower.includes(lowerQ)) score += 1;
    return { ...p, score };
  })
  .filter(p => p.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, 10);

  res.json(results);
});

// ===== GET single preset =====
router.get('/:id', async (req, res) => {
  const db = await getDB();
  const preset = db.data.presets.find(p => p.id === req.params.id);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  res.json(preset);
});

// ===== UPLOAD preset =====
router.post('/', auth, uploadFields, validate(presetValidation), async (req, res) => {
  try {
    const { name, description, category, tags, price } = req.body;
    const userId = req.user.id;
    const db = await getDB();
    const user = db.data.users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const file = req.files?.file?.[0];
    const preview = req.files?.previewImage?.[0];
    
    const uploadsDir = path.join(__dirname, '../../uploads');
    const previewsDir = path.join(uploadsDir, 'previews');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    if (!fs.existsSync(previewsDir)) fs.mkdirSync(previewsDir, { recursive: true });

    const newPreset = {
      id: uuidv4(),
      name,
      description: description || '',
      category: category || 'General',
      tags: tags ? (typeof tags === 'string' ? tags.split(',').map(t => t.trim()) : tags) : [],
      price: parseFloat(price) || 0,
      author: user.name,
      authorId: userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      downloads: 0,
      avgRating: 0,
      reviews: [],
      fileUrl: file ? `/uploads/${file.filename}` : '',
      previewImage: preview ? `/uploads/previews/${path.basename(preview.path)}` : '',
      status: 'pending',
      size: file ? file.size : 0,
      originalName: file ? file.originalname : '',
      views: 0,
      likes: [],
      shares: 0,
      adImpressions: 0,
      totalRevenue: 0
    };

    db.data.presets.push(newPreset);
    await db.write();
    res.status(201).json(newPreset);
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Failed to upload preset' });
  }
});

// ===== DOWNLOAD preset =====
router.post('/:id/download', auth, async (req, res) => {
  const db = await getDB();
  const preset = db.data.presets.find(p => p.id === req.params.id);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });

  // Paid preset check
  if (preset.price > 0 && preset.authorId !== req.user.id) {
    const paidOrder = (db.data.orders || []).find(
      o => o.presetId === preset.id && o.userId === req.user.id && o.status === 'paid'
    );
    if (!paidOrder) {
      return res.status(403).json({ error: 'Please purchase this preset first' });
    }
  }

  preset.downloads = (preset.downloads || 0) + 1;
  if (!db.data.downloads) db.data.downloads = [];
  db.data.downloads.push({
    id: uuidv4(),
    userId: req.user.id,
    presetId: preset.id,
    downloadedAt: new Date().toISOString()
  });
  await db.write();

  if (preset.authorId !== req.user.id) {
    await createNotification(
      preset.authorId, 
      'download', 
      `${req.user.name || 'Someone'} downloaded your preset "${preset.name}"`, 
      `/preset/${preset.id}`
    );
  }

  const projectRoot = path.join(__dirname, '../..');
  let filePath = null;

  if (preset.fileUrl) {
    const rootPath = path.join(projectRoot, preset.fileUrl);
    if (fs.existsSync(rootPath)) filePath = rootPath;
    else {
      const oldPath = path.join(__dirname, '..', preset.fileUrl);
      if (fs.existsSync(oldPath)) filePath = oldPath;
    }
  }

  if (filePath && fs.existsSync(filePath)) {
    const ext = path.extname(filePath);
    const downloadName = preset.originalName || `${preset.name}${ext}`;
    return res.download(filePath, downloadName, (err) => {
      if (err) console.error('Download error:', err);
    });
  }

  console.error(`❌ File not found for preset ${preset.id}: ${preset.fileUrl}`);
  return res.status(404).json({ error: 'Preset file missing. Contact support.' });
});

// ===== DELETE preset =====
router.delete('/:id', auth, async (req, res) => {
  const db = await getDB();
  const index = db.data.presets.findIndex(p => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Preset not found' });

  const preset = db.data.presets[index];
  if (preset.authorId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  if (preset.fileUrl) {
    const filePath = path.join(__dirname, '../..', preset.fileUrl);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  if (preset.previewImage) {
    const previewPath = path.join(__dirname, '../..', preset.previewImage);
    if (fs.existsSync(previewPath)) fs.unlinkSync(previewPath);
  }

  db.data.presets.splice(index, 1);
  await db.write();
  res.json({ success: true });
});

// ===== UPDATE preset =====
router.put('/:id', auth, async (req, res) => {
  const { name, description, category, tags, price } = req.body;
  const db = await getDB();
  const preset = db.data.presets.find(p => p.id === req.params.id);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });

  if (preset.authorId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  if (name) preset.name = name;
  if (description !== undefined) preset.description = description;
  if (category) preset.category = category;
  if (tags) {
    preset.tags = typeof tags === 'string' ? tags.split(',').map(t => t.trim()) : tags;
  }
  if (price !== undefined) preset.price = parseFloat(price);
  preset.updatedAt = new Date().toISOString();

  await db.write();
  res.json(preset);
});

// ===== FEATURED download (demo) =====
router.post('/featured/download', auth, (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="featured-pack.zip"');
  res.setHeader('Content-Type', 'application/zip');
  res.send('Demo featured pack content');
});

// ===== ENGAGEMENT =====
router.post('/:id/ad-impression', auth, async (req, res) => {
  const db = await getDB();
  const preset = db.data.presets.find(p => p.id === req.params.id);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  if (preset.authorId === req.user.id) {
    return res.json({ success: true, message: 'Author view not counted' });
  }

  preset.adImpressions = (preset.adImpressions || 0) + 1;
  preset.totalRevenue = parseFloat(((preset.totalRevenue || 0) + 0.01).toFixed(2));
  await db.write();
  res.json({ success: true, impressions: preset.adImpressions, revenue: preset.totalRevenue });
});

router.post('/:id/view', auth, async (req, res) => {
  const db = await getDB();
  const preset = db.data.presets.find(p => p.id === req.params.id);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  preset.views = (preset.views || 0) + 1;
  await db.write();
  res.json({ views: preset.views });
});

router.post('/:id/like', auth, async (req, res) => {
  const db = await getDB();
  const preset = db.data.presets.find(p => p.id === req.params.id);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });

  const userId = req.user.id;
  if (!preset.likes) preset.likes = [];
  const idx = preset.likes.indexOf(userId);
  let liked = false;

  if (idx === -1) {
    preset.likes.push(userId);
    liked = true;
    if (preset.authorId !== userId) {
      await createNotification(
        preset.authorId, 
        'like', 
        `${req.user.name || 'Someone'} liked your preset "${preset.name}"`, 
        `/preset/${preset.id}`
      );
    }
  } else {
    preset.likes.splice(idx, 1);
  }

  await db.write();
  res.json({ likes: preset.likes.length, liked });
});

router.post('/:id/share', auth, async (req, res) => {
  const db = await getDB();
  const preset = db.data.presets.find(p => p.id === req.params.id);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  preset.shares = (preset.shares || 0) + 1;
  await db.write();
  res.json({ shares: preset.shares });
});

module.exports = router;