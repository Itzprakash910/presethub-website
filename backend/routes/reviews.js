const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const { Preset, User } = require('../models');
const { body, validationResult } = require('express-validator');
const { createNotification, evaluateAchievements } = require('../utils/notifications');

const router = express.Router();

router.get('/:presetId', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.presetId))
    return res.status(400).json({ error: 'Invalid ID' });
  const preset = await Preset.findById(req.params.presetId).select('reviews').lean();
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  res.json((preset.reviews || []).map(r => ({
    id: r._id.toString(), userName: r.userName, rating: r.rating,
    comment: r.comment, createdAt: r.createdAt, helpful: r.helpful || 0
  })));
});

router.post('/:presetId', auth, [
  body('rating').isInt({ min: 1, max: 5 }),
  body('comment').notEmpty().isLength({ max: 500 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  if (!mongoose.Types.ObjectId.isValid(req.params.presetId))
    return res.status(400).json({ error: 'Invalid ID' });

  const preset = await Preset.findById(req.params.presetId);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });

  if (preset.reviews.some(r => r.userId?.toString() === req.user.id))
    return res.status(400).json({ error: 'You already reviewed this preset' });

  const user = await User.findById(req.user.id).select('name').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });

  preset.reviews.push({
    userId: req.user.id,
    userName: user.name,
    rating: parseInt(req.body.rating),
    comment: req.body.comment
  });
  const total = preset.reviews.reduce((s, r) => s + r.rating, 0);
  preset.avgRating = parseFloat((total / preset.reviews.length).toFixed(1));
  await preset.save();

  if (preset.authorId.toString() !== req.user.id) {
    await createNotification(preset.authorId, 'review',
      `⭐ ${user.name} reviewed “${preset.name}” (${req.body.rating}★).`,
      `/preset/${preset._id}`, 'New review');
    evaluateAchievements(preset.authorId).catch(() => {});
  }

  const review = preset.reviews[preset.reviews.length - 1];
  res.status(201).json({ ...review.toObject(), id: review._id.toString() });
});

router.post('/:presetId/reviews/:reviewId/helpful', auth, async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.presetId))
    return res.status(400).json({ error: 'Invalid ID' });
  const preset = await Preset.findById(req.params.presetId);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  const review = preset.reviews.id(req.params.reviewId);
  if (!review) return res.status(404).json({ error: 'Review not found' });
  const voter = String(req.user.id);
  const already = (review.helpfulBy || []).some(id => String(id) === voter);
  if (already) return res.json({ helpful: review.helpful || 0, alreadyHelpful: true });
  review.helpful = (review.helpful || 0) + 1;
  review.helpfulBy = [...(review.helpfulBy || []), req.user.id];
  await preset.save();
  res.json({ helpful: review.helpful });
});

router.delete('/:presetId/reviews/:reviewId', auth, async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.presetId))
    return res.status(400).json({ error: 'Invalid ID' });
  const preset = await Preset.findById(req.params.presetId);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  const review = preset.reviews.id(req.params.reviewId);
  if (!review) return res.status(404).json({ error: 'Review not found' });
  if (review.userId.toString() !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Unauthorized' });
  review.deleteOne();
  const total = preset.reviews.reduce((s, r) => s + r.rating, 0);
  preset.avgRating = preset.reviews.length ? parseFloat((total / preset.reviews.length).toFixed(1)) : 0;
  await preset.save();
  res.json({ success: true });
});

module.exports = router;