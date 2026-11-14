// PhonePe gateway self-test (no network, no database): mocks the models and the PhonePe API.
const Module=require('module'),crypto=require('crypto');
process.env.PHONEPE_CLIENT_ID='cid';process.env.PHONEPE_CLIENT_SECRET='sec';process.env.PHONEPE_WEBHOOK_USERNAME='u';process.env.PHONEPE_WEBHOOK_PASSWORD='p';process.env.CLIENT_URL='https://presethub.site';
// ---- tiny in-memory Order model
const store=[];
const match=(d,f)=>Object.entries(f).every(([k,v])=>{const x=d[k];if(v&&typeof v==='object'&&!(v instanceof Date)&&!Array.isArray(v)){
 return Object.entries(v).every(([op,a])=>op==='$gt'?x>a:op==='$lt'?x<a:op==='$ne'?x!==a:op==='$nin'?!a.includes(x):op==='$in'?a.includes(x):op==='$type'?typeof x==='string':true)}return String(x)===String(v)});
const q=(arr)=>({sort(){return this},limit(){return this},lean:async()=>arr[0]||null,then:(r)=>r(arr)});
const Order={create:async d=>{store.push({...d,createdAt:new Date()})},findOne:f=>q(store.filter(d=>match(d,f))),findById:id=>q(store.filter(d=>d._id===id)),exists:async f=>store.some(d=>match(d,f)),
 updateOne:async(f,u)=>{const d=store.find(x=>match(x,f));if(!d)return{modifiedCount:0};Object.assign(d,u.$set||{});return{modifiedCount:1}},find:f=>q(store.filter(d=>match(d,f)))};
const Router=()=>{const r={routes:{}};for(const m of['get','post'])r[m]=(path,...h)=>{r.routes[m+' '+path]=r.routes[m+' '+path]||[];r.routes[m+' '+path].push(h)};return r};
const mocks={'express':{Router},'mongoose':{Types:{ObjectId:{isValid:()=>true}}},
 '../models':{Order,Preset:{findById:()=>({select:()=>({lean:async()=>({_id:'p1',name:'Preset',price:99,status:'approved',authorId:'other'})})})},User:{findById:()=>({select:()=>({lean:async()=>({_id:'u1'})})}),updateOne:async()=>{}},Download:{},Coupon:{updateOne:async()=>({modifiedCount:1})},TextPost:{}},
 '../middleware/auth':(q,s,n)=>n(),'../utils/alerts':{adminAlert:(a)=>console.log('  [adminAlert]',a.title),securityAlert:(r,m)=>console.log('  [securityAlert]',m)},
 '../utils/coupons':{normaliseCode:c=>String(c).toUpperCase()},'../utils/boosts':{TARGETS:[],priceFor:()=>null},'../utils/plans':{getPlans:()=>({})},'../utils/notifications':{createNotification:async()=>{}},
 './payments':{markOrderPaid:async(o,p)=>{const d=store.find(x=>x._id===o._id);if(d&&d.status==='created'){d.status='paid';d.paymentId=p.paymentId}}},'../utils/security':{textPostLimiter:(a,b,n)=>n()}};
const orig=Module._load;Module._load=function(r,...a){return mocks[r]||orig.call(this,r,...a)};
// ---- fake PhonePe API
let statusState={state:'COMPLETED'},calls=[];
global.fetch=async(url,opt={})=>{calls.push((opt.method||'GET')+' '+url);const j=(o,c=200)=>({ok:c<300,status:c,json:async()=>o});
 if(url.includes('oauth/token')){const b=new URLSearchParams(opt.body);if(b.get('grant_type')!=='client_credentials'||b.get('client_id')!=='cid')return j({},400);return j({access_token:'TOK',expires_at:Math.floor(Date.now()/1000)+3600,token_type:'O-Bearer'})}
 if((opt.headers||{}).Authorization!=='O-Bearer TOK')return j({code:'UNAUTH'},401);
 if(url.endsWith('/checkout/v2/pay')){const b=JSON.parse(opt.body);return j({orderId:'OMO123',state:'PENDING',expireAt:Date.now()+1800000,redirectUrl:'https://mercury-uat.phonepe.com/transact/uat_v2?token=x',_echo:b})}
 if(url.includes('/status')){const o=store[0];return j({orderId:'OMO123',state:statusState.state,amount:statusState.amount??Math.round(o.amount*100),paymentDetails:[{transactionId:'TX1',state:statusState.state}]})}
 return j({},404)};
const pp=require('../utils/phonepe');const router=require('../routes/phonepe');
const run=async(path,req)=>{const res={code:200,body:null,status(c){this.code=c;return this},json(b){this.body=b;return this}};const hs=router.routes['post '+path][0];await hs[hs.length-1]({get:h=>(req.headers||{})[h.toLowerCase()],user:{id:'u1',role:'user'},body:req.body||{},params:req.params||{},ip:'1.1.1.1',...req},res);return res};
(async()=>{
 let ok=0,bad=0;const t=(n,c)=>{console.log((c?'PASS':'FAIL')+' '+n);c?ok++:bad++};
 const r1=await run('/create-order',{body:{presetId:'p1'}});
 t('order stored as phonepe, amount 99',store[0].provider==='phonepe'&&store[0].amount===99&&store[0].checkoutUrl);
 const payCall=calls.find(c=>c.endsWith('/checkout/v2/pay'));t('uses sandbox host',payCall.includes('api-preprod.phonepe.com/apis/pg-sandbox'));
 const r2=await run('/create-order',{body:{presetId:'p1'}});t('second request reuses same order',r2.body.reused===true&&r2.body.orderId===r1.body.orderId&&store.length===1);
 t('token fetched once (cached)',calls.filter(c=>c.includes('oauth')).length===1);
 const id=store[0]._id;
 const bad1=await run('/webhook',{headers:{authorization:'wrong'},body:{payload:{merchantOrderId:id}}});t('webhook wrong auth -> 401',bad1.code===401);
 const none=await run('/webhook',{headers:{},body:{}});t('webhook no auth -> 401',none.code===401);
 const good=crypto.createHash('sha256').update('u:p').digest('hex');
 statusState={state:'PENDING'};const w0=await run('/webhook',{headers:{authorization:good},body:{event:'checkout.order.completed',payload:{merchantOrderId:id}}});t('PENDING status keeps order created',store[0].status==='created');
 statusState={state:'COMPLETED',amount:100};await run('/webhook',{headers:{authorization:good},body:{payload:{merchantOrderId:id}}});t('amount mismatch -> suspicious (not paid)',store[0].status==='suspicious');
 store[0].status='created';statusState={state:'COMPLETED'};const w1=await run('/webhook',{headers:{authorization:'SHA256 '+good},body:{payload:{merchantOrderId:id}}});t('COMPLETED + amount ok -> paid',store[0].status==='paid'&&w1.body.outcome==='paid');
 store[0].status='created';statusState={state:'FAILED'};await run('/webhook',{headers:{authorization:good},body:{payload:{merchantOrderId:id}}});t('FAILED -> failed',store[0].status==='failed');
 const other=await run('/webhook',{headers:{authorization:good},body:{payload:{merchantOrderId:'not-ours'}}});t('foreign order id acked quietly',other.code===200&&other.body.received);
 store[0].status='created';statusState={state:'COMPLETED'};const rf=await run('/refresh/:orderId',{params:{orderId:id}});t('refresh endpoint syncs for owner',rf.body.status==='paid');
 console.log(`\n${ok} passed, ${bad} failed`);process.exit(bad?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
