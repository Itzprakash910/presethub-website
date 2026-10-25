/**
 * Growth features API:
 *   GET  /api/features/daily                 preset + shayari of the day (same for everyone each IST day)
 *   POST /api/features/checkin               daily streak (auth) — 7-day milestone gives 1 Pro day
 *   GET  /api/features/leaderboard           top creators / shayari of the last 7 days
 *   GET  /api/features/feed                  latest from people you follow (auth)
 *   GET  /api/features/creator/overview      earnings chart, level, top presets (auth)
 *   GET  /api/features/caption               caption + hashtag suggestions
 *   POST /api/features/reports               report a preset, text, user or comment (auth)
 *   GET/POST/PUT/DELETE /api/collections…    user collections of presets
 */
const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const { optionalAuth } = auth;
const { Preset, TextPost, User, Order, Comment, Report, Collection } = require('../models');
const { createNotification } = require('../utils/notifications');
const { tickForFollowers } = require('../utils/tick');
const { isProUser, extendedExpiry } = require('../utils/plans');
const { adminAlert } = require('../utils/alerts');
const { dayKey, shiftDay, dailyIndex, nextStreak, creatorLevel, buildCaptions, TOPIC_KEYS, TONE_KEYS, AUTO_HIDE_REPORTS } = require('../utils/features');
const { bulkLimiter, textPostLimiter } = require('../utils/security');

const router = express.Router();
const isId = v => mongoose.Types.ObjectId.isValid(v);
const PRESET_PUBLIC = 'name description category tags price author authorId downloads previewImage createdAt';

function presetOut(p) {
  return { id: String(p._id), name: p.name, description: p.description || '', category: p.category || 'General', tags: (p.tags || []).slice(0, 10), price: Number(p.price || 0), author: p.author || 'Creator', authorId: String(p.authorId || ''), downloads: Number(p.downloads || 0), previewImage: p.previewImage || '' };
}
function textOut(t) {
  return { id: String(t._id), title: t.title || '', text: t.text, category: t.category, tags: t.tags || [], author: t.author, authorId: String(t.authorId), copies: t.copies || 0, likes: (t.likes || []).length, createdAt: t.createdAt };
}

// ---------- daily ----------
async function getDailyPicks() {
  const key = dayKey();
  const [pCount, tCount] = await Promise.all([
    Preset.countDocuments({ status: 'approved' }),
    TextPost.countDocuments({ status: 'approved' })
  ]);
  const pi = dailyIndex(key + 'p', pCount), ti = dailyIndex(key + 't', tCount);
  const [preset] = pi >= 0 ? await Preset.find({ status: 'approved' }).sort({ _id: 1 }).skip(pi).limit(1).select(PRESET_PUBLIC).lean() : [];
  const [text] = ti >= 0 ? await TextPost.find({ status: 'approved' }).sort({ _id: 1 }).skip(ti).limit(1).lean() : [];
  return { day: key, preset: preset ? presetOut(preset) : null, text: text ? textOut(text) : null };
}

router.get('/daily', async (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json(await getDailyPicks());
});

// ---------- streak ----------
router.post('/checkin', auth, async (req, res) => {
  const user = await User.findById(req.user.id).select('streakCurrent streakBest streakLastDay subscription name');
  if (!user) return res.status(404).json({ error: 'User not found' });
  const today = dayKey();
  const next = nextStreak({ current: user.streakCurrent, best: user.streakBest, lastDay: user.streakLastDay }, today);
  if (!next.changed) return res.json({ current: next.current, best: next.best, rewarded: false });
  let rewarded = false;
  const update = { streakCurrent: next.current, streakBest: next.best, streakLastDay: next.lastDay };
  if (next.rewardDays) {
    const expiry = extendedExpiry(user, next.rewardDays);
    update['subscription.expiry'] = expiry;
    update['subscription.tier'] = 'pro';
    update['subscription.plan'] = user.subscription?.plan || 'streak';
    rewarded = true;
    await createNotification(user._id, 'streak', `🔥 ${next.current}-day streak! You earned 1 free Pro day.`, '/', '🔥 Streak reward');
  }
  await User.updateOne({ _id: user._id }, { $set: update });
  res.json({ current: next.current, best: next.best, rewarded });
});

