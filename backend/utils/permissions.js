/**
 * Admin roles and what each role may do. Enforced on the server for every /api/admin request.
 * Roles: super (everything), operations, finance, marketing, support.
 */
const ROLE_PERMS = {
  super: ['*'],
  operations: ['view', 'users', 'moderation'],
  finance: ['view', 'refunds', 'payouts'],
  marketing: ['view', 'marketing'],
  support: ['view', 'support']
};
const ROLES = Object.keys(ROLE_PERMS);
const REFUND_SUPER_ABOVE_RUPEES = Number(process.env.REFUND_SUPER_ABOVE_RUPEES || 5000);

// Maps an admin request to the permission it needs. null = any admin may use it (read-only overview).
// Anything not listed and not a GET needs "super".
function permissionFor(method, path) {
  const p = String(path || '').split('?')[0];
  const m = String(method || 'GET').toUpperCase();
  if (p.endsWith('/admin-role')) return 'super';
  if (p === '/audit' || p.startsWith('/audit/')) return 'super';
  if (p.startsWith('/payouts')) return 'payouts';
  if (p.startsWith('/orders/') && p.endsWith('/refund')) return 'refunds';
  if (p.startsWith('/coupons') || p.startsWith('/subscriptions/grant-all') || p.startsWith('/boosts')) return m === 'GET' ? 'view' : 'marketing';
  if (p.startsWith('/subscriptions')) return 'view';
  if (p.startsWith('/reports') || p.startsWith('/texts') || /^\/presets\/[^/]+\/status$/.test(p)) return m === 'GET' ? 'view' : 'moderation';
  if (p.startsWith('/users')) {
    if (m === 'GET') return 'view';
    return /\/pro$/.test(p) ? 'marketing' : 'users';
  }
  if (p.startsWith('/presets') && m === 'GET') return 'view';
  if (p === '/overview' || p === '/system' || p === '/alerts' || p.startsWith('/alerts')) return m === 'GET' ? 'view' : 'super';
  if (m === 'GET') return 'view';
  return 'super';
}

function canUse(role, perm) {
  if (perm === null || perm === undefined) return true;
  const list = ROLE_PERMS[role] || [];
  return list.includes('*') || list.includes(perm);
}

// Refunds above the limit need the Super Admin role.
function refundNeedsSuper(amountRupees) {
  return Number(amountRupees || 0) > REFUND_SUPER_ABOVE_RUPEES;
}

module.exports = { ROLES, ROLE_PERMS, permissionFor, canUse, refundNeedsSuper, REFUND_SUPER_ABOVE_RUPEES };
