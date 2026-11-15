'use strict';
/**
 * E-mail ownership check. A random token is e-mailed; only its SHA-256 hash is stored (valid 24 h, single use).
 * Default is SOFT: unverified users can still log in. Set REQUIRE_VERIFIED_EMAIL=on to also require it for uploading presets and posting texts.
 */
const crypto = require('crypto');
const { canSendMail, sendUserMail } = require('./mailer');
const { User } = require('../models');

const TTL_MS = 24 * 60 * 60 * 1000;
const enabled = () => canSendMail() && process.env.EMAIL_VERIFICATION !== 'off';
const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sendVerification(user) {
  if (!enabled()) return false;
  const raw = crypto.randomBytes(32).toString('hex');
  await User.updateOne({ _id: user._id }, { $set: { emailVerifyHash: hash(raw), emailVerifyExpires: new Date(Date.now() + TTL_MS) } });
  const base = (process.env.CLIENT_URL || 'https://presethub.site').replace(/\/+$/, '');
  const url = `${base}/?verify=${raw}`;
  return sendUserMail(user.email, 'Verify your PresetHub email',
    `<p>Hi ${esc(user.name || 'there')},</p><p>Please confirm this email address to finish setting up your PresetHub account:</p><p><a href="${url}">Verify my email</a></p><p>This link works once and expires in 24 hours. If you did not create an account, you can ignore this email.</p>`);
}

async function confirm(rawToken) {
  const token = String(rawToken || '').trim();
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const r = await User.updateOne({ emailVerifyHash: hash(token), emailVerifyExpires: { $gt: new Date() } },
    { $set: { emailVerified: true, emailVerifyHash: '', emailVerifyExpires: null } });
  return r.modifiedCount === 1;
}

// Optional gate (REQUIRE_VERIFIED_EMAIL=on) for actions that create public content.
function requireVerifiedEmail(req, res, next) {
  if (process.env.REQUIRE_VERIFIED_EMAIL !== 'on') return next();
  User.findById(req.user.id).select('emailVerified role').lean().then(u => {
    if (!u) return res.status(401).json({ error: 'User not found' });
    if (u.emailVerified === false && u.role !== 'admin') return res.status(403).json({ code: 'EMAIL_NOT_VERIFIED', error: 'Please verify your email address first. We sent you a link — you can request another from your account menu.' });
    next();
  }).catch(() => res.status(500).json({ error: 'Server error' }));
}
module.exports = { enabled, sendVerification, confirm, requireVerifiedEmail };
