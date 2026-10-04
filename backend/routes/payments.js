const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const { Order, Preset } = require('../models');

const router = express.Router();

let razorpay = null;
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) {
  try {
    const Razorpay = require('razorpay');
    razorpay = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
    console.log('✅ Razorpay initialized');
  } catch (err) { console.error('Razorpay init failed:', err.message); }
} else {
  console.warn('⚠️  Razorpay keys not configured');
}

const ensureRazorpay = (req, res, next) =>
  razorpay ? next() : res.status(503).json({ error: 'Payment service not configured' });

router.post('/create-order', auth, ensureRazorpay, async (req, res) => {
  try {
    const { presetId } = req.body;
    if (!mongoose.Types.ObjectId.isValid(presetId))
      return res.status(400).json({ error: 'Invalid preset ID' });

    const preset = await Preset.findById(presetId);
    if (!preset || preset.status !== 'approved') return res.status(404).json({ error: 'Preset not found' });
    if (preset.price <= 0) return res.status(400).json({ error: 'Preset is free' });

    if (await Order.exists({ presetId, userId: req.user.id, status: 'paid' }))
      return res.status(400).json({ error: 'You already own this preset' });

    const amount = Math.round(preset.price * 100);
    const order = await razorpay.orders.create({
      amount, currency: 'INR', receipt: `receipt_${Date.now()}`,
      payment_capture: 1,
      notes: { presetId: preset._id.toString(), userId: req.user.id }
    });

    await Order.create({
      _id: order.id, userId: req.user.id, presetId: preset._id,
      amount: preset.price, currency: 'INR', status: 'created'
    });

    res.json({ key: RAZORPAY_KEY_ID, orderId: order.id, amount: order.amount, currency: order.currency });
  } catch (err) {
    console.error('Create-order error:', err);
    res.status(500).json({ error: 'Order creation failed' });
  }
});

router.post('/verify', auth, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
      return res.status(400).json({ error: 'Missing details' });
    if (!RAZORPAY_KEY_SECRET) return res.status(503).json({ error: 'Not configured' });

    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expected = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET).update(body).digest('hex');
    if (expected !== razorpay_signature) return res.status(400).json({ error: 'Invalid signature' });

    const order = await Order.findById(razorpay_order_id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.userId.toString() !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });
    if (order.status === 'paid') {
      return res.json({ success: true, message: 'Payment already verified' });
    }

    const result = await Order.updateOne(
      { _id: order._id, status: { $ne: 'paid' } },
      { $set: { status: 'paid', paymentId: razorpay_payment_id, paidAt: new Date() } }
    );
    if (result.modifiedCount) {
      await Preset.updateOne({ _id: order.presetId }, { $inc: { totalRevenue: order.amount } });
    }

    res.json({ success: true, message: 'Payment verified' });
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

router.post('/webhook', express.json({ type: 'application/json' }), async (req, res) => {
  try {
    if (!RAZORPAY_KEY_SECRET) return res.status(503).end();
    const sig = req.headers['x-razorpay-signature'];
    if (!sig) return res.status(400).end();
    const raw = req.rawBody || Buffer.from(JSON.stringify(req.body));
    const expected = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET).update(raw).digest('hex');
    if (expected !== sig) return res.status(400).end();

    const event = req.body?.event;
    const payment = req.body?.payload?.payment?.entity;
    if (event === 'payment.captured' && payment?.order_id) {
      const result = await Order.updateOne(
        { _id: payment.order_id, status: { $ne: 'paid' } },
        { $set: { status: 'paid', paymentId: payment.id, paidAt: new Date() } }
      );
      if (result.modifiedCount) {
        const order = await Order.findById(payment.order_id).select('presetId amount').lean();
        if (order) await Preset.updateOne({ _id: order.presetId }, { $inc: { totalRevenue: order.amount } });
      }
    }
    res.json({ received: true });
  } catch (err) { console.error('Webhook error:', err); res.status(500).end(); }
});

router.get('/order/:orderId', auth, async (req, res) => {
  const order = await Order.findById(req.params.orderId).lean();
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.userId.toString() !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Unauthorized' });
  res.json({ ...order, id: order._id.toString() });
});

router.get('/my-orders', auth, async (req, res) => {
  const orders = await Order.find({ userId: req.user.id }).sort({ createdAt: -1 }).lean();
  res.json(orders.map(o => ({ ...o, id: o._id.toString() })));
});

module.exports = router;