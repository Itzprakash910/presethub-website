const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const { User, Preset, Download } = require('../models');
const { uploadAvatar, profileMediaUpload } = require('../middleware/upload');
const { uploadToR2 } = require('../config/r2');

const router = express.Router();
function cleanSocialLinks(value) {
  const out = {};
  for (const key of ['instagram','youtube','twitter','website']) {
    const v = String(value?.[key] || '').trim();
    out[key] = /^(https?:\/\/)/i.test(v) ? v.slice(0, 300) : '';
  }
  return out;
}


async function createNotification(userId, type, message, link, meta = {}) {
  if (!mongoose.Types.ObjectId.isValid(userId)) return;
  const exists = await User.findOne({
    _id: userId,
    notifications: { $elemMatch: { message, type, read: false } }
  }).lean();
  if (exists) return;
  await User.updateOne(
    { _id: userId },
    { $push: { notifications: { $each: [{ type, message, link: link || '/', read: false, createdAt: new Date(), ...meta }], $slice: -200 } } }
  );
}

router.get('/', async (req, res) => {
  const users = await User.find({}).select('name username avatar coverImage followers').lean();
  const counts = await Preset.aggregate([
    { $match: { status: 'approved' } },
    { $group: { _id: '$authorId', count: { $sum: 1 } } }
  ]);
  const map = Object.fromEntries(counts.map(c => [c._id.toString(), c.count]));
  res.json(users.map(u => ({
    id: u._id.toString(), name: u.name, username: u.username, avatar: u.avatar,
    followers: (u.followers || []).length,
    presetCount: map[u._id.toString()] || 0
  })));
});

router.get('/me', auth, async (req, res) => {
  const user = await User.findById(req.user.id).select('-password').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ ...user, id: user._id.toString() });
});

router.put('/me', auth, async (req, res) => {
  const { name, username, bio, avatar, socialLinks, email } = req.body;
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (username && username !== user.username) {
    if (await User.exists({ username: username.toLowerCase(), _id: { $ne: user._id } }))
      return res.status(409).json({ error: 'Username taken' });
    user.username = username.toLowerCase();
  }
  if (email && email !== user.email) {
    if (await User.exists({ email: email.toLowerCase(), _id: { $ne: user._id } }))
      return res.status(409).json({ error: 'Email taken' });
    user.email = email.toLowerCase();
  }
  if (name) user.name = name;
  if (bio !== undefined) user.bio = bio;
  if (avatar) user.avatar = avatar;
  if (socialLinks) user.socialLinks = { ...(user.socialLinks?.toObject?.() || {}), ...cleanSocialLinks(socialLinks) };

  await user.save();
  const safe = user.toObject();
  delete safe.password;
  safe.id = safe._id.toString();
  res.json(safe);
});

router.put('/me/avatar', auth, uploadAvatar, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const key = `avatars/${uuidv4()}${path.extname(req.file.originalname)}`;
    const url = await uploadToR2(req.file.buffer, key, req.file.mimetype);
    await User.updateOne({ _id: req.user.id }, { avatar: url });
    res.json({ avatar: url, message: 'Avatar updated' });
  } catch (e) {
    console.error('Avatar error:', e);
    res.status(500).json({ error: 'Avatar upload failed' });
  }
});


router.post('/me/profile-media', auth, profileMediaUpload, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const files = req.files || {};
    const updates = {};
    if (files.avatar?.[0]) {
      const f = files.avatar[0];
      const key = `avatars/${uuidv4()}${path.extname(f.originalname).toLowerCase()}`;
      updates.avatar = await uploadToR2(f.buffer, key, f.mimetype);
    }
    if (files.coverImage?.[0]) {
      const f = files.coverImage[0];
      const key = `covers/${uuidv4()}${path.extname(f.originalname).toLowerCase()}`;
      updates.coverImage = await uploadToR2(f.buffer, key, f.mimetype);
    }
    if (!updates.avatar && !updates.coverImage) return res.status(400).json({ error: 'Select an avatar or cover image' });
    Object.assign(user, updates);
    await user.save();
    res.json({ success: true, ...updates, message: 'Profile images updated' });
  } catch (e) {
    console.error('Profile media error:', e);
    res.status(500).json({ error: 'Profile image upload failed' });
  }
});

router.get('/top', async (req, res) => {
  const top = await User.aggregate([
    { $lookup: { from: 'presets', localField: '_id', foreignField: 'authorId', as: 'presets' } },
    { $addFields: { approved: { $filter: { input: '$presets', as: 'p', cond: { $eq: ['$$p.status', 'approved'] } } } } },
    { $project: {
      name: 1, username: 1, avatar: 1,
      presetCount: { $size: '$approved' },
      totalDownloads: { $sum: '$approved.downloads' },
      followers: { $size: { $ifNull: ['$followers', []] } }
    }},
    { $sort: { presetCount: -1, totalDownloads: -1 } },
    { $limit: 5 }
  ]);
  res.json(top.map(u => ({ ...u, id: u._id.toString() })));
});

