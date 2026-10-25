/**
 * Cashfree PG routes.
 *   POST /api/payments/cashfree/create-order   buy a preset        (auth)
 *   POST /api/payments/cashfree/subscribe      buy a Pro plan      (auth)
 *   POST /api/payments/cashfree/tip            tip a creator       (auth)
 *   POST /api/payments/cashfree/webhook        Cashfree -> us      (signed, no auth)
 *   POST /api/payments/cashfree/refresh/:id    re-check an order   (owner, auth)
 *
 * Money is only ever credited after Cashfree's authenticated GET /orders/{id} says PAID
 * and the amount matches what we stored. The browser redirect and webhook body are never trusted alone.
 */
const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const cf = require('../utils/cashfree');
const { Order, Preset, User, Download, Coupon, TextPost } = require('../models');
const C = require('../utils/coupons');
const B = require('../utils/boosts');
const { getPlans } = require('../utils/plans');
const { adminAlert, securityAlert } = require('../utils/alerts');
const { createNotification } = require('../utils/notifications');
const { markOrderPaid } = require('./payments');
const { textPostLimiter } = require('../utils/security');

const router = express.Router();
const isId = v => mongoose.Types.ObjectId.isValid(v);
const PHONE_RE = /^[6-9]\d{9}$/;

function baseUrl(req) {
  const b = String(process.env.CLIENT_URL || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(b)) throw new Error('CLIENT_URL must be set (e.g. https://presethub.site).');
  return b;
}
function notifyUrl(req) {
  return `${String(process.env.API_BASE || baseUrl(req) + '/api').replace(/\/+$/, '')}/payments/cashfree/webhook`;
}
function newOrderId() {
  return `PH-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

// Uses the phone sent in this request (saved to the profile), or the saved one. Cashfree needs a 10-digit mobile.
async function resolvePhone(user, bodyPhone) {
  const sent = String(bodyPhone || '').replace(/\D/g, '').slice(-10);
  if (sent && PHONE_RE.test(sent)) {
    if (user.phone !== sent) await User.updateOne({ _id: user._id }, { $set: { phone: sent } });
    return sent;
  }
  if (user.phone && PHONE_RE.test(user.phone)) return user.phone;
  return null;
}

// Resolves an optional coupon to a server-side discount. Returns { final, list, code, couponId } or throws a 400.
async function resolveCoupon({ couponCode, kind, presetId, listRupees }) {
  const list = Math.round(Number(listRupees) * 100);
  const code = couponCode ? C.normaliseCode(couponCode) : null;
  if (couponCode && !code) throw Object.assign(new Error('Enter a valid coupon code.'), { status: 400 });
  if (!code) return { finalPaise: list, listPaise: list, code: '', couponId: null };
  const c = await Coupon.findOne({ code }).lean();
  const check = C.isUsable(c, { kind, presetId });
  if (!check.ok) throw Object.assign(new Error(check.reason), { status: 400 });
  const { finalPaise } = C.applyDiscount(list, c);
  return { finalPaise, listPaise: list, code, couponId: c._id };
}

async function startCheckout(req, res, { userId, presetId = null, kind, plan = '', recipientId = null, note = '', amountRupees, label, customerPhone, couponCode = '', boost = null }) {
  let orderId = '', couponId = null;
  try {
    if (!cf.isConfigured()) return res.status(503).json({ error: 'Cashfree is not configured yet.' });
    const user = await User.findById(userId).select('name username email phone').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    const phone = await resolvePhone(user, customerPhone);
    if (!phone) return res.status(400).json({ code: 'PHONE_REQUIRED', error: 'Please enter your 10-digit mobile number to continue.' });

    const list = Math.round(Number(amountRupees) * 100) / 100;
    if (!Number.isFinite(list) || list < 1 || list > 100000) return res.status(400).json({ error: 'Amount is outside the supported range.' });
    const priced = await resolveCoupon({ couponCode, kind, presetId, listRupees: list });
    const amount = priced.finalPaise / 100;

    orderId = newOrderId();
    // Reserve one use of the coupon atomically; released again if the checkout fails.
    if (priced.couponId) {
      const reserved = await Coupon.updateOne({ _id: priced.couponId, $or: [{ maxUses: 0 }, { $expr: { $lt: ['$usedCount', '$maxUses'] } }] }, { $inc: { usedCount: 1 } });
      if (!reserved.modifiedCount) throw Object.assign(new Error('This coupon has been fully used.'), { status: 400 });
      couponId = priced.couponId;
    }
    await Order.create({ _id: orderId, userId, presetId, kind, plan, recipientId, note: String(note || '').slice(0, 140), amount, listAmount: list, couponCode: priced.code, currency: 'INR', status: 'created', provider: 'cashfree', boostTargetType: boost?.targetType || '', boostTargetId: boost?.targetId || '', boostDays: boost?.days || 0 });

    const session = await cf.createOrder({
      orderId, amount, currency: 'INR', customerId: userId, phone, email: user.email, name: user.name || user.username,
      returnUrl: `${baseUrl(req)}/?payment_return=1&orderId=${orderId}`,
      notifyUrl: notifyUrl(req),
      note: label
    });
    if (!session.payment_session_id) throw new Error('Cashfree did not return a payment session.');
    await Order.updateOne({ _id: orderId, status: 'created' }, { $set: { paymentSessionId: session.payment_session_id, gatewayPaymentId: String(session.cf_order_id || '') } });
    res.json({ provider: 'cashfree', mode: cf.ENV(), orderId, paymentSessionId: session.payment_session_id, amount, currency: 'INR' });
  } catch (err) {
    if (couponId && !orderId) { /* not reserved yet, nothing to release */ }
    if (couponId) await Coupon.updateOne({ _id: couponId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } }).catch(() => {});
    if (err.status === 400) return res.status(400).json({ error: err.message });
    if (orderId) await Order.updateOne({ _id: orderId, status: 'created' }, { $set: { status: 'failed', failureReason: String(err.message || 'Checkout failed').slice(0, 300) } }).catch(() => {});
    console.error('Cashfree checkout error:', err.message);
    adminAlert({ type: 'payment', severity: 'warning', title: 'Cashfree checkout could not be started', fingerprint: 'cf-start-fail', details: { error: err.message, kind, orderId } });
    res.status(err.status === 400 ? 400 : 502).json({ error: 'Could not start payment. Please try again in a moment.' });
  }
}

// Authoritative sync: asks Cashfree for the order, then fulfils or marks it. Used by webhook and refresh.
async function syncOrder(order) {
  const fetched = await cf.fetchOrder(order._id);
  const st = String(fetched.order_status || '').toUpperCase();
  if (st === 'PAID') {
    if (!cf.amountMatches(order, fetched)) {
      await Order.updateOne({ _id: order._id, status: 'created' }, { $set: { status: 'suspicious', failureReason: 'Cashfree amount or currency mismatch.' } });
      adminAlert({ type: 'payment', severity: 'critical', title: 'Cashfree payment held: amount mismatch', details: { orderId: String(order._id), expectedRupees: order.amount, reportedRupees: fetched.order_amount, currency: fetched.order_currency } });
      return 'suspicious';
    }
    await markOrderPaid(order, { paymentId: String(fetched.cf_order_id || ''), utr: '', completedAt: new Date() });
    return 'paid';
  }
  if (st === 'EXPIRED' || st === 'TERMINATED' || st === 'CANCELLED') {
    await Order.updateOne({ _id: order._id, status: 'created' }, { $set: { status: st === 'EXPIRED' ? 'expired' : 'failed', failureReason: `Cashfree status: ${st}` } });
    return st.toLowerCase();
  }
  return 'created';
}

// ----- checkout endpoints -----
router.post('/create-order', auth, textPostLimiter, async (req, res) => {
  const { presetId, customerPhone } = req.body || {};
  if (!isId(presetId)) return res.status(400).json({ error: 'Invalid preset ID' });
  const preset = await Preset.findById(presetId).select('_id name price status authorId').lean();
  if (!preset || preset.status !== 'approved') return res.status(404).json({ error: 'Preset not found' });
  if (!(Number(preset.price) > 0)) return res.status(400).json({ error: 'Preset is free or has an invalid price' });
  if (String(preset.authorId) === req.user.id) return res.status(400).json({ error: 'You cannot purchase your own preset.' });
  if (await Order.exists({ presetId: preset._id, userId: req.user.id, status: 'paid' })) return res.status(400).json({ error: 'You already own this preset.' });
  return startCheckout(req, res, { userId: req.user.id, presetId: preset._id, kind: 'preset', amountRupees: preset.price, label: preset.name, customerPhone, couponCode: req.body?.couponCode });
});

router.post('/subscribe', auth, textPostLimiter, async (req, res) => {
  const plan = getPlans()[String(req.body?.plan || '')];
  if (!plan) return res.status(400).json({ error: 'Invalid subscription plan.' });
  return startCheckout(req, res, { userId: req.user.id, kind: 'subscription', plan: plan.id, amountRupees: plan.price, label: plan.label, customerPhone: req.body?.customerPhone, couponCode: req.body?.couponCode });
});

router.post('/tip', auth, textPostLimiter, async (req, res) => {
  const { recipientId, amount, note, customerPhone } = req.body || {};
  if (!isId(recipientId)) return res.status(400).json({ error: 'Invalid creator' });
  if (String(recipientId) === req.user.id) return res.status(400).json({ error: 'You cannot tip yourself.' });
  const value = Math.round(Number(amount) * 100) / 100;
  if (!(value >= 10 && value <= 500)) return res.status(400).json({ error: 'Tip must be between ₹10 and ₹500.' });
  const creator = await User.findOne({ _id: recipientId, status: 'active' }).select('name username').lean();
  if (!creator) return res.status(404).json({ error: 'Creator not found' });
  return startCheckout(req, res, { userId: req.user.id, kind: 'tip', recipientId, note, amountRupees: value, label: `Tip to ${creator.name || creator.username}`, customerPhone, couponCode: req.body?.couponCode });
});

// Boost a profile, preset or text prompt for 7, 14 or 30 days. Only the owner can boost, and the price comes from the server table.
router.post('/boost', auth, textPostLimiter, async (req, res) => {
  const { targetType, targetId, days, customerPhone, couponCode } = req.body || {};
  if (!B.TARGETS.includes(targetType)) return res.status(400).json({ error: 'Boost a profile, preset or text prompt.' });
  if (!isId(targetId)) return res.status(400).json({ error: 'Invalid item' });
  const price = B.priceFor(targetType, days);
  if (price === null) return res.status(400).json({ error: 'Choose 7, 14 or 30 days.' });
  let owner = null;
  if (targetType === 'profile') owner = targetId;
  else if (targetType === 'preset') {
    const p = await Preset.findById(targetId).select('authorId status').lean();
    if (!p || p.status !== 'approved') return res.status(404).json({ error: 'Preset not found' });
    owner = String(p.authorId);
  } else {
    const t = await TextPost.findById(targetId).select('authorId status').lean();
    if (!t || t.status !== 'approved') return res.status(404).json({ error: 'Text post not found' });
    owner = String(t.authorId);
  }
  if (owner !== req.user.id) return res.status(403).json({ error: 'You can only boost your own content.' });
  return startCheckout(req, res, { userId: req.user.id, kind: 'boost', amountRupees: price, label: `Boost ${targetType} ${days}d`, customerPhone, couponCode, boost: { targetType, targetId: String(targetId), days: Number(days) } });
});

// Preview a coupon before paying (does not reserve a use).
router.post('/coupon/check', auth, async (req, res) => {
  try {
    const { couponCode, kind, presetId, plan } = req.body || {};
    let list = 0;
    if (kind === 'preset') {
      if (!isId(presetId)) return res.status(400).json({ error: 'Invalid preset' });
      const p = await Preset.findById(presetId).select('price status').lean();
      if (!p || p.status !== 'approved') return res.status(404).json({ error: 'Preset not found' });
      list = Number(p.price || 0);
    } else if (kind === 'subscription') {
      const pl = getPlans()[String(plan || '')];
      if (!pl) return res.status(400).json({ error: 'Invalid plan' });
      list = pl.price;
    } else return res.status(400).json({ error: 'Coupons apply to presets and Pro plans.' });
    const priced = await resolveCoupon({ couponCode, kind, presetId, listRupees: list });
    res.json({ valid: true, code: priced.code, listRupees: priced.listPaise / 100, finalRupees: priced.finalPaise / 100, discountRupees: (priced.listPaise - priced.finalPaise) / 100 });
  } catch (e) {
    res.status(e.status || 400).json({ valid: false, error: e.message || 'Invalid coupon' });
  }
});

// ----- webhook (signed by Cashfree; raw body captured in server.js) -----
router.post('/webhook', async (req, res) => {
  const raw = req.rawBody ? req.rawBody.toString('utf8') : '';
  const ok = cf.verifyWebhook(raw, req.get('x-webhook-timestamp'), req.get('x-webhook-signature'));
  if (!ok) {
    securityAlert(req, 'Cashfree webhook with INVALID or stale signature (possible forgery)', { hasSignature: Boolean(req.get('x-webhook-signature')) }, 'critical');
    return res.status(401).json({ error: 'Invalid signature' });
  }
  let body = {};
  try { body = JSON.parse(raw); } catch (_) { return res.status(400).json({ error: 'Bad JSON' }); }
  const orderId = String(body?.data?.order?.order_id || '');
  if (!/^PH-[A-Z0-9-]{6,40}$/.test(orderId)) return res.status(200).json({ received: true }); // not ours; ack quietly
  const order = await Order.findOne({ _id: orderId, provider: 'cashfree' }).lean();
  if (!order) return res.status(200).json({ received: true });
  try {
    const outcome = await syncOrder(order);
    res.status(200).json({ received: true, outcome });
  } catch (e) {
    console.error('Cashfree webhook sync failed:', e.message);
    adminAlert({ type: 'payment', severity: 'critical', title: 'Cashfree webhook sync failed (Cashfree will retry)', fingerprint: 'cf-sync-fail', details: { orderId, error: e.message } });
    res.status(500).json({ error: 'Temporary error, please retry' });
  }
});

// ----- refresh (the return page calls this if the webhook is delayed) -----
async function refreshHandler(req, res) {
  const order = await Order.findById(String(req.params.orderId)).lean();
  if (!order || order.provider !== 'cashfree') return res.status(404).json({ error: 'Order not found.' });
  if (String(order.userId) !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized.' });
  try {
    const outcome = await syncOrder(order);
    const fresh = await Order.findById(order._id).lean();
    res.json({ outcome, status: fresh.status, kind: fresh.kind, presetId: fresh.presetId ? String(fresh.presetId) : null });
  } catch (e) {
    res.status(502).json({ error: 'Could not refresh payment status from Cashfree.' });
  }
}
router.post('/refresh/:orderId', auth, refreshHandler);

module.exports = router;
module.exports.refreshHandler = refreshHandler;
