const express = require('express');
const { HomeAd } = require('../models');

const router = express.Router();

function serialize(ad) {
  if (!ad) return null;
  return {
    id: ad._id.toString(), title: ad.title, description: ad.description,
    imageUrl: ad.imageUrl, linkUrl: ad.linkUrl, productName: ad.productName,
    originalPrice: ad.originalPrice, salePrice: ad.salePrice,
    discountPercent: ad.discountPercent, badge: ad.badge, adType: ad.adType || 'personal',
    startsAt: ad.startsAt, endsAt: ad.endsAt,
  };
}

router.get('/home', async (req, res) => {
  try {
    const now = new Date();
    const ad = await HomeAd.findOne({
      active: true,
      $and: [
        { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
      ]
    }).sort({ createdAt: -1 }).lean();
    if (!ad) return res.json({ ad: null });
    HomeAd.updateOne({ _id: ad._id }, { $inc: { impressions: 1 } }).catch(() => {});
    res.set('Cache-Control', 'private, max-age=30');
    res.json({ ad: serialize(ad) });
  } catch (err) {
    console.error('Home ad error:', err);
    res.status(500).json({ error: 'Failed to load promotion' });
  }
});

router.post('/:id/click', async (req, res) => {
  try {
    if (!/^[a-f0-9]{24}$/i.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid ad ID' });
    await HomeAd.updateOne({ _id: req.params.id, active: true }, { $inc: { clicks: 1 } });
    res.json({ success: true });
  } catch (_) {
    res.status(500).json({ error: 'Failed to track promotion click' });
  }
});

module.exports = router;
