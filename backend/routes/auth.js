const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../config/db');
const { 
  validate, 
  signupValidation, 
  loginValidation,
  profileValidation,
  changePasswordValidation
} = require('../utils/validators');
const rateLimit = require('express-rate-limit');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

// Rate limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per window
  message: { error: 'Too many attempts, please try again later' }
});
router.use(authLimiter);

// Helper: Generate unique username
const generateUniqueUsername = (email, existingUsernames) => {
  let baseUsername = email.split('@')[0].toLowerCase()
    .replace(/[^a-z0-9]/g, '') // Remove special chars
    || 'user'; // Fallback if empty
  
  // Ensure minimum length
  if (baseUsername.length < 3) {
    baseUsername = baseUsername.padEnd(3, '0');
  }
  
  let username = baseUsername;
  let suffix = 1;
  let maxAttempts = 100;
  
  while (existingUsernames.includes(username) && suffix <= maxAttempts) {
    username = `${baseUsername}${suffix}`;
    suffix++;
  }
  
  // If still not unique, add timestamp
  if (existingUsernames.includes(username)) {
    username = `${baseUsername}${Date.now().toString().slice(-6)}`;
  }
  
  return username;
};

// SIGNUP Endpoint
router.post('/signup', validate(signupValidation), async (req, res) => {
  try {
    let { email, password, name, username } = req.body;
    
    // Normalize email and trim
    email = email.toLowerCase().trim();
    
    const db = await getDB();
    
    // Check if email already exists (case-insensitive)
    const existingEmail = db.data.users.find(u => u.email === email);
    if (existingEmail) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Handle username
    const existingUsernames = db.data.users.map(u => u.username);
    
    if (!username) {
      // Generate from email if not provided
      username = generateUniqueUsername(email, existingUsernames);
    } else {
      // Clean and validate username
      username = username.toLowerCase().trim().replace(/[^a-z0-9_]/g, '');
      
      // Check if username is unique
      if (existingUsernames.includes(username)) {
        // Try to generate a unique username
        username = generateUniqueUsername(email, existingUsernames);
      }
    }

    // Hash password
    const hashed = await bcrypt.hash(password, 10);
    
    // Create new user
    const newUser = {
      id: uuidv4(),
      email,
      password: hashed,
      name: name || username,
      role: 'user',
      createdAt: new Date().toISOString(),
      verified: false,
      bio: '',
      avatar: '',
      username,
      socialLinks: { 
        instagram: '', 
        youtube: '', 
        twitter: '', 
        website: '' 
      },
      followers: [],
      following: [],
      wishlist: [],
      subscription: { 
        tier: 'free', 
        expiry: null, 
        adWatchCount: 0, 
        adRewardDays: 0, 
        lastAdWatch: null 
      },
      referral: { 
        code: null, 
        referredBy: null, 
        referralCount: 0, 
        referralRewardDays: 0 
      },
      notifications: []
    };

    // Handle referral code from query param
    const refCode = req.query.ref;
    if (refCode) {
      const referrer = db.data.users.find(u => u.referral && u.referral.code === refCode);
      if (referrer && referrer.id !== newUser.id) {
        newUser.referral.referredBy = referrer.id;
        
        // Initialize referral if not exists
        if (!referrer.referral) {
          referrer.referral = { 
            code: null, 
            referredBy: null, 
            referralCount: 0, 
            referralRewardDays: 0 
          };
        }
        
        referrer.referral.referralCount = (referrer.referral.referralCount || 0) + 1;
        
        // Reward referral every 10 successful referrals
        if (referrer.referral.referralCount % 10 === 0) {
          const now = new Date();
          let expiry = referrer.subscription?.expiry ? new Date(referrer.subscription.expiry) : now;
          if (expiry < now) expiry = now;
          expiry.setDate(expiry.getDate() + 28);
          
          if (!referrer.subscription) {
            referrer.subscription = { 
              tier: 'free', 
              expiry: null, 
              adWatchCount: 0, 
              adRewardDays: 0 
            };
          }
          referrer.subscription.expiry = expiry.toISOString();
          referrer.referral.referralRewardDays = (referrer.referral.referralRewardDays || 0) + 28;
        }
      }
    }

    // Save user
    db.data.users.push(newUser);
    await db.write();

    // Generate JWT token
    const token = jwt.sign(
      { id: newUser.id, email: newUser.email, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Return response
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

// LOGIN Endpoint
router.post('/login', validate(loginValidation), async (req, res) => {
  try {
    let { email, password } = req.body;
    
    // Normalize email for case-insensitive login
    email = email.toLowerCase().trim();
    
    const db = await getDB();
    const user = db.data.users.find(u => u.email === email);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Check if user is verified (if email verification is implemented)
    if (user.verified === false) {
      return res.status(403).json({ 
        error: 'Please verify your email before logging in' 
      });
    }
    
    // Verify password
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Update last login
    user.lastLogin = new Date().toISOString();
    await db.write();
    
    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    // Return response
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

// GET CURRENT USER Endpoint (Protected)
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const db = await getDB();
    const user = db.data.users.find(u => u.id === req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Remove sensitive data
    const { password, ...userData } = user;
    
    res.json({
      success: true,
      user: userData
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// UPDATE PROFILE Endpoint (Protected)
router.put('/profile', authMiddleware, validate(profileValidation), async (req, res) => {
  try {
    const { name, username, bio, avatar, socialLinks } = req.body;
    const db = await getDB();
    
    // Find user
    const userIndex = db.data.users.findIndex(u => u.id === req.user.id);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = db.data.users[userIndex];
    
    // Check username uniqueness if being updated
    if (username && username !== user.username) {
      const usernameExists = db.data.users.some(u => 
        u.id !== user.id && u.username === username
      );
      if (usernameExists) {
        return res.status(409).json({ error: 'Username already taken' });
      }
      user.username = username.toLowerCase().trim();
    }
    
    // Update fields
    if (name) user.name = name.trim();
    if (bio !== undefined) user.bio = bio.trim();
    if (avatar !== undefined) user.avatar = avatar;
    if (socialLinks) {
      user.socialLinks = {
        ...user.socialLinks,
        ...socialLinks
      };
    }
    
    user.updatedAt = new Date().toISOString();
    await db.write();
    
    // Remove sensitive data
    const { password, ...userData } = user;
    
    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: userData
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// CHANGE PASSWORD Endpoint (Protected)
router.put('/change-password', authMiddleware, validate(changePasswordValidation), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const db = await getDB();
    
    // Find user
    const user = db.data.users.find(u => u.id === req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Verify current password
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    
    // Hash new password
    user.password = await bcrypt.hash(newPassword, 10);
    user.updatedAt = new Date().toISOString();
    await db.write();
    
    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// LOGOUT Endpoint (Protected)
router.post('/logout', authMiddleware, async (req, res) => {
  // Since JWT is stateless, we just inform the client to remove the token
  // Optional: Add token to blacklist if implemented
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

// REFRESH TOKEN Endpoint (Protected)
router.post('/refresh-token', authMiddleware, async (req, res) => {
  try {
    const db = await getDB();
    const user = db.data.users.find(u => u.id === req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Generate new token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({
      success: true,
      token
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;