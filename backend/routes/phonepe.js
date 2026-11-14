/**
 * PhonePe PG routes (Standard Checkout v2). Same endpoints and safety rules as the Cashfree router:
 *   POST /api/payments/phonepe/create-order | subscribe | tip | boost   (auth)   -> { redirectUrl, orderId }
 *   POST /api/payments/phonepe/webhook                                  (PhonePe -> us, Authorization header)
 *   POST /api/payments/phonepe/refresh/:id                              (owner; return page calls it if webhook is late)
 *
 * The browser redirect and the webhook body are never trusted: an order is fulfilled only when PhonePe's authenticated
 * order-status API says COMPLETED and the amount matches what we stored.
 */
const express = require('express');
const auth = require('../middleware/auth');
const pp = require('../utils/phonepe');
const { Order, User, Coupon } = require('../models');
const cashfreeRoutes = require('./cashfree');
const { adminAlert, securityAlert } = require('../utils/alerts');
const { markOrderPaid } = require('./payments');

const router = express.Router();
const ORDER_ID_RE = /^PH-[A-Z0-9-]{6,40}$/;
const OPEN_ORDER_REUSE_MS = 10 * 60 * 1000;
const EXPIRE_AFTER_SECONDS = 30 * 60;

async function startCheckout(req, res, { userId, presetId = null, kind, plan = '', recipientId = null, note = '', amountRupees, label, couponCode = '', boost = null }) {
  let orderId = '', couponId = null;
  try {
    if (!pp.isConfigured()) return res.status(503).json({ error: 'PhonePe is not configured yet.' });
    const user = await User.findById(userId).select('_id').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Same user opening checkout twice for the same preset (two tabs / double click): return the open order, do not create another.
    if (kind === 'preset' && presetId) {
      const open = await Order.findOne({ userId, presetId, kind: 'preset', provider: 'phonepe', status: 'created', checkoutUrl: { $type: 'string', $ne: '' }, createdAt: { $gt: new Date(Date.now() - OPEN_ORDER_REUSE_MS) } }).sort({ createdAt: -1 }).lean();
      if (open && String(open.couponCode || '') === String(couponCode || '').trim().toUpperCase()) {
        return res.json({ provider: 'phonepe', mode: pp.ENV(), orderId: String(open._id), redirectUrl: open.checkoutUrl, amount: open.amount, currency: 'INR', reused: true });
      }
    }

    const list = Math.round(Number(amountRupees) * 100) / 100;
    if (!Number.isFinite(list) || list < 1 || list > 100000) return res.status(400).json({ error: 'Amount is outside the supported range.' });
    const priced = await cashfreeRoutes.resolveCoupon({ couponCode, kind, presetId, listRupees: list, userId });
    const amount = priced.finalPaise / 100;
    if (priced.finalPaise < 100) return res.status(400).json({ error: 'Amount is outside the supported range.' });

    orderId = cashfreeRoutes.newOrderId();
    if (priced.couponId) {
      const reserved = await Coupon.updateOne({ _id: priced.couponId, $or: [{ maxUses: 0 }, { $expr: { $lt: ['$usedCount', '$maxUses'] } }] }, { $inc: { usedCount: 1 } });
      if (!reserved.modifiedCount) throw Object.assign(new Error('This coupon has been fully used.'), { status: 400 });
      couponId = priced.couponId;
    }
    await Order.create({ _id: orderId, userId, presetId, kind, plan, recipientId, note: String(note || '').slice(0, 140), amount, listAmount: list, couponCode: priced.code, currency: 'INR', status: 'created', provider: 'phonepe', boostTargetType: boost?.targetType || '', boostTargetId: boost?.targetId || '', boostDays: boost?.days || 0 });

    const session = await pp.createPayment({
      merchantOrderId: orderId,
      amountPaise: priced.finalPaise,
      redirectUrl: `${cashfreeRoutes.baseUrl(req)}/?payment_return=1&orderId=${orderId}`,
      message: label,
      expireAfterSeconds: EXPIRE_AFTER_SECONDS,
      udf1: kind
    });
    if (!session.redirectUrl || !/^https:\/\//i.test(session.redirectUrl)) throw new Error('PhonePe did not return a checkout URL.');
    await Order.updateOne({ _id: orderId, status: 'created' }, { $set: { checkoutUrl: session.redirectUrl, gatewayPaymentId: String(session.orderId || '') } });
    res.json({ provider: 'phonepe', mode: pp.ENV(), orderId, redirectUrl: session.redirectUrl, amount, currency: 'INR' });
  } catch (err) {
    if (couponId) await Coupon.updateOne({ _id: couponId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } }).catch(() => {});
    if (err.status === 400 && !orderId) return res.status(400).json({ error: err.message });
    if (err.status === 400 && orderId && /coupon/i.test(err.message)) return res.status(400).json({ error: err.message });
    if (orderId) await Order.updateOne({ _id: orderId, status: 'created' }, { $set: { status: 'failed', failureReason: String(err.message || 'Checkout failed').slice(0, 300) } }).catch(() => {});
    console.error('PhonePe checkout error:', err.message);
    adminAlert({ type: 'payment', severity: 'warning', title: 'PhonePe checkout could not be started', fingerprint: 'pp-start-fail', details: { error: err.message, kind, orderId } });
    res.status(502).json({ error: 'Could not start payment. Please try again in a moment.' });
  }
}

