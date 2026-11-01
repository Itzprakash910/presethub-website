/**
 * Creator dashboard and payouts.
 *   GET  /api/creator/dashboard          profile, totals, viral posts, text prompts, earnings chart (auth)
 *   GET  /api/creator/payout-details     saved payout method, masked (auth)
 *   PUT  /api/creator/payout-details     save UPI or bank details, encrypted (auth)
 *   GET  /api/creator/payouts            my payout history (auth)
 *   POST /api/creator/payouts            request a payout from my available balance (auth)
 *
 * Earnings = CREATOR_SHARE of paid preset sales and tips. Payouts are paid by an admin
 * (see admin routes) and the bank reference is recorded. No automatic bank transfer happens here.
 */
const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const { Preset, TextPost, User, Order, Payout } = require('../models');
const { tickForFollowers } = require('../utils/tick');
const { isProUser } = require('../utils/plans');
const { creatorLevel, dayKey, shiftDay } = require('../utils/features');
const { encrypt, decrypt, isKeyConfigured } = require('../utils/crypto');
const P = require('../utils/payouts');
const { adminAlert } = require('../utils/alerts');
const { createNotification } = require('../utils/notifications');
const { textPostLimiter } = require('../utils/security');
const rateLimit = require('express-rate-limit');

const router = express.Router();
const payoutLimiter = rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false, keyGenerator: r => `u:${r.user?.id || r.ip}`, handler: (req, res) => res.status(429).json({ error: 'Too many payout requests today. Try again tomorrow.' }) });
const detailLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, keyGenerator: r => `u:${r.user?.id || r.ip}`, handler: (req, res) => res.status(429).json({ error: 'Too many changes. Try again later.' }) });

const COMMITTED = ['requested', 'approved', 'paid'];

// Aggregates the creator's money in paise. Shared with admin views.
async function earningsFor(userId) {
  const uid = new mongoose.Types.ObjectId(userId);
  const presetIds = (await Preset.find({ authorId: uid }).select('_id').lean()).map(p => p._id);
  const [sales, tips, payoutRows] = await Promise.all([
    presetIds.length ? Order.aggregate([{ $match: { presetId: { $in: presetIds }, kind: 'preset', status: 'paid' } }, { $group: { _id: null, gross: { $sum: '$amount' }, n: { $sum: 1 } } }]) : [],
    Order.aggregate([{ $match: { recipientId: uid, kind: 'tip', status: 'paid' } }, { $group: { _id: null, gross: { $sum: '$amount' }, n: { $sum: 1 } } }]),
    Payout.aggregate([{ $match: { userId: uid } }, { $group: { _id: '$status', paise: { $sum: '$amountPaise' }, n: { $sum: 1 } } }])
  ]);
  const grossSalesPaise = P.toPaise(sales[0]?.gross || 0);
  const grossTipsPaise = P.toPaise(tips[0]?.gross || 0);
  const earnedPaise = P.creatorShare(grossSalesPaise + grossTipsPaise);
  const by = Object.fromEntries(payoutRows.map(r => [r._id, { paise: r.paise, n: r.n }]));
  const committedPaise = COMMITTED.reduce((s, k) => s + (by[k]?.paise || 0), 0);
  return {
    earnedPaise, committedPaise, paidPaise: by.paid?.paise || 0,
    pendingPaise: (by.requested?.paise || 0) + (by.approved?.paise || 0),
    availablePaise: P.balance({ earnedPaise, committedPaise }),
    salesCount: sales[0]?.n || 0, salesGrossPaise: grossSalesPaise, tipsCount: tips[0]?.n || 0, tipsGrossPaise: grossTipsPaise,
    presetIds
  };
}

function rupees(p) { return Math.round(Number(p || 0)) / 100; }

