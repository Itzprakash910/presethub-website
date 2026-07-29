const express = require('express');
const auth = require('../middleware/auth');
const { getDB } = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const { createNotification } = require('./users'); // ✅ added import

const router = express.Router();

// Get reviews for a preset
router.get('/:presetId', async (req, res) => {
  const db = await getDB();
  const preset = db.data.presets.find(p => p.id === req.params.presetId);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  res.json(preset.reviews || []);
});

// Post a review
router.post('/:presetId', auth, [
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('comment').notEmpty().withMessage('Comment is required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }

  const { rating, comment } = req.body;
  const userId = req.user.id;
  const db = await getDB();
  const preset = db.data.presets.find(p => p.id === req.params.presetId);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });

  // Check if user already reviewed
  const existingReview = preset.reviews?.find(r => r.userId === userId);
  if (existingReview) {
    return res.status(400).json({ error: 'You have already reviewed this preset' });
  }

  const user = db.data.users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const review = {
    id: uuidv4(),
    userId,
    userName: user.name,
    rating: parseInt(rating),
    comment,
    createdAt: new Date().toISOString(),
    helpful: 0,
  };
  
  if (!preset.reviews) preset.reviews = [];
  preset.reviews.push(review);

  const total = preset.reviews.reduce((sum, r) => sum + r.rating, 0);
  preset.avgRating = total / preset.reviews.length;
  await db.write();

  // ✅ Send notification to author
  if (preset.authorId !== userId) {
    await createNotification(preset.authorId, 'review', `${user.name} reviewed your preset "${preset.name}" (${rating}★)`, `/preset/${preset.id}`);
  }

  res.status(201).json(review);
});

// Mark review as helpful
router.post('/:presetId/reviews/:reviewId/helpful', auth, async (req, res) => {
  const db = await getDB();
  const preset = db.data.presets.find(p => p.id === req.params.presetId);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  const review = preset.reviews.find(r => r.id === req.params.reviewId);
  if (!review) return res.status(404).json({ error: 'Review not found' });
  review.helpful += 1;
  await db.write();
  res.json({ helpful: review.helpful });
});

// Delete review
router.delete('/:presetId/reviews/:reviewId', auth, async (req, res) => {
  const db = await getDB();
  const preset = db.data.presets.find(p => p.id === req.params.presetId);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  
  const reviewIndex = preset.reviews.findIndex(r => r.id === req.params.reviewId);
  if (reviewIndex === -1) return res.status(404).json({ error: 'Review not found' });
  
  const review = preset.reviews[reviewIndex];
  if (review.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  preset.reviews.splice(reviewIndex, 1);
  
  if (preset.reviews.length > 0) {
    const total = preset.reviews.reduce((sum, r) => sum + r.rating, 0);
    preset.avgRating = total / preset.reviews.length;
  } else {
    preset.avgRating = 0;
  }
  
  await db.write();
  res.json({ success: true });
});

module.exports = router;