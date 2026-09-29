const express = require('express');
const auth = require('../middleware/auth');
const { getDB } = require('../db/db');
const { str, safeUrl, publicPreset } = require('../utils/helpers');

const router = express.Router();
const SOCIAL_KEYS = ['instagram', 'youtube', 'twitter', 'website'];

// Private view (own profile)
const own = ({ password, ...u }) => u;
// Public view: no email, role, wishlist, follower lists
const publicUser = u => ({
  id: u.id, name: u.name, username: u.username || '', bio: u.bio || '',
  avatar: u.avatar || '', verified: !!u.verified, socialLinks: u.socialLinks || {},
  createdAt: u.createdAt
});

router.get('/me', auth, async (req, res) => {
  const db = await getDB();
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(own(user));
});

router.put('/me', auth, async (req, res) => {
  const db = await getDB();
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const b = req.body || {};

  if (b.username !== undefined) {
    const username = str(b.username, 30).toLowerCase();
    if (!/^[a-z0-9_]{3,30}$/.test(username)) {
      return res.status(400).json({ error: 'Username: 3–30 chars, a-z, 0-9, _ only' });
    }
    if (db.data.users.some(u => u.username === username && u.id !== user.id)) {
      return res.status(409).json({ error: 'Username already taken' });
    }
    user.username = username;
  }
  if (b.name !== undefined) {
    const name = str(b.name, 60);
    if (name.length < 2) return res.status(400).json({ error: 'Name too short' });
    user.name = name;
  }
  if (b.bio !== undefined) user.bio = str(b.bio, 300);          // can now be cleared
  if (b.avatar !== undefined) {
    const url = safeUrl(b.avatar);
    if (url === null) return res.status(400).json({ error: 'Avatar must be an http(s) URL' });
    user.avatar = url;
  }
  if (b.socialLinks && typeof b.socialLinks === 'object') {
    const links = { ...(user.socialLinks || {}) };
    for (const k of SOCIAL_KEYS) {                               // whitelist keys = no prototype pollution
      if (b.socialLinks[k] === undefined) continue;
      const url = safeUrl(b.socialLinks[k]);
      if (url === null) return res.status(400).json({ error: `Invalid ${k} link (must be http/https)` });
      links[k] = url;
    }
    user.socialLinks = links;
  }
  await db.write();
  res.json(own(user));
});

router.get('/top', async (req, res) => {
  const db = await getDB();
  const approved = db.data.presets.filter(p => p.status === 'approved');
  const top = db.data.users.map(u => {
    const mine = approved.filter(p => p.authorId === u.id);
    return {
      id: u.id, name: u.name, username: u.username || '', avatar: u.avatar || '',
      presetCount: mine.length,
      totalDownloads: mine.reduce((s, p) => s + (p.downloads || 0), 0),
      followers: u.followers?.length || 0
    };
  }).filter(u => u.presetCount > 0)
    .sort((a, b) => b.presetCount - a.presetCount || b.totalDownloads - a.totalDownloads)
    .slice(0, 5);
  res.json(top);
});

router.get('/me/wishlist', auth, async (req, res) => {
  const db = await getDB();
  const user = db.data.users.find(u => u.id === req.user.id);
  const ids = new Set(user?.wishlist || []);
  res.json(db.data.presets.filter(p => ids.has(p.id) && p.status === 'approved').map(publicPreset));
});

// All my presets incl. pending/rejected
router.get('/me/presets', auth, async (req, res) => {
  const db = await getDB();
  res.json(db.data.presets.filter(p => p.authorId === req.user.id).map(publicPreset));
});

// Own download history (before '/:id' routes)
router.get('/me/downloads', auth, async (req, res) => {
  const db = await getDB();
  const ids = new Set((db.data.downloads || []).filter(d => d.userId === req.user.id).map(d => d.presetId));
  res.json(db.data.presets.filter(p => ids.has(p.id)).map(publicPreset));
});

router.post('/me/wishlist/:presetId', auth, async (req, res) => {
  const db = await getDB();
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!db.data.presets.some(p => p.id === req.params.presetId)) {
    return res.status(404).json({ error: 'Preset not found' });
  }
  user.wishlist = user.wishlist || [];
  const i = user.wishlist.indexOf(req.params.presetId);
  if (i === -1) user.wishlist.push(req.params.presetId); else user.wishlist.splice(i, 1);
  await db.write();
  res.json({ wishlist: user.wishlist });
});

router.get('/:id', async (req, res) => {
  const db = await getDB();
  const user = db.data.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const mine = db.data.presets.filter(p => p.authorId === user.id && p.status === 'approved');
  res.json({
    ...publicUser(user),
    totalPresets: mine.length,
    totalDownloads: mine.reduce((s, p) => s + (p.downloads || 0), 0),
    followers: user.followers?.length || 0,
    following: user.following?.length || 0
  });
});

router.get('/:id/presets', async (req, res) => {
  const db = await getDB();
  res.json(db.data.presets.filter(p => p.authorId === req.params.id && p.status === 'approved').map(publicPreset));
});

router.post('/:id/follow', auth, async (req, res) => {
  const db = await getDB();
  const target = db.data.users.find(u => u.id === req.params.id);
  const me = db.data.users.find(u => u.id === req.user.id);
  if (!target || !me) return res.status(404).json({ error: 'User not found' });
  if (target.id === me.id) return res.status(400).json({ error: 'Cannot follow yourself' });

  target.followers = target.followers || [];
  me.following = me.following || [];
  const was = target.followers.includes(me.id);
  if (was) {
    target.followers = target.followers.filter(id => id !== me.id);
    me.following = me.following.filter(id => id !== target.id);
  } else {
    target.followers.push(me.id);
    me.following.push(target.id);
  }
  await db.write();
  res.json({ following: !was, followersCount: target.followers.length, followingCount: me.following.length });
});

module.exports = router;
