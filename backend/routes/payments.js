const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const { Order, Preset, User } = require('../models');
const { getPlans, PRO_FEATURES, isProUser, extendedExpiry } = require('../utils/plans');
const { adminAlert, securityAlert } = require('../utils/alerts');
const { createNotification } = require('../utils/notifications');

const router = express.Router();

const YOUPI_API_URL = String(process.env.YOUPI_API_URL || process.env.BASE_PAYMENT_API_URL || '').trim().replace(/\/+$/, '');
const YOUPI_MERCHANT_ID = String(process.env.YOUPI_MERCHANT_ID || '').trim();
const YOUPI_API_KEY = String(process.env.YOUPI_API_KEY || '').trim();
const YOUPI_WEBHOOK_SECRET = String(process.env.YOUPI_WEBHOOK_SECRET || '').trim();
const YOUPI_MERCHANT_KEY = YOUPI_API_KEY || YOUPI_WEBHOOK_SECRET;

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && process.env.NODE_ENV !== 'production');
  } catch (_) {
    return false;
  }
}

const YOUPI_CONFIGURED = Boolean(
  YOUPI_API_URL && isHttpUrl(YOUPI_API_URL) && YOUPI_MERCHANT_ID && YOUPI_MERCHANT_KEY && YOUPI_WEBHOOK_SECRET
);

function activeProvider() {
  if (require('../utils/cashfree').isConfigured()) return 'cashfree';
  return YOUPI_CONFIGURED ? 'youpi' : 'disabled';
}

const ensureYoupi = (req, res, next) =>
  YOUPI_CONFIGURED
    ? next()
    : res.status(503).json({ error: 'YOUPI PG is not configured. Set YOUPI_API_URL, YOUPI_MERCHANT_ID and YOUPI_WEBHOOK_SECRET.' });

function timingSafeStringEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function publicOrder(order) {
  if (!order) return null;
  return {
    id: String(order._id),
    presetId: order.presetId ? String(order.presetId) : null,
    kind: order.kind || 'preset',
    plan: order.plan || undefined,
    amount: Number(order.amount),
    currency: order.currency || 'INR',
    status: order.status,
    provider: order.provider || 'youpi',
    paymentId: order.paymentId || undefined,
    utr: order.utr || undefined,
    paidAt: order.paidAt || undefined,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  };
}

function makeYoupiReturnUrl(req, orderId) {
  let base = String(process.env.CLIENT_URL || '').trim().replace(/\/+$/, '');
  if (!base) base = `${req.protocol}://${req.get('host')}`;
  if (!isHttpUrl(base)) throw new Error('CLIENT_URL must be a valid HTTPS URL in production.');
  const url = new URL('/', base);
  url.searchParams.set('payment_return', '1');
  url.searchParams.set('orderId', orderId);
  return url.toString();
}

