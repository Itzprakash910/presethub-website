const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const { optionalAuth } = require('../middleware/auth');
const { Preset, User, Download, Share, Order } = require('../models');
const { uploadFields, bulkUploadFields } = require('../middleware/upload');
const { uploadToR2, deleteFromR2, getStoredFileStream } = require('../config/r2');
const jwt = require('jsonwebtoken');
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


function publicAssetUrl(value) {
  const v = String(value || '').trim();
  if (!v) return `${SITE_URL}/assets/images/og-image.png`;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith('/')) return `${SITE_URL}${v}`;
  if (v.startsWith('uploads/')) return `${SITE_URL}/${v}`;
  if (v.startsWith('/media/')) return `${SITE_URL}${v}`;
  if (v.startsWith('media/')) return `${SITE_URL}/${v}`;
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
    commentsCount: Number(p.commentsCount || 0),
    featuredScore: Number(p.featuredScore || 0)
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
        if (previewFile) {
          const pKey = `previews/${uuidv4()}${path.extname(previewFile.originalname)}`;
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
          fileUrl, previewImage,
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

// ===== FEATURED / TRENDING =====
router.get('/featured', async (req, res) => {
  try {
    const limit = Math.min(24, Math.max(1, parseInt(req.query.limit) || 8));
    const rows = await Preset.aggregate([
      { $match: { status: 'approved' } },
      { $lookup: { from: 'comments', localField: '_id', foreignField: 'presetId', as: 'commentDocs' } },
      { $addFields: {
        commentsCount: { $size: '$commentDocs' },
        likesCount: { $size: { $ifNull: ['$likes', []] } },
        featuredScore: { $add: [
          { $multiply: [{ $ifNull: ['$avgRating', 0] }, 20] },
          { $multiply: [{ $ln: { $add: [{ $ifNull: ['$views', 0] }, 1] } }, 4] },
          { $multiply: [{ $ln: { $add: [{ $size: { $ifNull: ['$likes', []] } }, 1] } }, 8] },
          { $multiply: [{ $ln: { $add: [{ $ifNull: ['$shares', 0] }, 1] } }, 6] },
          { $multiply: [{ $ln: { $add: [{ $size: '$commentDocs' }, 1] } }, 5] },
          { $multiply: [{ $ln: { $add: [{ $ifNull: ['$downloads', 0] }, 1] } }, 2] }
        ] }
      } },
      { $sort: { featuredScore: -1, updatedAt: -1 } },
      { $limit: limit },
      { $project: { commentDocs: 0 } }
    ]);
    res.json(rows.map(toPublicPreset));
  } catch (err) {
    console.error('Featured presets error:', err);
    res.status(500).json({ error: 'Could not load featured presets' });
  }
});

// ===== GLOBAL SEARCH =====
router.get('/global-search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ presets: [], users: [], categories: [], tags: [] });
    const safeQ = escapeRegex(q).slice(0, 80);
    const rx = new RegExp(safeQ, 'i');
    const [presets, users, categoryDocs, tagDocs] = await Promise.all([
      Preset.find({ status: 'approved', $or: [
        { name: rx }, { author: rx }, { description: rx }, { category: rx }, { tags: { $in: [rx] } }
      ] }).sort({ downloads: -1, updatedAt: -1 }).limit(12).lean(),
      User.find({ $or: [{ name: rx }, { username: rx }] }).select('name username avatar followers').limit(8).lean(),
      Preset.aggregate([{ $match: { status: 'approved', category: rx } }, { $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 8 }]),
      Preset.aggregate([{ $match: { status: 'approved', tags: { $elemMatch: { $regex: safeQ, $options: 'i' } } } }, { $unwind: '$tags' }, { $match: { tags: { $regex: safeQ, $options: 'i' } } }, { $group: { _id: '$tags', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 12 }])
    ]);
    res.json({
      presets: presets.map(toPublicPreset),
      users: users.map(u => ({ id: u._id.toString(), name: u.name, username: u.username, avatar: u.avatar, followers: (u.followers || []).length })),
      categories: categoryDocs.map(x => ({ name: x._id, count: x.count })),
      tags: tagDocs.map(x => ({ name: x._id, count: x.count }))
    });
  } catch (err) {
    console.error('Global search error:', err);
    res.status(500).json({ error: 'Search failed' });
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
    const uploadId = String(req.body.uploadId || '').trim().slice(0, 100);
    if (uploadId) {
      const existing = await Preset.findOne({ uploadId }).lean();
      if (existing) return res.status(200).json({ ...toPublicPreset(existing), fileUrl: existing.fileUrl, originalName: existing.originalName, resumed: true });
    }
    const user = await User.findById(req.user.id).select('name').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const file = req.files?.file?.[0];
    const preview = req.files?.previewImage?.[0];
    let fileUrl = '', previewImage = '', fileStorageKey = '', previewStorageKey = '';

    if (file) {
      fileStorageKey = `presets/${uuidv4()}${path.extname(file.originalname).toLowerCase()}`;
      fileUrl = await uploadToR2(file.buffer, fileStorageKey, file.mimetype);
    }
    if (preview) {
      previewStorageKey = `previews/${uuidv4()}${path.extname(preview.originalname).toLowerCase()}`;
      previewImage = await uploadToR2(preview.buffer, previewStorageKey, preview.mimetype);
    }

    const preset = await Preset.create({
      name,
      description: description || '',
      category: category || 'General',
      tags: tags ? (typeof tags === 'string' ? tags.split(',').map(t => t.trim().toLowerCase()) : tags) : [],
      price: parseFloat(price) || 0,
      author: user.name,
      authorId: user._id,
      fileUrl, fileStorageKey, previewImage, previewStorageKey,
      status: process.env.AUTO_APPROVE_UPLOADS === 'true' ? 'approved' : 'pending',
      size: file ? file.size : 0,
      originalName: file ? file.originalname : '',
      uploadId: uploadId || undefined
    });

    res.status(201).json({ ...toPublicPreset(preset.toObject()), fileUrl: preset.fileUrl, originalName: preset.originalName });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ===== SECURE DOWNLOAD =====
// The API never returns the storage URL. It issues a short-lived signed ticket,
// then streams the file after re-checking ownership/purchase permissions.
router.post('/:id/download', optionalAuth, async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  const preset = await Preset.findOne({ _id: req.params.id, status: 'approved' });
  if (!preset) return res.status(404).json({ error: 'Preset not found' });

  if (preset.price > 0) {
    if (!req.user) return res.status(401).json({ error: 'Please log in to purchase or download paid presets' });
    if (preset.authorId.toString() !== req.user.id) {
      const paid = await Order.findOne({ presetId: preset._id, userId: req.user.id, status: 'paid' });
      if (!paid) return res.status(403).json({ error: 'Please purchase this preset first' });
    }
  }

  if (!preset.fileUrl) return res.status(404).json({ error: 'Preset file missing' });

  preset.downloads = (preset.downloads || 0) + 1;
  await preset.save();
  if (req.user) {
    await Download.create({ userId: req.user.id, presetId: preset._id });
    if (preset.authorId.toString() !== req.user.id) {
      const user = await User.findById(req.user.id).select('name').lean();
      await createNotification(preset.authorId, 'download', `${user?.name || 'Someone'} downloaded your preset "${preset.name}"`, `/preset/${preset._id}`);
    }
  }

  const token = jwt.sign(
    { purpose: 'preset-download', presetId: preset._id.toString(), userId: req.user?.id || null },
    process.env.JWT_SECRET,
    { expiresIn: '2m' }
  );
  res.json({
    downloadUrl: `${SITE_URL}/api/presets/${preset._id}/file?token=${encodeURIComponent(token)}`,
    originalName: safeFilename(preset.originalName || `${slugify(preset.name)}.xmp`)
  });
});

router.get('/:id/file', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).end();
    const payload = jwt.verify(String(req.query.token || ''), process.env.JWT_SECRET);
    if (payload.purpose !== 'preset-download' || payload.presetId !== req.params.id) return res.status(403).end();

    const preset = await Preset.findOne({ _id: req.params.id, status: 'approved' }).lean();
    if (!preset || !preset.fileUrl) return res.status(404).end();

    if (Number(preset.price || 0) > 0) {
      if (!payload.userId) return res.status(401).end();
      if (String(preset.authorId) !== String(payload.userId)) {
        const paid = await Order.exists({ presetId: preset._id, userId: payload.userId, status: 'paid' });
        if (!paid) return res.status(403).end();
      }
    }

    const stored = await getStoredFileStream(preset.fileUrl, preset.fileStorageKey, safeFilename(preset.originalName || `${slugify(preset.name)}.xmp`));
    res.setHeader('Content-Type', stored.contentType || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(stored.filename)}"`);
    if (stored.length) res.setHeader('Content-Length', String(stored.length));
    stored.stream.on('error', next).pipe(res);
  } catch (err) {
    if (err?.name === 'TokenExpiredError' || err?.name === 'JsonWebTokenError') return res.status(403).end();
    next(err);
  }
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
    const token = jwt.sign(
      { purpose: 'preset-download', presetId: p._id.toString(), userId: req.user.id },
      process.env.JWT_SECRET, { expiresIn: '2m' }
    );
    downloads.push({ id: p._id.toString(), name: p.name, url: `${SITE_URL}/api/presets/${p._id}/file?token=${encodeURIComponent(token)}`, filename: safeFilename(p.originalName || `${slugify(p.name)}.xmp`) });
  }
  if (!downloads.length) return res.status(403).json({ error: 'No downloadable presets in selection', skipped });
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

  const keyFromUrl = url => {
    if (!url) return null;
    const r2 = String(process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
    if (r2 && String(url).startsWith(r2 + '/')) return String(url).slice(r2.length + 1);
    const marker = '/uploads/';
    const idx = String(url).indexOf(marker);
    return idx >= 0 ? String(url).slice(idx + marker.length) : null;
  };
  if (preset.fileUrl) await deleteFromR2(keyFromUrl(preset.fileUrl));
  if (preset.previewImage) await deleteFromR2(keyFromUrl(preset.previewImage));

  await Preset.deleteOne({ _id: preset._id });
  res.json({ success: true });
});

