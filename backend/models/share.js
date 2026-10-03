const express = require('express');
const axios = require('axios');
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


router.get('/qr', async (req, res) => {
  const value = String(req.query.url || '').trim();
  let target;
  try { target = new URL(value); } catch (_) { return res.status(400).json({ error: 'Invalid QR URL' }); }
  const SITE_URL = (process.env.CLIENT_URL || 'https://presethub.site').replace(/\/+$/, '');
  if (target.origin !== SITE_URL || !['http:', 'https:'].includes(target.protocol)) {
    return res.status(400).json({ error: 'QR URL must belong to PresetHub' });
  }

  const encoded = encodeURIComponent(target.toString());
  const providers = [
    `https://quickchart.io/qr?size=320&margin=2&format=png&text=${encoded}`,
    `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=8&data=${encoded}`
  ];

  for (const provider of providers) {
    try {
      const upstream = await axios.get(provider, {
        responseType: 'arraybuffer',
        timeout: 8000,
        headers: { Accept: 'image/png,image/*;q=0.9,*/*;q=0.5', 'User-Agent': 'PresetHub/2.9.1 QR proxy' }
      });
      const contentType = String(upstream.headers['content-type'] || 'image/png').split(';')[0];
      if (upstream.status >= 200 && upstream.status < 300 && contentType.startsWith('image/')) {
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.send(Buffer.from(upstream.data));
      }
    } catch (err) {
      console.warn('QR provider failed:', provider.split('?')[0], err.message);
    }
  }
  return res.status(502).json({ error: 'QR image provider unavailable' });
});

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