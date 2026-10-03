const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const { User, Message } = require('../models');
const { createNotification } = require('../utils/notifications');

const router = express.Router();
const TTL = 24 * 60 * 60 * 1000;

function validId(id) { return mongoose.Types.ObjectId.isValid(id); }
function normalizeMessage(m) {
  return {
    id: m._id.toString(),
    senderId: m.senderId.toString(),
    receiverId: m.receiverId.toString(),
    text: m.text,
    readAt: m.readAt || null,
    createdAt: m.createdAt,
    expiresAt: m.expiresAt,
  };
}
async function purgeExpired() {
  await Message.deleteMany({ expiresAt: { $lte: new Date() } });
}

// Inbox badge count.
router.get('/unread-count', auth, async (req, res, next) => {
  try {
    await purgeExpired();
    const count = await Message.countDocuments({ receiverId: req.user.id, readAt: null });
    res.json({ count });
  } catch (e) { next(e); }
});

// Conversation list for the message inbox.
router.get('/conversations', auth, async (req, res, next) => {
  try {
    await purgeExpired();
    const messages = await Message.find({ $or: [{ senderId: req.user.id }, { receiverId: req.user.id }] })
      .sort({ createdAt: -1 }).limit(500).lean();
    const ids = [];
    const seen = new Set();
    for (const m of messages) {
      const partner = m.senderId.toString() === req.user.id ? m.receiverId.toString() : m.senderId.toString();
      if (!seen.has(partner)) { seen.add(partner); ids.push(partner); }
    }
    const users = await User.find({ _id: { $in: ids } }).select('name username avatar status followers').lean();
    const map = Object.fromEntries(users.map(u => [u._id.toString(), u]));
    const result = ids.map(id => {
      const partnerMessages = messages.filter(m => {
        const a=m.senderId.toString(), b=m.receiverId.toString();
        return (a===req.user.id && b===id) || (a===id && b===req.user.id);
      });
      const last = partnerMessages[0];
      const unread = partnerMessages.filter(m => m.receiverId.toString()===req.user.id && !m.readAt).length;
      const u = map[id];
      if (!u) return null;
      return { user:{id,name:u.name,username:u.username,avatar:u.avatar,status:u.status,followers:(u.followers||[]).length}, lastMessage:last?normalizeMessage(last):null, unread };
    }).filter(Boolean);
    res.json(result);
  } catch (e) { next(e); }
});

router.get('/with/:userId', auth, async (req,res,next)=>{
  try{
    if(!validId(req.params.userId)) return res.status(400).json({error:'Invalid user ID'});
    if(req.params.userId===req.user.id) return res.status(400).json({error:'Cannot chat with yourself'});
    const other=await User.findById(req.params.userId).select('name username avatar followers following status').lean();
    if(!other) return res.status(404).json({error:'User not found'});
    if (other.status === 'blocked' || other.status === 'deactivated') return res.status(403).json({error:'This account cannot receive messages'});
    const allowed=(other.followers||[]).some(id=>id.toString()===req.user.id);
    if(!allowed) return res.status(403).json({error:'Follow this user before starting a chat'});
    await purgeExpired();
    const messages=await Message.find({
      $or:[
        {senderId:req.user.id,receiverId:other._id},
        {senderId:other._id,receiverId:req.user.id}
      ], expiresAt:{$gt:new Date()}
    }).sort({createdAt:1}).limit(200).lean();
    await Message.updateMany({senderId:other._id,receiverId:req.user.id,readAt:null},{ $set:{readAt:new Date()} });
    res.json({user:{id:other._id.toString(),name:other.name,username:other.username,avatar:other.avatar,followers:(other.followers||[]).length},messages:messages.map(normalizeMessage)});
  }catch(e){next(e)}
});

router.post('/with/:userId', auth, async (req,res,next)=>{
  try{
    if(!validId(req.params.userId)) return res.status(400).json({error:'Invalid user ID'});
    if(req.params.userId===req.user.id) return res.status(400).json({error:'Cannot message yourself'});
    const other=await User.findById(req.params.userId).select('name username avatar followers following status').lean();
    if(!other) return res.status(404).json({error:'User not found'});
    if (other.status === 'blocked' || other.status === 'deactivated') return res.status(403).json({error:'This account cannot receive messages'});
    const allowed=(other.followers||[]).some(id=>id.toString()===req.user.id);
    if(!allowed) return res.status(403).json({error:'Follow this user before sending a message'});
    const text=String(req.body.text||'').trim().slice(0,1000);
    if(!text) return res.status(400).json({error:'Message cannot be empty'});
    const message=await Message.create({senderId:req.user.id,receiverId:other._id,text,expiresAt:new Date(Date.now()+TTL)});
    const sender = await User.findById(req.user.id).select('name username').lean();
    await createNotification(other._id, 'message', `💬 ${sender?.name || sender?.username || 'Someone'} sent you a message.`, `/profile/${req.user.id}`, 'New message');
    res.status(201).json(normalizeMessage(message));
  }catch(e){next(e)}
});

router.post('/read/:userId', auth, async (req,res,next)=>{
  try{
    if(!validId(req.params.userId)) return res.status(400).json({error:'Invalid user ID'});
    await Message.updateMany({senderId:req.params.userId,receiverId:req.user.id,readAt:null},{ $set:{readAt:new Date()} });
    res.json({success:true});
  }catch(e){next(e)}
});

module.exports=router;
