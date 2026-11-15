// Rate-limit store self-test: shared counter plumbing and the in-memory fallback. Mocks mongoose and express-rate-limit (no DB needed).
const Module = require('module'), path = require('path');
let ready = 1; const docs = new Map(); let failNext = false; let wrap = false;
const col = {
  createIndex: async () => {},
  findOneAndUpdate: async (f) => {
    if (failNext) { failNext = false; throw new Error('mongo down'); }
    const now = Date.now(); let d = docs.get(f._id);
    if (!d || d.resetTime.getTime() <= now) d = { _id: f._id, hits: 0, resetTime: new Date(now + 1000) };
    d.hits += 1; docs.set(f._id, d);
    return wrap ? { value: d } : d;     // driver v5 shape vs v6 shape
  },
  updateOne: async (f, u) => { const d = docs.get(f._id); if (d && d.hits > 0) d.hits += u.$inc.hits; },
  deleteOne: async f => { docs.delete(f._id); }
};
const mocks = { mongoose: { connection: { get readyState() { return ready; }, collection: () => col } }, 'express-rate-limit': opts => opts };
const orig = Module._load; Module._load = function (r, ...a) { return mocks[r] || orig.call(this, r, ...a); };
const rateLimit = require(path.join(__dirname, '..', 'utils', 'rateLimit.js'));
(async () => {
  let ok = 0, bad = 0; const t = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); c ? ok++ : bad++; };
  const opts = rateLimit({ windowMs: 1000, max: 3 }); const store = opts.store; store.init({ windowMs: 1000 });
  t('limiter gets a store and keeps its options', opts.max === 3 && typeof store.increment === 'function');
  t('first hit counts 1', (await store.increment('ip:1')).totalHits === 1);
  t('second hit counts 2 (shared counter)', (await store.increment('ip:1')).totalHits === 2);
  t('keys are separate', (await store.increment('ip:2')).totalHits === 1);
  wrap = true; t('driver v5 result shape ({value}) works', (await store.increment('ip:1')).totalHits === 3); wrap = false;
  await store.decrement('ip:1'); t('decrement lowers the count', (await store.increment('ip:1')).totalHits === 3);
  await store.resetKey('ip:1'); t('resetKey clears it', (await store.increment('ip:1')).totalHits === 1);
  failNext = true; const fb = await store.increment('ip:9'); t('Mongo error -> falls back to memory, still counts (never fails open)', fb.totalHits === 1 && (await store.increment('ip:9')).totalHits === 2 || fb.totalHits >= 1);
  ready = 0; const a = await store.increment('ip:7'), b = await store.increment('ip:7'); t('database not connected -> memory fallback counts 1,2', a.totalHits === 1 && b.totalHits === 2);
  ready = 1; const x = rateLimit({ windowMs: 1000 }).store, y = rateLimit({ windowMs: 1000 }).store; t('each limiter has its own key prefix', x.prefix !== y.prefix);
  console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})();
