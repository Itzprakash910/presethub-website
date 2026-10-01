const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const { optionalAuth } = require('../middleware/auth');
const { Preset, User, Download, Share, Order } = require('../models');
const { uploadFields, bulkUploadFields } = require('../middleware/upload');
const { uploadToR2, deleteFromR2, getDownloadUrl, isR2Configured } = require('../config/r2');
const { validate, presetValidation } = require('../utils/validators');
const { createNotification } = require('./users');

const router = express.Router();
const SITE_URL = (process.env.CLIENT_URL || 'https://presethub.site').replace(/\/+$/, '');

function escapeRegex(v) { return String(v || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function safeFilename(v) {
  return String(v || 'preset').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'preset';
}

function slugify(v) {
  return String(v || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset';
}

function localDownloadUrl(preset, userId) {
  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ type:'preset-download', presetId:preset._id.toString(), userId:String(userId) }, process.env.JWT_SECRET, { expiresIn:'5m' });
  const filename = encodeURIComponent(path.basename(preset.fileKey || preset.fileUrl || preset.originalName || 'preset'));
  return `${SITE_URL}/uploads/presets/${filename}?token=${encodeURIComponent(token)}`;
}


function publicAssetUrl(value) {
  const v = String(value || '').trim();
  if (!v) return `${SITE_URL}/assets/images/og-image.png`;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith('/')) return `${SITE_URL}${v}`;
  if (v.startsWith('uploads/')) return `${SITE_URL}/${v}`;
  if (v.startsWith('previews/') || v.startsWith('presets/') || v.startsWith('avatars/')) return `${SITE_URL}/uploads/${v}`;
  return `${SITE_URL}/assets/images/og-image.png`;
}

function toPublicPreset(p) {
  return {
    id: p._id.toString(),
    name: p.name,
    description: p.description || '',
    category: p.category || 'General',
    tags: Array.isArray(p.tags) ? p.tags.slice(0, 10) : [],
    price: Number(p.price || 0),
    author: p.author || 'Creator',
    authorId: p.authorId?.toString() || '',
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    downloads: Number(p.downloads || 0),
    avgRating: Number(p.avgRating || 0),
    reviews: (p.reviews || []).map(r => ({
      id: r._id.toString(), userName: r.userName, rating: r.rating,
      comment: r.comment, createdAt: r.createdAt, helpful: r.helpful || 0
    })),
    previewImage: publicAssetUrl(p.previewImage),
    views: Number(p.views || 0),
    likesCount: (p.likes || []).length,
    shares: Number(p.shares || 0),
    originalName: p.originalName || ''
  };
}

// ===== GET ALL PRESETS =====
router.get('/', async (req, res) => {
  const { category, price, rating, sort, q, page = 1, limit = 20 } = req.query;
  const filter = { status: 'approved' };

  if (q) {
    const safeQ = escapeRegex(q).slice(0, 100);
    filter.$or = [
      { name: { $regex: safeQ, $options: 'i' } },
      { author: { $regex: safeQ, $options: 'i' } },
      { tags: { $in: [new RegExp(safeQ, 'i')] } },
      { description: { $regex: safeQ, $options: 'i' } }
    ];
  }
  if (category) filter.category = category;
  if (price === 'free') filter.price = 0;
  if (price === 'paid') filter.price = { $gt: 0 };
  if (rating) filter.avgRating = { $gte: parseFloat(rating) };

  let sortObj = { createdAt: -1 };
  if (sort === 'popular') sortObj = { downloads: -1 };
  else if (sort === 'rating') sortObj = { avgRating: -1 };
  else if (sort === 'price-low') sortObj = { price: 1 };
  else if (sort === 'price-high') sortObj = { price: -1 };

  const p = Math.max(1, parseInt(page));
  const l = Math.min(50, Math.max(1, parseInt(limit)));

  const [presets, total] = await Promise.all([
    Preset.find(filter).sort(sortObj).skip((p - 1) * l).limit(l).lean(),
    Preset.countDocuments(filter)
  ]);

  res.json({
    presets: presets.map(toPublicPreset),
    total, page: p, totalPages: Math.ceil(total / l), limit: l
  });
});

