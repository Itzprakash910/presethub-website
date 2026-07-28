const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../config/db');
const { validate, signupValidation, loginValidation } = require('../utils/validators');
const rateLimit = require('express-rate-limit');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

// Rate limiting for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts, please try again later' }
});

router.use(authLimiter);

// Signup
router.post('/signup', validate(signupValidation), async (req, res) => {
  const { email, password, name } = req.body;

  const db = await getDB();
  const existing = db.data.users.find(u => u.email === email);
  if (existing) {
    return res.status(409).json({ error: 'User already exists' });
  }

  const hashed = await bcrypt.hash(password, 10);
  const newUser = {
    id: uuidv4(),
    email,
    password: hashed,
    name,
    role: 'user',
    createdAt: new Date().toISOString(),
    verified: false,
    bio: '',
    avatar: '',
    username: email.split('@')[0],
    socialLinks: {
      instagram: '',
      youtube: '',
      twitter: '',
      website: ''
    },
    followers: [],
    following: [],
    wishlist: [],
  };
  db.data.users.push(newUser);
  await db.write();

  const token = jwt.sign(
    { id: newUser.id, email: newUser.email, role: newUser.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  
  res.status(201).json({
    token,
    user: { 
      id: newUser.id, 
      name: newUser.name, 
      email, 
      role: newUser.role,
      username: newUser.username,
      avatar: newUser.avatar
    }
  });
});

// Login
router.post('/login', validate(loginValidation), async (req, res) => {
  const { email, password } = req.body;
  const db = await getDB();
  const user = db.data.users.find(u => u.email === email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  
  res.json({
    token,
    user: { 
      id: user.id, 
      name: user.name, 
      email, 
      role: user.role,
      username: user.username,
      avatar: user.avatar
    }
  });
});

module.exports = router;