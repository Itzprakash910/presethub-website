/**
 * Coupon rules (pure). Amounts in paise. Final price is always computed on the server.
 */
const KINDS = ['preset', 'subscription', 'tip', 'all'];

function isUsable(c, { kind, presetId, now = Date.now() }) {
  if (!c || !c.active) return { ok: false, reason: 'This coupon is not active.' };
  if (c.validFrom && now < new Date(c.validFrom).getTime()) return { ok: false, reason: 'This coupon is not valid yet.' };
  if (c.validUntil && now > new Date(c.validUntil).getTime()) return { ok: false, reason: 'This coupon has expired.' };
  if (c.maxUses > 0 && c.usedCount >= c.maxUses) return { ok: false, reason: 'This coupon has been fully used.' };
  if (c.appliesTo !== 'all' && c.appliesTo !== kind) return { ok: false, reason: 'This coupon does not apply to this purchase.' };
  if (c.presetId && String(c.presetId) !== String(presetId || '')) return { ok: false, reason: 'This coupon is for a different preset.' };
  return { ok: true };
}

// Returns { finalPaise, discountPaise }. Never below ₹1 and never above the list price.
function applyDiscount(listPaise, c) {
  const list = Math.round(Number(listPaise));
  let discount = c.type === 'percent'
    ? Math.floor(list * Math.min(100, Math.max(0, Number(c.value))) / 100)
    : Math.round(Number(c.value) * 100);
  discount = Math.max(0, Math.min(discount, list - 100));
  return { finalPaise: list - discount, discountPaise: discount };
}

function normaliseCode(v) {
  const s = String(v || '').trim().toUpperCase();
  return /^[A-Z0-9_-]{3,32}$/.test(s) ? s : null;
}

module.exports = { KINDS, isUsable, applyDiscount, normaliseCode };