// ===== UPDATE =====
router.put('/:id', auth, uploadFields, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
    const preset = await Preset.findById(req.params.id);
    if (!preset) return res.status(404).json({ error: 'Preset not found' });
    if (preset.authorId.toString() !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });

    const { name, description, category, tags, price } = req.body;
    if (name !== undefined) preset.name = String(name).trim().slice(0, 100);
    if (description !== undefined) preset.description = String(description).trim().slice(0, 500);
    if (category !== undefined) preset.category = String(category).trim().slice(0, 50) || 'General';
    if (tags !== undefined) preset.tags = (typeof tags === 'string' ? tags.split(',') : tags).map(t => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 10);
    if (price !== undefined && price !== '') preset.price = Math.max(0, Math.min(999999.99, parseFloat(price) || 0));

    const file = req.files?.file?.[0];
    const preview = req.files?.previewImage?.[0];
    if (file) {
      const key = `presets/${uuidv4()}${path.extname(file.originalname).toLowerCase()}`;
      preset.fileStorageKey = key;
      preset.fileUrl = await uploadToR2(file.buffer, key, file.mimetype);
      preset.size = file.size;
      preset.originalName = file.originalname;
    }
    if (preview) {
      const key = `previews/${uuidv4()}${path.extname(preview.originalname).toLowerCase()}`;
      preset.previewStorageKey = key;
      preset.previewImage = await uploadToR2(preview.buffer, key, preview.mimetype);
    }
    await preset.save();
    res.json({ ...toPublicPreset(preset.toObject()), fileUrl: preset.fileUrl, originalName: preset.originalName });
  } catch (err) {
    console.error('Preset update error:', err);
    res.status(500).json({ error: 'Preset update failed' });
  }
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
  const milestones = [50,100,150,200,250,500,1000,2000,5000,10000];
  if (milestones.includes(preset.views) && preset.authorId) {
    await createNotification(preset.authorId, 'views-milestone', `🎉 Your preset "${preset.name}" reached ${preset.views} views!`, `/preset/${preset._id}/${slugify(preset.name)}/`);
  }
  res.json({ views: preset.views, milestone: milestones.includes(preset.views) ? preset.views : null });
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