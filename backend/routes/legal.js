'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { optionalAuth } = require('../middleware/auth');
const { ConsentLog } = require('../models');
const { legalContact, COOKIE_VERSION } = require('../utils/legal');

const router = express.Router();
const consentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Too many consent updates. Please try again later.' })
});

// Public business and grievance-officer details (shown on the Privacy, Refund and Contact pages).
router.get('/contact', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json(legalContact());
});

// Keeps a record of each cookie choice (what was shown, what was chosen, when) so consent can be demonstrated later.
// Stores no IP address and no user agent. Kept for three years, then deleted automatically (TTL index).
router.post('/consent', consentLimiter, optionalAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const visitorId = String(b.visitorId || '');
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(visitorId)) return res.status(400).json({ error: 'Invalid visitor id' });
    const p = b.purposes && typeof b.purposes === 'object' ? b.purposes : {};
    const purposes = { analytics: p.analytics === true, ads: p.ads === true, marketing: p.marketing === true };
    const on = Object.values(purposes).filter(Boolean).length;
    const requested = String(b.choice || '');
    const choice = requested === 'withdrawn' ? 'withdrawn' : on === 3 ? 'accepted_all' : on === 0 ? 'rejected_all' : 'custom';
    const page = String(b.page || '/').split('?')[0].split('#')[0].slice(0, 200);
    await ConsentLog.create({ visitorId, userId: req.user ? req.user.id : null, choice, purposes, version: COOKIE_VERSION, page });
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error('Consent log error:', e.message);
    res.status(500).json({ error: 'Could not record your choice. Your choice is still saved on this device.' });
  }
});

module.exports = router;
