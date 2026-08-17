const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { getDB } = require('../config/db');
const { 
  validate, 
  signupValidation, 
  loginValidation,
  changePasswordValidation
} = require('../utils/validators');
const rateLimit = require('express-rate-limit');
const auth = require('../middleware/auth');
const { uploadAvatar } = require('../middleware/upload');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Too many attempts, please try again later' }
});
router.use(authLimiter);

const generateUniqueUsername = (email, existingUsernames) => {
  let baseUsername = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
  if (baseUsername.length < 3) baseUsername = baseUsername.padEnd(3, '0');
  let username = baseUsername;
  let suffix = 1;
  while (existingUsernames.includes(username) && suffix <= 100) {
    username = `${baseUsername}${suffix}`;
    suffix++;
  }
  if (existingUsernames.includes(username)) {
    username = `${baseUsername}${Date.now().toString().slice(-6)}`;
  }
  return username;
};

// ===== SIGNUP =====
router.post('/signup', validate(signupValidation), async (req, res) => {
  try {
    let { email, password, name, username } = req.body;
    email = email.toLowerCase().trim();
    const db = await getDB();

    const existingEmail = db.data.users.find(u => u.email === email);
    if (existingEmail) return res.status(409).json({ error: 'User already exists' });

    const existingUsernames = db.data.users.map(u => u.username).filter(Boolean);
    if (!username) {
      username = generateUniqueUsername(email, existingUsernames);
    } else {
      username = username.toLowerCase().trim().replace(/[^a-z0-9_]/g, '');
      if (existingUsernames.includes(username)) {
        username = generateUniqueUsername(email, existingUsernames);
      }
    }

    const hashed = await bcrypt.hash(password, 10);
    const newUser = {
      id: uuidv4(),
      email,
      password: hashed,
      name: name || username,
      role: 'user',
      createdAt: new Date().toISOString(),
      verified: true,
      bio: '',
      avatar: '',
      username,
      socialLinks: { instagram: '', youtube: '', twitter: '', website: '' },
      followers: [],
      following: [],
      wishlist: [],
      subscription: { tier: 'free', expiry: null, adWatchCount: 0, adRewardDays: 0, lastAdWatch: null },
      referral: { code: null, referredBy: null, referralCount: 0, referralRewardDays: 0 },
      notifications: []
    };

    // Handle referral
    const refCode = req.query.ref;
    if (refCode) {
      const referrer = db.data.users.find(u => u.referral && u.referral.code === refCode);
      if (referrer && referrer.id !== newUser.id) {
        newUser.referral.referredBy = referrer.id;
        if (!referrer.referral) referrer.referral = { code: null, referredBy: null, referralCount: 0, referralRewardDays: 0 };
        referrer.referral.referralCount = (referrer.referral.referralCount || 0) + 1;
        if (referrer.referral.referralCount % 10 === 0) {
          const now = new Date();
          let expiry = referrer.subscription?.expiry ? new Date(referrer.subscription.expiry) : now;
          if (expiry < now) expiry = now;
          expiry.setDate(expiry.getDate() + 28);
          if (!referrer.subscription) {
            referrer.subscription = { tier: 'free', expiry: null, adWatchCount: 0, adRewardDays: 0 };
          }
          referrer.subscription.expiry = expiry.toISOString();
          referrer.referral.referralRewardDays = (referrer.referral.referralRewardDays || 0) + 28;
        }
      }
    }

    db.data.users.push(newUser);
    await db.write();

    const token = jwt.sign(
      { id: newUser.id, email: newUser.email, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      token,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        username: newUser.username,
        avatar: newUser.avatar,
        createdAt: newUser.createdAt,
        verified: newUser.verified
      }
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error during signup' });
  }
});

// ===== LOGIN =====
router.post('/login', validate(loginValidation), async (req, res) => {
  try {
    let { email, password } = req.body;
    email = email.toLowerCase().trim();
    const db = await getDB();
    const user = db.data.users.find(u => u.email === email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    user.lastLogin = new Date().toISOString();
    await db.write();

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        username: user.username,
        avatar: user.avatar,
        createdAt: user.createdAt,
        verified: user.verified,
        subscription: user.subscription
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// ===== GET CURRENT USER =====
router.get('/me', auth, async (req, res) => {
  try {
    const db = await getDB();
    const user = db.data.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { password, ...userData } = user;
    res.json({ success: true, user: userData });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== UPDATE PROFILE =====
router.put('/profile', auth, async (req, res) => {
  try {
    const { name, username, bio, avatar, socialLinks } = req.body;
    const db = await getDB();
    const userIndex = db.data.users.findIndex(u => u.id === req.user.id);
    if (userIndex === -1) return res.status(404).json({ error: 'User not found' });
    const user = db.data.users[userIndex];

    if (username && username !== user.username) {
      const usernameExists = db.data.users.some(u => u.id !== user.id && u.username === username);
      if (usernameExists) return res.status(409).json({ error: 'Username already taken' });
      user.username = username.toLowerCase().trim();
    }
    if (name) user.name = name.trim();
    if (bio !== undefined) user.bio = bio.trim();
    if (avatar !== undefined) user.avatar = avatar;
    if (socialLinks) user.socialLinks = { ...user.socialLinks, ...socialLinks };
    user.updatedAt = new Date().toISOString();
    await db.write();

    const { password, ...userData } = user;
    res.json({ success: true, message: 'Profile updated successfully', user: userData });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== CHANGE PASSWORD =====
router.put('/change-password', auth, validate(changePasswordValidation), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const db = await getDB();
    const user = db.data.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    user.password = await bcrypt.hash(newPassword, 10);
    user.updatedAt = new Date().toISOString();
    await db.write();
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== LOGOUT =====
router.post('/logout', auth, async (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

// ===== REFRESH TOKEN =====
router.post('/refresh-token', auth, async (req, res) => {
  try {
    const db = await getDB();
    const user = db.data.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ success: true, token });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== UPLOAD AVATAR =====
router.put('/me/avatar', auth, uploadAvatar, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const db = await getDB();
    const user = db.data.users.find(u => u.id === req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.avatar && user.avatar.startsWith('/uploads/avatars/')) {
      const oldPath = path.join(__dirname, '../../uploads/avatars', path.basename(user.avatar));
      if (fs.existsSync(oldPath)) {
        try { fs.unlinkSync(oldPath); } catch (e) {}
      }
    }

    user.avatar = `/uploads/avatars/${req.file.filename}`;
    await db.write();
    
    res.json({ 
      success: true, 
      avatar: user.avatar,
      message: 'Avatar updated successfully'
    });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({ error: 'Avatar upload failed' });
  }
});

module.exports = router;