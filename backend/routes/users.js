const express = require('express');
const auth = require('../middleware/auth');
const { getDB } = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const { validate } = require('../utils/validators');
const { body } = require('express-validator');

const router = express.Router();

// Get own profile
router.get('/me', auth, async (req, res) => {
  const db = await getDB();
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { password, ...safeUser } = user;
  res.json(safeUser);
});

// Update profile
router.put('/me', auth, [
  body('username').optional().isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
  body('email').optional().isEmail().withMessage('Invalid email')
], async (req, res) => {
  const { name, username, bio, avatar, socialLinks, email } = req.body;
  const db = await getDB();
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Check username uniqueness
  if (username && username !== user.username) {
    const existing = db.data.users.find(u => u.username === username && u.id !== req.user.id);
    if (existing) return res.status(409).json({ error: 'Username already taken' });
  }
  
  // Check email uniqueness
  if (email && email !== user.email) {
    const existing = db.data.users.find(u => u.email === email && u.id !== req.user.id);
    if (existing) return res.status(409).json({ error: 'Email already taken' });
  }

  if (name) user.name = name;
  if (username) user.username = username;
  if (bio) user.bio = bio;
  if (avatar) user.avatar = avatar;
  if (email) user.email = email;
  if (socialLinks) {
    user.socialLinks = { ...user.socialLinks, ...socialLinks };
  }
  await db.write();

  const { password, ...safeUser } = user;
  res.json(safeUser);
});

// Get top creators
router.get('/top', async (req, res) => {
  const db = await getDB();
  const users = db.data.users;
  const presets = db.data.presets;
  const top = users.map(u => {
    const userPresets = presets.filter(p => p.authorId === u.id);
    const totalDownloads = userPresets.reduce((sum, p) => sum + (p.downloads || 0), 0);
    return {
      id: u.id,
      name: u.name,
      username: u.username || u.email.split('@')[0],
      avatar: u.avatar,
      presetCount: userPresets.length,
      totalDownloads,
      followers: u.followers?.length || 0,
    };
  }).sort((a, b) => b.presetCount - a.presetCount || b.totalDownloads - a.totalDownloads)
    .slice(0, 5);
  res.json(top);
});

// Get public profile
router.get('/:id', async (req, res) => {
  const db = await getDB();
  const user = db.data.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { password, ...safeUser } = user;
  const presets = db.data.presets.filter(p => p.authorId === user.id);
  const totalDownloads = presets.reduce((sum, p) => sum + (p.downloads || 0), 0);
  res.json({
    ...safeUser,
    totalPresets: presets.length,
    totalDownloads,
    followers: user.followers?.length || 0,
    following: user.following?.length || 0,
  });
});

// Get presets by user
router.get('/:id/presets', async (req, res) => {
  const db = await getDB();
  const presets = db.data.presets.filter(p => p.authorId === req.params.id);
  res.json(presets);
});

// Follow/Unfollow
router.post('/:id/follow', auth, async (req, res) => {
  const db = await getDB();
  const targetUser = db.data.users.find(u => u.id === req.params.id);
  if (!targetUser) return res.status(404).json({ error: 'User not found' });
  if (targetUser.id === req.user.id) return res.status(400).json({ error: 'Cannot follow yourself' });

  const currentUser = db.data.users.find(u => u.id === req.user.id);
  if (!currentUser) return res.status(404).json({ error: 'User not found' });

  if (!targetUser.followers) targetUser.followers = [];
  if (!currentUser.following) currentUser.following = [];

  const isFollowing = targetUser.followers.includes(currentUser.id);
  if (isFollowing) {
    targetUser.followers = targetUser.followers.filter(id => id !== currentUser.id);
    currentUser.following = currentUser.following.filter(id => id !== targetUser.id);
  } else {
    targetUser.followers.push(currentUser.id);
    currentUser.following.push(targetUser.id);
  }

  await db.write();
  res.json({ 
    following: !isFollowing,
    followersCount: targetUser.followers.length,
    followingCount: currentUser.following.length,
  });
});

// Get download history
router.get('/me/downloads', auth, async (req, res) => {
  const db = await getDB();
  const downloads = db.data.downloads.filter(d => d.userId === req.user.id);
  const presetIds = downloads.map(d => d.presetId);
  const presets = db.data.presets.filter(p => presetIds.includes(p.id));
  res.json(presets);
});

// Toggle wishlist
router.post('/me/wishlist/:presetId', auth, async (req, res) => {
  const db = await getDB();
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.wishlist) user.wishlist = [];
  const idx = user.wishlist.indexOf(req.params.presetId);
  if (idx === -1) user.wishlist.push(req.params.presetId);
  else user.wishlist.splice(idx, 1);
  await db.write();
  res.json({ wishlist: user.wishlist });
});

module.exports = router;