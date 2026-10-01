const express = require('express');
const { Preset, User } = require('../models');
const router = express.Router();
function escapeRegex(v){ return String(v||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
router.get('/', async (req,res,next)=>{
  try{
    const q=String(req.query.q||'').trim().slice(0,100);
    if(q.length<2) return res.json({presets:[],users:[],categories:[]});
    const re=new RegExp(escapeRegex(q),'i');
    const [presets,users,categories]=await Promise.all([
      Preset.find({status:'approved',$or:[{name:re},{author:re},{tags:re},{description:re},{category:re}]}).sort({downloads:-1,createdAt:-1}).limit(8).lean(),
      User.aggregate([{ $match:{ $or:[{name:re},{username:re}] } },{ $lookup:{from:'presets',localField:'_id',foreignField:'authorId',as:'presets'} },{ $project:{name:1,username:1,avatar:1,presetCount:{ $size:{ $filter:{input:'$presets',as:'p',cond:{ $eq:['$$p.status','approved'] } } } } } },{ $limit:5 }]),
      Preset.aggregate([{ $match:{status:'approved'} },{ $unwind:'$tags' },{ $match:{tags:re} },{ $group:{_id:'$tags',count:{$sum:1}} },{ $sort:{count:-1} },{ $limit:5}])
    ]);
    const categoryCounts=await Preset.aggregate([{ $match:{status:'approved',category:re} },{ $group:{_id:'$category',count:{$sum:1}} },{ $sort:{count:-1} },{ $limit:5}]);
    const cats=[...categories.map(c=>({name:c._id,count:c.count})),...categoryCounts.map(c=>({name:c._id,count:c.count}))];
    const uniqueCats=Object.values(Object.fromEntries(cats.map(c=>[c.name,c])));
    res.json({
      presets:presets.map(p=>({id:p._id.toString(),name:p.name,description:p.description,category:p.category,tags:p.tags||[],author:p.author,authorId:p.authorId?.toString()||'',price:p.price,downloads:p.downloads,previewImage:p.previewImage})),
      users:users.map(u=>({id:u._id.toString(),name:u.name,username:u.username,avatar:u.avatar})),
      categories:uniqueCats.slice(0,6)
    });
  }catch(e){next(e)}
});
module.exports=router;