router.get('/me/dashboard', auth, async (req, res) => {
  const [user, presets, downloads, unread] = await Promise.all([
    User.findById(req.user.id).select('name username avatar coverImage followers following subscription notifications').lean(),
    Preset.find({ authorId: req.user.id }).sort({ createdAt: -1 }).limit(12).lean(),
    Download.countDocuments({ userId: req.user.id }),
    User.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(req.user.id) } },
      { $project: { count: { $size: { $filter: { input: '$notifications', as: 'n', cond: { $eq: ['$$n.read', false] } } } } } }
    ])
  ]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const ids = presets.map(p => p._id);
  const agg = ids.length ? await Preset.aggregate([{ $match: { _id: { $in: ids } } }, { $group: { _id: null, downloads: { $sum: '$downloads' }, views: { $sum: '$views' }, likes: { $sum: { $size: '$likes' } }, shares: { $sum: '$shares' }, revenue: { $sum: '$totalRevenue' } } }]) : [];
  const a = agg[0] || { downloads: 0, views: 0, likes: 0, shares: 0, revenue: 0 };
  res.json({
    user: { id: user._id.toString(), name: user.name, username: user.username, avatar: user.avatar },
    followers: (user.followers || []).length,
    following: (user.following || []).length,
    downloads,
    unreadNotifications: unread[0]?.count || 0,
    stats: a,
    presets: presets.map(p => ({ id: p._id.toString(), name: p.name, status: p.status, price: p.price, downloads: p.downloads, views: p.views, likes: (p.likes || []).length, shares: p.shares, previewImage: p.previewImage, createdAt: p.createdAt }))
  });
});

router.get('/me/downloads', auth, async (req, res) => {
  const downloads = await Download.find({ userId: req.user.id }).select('presetId').lean();
  const ids = [...new Set(downloads.map(d => d.presetId.toString()))];
  const presets = await Preset.find({ _id: { $in: ids }, status: 'approved' }).lean();
  res.json(presets.map(p => ({ ...p, id: p._id.toString(), authorId: p.authorId.toString() })));
});

router.post('/me/wishlist/:presetId', auth, async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.presetId))
    return res.status(400).json({ error: 'Invalid ID' });
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const idx = user.wishlist.findIndex(id => id.toString() === req.params.presetId);
  if (idx === -1) user.wishlist.push(req.params.presetId);
  else user.wishlist.splice(idx, 1);
  await user.save();
  res.json({ wishlist: user.wishlist.map(id => id.toString()) });
});

router.get('/me/wishlist/presets', auth, async (req, res) => {
  const user = await User.findById(req.user.id).select('wishlist').lean();
  const presets = await Preset.find({ _id: { $in: user?.wishlist || [] }, status: 'approved' }).lean();
  res.json(presets.map(p => ({ ...p, id: p._id.toString(), authorId: p.authorId.toString() })));
});

router.get('/me/subscription', auth, async (req, res) => {
  const user = await User.findById(req.user.id).select('subscription referral').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  const sub = user.subscription || {};
  const ref = user.referral || {};
  res.json({
    isPremium: sub.expiry && new Date(sub.expiry) > new Date(),
    expiry: sub.expiry || null,
    adWatchCount: sub.adWatchCount || 0,
    adRewardDays: sub.adRewardDays || 0,
    referralCode: ref.code || null,
    referralCount: ref.referralCount || 0,
    referralRewardDays: ref.referralRewardDays || 0
  });
});

router.post('/ads/watched', auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const sub = user.subscription || {};
  if (sub.lastAdWatch && (Date.now() - new Date(sub.lastAdWatch).getTime()) < 5000) {
    return res.status(429).json({ error: 'Please wait before next ad' });
  }
  sub.adWatchCount = (sub.adWatchCount || 0) + 1;
  sub.lastAdWatch = new Date();
  if (sub.adWatchCount % 10 === 0) {
    const now = new Date();
    let expiry = sub.expiry ? new Date(sub.expiry) : now;
    if (expiry < now) expiry = now;
    expiry.setDate(expiry.getDate() + 10);
    sub.expiry = expiry;
    sub.adRewardDays = (sub.adRewardDays || 0) + 10;
  }
  user.subscription = sub;
  await user.save();
  res.json({ adWatchCount: sub.adWatchCount, expiry: sub.expiry, daysEarned: sub.adRewardDays || 0 });
});

