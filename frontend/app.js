/* PresetHub Frontend — production client */
(() => {
  'use strict';

  const API = `${location.origin}/api`;
  const state = {
    user: null,
    token: localStorage.getItem('presethub_token') || '',
    presets: [],
    categories: [],
    creators: [],
    page: 1,
    totalPages: 1,
    query: '',
    price: '',
    sort: 'newest',
    searchTimer: null,
    installPrompt: null,
    currentPreset: null,
  };

  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const esc = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = v => Number(v || 0) <= 0 ? 'Free' : `₹${Number(v).toFixed(2)}`;
  const slug = s => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'preset';
  const presetUrl = p => `/preset/${encodeURIComponent(p.id)}/${slug(p.name)}/`;
  const profileUrl = u => `/profile/${encodeURIComponent(u.id)}/${slug(u.username || u.name)}/`;

  async function api(path, options={}) {
    const headers = new Headers(options.headers || {});
    if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
    if (!(options.body instanceof FormData) && options.body && !headers.has('Content-Type')) headers.set('Content-Type','application/json');
    const res = await fetch(`${API}${path}`, {...options, headers});
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (res.status === 401) {
      state.user = null; state.token = '';
      localStorage.removeItem('presethub_token');
      updateAuthUI();
    }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function toast(message, type='success') {
    const box = $('#toastBox') || (() => {
      const x=document.createElement('div'); x.id='toastBox'; document.body.appendChild(x); return x;
    })();
    const el=document.createElement('div');
    el.className='toast';
    el.setAttribute('role','status');
    el.textContent=String(message);
    box.appendChild(el);
    setTimeout(()=>el.remove(),3500);
  }

  function openModal(html) {
    const overlay = $('#overlay'), body = $('#modalBody');
    if (!overlay || !body) return;
    body.innerHTML = html;
    overlay.classList.add('active');
    document.body.style.overflow='hidden';
  }
  function closeModal() {
    const overlay=$('#overlay');
    if (overlay) overlay.classList.remove('active');
    document.body.style.overflow='';
  }

  function requireAuth(next) {
    if (!state.user) { openAuth('login', next); return false; }
    return true;
  }

  function updateAuthUI() {
    const auth=$('#authSection'), user=$('#userSection'), avatar=$('#avatar'), admin=$('#adminLink');
    if (state.user) {
      if (auth) auth.style.display='none';
      if (user) user.style.display='flex';
      if (avatar) {
        avatar.textContent=(state.user.name || state.user.username || 'U').trim().charAt(0).toUpperCase();
        if (state.user.avatar) {
          avatar.style.backgroundImage=`url("${state.user.avatar}")`;
          avatar.style.backgroundSize='cover';
          avatar.textContent='';
        }
      }
      if (admin) admin.classList.toggle('hidden', state.user.role !== 'admin');
    } else {
      if (auth) auth.style.display='flex';
      if (user) user.style.display='none';
    }
  }

  function presetCard(p) {
    const image = p.previewImage
      ? `<img src="${esc(p.previewImage)}" alt="${esc(p.name)} preview" loading="lazy">`
      : `<div class="preview-fallback" aria-label="Preset preview"><i class="fas fa-sliders"></i><span>Preset Preview</span></div>`;
    const likes = Number(p.likesCount || (p.likes || []).length);
    return `
      <article class="preset-card">
        <div class="thumb">
          ${image}
          <div class="overlay">
            <button class="btn btn-sm" data-action="view-preset" data-id="${esc(p.id)}"><i class="fas fa-eye"></i> Preview</button>
          </div>
        </div>
        <div class="info">
          <span class="tag">${esc(p.category || 'General')}</span>
          <h3>${esc(p.name)}</h3>
          <button class="author-link" data-action="profile" data-id="${esc(p.authorId || '')}">${esc(p.author || 'Creator')}</button>
          <div class="preset-description">${esc(p.description || 'Lightroom preset')}</div>
          <div class="meta">
            <span class="price ${Number(p.price||0)===0?'free':''}">${money(p.price)}</span>
            <span class="rating">★ ${Number(p.avgRating||0).toFixed(1)} · ${p.downloads||0} downloads</span>
          </div>
          <div class="card-actions">
            <button class="icon-action" data-action="wishlist" data-id="${esc(p.id)}" title="Wishlist"><i class="far fa-heart"></i></button>
            <button class="icon-action" data-action="like" data-id="${esc(p.id)}" title="Like">♥ ${likes}</button>
            <a class="icon-action" href="${presetUrl(p)}" title="Open preset page"><i class="fas fa-link"></i></a>
            <button class="btn btn-primary btn-sm" data-action="view-preset" data-id="${esc(p.id)}">Open</button>
          </div>
        </div>
      </article>`;
  }

  async function loadPresets(reset=true) {
    if (reset) state.page=1;
    const params=new URLSearchParams({page:state.page,limit:24,sort:state.sort});
    if (state.query) params.set('q',state.query);
    if (state.price) params.set('price',state.price);
    if (state.category) params.set('category',state.category);
    const grid=$('#presetGrid');
    if (grid && reset) grid.innerHTML='<div class="skeleton" style="height:280px"></div>'.repeat(4);
    try {
      const data=await api(`/presets?${params.toString()}`);
      state.presets=reset ? data.presets : [...state.presets,...data.presets];
      state.totalPages=data.totalPages || 1;
      if (grid) grid.innerHTML=state.presets.length ? state.presets.map(presetCard).join('') :
        `<div class="empty-state"><i class="fas fa-box-open"></i><h3>No presets found</h3><p>Try another search or upload the first preset.</p></div>`;
      const title=$('#listTitle');
      if (title) title.textContent=state.query ? `Search: ${state.query}` : 'सभी Presets';
      $('#statPresets') && ($('#statPresets').textContent=data.total || 0);
      $('#statFree') && ($('#statFree').textContent=state.presets.filter(p=>Number(p.price||0)===0).length);
    } catch (e) {
      if (grid) grid.innerHTML=`<div class="empty-state"><h3>Could not load presets</h3><p>${esc(e.message)}</p><button class="btn btn-primary" data-action="retry">Retry</button></div>`;
    }
  }

  async function loadCategories() {
    try {
      const data=await api('/presets?limit=200&sort=newest');
      const counts={};
      (data.presets||[]).forEach(p=>counts[p.category||'General']=(counts[p.category||'General']||0)+1);
      const cats=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
      state.categories=cats;
      const el=$('#categories');
      if (el) el.innerHTML=cats.length ? cats.map(([name,count])=>`
        <button class="category-card" data-action="category" data-category="${esc(name)}">
          <div class="icon">✦</div><div class="name">${esc(name)}</div><div class="count">${count} presets</div>
        </button>`).join('') : '<p>No categories yet.</p>';
    } catch (_) {}
  }

  async function loadCreators() {
    try {
      const creators=await api('/users/top');
      state.creators=creators;
      const el=$('#creators');
      if (el) el.innerHTML=(creators||[]).map(u=>`
        <button class="creator-card" data-action="profile" data-id="${esc(u.id)}">
          <div class="creator-avatar">${u.avatar ? `<img src="${esc(u.avatar)}" alt="">` : esc((u.name||'U').charAt(0).toUpperCase())}</div>
          <div class="name">${esc(u.name||u.username||'Creator')}</div>
          <div class="stats">${u.presetCount||0} presets · ${u.totalDownloads||0} downloads</div>
          <div class="followers">${u.followers||0} followers</div>
        </button>`).join('');
    } catch (_) {}
  }

  async function showPreset(id) {
    try {
      const p=await api(`/presets/${encodeURIComponent(id)}`);
      state.currentPreset=p;
      let reviews=[];
      try { reviews=await api(`/reviews/${encodeURIComponent(id)}`); } catch (_) {}
      const image=p.previewImage ? `<img src="${esc(p.previewImage)}" alt="${esc(p.name)} preview">` :
        `<div class="preview-fallback large"><i class="fas fa-sliders"></i><span>Preset Preview</span></div>`;
      openModal(`
        <div class="modal-grid">
          <div class="modal-preview">${image}</div>
          <div class="modal-details">
            <span class="tag">${esc(p.category||'General')}</span>
            <h2>${esc(p.name)}</h2>
            <button class="author-link" data-action="profile" data-id="${esc(p.authorId||'')}">by ${esc(p.author||'Creator')}</button>
            <p class="desc">${esc(p.description||'No description yet.')}</p>
            <div class="price-lg ${Number(p.price||0)===0?'free':''}">${money(p.price)}</div>
            <div class="meta-list">
              <span><i class="fas fa-star"></i>${Number(p.avgRating||0).toFixed(1)}</span>
              <span><i class="fas fa-download"></i>${p.downloads||0}</span>
              <span><i class="fas fa-eye"></i>${p.views||0}</span>
              <span><i class="fas fa-heart"></i>${Number(p.likesCount || (p.likes||[]).length)}</span>
            </div>
            <div class="actions">
              <button class="btn btn-primary" data-action="download" data-id="${esc(p.id)}"><i class="fas fa-download"></i> Download</button>
              <button class="btn btn-outline" data-action="wishlist" data-id="${esc(p.id)}"><i class="far fa-heart"></i> Wishlist</button>
              <button class="btn btn-outline" data-action="share" data-id="${esc(p.id)}"><i class="fas fa-share-nodes"></i> Share</button>
              <a class="btn btn-outline" href="${presetUrl(p)}">SEO Page</a>
            </div>
            <div class="review-box">
              <h3>Reviews</h3>
              ${(reviews||[]).slice(-5).reverse().map(r=>`<div class="review"><b>${esc(r.userName)}</b> · ${'★'.repeat(Number(r.rating)||0)}<p>${esc(r.comment)}</p></div>`).join('') || '<p>No reviews yet.</p>'}
              ${state.user ? `<form id="reviewForm" data-preset="${esc(p.id)}"><select name="rating" required><option value="">Rating</option>${[1,2,3,4,5].map(n=>`<option>${n}</option>`).join('')}</select><input name="comment" maxlength="500" placeholder="Write a review…" required><button class="btn btn-primary btn-sm">Post review</button></form>` : ''}
            </div>
          </div>
        </div>`);
      try { await api(`/presets/${encodeURIComponent(id)}/view`,{method:'POST'}); } catch (_) {}
    } catch(e) { toast(e.message,'error'); }
  }

  async function downloadPreset(id) {
    if (!requireAuth()) return;
    try {
      const p=state.currentPreset?.id===id ? state.currentPreset : await api(`/presets/${id}`);
      if (Number(p.price||0)>0 && p.authorId!==state.user.id) {
        return startPayment(p);
      }
      const res=await fetch(`${API}/presets/${encodeURIComponent(id)}/download`,{method:'POST',headers:{Authorization:`Bearer ${state.token}`}});
      if (!res.ok) {
        const d=await res.json().catch(()=>({}));
        throw new Error(d.error||'Download failed');
      }
      const blob=await res.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a'); a.href=url; a.download=p.originalName||`${slug(p.name)}.xmp`; a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      toast('Download started');
    } catch(e) { toast(e.message,'error'); }
  }

  async function startPayment(p) {
    if (!requireAuth()) return;
    try {
      if (!window.Razorpay) {
        await new Promise((resolve,reject)=>{
          const s=document.createElement('script'); s.src='https://checkout.razorpay.com/v1/checkout.js'; s.onload=resolve; s.onerror=reject; document.head.appendChild(s);
        });
      }
      const order=await api('/payments/create-order',{method:'POST',body:JSON.stringify({presetId:p.id})});
      const rz=new Razorpay({
        key:order.key, amount:order.amount, currency:order.currency, order_id:order.orderId,
        name:'PresetHub', description:p.name,
        prefill:{name:state.user.name,email:state.user.email},
        theme:{color:'#d4a373'},
        handler:async response=>{
          try {
            await api('/payments/verify',{method:'POST',body:JSON.stringify(response)});
            toast('Payment verified. You can download now.');
            downloadPreset(p.id);
          } catch(e){ toast(e.message,'error'); }
        }
      });
      rz.open();
    } catch(e){ toast(e.message,'error'); }
  }

  async function toggleWishlist(id) {
    if (!requireAuth()) return;
    try {
      const d=await api(`/users/me/wishlist/${id}`,{method:'POST'});
      toast(d.wishlist?.includes(id)?'Added to wishlist':'Removed from wishlist');
    } catch(e){toast(e.message,'error');}
  }

  async function likePreset(id) {
    if (!requireAuth()) return;
    try {
      const d=await api(`/presets/${id}/like`,{method:'POST'});
      toast(d.liked?'Liked':'Like removed');
      loadPresets(false);
    } catch(e){toast(e.message,'error');}
  }

  async function sharePreset(id) {
    try {
      const p=state.currentPreset?.id===id?state.currentPreset:await api(`/presets/${id}`);
      const url=new URL(presetUrl(p),location.origin).href;
      if (navigator.share) await navigator.share({title:p.name,text:`${p.name} on PresetHub`,url});
      else { await navigator.clipboard.writeText(url); toast('Link copied'); }
      if (state.user) api(`/presets/${id}/share`,{method:'POST'}).catch(()=>{});
    } catch(e) { if(e.name!=='AbortError') toast(e.message,'error'); }
  }

  async function showProfile(id) {
    try {
      const u=await api(`/users/${encodeURIComponent(id)}`);
      const presets=await api(`/users/${encodeURIComponent(id)}/presets`);
      let following=false;
      if(state.user && state.user.id!==u.id){
        try { following=(await api(`/users/${encodeURIComponent(id)}/follow-status`)).following; } catch(_){}
      }
      openModal(`
        <div class="profile-view">
          <div class="profile-head">
            <div class="profile-avatar">${u.avatar?`<img src="${esc(u.avatar)}" alt="">`:esc((u.name||'U').charAt(0).toUpperCase())}</div>
            <div><h2>${esc(u.name||u.username||'Creator')}</h2><p>@${esc(u.username||'creator')}</p><p>${esc(u.bio||'')}</p></div>
            ${state.user && state.user.id!==u.id ? `<button class="btn btn-primary" data-action="follow" data-id="${esc(u.id)}">${following?'Following':'Follow'}</button>`:''}
          </div>
          <div class="profile-stats"><b>${u.totalPresets||0}<span>Presets</span></b><b>${u.totalDownloads||0}<span>Downloads</span></b><b>${u.followers||0}<span>Followers</span></b></div>
          <div class="social-row">${Object.entries(u.socialLinks||{}).filter(([,v])=>v).map(([k,v])=>`<a class="social-icon" href="${esc(v)}" target="_blank" rel="noopener">${esc(k)}</a>`).join('')}</div>
          <h3>Presets</h3><div class="mini-preset-grid">${(presets||[]).map(presetCard).join('')||'<p>No presets yet.</p>'}</div>
        </div>`);
    } catch(e){toast(e.message,'error');}
  }

  function openAuth(mode='login', after=null) {
    openModal(`
      <div class="auth-box">
        <h2>${mode==='login'?'Welcome back':'Create your PresetHub account'}</h2>
        <form id="authForm" data-mode="${mode}">
          ${mode==='signup'?'<div class="form-group"><label>Name</label><input name="name" maxlength="50" required></div><div class="form-group"><label>Username</label><input name="username" minlength="3" maxlength="30" pattern="[A-Za-z0-9_]+" required></div>':''}
          <div class="form-group"><label>Email</label><input type="email" name="email" required autocomplete="email"></div>
          <div class="form-group"><label>Password</label><input type="password" name="password" minlength="8" required autocomplete="${mode==='login'?'current-password':'new-password'}"></div>
          ${mode==='signup'?'<small>Use at least 8 characters with upper/lowercase and a number.</small>':''}
          <button class="btn btn-primary" type="submit">${mode==='login'?'Log in':'Sign up'}</button>
        </form>
        <button class="text-button" data-action="switch-auth" data-mode="${mode==='login'?'signup':'login'}">${mode==='login'?'Create account':'Already have an account? Log in'}</button>
      </div>`);
  }

  async function submitAuth(form) {
    const mode=form.dataset.mode, data=Object.fromEntries(new FormData(form).entries());
    try {
      const r=await api(`/auth/${mode}`,{method:'POST',body:JSON.stringify(data)});
      state.token=r.token; state.user=r.user;
      localStorage.setItem('presethub_token',state.token);
      updateAuthUI(); closeModal(); toast(mode==='login'?'Logged in':'Account created');
      await loadPresets(); 
    } catch(e){toast(e.message,'error');}
  }

  async function openAccount() {
    if (!requireAuth()) return;
    const u=await api('/auth/me');
    state.user=u.user;
    openModal(`
      <div class="account-panel">
        <h2>My Account</h2>
        <div class="account-actions">
          <button class="btn btn-outline" data-action="my-profile">Profile</button>
          <button class="btn btn-outline" data-action="wishlist-page">Wishlist</button>
          <button class="btn btn-outline" data-action="downloads">Downloads</button>
          <button class="btn btn-outline" data-action="notifications">Notifications</button>
          <button class="btn btn-accent" data-action="upload">Upload Preset</button>
          <button class="btn btn-danger" data-action="logout">Log out</button>
        </div>
        <form id="profileForm">
          <div class="form-group"><label>Name</label><input name="name" value="${esc(u.user.name||'')}" maxlength="50"></div>
          <div class="form-group"><label>Username</label><input name="username" value="${esc(u.user.username||'')}" minlength="3" maxlength="30"></div>
          <div class="form-group"><label>Bio</label><textarea name="bio" maxlength="500">${esc(u.user.bio||'')}</textarea></div>
          <button class="btn btn-primary">Save profile</button>
        </form>
      </div>`);
  }

  async function showWishlist() {
    if (!requireAuth()) return;
    try {
      const u=await api('/auth/me');
      const ids=u.user.wishlist||[];
      const list=[];
      for(const id of ids){ try{ list.push(await api(`/presets/${id}`)); }catch(_){} }
      openModal(`<h2>My Wishlist</h2><div class="mini-preset-grid">${list.map(presetCard).join('')||'<p>Your wishlist is empty.</p>'}</div>`);
    } catch(e){toast(e.message,'error');}
  }

  async function showDownloads() {
    if (!requireAuth()) return;
    try {
      const list=await api('/users/me/downloads');
      openModal(`<h2>My Downloads</h2><div class="mini-preset-grid">${(list||[]).map(presetCard).join('')||'<p>No downloads yet.</p>'}</div>`);
    } catch(e){toast(e.message,'error');}
  }

  async function showNotifications() {
    if (!requireAuth()) return;
    try {
      const list=await api('/users/me/notifications');
      openModal(`<h2>Notifications</h2><div class="notification-list">${(list||[]).map(n=>`<div class="notification ${n.read?'':'unread'}"><b>${esc(n.type)}</b><p>${esc(n.message)}</p><small>${new Date(n.createdAt).toLocaleString()}</small></div>`).join('')||'<p>No notifications.</p>'}<button class="btn btn-outline" data-action="read-notifications">Mark all read</button></div>`);
    } catch(e){toast(e.message,'error');}
  }

  function openUpload() {
    if (!requireAuth()) return;
    openModal(`
      <div class="upload-panel">
        <h2>Upload your preset</h2>
        <p>Accepted: .xmp, .dng, .lrtemplate. Max 50MB.</p>
        <form id="uploadForm" enctype="multipart/form-data">
          <div class="form-group"><label>Preset name</label><input name="name" required maxlength="100"></div>
          <div class="form-group"><label>Description</label><textarea name="description" maxlength="500"></textarea></div>
          <div class="form-group"><label>Category</label><input name="category" maxlength="50" placeholder="Natural, Vintage…"></div>
          <div class="form-group"><label>Tags</label><input name="tags" maxlength="300" placeholder="portrait, warm, mobile"></div>
          <div class="form-group"><label>Price (INR)</label><input name="price" type="number" min="0" max="999999.99" step="0.01" value="0"></div>
          <div class="form-group"><label>Preset file</label><input name="file" type="file" accept=".xmp,.dng,.lrtemplate" required></div>
          <div class="form-group"><label>Preview image</label><input name="previewImage" type="file" accept="image/png,image/jpeg,image/webp"></div>
          <button class="btn btn-accent" type="submit">Submit for review</button>
        </form>
      </div>`);
  }

  async function submitUpload(form) {
    const fd=new FormData(form);
    const tags=String(fd.get('tags')||'').split(',').map(x=>x.trim()).filter(Boolean).slice(0,10);
    fd.delete('tags'); tags.forEach(t=>fd.append('tags',t));
    try {
      const r=await api('/presets',{method:'POST',body:fd});
      closeModal(); toast('Preset uploaded and sent for admin approval'); 
      loadPresets();
      location.hash=`preset-${r.id}`;
    } catch(e){toast(e.message,'error');}
  }

  async function follow(id) {
    if (!requireAuth()) return;
    try { const r=await api(`/users/${id}/follow`,{method:'POST'}); toast(r.following?'Followed':'Unfollowed'); showProfile(id); }
    catch(e){toast(e.message,'error');}
  }

  async function submitReview(form) {
    try {
      await api(`/reviews/${form.dataset.preset}`,{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form).entries()))});
      toast('Review added'); showPreset(form.dataset.preset);
    } catch(e){toast(e.message,'error');}
  }

  function googleSearch(q) {
    q=String(q||'').trim();
    if (!q) return;
    const url=`https://www.google.com/search?q=${encodeURIComponent(`site:presethub.site ${q} Lightroom preset`)}`;
    window.open(url,'_blank','noopener');
  }

  async function suggestions(q) {
    const box=$('#searchSuggestions');
    if(!box) return;
    if(q.length<2){box.hidden=true;return;}
    try {
      const r=await api(`/presets/search?q=${encodeURIComponent(q)}`);
      const rows=(r||[]).slice(0,7).map(p=>`<button class="suggestion-item" data-action="view-preset" data-id="${esc(p.id)}"><strong>${esc(p.name)}</strong><small> ${esc(p.author||'')}</small></button>`);
      rows.push(`<button class="suggestion-item google-suggestion" data-action="google-search" data-query="${esc(q)}"><strong>🔎 Google पर खोजें</strong><small>site:presethub.site</small></button>`);
      box.innerHTML=rows.join(''); box.hidden=false;
    } catch(_){ box.innerHTML=`<button class="suggestion-item" data-action="google-search" data-query="${esc(q)}"><strong>🔎 Google पर खोजें</strong></button>`; box.hidden=false; }
  }

  function installPWA() {
    if (state.installPrompt) {
      state.installPrompt.prompt();
      state.installPrompt.userChoice.finally(()=>{state.installPrompt=null;});
    } else {
      toast('Browser menu → Add to Home screen / Install app', 'info');
    }
  }

  function registerSW() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
    window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.installPrompt=e;});
  }

  async function bootstrap() {
    const savedTheme=localStorage.getItem('presethub_theme');
    if(savedTheme==='dark') document.body.classList.add('dark');
    registerSW();
    if(state.token){
      try { const r=await api('/auth/me'); state.user=r.user; } catch(_){}
    }
    updateAuthUI();
    await Promise.all([loadPresets(),loadCategories(),loadCreators()]);
    const params=new URLSearchParams(location.search);
    if(params.get('q')){
      state.query=params.get('q').trim();
      const input=$('#searchInput'); if(input) input.value=state.query;
      await loadPresets();
    }
    if(params.get('action')==='search') $('#searchInput')?.focus();
    if(params.get('action')==='wishlist') showWishlist();
    if(params.get('action')==='upload') openUpload();
    if(params.get('action')==='profile') openAccount();
  }

  document.addEventListener('click', async e=>{
    const el=e.target.closest('[data-action]');
    if(!el) return;
    const action=el.dataset.action;
    if(action==='close'){closeModal();return;}
    if(action==='login'){openAuth('login');return;}
    if(action==='signup'){openAuth('signup');return;}
    if(action==='account'){openAccount();return;}
    if(action==='logout'){state.token='';state.user=null;localStorage.removeItem('presethub_token');updateAuthUI();closeModal();toast('Logged out');return;}
    if(action==='upload'){openUpload();return;}
    if(action==='wishlist'||action==='wishlist-page'){action==='wishlist'?toggleWishlist(el.dataset.id):showWishlist();return;}
    if(action==='downloads'){showDownloads();return;}
    if(action==='notifications'){showNotifications();return;}
    if(action==='read-notifications'){if(requireAuth()){await api('/users/notifications/read-all',{method:'POST'});showNotifications();}return;}
    if(action==='my-profile'){showProfile(state.user.id);return;}
    if(action==='view-preset'){showPreset(el.dataset.id);return;}
    if(action==='download'){downloadPreset(el.dataset.id);return;}
    if(action==='like'){likePreset(el.dataset.id);return;}
    if(action==='share'){sharePreset(el.dataset.id);return;}
    if(action==='profile'){showProfile(el.dataset.id);return;}
    if(action==='follow'){follow(el.dataset.id);return;}
    if(action==='switch-auth'){openAuth(el.dataset.mode);return;}
    if(action==='google-search'){googleSearch(el.dataset.query);return;}
    if(action==='retry'){loadPresets();return;}
    if(action==='category'){state.query='';state.category=el.dataset.category;loadPresets();return;}
    if(action==='install'){installPWA();return;}
    if(action==='theme'){
      document.body.classList.toggle('dark');
      localStorage.setItem('presethub_theme',document.body.classList.contains('dark')?'dark':'light');
      const icon=el.querySelector('i'); if(icon) icon.className=document.body.classList.contains('dark')?'fas fa-sun':'fas fa-moon';
      return;
    }
  });

  document.addEventListener('submit', async e=>{
    if(e.target.id==='searchForm'){
      e.preventDefault(); state.query=$('#searchInput')?.value.trim()||''; $('#searchSuggestions')?.setAttribute('hidden',''); loadPresets(); return;
    }
    if(e.target.id==='authForm'){e.preventDefault();submitAuth(e.target);return;}
    if(e.target.id==='uploadForm'){e.preventDefault();submitUpload(e.target);return;}
    if(e.target.id==='profileForm'){
      e.preventDefault(); if(!requireAuth()) return;
      try { const r=await api('/auth/profile',{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))}); state.user=r.user;updateAuthUI();toast('Profile updated'); }
      catch(err){toast(err.message,'error');}
      return;
    }
    if(e.target.id==='reviewForm'){e.preventDefault();submitReview(e.target);return;}
  });

  $('#searchInput')?.addEventListener('input', e=>{
    clearTimeout(state.searchTimer);
    state.searchTimer=setTimeout(()=>suggestions(e.target.value.trim()),220);
  });
  document.addEventListener('click',e=>{if(!e.target.closest('.nav-search')){$('#searchSuggestions')?.setAttribute('hidden','');}});
  $('#priceFilter')?.addEventListener('change',e=>{state.price=e.target.value;loadPresets();});
  $('#sortFilter')?.addEventListener('change',e=>{state.sort=e.target.value;loadPresets();});
  $('#overlay')?.addEventListener('click',e=>{if(e.target.id==='overlay')closeModal();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});

  window.PresetHub={showPreset,showProfile,openUpload,openAuth,installPWA};
  window.addEventListener('DOMContentLoaded',bootstrap);
})();