cashfreeRoutes.registerCheckoutRoutes(router, startCheckout);

// Authoritative sync: asks PhonePe for the order status, then fulfils or marks it.
async function syncOrder(order) {
  const st = await pp.fetchStatus(order._id);
  const state = String(st.state || '').toUpperCase();
  if (state === 'COMPLETED') {
    if (!pp.amountMatches(order, st)) {
      await Order.updateOne({ _id: order._id, status: 'created' }, { $set: { status: 'suspicious', failureReason: 'PhonePe amount mismatch.' } });
      adminAlert({ type: 'payment', severity: 'critical', title: 'PhonePe payment held: amount mismatch', details: { orderId: String(order._id), expectedRupees: order.amount, reportedPaise: st.amount } });
      return 'suspicious';
    }
    const detail = Array.isArray(st.paymentDetails) ? st.paymentDetails.find(d => String(d.state || '').toUpperCase() === 'COMPLETED') || st.paymentDetails[0] : null;
    await markOrderPaid(order, { paymentId: String(detail?.transactionId || st.orderId || ''), utr: String(detail?.rail?.utr || ''), completedAt: new Date() });
    return 'paid';
  }
  if (state === 'FAILED') {
    const closed = await Order.updateOne({ _id: order._id, status: 'created' }, { $set: { status: 'failed', failureReason: 'PhonePe status: FAILED' } });
    if (closed.modifiedCount) await cashfreeRoutes.releaseCoupon(order);
    return 'failed';
  }
  return 'created'; // PENDING
}

router.post('/webhook', async (req, res) => {
  if (!pp.verifyWebhookAuth(req.get('authorization'))) {
    securityAlert(req, 'PhonePe webhook with INVALID or missing authorization (possible forgery)', { hasHeader: Boolean(req.get('authorization')), configured: Boolean(pp.expectedWebhookAuth()) }, 'critical');
    return res.status(401).json({ error: 'Invalid authorization' });
  }
  const body = req.body || {};
  const orderId = String(body?.payload?.merchantOrderId || body?.payload?.originalMerchantOrderId || '');
  if (!ORDER_ID_RE.test(orderId)) return res.status(200).json({ received: true });
  const order = await Order.findOne({ _id: orderId, provider: 'phonepe' }).lean();
  if (!order) return res.status(200).json({ received: true });
  try {
    const outcome = await syncOrder(order);
    res.status(200).json({ received: true, outcome });
  } catch (e) {
    console.error('PhonePe webhook sync failed:', e.message);
    adminAlert({ type: 'payment', severity: 'critical', title: 'PhonePe webhook sync failed (PhonePe will retry)', fingerprint: 'pp-sync-fail', details: { orderId, error: e.message } });
    res.status(500).json({ error: 'Temporary error, please retry' });
  }
});

async function refreshHandler(req, res) {
  const order = await Order.findById(String(req.params.orderId)).lean();
  if (!order || order.provider !== 'phonepe') return res.status(404).json({ error: 'Order not found.' });
  if (String(order.userId) !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized.' });
  try {
    const outcome = await syncOrder(order);
    const fresh = await Order.findById(order._id).lean();
    res.json({ outcome, status: fresh.status, kind: fresh.kind, presetId: fresh.presetId ? String(fresh.presetId) : null });
  } catch (e) {
    res.status(502).json({ error: 'Could not refresh payment status from PhonePe.' });
  }
}
router.post('/refresh/:orderId', auth, refreshHandler);

// Checkouts expire after 30 minutes; after 45 minutes ask PhonePe about orders still "created" and close them (releases coupons).
async function sweepStaleOrders(limit = 25) {
  if (!pp.isConfigured()) return 0;
  const stale = await Order.find({ provider: 'phonepe', status: 'created', createdAt: { $lt: new Date(Date.now() - 45 * 60 * 1000) } }).sort({ createdAt: 1 }).limit(limit).lean();
  let n = 0;
  for (const o of stale) {
    try {
      const outcome = await syncOrder(o);
      if (outcome === 'created') { // still PENDING after expiry: treat as expired
        const closed = await Order.updateOne({ _id: o._id, status: 'created' }, { $set: { status: 'expired', failureReason: 'PhonePe checkout expired' } });
        if (closed.modifiedCount) await cashfreeRoutes.releaseCoupon(o);
      }
      n++;
    } catch (e) { console.warn('PhonePe stale order sweep failed:', o._id, e.message); }
  }
  return n;
}

module.exports = router;
module.exports.refreshHandler = refreshHandler;
module.exports.sweepStaleOrders = sweepStaleOrders;
