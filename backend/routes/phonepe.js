const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const phonepe = require('../utils/phonepe');
const { Order, Preset, User } = require('../models');
const { getPlans } = require('../utils/plans');
const { adminAlert, securityAlert } = require('../utils/alerts');
const { markOrderPaid } = require('./payments');
const { textPostLimiter } = require('../utils/security');

const router = express.Router();
const isId = v => mongoose.Types.ObjectId.isValid(v);
const site = () => {
  const url = String(process.env.CLIENT_URL || 'https://presethub.site').replace(/\/+$/, '');
  if (!/^https:\/\//i.test(url)) throw new Error('CLIENT_URL must be HTTPS.');
  return url;
};
const makeId = () => `PH-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;

async function start(req, res, { kind, presetId = null, plan = '', recipientId = null, note = '', amountRupees, label = '' }) {
  let orderId = '';
  try {
    if (!phonepe.isConfigured()) return res.status(503).json({ error: 'PhonePe is not configured.' });
    const paise = Math.round(Number(amountRupees) * 100);
    if (!Number.isSafeInteger(paise) || paise < 100 || paise > 100000000) return res.status(400).json({ error: 'Invalid payment amount.' });

    const pending = await Order.findOne({
      userId: req.user.id, provider: 'phonepe', status: 'created', kind,
      ...(presetId ? { presetId } : {}),
      ...(plan ? { plan } : {}),
      ...(recipientId ? { recipientId } : {}),
      createdAt: { $gte: new Date(Date.now() - 4 * 60 * 1000) },
      checkoutUrl: { $type: 'string', $ne: '' }
    }).sort({ createdAt: -1 }).lean();
    if (pending) return res.json({ provider: 'phonepe', orderId: String(pending._id), checkoutUrl: pending.checkoutUrl, amount: pending.amount, currency: 'INR', reused: true });

    orderId = makeId();
    await Order.create({
      _id: orderId, userId: req.user.id, presetId, kind, plan, recipientId,
      note: String(note || '').slice(0, 140), amount: paise / 100, currency: 'INR',
      status: 'created', provider: 'phonepe'
    });
    const session = await phonepe.createPayment({
      orderId, amountPaise: paise,
      redirectUrl: `${site()}/?payment_return=1&orderId=${encodeURIComponent(orderId)}`
    });
    await Order.updateOne({ _id: orderId, status: 'created' }, {
      $set: { checkoutUrl: session.redirectUrl, gatewayPaymentId: String(session.orderId || orderId) }
    });
    return res.json({ provider: 'phonepe', orderId, checkoutUrl: session.redirectUrl, amount: paise / 100, currency: 'INR', mode: phonepe.ENV() });
  } catch (e) {
    if (orderId) await Order.updateOne({ _id: orderId, status: 'created' }, { $set: { status: 'failed', failureReason: String(e.message).slice(0, 300) } }).catch(() => {});
    console.error('PhonePe checkout error:', e.message);
    adminAlert({ type: 'payment', severity: 'warning', title: 'PhonePe checkout could not be started', fingerprint: 'phonepe-start-fail', details: { orderId, error: e.message } });
    return res.status(502).json({ error: 'Could not start PhonePe payment. Please try again.' });
  }
}

async function sync(order) {
  const remote = await phonepe.fetchOrder(String(order._id));
  const state = String(remote.state || remote.status || '').toUpperCase();
  if (state === 'COMPLETED') {
    if (!phonepe.amountMatches(order, remote)) {
      await Order.updateOne({ _id: order._id, provider: 'phonepe', status: 'created' }, { $set: { status: 'suspicious', failureReason: 'PhonePe amount/currency mismatch.' } });
      adminAlert({ type: 'payment', severity: 'critical', title: 'PhonePe payment held: amount mismatch', details: { orderId: String(order._id), expected: order.amount, received: remote.amount } });
      return 'suspicious';
    }
    const detail = Array.isArray(remote.paymentDetails) ? remote.paymentDetails.find(x => String(x.state).toUpperCase() === 'COMPLETED') : null;
    await markOrderPaid(order, { paymentId: String(detail?.transactionId || remote.orderId || order._id), utr: String(detail?.utr || ''), completedAt: detail?.timestamp ? new Date(Number(detail.timestamp)).toISOString() : new Date().toISOString() });
    return 'paid';
  }
  if (['FAILED', 'EXPIRED', 'CANCELLED'].includes(state)) {
    await Order.updateOne({ _id: order._id, provider: 'phonepe', status: 'created' }, { $set: { status: state.toLowerCase(), failureReason: `PhonePe status: ${state}` } });
    return state.toLowerCase();
  }
  return 'created';
}

router.post('/create-order', auth, textPostLimiter, async (req, res) => {
  const { presetId } = req.body || {};
  if (!isId(presetId)) return res.status(400).json({ error: 'Invalid preset ID.' });
  const preset = await Preset.findById(presetId).select('_id name price status authorId').lean();
  if (!preset || preset.status !== 'approved') return res.status(404).json({ error: 'Preset not found.' });
  if (!(Number(preset.price) > 0)) return res.status(400).json({ error: 'Preset is free or has an invalid price.' });
  if (String(preset.authorId) === req.user.id) return res.status(400).json({ error: 'You cannot purchase your own preset.' });
  if (await Order.exists({ presetId: preset._id, userId: req.user.id, status: 'paid' })) return res.status(400).json({ error: 'You already own this preset.' });
  return start(req, res, { kind: 'preset', presetId: preset._id, amountRupees: preset.price, label: preset.name });
});

router.post('/subscribe', auth, textPostLimiter, async (req, res) => {
  const plan = getPlans()[String(req.body?.plan || '')];
  if (!plan) return res.status(400).json({ error: 'Invalid subscription plan.' });
  return start(req, res, { kind: 'subscription', plan: plan.id, amountRupees: plan.price, label: plan.label });
});

router.post('/tip', auth, textPostLimiter, async (req, res) => {
  const { recipientId, amount, note } = req.body || {};
  if (!isId(recipientId) || String(recipientId) === req.user.id) return res.status(400).json({ error: 'Invalid creator.' });
  const value = Math.round(Number(amount) * 100) / 100;
  if (!(value >= 10 && value <= 500)) return res.status(400).json({ error: 'Tip must be between ₹10 and ₹500.' });
  const creator = await User.findOne({ _id: recipientId, status: 'active' }).select('name username').lean();
  if (!creator) return res.status(404).json({ error: 'Creator not found.' });
  return start(req, res, { kind: 'tip', recipientId, amountRupees: value, note, label: `Tip to ${creator.name || creator.username}` });
});

router.post('/webhook', async (req, res) => {
  if (!phonepe.verifyWebhook(req)) {
    securityAlert(req, 'PhonePe webhook with invalid Basic authentication', {}, 'critical');
    return res.status(401).json({ error: 'Invalid webhook authentication.' });
  }
  const payload = req.body || {};
  const orderId = String(payload.merchantOrderId || payload.payload?.merchantOrderId || payload.orderId || '');
  if (!orderId.startsWith('PH-')) return res.status(200).json({ received: true });
  const order = await Order.findOne({ _id: orderId, provider: 'phonepe' }).lean();
  if (!order) return res.status(200).json({ received: true });
  try {
    // Do not trust webhook status or amount alone; fetch authoritative order status from PhonePe.
    const outcome = await sync(order);
    return res.status(200).json({ received: true, outcome });
  } catch (e) {
    console.error('PhonePe webhook sync error:', e.message);
    adminAlert({ type: 'payment', severity: 'critical', title: 'PhonePe webhook sync failed', fingerprint: 'phonepe-webhook-fail', details: { orderId, error: e.message } });
    return res.status(500).json({ error: 'Temporary error. Please retry.' });
  }
});

router.post('/refresh/:orderId', auth, async (req, res) => {
  const order = await Order.findOne({ _id: String(req.params.orderId), provider: 'phonepe' }).lean();
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (String(order.userId) !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized.' });
  try {
    const outcome = await sync(order);
    const fresh = await Order.findById(order._id).lean();
    return res.json({ outcome, status: fresh.status, kind: fresh.kind, presetId: fresh.presetId ? String(fresh.presetId) : null });
  } catch (e) { return res.status(502).json({ error: 'Could not refresh PhonePe payment status.' }); }
});

module.exports = router;
