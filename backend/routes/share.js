const express = require('express');
const mongoose = require('mongoose');
const { ShortLink, Preset, ShareClick } = require('../models');
const auth = require('../middleware/auth');

const router = express.Router();

function generateShortCode() {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 7; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}
function slugify(v) {
  return String(v || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset';
}

router.post('/create', auth, async (req, res) => {
  try {
    const { presetId, platform = 'link' } = req.body;
    if (!mongoose.Types.ObjectId.isValid(presetId))
      return res.status(400).json({ error: 'Invalid preset ID' });
    const preset = await Preset.findOne({ _id: presetId, status: 'approved' });
    if (!preset) return res.status(404).json({ error: 'Preset not found' });

    let code, exists = true;
    while (exists) {
      code = generateShortCode();
      exists = await ShortLink.exists({ code });
    }

    await ShortLink.create({ code, presetId, userId: req.user.id, platform });
    const SITE_URL = (process.env.CLIENT_URL || 'https://presethub.site').replace(/\/+$/, '');
    res.json({
      success: true, code,
      shortUrl: `${SITE_URL}/s/${code}`,
      fullUrl: `${SITE_URL}/preset/${preset._id}/${slugify(preset.name)}/`
    });
  } catch (err) {
    console.error('Create short link error:', err);
    res.status(500).json({ error: 'Failed to create short link' });
  }
});

router.get('/me/list', auth, async (req, res) => {
  const links = await ShortLink.find({ userId: req.user.id }).sort({ createdAt: -1 }).lean();
  const SITE_URL = (process.env.CLIENT_URL || 'https://presethub.site').replace(/\/+$/, '');
  res.json(links.map(l => ({
    code: l.code, presetId: l.presetId.toString(), platform: l.platform,
    clicks: l.clicks || 0, shortUrl: `${SITE_URL}/s/${l.code}`,
    createdAt: l.createdAt, lastClickAt: l.lastClickAt
  })));
});

module.exports = router;