// ---------- dashboard ----------
router.get('/dashboard', auth, async (req, res) => {
  const uid = req.user.id;
  const user = await User.findById(uid).select('name username avatar bio followers following verified subscription tipsTotal payoutMethod payoutMasked payoutUpdatedAt createdAt proTheme').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  const money = await earningsFor(uid);
  const [presets, texts, presetTotals, textTotals] = await Promise.all([
    Preset.find({ authorId: uid }).sort({ downloads: -1, createdAt: -1 }).limit(50).select('name category price downloads views likes shares status viralNotifiedAt createdAt previewImage').lean(),
    TextPost.find({ authorId: uid }).sort({ copies: -1, createdAt: -1 }).limit(50).select('title text category copies likes shares views commentsCount status viralNotifiedAt createdAt').lean(),
    Preset.aggregate([{ $match: { authorId: new mongoose.Types.ObjectId(uid) } }, { $group: { _id: null, n: { $sum: 1 }, downloads: { $sum: '$downloads' }, views: { $sum: '$views' }, likes: { $sum: { $size: { $ifNull: ['$likes', []] } } } } }]),
    TextPost.aggregate([{ $match: { authorId: new mongoose.Types.ObjectId(uid) } }, { $group: { _id: null, n: { $sum: 1 }, copies: { $sum: '$copies' }, views: { $sum: '$views' }, likes: { $sum: { $size: { $ifNull: ['$likes', []] } } }, shares: { $sum: '$shares' }, comments: { $sum: '$commentsCount' } } }])
  ]);
  // 30-day earnings series (India days), zero filled
  const since = new Date(Date.now() - 30 * 86400000);
  const dailySales = money.presetIds.length ? await Order.aggregate([
    { $match: { presetId: { $in: money.presetIds }, kind: 'preset', status: 'paid', paidAt: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt', timezone: 'Asia/Kolkata' } }, gross: { $sum: '$amount' } } }
  ]) : [];
  const dailyTips = await Order.aggregate([
    { $match: { recipientId: new mongoose.Types.ObjectId(uid), kind: 'tip', status: 'paid', paidAt: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt', timezone: 'Asia/Kolkata' } }, gross: { $sum: '$amount' } } }
  ]);
  const byDay = new Map();
  for (const r of [...dailySales, ...dailyTips]) byDay.set(r._id, (byDay.get(r._id) || 0) + P.toPaise(r.gross));
  const today = dayKey();
  const series = [];
  for (let i = 29; i >= 0; i--) { const d = shiftDay(today, -i); series.push({ day: d, amount: rupees(P.creatorShare(byDay.get(d) || 0)) }); }

  const viralPresets = presets.filter(p => p.viralNotifiedAt).map(p => ({ id: String(p._id), name: p.name, downloads: p.downloads, viralAt: p.viralNotifiedAt }));
  const viralTexts = texts.filter(t => t.viralNotifiedAt).map(t => ({ id: String(t._id), title: t.title || t.text.slice(0, 60), copies: t.copies, viralAt: t.viralNotifiedAt }));
  const pt = presetTotals[0] || {}, tt = textTotals[0] || {};
  const level = creatorLevel(presets.reduce((s, p) => s + Number(p.downloads || 0), 0));
  const payouts = await Payout.find({ userId: uid }).sort({ createdAt: -1 }).limit(20).select('amountPaise method destinationMasked status reference createdAt processedAt adminNote').lean();

  res.set('Cache-Control', 'no-store');
  res.json({
    profile: {
      id: String(user._id), name: user.name, username: user.username, avatar: user.avatar || '', bio: user.bio || '',
      followers: (user.followers || []).length, following: (user.following || []).length,
      tick: tickForFollowers((user.followers || []).length), isPro: isProUser(user), verified: !!user.verified,
      memberSince: user.createdAt, level, theme: user.proTheme || 'gold'
    },
    money: {
      earned: rupees(money.earnedPaise), available: rupees(money.availablePaise), pending: rupees(money.pendingPaise), paid: rupees(money.paidPaise),
      sales: { count: money.salesCount, gross: rupees(money.salesGrossPaise) },
      tips: { count: money.tipsCount, gross: rupees(money.tipsGrossPaise) },
      sharePercent: Math.round(P.CREATOR_SHARE() * 100), minPayout: P.MIN_PAYOUT_PAISE() / 100
    },
    totals: {
      presets: pt.n || 0, downloads: pt.downloads || 0, presetViews: pt.views || 0, presetLikes: pt.likes || 0,
      texts: tt.n || 0, copies: tt.copies || 0, textViews: tt.views || 0, textLikes: tt.likes || 0, shares: tt.shares || 0, comments: tt.comments || 0
    },
    viral: { presets: viralPresets, texts: viralTexts },
    presets: presets.map(p => ({ id: String(p._id), name: p.name, category: p.category, price: p.price, downloads: p.downloads, views: p.views, likes: (p.likes || []).length, status: p.status, viral: !!p.viralNotifiedAt, createdAt: p.createdAt })),
    texts: texts.map(t => ({ id: String(t._id), title: t.title || '', text: t.text.slice(0, 160), category: t.category, copies: t.copies, likes: (t.likes || []).length, shares: t.shares, views: t.views, comments: t.commentsCount, status: t.status, viral: !!t.viralNotifiedAt, createdAt: t.createdAt })),
    series,
    payoutDetails: { configured: isKeyConfigured(), method: user.payoutMethod || '', masked: user.payoutMasked || '', updatedAt: user.payoutUpdatedAt || null },
    payouts: payouts.map(x => ({ id: String(x._id), amount: rupees(x.amountPaise), method: x.method, destination: x.destinationMasked, status: x.status, reference: x.reference || '', note: x.adminNote || '', createdAt: x.createdAt, processedAt: x.processedAt }))
  });
});

// ---------- payout details ----------
router.get('/payout-details', auth, async (req, res) => {
  const u = await User.findById(req.user.id).select('payoutMethod payoutMasked payoutUpdatedAt').lean();
  res.set('Cache-Control', 'no-store');
  res.json({ configured: isKeyConfigured(), method: u?.payoutMethod || '', masked: u?.payoutMasked || '', updatedAt: u?.payoutUpdatedAt || null });
});

router.put('/payout-details', auth, detailLimiter, textPostLimiter, async (req, res) => {
  if (!isKeyConfigured()) return res.status(503).json({ error: 'Payout details are not available yet. Please try later.' });
  const b = req.body || {};
  const holder = P.validateName(b.accountHolder);
  if (!holder) return res.status(400).json({ error: 'Enter the account holder name (3–100 characters).' });
  // A pending payout must not be redirected to new details.
  if (await Payout.exists({ userId: req.user.id, status: { $in: ['requested', 'approved'] } })) return res.status(400).json({ error: 'You have a payout in progress. Change details after it is completed.' });
  let method, payload, masked;
  if (b.method === 'upi') {
    const upi = P.validateUpi(b.upi);
    if (!upi) return res.status(400).json({ error: 'Enter a valid UPI ID (for example name@bank).' });
    method = 'upi'; payload = { holder, upi }; masked = `${P.maskUpi(upi)} · ${holder}`;
  } else if (b.method === 'bank') {
    const account = P.validateAccount(b.accountNumber);
    const ifsc = P.validateIfsc(b.ifsc);
    if (!account) return res.status(400).json({ error: 'Enter a valid bank account number (9–18 digits).' });
    if (!ifsc) return res.status(400).json({ error: 'Enter a valid IFSC code.' });
    method = 'bank'; payload = { holder, account, ifsc }; masked = `${P.maskAccount(account)} · ${ifsc} · ${holder}`;
  } else return res.status(400).json({ error: 'Choose UPI or bank account.' });
  await User.updateOne({ _id: req.user.id }, { $set: { payoutMethod: method, payoutMasked: masked, payoutEnc: encrypt(JSON.stringify(payload)), payoutUpdatedAt: new Date() } });
  res.json({ success: true, method, masked });
});

// ---------- payouts ----------
router.get('/payouts', auth, async (req, res) => {
  const rows = await Payout.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(100).select('amountPaise method destinationMasked status reference adminNote createdAt processedAt').lean();
  res.set('Cache-Control', 'no-store');
  res.json({ items: rows.map(x => ({ id: String(x._id), amount: rupees(x.amountPaise), method: x.method, destination: x.destinationMasked, status: x.status, reference: x.reference || '', note: x.adminNote || '', createdAt: x.createdAt, processedAt: x.processedAt })) });
});

router.post('/payouts', auth, payoutLimiter, async (req, res) => {
  if (!isKeyConfigured()) return res.status(503).json({ error: 'Payouts are not available yet.' });
  const user = await User.findById(req.user.id).select('payoutMethod payoutEnc payoutMasked username').lean();
  if (!user?.payoutEnc) return res.status(400).json({ error: 'Add your UPI or bank details before requesting a payout.' });
  if (await Payout.exists({ userId: req.user.id, status: { $in: ['requested', 'approved'] } })) return res.status(400).json({ error: 'You already have a payout in progress.' });
  const amountPaise = P.toPaise(req.body?.amount);
  const min = P.MIN_PAYOUT_PAISE();
  if (!Number.isSafeInteger(amountPaise) || amountPaise < min) return res.status(400).json({ error: `Minimum payout is ₹${min / 100}.` });
  const before = await earningsFor(req.user.id);
  if (amountPaise > before.availablePaise) return res.status(400).json({ error: `Available balance is ₹${before.availablePaise / 100}.` });

  // Snapshot the destination now, so later detail changes do not affect this request.
  const payout = await Payout.create({ userId: req.user.id, amountPaise, method: user.payoutMethod, destinationMasked: user.payoutMasked || '', destinationEnc: user.payoutEnc, status: 'requested' });

  // Guard against two requests racing past the checks above: re-count and roll back if the limits were exceeded.
  const after = await earningsFor(req.user.id);
  const openCount = await Payout.countDocuments({ userId: req.user.id, status: { $in: ['requested', 'approved'] } });
  if (after.committedPaise > after.earnedPaise || openCount > 1) {
    await Payout.deleteOne({ _id: payout._id });
    return res.status(409).json({ error: 'Another payout request was made at the same time. Please check your balance and try again.' });
  }
  // Small payouts are approved automatically (limit from PAYOUT_AUTO_APPROVE_RUPEES). Money is still sent by the admin.
  const autoLimit = Math.round(Number(process.env.PAYOUT_AUTO_APPROVE_RUPEES || 500) * 100);
  let status = 'requested';
  if (amountPaise <= autoLimit) {
    await Payout.updateOne({ _id: payout._id, status: 'requested' }, { $set: { status: 'approved', adminNote: 'Auto-approved (small amount)', processedAt: new Date() } });
    status = 'approved';
  }
  await createNotification(req.user.id, 'payout', status === 'approved'
    ? `💸 Payout of ₹${amountPaise / 100} is approved and will be sent shortly.`
    : `💸 Payout request of ₹${amountPaise / 100} received. It will be paid within a few working days.`, '/creator.html', 'Payout update');
  adminAlert({ type: 'payment', severity: 'info', title: `Payout requested: ₹${amountPaise / 100}`, details: { payoutId: String(payout._id), creator: user.username, method: user.payoutMethod, amountRupees: amountPaise / 100 }, email: false });
  res.status(201).json({ success: true, id: String(payout._id), amount: amountPaise / 100, status });
});

// ---------- Pro perks: colour theme (Pro members only; the colour is applied on the site) ----------
const PRO_THEMES = { gold: '#d4a373', rose: '#e88da0', ocean: '#4ca1af', emerald: '#2fa37a', classic: '#5b5b5b' };
router.get('/themes', (req, res) => res.json({ themes: Object.keys(PRO_THEMES).map(k => ({ key: k, color: PRO_THEMES[k] })) }));
router.put('/theme', auth, async (req, res) => {
  const user = await User.findById(req.user.id).select('subscription proTheme').lean();
  if (!isProUser(user)) return res.status(403).json({ error: 'Pro members can choose a theme colour. Go Pro to unlock it.' });
  const key = String(req.body?.theme || '');
  if (!Object.prototype.hasOwnProperty.call(PRO_THEMES, key)) return res.status(400).json({ error: 'Choose a valid theme.' });
  await User.updateOne({ _id: req.user.id }, { $set: { proTheme: key } });
  res.json({ success: true, theme: key, color: PRO_THEMES[key] });
});

module.exports = router;
module.exports.earningsFor = earningsFor;
