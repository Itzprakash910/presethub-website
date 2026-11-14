// Profile edit conflict self-test (two tabs saving the same profile): mocks the User model, no database needed.
const Module=require('module');
const ROOT=require('path').join(__dirname,'..')+'/';
const mk=()=>new Proxy(function(){},{get:(t,k)=>k==='then'?undefined:mk(),apply:()=>mk(),construct:()=>mk()});
const Router=()=>{const r={routes:{}};for(const m of['get','post','put','delete','patch','use'])r[m]=(p,...h)=>{r.routes[m+' '+(typeof p==='string'?p:'*')]=h;return r};return r};
let doc;const users={};
class UserDoc{constructor(o){Object.assign(this,o)}toObject(){const c={...this};return c}save(){users[this._id]=this;return Promise.resolve()}}
const User={findById:async id=>users[id]||null,exists:async()=>false,
 updateOne:async(f,u)=>{const d=users[f._id];const rev=d.profileRev||0;const ok=f.profileRev!==undefined?rev===f.profileRev:(f.$or?rev===0:true);if(!ok)return{modifiedCount:0};d.profileRev=rev+1;return{modifiedCount:1}}};
const mocks={express:{Router,json:()=>{}},'../models':new Proxy({User},{get:(t,k)=>t[k]||mk()}),'../middleware/auth':(q,s,n)=>n()};
const orig=Module._load;Module._load=function(r,p,...a){if(mocks[r])return mocks[r];try{return orig.call(this,r,p,...a)}catch(e){if(r.startsWith('.')&&!r.startsWith('./utils')&&!r.startsWith('../utils')){throw e}if(/routes\/auth/.test(r)){throw e}return mk()}};
const router=require(ROOT+'routes/auth.js');
const h=router.routes['put /profile'];const handler=h[h.length-1];
users.u1=new UserDoc({_id:'u1',email:'a@x.com',name:'Old',username:'old',bio:'',socialLinks:{},profileRev:0});
// make _id usable as map key
const call=async body=>{const res={code:200,status(c){this.code=c;return this},json(b){this.body=b;return this}};await handler({user:{id:'u1'},body,header:()=>''},res);return res};
const oldFind=User.findById;User.findById=async()=>users.u1;
(async()=>{let ok=0,bad=0;const t=(n,c)=>{console.log((c?'PASS ':'FAIL ')+n);c?ok++:bad++};
 let r=await call({name:'Tab A',baseRev:0});t('first save with baseRev 0 succeeds, rev -> 1',r.code===200&&users.u1.profileRev===1&&users.u1.name==='Tab A');
 r=await call({name:'Tab B stale',baseRev:0});t('stale tab (baseRev 0) gets 409 PROFILE_CONFLICT',r.code===409&&r.body.code==='PROFILE_CONFLICT');
 t('409 did not overwrite newer data',users.u1.name==='Tab A');
 t('409 returns fresh user with rev 1',r.body.user&&r.body.user.profileRev===1&&r.body.user.name==='Tab A'&&!('password' in r.body.user));
 r=await call({name:'Tab B retry',baseRev:1});t('retry with fresh rev succeeds',r.code===200&&users.u1.profileRev===2);
 r=await call({name:'Legacy/offline replay'});t('request without baseRev still allowed (offline queue)',r.code===200&&users.u1.profileRev===3);
 console.log(`\n${ok} passed, ${bad} failed`);process.exit(bad?1:0)})().catch(e=>{console.error(e);process.exit(1)});
