/**
 * Boost rules (pure). A boost makes a profile, preset or text prompt appear first for its duration.
 * Prices are in whole rupees. Days must be one of the listed options.
 */
const TARGETS = ['profile', 'preset', 'text'];
const PRICES = {
  profile: { 7: 99, 14: 179, 30: 299 },
  preset: { 7: 49, 14: 89, 30: 149 },
  text: { 7: 29, 14: 49, 30: 89 }
};
const DAY = 24 * 60 * 60 * 1000;

function priceFor(targetType, days) {
  const table = PRICES[targetType];
  if (!table) return null;
  const d = Number(days);
  return Object.prototype.hasOwnProperty.call(table, d) ? table[d] : null;
}

function boostWindow(from, days) {
  const start = new Date(from);
  return { startsAt: start, endsAt: new Date(start.getTime() + Number(days) * DAY) };
}

function isBoostedNow(boostUntil, now = Date.now()) {
  return Boolean(boostUntil && new Date(boostUntil).getTime() > now);
}

// Extending while a boost is still running adds the new days on top of the remaining time.
function nextBoostEnd(currentEnd, days, now = Date.now()) {
  const base = currentEnd && new Date(currentEnd).getTime() > now ? new Date(currentEnd).getTime() : now;
  return new Date(base + Number(days) * DAY);
}

module.exports = { TARGETS, PRICES, priceFor, boostWindow, isBoostedNow, nextBoostEnd };
