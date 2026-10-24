/**
 * Text Prompts / Shayari: users post shayari, true lines, sad lines, captions, AI prompts…
 * Features: list/search/filter, create/edit/delete, like, copy counter, share counter, comments, viral alerts.
 */
const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const { optionalAuth } = auth;
const { TextPost, User, Comment, TEXT_CATEGORIES } = require('../models');
const { createNotification } = require('../utils/notifications');
const { tickForFollowers } = require('../utils/tick');
const { isProUser } = require('../utils/plans');
const { checkTextViral } = require('../utils/viral');
const { textPostLimiter } = require('../utils/security');

const router = express.Router();
const isId = v => mongoose.Types.ObjectId.isValid(v);
const LANGS = ['hindi', 'hinglish', 'english', 'urdu', 'other'];

// ASCII-only slugs keep URLs short and stable; Hindi-only titles fall back to "<category>-shayari".
function slugify(v, category = 'other') {
  const s = String(v || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-$/, '');
  return s.length >= 3 ? s : `${category}-shayari`;
}
function cleanTags(t) {
  const arr = Array.isArray(t) ? t : String(t || '').split(/[,#\n]/);
  return [...new Set(arr.map(x => String(x).toLowerCase().trim().replace(/[^\p{L}\p{N}_ -]/gu, '').slice(0, 30)).filter(Boolean))].slice(0, 10);
}
function cleanText(v) {
  return String(v || '').replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\n{4,}/g, '\n\n\n').trim();
}

async function authorMap(items) {
  const ids = [...new Set(items.map(i => String(i.authorId)))];
  const users = await User.find({ _id: { $in: ids } }).select('name username avatar followers subscription').lean();
  return new Map(users.map(u => [String(u._id), u]));
}

function serialize(t, authors, viewerId) {
  const a = authors?.get(String(t.authorId));
  return {
    id: String(t._id), title: t.title || '', text: t.text, category: t.category, language: t.language, tags: t.tags || [],
    slug: t.slug || slugify(t.title || t.text, t.category), author: t.author, authorId: String(t.authorId),
    authorUsername: a?.username || '', authorAvatar: a?.avatar || '',
    authorTick: tickForFollowers(a?.followers?.length), authorPro: isProUser(a),
    likes: (t.likes || []).length, liked: viewerId ? (t.likes || []).some(id => String(id) === String(viewerId)) : false,
    views: t.views || 0, copies: t.copies || 0, shares: t.shares || 0, comments: t.commentsCount || 0,
    createdAt: t.createdAt
  };
}

router.get('/categories', async (req, res) => {
  const rows = await TextPost.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: '$category', count: { $sum: 1 } } }]);
  const counts = Object.fromEntries(rows.map(r => [r._id, r.count]));
  res.json(TEXT_CATEGORIES.map(c => ({ key: c, count: counts[c] || 0 })));
});

router.get('/', optionalAuth, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(30, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const filter = { status: 'approved' };
  if (TEXT_CATEGORIES.includes(String(req.query.category))) filter.category = String(req.query.category);
  if (LANGS.includes(String(req.query.language))) filter.language = String(req.query.language);
  if (isId(req.query.author)) filter.authorId = req.query.author;
  const q = String(req.query.q || '').trim().slice(0, 80);
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ title: rx }, { text: rx }, { tags: rx }, { author: rx }];
  }
  const sort = req.query.sort === 'popular' ? { copies: -1, shares: -1, views: -1, _id: -1 } : { createdAt: -1, _id: -1 };
  const [items, total] = await Promise.all([
    TextPost.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    TextPost.countDocuments(filter)
  ]);
  const authors = await authorMap(items);
  res.json({ items: items.map(i => serialize(i, authors, req.user?.id)), page, pages: Math.max(1, Math.ceil(total / limit)), total });
});

router.get('/:id', optionalAuth, async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  const t = await TextPost.findOne({ _id: req.params.id, status: 'approved' }).lean();
  if (!t) return res.status(404).json({ error: 'Post not found' });
  const authors = await authorMap([t]);
  res.json(serialize(t, authors, req.user?.id));
});

