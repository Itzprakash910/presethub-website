// Pro subscription plans. Prices (INR) can be overridden with env vars.
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : d; };

function getPlans() {
  return {
    monthly:   { id: 'monthly',   label: 'Pro Monthly',   days: 30,  price: num(process.env.PRO_PRICE_MONTHLY, 49),    badge: '' },
    quarterly: { id: 'quarterly', label: 'Pro 3 Months',  days: 90,  price: num(process.env.PRO_PRICE_QUARTERLY, 129), badge: 'Save 12%' },
    yearly:    { id: 'yearly',    label: 'Pro Yearly',    days: 365, price: num(process.env.PRO_PRICE_YEARLY, 399),    badge: 'Best value' }
  };
}

const PRO_FEATURES = [
  'Zero ads across the whole website',
  'Pro crown badge on your profile, posts and presets',
  'Bulk download up to 30 presets at once (free: 10)',
  'Priority support — your requests are reviewed first',
  'Support the creators and keep PresetHub running'
];

function isProUser(user) {
  const exp = user?.subscription?.expiry;
  return Boolean(exp && new Date(exp).getTime() > Date.now());
}

// Adds plan days on top of any remaining Pro time.
function extendedExpiry(user, days) {
  const now = new Date();
  let base = user?.subscription?.expiry ? new Date(user.subscription.expiry) : now;
  if (base < now) base = now;
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

module.exports = { getPlans, PRO_FEATURES, isProUser, extendedExpiry };
