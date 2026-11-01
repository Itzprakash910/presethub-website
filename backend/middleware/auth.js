/**
 * Authentication for every protected route.
 *  1. Clerk session token (Authorization: Bearer <token>) — the normal path for website users.
 *  2. Internal bot token (JWT signed with JWT_SECRET, purpose "bot") — used only by the Telegram bot server process.
 * The first verified Clerk login links the Clerk user to a PresetHub User by verified email (or creates one).
 * ADMIN_EMAIL gets the admin role only when that email is verified in Clerk.
 */
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const clerk = require('../utils/clerk');

const JWT_SECRET = process.env.JWT_SECRET;
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map(); // clerk user id -> { id, at }
const SELECT = 'email role adminRole name status clerkId telegramId';
const MFA_CACHE_MS = 5 * 60 * 1000;
const mfaCache = new Map(); // clerk user id -> { ok, at }
const MFA_REQUIRED = () => String(process.env.ADMIN_MFA_REQUIRED || 'on').toLowerCase() !== 'off';

// Keeps the in-memory caches bounded on a busy server.
function pruneCache(map, ttl) {
  if (map.size < 5000) return;
  const now = Date.now();
  for (const [k, v] of map) if (now - v.at > ttl) map.delete(k);
  if (map.size >= 5000) map.clear();
}

function bearer(req) {
  const h = String(req.header('Authorization') || '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}
function activeOrThrow(u) {
  if (!u) throw Object.assign(new Error('Account not found.'), { status: 401, code: 'NO_ACCOUNT' });
  if (u.status === 'blocked' || u.status === 'deactivated') throw Object.assign(new Error('This account is not active.'), { status: 403, code: 'ACCOUNT_INACTIVE' });
  return u;
}

// Admins must have 2-step verification on their Clerk account (ADMIN_MFA_REQUIRED=off turns this off).
async function assertAdminMfa(sub) {
  if (!MFA_REQUIRED()) return;
  const hit = mfaCache.get(sub);
  if (hit && hit.ok && Date.now() - hit.at < MFA_CACHE_MS) return;
  const cu = await clerk.getClerkUser(sub);
  if (!cu.mfa) {
    mfaCache.delete(sub);
    throw Object.assign(new Error('Admin access needs 2-step verification. Turn it on in your account security settings, then try again.'), { status: 403, code: 'ADMIN_MFA_REQUIRED' });
  }
  pruneCache(mfaCache, MFA_CACHE_MS);
  mfaCache.set(sub, { ok: true, at: Date.now() });
}

async function resolveClerkUser(sub) {
  const hit = cache.get(sub);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    const cached = await User.findById(hit.id).select(SELECT).lean();
    if (cached && cached.status === 'active') {
      if (cached.role === 'admin') await assertAdminMfa(sub);
      return cached;
    }
    cache.delete(sub);
  }
  let u = await User.findOne({ clerkId: sub }).select(SELECT).lean();
  if (!u) {
    const cu = await clerk.getClerkUser(sub);
    if (!cu.email || !cu.verified) throw Object.assign(new Error('Please verify your email address in your account first.'), { status: 403, code: 'EMAIL_NOT_VERIFIED' });
    const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const byEmail = await User.findOne({ email: cu.email }).select('_id clerkId').lean();
    if (byEmail) {
      if (byEmail.clerkId && byEmail.clerkId !== sub) throw Object.assign(new Error('This email is linked to another login.'), { status: 409, code: 'EMAIL_CONFLICT' });
      await User.updateOne({ _id: byEmail._id }, { $set: { clerkId: sub } });
    } else {
      const base = (cu.username || cu.name || cu.email.split('@')[0]).toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24) || 'creator';
      try {
        await User.create({
          clerkId: sub, email: cu.email, name: cu.name || base, username: `${base}${Math.floor(Math.random() * 9000 + 1000)}`,
          avatar: cu.imageUrl, role: cu.email === adminEmail ? 'admin' : 'user', status: 'active'
        });
      } catch (e) {
        if (e && e.code === 11000) await User.updateOne({ email: cu.email, clerkId: { $in: ['', null] } }, { $set: { clerkId: sub } });
        else throw e;
      }
    }
    u = await User.findOne({ clerkId: sub }).select(SELECT).lean();
  }
  u = activeOrThrow(u);
  // Admin role follows ADMIN_EMAIL when that email is verified (never removed automatically).
  if (u.role !== 'admin' && adminEmailMatches(u.email)) {
    await User.updateOne({ _id: u._id }, { $set: { role: 'admin', adminRole: 'super' } });
    u.role = 'admin'; u.adminRole = 'super';
  }
  if (u.role === 'admin') {
    if (!u.adminRole) { await User.updateOne({ _id: u._id }, { $set: { adminRole: 'super' } }); u.adminRole = 'super'; }
    await assertAdminMfa(sub);
  }
  pruneCache(cache, CACHE_MS);
  cache.set(sub, { id: String(u._id), at: Date.now() });
  return u;
}
function adminEmailMatches(email) {
  const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  return Boolean(adminEmail) && String(email || '').toLowerCase() === adminEmail;
}

async function userFromToken(token) {
  if (!token || token.length < 20) return null;
  if (clerk.isConfigured()) {
    try {
      const payload = await clerk.verifySession(token);
      return await resolveClerkUser(payload.sub);
    } catch (e) {
      if (e.status) throw e;
      // not a Clerk token: fall through to the bot token check
    }
  }
  if (!JWT_SECRET) return null;
  try {
    const p = jwt.verify(token, JWT_SECRET);
    if (p.purpose !== 'bot') return null;
    return activeOrThrow(await User.findById(p.id).select(SELECT).lean());
  } catch (_) { return null; }
}

function setReqUser(req, u) {
  req.user = { id: String(u._id), email: u.email, role: u.role, adminRole: u.role === 'admin' ? (u.adminRole || 'super') : '', clerkId: u.clerkId || '', telegramId: u.telegramId || '' };
}

const authenticate = async (req, res, next) => {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'Please log in to continue.', code: 'NO_TOKEN' });
  try {
    const u = await userFromToken(token);
    if (!u) return res.status(401).json({ error: 'Your session has expired. Please log in again.', code: 'INVALID_SESSION' });
    setReqUser(req, u);
    next();
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message, code: e.code || 'AUTH_ERROR' });
    console.warn('auth:', e.message);
    res.status(401).json({ error: 'Your session has expired. Please log in again.', code: 'INVALID_SESSION' });
  }
};

// Public routes that still show per-user data when a session exists.
const optionalAuth = async (req, res, next) => {
  const token = bearer(req);
  if (!token) return next();
  try {
    const u = await userFromToken(token);
    if (u) setReqUser(req, u);
  } catch (_) { /* anonymous */ }
  next();
};

const authorize = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Please log in to continue.', code: 'NO_TOKEN' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have access to this.' });
  next();
};
const isAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Please log in to continue.', code: 'NO_TOKEN' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only.' });
  next();
};

// Used only by the Telegram bot process (internal, short-lived).
function signBotToken(user) {
  return jwt.sign({ purpose: 'bot', id: String(user._id), email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '10m' });
}

module.exports = authenticate;
module.exports.authenticate = authenticate;
module.exports.optionalAuth = optionalAuth;
module.exports.authorize = authorize;
module.exports.isAdmin = isAdmin;
module.exports.signBotToken = signBotToken;
module.exports.JWT_SECRET = JWT_SECRET;
