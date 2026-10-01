const jwt = require('jsonwebtoken');
const { User } = require('../models');
const mongoose = require('mongoose');

const JWT_SECRET = process.env.JWT_SECRET;

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader) return res.status(401).json({ error: 'Access denied. No token provided.' });

    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
    if (!token || token === 'null' || token === 'undefined' || token.length < 10) {
      return res.status(401).json({ error: 'Access denied. Invalid token format.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired.', code: 'TOKEN_EXPIRED' });
      }
      if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({ error: 'Invalid token.', code: 'INVALID_TOKEN' });
      }
      throw err;
    }

    if (!mongoose.Types.ObjectId.isValid(decoded.id)) {
      return res.status(401).json({ error: 'Invalid user ID.' });
    }

    const user = await User.findById(decoded.id).select('role status').lean();
    if (!user) return res.status(401).json({ error: 'User no longer exists.' });
    if (user.status === 'blocked' || user.status === 'deactivated') {
      return res.status(403).json({ error: 'Account is blocked or deactivated.' });
    }

    req.user = { id: decoded.id, email: decoded.email, role: user.role };
    req.token = token;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Authentication error.' });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader) return next();
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
    if (!token || token.length < 10) return next();
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { id: decoded.id, email: decoded.email, role: decoded.role };
  } catch (_) {}
  next();
};

const authorize = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Access denied.' });
  next();
};

const isAdmin = authorize('admin');

module.exports = authenticate;
module.exports.authenticate = authenticate;
module.exports.optionalAuth = optionalAuth;
module.exports.authorize = authorize;
module.exports.isAdmin = isAdmin;
module.exports.JWT_SECRET = JWT_SECRET;