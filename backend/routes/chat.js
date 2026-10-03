const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const { User, Message } = require('../models');

const router = express.Router();
const TTL = 24 * 60 * 60 * 1000;

async function purgeExpired() {
  await Message.deleteMany({ expiresAt: { $lte: new Date() } });
}

router.get('/with/:userId', auth, async (req,res,next)=>{
  try{
    if(!mongoose.Types.ObjectId.isValid(req.params.userId)) return res.status(400).json({error:'Invalid user ID'});
    if(req.params.userId===req.user.id) return res.status(400).json({error:'Cannot chat with yourself'});
    const other=await User.findById(req.params.userId).select('name username avatar followers').lean();
    if(!other) return res.status(404).json({error:'User not found'});
    const allowed=(other.followers||[]).some(id=>id.toString()===req.user.id);
    if(!allowed) return res.status(403).json({error:'Follow this user before starting a chat'});
    await purgeExpired();
    const messages=await Message.find({
      $or:[
        {senderId:req.user.id,receiverId:other._id},
        {senderId:other._id,receiverId:req.user.id}
      ], expiresAt:{$gt:new Date()}
    }).sort({createdAt:1}).limit(200).lean();
    res.json({user:{id:other._id.toString(),name:other.name,username:other.username,avatar:other.avatar},messages:messages.map(m=>({...m,id:m._id.toString(),senderId:m.senderId.toString(),receiverId:m.receiverId.toString()}))});
  }catch(e){next(e)}
});

router.post('/with/:userId', auth, async (req,res,next)=>{
  try{
    if(!mongoose.Types.ObjectId.isValid(req.params.userId)) return res.status(400).json({error:'Invalid user ID'});
    if(req.params.userId===req.user.id) return res.status(400).json({error:'Cannot message yourself'});
    const other=await User.findById(req.params.userId).select('name username avatar followers').lean();
    if(!other) return res.status(404).json({error:'User not found'});
    const allowed=(other.followers||[]).some(id=>id.toString()===req.user.id);
    if(!allowed) return res.status(403).json({error:'Follow this user before sending a message'});
    const text=String(req.body.text||'').trim().slice(0,1000);
    if(!text) return res.status(400).json({error:'Message cannot be empty'});
    const message=await Message.create({
      senderId:req.user.id, receiverId:other._id, text,
      expiresAt:new Date(Date.now()+TTL)
    });
    res.status(201).json({id:message._id.toString(),senderId:message.senderId.toString(),receiverId:message.receiverId.toString(),text:message.text,createdAt:message.createdAt.toISOString(),expiresAt:message.expiresAt.toISOString()});
  }catch(e){next(e)}
});

module.exports=router;
