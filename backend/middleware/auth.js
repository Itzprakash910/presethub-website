const jwt = require('jsonwebtoken');
const { getDB } = require('../db/db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET missing or shorter than 32 chars. Set it in backend/.env');
  process.exit(1);
}

// Verifies token AND re-reads the user from DB, so role changes / deleted users take effect immediately.
module.exports = async (req, res, next) => {
  const header = req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    const db = await getDB();
    const user = db.data.users.find(u => u.id === decoded.id);
    if (!user) return res.status(401).json({ error: 'Account not found' });
    req.user = { id: user.id, email: user.email, role: user.role };
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

module.exports.JWT_SECRET = JWT_SECRET;
