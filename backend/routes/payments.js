const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const { getDB } = require('../db/db');

const router = express.Router();
const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = process.env;
const razorpay = RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET
  ? new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET })
  : null;
if (!razorpay) console.warn('WARNING: Razorpay keys missing – paid presets disabled');

router.post('/create-order', auth, async (req, res) => {
  if (!razorpay) return res.status(503).json({ error: 'Payments are not configured' });
  const db = await getDB();
  const preset = db.data.presets.find(p => p.id === String(req.body.presetId) && p.status === 'approved');
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  if (!(preset.price > 0)) return res.status(400).json({ error: 'Preset is free' });
  if (preset.authorId === req.user.id) return res.status(400).json({ error: 'This is your own preset' });

  db.data.orders = db.data.orders || [];
  if (db.data.orders.some(o => o.userId === req.user.id && o.presetId === preset.id && o.status === 'paid')) {
    return res.status(409).json({ error: 'You already own this preset' });
  }

  try {
    // Price ALWAYS comes from the server DB, never from the client. Math.round avoids 19.99*100 float errors.
    const order = await razorpay.orders.create({
      amount: Math.round(preset.price * 100),
      currency: 'INR',
      receipt: `r_${Date.now()}`.slice(0, 40),
      notes: { presetId: preset.id, userId: req.user.id }
    });
    db.data.orders.push({
      id: order.id, userId: req.user.id, presetId: preset.id,
      amount: preset.price, status: 'created', createdAt: new Date().toISOString()
    });
    await db.write();
    res.json({ key: RAZORPAY_KEY_ID, orderId: order.id, amount: order.amount, currency: order.currency });
  } catch (err) {
    console.error('Razorpay create-order failed:', err?.error?.description || err.message);
    res.status(502).json({ error: 'Could not start payment. Please try again.' });
  }
});

router.post('/verify', auth, async (req, res) => {
  if (!razorpay) return res.status(503).json({ error: 'Payments are not configured' });
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if ([razorpay_order_id, razorpay_payment_id, razorpay_signature].some(v => typeof v !== 'string' || !v)) {
    return res.status(400).json({ error: 'Missing payment details' });
  }

  const expected = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(razorpay_signature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const db = await getDB();
  // Order must belong to THIS user (stops someone claiming another user's paid order)
  const order = (db.data.orders || []).find(o => o.id === razorpay_order_id && o.userId === req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status === 'paid') return res.json({ success: true, message: 'Already verified' });

  order.status = 'paid';
  order.paymentId = razorpay_payment_id;
  order.paidAt = new Date().toISOString();
  await db.write();
  res.json({ success: true, message: 'Payment verified, download available' });
});

module.exports = router;
