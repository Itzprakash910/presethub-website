const mongoose = require('mongoose');
const { User, Preset, Comment } = require('../models');

function getWebPush() {
  try { return require('web-push'); } catch (_) { return null; }
}

async function sendWebPush(userId, notification) {
  const webpush = getWebPush();
  if (!webpush || !process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_SUBJECT) return;
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    const user = await User.findById(userId).select('pushSubscriptions').lean();
    if (!user?.pushSubscriptions?.length) return;
    const payload = JSON.stringify({
      title: notification.title || 'PresetHub',
      body: notification.message || '',
      icon: '/assets/icons/icon-192.png',
      badge: '/assets/icons/icon-192.png',
      data: { url: notification.link || '/' }
    });
    const dead = [];
    await Promise.all(user.pushSubscriptions.map(async sub => {
      try { await webpush.sendNotification(sub, payload); }
      catch (e) { if (e.statusCode === 404 || e.statusCode === 410) dead.push(sub.endpoint); }
    }));
    if (dead.length) await User.updateOne({ _id: userId }, { $pull: { pushSubscriptions: { endpoint: { $in: dead } } } });
  } catch (e) { console.warn('Web push delivery skipped:', e.message); }
}

async function createNotification(userId, type, message, link, title='PresetHub') {
  if (!mongoose.Types.ObjectId.isValid(userId)) return false;
  const notification = { type, message, link: link || '/', read: false, createdAt: new Date() };
  const result = await User.updateOne(
    { _id: userId, notifications: { $not: { $elemMatch: { message, type, read: false } } } },
    { $push: { notifications: { $each: [notification], $slice: -200 } } }
  );
  if (result.modifiedCount > 0) {
    await sendWebPush(userId, { title, message, link: link || '/' });
    return true;
  }
  return false;
}

const FOLLOWER_MILESTONES = [100, 500, 1000];
const ENGAGEMENT_MILESTONES = {
  views: [100, 500, 1000, 5000, 10000],
  likes: [50, 100, 500, 1000],
  comments: [25, 100, 500],
  shares: [25, 100, 500],
  reviews: [10, 50, 100]
};

async function evaluateAchievements(userId) {
  if (!mongoose.Types.ObjectId.isValid(userId)) return;
  const user = await User.findById(userId).select('name username followers achievements').lean();
  if (!user) return;
  const presets = await Preset.find({ authorId: user._id, status: 'approved' }).select('views likes shares reviews').lean();
  const totals = presets.reduce((a,p) => {
    a.views += Number(p.views || 0);
    a.likes += Array.isArray(p.likes) ? p.likes.length : 0;
    a.shares += Number(p.shares || 0);
    a.reviews += Array.isArray(p.reviews) ? p.reviews.length : 0;
    return a;
  }, { views:0, likes:0, shares:0, reviews:0 });
  totals.comments = await Comment.countDocuments({ presetId: { $in: presets.map(p => p._id) } });
  const unlocked = new Set((user.achievements || []).map(a => a.key));
  const candidates = [];
  const followers = (user.followers || []).length;
  for (const n of FOLLOWER_MILESTONES) if (followers >= n) candidates.push({ key:`followers-${n}`, label:`${n} Followers`, icon:'fa-users', message:`🎉 Amazing! You reached ${n} followers on PresetHub. Your community is growing!` });
  for (const [metric, levels] of Object.entries(ENGAGEMENT_MILESTONES)) {
    for (const n of levels) if (totals[metric] >= n) candidates.push({ key:`${metric}-${n}`, label:`${n} ${metric[0].toUpperCase()+metric.slice(1)}`, icon: metric==='views'?'fa-eye':metric==='likes'?'fa-heart':metric==='comments'?'fa-message':metric==='shares'?'fa-share-nodes':'fa-star', message:`🏆 Achievement unlocked: ${n} ${metric} across your published presets! Keep creating and sharing.` });
  }
  const fresh = candidates.filter(a => !unlocked.has(a.key));
  if (!fresh.length) return;
  await User.updateOne({ _id:user._id }, { $push:{ achievements:{ $each:fresh.map(a=>({key:a.key,label:a.label,icon:a.icon,unlockedAt:new Date()})), $slice:-100 } } });
  const profileLink = `/profile/${user._id}/${encodeURIComponent(user.username || user.name || 'creator')}/`;
  for (const a of fresh) await createNotification(user._id, 'achievement', a.message, profileLink, '🏆 PresetHub Achievement');
}

module.exports = { createNotification, evaluateAchievements, sendWebPush };
