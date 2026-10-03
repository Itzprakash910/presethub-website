const jwt = require('jsonwebtoken');
const { getDB } = require('../config/db');

function getToken(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  return h.slice(7);
}

async function auth(req, res, next) {
  try {
    const token = getToken(req);
    if (!token) return res.status(401).json({ error: 'Login required' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const db = await getDB();
    const user = db.data.users.find(u => u.id === payload.id);
    if (!user) return res.status(401).json({ error: 'Session expired' });
    req.user = user;
    next();
  } catch (_) { return res.status(401).json({ error: 'Invalid or expired session' }); }
}

function optionalAuth(req, _res, next) {
  const token = getToken(req);
  if (!token) return next();
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    getDB().then(db => { req.user = db.data.users.find(u => u.id === payload.id) || null; next(); }).catch(() => next());
  } catch (_) { next(); }
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

module.exports = { auth, optionalAuth, adminOnly };
