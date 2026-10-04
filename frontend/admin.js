(() => {
  'use strict';
  const API = location.origin + '/api';
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let busy = false;
  let userTimer = null;
  let userPage = 1;
  const userLimit = 50;

  function csrfToken() {
    const match = document.cookie.match(/(?:^|; )ph_csrf=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }
  async function api(path, opts = {}) {
    const headers = new Headers(opts.headers || {});
    const method = String(opts.method || 'GET').toUpperCase();
    if (!['GET','HEAD','OPTIONS'].includes(method)) {
      const csrf = csrfToken();
      if (csrf) headers.set('X-CSRF-Token', csrf);
    }
    if (opts.body && !(opts.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const r = await fetch(API + path, {...opts, headers, credentials:'same-origin'});
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
    return d;
  }
  function msg(text, type='success') {
    const box = $('#message'); if (!box) return;
    box.innerHTML = `<i class="fas ${type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check'}"></i><span>${esc(text)}</span><button type="button" aria-label="Close">×</button>`;
    box.className = `admin-message ${type}`;
    box.querySelector('button')?.addEventListener('click', () => { box.className=''; });
    clearTimeout(msg.timer); msg.timer=setTimeout(()=>box.className='',5000);
  }
  function setLoading(on){busy=on; $('#refreshAdmin')?.toggleAttribute('disabled',on);}
  const fmt = n => Number(n || 0).toLocaleString('en-IN');

  async function loadOverview(){
    const [d,pay] = await Promise.all([api('/admin/dashboard'), api('/admin/payments')]);
    const rows = [
      ['Users',d.users?.total],['Online',d.users?.online],['New today',d.users?.newToday],['Presets',d.presets?.total],
      ['Approved',d.presets?.approved],['Free',d.presets?.free],['Downloads',d.engagement?.downloads],['Views',d.engagement?.views],
      ['Likes',d.engagement?.likes],['Shares',d.engagement?.shares],['Orders',pay.totalOrders],['Revenue',`₹${Number(pay.totalRevenue||0).toFixed(2)}`]
    ];
    $('#analytics').innerHTML = rows.map(([k,v])=>`<div class="stat-item"><div class="num">${esc(typeof v==='number'?fmt(v):v)}</div><div class="label">${esc(k)}</div></div>`).join('');
  }

  async function loadPresets(){
    const p=await api('/admin/presets?limit=50');
    $('#presetsList').innerHTML=(p.items||[]).map(x=>`<div class="preset-item"><div class="preset-main"><b>${esc(x.name)}</b><span class="status-badge status-${esc(x.status||'approved')}">${esc(x.status||'approved')}</span><br><small>${esc(x.author||'')} · ${fmt(x.downloads)} downloads · ${fmt(x.views)} views · ₹${Number(x.price||0).toFixed(2)}</small></div><div class="actions">${['approved','rejected'].map(st=>`<button class="btn btn-sm ${st==='rejected'?'btn-danger':'btn-outline'}" data-preset="${esc(x.id)}" data-status="${st}" ${x.status===st?'disabled':''}>${st}</button>`).join('')}</div></div>`).join('')||'<p>No presets.</p>';
  }

  async function loadUsers(search=''){
    const q=search?`&search=${encodeURIComponent(search)}`:'';
    const u=await api(`/admin/users?page=${userPage}&limit=${userLimit}${q}`);
    $('#usersList').innerHTML=`<table class="user-table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Activity</th><th>Creator stats</th><th>Control</th></tr></thead><tbody>${(u.items||[]).map(x=>{
      const blocked=x.status==='blocked'||x.status==='deactivated';
      return `<tr><td><b>${esc(x.name||x.username||'')}</b><br><small>@${esc(x.username||'user')} · ${esc(x.email||'')}</small></td><td>${esc(x.role||'user')}</td><td><span class="status-badge status-${esc(x.status||'active')}">${esc(x.status||'active')}</span>${x.online?'<small> · online</small>':''}</td><td>${fmt(x.stats?.userDownloads)} downloads · ${fmt(x.stats?.totalOrders)} orders · ₹${Number(x.stats?.totalSpent||0).toFixed(0)} spent</td><td>${fmt(x.stats?.totalPresets)} presets · ${fmt(x.stats?.views)} views · ${fmt(x.stats?.downloads)} downloads · ₹${Number(x.stats?.creatorRevenue||0).toFixed(0)}</td><td class="actions"><button class="btn btn-sm btn-outline" data-user-details="${esc(x.id)}">Details</button>${x.role!=='admin'?`<button class="btn btn-sm ${blocked?'btn-outline':'btn-danger'}" data-user-status="${esc(x.id)}" data-next-status="${blocked?'active':'blocked'}">${blocked?'Activate':'Block'}</button><button class="btn btn-sm btn-danger" data-user-delete="${esc(x.id)}">Delete</button><button class="btn btn-sm btn-outline" data-user-notify="${esc(x.id)}">Notify</button>`:''}</td></tr>`;
    }).join('')}</tbody></table><div class="admin-pagination"><span>Page ${u.page||1} / ${u.totalPages||1}</span><button class="btn btn-sm btn-outline" data-user-page="prev" ${userPage<=1?'disabled':''}>Previous</button><button class="btn btn-sm btn-outline" data-user-page="next" ${userPage>=(u.totalPages||1)?'disabled':''}>Next</button></div>`;
  }

  async function loadAds(){
    const r=await api('/admin/ads');
    $('#adsList').innerHTML=(r.items||[]).map(a=>`<div class="admin-ad-item"><img src="${esc(a.imageUrl||'/assets/images/og-image.png')}" alt="" loading="lazy" onerror="this.src='/assets/images/og-image.png'"><div class="admin-ad-meta"><b>${esc(a.title)}</b><small>${esc(a.productName||'')} · ${a.active?'LIVE':'OFF'} · ${fmt(a.impressions)} impressions · ${fmt(a.clicks)} clicks</small><br><small>${esc(a.description||'')}</small></div><div class="admin-ad-actions"><button class="btn btn-sm btn-outline" data-ad-edit="${esc(a.id)}">Edit</button><button class="btn btn-sm btn-danger" data-ad-delete="${esc(a.id)}">Delete</button></div></div>`).join('')||'<p>No ads created yet.</p>';
    window.__adminAds=r.items||[];
  }

  function clearAdForm(){
    const f=$('#adForm'); if(!f) return; f.reset(); f.id.value=''; f.active.checked=true; f.badge.value='Featured'; f.linkUrl.value='/';
  }
  function fillAdForm(a){
    const f=$('#adForm'); if(!f) return; f.id.value=a.id; f.title.value=a.title||''; f.description.value=a.description||''; f.imageUrl.value=a.imageUrl||''; f.productName.value=a.productName||''; f.originalPrice.value=a.originalPrice||0; f.salePrice.value=a.salePrice||0; f.discountPercent.value=a.discountPercent||0; f.badge.value=a.badge||'Featured'; f.linkUrl.value=a.linkUrl||'/'; f.active.checked=!!a.active; f.scrollIntoView({behavior:'smooth',block:'center'});
  }

  async function load(){
    if(busy)return; setLoading(true);
    try{await Promise.all([loadOverview(),loadPresets(),loadUsers($('#userSearch')?.value.trim()||''),loadAds()]);msg('Admin data refreshed');}
    catch(e){msg(e.message,'error'); if(/Authentication|Admin|login/i.test(e.message)) setTimeout(()=>location.href='/',800);}
    finally{setLoading(false);}
  }

  $('#refreshAdmin')?.addEventListener('click',load);
  $('#adminHome')?.addEventListener('click',()=>location.href='/');
  $('#themeAdmin')?.addEventListener('click',()=>{document.body.classList.toggle('dark');localStorage.setItem('presethub_theme',document.body.classList.contains('dark')?'dark':'light');const i=$('#themeAdmin i');if(i)i.className=document.body.classList.contains('dark')?'fas fa-sun':'fas fa-moon';});
  $('#clearAd')?.addEventListener('click',clearAdForm);
  $('#userSearch')?.addEventListener('input',e=>{clearTimeout(userTimer);userPage=1;userTimer=setTimeout(()=>loadUsers(e.target.value.trim()).catch(x=>msg(x.message,'error')),280);});

  $('#broadcastForm')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;const data=Object.fromEntries(new FormData(f).entries());try{await api('/admin/notifications/all',{method:'POST',body:JSON.stringify(data)});f.reset();f.link.value='/';msg('Notification सभी active users को भेज दी गई');}catch(x){msg(x.message,'error');}});

  $('#adForm')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;const data=Object.fromEntries(new FormData(f).entries());data.active=f.active.checked;['originalPrice','salePrice','discountPercent'].forEach(k=>data[k]=Number(data[k]||0));const id=data.id;delete data.id;try{await api(id?`/admin/ads/${encodeURIComponent(id)}`:'/admin/ads',{method:id?'PUT':'POST',body:JSON.stringify(data)});clearAdForm();await loadAds();msg(id?'Ad updated':'Ad created and ready for home screen');}catch(x){msg(x.message,'error');}});

  document.addEventListener('click',async e=>{
    const p=e.target.closest('[data-preset]');
    const ud=e.target.closest('[data-user-details]');
    const us=e.target.closest('[data-user-status]');
    const del=e.target.closest('[data-user-delete]');
    const un=e.target.closest('[data-user-notify]');
    const ae=e.target.closest('[data-ad-edit]');
    const ax=e.target.closest('[data-ad-delete]');
    const pg=e.target.closest('[data-user-page]');
    try{
      if(p){await api(`/admin/presets/${p.dataset.preset}/status`,{method:'PUT',body:JSON.stringify({status:p.dataset.status})});msg('Preset status updated');return loadPresets();}
      if(ud){const r=await api(`/admin/users/${ud.dataset.userDetails}/details`);const u=r.user||r;alert(`User: ${u.name||''}\nEmail: ${u.email||''}\nRole: ${u.role||''}\nStatus: ${u.status||''}\nFollowers: ${r.profile?.followers||0}\nFollowing: ${r.profile?.following||0}\nPresets: ${(r.presets||[]).length}\nOrders: ${r.payments?.totalOrders||0}\nSpent: ₹${Number(r.payments?.totalSpent||0).toFixed(2)}\nDownloads: ${(r.downloads||[]).length}`);return;}
      if(us){await api(`/admin/users/${us.dataset.userStatus}/status`,{method:'PUT',body:JSON.stringify({status:us.dataset.nextStatus})});msg(`User ${us.dataset.nextStatus}`);return loadUsers($('#userSearch')?.value.trim()||'');}
      if(del){if(!confirm('इस user को permanently delete करना है? यह वापस नहीं होगा।'))return;await api(`/admin/users/${del.dataset.userDelete}`,{method:'DELETE'});msg('User permanently deleted');return loadUsers($('#userSearch')?.value.trim()||'');}
      if(un){const text=prompt('User को कौन सा message भेजना है?','PresetHub से नई जानकारी');if(!text)return;await api(`/admin/notifications/user/${un.dataset.userNotify}`,{method:'POST',body:JSON.stringify({message:text,link:'/',type:'admin'})});msg('User notification sent');return;}
      if(ae){const a=(window.__adminAds||[]).find(x=>x.id===ae.dataset.adEdit);if(a)fillAdForm(a);return;}
      if(ax){if(!confirm('इस ad को delete करना है?'))return;await api(`/admin/ads/${ax.dataset.adDelete}`,{method:'DELETE'});msg('Ad deleted');return loadAds();}
      if(pg){if(pg.dataset.userPage==='prev'&&userPage>1)userPage--;if(pg.dataset.userPage==='next')userPage++;return loadUsers($('#userSearch')?.value.trim()||'');}
    }catch(x){msg(x.message,'error');}
  });

  document.body.classList.toggle('dark',localStorage.getItem('presethub_theme')==='dark');
  const themeIcon=$('#themeAdmin i');if(themeIcon)themeIcon.className=document.body.classList.contains('dark')?'fas fa-sun':'fas fa-moon';
  load();
})();
