'use strict';
/**
 * Optional network lock for the admin API: set ADMIN_IP_ALLOWLIST="203.0.113.5,198.51.100.7" and /api/admin answers 404 to every other address.
 * Empty (default) = no restriction. Make sure TRUST_PROXY_HOPS is right first, otherwise req.ip is the proxy's address and you would lock yourself out.
 */
const { securityAlert } = require('../utils/alerts');
function adminIpAllowlist(req, res, next) {
  const raw = String(process.env.ADMIN_IP_ALLOWLIST || '').trim();
  if (!raw) return next();
  const allowed = new Set(raw.split(',').map(s => s.trim().replace(/^::ffff:/, '')).filter(Boolean));
  const ip = String(req.ip || '').replace(/^::ffff:/, '');
  if (allowed.has(ip)) return next();
  securityAlert(req, 'Admin API request from an address that is not on ADMIN_IP_ALLOWLIST', { ip }, 'warning', 30 * 60 * 1000);
  return res.status(404).json({ error: 'Not found' });
}
module.exports = adminIpAllowlist;