router.post('/referrals/generate', auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.referral) user.referral = {};
  if (!user.referral.code) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    user.referral.code = code;
  }
  await user.save();
  res.json({ referralCode: user.referral.code });
});

router.get('/me/notifications', auth, async (req, res) => {
  const user = await User.findById(req.user.id).select('notifications').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json((user.notifications || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

router.post('/notifications/read/:id', auth, async (req, res) => {
  await User.updateOne(
    { _id: req.user.id, 'notifications._id': req.params.id },
    { $set: { 'notifications.$.read': true } }
  );
  res.json({ success: true });
});

router.post('/notifications/read-all', auth, async (req, res) => {
  await User.updateOne({ _id: req.user.id }, { $set: { 'notifications.$[].read': true } });
  res.json({ success: true });
});

router.get('/:id/follow-status', auth, async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id))
    return res.status(400).json({ error: 'Invalid ID' });
  const target = await User.findById(req.params.id).select('followers').lean();
  if (!target) return res.status(404).json({ error: 'User not found' });
  res.json({ following: (target.followers || []).some(id => id.toString() === req.user.id) });
});

router.get('/:id', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id))
    return res.status(400).json({ error: 'Invalid ID' });
  const user = await User.findById(req.params.id).select('name username avatar coverImage bio socialLinks verified followers following').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  const stats = await Preset.aggregate([
    { $match: { authorId: user._id, status: 'approved' } },
    { $group: { _id: null, count: { $sum: 1 }, downloads: { $sum: '$downloads' } } }
  ]);
  const s = stats[0] || { count: 0, downloads: 0 };
  res.json({
    id: user._id.toString(), name: user.name, username: user.username,
    avatar: user.avatar, coverImage: user.coverImage, bio: user.bio, socialLinks: user.socialLinks || {},
    verified: !!user.verified, totalPresets: s.count, totalDownloads: s.downloads,
    followers: (user.followers || []).length, following: (user.following || []).length
  });
});

router.get('/:id/presets', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id))
    return res.status(400).json({ error: 'Invalid ID' });
  const presets = await Preset.find({ authorId: req.params.id, status: 'approved' }).lean();
  res.json(presets.map(p => ({
    id: p._id.toString(), name: p.name, description: p.description,
    category: p.category, tags: p.tags || [], price: p.price,
    author: p.author, authorId: p.authorId.toString(),
    createdAt: p.createdAt, updatedAt: p.updatedAt,
    downloads: p.downloads, avgRating: p.avgRating,
    previewImage: p.previewImage, views: p.views,
    likesCount: (p.likes || []).length, shares: p.shares,
    reviews: (p.reviews || []).map(r => ({ ...r, id: r._id.toString() }))
  })));
});

router.post('/:id/follow', auth, async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id))
    return res.status(400).json({ error: 'Invalid ID' });
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot follow self' });

  const [target, current] = await Promise.all([
    User.findById(req.params.id),
    User.findById(req.user.id)
  ]);
  if (!target || !current) return res.status(404).json({ error: 'User not found' });

  const following = target.followers.some(id => id.toString() === current._id.toString());

  if (following) {
    target.followers = target.followers.filter(id => id.toString() !== current._id.toString());
    current.following = current.following.filter(id => id.toString() !== target._id.toString());
    await Promise.all([target.save(), current.save()]);
    return res.json({ following: false, followersCount: target.followers.length });
  }

  target.followers.push(current._id);
  current.following.push(target._id);
  await Promise.all([target.save(), current.save()]);
  await createNotification(target._id, 'follow', `${current.name} started following you!`, `/profile/${current._id}`);
  res.json({ following: true, followersCount: target.followers.length });
});

router.get('/:id/earnings', auth, async (req, res) => {
  if (req.user.id !== req.params.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Unauthorized' });
  if (!mongoose.Types.ObjectId.isValid(req.params.id))
    return res.status(400).json({ error: 'Invalid ID' });

  const user = await User.findById(req.params.id).select('name email').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const presets = await Preset.find({ authorId: req.params.id }).select('name category downloads adImpressions totalRevenue').lean();
  const stats = presets.map(p => ({
    id: p._id.toString(), name: p.name, category: p.category,
    downloads: p.downloads || 0, impressions: p.adImpressions || 0, revenue: p.totalRevenue || 0
  }));
  const total = stats.reduce((s, p) => s + p.revenue, 0);
  res.json({
    user: { id: user._id.toString(), name: user.name, email: user.email },
    totalImpressions: stats.reduce((s, p) => s + p.impressions, 0),
    totalRevenue: total,
    totalDownloads: stats.reduce((s, p) => s + p.downloads, 0),
    presets: stats,
    canWithdraw: total >= 100
  });
});

module.exports = router;
module.exports.createNotification = createNotification;