// ===== SMART SEARCH =====
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const safeQ = escapeRegex(q).slice(0, 100);
  const presets = await Preset.find({
    status: 'approved',
    $or: [
      { name: { $regex: safeQ, $options: 'i' } },
      { author: { $regex: safeQ, $options: 'i' } },
      { tags: { $in: [new RegExp(safeQ, 'i')] } },
      { description: { $regex: safeQ, $options: 'i' } }
    ]
  }).limit(10).lean();
  res.json(presets.map(toPublicPreset));
});

// ===== BULK UPLOAD (BEFORE /:id) =====
router.post('/bulk', auth, bulkUploadFields, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('name').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const presetFiles = req.files?.files || [];
    const previewFiles = req.files?.previewImages || [];

    if (presetFiles.length === 0) return res.status(400).json({ error: 'No preset files uploaded' });
    if (presetFiles.length > 20) return res.status(400).json({ error: 'Max 20 presets per bulk upload' });

    const common = {
      category: (req.body.category || 'General').trim().slice(0, 50),
      price: Math.max(0, Math.min(999999.99, parseFloat(req.body.price) || 0)),
      description: (req.body.description || '').trim().slice(0, 500),
      tags: String(req.body.tags || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 10)
    };

    const previewMap = {};
    for (const p of previewFiles) {
      const base = path.basename(p.originalname, path.extname(p.originalname)).toLowerCase();
      previewMap[base] = p;
    }

    const batchId = Date.now();
    const created = [], failed = [];

    for (let i = 0; i < presetFiles.length; i++) {
      const file = presetFiles[i];
      try {
        const fileBase = path.basename(file.originalname, path.extname(file.originalname)).toLowerCase();
        const displayName = path.basename(file.originalname, path.extname(file.originalname))
          .replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Untitled Preset';

        const previewFile = previewMap[fileBase] || previewFiles[i];

        const fileKey = `presets/${uuidv4()}${path.extname(file.originalname)}`;
        const fileUrl = await uploadToR2(file.buffer, fileKey, file.mimetype);

        let previewImage = '';
        let previewKey = '';
        if (previewFile) {
          const pKey = `previews/${uuidv4()}${path.extname(previewFile.originalname)}`;
          previewKey = pKey;
          previewImage = await uploadToR2(previewFile.buffer, pKey, previewFile.mimetype);
          delete previewMap[fileBase];
        }

        const preset = await Preset.create({
          name: displayName,
          description: common.description || `Lightroom preset: ${displayName}`,
          category: common.category,
          tags: common.tags,
          price: common.price,
          author: user.name,
          authorId: user._id,
          fileUrl, fileKey, previewImage, previewKey,
          size: file.size,
          originalName: file.originalname,
          status: 'approved',
          bulkUploadBatch: batchId
        });

        created.push({ id: preset._id.toString(), name: preset.name, hasPreview: !!previewImage });
      } catch (err) {
        console.error('Bulk file failed:', file.originalname, err.message);
        failed.push({ file: file.originalname, error: err.message });
      }
    }

    res.status(201).json({
      success: true,
      created: created.length,
      failed: failed.length,
      presets: created,
      errors: failed,
      message: `${created.length} preset(s) published successfully`
    });
  } catch (err) {
    console.error('Bulk upload error:', err);
    res.status(500).json({ error: 'Bulk upload failed' });
  }
});

// ===== GET SINGLE =====
router.get('/:id', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id))
    return res.status(400).json({ error: 'Invalid ID' });
  const preset = await Preset.findOne({ _id: req.params.id, status: 'approved' }).lean();
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  res.json(toPublicPreset(preset));
});

