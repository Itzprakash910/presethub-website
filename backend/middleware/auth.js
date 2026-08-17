const jwt = require('jsonwebtoken');
const { getDB } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

/**
 * Authentication Middleware
 * Verifies JWT token and attaches user info to request
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader) {
      return res.status(401).json({ 
        error: 'Access denied. No token provided.' 
      });
    }

    let token;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      token = authHeader;
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
          error: 'Token expired. Please login again.',
          code: 'TOKEN_EXPIRED'
        });
      }
      if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({ 
          error: 'Invalid token. Please login again.',
          code: 'INVALID_TOKEN'
        });
      }
      throw err;
    }

    // Verify user still exists
    try {
      const db = await getDB();
      const user = db.data.users.find(u => u.id === decoded.id);
      
      if (!user) {
        return res.status(401).json({ 
          error: 'User no longer exists. Please login again.',
          code: 'USER_NOT_FOUND'
        });
      }
      
      if (user.status === 'blocked' || user.status === 'deactivated') {
        return res.status(403).json({ 
          error: 'Account is blocked or deactivated.',
          code: 'ACCOUNT_BLOCKED'
        });
      }
    } catch (dbError) {
      console.error('Database check in auth middleware failed:', dbError);
    }

    req.user = decoded;
    req.token = token;
    next();
    
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ 
      error: 'Authentication error. Please try again later.' 
    });
  }
};

/**
 * Role-based Authorization Middleware
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Access denied. Insufficient permissions.' 
      });
    }
    
    next();
  };
};

const isAdmin = authorize('admin');

module.exports = authenticate;
module.exports.authenticate = authenticate;
module.exports.authorize = authorize;
module.exports.isAdmin = isAdmin;
module.exports.JWT_SECRET = JWT_SECRET;