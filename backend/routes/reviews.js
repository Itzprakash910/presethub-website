const express = require('express');
const auth = require('../middleware/auth');
const { getDB } = require('../db/db');
const { v4: uuidv4 } = require('uuid');
const { str } = require('../utils/helpers');

const router = express.Router();

router.get('/:presetId', async (req, res) => {
  const db = await getDB();
  const preset = db.data.presets.find(p => p.id === req.params.presetId && p.status === 'approved');
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  // helpfulBy (user ids) stays private
  res.json((preset.reviews || []).map(({ helpfulBy, ...r }) => r));
});

router.post('/:presetId', auth, async (req, res) => {
  const rating = Number(req.body.rating);
  const comment = str(req.body.comment, 500);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be a whole number from 1 to 5' });
  }

  const db = await getDB();
  const preset = db.data.presets.find(p => p.id === req.params.presetId && p.status === 'approved');
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  if (preset.authorId === req.user.id) return res.status(400).json({ error: 'You cannot review your own preset' });

  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  preset.reviews = preset.reviews || [];
  if (preset.reviews.some(r => r.userId === user.id)) {
    return res.status(409).json({ error: 'You already reviewed this preset' });
  }

  const review = {
    id: uuidv4(), userId: user.id, userName: user.name, rating, comment,
    createdAt: new Date().toISOString(), helpful: 0, helpfulBy: []
  };
  preset.reviews.push(review);
  const total = preset.reviews.reduce((s, r) => s + r.rating, 0);
  preset.avgRating = Math.round((total / preset.reviews.length) * 10) / 10;
  await db.write();
  const { helpfulBy, ...out } = review;
  res.status(201).json(out);
});

router.post('/:presetId/reviews/:reviewId/helpful', auth, async (req, res) => {
  const db = await getDB();
  const preset = db.data.presets.find(p => p.id === req.params.presetId && p.status === 'approved');
  const review = preset?.reviews?.find(r => r.id === req.params.reviewId);
  if (!review) return res.status(404).json({ error: 'Review not found' });
  if (review.userId === req.user.id) return res.status(400).json({ error: 'Cannot vote on your own review' });

  review.helpfulBy = review.helpfulBy || [];
  if (review.helpfulBy.includes(req.user.id)) return res.status(409).json({ error: 'Already marked helpful' });
  review.helpfulBy.push(req.user.id);
  review.helpful = review.helpfulBy.length;
  await db.write();
  res.json({ helpful: review.helpful });
});

module.exports = router;
