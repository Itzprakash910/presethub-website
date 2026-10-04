const jwt = require('jsonwebtoken');
const { User } = require('../models');
const mongoose = require('mongoose');

const JWT_SECRET = process.env.JWT_SECRET;

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    const cookieToken = req.cookies?.ph_auth || '';
    const token = authHeader
      ? (authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader)
      : cookieToken;

    if (!token) {
      return res.status(401).json({
        error: 'Access denied. No token provided.'
      });
    }

    if (!token || token === 'null' || token === 'undefined' || token.length < 10) {
      return res.status(401).json({
        error: 'Access denied. Invalid token format.'
      });
    }

    let decoded;

    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'Token expired.',
          code: 'TOKEN_EXPIRED'
        });
      }

      if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
          error: 'Invalid token.',
          code: 'INVALID_TOKEN'
        });
      }

      throw err;
    }

    if (!mongoose.Types.ObjectId.isValid(decoded.id)) {
      return res.status(401).json({
        error: 'Invalid user ID.'
      });
    }

    const user = await User.findById(decoded.id)
      .select('role status sessionVersion')
      .lean();

    if (!user) {
      return res.status(401).json({
        error: 'User no longer exists.'
      });
    }

    const tokenVersion = Number.isInteger(decoded.ver) ? decoded.ver : 0;
    if (tokenVersion !== Number(user.sessionVersion || 0)) {
      return res.status(401).json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' });
    }

    if (user.status === 'blocked' || user.status === 'deactivated') {
      return res.status(403).json({
        error: 'Account is blocked or deactivated.'
      });
    }

    // Update activity without waiting for DB write.
    User.updateOne(
      { _id: decoded.id },
      {
        $set: {
          lastActive: new Date()
        },
        $inc: {
          commandsCount: 1
        }
      }
    ).catch(err => {
      console.warn('Activity update failed:', err.message);
    });

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: user.role
    };

    req.token = token;
    if (req.cookies?.ph_auth !== token && typeof res.cookie === 'function') {
      res.cookie('ph_auth', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/'
      });
    }

    next();

  } catch (error) {
    console.error('Auth middleware error:', error);

    return res.status(500).json({
      error: 'Authentication error.'
    });
  }
};


const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    const token = authHeader
      ? (authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader)
      : (req.cookies?.ph_auth || '');

    if (!token || token.length < 10) {
      return next();
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    if (!mongoose.Types.ObjectId.isValid(decoded.id)) {
      return next();
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role
    };

    // Activity update for optional authenticated users.
    User.updateOne(
      { _id: decoded.id },
      { $set: { lastActive: new Date() } }
    ).catch(() => {});

  } catch (_) {}

  next();
};


const authorize = (...roles) => (req, res, next) => {

  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required'
    });
  }

  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      error: 'Access denied.'
    });
  }

  next();
};


const isAdmin = authorize('admin');


module.exports = authenticate;
module.exports.authenticate = authenticate;
module.exports.optionalAuth = optionalAuth;
module.exports.authorize = authorize;
module.exports.isAdmin = isAdmin;
module.exports.JWT_SECRET = JWT_SECRET;