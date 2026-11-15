'use strict';
/**
 * Drop-in replacement for `require('express-rate-limit')` that keeps its counters in MongoDB.
 *
 * Why: the default store lives in the memory of one process, so every restart/deploy wipes all limits and two
 * instances would each allow the full quota. Here the counters are shared (collection `ratelimits`, auto-expired by a TTL index).
 * If MongoDB is unreachable the store falls back to in-memory counters (the old behaviour) instead of failing open,
 * so a database hiccup can never switch protection off.
 */
const mongoose = require('mongoose');
const expressRateLimit = require('express-rate-limit');

let seq = 0;

class HybridStore {
  constructor(prefix) {
    this.prefix = prefix;
    this.windowMs = 60 * 1000;
    this.mem = new Map(); // key -> { hits, resetTime }  (fallback only)
    this.indexed = false;
  }
  init(options) { this.windowMs = options.windowMs; }

  col() {
    if (mongoose.connection.readyState !== 1) return null; // not connected: use the fallback right away, never queue requests
    const c = mongoose.connection.collection('ratelimits');
    if (!this.indexed) {
      this.indexed = true;
      c.createIndex({ resetTime: 1 }, { expireAfterSeconds: 0 }).catch(() => { this.indexed = false; });
    }
    return c;
  }
  id(key) { return `${this.prefix}:${key}`; }

  memIncrement(key) {
    const now = Date.now();
    let e = this.mem.get(key);
    if (!e || e.resetTime.getTime() <= now) { e = { hits: 0, resetTime: new Date(now + this.windowMs) }; this.mem.set(key, e); }
    e.hits += 1;
    if (this.mem.size > 20000) for (const [k, v] of this.mem) if (v.resetTime.getTime() <= now) this.mem.delete(k);
    return { totalHits: e.hits, resetTime: e.resetTime };
  }

  async increment(key) {
    const c = this.col();
    if (!c) return this.memIncrement(key);
    try {
      const now = new Date();
      const fresh = new Date(now.getTime() + this.windowMs);
      const r = await c.findOneAndUpdate(
        { _id: this.id(key) },
        [{ $set: {
          hits: { $cond: [{ $gt: ['$resetTime', now] }, { $add: [{ $ifNull: ['$hits', 0] }, 1] }, 1] },
          resetTime: { $cond: [{ $gt: ['$resetTime', now] }, '$resetTime', fresh] }
        } }],
        { upsert: true, returnDocument: 'after' }
      );
      const doc = r && Object.prototype.hasOwnProperty.call(r, 'value') ? r.value : r; // driver v5 wraps the document, v6 does not
      if (!doc || typeof doc.hits !== 'number') return this.memIncrement(key);
      return { totalHits: doc.hits, resetTime: new Date(doc.resetTime) };
    } catch (_) {
      return this.memIncrement(key);
    }
  }
  async decrement(key) {
    const e = this.mem.get(key); if (e && e.hits > 0) e.hits -= 1;
    const c = this.col(); if (!c) return;
    try { await c.updateOne({ _id: this.id(key), hits: { $gt: 0 } }, { $inc: { hits: -1 } }); } catch (_) {}
  }
  async resetKey(key) {
    this.mem.delete(key);
    const c = this.col(); if (!c) return;
    try { await c.deleteOne({ _id: this.id(key) }); } catch (_) {}
  }
}

function rateLimit(options = {}) {
  const prefix = options.keyPrefix || `rl${++seq}`;
  return expressRateLimit({ ...options, store: options.store || new HybridStore(prefix) });
}
module.exports = rateLimit;
module.exports.HybridStore = HybridStore;
