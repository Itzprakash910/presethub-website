/**
 * Tiny in-memory "seen recently" helper, used to stop one visitor from inflating counters
 * (views, impressions) by calling an open endpoint in a loop. Resets on restart, which is fine for counters.
 */
const seen = new Map();
function seenRecently(key, ttlMs = 30 * 60 * 1000) {
  const now = Date.now();
  const t = seen.get(key);
  if (t && now - t < ttlMs) return true;
  seen.set(key, now);
  if (seen.size > 20000) for (const [k, v] of seen) if (now - v >= ttlMs) seen.delete(k);
  if (seen.size > 40000) seen.clear();
  return false;
}
module.exports = { seenRecently };
