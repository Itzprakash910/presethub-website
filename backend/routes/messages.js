const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const { Message, User } = require('../models');
const { createNotification } = require('./users');

const router = express.Router();

function validId(id) { return mongoose.Types.ObjectId.isValid(id); }
function safeMessage(m) {
  return { id: m._id.toString(), senderId: m.senderId.toString(), receiverId: m.receiverId.toString(), text: m.text, readAt: m.readAt, createdAt: m.createdAt };
}

router.get('/unread-count', auth, async (req, res, next) => {
  try {
    const count = await Message.countDocuments({ receiverId: req.user.id, readAt: null });
    res.json({ count });
  } catch (e) { next(e); }
});

router.get('/conversations', auth, async (req, res, next) => {
  try {
    const messages = await Message.find({ $or: [{ senderId: req.user.id }, { receiverId: req.user.id }] })
      .sort({ createdAt: -1 }).limit(500).lean();
    const partnerIds = [];
    const seen = new Set();
    for (const m of messages) {
      const id = (m.senderId.toString() === req.user.id ? m.receiverId : m.senderId).toString();
      if (!seen.has(id)) { seen.add(id); partnerIds.push(id); }
    }
    const users = await User.find({ _id: { $in: partnerIds } }).select('name username avatar').lean();
    const userMap = Object.fromEntries(users.map(u => [u._id.toString(), u]));
    const result = [];
    for (const id of partnerIds) {
      const last = messages.find(m => {
        const a=m.senderId.toString(), b=m.receiverId.toString();
        return (a===req.user.id && b===id) || (a===id && b===req.user.id);
      });
      const unread = messages.filter(m => m.senderId.toString()===id && m.receiverId.toString()===req.user.id && !m.readAt).length;
      const u=userMap[id];
      if (u) result.push({ user:{id, name:u.name, username:u.username, avatar:u.avatar}, lastMessage:last ? safeMessage(last) : null, unread });
    }
    res.json(result);
  } catch (e) { next(e); }
});

router.get('/thread/:userId', auth, async (req, res, next) => {
  try {
    if (!validId(req.params.userId)) return res.status(400).json({ error: 'Invalid user ID' });
    const other = await User.findById(req.params.userId).select('name username avatar').lean();
    if (!other) return res.status(404).json({ error: 'User not found' });
    const messages = await Message.find({ $or: [
      { senderId: req.user.id, receiverId: req.params.userId },
      { senderId: req.params.userId, receiverId: req.user.id }
    ] }).sort({ createdAt: 1 }).limit(200).lean();
    await Message.updateMany({ senderId:req.params.userId, receiverId:req.user.id, readAt:null }, { $set:{ readAt:new Date() } });
    res.json({ user:{id:other._id.toString(),name:other.name,username:other.username,avatar:other.avatar}, messages:messages.map(safeMessage) });
  } catch (e) { next(e); }
});

router.post('/send', auth, async (req, res, next) => {
  try {
    const recipientId = String(req.body.recipientId || '');
    const text = String(req.body.text || '').trim();
    if (!validId(recipientId)) return res.status(400).json({ error:'Invalid recipient' });
    if (recipientId === req.user.id) return res.status(400).json({ error:'You cannot message yourself' });
    if (!text || text.length > 2000) return res.status(400).json({ error:'Message must be 1–2000 characters' });
    const [sender, recipient] = await Promise.all([
      User.findById(req.user.id).select('name username following').lean(),
      User.findById(recipientId).select('name username').lean()
    ]);
    if (!sender || !recipient) return res.status(404).json({ error:'User not found' });
    const follows = (sender.following || []).some(id => id.toString() === recipientId);
    if (!follows) return res.status(403).json({ error:'Follow this creator first to send a message' });
    const message = await Message.create({ senderId:req.user.id, receiverId:recipientId, text, expiresAt:new Date(Date.now()+24*60*60*1000) });
    await createNotification(recipientId, 'message', `${sender.name || sender.username || 'Someone'} sent you a message`, `/profile/${req.user.id}`);
    res.status(201).json({ success:true, message:safeMessage(message) });
  } catch (e) { next(e); }
});

router.post('/read/:userId', auth, async (req, res, next) => {
  try {
    if (!validId(req.params.userId)) return res.status(400).json({ error:'Invalid user ID' });
    await Message.updateMany({ senderId:req.params.userId, receiverId:req.user.id, readAt:null }, { $set:{ readAt:new Date() } });
    res.json({ success:true });
  } catch (e) { next(e); }
});

module.exports = router;