router.post('/', auth, textPostLimiter, async (req, res) => {
  const text = cleanText(req.body?.text);
  if (text.length < 5 || text.length > 2000) return res.status(400).json({ error: 'Text must be 5 to 2000 characters.' });
  const title = String(req.body?.title || '').trim().slice(0, 120);
  const category = TEXT_CATEGORIES.includes(String(req.body?.category)) ? String(req.body.category) : 'other';
  const language = LANGS.includes(String(req.body?.language)) ? String(req.body.language) : 'hindi';
  const user = await User.findById(req.user.id).select('name username followers status').lean();
  if (!user || user.status !== 'active') return res.status(403).json({ error: 'Account cannot post.' });

  // Anti-spam: identical text by same user, and max 20 posts per hour.
  if (await TextPost.exists({ authorId: user._id, text })) return res.status(409).json({ error: 'You already posted this text.' });
  const recent = await TextPost.countDocuments({ authorId: user._id, createdAt: { $gte: new Date(Date.now() - 3600 * 1000) } });
  if (recent >= 20) return res.status(429).json({ error: 'Posting limit reached. Please try again in an hour.' });

  const post = await TextPost.create({
    title, text, category, language, tags: cleanTags(req.body?.tags), slug: slugify(title || text.split('\n')[0], category),
    author: user.name || user.username || 'User', authorId: user._id
  });

  // Tell followers (with the creator's follower tick) — capped to keep the request fast.
  const tick = tickForFollowers(user.followers?.length);
  const followers = (user.followers || []).slice(0, 500);
  for (const fid of followers) {
    createNotification(fid, 'new-text', `✍️ ${user.name || user.username} posted a new ${category.replace('-', ' ')} text: “${(title || text).replace(/\s+/g, ' ').slice(0, 60)}”`, `/shayari/${post._id}/`, 'New post', { tick }).catch(() => {});
  }
  const authors = await authorMap([post]);
  res.status(201).json(serialize(post.toObject(), authors, req.user.id));
});

router.put('/:id', auth, async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  const post = await TextPost.findById(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (String(post.authorId) !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  if (req.body.text !== undefined) {
    const text = cleanText(req.body.text);
    if (text.length < 5 || text.length > 2000) return res.status(400).json({ error: 'Text must be 5 to 2000 characters.' });
    post.text = text;
  }
  if (req.body.title !== undefined) post.title = String(req.body.title).trim().slice(0, 120);
  if (TEXT_CATEGORIES.includes(String(req.body.category))) post.category = String(req.body.category);
  if (LANGS.includes(String(req.body.language))) post.language = String(req.body.language);
  if (req.body.tags !== undefined) post.tags = cleanTags(req.body.tags);
  post.slug = slugify(post.title || post.text.split('\n')[0], post.category);
  await post.save();
  const authors = await authorMap([post]);
  res.json(serialize(post.toObject(), authors, req.user.id));
});

router.delete('/:id', auth, async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  const post = await TextPost.findById(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (String(post.authorId) !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  await Promise.all([post.deleteOne(), Comment.deleteMany({ textId: post._id })]);
  res.json({ success: true });
});

// ----- engagement -----
router.post('/:id/view', async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  const t = await TextPost.findOneAndUpdate({ _id: req.params.id, status: 'approved' }, { $inc: { views: 1 } }, { new: true, projection: { views: 1 } }).lean();
  if (!t) return res.status(404).json({ error: 'Post not found' });
  checkTextViral(t._id);
  res.json({ views: t.views });
});

router.post('/:id/like', auth, async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  const t = await TextPost.findOne({ _id: req.params.id, status: 'approved' }).select('likes authorId title text').lean();
  if (!t) return res.status(404).json({ error: 'Post not found' });
  const uid = new mongoose.Types.ObjectId(req.user.id);
  const liked = (t.likes || []).some(id => String(id) === req.user.id);
  await TextPost.updateOne({ _id: t._id }, liked ? { $pull: { likes: uid } } : { $addToSet: { likes: uid } });
  const fresh = await TextPost.findById(t._id).select('likes').lean();
  if (!liked && String(t.authorId) !== req.user.id) {
    const u = await User.findById(req.user.id).select('name username').lean();
    createNotification(t.authorId, 'like', `❤️ ${u?.name || u?.username || 'Someone'} liked your text “${(t.title || t.text).slice(0, 40)}”.`, `/shayari/${t._id}/`, 'New like').catch(() => {});
  }
  checkTextViral(t._id);
  res.json({ liked: !liked, likes: fresh?.likes?.length || 0 });
});