// ---------- leaderboard (last 7 days) ----------
router.get('/leaderboard', async (req, res) => {
  const since = new Date(Date.now() - 7 * 86400000);
  const type = req.query.type === 'texts' ? 'texts' : 'creators';
  if (type === 'creators') {
    const rows = await Preset.aggregate([
      { $match: { status: 'approved', createdAt: { $gte: since } } },
      { $group: { _id: '$authorId', downloads: { $sum: '$downloads' }, presets: { $sum: 1 } } },
      { $sort: { downloads: -1 } }, { $limit: 10 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
      { $unwind: '$u' }
    ]);
    const boostedUsers = await User.find({ boostUntil: { $gt: new Date() }, status: 'active' }).sort({ boostUntil: -1 }).limit(3).select('name username avatar followers subscription').lean();
    const boostedIds = new Set(boostedUsers.map(u => String(u._id)));
    const organic = rows.filter(r => !boostedIds.has(String(r._id)));
    const top = [
      ...boostedUsers.map(u => ({ _id: u._id, downloads: 0, presets: 0, u, boosted: true })),
      ...organic
    ].slice(0, 10);
    return res.json({ type, items: top.map((r, i) => ({ rank: i + 1, userId: String(r._id), name: r.u.name || r.u.username, username: r.u.username, avatar: r.u.avatar || '', downloads: r.downloads, presets: r.presets, boosted: !!r.boosted, tick: tickForFollowers(r.u.followers?.length), isPro: isProUser(r.u) })) });
  }
  const rows = await TextPost.find({ status: 'approved', createdAt: { $gte: since } }).sort({ copies: -1, shares: -1 }).limit(10).lean();
  res.json({ type, items: rows.map((t, i) => ({ rank: i + 1, ...textOut(t) })) });
});

// ---------- follow feed ----------
router.get('/feed', auth, async (req, res) => {
  const me = await User.findById(req.user.id).select('following').lean();
  const ids = (me?.following || []).slice(0, 500);
  if (!ids.length) return res.json({ items: [], note: 'Follow creators to see their new presets and shayari here.' });
  const [presets, texts] = await Promise.all([
    Preset.find({ authorId: { $in: ids }, status: 'approved' }).sort({ createdAt: -1 }).limit(15).select(PRESET_PUBLIC).lean(),
    TextPost.find({ authorId: { $in: ids }, status: 'approved' }).sort({ createdAt: -1 }).limit(15).lean()
  ]);
  const items = [...presets.map(p => ({ kind: 'preset', at: p.createdAt, ...presetOut(p) })), ...texts.map(t => ({ kind: 'text', at: t.createdAt, ...textOut(t) }))]
    .sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 30);
  res.json({ items });
});

