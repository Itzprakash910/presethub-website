/**
 * Viral detection. When a preset or text post crosses the viral score for the first time,
 * every active user gets an in-app + push notification. If the creator has a follower tick
 * (green/blue/gold) the notification carries that tick.
 */
const mongoose = require('mongoose');
const { User, Preset, TextPost, Comment } = require('../models');
const { tickForFollowers } = require('./tick');
const { adminAlert, postToChannel } = require('./alerts');

const VIRAL_SCORE = () => Number(process.env.VIRAL_SCORE || 300);

function presetScore(p, comments = 0) {
  return Number(p.views || 0) + (p.likes?.length || 0) * 5 + comments * 6 + Number(p.shares || 0) * 8 + Number(p.downloads || 0) * 4;
}
function textScore(t) {
  return Number(t.views || 0) + (t.likes?.length || 0) * 5 + Number(t.commentsCount || 0) * 6 + Number(t.shares || 0) * 8 + Number(t.copies || 0) * 4;
}

async function broadcast({ type, message, link, title, tick, excludeUserId }) {
  const note = { type, message: message.slice(0, 480), link, read: false, tick: tick || '', createdAt: new Date() };
  const filter = { status: 'active' };
  if (excludeUserId) filter._id = { $ne: excludeUserId };
  const res = await User.updateMany(filter, { $push: { notifications: { $each: [note], $slice: -200 } } });
  // Web push in small batches so the event loop is never blocked.
  try {
    const { sendWebPush } = require('./notifications');
    const users = await User.find({ ...filter, 'pushSubscriptions.0': { $exists: true } }).select('_id').limit(2000).lean();
    for (let i = 0; i < users.length; i += 25) {
      await Promise.all(users.slice(i, i + 25).map(u => sendWebPush(u._id, { title, message: note.message, link })));
    }
  } catch (_) {}
  return res.modifiedCount || 0;
}

async function checkPresetViral(presetId) {
  try {
    if (!mongoose.Types.ObjectId.isValid(presetId)) return;
    const p = await Preset.findOne({ _id: presetId, status: 'approved', viralNotifiedAt: null }).select('name author authorId views likes shares downloads').lean();
    if (!p) return;
    const comments = await Comment.countDocuments({ presetId: p._id });
    const score = presetScore(p, comments);
    if (score < VIRAL_SCORE()) return;
    const claimed = await Preset.updateOne({ _id: p._id, viralNotifiedAt: null }, { $set: { viralNotifiedAt: new Date() } });
    if (!claimed.modifiedCount) return;
    const author = await User.findById(p.authorId).select('followers name username').lean();
    const tick = tickForFollowers(author?.followers?.length);
    const sent = await broadcast({
      type: 'viral', tick, title: '🔥 Trending on PresetHub', excludeUserId: p.authorId,
      message: `🔥 “${p.name}” by ${p.author || author?.name || 'a creator'} is going viral! Check this preset out.`,
      link: `/preset/${p._id}/`
    });
    postToChannel(`🔥 Trending now: “${p.name}” by ${p.author || 'a creator'}\n\nDownload free or premium Lightroom preset on PresetHub.`, `${process.env.CLIENT_URL || 'https://presethub.site'}/preset/${p._id}/`);
    await adminAlert({ type: 'viral', severity: 'info', title: `Preset going viral: ${p.name}`, details: { score, notifiedUsers: sent, creator: p.author, tick: tick || 'none' }, email: false });
  } catch (e) { console.warn('checkPresetViral:', e.message); }
}

async function checkTextViral(textId) {
  try {
    if (!mongoose.Types.ObjectId.isValid(textId)) return;
    const t = await TextPost.findOne({ _id: textId, status: 'approved', viralNotifiedAt: null }).select('title text author authorId views likes shares copies commentsCount category').lean();
    if (!t) return;
    const score = textScore(t);
    if (score < VIRAL_SCORE()) return;
    const claimed = await TextPost.updateOne({ _id: t._id, viralNotifiedAt: null }, { $set: { viralNotifiedAt: new Date() } });
    if (!claimed.modifiedCount) return;
    const author = await User.findById(t.authorId).select('followers name username').lean();
    const tick = tickForFollowers(author?.followers?.length);
    const preview = (t.title || t.text).replace(/\s+/g, ' ').slice(0, 70);
    const sent = await broadcast({
      type: 'viral', tick, title: '🔥 Viral shayari', excludeUserId: t.authorId,
      message: `🔥 Viral ${t.category.replace('-', ' ')} text: “${preview}…” by ${t.author}. Read & copy it now!`,
      link: `/shayari/${t._id}/`
    });
    postToChannel(`🔥 Viral ${t.category.replace('-', ' ')}:\n\n${t.text.slice(0, 300)}\n\n— ${t.author}`, `${process.env.CLIENT_URL || 'https://presethub.site'}/shayari/${t._id}/`);
    await adminAlert({ type: 'viral', severity: 'info', title: `Text post going viral: ${preview}`, details: { score, notifiedUsers: sent, creator: t.author, tick: tick || 'none' }, email: false });
  } catch (e) { console.warn('checkTextViral:', e.message); }
}

module.exports = { checkPresetViral, checkTextViral, presetScore, textScore, broadcast };