// Called when the user taps the Copy button.
router.post('/:id/copy', async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  const t = await TextPost.findOneAndUpdate({ _id: req.params.id, status: 'approved' }, { $inc: { copies: 1 } }, { new: true, projection: { copies: 1 } }).lean();
  if (!t) return res.status(404).json({ error: 'Post not found' });
  checkTextViral(t._id);
  res.json({ copies: t.copies });
});

router.post('/:id/share', optionalAuth, async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  const platform = String(req.body?.platform || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'unknown';
  const t = await TextPost.findOneAndUpdate({ _id: req.params.id, status: 'approved' }, { $inc: { shares: 1, [`shareStats.${platform}`]: 1 } }, { new: true, projection: { shares: 1, authorId: 1, title: 1, text: 1 } }).lean();
  if (!t) return res.status(404).json({ error: 'Post not found' });
  if (req.user && String(t.authorId) !== req.user.id) {
    const u = await User.findById(req.user.id).select('name username').lean();
    createNotification(t.authorId, 'share', `↗️ ${u?.name || u?.username || 'Someone'} shared your text on ${platform}.`, `/shayari/${t._id}/`, 'Text shared').catch(() => {});
  }
  checkTextViral(t._id);
  res.json({ success: true, shares: t.shares, platform });
});

// ----- comments -----
router.get('/:id/comments', async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  const rows = await Comment.find({ textId: req.params.id }).sort({ createdAt: -1 }).limit(100).lean();
  res.json(rows.map(c => ({ id: String(c._id), userId: String(c.userId), userName: c.userName, text: c.text, parentId: c.parentId ? String(c.parentId) : null, likes: (c.likes || []).length, createdAt: c.createdAt })));
});

router.post('/:id/comments', auth, async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  const text = String(req.body?.text || '').trim();
  if (!text || text.length > 500) return res.status(400).json({ error: 'Comment must be 1–500 characters' });
  const post = await TextPost.findOne({ _id: req.params.id, status: 'approved' }).select('authorId title text').lean();
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const user = await User.findById(req.user.id).select('name username').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  const parentId = isId(req.body?.parentId) ? req.body.parentId : null;
  if (parentId && !(await Comment.exists({ _id: parentId, textId: post._id }))) return res.status(400).json({ error: 'Invalid parent comment' });
  const c = await Comment.create({ textId: post._id, userId: user._id, userName: user.name || user.username || 'User', text, parentId });
  await TextPost.updateOne({ _id: post._id }, { $inc: { commentsCount: 1 } });
  if (String(post.authorId) !== req.user.id) {
    createNotification(post.authorId, 'comment', `💬 ${user.name || user.username} commented on your text “${(post.title || post.text).slice(0, 40)}”.`, `/shayari/${post._id}/`, 'New comment').catch(() => {});
  }
  checkTextViral(post._id);
  res.status(201).json({ id: String(c._id), userId: String(c.userId), userName: c.userName, text: c.text, parentId: parentId ? String(parentId) : null, likes: 0, createdAt: c.createdAt });
});

router.post('/:id/comments/:cid/like', auth, async (req, res) => {
  if (!isId(req.params.id) || !isId(req.params.cid)) return res.status(400).json({ error: 'Invalid ID' });
  const c = await Comment.findOne({ _id: req.params.cid, textId: req.params.id }).select('likes').lean();
  if (!c) return res.status(404).json({ error: 'Comment not found' });
  const uid = new mongoose.Types.ObjectId(req.user.id);
  const liked = (c.likes || []).some(id => String(id) === req.user.id);
  await Comment.updateOne({ _id: c._id }, liked ? { $pull: { likes: uid } } : { $addToSet: { likes: uid } });
  const fresh = await Comment.findById(c._id).select('likes').lean();
  res.json({ liked: !liked, likes: fresh?.likes?.length || 0 });
});

router.delete('/:id/comments/:cid', auth, async (req, res) => {
  if (!isId(req.params.id) || !isId(req.params.cid)) return res.status(400).json({ error: 'Invalid ID' });
  const c = await Comment.findOne({ _id: req.params.cid, textId: req.params.id });
  if (!c) return res.status(404).json({ error: 'Comment not found' });
  if (String(c.userId) !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  await c.deleteOne();
  await TextPost.updateOne({ _id: req.params.id, commentsCount: { $gt: 0 } }, { $inc: { commentsCount: -1 } });
  res.json({ success: true });
});

module.exports = router;
