/**
 * Account routes. Sign-up, sign-in, password and email verification are handled by Clerk.
 *   GET    /api/auth/me                 current user (creates/links the account on first Clerk login)
 *   POST   /api/auth/sync               same as /me (safe to call after sign-in)
 *   PUT    /api/auth/profile            name, username, bio
 *   POST   /api/auth/logout             server-side no-op; the browser signs out of Clerk
 *   POST   /api/auth/bot-link-code      one-time 6-digit code to link the Telegram bot (expires in 10 minutes)
 *   DELETE /api/auth/account            deactivate PresetHub data and delete the Clerk login (body: {confirm:"DELETE"})
 */
const express = require('express');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const { User } = require('../models');
const { isProUser } = require('../utils/plans');
const { tickForFollowers } = require('../utils/tick');
const clerk = require('../utils/clerk');
const { adminAlert, requestInfo } = require('../utils/alerts');
const { textPostLimiter } = require('../utils/security');

const router = express.Router();
const HIDE = '-password -botLinkHash -botLinkExpires -token -passwordResetTokenHash -passwordResetExpires -pushSubscriptions -sessionVersion -payoutEnc';

function publicUser(u) {
  return { ...u, id: String(u._id), isPro: isProUser(u), tick: tickForFollowers((u.followers || []).length) };
}

async function me(req, res) {
  const user = await User.findById(req.user.id).select(HIDE).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, user: publicUser(user) });
}
router.get('/me', auth, me);
router.post('/sync', auth, me);

router.put('/profile', auth, async (req, res) => {
  const b = req.body || {};
  const set = {};
  if (b.name !== undefined) {
    const name = String(b.name).trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 60) return res.status(400).json({ error: 'Name must be 2 to 60 characters.' });
    set.name = name;
  }
  if (b.username !== undefined) {
    const username = String(b.username).trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: 'Username: 3 to 24 letters, numbers or underscore.' });
    if (await User.exists({ username, _id: { $ne: req.user.id } })) return res.status(409).json({ error: 'This username is taken.' });
    set.username = username;
  }
  if (b.bio !== undefined) set.bio = String(b.bio || '').slice(0, 200);
  if (!Object.keys(set).length) return res.status(400).json({ error: 'Nothing to update.' });
  const user = await User.findByIdAndUpdate(req.user.id, { $set: set }, { new: true }).select(HIDE).lean();
  res.json({ success: true, user: publicUser(user) });
});

router.post('/logout', auth, (req, res) => res.json({ success: true }));

// Telegram linking: the website shows a one-time code; the user sends /link CODE to the bot.
router.post('/bot-link-code', auth, textPostLimiter, async (req, res) => {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const hash = crypto.createHash('sha256').update(code).digest('hex');
  await User.updateOne({ _id: req.user.id }, { $set: { botLinkHash: hash, botLinkExpires: new Date(Date.now() + 10 * 60 * 1000) } });
  res.json({ code, expiresInMinutes: 10, instructions: 'Telegram bot par /link ' + code + ' bhejein.' });
});

// Copy of the user's own personal data (DPDP access right). No passwords, secrets or other people's data.
router.get('/my-data', auth, async (req, res) => {
  const { Order, Preset, TextPost, Payout, Comment } = require('../models');
  const uid = req.user.id;
  const [user, orders, presets, texts, payouts, comments] = await Promise.all([
    User.findById(uid).select('name username email phone bio avatar createdAt subscription tipsTotal').lean(),
    Order.find({ userId: uid }).select('kind amount status createdAt couponCode').sort({ createdAt: -1 }).limit(1000).lean(),
    Preset.find({ authorId: uid }).select('name category price status createdAt').lean(),
    TextPost.find({ authorId: uid }).select('title category status createdAt').lean(),
    Payout.find({ userId: uid }).select('amountPaise method destinationMasked status createdAt').lean(),
    Comment.find({ userId: uid }).select('text createdAt').limit(1000).lean()
  ]);
  const data = {
    exportedAt: new Date().toISOString(),
    profile: user ? { name: user.name, username: user.username, email: user.email, phone: user.phone || '', bio: user.bio || '', createdAt: user.createdAt, pro: user.subscription || null } : null,
    orders: orders.map(o => ({ id: String(o._id), kind: o.kind, amountRupees: o.amount, status: o.status, coupon: o.couponCode || '', createdAt: o.createdAt })),
    presets: presets.map(p => ({ id: String(p._id), name: p.name, category: p.category, price: p.price, status: p.status, createdAt: p.createdAt })),
    textPosts: texts.map(t => ({ id: String(t._id), title: t.title || '', category: t.category, status: t.status, createdAt: t.createdAt })),
    payouts: payouts.map(x => ({ id: String(x._id), amountRupees: Math.round(x.amountPaise) / 100, method: x.method, destination: x.destinationMasked, status: x.status, createdAt: x.createdAt })),
    comments: comments.map(c => ({ text: c.text, createdAt: c.createdAt }))
  };
  res.set('Content-Disposition', `attachment; filename="presethub-my-data-${new Date().toISOString().slice(0, 10)}.json"`);
  res.set('Cache-Control', 'no-store');
  res.json(data);
});

router.delete('/account', auth, async (req, res) => {
  if (String(req.body?.confirm || '') !== 'DELETE') return res.status(400).json({ error: 'Type DELETE to confirm.' });
  const user = await User.findById(req.user.id).select('clerkId email').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  // Keep money and audit records (orders, payouts); remove the login and personal fields.
  await User.updateOne({ _id: user._id }, { $set: { status: 'deactivated', name: 'Deleted user', username: '', bio: '', avatar: '', telegramId: '', clerkId: '' }, $unset: { botLinkHash: 1, botLinkExpires: 1 } });
  if (user.clerkId) {
    try { await clerk.deleteClerkUser(user.clerkId); }
    catch (e) { adminAlert({ type: 'security', severity: 'warning', title: 'Clerk login could not be deleted', details: { userId: String(user._id), error: e.message, ...requestInfo(req) } }); }
  }
  res.json({ success: true });
});

module.exports = router;
