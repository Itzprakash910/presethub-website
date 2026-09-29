const fs=require('fs');
const path=require('path');
const bcrypt=require('bcryptjs');

const DB_PATH=path.join(__dirname,'../../db.json');
let dbData=null;
let dbPromise=null;

function baseData(){
  return {users:[],presets:[],downloads:[],orders:[],categories:['Sunset','Black & White','Natural','Vintage','Cityscape']};
}
function migrateData(data){
  let changed=false;
  const base=baseData();
  for(const k of Object.keys(base)) if(data[k]===undefined){data[k]=base[k];changed=true;}
  for(const u of data.users){
    if(!u.subscription){u.subscription={tier:'free',expiry:null,adWatchCount:0,adRewardDays:0,lastAdWatch:null};changed=true;}
    if(!u.referral){u.referral={code:null,referredBy:null,referralCount:0,referralRewardDays:0};changed=true;}
    for(const k of ['notifications','followers','following','wishlist']) if(!u[k]){u[k]=[];changed=true;}
    if(!u.socialLinks){u.socialLinks={instagram:'',youtube:'',twitter:'',website:''};changed=true;}
    if(u.verified===undefined){u.verified=true;changed=true;}
  }
  for(const p of data.presets){
    if(p.views===undefined){p.views=0;changed=true;}
    if(!p.likes){p.likes=[];changed=true;}
    if(p.shares===undefined){p.shares=0;changed=true;}
    if(p.adImpressions===undefined){p.adImpressions=0;changed=true;}
    if(p.totalRevenue===undefined){p.totalRevenue=0;changed=true;}
    if(!p.status){p.status='pending';changed=true;}
    if(!p.reviews){p.reviews=[];changed=true;}
    if(!p.tags){p.tags=[];changed=true;}
  }
  if(changed) saveData(data);
  return data;
}
function loadData(){
  if(!fs.existsSync(DB_PATH)){
    dbData=baseData(); saveData(dbData); return;
  }
  try{
    dbData=migrateData(JSON.parse(fs.readFileSync(DB_PATH,'utf8')));
  }catch(err){
    console.error('Database read failed:',err.message);
    dbData=baseData();
  }
}
function saveData(data=dbData){
  const tmp=`${DB_PATH}.tmp`;
  fs.writeFileSync(tmp,JSON.stringify(data,null,2),'utf8');
  fs.renameSync(tmp,DB_PATH);
}
async function getDB(){
  if(!dbPromise){
    loadData();
    dbPromise=Promise.resolve({
      data:dbData,
      write:async()=>saveData(dbData),
      read:()=>{loadData();}
    });
  }
  return dbPromise;
}
async function initAdmin(){
  const email=String(process.env.ADMIN_EMAIL||'').trim().toLowerCase();
  const password=String(process.env.ADMIN_PASSWORD||'');
  if(!email || !password) return;
  if(password.length<12){console.warn('ADMIN_PASSWORD should be at least 12 characters.');return;}
  const db=await getDB();
  let user=db.data.users.find(u=>u.email===email);
  if(!user){
    user={
      id:`admin_${Date.now()}`,email,password:await bcrypt.hash(password,12),
      name:'Admin',username:'admin',role:'admin',createdAt:new Date().toISOString(),
      verified:true,bio:'',avatar:'',socialLinks:{instagram:'',youtube:'',twitter:'',website:''},
      followers:[],following:[],wishlist:[],notifications:[],
      subscription:{tier:'free',expiry:null,adWatchCount:0,adRewardDays:0,lastAdWatch:null},
      referral:{code:null,referredBy:null,referralCount:0,referralRewardDays:0}
    };
    db.data.users.push(user); await db.write();
    console.log(`Admin account initialized for ${email}`);
  }else if(user.role!=='admin'){
    user.role='admin'; await db.write();
  }
}
initAdmin().catch(err=>console.error('Admin bootstrap failed:',err.message));
module.exports={getDB};
