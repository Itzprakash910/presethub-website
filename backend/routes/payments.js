const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const { Order, Preset } = require('../models');

const router = express.Router();

let razorpay = null;
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) {
  try {
    const Razorpay = require('razorpay');
    razorpay = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
    console.log('✅ Razorpay initialized');
  } catch (err) {
    console.error('Razorpay init failed:', err.message);
  }
} else {
  console.warn('⚠️ Razorpay keys not configured');
}

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
  const requested = String(process.env.PAYMENT_PROVIDER || '').trim().toLowerCase();
  if (requested === 'youpi') return YOUPI_CONFIGURED ? 'youpi' : 'disabled';
  if (requested === 'razorpay') return razorpay ? 'razorpay' : 'disabled';
  if (YOUPI_CONFIGURED) return 'youpi';
  if (razorpay) return 'razorpay';
  return 'disabled';
}

const ensureRazorpay = (req, res, next) =>
  razorpay && activeProvider() === 'razorpay'
    ? next()
    : res.status(503).json({ error: 'Razorpay payment service is not the active or configured provider.' });

const ensureYoupi = (req, res, next) =>
  YOUPI_CONFIGURED && activeProvider() === 'youpi'
    ? next()
    : res.status(503).json({ error: 'YOUPI PG is not configured as the active payment provider. Configure YOUPI_API_URL, YOUPI_MERCHANT_ID and YOUPI_WEBHOOK_SECRET.' });

function timingSafeStringEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function publicOrder(order) {
  if (!order) return null;
  return {
    id: String(order._id),
    presetId: String(order.presetId),
    amount: Number(order.amount),
    currency: order.currency || 'INR',
    status: order.status,
    provider: order.provider || 'razorpay',
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

async function markOrderPaid(order, payload) {
  const result = await Order.updateOne(
    { _id: order._id, provider: 'youpi', status: 'created' },
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
  // Atomic transition from created -> paid prevents webhook retries from double-counting revenue.
  if (result.modifiedCount) {
    await Preset.updateOne({ _id: order.presetId }, { $inc: { totalRevenue: order.amount } });
  }
  return result.modifiedCount > 0;
}

async function applyYoupiOutcome(order, payload) {
  const event = String(payload.event || payload.status || '').toUpperCase();
  if (String(payload.orderId || '') !== String(order._id)) {
    await Order.updateOne(
      { _id: order._id, provider: 'youpi', status: 'created' },
      { $set: { status: 'suspicious', failureReason: 'Gateway order ID mismatch.' } }
    );
    return { accepted: false, reviewRequired: true, reason: 'Order ID mismatch.' };
  }
  if (!amountMatches(order, payload)) {
    await Order.updateOne(
      { _id: order._id, provider: 'youpi', status: 'created' },
      { $set: { status: 'suspicious', failureReason: 'Gateway amount or currency mismatch.' } }
    );
    return { accepted: false, reviewRequired: true, reason: 'Amount or currency mismatch.' };
  }

  if (event === 'SUCCESS') {
    if (!payload.paymentId && !order.gatewayPaymentId) {
      await Order.updateOne(
        { _id: order._id, provider: 'youpi', status: 'created' },
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
      { _id: order._id, provider: 'youpi', status: 'created' },
      { $set: { status: nextStatus, failureReason: `YOUPI PG outcome: ${event}` } }
    );
  }
  return { accepted: true, status: nextStatus || order.status || 'created' };
}

// Public, non-sensitive configuration. No gateway keys/secrets are exposed.
router.get('/provider', (req, res) => {
  const provider = activeProvider();
  res.json({ provider, enabled: provider !== 'disabled' });
});

// ============ RAZORPAY ============
router.post('/create-order', auth, ensureRazorpay, async (req, res) => {
  try {
    const { presetId } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(presetId))
      return res.status(400).json({ error: 'Invalid preset ID' });

    const preset = await Preset.findById(presetId);
    if (!preset || preset.status !== 'approved') return res.status(404).json({ error: 'Preset not found' });
    if (!Number.isFinite(Number(preset.price)) || Number(preset.price) <= 0)
      return res.status(400).json({ error: 'Preset is free or has an invalid price' });
    if (String(preset.authorId) === String(req.user.id))
      return res.status(400).json({ error: 'You cannot purchase your own preset.' });
    if (await Order.exists({ presetId, userId: req.user.id, status: 'paid' }))
      return res.status(400).json({ error: 'You already own this preset' });

    const amount = Math.round(Number(preset.price) * 100);
    if (!Number.isSafeInteger(amount) || amount < 100 || amount > 100000000)
      return res.status(400).json({ error: 'Preset price is outside the supported payment range.' });
    const receipt = `ph_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const order = await razorpay.orders.create({
      amount,
      currency: 'INR',
      receipt,
      payment_capture: 1,
      notes: { presetId: preset._id.toString(), userId: req.user.id }
    });

    await Order.create({
      _id: order.id,
      userId: req.user.id,
      presetId: preset._id,
      amount: amount / 100,
      currency: 'INR',
      status: 'created',
      provider: 'razorpay'
    });

    res.json({ key: RAZORPAY_KEY_ID, orderId: order.id, amount: order.amount, currency: order.currency });
  } catch (err) {
    console.error('Razorpay create-order error:', err.message);
    res.status(500).json({ error: 'Order creation failed' });
  }
});

router.post('/verify', auth, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
      return res.status(400).json({ error: 'Missing payment details' });
    if (!razorpay || !RAZORPAY_KEY_SECRET) return res.status(503).json({ error: 'Razorpay is not configured' });

    const expected = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
    if (!timingSafeStringEqual(expected, razorpay_signature))
      return res.status(400).json({ error: 'Invalid payment signature' });

    const order = await Order.findById(razorpay_order_id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.provider && order.provider !== 'razorpay') return res.status(400).json({ error: 'Payment provider mismatch' });
    if (String(order.userId) !== String(req.user.id)) return res.status(403).json({ error: 'Unauthorized' });
    if (order.status === 'paid') return res.json({ success: true, message: 'Payment already verified' });
    if (order.status !== 'created') return res.status(409).json({ error: `Order is not payable in its current state (${order.status}).` });

    // A valid checkout signature links the payment to the order, but still fetch the
    // payment from Razorpay and verify captured status, exact amount and currency before fulfillment.
    const gatewayPayment = await razorpay.payments.fetch(razorpay_payment_id);
    if (String(gatewayPayment.order_id || '') !== String(razorpay_order_id) ||
        Number(gatewayPayment.amount) !== Math.round(Number(order.amount) * 100) ||
        String(gatewayPayment.currency || '').toUpperCase() !== String(order.currency || 'INR').toUpperCase() ||
        String(gatewayPayment.status || '').toLowerCase() !== 'captured') {
      return res.status(400).json({ error: 'Payment status or order details could not be verified. Please contact support before retrying.' });
    }

    const result = await Order.updateOne(
      { _id: order._id, status: 'created', $or: [{ provider: 'razorpay' }, { provider: { $exists: false } }] },
      { $set: { status: 'paid', paymentId: razorpay_payment_id, paidAt: new Date(), provider: 'razorpay' } }
    );
    if (result.modifiedCount) {
      await Preset.updateOne({ _id: order.presetId }, { $inc: { totalRevenue: order.amount } });
    } else {
      // A webhook may have completed the same order concurrently. Accept only if it is now paid.
      const latest = await Order.findById(order._id).select('status').lean();
      if (latest?.status !== 'paid') return res.status(409).json({ error: 'Order changed state during verification. Please refresh your purchase history.' });
    }
    res.json({ success: true, message: result.modifiedCount ? 'Payment verified' : 'Payment already verified' });
  } catch (err) {
    console.error('Razorpay verify error:', err.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

router.post('/webhook', async (req, res) => {
  try {
    if (!RAZORPAY_KEY_SECRET) return res.status(503).end();
    const sig = req.headers['x-razorpay-signature'];
    if (typeof sig !== 'string' || !req.rawBody) return res.status(400).end();
    const expected = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET).update(req.rawBody).digest('hex');
    if (!timingSafeStringEqual(expected, sig)) return res.status(400).end();

    const event = req.body?.event;
    const payment = req.body?.payload?.payment?.entity;
    if (event === 'payment.captured' && payment?.order_id) {
      const order = await Order.findById(payment.order_id).select('presetId amount currency provider status').lean();
      const gatewayAmountMatches = order && Number(payment.amount) === Math.round(Number(order.amount) * 100) &&
        String(payment.currency || '').toUpperCase() === String(order.currency || 'INR').toUpperCase();
      if (order && gatewayAmountMatches && (!order.provider || order.provider === 'razorpay')) {
        const result = await Order.updateOne(
          { _id: payment.order_id, status: 'created', $or: [{ provider: 'razorpay' }, { provider: { $exists: false } }] },
          { $set: { status: 'paid', paymentId: payment.id, paidAt: new Date(), provider: 'razorpay' } }
        );
        if (result.modifiedCount) await Preset.updateOne({ _id: order.presetId }, { $inc: { totalRevenue: order.amount } });
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Razorpay webhook error:', err.message);
    res.status(500).end();
  }
});

// ============ YOUPI PG ============
router.post('/youpi/create-order', auth, ensureYoupi, async (req, res) => {
  let orderId = '';
  try {
    const { presetId } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(presetId))
      return res.status(400).json({ error: 'Invalid preset ID' });

    const preset = await Preset.findById(presetId).select('_id name price status authorId').lean();
    if (!preset || preset.status !== 'approved') return res.status(404).json({ error: 'Preset not found' });
    if (!Number.isFinite(Number(preset.price)) || Number(preset.price) <= 0)
      return res.status(400).json({ error: 'Preset is free or has an invalid price' });
    if (String(preset.authorId) === String(req.user.id))
      return res.status(400).json({ error: 'You cannot purchase your own preset.' });
    if (await Order.exists({ presetId: preset._id, userId: req.user.id, status: 'paid' }))
      return res.status(400).json({ error: 'You already own this preset.' });

    // Reuse a recent, still-pending checkout so repeated clicks do not create many payment sessions.
    const pending = await Order.findOne({
      presetId: preset._id,
      userId: req.user.id,
      provider: 'youpi',
      status: 'created',
      checkoutUrl: { $type: 'string', $ne: '' },
      createdAt: { $gte: new Date(Date.now() - 4 * 60 * 1000) }
    }).sort({ createdAt: -1 }).lean();
    if (pending) {
      return res.json({ orderId: String(pending._id), checkoutUrl: pending.checkoutUrl, amount: pending.amount, currency: pending.currency, reused: true });
    }

    const amountRupees = Math.round(Number(preset.price) * 100) / 100;
    const amountPaise = Math.round(amountRupees * 100);
    if (!Number.isSafeInteger(amountPaise) || amountPaise < 100 || amountPaise > 100000000)
      return res.status(400).json({ error: 'Preset price is outside the supported payment range.' });

    orderId = `PH-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    await Order.create({
      _id: orderId,
      userId: req.user.id,
      presetId: preset._id,
      amount: amountPaise / 100,
      currency: 'INR',
      status: 'created',
      provider: 'youpi'
    });

    const payment = await callYoupi('/api/v1/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': `presethub-${orderId}` },
      body: {
        orderId,
        amount: (amountPaise / 100).toFixed(2),
        currency: 'INR',
        returnUrl: makeYoupiReturnUrl(req, orderId),
        metadata: {
          source: 'PresetHub',
          presetId: String(preset._id),
          userId: String(req.user.id)
        }
      }
    });

    if (String(payment.orderId || '') !== orderId ||
        Number(payment.amountPaise) !== amountPaise ||
        String(payment.currency || 'INR').toUpperCase() !== 'INR' ||
        !isHttpUrl(payment.checkoutUrl)) {
      await Order.updateOne({ _id: orderId, status: 'created' }, {
        $set: { status: 'suspicious', failureReason: 'Invalid response from YOUPI PG while creating the payment.' }
      });
      return res.status(502).json({ error: 'Payment gateway returned an invalid checkout session. Please contact support before retrying.' });
    }

    await Order.updateOne({ _id: orderId, provider: 'youpi', status: 'created' }, {
      $set: { gatewayPaymentId: String(payment.paymentId), checkoutUrl: payment.checkoutUrl }
    });

    res.json({
      provider: 'youpi',
      orderId,
      checkoutUrl: payment.checkoutUrl,
      amount: amountPaise / 100,
      currency: 'INR'
    });
  } catch (err) {
    if (orderId) {
      await Order.updateOne({ _id: orderId, status: 'created' }, {
        $set: { status: 'failed', failureReason: String(err.message || 'YOUPI PG session creation failed').slice(0, 350) }
      }).catch(() => {});
    }
    console.error('YOUPI PG create-order error:', err.message);
    res.status(err.status === 400 ? 400 : 502).json({ error: 'Could not start YOUPI PG checkout. Please try again later.' });
  }
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
      return res.status(401).json({ error: 'Missing signed webhook headers.' });

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
    if (!signatureOk) return res.status(401).json({ error: 'Invalid webhook signature.' });

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
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
});

// Recovery endpoint for a delayed/missed webhook. The status is obtained server-to-server from YOUPI PG,
// then the same order/amount/currency validation and atomic state transition are applied.
router.post('/youpi/refresh/:orderId', auth, ensureYoupi, async (req, res) => {
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
