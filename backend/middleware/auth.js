const jwt = require('jsonwebtoken');
const { getDB } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

/**
 * Authentication Middleware
 * Verifies JWT token and attaches user info to request
 */
module.exports = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.header('Authorization');
    if (!authHeader) {
      return res.status(401).json({ 
        error: 'Access denied. No token provided.' 
      });
    }

    // Extract token (handle both "Bearer token" and just "token")
    let token;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      token = authHeader;
    }
    
    // Validate token format
    if (!token || token === 'null' || token === 'undefined' || token.length < 10) {
      return res.status(401).json({ 
        error: 'Access denied. Invalid token format.' 
      });
    }

    // Verify token
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

    // Optional: Verify user still exists in database
    try {
      const db = await getDB();
      const user = db.data.users.find(u => u.id === decoded.id);
      
      if (!user) {
        return res.status(401).json({ 
          error: 'User no longer exists. Please login again.',
          code: 'USER_NOT_FOUND'
        });
      }
      
      // Optional: Check if user is blocked/deactivated
      if (user.status === 'blocked' || user.status === 'deactivated') {
        return res.status(403).json({ 
          error: 'Account is blocked or deactivated.',
          code: 'ACCOUNT_BLOCKED'
        });
      }
      
      // Attach full user object to request (optional)
      // req.userFull = user;
    } catch (dbError) {
      // If database check fails, we'll still proceed with decoded token
      // but log the error
      console.error('Database check in auth middleware failed:', dbError);
    }

    // Attach decoded user info to request
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
 * @param {...string} roles - Allowed roles
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

/**
 * Optional: Admin middleware (shorthand for authorize('admin'))
 */
const isAdmin = authorize('admin');

module.exports = {
  authenticate: module.exports, // For backward compatibility
  authorize,
  isAdmin,
  JWT_SECRET
};