// ===== SINGLE UPLOAD =====
router.post('/', auth, uploadFields, validate(presetValidation), async (req, res) => {
  try {
    const { name, description, category, tags, price } = req.body;
    const user = await User.findById(req.user.id).select('name').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const file = req.files?.file?.[0];
    const preview = req.files?.previewImage?.[0];
    let fileUrl = '', fileKey = '', previewImage = '', previewKey = '';

    if (file) {
      fileKey = `presets/${uuidv4()}${path.extname(file.originalname).toLowerCase()}`;
      fileUrl = await uploadToR2(file.buffer, fileKey, file.mimetype);
    }
    if (preview) {
      previewKey = `previews/${uuidv4()}${path.extname(preview.originalname).toLowerCase()}`;
      previewImage = await uploadToR2(preview.buffer, previewKey, preview.mimetype);
    }

    const preset = await Preset.create({
      name,
      description: description || '',
      category: category || 'General',
      tags: tags ? (typeof tags === 'string' ? tags.split(',').map(t => t.trim().toLowerCase()) : tags) : [],
      price: parseFloat(price) || 0,
      author: user.name,
      authorId: user._id,
      fileUrl, fileKey, previewImage, previewKey,
      status: 'approved',
      size: file ? file.size : 0,
      originalName: file ? file.originalname : ''
    });

    res.status(201).json({ ...toPublicPreset(preset.toObject()), fileUrl: preset.fileUrl, originalName: preset.originalName });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ===== DOWNLOAD =====
router.post('/:id/download', auth, async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id))
    return res.status(400).json({ error: 'Invalid ID' });
  const preset = await Preset.findOne({ _id: req.params.id, status: 'approved' });
  if (!preset) return res.status(404).json({ error: 'Preset not found' });

  if (preset.price > 0 && preset.authorId.toString() !== req.user.id) {
    const paid = await Order.findOne({ presetId: preset._id, userId: req.user.id, status: 'paid' });
    if (!paid) return res.status(403).json({ error: 'Please purchase this preset first' });
  }

  preset.downloads = (preset.downloads || 0) + 1;
  await preset.save();
  await Download.create({ userId: req.user.id, presetId: preset._id });

  await createNotification(req.user.id, 'download-complete',
    `Download completed: \"${preset.name}\"`,
    `/preset/${preset._id}/${slugify(preset.name)}/`);

  if (preset.authorId.toString() !== req.user.id) {
    const user = await User.findById(req.user.id).select('name').lean();
    await createNotification(preset.authorId, 'download',
      `${user?.name || 'Someone'} downloaded your preset "${preset.name}"`,
      `/preset/${preset._id}`);
  }

  if (preset.fileUrl && preset.fileUrl.startsWith('http')) {
    return res.json({ downloadUrl: isR2Configured() ? await getDownloadUrl(preset.fileKey || preset.fileUrl) : localDownloadUrl(preset, req.user.id), originalName: preset.originalName || `${slugify(preset.name)}.xmp` });
  }
  return res.status(404).json({ error: 'Preset file missing' });
});

// ===== BULK DOWNLOAD =====
router.post('/bulk-download', auth, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(String))].slice(0, 30) : [];
  if (!ids.length) return res.status(400).json({ error: 'Select at least one preset' });
  const validIds = ids.filter(id => mongoose.Types.ObjectId.isValid(id));
  if (!validIds.length) return res.status(400).json({ error: 'No valid preset IDs' });
  const presets = await Preset.find({ _id: { $in: validIds }, status: 'approved' }).lean();
  const paidIds = presets.filter(p => Number(p.price || 0) > 0 && p.authorId.toString() !== req.user.id).map(p => p._id);
  let paid = [];
  if (paidIds.length) paid = await Order.find({ userId: req.user.id, presetId: { $in: paidIds }, status: 'paid' }).select('presetId').lean();
  const owned = new Set(paid.map(o => o.presetId.toString()));
  const downloads = [];
  const skipped = [];
  for (const p of presets) {
    const requiresPayment = Number(p.price || 0) > 0 && p.authorId.toString() !== req.user.id;
    if (requiresPayment && !owned.has(p._id.toString())) {
      skipped.push({ id: p._id.toString(), name: p.name, reason: 'Purchase required' });
      continue;
    }
    if (!p.fileUrl) {
      skipped.push({ id: p._id.toString(), name: p.name, reason: 'File unavailable' });
      continue;
    }
    downloads.push({ id: p._id.toString(), name: p.name, url: p.fileUrl, fileKey: p.fileKey || '', filename: safeFilename(p.originalName || `${slugify(p.name)}.xmp`) });
  }
  if (!downloads.length) return res.status(403).json({ error: 'No downloadable presets in selection', skipped });
  for (const d of downloads) { const p = presets.find(x => x._id.toString() === d.id); d.url = isR2Configured() ? await getDownloadUrl(d.fileKey || d.url) : localDownloadUrl(p, req.user.id); }
  await Promise.all(downloads.map(d => Download.create({ userId: req.user.id, presetId: d.id })));
  await Preset.updateMany({ _id: { $in: downloads.map(d => d.id) } }, { $inc: { downloads: 1 } });
  res.json({ success: true, downloads, skipped, count: downloads.length });
});

