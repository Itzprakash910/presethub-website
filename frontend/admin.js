(() => {
'use strict';
const API=location.origin+'/api';
const token=localStorage.getItem('presethub_token')||'';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,opts={}){
 const h=new Headers(opts.headers||{}); h.set('Authorization',`Bearer ${token}`);
 if(opts.body&&!h.has('Content-Type'))h.set('Content-Type','application/json');
 const r=await fetch(API+path,{...opts,headers:h}); const d=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(d.error||`Request failed (${r.status})`); return d;
}
function msg(t,type='success'){const x=$('#message');x.textContent=t;x.className=type;setTimeout(()=>x.className='',3500)}
async function load(){
 try{
  const [a,p,u,o,s]=await Promise.all([api('/admin/analytics'),api('/admin/presets'),api('/admin/users'),api('/admin/orders'),api('/admin/stats')]);
  $('#analytics').innerHTML=Object.entries({...a,...s}).map(([k,v])=>`<div class="stat-item"><div class="num">${esc(v)}</div><div class="label">${esc(k)}</div></div>`).join('');
  $('#presetsList').innerHTML=(p||[]).map(x=>`<div class="preset-item"><div><b>${esc(x.name)}</b><span class="status-badge status-${esc(x.status||'pending')}">${esc(x.status||'pending')}</span><br><small>${esc(x.author||'')} · ₹${Number(x.price||0).toFixed(2)}</small></div><div class="actions">${['approved','pending','rejected'].map(st=>`<button class="btn btn-sm ${st==='rejected'?'btn-danger':'btn-outline'}" data-preset="${esc(x.id)}" data-status="${st}">${st}</button>`).join('')}</div></div>`).join('')||'<p>No presets.</p>';
  $('#usersList').innerHTML=`<table class="user-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Verified</th><th>Action</th></tr></thead><tbody>${(u||[]).map(x=>`<tr><td>${esc(x.name||x.username||'')}</td><td>${esc(x.email||'')}</td><td>${esc(x.role||'user')}</td><td>${x.verified?'Yes':'No'}</td><td>${x.role==='admin'?'Admin':`<button class="btn btn-danger btn-sm" data-user="${esc(x.id)}">Delete</button>`}</td></tr>`).join('')}</tbody></table>`;
  window.__orders=o;
 }catch(e){msg(e.message,'error'); if(/401|403/.test(e.message))setTimeout(()=>location.href='/',1000)}
}
document.addEventListener('click',async e=>{
 const p=e.target.closest('[data-preset]'); const u=e.target.closest('[data-user]');
 try{
  if(p){await api(`/admin/presets/${p.dataset.preset}/status`,{method:'PUT',body:JSON.stringify({status:p.dataset.status})});msg('Preset status updated');load()}
  if(u && confirm('Delete this user?')){await api(`/admin/users/${u.dataset.user}`,{method:'DELETE'});msg('User deleted');load()}
 }catch(err){msg(err.message,'error')}
});
load();
})();
