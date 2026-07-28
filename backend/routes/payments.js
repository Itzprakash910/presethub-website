const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const { getDB } = require('../config/db');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Create Order
router.post('/create-order', auth, async (req, res) => {
  const { presetId } = req.body;
  const db = await getDB();
  const preset = db.data.presets.find(p => p.id === presetId);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  if (preset.price <= 0) return res.status(400).json({ error: 'Preset is free' });

  // Check if user already purchased – safe access
  const alreadyPaid = (db.data.orders || []).some(
    o => o.presetId === presetId && o.userId === req.user.id && o.status === 'paid'
  );
  if (alreadyPaid) {
    return res.status(400).json({ error: 'You already own this preset' });
  }

  const amount = preset.price * 100; // in paise
  const currency = 'INR';
  const receipt = `receipt_${Date.now()}`;

  try {
    const order = await razorpay.orders.create({
      amount,
      currency,
      receipt,
      payment_capture: 1,
      notes: { presetId: preset.id, userId: req.user.id },
    });

    if (!db.data.orders) db.data.orders = [];
    db.data.orders.push({
      id: order.id,
      userId: req.user.id,
      presetId: preset.id,
      amount: preset.price,
      currency: currency,
      status: 'created',
      createdAt: new Date().toISOString(),
    });
    await db.write();

    res.json({
      key: process.env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
    });
  } catch (err) {
    console.error('Razorpay error:', err);
    res.status(500).json({ error: 'Failed to create order: ' + err.message });
  }
});

// Verify Payment
router.post('/verify', auth, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const db = await getDB();

  const body = razorpay_order_id + '|' + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const order = (db.data.orders || []).find(o => o.id === razorpay_order_id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  order.status = 'paid';
  order.paymentId = razorpay_payment_id;
  order.paidAt = new Date().toISOString();
  await db.write();

  res.json({ success: true, message: 'Payment verified, download available' });
});

// Get order status
router.get('/order/:orderId', auth, async (req, res) => {
  const db = await getDB();
  const order = (db.data.orders || []).find(o => o.id === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  res.json(order);
});

// Get user's orders
router.get('/my-orders', auth, async (req, res) => {
  const db = await getDB();
  const orders = (db.data.orders || []).filter(o => o.userId === req.user.id);
  res.json(orders);
});

module.exports = router;