// ===== DELETE =====
router.delete('/:id', auth, async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id))
    return res.status(400).json({ error: 'Invalid ID' });
  const preset = await Preset.findById(req.params.id);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  if (preset.authorId.toString() !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Unauthorized' });

  const keyFromUrl = url => url && url.includes('/') ? url.replace(`${process.env.R2_PUBLIC_URL}/`, '') : null;
  if (preset.fileUrl || preset.fileKey) await deleteFromR2(preset.fileKey || keyFromUrl(preset.fileUrl));
  if (preset.previewImage || preset.previewKey) await deleteFromR2(preset.previewKey || keyFromUrl(preset.previewImage));

  await Preset.deleteOne({ _id: preset._id });
  res.json({ success: true });
});

// ===== UPDATE =====
router.put('/:id', auth, uploadFields, async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id))
    return res.status(400).json({ error: 'Invalid ID' });
  const preset = await Preset.findById(req.params.id);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  if (preset.authorId.toString() !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Unauthorized' });

  const { name, description, category, tags, price } = req.body;
  if (name) preset.name = String(name).trim().slice(0, 100);
  if (description !== undefined) preset.description = String(description).trim().slice(0, 500);
  if (category) preset.category = String(category).trim().slice(0, 50);
  if (tags !== undefined) preset.tags = (typeof tags === 'string' ? tags.split(',') : tags).map(t => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 10);
  if (price !== undefined) {
    const nextPrice = Number.parseFloat(price);
    if (!Number.isFinite(nextPrice) || nextPrice < 0) return res.status(400).json({ error: 'Invalid price' });
    preset.price = Math.min(nextPrice, 999999.99);
  }

  const previewFile = req.files?.previewImage?.[0];
  if (previewFile) {
    const previewKey = `previews/${uuidv4()}${path.extname(previewFile.originalname).toLowerCase()}`;
    const oldPreview = preset.previewImage;
    preset.previewImage = await uploadToR2(previewFile.buffer, previewKey, previewFile.mimetype);
    preset.previewKey = previewKey;
    if (oldPreview) await deleteFromR2(oldPreview);
  }
  const replacementFile = req.files?.file?.[0];
  if (replacementFile) {
    const fileKey = `presets/${uuidv4()}${path.extname(replacementFile.originalname).toLowerCase()}`;
    const oldFile = preset.fileUrl;
    preset.fileUrl = await uploadToR2(replacementFile.buffer, fileKey, replacementFile.mimetype);
    preset.fileKey = fileKey;
    preset.originalName = replacementFile.originalname;
    preset.size = replacementFile.size;
    if (oldFile) await deleteFromR2(oldFile);
  }
  await preset.save();
  res.json({ ...toPublicPreset(preset.toObject()), fileUrl: preset.fileUrl, originalName: preset.originalName, message: 'Preset updated successfully' });
});