// ---------- creator overview (earnings chart, level) ----------
router.get('/creator/overview', auth, async (req, res) => {
  const uid = new mongoose.Types.ObjectId(req.user.id);
  const mine = await Preset.find({ authorId: uid, status: 'approved' }).select('name downloads').lean();
  const totalDownloads = mine.reduce((s, p) => s + Number(p.downloads || 0), 0);
  const since = new Date(Date.now() - 30 * 86400000);
  const presetIds = mine.map(p => p._id);
  const [sales, tipsUser] = await Promise.all([
    presetIds.length ? Order.aggregate([
      { $match: { presetId: { $in: presetIds }, status: 'paid', paidAt: { $gte: since } } },
      { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt', timezone: 'Asia/Kolkata' } }, presetId: '$presetId' }, amount: { $sum: '$amount' }, n: { $sum: 1 } } }
    ]) : [],
    User.findById(uid).select('tipsTotal').lean()
  ]);
  // 30-day series (IST days), zero-filled
  const today = dayKey();
  const series = [];
  const byDay = new Map();
  for (const r of sales) byDay.set(r._id.day, (byDay.get(r._id.day) || 0) + r.amount);
  for (let i = 29; i >= 0; i--) { const d = shiftDay(today, -i); series.push({ day: d, amount: Math.round((byDay.get(d) || 0) * 100) / 100 }); }
  const salesTotal = sales.reduce((s, r) => s + r.amount, 0);
  const perPreset = new Map();
  for (const r of sales) perPreset.set(String(r._id.presetId), (perPreset.get(String(r._id.presetId)) || 0) + r.n);
  const top = [...mine].sort((a, b) => b.downloads - a.downloads).slice(0, 5).map(p => ({ id: String(p._id), name: p.name, downloads: p.downloads || 0, salesLast30d: perPreset.get(String(p._id)) || 0 }));
  res.json({
    level: creatorLevel(totalDownloads),
    totals: { presets: mine.length, downloads: totalDownloads, salesLast30d: sales.reduce((s, r) => s + r.n, 0), revenueLast30d: Math.round(salesTotal * 100) / 100, tipsReceived: Math.round(Number(tipsUser?.tipsTotal || 0) * 100) / 100 },
    series, top
  });
});

// ---------- caption & hashtag suggestions ----------
router.get('/caption', (req, res) => {
  const topic = TOPIC_KEYS.includes(req.query.topic) ? req.query.topic : 'general';
  const tone = TONE_KEYS.includes(req.query.tone) ? req.query.tone : 'cinematic';
  res.json(buildCaptions(topic, tone, Number(req.query.seed) || Date.now()));
});

// ---------- reports ----------
const REPORT_MODEL = { preset: Preset, text: TextPost, comment: Comment, user: User };
router.post('/reports', auth, textPostLimiter, async (req, res) => {
  const { targetType, targetId } = req.body || {};
  const reason = ['spam', 'copyright', 'abuse', 'hate', 'adult', 'scam', 'other'].includes(req.body?.reason) ? req.body.reason : 'other';
  const details = String(req.body?.details || '').slice(0, 500);
  const Model = REPORT_MODEL[targetType];
  if (!Model || !isId(targetId)) return res.status(400).json({ error: 'Invalid report target' });
  const target = await Model.findById(targetId).select(targetType === 'user' ? '_id' : 'authorId userId').lean();
  if (!target) return res.status(404).json({ error: 'Nothing to report' });
  const owner = String(target.authorId || target.userId || target._id);
  if (owner === req.user.id) return res.status(400).json({ error: 'You cannot report your own content' });
  try {
    await Report.create({ reporterId: req.user.id, targetType, targetId, reason, details });
  } catch (e) {
    if (e?.code === 11000) return res.json({ success: true, duplicate: true, message: 'You already reported this. Thank you.' });
    throw e;
  }
  // Auto-hide: enough distinct open reports pulls a text post out of public view until an admin decides.
  const openCount = await Report.countDocuments({ targetType, targetId, status: 'open' });
  let hidden = false;
  if (openCount >= AUTO_HIDE_REPORTS && targetType === 'text') {
    await TextPost.updateOne({ _id: targetId, status: 'approved' }, { $set: { status: 'rejected' } });
    hidden = true;
  }
  if (openCount >= AUTO_HIDE_REPORTS) adminAlert({ type: 'system', severity: 'warning', title: `Content reported ${openCount} times: ${targetType}`, fingerprint: `report-${targetId}`, throttleMs: 60 * 60 * 1000, details: { targetType, targetId: String(targetId), reports: openCount, autoHidden: hidden } });
  res.status(201).json({ success: true, message: 'Report received. Our team will review it.', autoHidden: hidden });
});

// ---------- leaderboard/feeds are public; reports need login ----------
module.exports = router;
module.exports.presetOut = presetOut;
module.exports.getDailyPicks = getDailyPicks;
