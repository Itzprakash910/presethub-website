const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const { Comment, Preset, User } = require('../models');
const { createNotification } = require('./users');

const router = express.Router();

router.get('/:presetId', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.presetId)) return res.status(400).json({ error: 'Invalid ID' });
    const comments = await Comment.find({ presetId: req.params.presetId }).sort({ createdAt: -1 }).limit(100).lean();
    res.json(comments.map(c => ({ id: c._id.toString(), presetId: c.presetId.toString(), userId: c.userId.toString(), userName: c.userName, text: c.text, parentId: c.parentId ? c.parentId.toString() : null, likes: (c.likes || []).length, createdAt: c.createdAt })));
  } catch (e) { next(e); }
});

router.post('/:presetId', auth, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.presetId)) return res.status(400).json({ error: 'Invalid ID' });
    const text = String(req.body.text || '').trim();
    if (!text || text.length > 500) return res.status(400).json({ error: 'Comment must be 1–500 characters' });
    const preset = await Preset.findOne({ _id: req.params.presetId, status: 'approved' }).select('name authorId').lean();
    if (!preset) return res.status(404).json({ error: 'Preset not found' });
    const user = await User.findById(req.user.id).select('name username').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    const parentId = req.body.parentId && mongoose.Types.ObjectId.isValid(req.body.parentId) ? req.body.parentId : null;
    const comment = await Comment.create({ presetId: preset._id, userId: user._id, userName: user.name || user.username || 'User', text, parentId });
    if (preset.authorId.toString() !== req.user.id) {
      await createNotification(preset.authorId, 'comment', `${user.name || user.username || 'Someone'} commented on "${preset.name}"`, `/preset/${preset._id}`);
    }
    if (parentId) {
      const parent = await Comment.findById(parentId).select('userId').lean();
      if (parent && parent.userId.toString() !== req.user.id) {
        await createNotification(parent.userId, 'comment-reply', `${user.name || user.username || 'Someone'} replied to your comment on "${preset.name}"`, `/preset/${preset._id}`);
      }
    }
    res.status(201).json({ id: comment._id.toString(), presetId: comment.presetId.toString(), userId: comment.userId.toString(), userName: comment.userName, text: comment.text, parentId: comment.parentId ? comment.parentId.toString() : null, likes: 0, createdAt: comment.createdAt });
  } catch (e) { next(e); }
});

router.post('/:presetId/:commentId/like', auth, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.presetId) || !mongoose.Types.ObjectId.isValid(req.params.commentId)) return res.status(400).json({ error: 'Invalid ID' });
    const comment = await Comment.findOne({ _id: req.params.commentId, presetId: req.params.presetId }).select('likes').lean();
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    const liked = (comment.likes || []).some(id => id.toString() === req.user.id);
    const uid = new mongoose.Types.ObjectId(req.user.id);
    await Comment.updateOne({ _id: comment._id }, liked ? { $pull: { likes: uid } } : { $addToSet: { likes: uid } });
    const fresh = await Comment.findById(comment._id).select('likes').lean();
    res.json({ liked: !liked, likes: fresh?.likes?.length || 0 });
  } catch (e) { next(e); }
});

router.delete('/:presetId/:commentId', auth, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.presetId) || !mongoose.Types.ObjectId.isValid(req.params.commentId)) return res.status(400).json({ error: 'Invalid ID' });
    const comment = await Comment.findOne({ _id: req.params.commentId, presetId: req.params.presetId });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.userId.toString() !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
    await comment.deleteOne();
    res.json({ success: true });
  } catch (e) { next(e); }
});

module.exports = router;