// ===== ENGAGEMENT =====
router.post('/:id/ad-impression', optionalAuth, async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id))
    return res.status(400).json({ error: 'Invalid ID' });
  const preset = await Preset.findById(req.params.id);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  if (req.user && preset.authorId.toString() === req.user.id)
    return res.json({ success: true, message: 'Author view not counted' });
  preset.adImpressions = (preset.adImpressions || 0) + 1;
  await preset.save();
  res.json({ success: true, impressions: preset.adImpressions });
});

router.post('/:id/view', optionalAuth, async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id))
    return res.status(400).json({ error: 'Invalid ID' });
  const preset = await Preset.findById(req.params.id);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  preset.views = (preset.views || 0) + 1;
  await preset.save();
  res.json({ views: preset.views });
});

router.post('/:id/like', auth, async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id))
    return res.status(400).json({ error: 'Invalid ID' });
  const preset = await Preset.findById(req.params.id);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });

  const idx = preset.likes.findIndex(id => id.toString() === req.user.id);
  let liked = false;

  if (idx === -1) {
    preset.likes.push(req.user.id);
    liked = true;
    if (preset.authorId.toString() !== req.user.id) {
      const user = await User.findById(req.user.id).select('name').lean();
      await createNotification(preset.authorId, 'like',
        `${user?.name || 'Someone'} liked your preset "${preset.name}"`,
        `/preset/${preset._id}`);
    }
  } else {
    preset.likes.splice(idx, 1);
  }
  await preset.save();
  res.json({ likes: preset.likes.length, liked });
});

// ===== SHARE =====
router.post('/:id/share', optionalAuth, async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id))
    return res.status(400).json({ error: 'Invalid ID' });
  const preset = await Preset.findById(req.params.id);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });

  const { platform = 'unknown' } = req.body || {};
  preset.shares = (preset.shares || 0) + 1;

  // Handle shareStats as Map or Object
  const statsObj = preset.shareStats instanceof Map ? Object.fromEntries(preset.shareStats) : (preset.shareStats || {});
  statsObj[platform] = (statsObj[platform] || 0) + 1;
  preset.shareStats = statsObj;
  preset.markModified('shareStats');
  await preset.save();

  if (req.user) {
    await Share.create({ presetId: preset._id, userId: req.user.id, platform });
    if (preset.authorId.toString() !== req.user.id) {
      const user = await User.findById(req.user.id).select('name').lean();
      await createNotification(preset.authorId, 'share',
        `${user?.name || 'Someone'} shared "${preset.name}" on ${platform}`,
        `/preset/${preset._id}`);
    }
  }

  res.json({
    success: true, shares: preset.shares, platform,
    shareUrl: `${SITE_URL}/preset/${preset._id}/${slugify(preset.name)}/`
  });
});

// ===== SHARE STATS =====
router.get('/:id/share-stats', auth, async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id))
    return res.status(400).json({ error: 'Invalid ID' });
  const preset = await Preset.findById(req.params.id).lean();
  if (!preset) return res.status(404).json({ error: 'Preset not found' });

  const platforms = preset.shareStats instanceof Map
    ? Object.fromEntries(preset.shareStats)
    : (preset.shareStats || {});

  if (preset.authorId.toString() !== req.user.id && req.user.role !== 'admin') {
    return res.json({ totalShares: preset.shares || 0, platforms });
  }

  const shares = await Share.find({ presetId: preset._id }).sort({ sharedAt: -1 }).limit(20).lean();
  const uniqueSharers = await Share.distinct('userId', { presetId: preset._id });
  const userIds = shares.map(s => s.userId).filter(Boolean);
  const users = await User.find({ _id: { $in: userIds } }).select('name username').lean();
  const map = Object.fromEntries(users.map(u => [u._id.toString(), u.name || u.username]));

  res.json({
    totalShares: preset.shares || 0,
    uniqueSharers: uniqueSharers.length,
    platforms,
    recent: shares.map(s => ({
      userName: map[s.userId?.toString()] || 'Anonymous',
      platform: s.platform,
      sharedAt: s.sharedAt
    }))
  });
});

module.exports = router;