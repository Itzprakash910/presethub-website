// Coupon self-test: one paid use per account AND no second open checkout with the same coupon (two-tab race). No database needed.
const Module = require('module'), path = require('path');
const open = [];            // unpaid orders
const paid = [];            // paid orders
const mk = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : mk()), apply: () => mk(), construct: () => mk() });
const Router = () => { const r = { routes: {} }; for (const m of ['get', 'post', 'put', 'delete']) r[m] = (p, ...h) => { r.routes[m + ' ' + (typeof p === 'string' ? p : '*')] = h; return r; }; return r; };
const Order = { exists: async f => {
  if (f.status === 'paid') return paid.some(o => o.userId === f.userId && o.couponCode === f.couponCode);
  if (f.status === 'created') return open.some(o => o.userId === f.userId && o.couponCode === f.couponCode && o.createdAt > f.createdAt.$gt &&
    (o.kind !== f.$or[0].kind.$ne || String(o.presetId || null) !== String(f.$or[1].presetId.$ne)));
  return false; } };
const mocks = { express: { Router }, mongoose: { Types: { ObjectId: { isValid: () => true } } },
  '../models': new Proxy({ Order, Coupon: { findOne: () => ({ lean: async () => ({ _id: 'c1', code: 'SAVE10' }) }) } }, { get: (t, k) => t[k] || mk() }),
  '../utils/coupons': { normaliseCode: c => String(c).toUpperCase(), isUsable: () => ({ ok: true }), applyDiscount: l => ({ finalPaise: Math.round(l * 0.9) }) },
  '../middleware/auth': (q, s, n) => n() };
const orig = Module._load;
Module._load = function (r, p, ...a) { if (mocks[r]) return mocks[r]; try { return orig.call(this, r, p, ...a); } catch (e) { if (/cashfree\.js$/.test(r)) throw e; return mk(); } };
const cf = require(path.join(__dirname, '..', 'routes', 'cashfree.js'));
(async () => {
  let ok = 0, bad = 0; const t = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); c ? ok++ : bad++; };
  const rc = (extra = {}) => cf.resolveCoupon({ couponCode: 'save10', kind: 'preset', presetId: 'p1', listRupees: 100, userId: 'u1', ...extra });
  t('fresh coupon is accepted', (await rc()).finalPaise === 9000);
  open.push({ userId: 'u1', couponCode: 'SAVE10', kind: 'preset', presetId: 'p1', createdAt: new Date() });
  t('retry of the SAME preset is not blocked by its own open order', (await rc()).finalPaise === 9000);
  let err = null; try { await rc({ presetId: 'p2' }); } catch (e) { err = e; }
  t('different preset while another checkout is open -> 400', err && err.status === 400 && /open checkout/i.test(err.message));
  err = null; try { await rc({ userId: 'u2', presetId: 'p2' }); } catch (e) { err = e; }
  t('another user is unaffected', !err);
  open[0].createdAt = new Date(Date.now() - 31 * 60 * 1000);
  err = null; try { await rc({ presetId: 'p2' }); } catch (e) { err = e; }
  t('open order older than 30 min no longer blocks', !err);
  paid.push({ userId: 'u1', couponCode: 'SAVE10' });
  err = null; try { await rc(); } catch (e) { err = e; }
  t('already paid once -> 400', err && /already used/i.test(err.message));
  console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