async function callYoupi(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Merchant-Id': YOUPI_MERCHANT_ID,
    'X-Merchant-Key': YOUPI_MERCHANT_KEY,
    ...(options.headers || {})
  };
  const response = await fetch(`${YOUPI_API_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(12000),
    redirect: 'error'
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) {
    throw new Error(`YOUPI PG returned a non-JSON response (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const message = String(data.error || data.message || `YOUPI PG request failed (HTTP ${response.status}).`).slice(0, 350);
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

function amountMatches(order, payload) {
  const expectedPaise = Math.round(Number(order.amount) * 100);
  const reportedPaise = Number(payload.amountPaise);
  return Number.isSafeInteger(reportedPaise) && reportedPaise === expectedPaise &&
    String(payload.currency || '').toUpperCase() === String(order.currency || 'INR').toUpperCase();
}

async function activateSubscription(order) {
  const plans = getPlans();
  const plan = plans[order.plan];
  if (!plan) return;
  const user = await User.findById(order.userId).select('subscription name email');
  if (!user) return;
  const expiry = extendedExpiry(user, plan.days);
  await User.updateOne({ _id: user._id }, {
    $set: {
      'subscription.tier': 'pro', 'subscription.plan': plan.id, 'subscription.expiry': expiry,
      'subscription.since': user.subscription?.since || new Date(), 'subscription.lastOrderId': String(order._id)
    }
  });
  await createNotification(user._id, 'subscription', `👑 PresetHub Pro is active until ${expiry.toLocaleDateString('en-IN')}. Ads are now removed — enjoy!`, '/', '👑 Welcome to Pro');
  adminAlert({
    type: 'subscription', severity: 'info', title: `New Pro subscription: ${plan.label}`,
    details: { user: user.name || user.email, email: user.email, plan: plan.id, amount: `₹${order.amount}`, expiry: expiry.toISOString(), orderId: String(order._id) }, email: false
  });
}

async function markOrderPaid(order, payload) {
  const result = await Order.updateOne(
    { _id: order._id, provider: { $in: ['youpi', 'cashfree'] }, status: 'created' },
    {
      $set: {
        status: 'paid',
        paymentId: String(payload.paymentId || order.gatewayPaymentId || ''),
        gatewayPaymentId: String(payload.paymentId || order.gatewayPaymentId || ''),
        utr: String(payload.utr || '').slice(0, 80),
        paidAt: payload.completedAt && Number.isFinite(Date.parse(payload.completedAt)) ? new Date(payload.completedAt) : new Date()
      },
      $unset: { failureReason: '' }
    }
  );
  // Atomic transition created -> paid: webhook retries / status refresh can never double-fulfil.
  if (result.modifiedCount) {
    if (order.kind === 'subscription') {
      await activateSubscription(order);
    } else if (order.kind === 'tip') {
      await User.updateOne({ _id: order.recipientId }, { $inc: { tipsTotal: order.amount } });
      const tipper = await User.findById(order.userId).select('name username').lean();
      await createNotification(order.recipientId, 'tip', `💝 ${tipper?.name || tipper?.username || 'A fan'} tipped you ₹${order.amount}${order.note ? ` — “${order.note}”` : ''}.`, '/', 'New tip');
      adminAlert({ type: 'payment', severity: 'info', title: `Tip ₹${order.amount}`, details: { orderId: String(order._id), creatorId: String(order.recipientId) }, email: false });
    } else if (order.presetId) {
      await Preset.updateOne({ _id: order.presetId }, { $inc: { totalRevenue: order.amount } });
      const preset = await Preset.findById(order.presetId).select('name authorId').lean();
      if (preset) await createNotification(preset.authorId, 'sale', `💰 Someone purchased your preset “${preset.name}” for ₹${order.amount}.`, `/preset/${order.presetId}/`, 'New sale');
      adminAlert({ type: 'payment', severity: 'info', title: `Preset sale ₹${order.amount}`, details: { orderId: String(order._id), preset: preset?.name || String(order.presetId), utr: payload.utr || '' }, email: false });
    }
  }
  return result.modifiedCount > 0;
}

async function applyYoupiOutcome(order, payload) {
  const event = String(payload.event || payload.status || '').toUpperCase();
  if (String(payload.orderId || '') !== String(order._id)) {
    await Order.updateOne(
      { _id: order._id, provider: { $in: ['youpi', 'cashfree'] }, status: 'created' },
      { $set: { status: 'suspicious', failureReason: 'Gateway order ID mismatch.' } }
    );
    adminAlert({ type: 'payment', severity: 'critical', title: 'Payment held: gateway order ID mismatch', details: { orderId: String(order._id), reported: String(payload.orderId || '') } });
    return { accepted: false, reviewRequired: true, reason: 'Order ID mismatch.' };
  }
  if (!amountMatches(order, payload)) {
    await Order.updateOne(
      { _id: order._id, provider: { $in: ['youpi', 'cashfree'] }, status: 'created' },
      { $set: { status: 'suspicious', failureReason: 'Gateway amount or currency mismatch.' } }
    );
    adminAlert({ type: 'payment', severity: 'critical', title: 'Payment held: amount/currency mismatch', details: { orderId: String(order._id), expectedPaise: Math.round(Number(order.amount) * 100), reportedPaise: payload.amountPaise, currency: payload.currency } });
    return { accepted: false, reviewRequired: true, reason: 'Amount or currency mismatch.' };
  }

  if (event === 'SUCCESS') {
    if (!payload.paymentId && !order.gatewayPaymentId) {
      await Order.updateOne(
        { _id: order._id, provider: { $in: ['youpi', 'cashfree'] }, status: 'created' },
        { $set: { status: 'suspicious', failureReason: 'Gateway success has no payment ID.' } }
      );
      return { accepted: false, reviewRequired: true, reason: 'Missing payment ID.' };
    }
    const changed = await markOrderPaid(order, payload);
    return { accepted: true, alreadyProcessed: !changed };
  }

  const statusMap = {
    FAILED: 'failed',
    EXPIRED: 'expired',
    CANCELLED: 'cancelled',
    SUSPICIOUS: 'suspicious',
    BLOCKED: 'suspicious'
  };
  const nextStatus = statusMap[event];
  if (nextStatus) {
    await Order.updateOne(
      { _id: order._id, provider: { $in: ['youpi', 'cashfree'] }, status: 'created' },
      { $set: { status: nextStatus, failureReason: `YOUPI PG outcome: ${event}` } }
    );
  }
  return { accepted: true, status: nextStatus || order.status || 'created' };
}

// Public, non-sensitive configuration. No gateway keys/secrets are exposed.
router.get('/provider', (req, res) => {
  const provider = activeProvider();
  res.json({ provider, enabled: provider !== 'disabled', mode: provider === 'cashfree' ? require('../utils/cashfree').ENV() : undefined });
});

// Public Pro plans (prices are decided server-side only).
router.get('/plans', (req, res) => {
  res.json({ enabled: activeProvider() !== 'disabled', currency: 'INR', plans: Object.values(getPlans()), features: PRO_FEATURES });
});

// ============ YOUPI PG ============
// Creates a local order + YOUPI session. All amounts come from the database / server plan table,
// never from the browser.
async function startYoupiCheckout(req, res, { userId, presetId = null, kind, plan = '', amountRupees, label, recipientId = null, note = '' }) {
  let orderId = '';
  try {
    const amountPaise = Math.round(Number(amountRupees) * 100);
    if (!Number.isSafeInteger(amountPaise) || amountPaise < 100 || amountPaise > 100000000)
      return res.status(400).json({ error: 'Amount is outside the supported payment range.' });

    // Reuse a recent still-pending checkout so repeated clicks do not create many sessions.
    const pendingFilter = { userId, provider: { $in: ['youpi', 'cashfree'] }, status: 'created', kind, checkoutUrl: { $type: 'string', $ne: '' }, createdAt: { $gte: new Date(Date.now() - 4 * 60 * 1000) } };
    if (kind === 'preset') pendingFilter.presetId = presetId; else if (kind === 'tip') { pendingFilter.recipientId = recipientId; pendingFilter.amount = Math.round(Number(amountRupees) * 100) / 100; } else pendingFilter.plan = plan;
    const pending = await Order.findOne(pendingFilter).sort({ createdAt: -1 }).lean();
    if (pending) return res.json({ provider: 'youpi', orderId: String(pending._id), checkoutUrl: pending.checkoutUrl, amount: pending.amount, currency: pending.currency, reused: true });

    orderId = `PH-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    await Order.create({ _id: orderId, userId, presetId, kind, plan, recipientId, note: String(note || '').slice(0, 140), amount: amountPaise / 100, currency: 'INR', status: 'created', provider: 'youpi' });

    const payment = await callYoupi('/api/v1/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': `presethub-${orderId}` },
      body: {
        orderId, amount: (amountPaise / 100).toFixed(2), currency: 'INR',
        returnUrl: makeYoupiReturnUrl(req, orderId),
        metadata: { source: 'PresetHub', kind, plan, presetId: presetId ? String(presetId) : '', userId: String(userId), label: String(label || '').slice(0, 80) }
      }
    });

    if (String(payment.orderId || '') !== orderId || Number(payment.amountPaise) !== amountPaise ||
        String(payment.currency || 'INR').toUpperCase() !== 'INR' || !isHttpUrl(payment.checkoutUrl)) {
      await Order.updateOne({ _id: orderId, status: 'created' }, { $set: { status: 'suspicious', failureReason: 'Invalid response from YOUPI PG while creating the payment.' } });
      adminAlert({ type: 'payment', severity: 'critical', title: 'YOUPI returned an invalid checkout session', details: { orderId, kind } });
      return res.status(502).json({ error: 'Payment gateway returned an invalid checkout session. Please contact support before retrying.' });
    }
    await Order.updateOne({ _id: orderId, provider: { $in: ['youpi', 'cashfree'] }, status: 'created' }, { $set: { gatewayPaymentId: String(payment.paymentId), checkoutUrl: payment.checkoutUrl } });
    res.json({ provider: 'youpi', orderId, checkoutUrl: payment.checkoutUrl, amount: amountPaise / 100, currency: 'INR' });
  } catch (err) {
    if (orderId) {
      await Order.updateOne({ _id: orderId, status: 'created' }, { $set: { status: 'failed', failureReason: String(err.message || 'YOUPI PG session creation failed').slice(0, 350) } }).catch(() => {});
    }
    console.error('YOUPI PG create-order error:', err.message);
    adminAlert({ type: 'payment', severity: 'warning', title: 'YOUPI checkout could not be started', fingerprint: 'youpi-start-fail', details: { error: err.message, kind, orderId } });
    res.status(err.status === 400 ? 400 : 502).json({ error: 'Could not start YOUPI PG checkout. Please try again later.' });
  }
}

router.post('/youpi/create-order', auth, ensureYoupi, async (req, res) => {
  const { presetId } = req.body || {};
  if (!mongoose.Types.ObjectId.isValid(presetId)) return res.status(400).json({ error: 'Invalid preset ID' });
  const preset = await Preset.findById(presetId).select('_id name price status authorId').lean();
  if (!preset || preset.status !== 'approved') return res.status(404).json({ error: 'Preset not found' });
  if (!Number.isFinite(Number(preset.price)) || Number(preset.price) <= 0) return res.status(400).json({ error: 'Preset is free or has an invalid price' });
  if (String(preset.authorId) === String(req.user.id)) return res.status(400).json({ error: 'You cannot purchase your own preset.' });
  if (await Order.exists({ presetId: preset._id, userId: req.user.id, status: 'paid', kind: { $ne: 'subscription' } })) return res.status(400).json({ error: 'You already own this preset.' });
  return startYoupiCheckout(req, res, { userId: req.user.id, presetId: preset._id, kind: 'preset', amountRupees: Math.round(Number(preset.price) * 100) / 100, label: preset.name });
});

router.post('/youpi/subscribe', auth, ensureYoupi, async (req, res) => {
  const plan = getPlans()[String(req.body?.plan || '')];
  if (!plan) return res.status(400).json({ error: 'Invalid subscription plan.' });
  return startYoupiCheckout(req, res, { userId: req.user.id, kind: 'subscription', plan: plan.id, amountRupees: plan.price, label: plan.label });
});

// Tip a creator (₹10 – ₹500). Money goes to YOUPI PG; the creator's tip total is credited after verification.
router.post('/youpi/tip', auth, ensureYoupi, async (req, res) => {
  const { recipientId, amount, note } = req.body || {};
  if (!mongoose.Types.ObjectId.isValid(recipientId)) return res.status(400).json({ error: 'Invalid creator' });
  if (String(recipientId) === String(req.user.id)) return res.status(400).json({ error: 'You cannot tip yourself.' });
  const value = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(value) || value < 10 || value > 500) return res.status(400).json({ error: 'Tip must be between ₹10 and ₹500.' });
  const creator = await User.findOne({ _id: recipientId, status: 'active' }).select('name username').lean();
  if (!creator) return res.status(404).json({ error: 'Creator not found' });
  return startYoupiCheckout(req, res, { userId: req.user.id, kind: 'tip', recipientId, amountRupees: value, note, label: `Tip to ${creator.name || creator.username}` });
});

// Current subscription status for the logged-in user.
router.get('/subscription', auth, async (req, res) => {
  const user = await User.findById(req.user.id).select('subscription').lean();
  const sub = user?.subscription || {};
  res.json({ isPro: isProUser(user), plan: sub.plan || '', expiry: sub.expiry || null, since: sub.since || null });
});

// YOUPI PG calls this endpoint server-to-server. The raw payload bytes must be preserved by server.js.
router.post('/youpi/webhook', async (req, res) => {
  try {
    if (!YOUPI_WEBHOOK_SECRET) return res.status(503).json({ error: 'Webhook secret is not configured.' });
    if (!Buffer.isBuffer(req.rawBody) || req.rawBody.length === 0)
      return res.status(400).json({ error: 'Raw webhook body is required.' });

    const raw = req.rawBody.toString('utf8');
    const signature = String(req.headers['x-gateway-signature'] || '');
    const signatureV2 = String(req.headers['x-gateway-signature-v2'] || '');
    const timestampHeader = String(req.headers['x-gateway-timestamp'] || '');
    const deliveryHeader = String(req.headers['x-gateway-delivery-id'] || '');
    if ((!signature && !signatureV2) || !timestampHeader || !deliveryHeader)
    {
      securityAlert(req, 'Payment webhook without signature headers', {}, 'warning');
      return res.status(401).json({ error: 'Missing signed webhook headers.' });
    }

    let payload;
    try { payload = JSON.parse(raw); }
    catch (_) { return res.status(400).json({ error: 'Invalid webhook JSON.' }); }

    const payloadTimestamp = String(payload.timestamp ?? '');
    const timestampNumber = Number(timestampHeader);
    if (!payloadTimestamp || payloadTimestamp !== timestampHeader || !Number.isFinite(timestampNumber) ||
        Math.abs(Date.now() - timestampNumber) > 2 * 60 * 60 * 1000) {
      return res.status(401).json({ error: 'Webhook timestamp is missing, stale, or mismatched.' });
    }
    if (!payload.deliveryId || String(payload.deliveryId) !== deliveryHeader)
      return res.status(401).json({ error: 'Webhook delivery ID mismatch.' });
    const headerEvent = String(req.headers['x-gateway-event'] || '').toUpperCase();
    if (headerEvent && headerEvent !== String(payload.event || '').toUpperCase())
      return res.status(401).json({ error: 'Webhook event header mismatch.' });

    const expectedV1 = `sha256=${crypto.createHmac('sha256', YOUPI_WEBHOOK_SECRET).update(req.rawBody).digest('hex')}`;
    const expectedV2 = `sha256=${crypto.createHmac('sha256', YOUPI_WEBHOOK_SECRET).update(`${timestampHeader}.${raw}`).digest('hex')}`;
    const signatureOk = (signature && timingSafeStringEqual(expectedV1, signature)) ||
      (signatureV2 && timingSafeStringEqual(expectedV2, signatureV2));
    if (!signatureOk) {
      securityAlert(req, 'Payment webhook with INVALID signature (possible forgery attempt)', { deliveryId: deliveryHeader, orderId: payload.orderId || '' }, 'critical');
      return res.status(401).json({ error: 'Invalid webhook signature.' });
    }

    if (!payload.orderId || !payload.event) return res.status(400).json({ error: 'Missing order ID or event.' });
    const order = await Order.findById(String(payload.orderId));
    if (!order) return res.status(404).json({ error: 'Local order not found.' });
    if (order.provider !== 'youpi') return res.status(409).json({ error: 'Payment provider mismatch.' });

    const outcome = await applyYoupiOutcome(order, payload);
    // A validly signed but mismatched event is acknowledged after marking the order for review,
    // preventing repeated delivery attempts from accidentally granting access or changing state.
    res.status(200).json({ received: true, reviewRequired: Boolean(outcome.reviewRequired), alreadyProcessed: Boolean(outcome.alreadyProcessed) });
  } catch (err) {
    console.error('YOUPI PG webhook error:', err.message);
    adminAlert({ type: 'payment', severity: 'critical', title: 'YOUPI webhook processing failed', fingerprint: 'youpi-webhook-fail', details: { error: err.message } });
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
});

// Recovery endpoint for a delayed/missed webhook. The status is obtained server-to-server from YOUPI PG,
// then the same order/amount/currency validation and atomic state transition are applied.
router.post('/youpi/refresh/:orderId', auth, async (req, res) => {
  // The return page uses this path for every provider; Cashfree orders are synced by their own handler.
  const probe = await Order.findById(String(req.params.orderId)).select('provider').lean();
  if (probe?.provider === 'cashfree') return require('./cashfree').refreshHandler(req, res);
  if (!YOUPI_CONFIGURED) return res.status(503).json({ error: 'YOUPI PG is not configured.' });
  try {
    const order = await Order.findById(String(req.params.orderId));
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (String(order.userId) !== String(req.user.id) && req.user.role !== 'admin')
      return res.status(403).json({ error: 'Unauthorized.' });
    if (order.provider !== 'youpi') return res.status(400).json({ error: 'This is not a YOUPI PG order.' });
    if (order.status === 'paid') return res.json(publicOrder(order));
    if (!order.gatewayPaymentId) return res.status(409).json({ error: 'Gateway session is not available for status refresh.' });

    const payment = await callYoupi(`/api/v1/payments/${encodeURIComponent(order.gatewayPaymentId)}`);
    if (String(payment.orderId || '') !== String(order._id)) {
      await Order.updateOne({ _id: order._id, status: 'created' }, { $set: { status: 'suspicious', failureReason: 'YOUPI PG status lookup order ID mismatch.' } });
      return res.status(409).json({ error: 'Gateway order information did not match this purchase. It has been held for review.' });
    }
    const outcome = await applyYoupiOutcome(order, payment);
    const latest = await Order.findById(order._id).lean();
    if (outcome.reviewRequired) return res.status(409).json({ ...publicOrder(latest), error: 'Payment details do not match. This order was held for review.' });
    res.json(publicOrder(latest));
  } catch (err) {
    console.error('YOUPI PG status refresh error:', err.message);
    res.status(502).json({ error: 'Could not refresh payment status from YOUPI PG.' });
  }
});

// ============ ORDER STATUS / HISTORY ============
router.get('/order/:orderId', auth, async (req, res) => {
  const order = await Order.findById(req.params.orderId).lean();
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (String(order.userId) !== String(req.user.id) && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Unauthorized' });
  res.json(publicOrder(order));
});

router.get('/my-orders', auth, async (req, res) => {
  const orders = await Order.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(100).lean();
  res.json(orders.map(publicOrder));
});

module.exports = router;

module.exports.markOrderPaid = markOrderPaid;
