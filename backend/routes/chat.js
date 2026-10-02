const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const { User } = require('../models');

const router = express.Router();
// Intentionally in-memory: chat messages are never persisted to MongoDB.
// They expire after 24 hours. This is suitable for a single server instance.
const conversations = new Map();
const TTL = 24 * 60 * 60 * 1000;
function key(a,b){ return [String(a),String(b)].sort().join(':'); }
function clean(){
  const now=Date.now();
  for(const [k,v] of conversations){
    v.messages=v.messages.filter(m=>now-new Date(m.createdAt).getTime()<TTL);
    if(!v.messages.length) conversations.delete(k);
  }
}
setInterval(clean, 60*60*1000).unref();

router.get('/with/:userId', auth, async (req,res,next)=>{
  try{
    if(!mongoose.Types.ObjectId.isValid(req.params.userId)) return res.status(400).json({error:'Invalid user ID'});
    if(req.params.userId===req.user.id) return res.status(400).json({error:'Cannot chat with yourself'});
    const other=await User.findById(req.params.userId).select('name username avatar followers').lean();
    if(!other) return res.status(404).json({error:'User not found'});
    const allowed=(other.followers||[]).some(id=>id.toString()===req.user.id);
    if(!allowed) return res.status(403).json({error:'Follow this user before starting a chat'});
    clean();
    const c=conversations.get(key(req.user.id,other._id.toString()));
    res.json({user:{id:other._id.toString(),name:other.name,username:other.username,avatar:other.avatar},messages:c?.messages||[]});
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
    clean();
    const k=key(req.user.id,other._id.toString());
    const c=conversations.get(k)||{messages:[]};
    const message={id:require('crypto').randomUUID(),senderId:req.user.id,receiverId:other._id.toString(),text,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+TTL).toISOString()};
    c.messages.push(message); conversations.set(k,c);
    res.status(201).json(message);
  }catch(e){next(e)}
});

module.exports=router;
