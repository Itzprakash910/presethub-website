const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db/db');
const { JWT_SECRET } = require('../middleware/auth');
const { str, isEmail } = require('../utils/helpers');

const router = express.Router();
const EXPIRES = process.env.JWT_EXPIRES_IN || '7d';
// Used so unknown emails take the same time as wrong passwords (no user enumeration by timing)
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

const sign = u => jwt.sign({ id: u.id }, JWT_SECRET, { algorithm: 'HS256', expiresIn: EXPIRES });
const pub = u => ({ id: u.id, name: u.name, email: u.email, role: u.role });

router.post('/signup', async (req, res) => {
  const email = str(req.body.email, 254).toLowerCase();
  const name = str(req.body.name, 60);
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!isEmail(email)) return res.status(400).json({ error: 'Valid email required' });
  if (name.length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters' });
  if (password.length < 8 || password.length > 72) {
    return res.status(400).json({ error: 'Password must be 8–72 characters' });
  }

  const db = await getDB();
  if (db.data.users.some(u => u.email === email)) {
    return res.status(409).json({ error: 'User already exists' });
  }

  const user = {
    id: uuidv4(), email, password: await bcrypt.hash(password, 12), name,
    role: 'user',                       // role can NEVER come from the request
    createdAt: new Date().toISOString(),
    verified: false, bio: '', avatar: '',
    socialLinks: { instagram: '', youtube: '', twitter: '', website: '' },
    followers: [], following: [], wishlist: []
  };
  db.data.users.push(user);
  await db.write();
  res.status(201).json({ token: sign(user), user: pub(user) });
});

router.post('/login', async (req, res) => {
  const email = str(req.body.email, 254).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const db = await getDB();
  const user = db.data.users.find(u => u.email === email);
  const valid = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);
  if (!user || !valid) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ token: sign(user), user: pub(user) });
});

module.exports = router;
