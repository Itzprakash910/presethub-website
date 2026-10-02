/* PresetHub Frontend — production client v2.0 */
(() => {
  'use strict';

  const API = `${location.origin}/api`;
  const state = {
    user: null,
    token: localStorage.getItem('presethub_token') || '',
    presets: [],
    categories: [],
    category: '',
    creators: [],
    page: 1,
    totalPages: 1,
    query: '',
    price: '',
    sort: 'newest',
    searchTimer: null,
    installPrompt: null,
    currentPreset: null,
    selected: new Set(),
    featured: [],
    cacheTTL: 5 * 60 * 1000,
    pendingUploads: new Map(),
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v = '') => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = v => Number(v || 0) <= 0 ? 'Free' : `₹${Number(v).toFixed(2)}`;
  const slug = s => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset';
  const presetUrl = p => `/preset/${encodeURIComponent(p.id)}/${slug(p.name)}/`;
  const profileUrl = u => `/profile/${encodeURIComponent(u.id)}/${slug(u.username || u.name)}/`;
  const safeExternal = v => /^(https?:\/\/|mailto:)/i.test(String(v || '')) ? String(v) : '#';
  const fallbackPreview = `${location.origin}/assets/images/og-image.png`;
  const assetUrl = v => { const x = String(v || '').trim(); if (!x) return fallbackPreview; if (/^https?:\/\//i.test(x)) return x; if (x.startsWith('/')) return `${location.origin}${x}`; if (x.startsWith('uploads/')) return `${location.origin}/${x}`; if (/^(previews|presets|avatars)\//i.test(x)) return `${location.origin}/uploads/${x}`; return fallbackPreview; };
  const imgTag = (src, alt, cls='') => `<img class="${cls}" src="${esc(assetUrl(src))}" alt="${esc(alt)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${fallbackPreview}'">`;

  // ============ PERSISTENT CLIENT QUEUE / CACHE ============
  const UPLOAD_DB = 'presethub-client-v2';
  const UPLOAD_STORE = 'queue';
  function openUploadDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open(UPLOAD_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(UPLOAD_STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB error'));
    });
  }
  async function queuePut(record) {
    const db = await openUploadDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(UPLOAD_STORE, 'readwrite');
      tx.objectStore(UPLOAD_STORE).put(record);
      tx.oncomplete = () => { db.close(); resolve(record); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }
  async function queueDelete(id) {
    try {
      const db = await openUploadDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(UPLOAD_STORE, 'readwrite');
        tx.objectStore(UPLOAD_STORE).delete(id);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      });
    } catch (_) {}
  }
  async function queueAll() {
    try {
      const db = await openUploadDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(UPLOAD_STORE, 'readonly');
        const req = tx.objectStore(UPLOAD_STORE).getAll();
        req.onsuccess = () => { db.close(); resolve(req.result || []); };
        req.onerror = () => { db.close(); reject(req.error); };
      });
    } catch (_) { return []; }
  }
  const cacheGet = key => {
    try { const x = JSON.parse(sessionStorage.getItem(`ph:${key}`) || 'null'); return x && (Date.now() - x.t) < state.cacheTTL ? x.v : null; } catch (_) { return null; }
  };
  const cacheSet = (key, value) => { try { sessionStorage.setItem(`ph:${key}`, JSON.stringify({ t: Date.now(), v: value })); } catch (_) {} };
  function uploadProgress(label, percent, icon='fa-cloud-arrow-up') {
    let host = $('#uploadProgress');
    if (!host) { host = document.createElement('div'); host.id = 'uploadProgress'; document.body.appendChild(host); }
    host.innerHTML = `<div class="upload-progress-card"><div class="upload-progress-icon"><i class="fas ${icon}"></i></div><div class="upload-progress-copy"><strong>${esc(label)}</strong><span>${Math.max(0, Math.min(100, Math.round(percent)))}%</span><div class="upload-progress-line"><i style="width:${Math.max(0, Math.min(100, percent))}%"></i></div></div></div>`;
    host.hidden = false;
    return host;
  }
  function hideUploadProgress(delay=0) { const h=$('#uploadProgress'); if (!h) return; setTimeout(()=>{ if (h) h.hidden=true; }, delay); }
  function makeId() { return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`); }
  function fileFromEntry(entry) { return entry && entry.file instanceof File ? entry.file : null; }
  function buildFormData(record) {
    const fd = new FormData();
    (record.fields || []).forEach(x => fd.append(x.name, x.value));
    (record.files || []).forEach(x => { const f=fileFromEntry(x); if (f) fd.append(x.field, f, f.name); });
    return fd;
  }
  function xhrUpload(method, path, formData, token, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, `${API}${path}`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress((e.loaded / e.total) * 100); };
      xhr.onload = () => { let data={}; try{data=JSON.parse(xhr.responseText||'{}')}catch(_){}; if(xhr.status>=200&&xhr.status<300) resolve(data); else { const err=new Error(data.error||`Request failed (${xhr.status})`); err.status=xhr.status; reject(err); } };
      xhr.onerror = () => reject(new Error('Network error. Upload is saved and will resume when you return.'));
      xhr.onabort = () => reject(new Error('Upload interrupted. It will resume when you return.'));
      xhr.send(formData);
    });
  }
  async function processQueuedUpload(record, announce=true) {
    if (!state.token || (record.token && record.token !== state.token)) return false;
    if (state.pendingUploads.has(record.id)) return false;
    state.pendingUploads.set(record.id, true);
    try {
      if (announce) uploadProgress(record.kind === 'preset' ? 'Uploading preset' : 'Uploading profile image', 1, record.kind === 'preset' ? 'fa-cloud-arrow-up' : 'fa-image');
      const r = await xhrUpload(record.method || (record.kind === 'avatar' ? 'PUT' : 'POST'), record.path, buildFormData(record), state.token, p => uploadProgress(record.kind === 'preset' ? `Uploading ${record.name || 'preset'}` : 'Uploading profile image', p, record.kind === 'preset' ? 'fa-cloud-arrow-up' : 'fa-image'));
      await queueDelete(record.id);
      state.pendingUploads.delete(record.id);
      hideUploadProgress(700);
      if (record.kind === 'preset') { toast('Preset uploaded successfully'); await loadPresets(); await loadFeatured(); }
      else { state.user = { ...state.user, avatar: r.avatar }; updateAuthUI(); toast('Profile image updated'); }
      return true;
    } catch (e) {
      state.pendingUploads.delete(record.id);
      if (e.status && e.status >= 400 && e.status < 500 && e.status !== 429) await queueDelete(record.id);
      hideUploadProgress(1200);
      if (announce) toast(e.message, 'error');
      return false;
    }
  }
  async function resumeQueuedUploads() {
    if (!state.token) return;
    const rows = await queueAll();
    for (const row of rows) await processQueuedUpload({ ...row, token: state.token }, true);
  }
  async function flushPendingProfile() {
    if (!state.token) return;
    try {
      const raw = localStorage.getItem('presethub_pending_profile');
      if (!raw) return;
      const payload = JSON.parse(raw);
      await api('/auth/profile', { method: 'PUT', body: JSON.stringify(payload) });
      localStorage.removeItem('presethub_pending_profile');
      const r = await api('/auth/me'); state.user = r.user; updateAuthUI();
      toast('Pending profile update completed');
    } catch (_) {}
  }

  // ============ API HELPER ============
  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
    if (!(options.body instanceof FormData) && options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const res = await fetch(`${API}${path}`, { ...options, headers });
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

  // ============ TOAST ============
  function toast(message, type = 'success') {
    const box = $('#toastBox') || (() => {
      const x = document.createElement('div'); x.id = 'toastBox'; document.body.appendChild(x); return x;
    })();
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = String(message);
    box.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  // ============ MODAL ============
  function openModal(html) {
    const overlay = $('#overlay'), body = $('#modalBody');
    if (!overlay || !body) return;
    body.innerHTML = html;
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    const overlay = $('#overlay');
    if (overlay) overlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  function requireAuth() {
    if (!state.user) { openAuth('login'); return false; }
    return true;
  }

  function updateAuthUI() {
    const auth = $('#authSection'), user = $('#userSection'), avatar = $('#avatar'), admin = $('#adminLink');
    if (state.user) {
      if (auth) auth.style.display = 'none';
      if (user) user.style.display = 'flex';
      if (avatar) {
        avatar.textContent = (state.user.name || state.user.username || 'U').trim().charAt(0).toUpperCase();
        if (state.user.avatar) {
          avatar.style.backgroundImage = `url("${state.user.avatar}")`;
          avatar.style.backgroundSize = 'cover';
          avatar.textContent = '';
        }
      }
      if (admin) admin.classList.toggle('hidden', state.user.role !== 'admin');
    } else {
      if (auth) auth.style.display = 'flex';
      if (user) user.style.display = 'none';
    }
  }

  // ============ PRESET CARD ============
  function presetCard(p) {
    const image = imgTag(p.previewImage, `${p.name} preset preview`, 'preset-preview-img');
    const likes = Number(p.likesCount || (p.likes || []).length);
    return `
      <article class="preset-card" data-preset-card="${esc(p.id)}">
        <label class="select-preset"><input type="checkbox" data-action="select-preset" data-id="${esc(p.id)}" ${state.selected.has(String(p.id)) ? 'checked' : ''} aria-label="Select ${esc(p.name)}"><span></span></label>
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
            <span class="price ${Number(p.price || 0) === 0 ? 'free' : ''}">${money(p.price)}</span>
            <span class="rating">★ ${Number(p.avgRating || 0).toFixed(1)} · ${p.downloads || 0} downloads</span>
          </div>
          <div class="card-actions">
            <button class="icon-action" data-action="wishlist" data-id="${esc(p.id)}" title="Wishlist"><i class="far fa-heart"></i></button>
            <button class="icon-action" data-action="like" data-id="${esc(p.id)}" title="Like">♥ ${likes}</button>
            <button class="icon-action" data-action="share" data-id="${esc(p.id)}" title="Share"><i class="fas fa-share-nodes"></i></button>
            <a class="icon-action" href="${presetUrl(p)}" title="Open preset page"><i class="fas fa-link"></i></a>
            <button class="btn btn-primary btn-sm" data-action="view-preset" data-id="${esc(p.id)}">Open</button>
          </div>
        </div>
      </article>`;
  }

  function renderPresetGrid(data) {
    const grid = $('#presetGrid');
    if (grid) grid.innerHTML = state.presets.length
      ? state.presets.map(presetCard).join('')
      : `<div class="empty-state"><i class="fas fa-box-open"></i><h3>No presets found</h3><p>Try another search or upload the first preset.</p></div>`;
    const title = $('#listTitle');
    if (title) title.textContent = state.query ? `Search: ${state.query}` : 'सभी Presets';
    if ($('#statPresets')) $('#statPresets').textContent = data.total || 0;
    if ($('#statFree')) $('#statFree').textContent = state.presets.filter(p => Number(p.price || 0) === 0).length;
  }

  function featuredCard(p) {
    return `<article class="featured-card"><a class="featured-image" href="${presetUrl(p)}"><img src="${esc(assetUrl(p.previewImage))}" alt="${esc(p.name)} preview" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${fallbackPreview}'"></a><div class="featured-body"><div class="featured-top"><span class="tag">${esc(p.category || 'General')}</span><span class="price ${Number(p.price||0)===0?'free':''}">${money(p.price)}</span></div><h3>${esc(p.name)}</h3><button class="author-link" data-action="profile" data-id="${esc(p.authorId||'')}">By ${esc(p.author||'Creator')}</button><p>${esc(p.description || 'Lightroom preset')}</p><div class="featured-stats"><span>★ ${Number(p.avgRating||0).toFixed(1)}</span><span>👁 ${p.views||0}</span><span>♥ ${p.likesCount||0}</span><span>💬 ${p.commentsCount||0}</span><span>↗ ${p.shares||0}</span><span>↓ ${p.downloads||0}</span></div><div class="card-actions"><button class="btn btn-primary btn-sm" data-action="view-preset" data-id="${esc(p.id)}">View details</button><button class="icon-action" data-action="share" data-id="${esc(p.id)}" title="Share"><i class="fas fa-share-nodes"></i></button></div></div></article>`;
  }
  async function loadFeatured(force=false) {
    const box=$('#featuredGrid'); if(!box) return;
    const cached=!force ? cacheGet('featured') : null;
    if(cached){ state.featured=cached; box.innerHTML=cached.map(featuredCard).join(''); if(!force) return; }
    try { const data=await api('/presets/featured?limit=8'); state.featured=data||[]; cacheSet('featured',state.featured); box.innerHTML=state.featured.map(featuredCard).join('') || '<div class="empty-state">No featured presets yet.</div>'; } catch(_){ if(!cached) box.innerHTML='<div class="empty-state">Featured presets will appear here.</div>'; }
  }

  // ============ LOAD PRESETS ============
  async function loadPresets(reset = true, force = false) {
    if (reset) state.page = 1;
    const cacheKey = `presets:${state.page}:${state.sort}:${state.price}:${state.category}:${state.query}`;
    const cached = !force && reset ? cacheGet(cacheKey) : null;
    if (cached) {
      state.presets = cached.presets || [];
      state.totalPages = cached.totalPages || 1;
      renderPresetGrid(cached);
      if (!force) return;
    }
    const params = new URLSearchParams({ page: state.page, limit: 24, sort: state.sort });
    if (state.query) params.set('q', state.query);
    if (state.price) params.set('price', state.price);
    if (state.category) params.set('category', state.category);
    const grid = $('#presetGrid');
    if (grid && reset) grid.innerHTML = '<div class="skeleton" style="height:280px"></div>'.repeat(4);
    try {
      const data = await api(`/presets?${params.toString()}`);
      state.presets = reset ? data.presets : [...state.presets, ...data.presets];
      state.totalPages = data.totalPages || 1;
      cacheSet(cacheKey, { ...data, presets: state.presets });
      renderPresetGrid(data);
    } catch (e) {
      if (grid) grid.innerHTML = `<div class="empty-state"><h3>Could not load presets</h3><p>${esc(e.message)}</p><button class="btn btn-primary" data-action="retry">Retry</button></div>`;
    }
  }

  async function loadCategories() {
    const cached = cacheGet('categories');
    if (cached) { state.categories=cached; const el=$('#categories'); if(el) el.innerHTML=cached.length ? cached.map(([name,count])=>`<button class="category-card" data-action="category" data-category="${esc(name)}"><div class="icon">✦</div><div class="name">${esc(name)}</div><div class="count">${count} presets</div></button>`).join('') : '<p>No categories yet.</p>'; return; }
    try {
      const data = await api('/presets?limit=200&sort=newest');
      const counts = {};
      (data.presets || []).forEach(p => counts[p.category || 'General'] = (counts[p.category || 'General'] || 0) + 1);
      const cats = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      state.categories = cats;
      cacheSet('categories', cats);
      const el = $('#categories');
      if (el) el.innerHTML = cats.length
        ? cats.map(([name, count]) => `
            <button class="category-card" data-action="category" data-category="${esc(name)}">
              <div class="icon">✦</div><div class="name">${esc(name)}</div><div class="count">${count} presets</div>
            </button>`).join('')
        : '<p>No categories yet.</p>';
    } catch (_) {}
  }

  async function loadCreators() {
    const cached = cacheGet('creators');
    if (cached) { state.creators = cached; const el = $('#creators'); if (el) el.innerHTML = (cached || []).map(u => `<button class="creator-card" data-action="profile" data-id="${esc(u.id)}"><div class="creator-avatar">${u.avatar ? imgTag(u.avatar, u.name || 'Creator', '') : esc((u.name || 'U').charAt(0).toUpperCase())}</div><div class="name">${esc(u.name || u.username || 'Creator')}</div><div class="stats">${u.presetCount || 0} presets · ${u.totalDownloads || 0} downloads</div><div class="followers">${u.followers || 0} followers</div></button>`).join(''); return; }
    try {
      const creators = await api('/users/top');
      state.creators = creators;
      cacheSet('creators', creators);
      const el = $('#creators');
      if (el) el.innerHTML = (creators || []).map(u => `
        <button class="creator-card" data-action="profile" data-id="${esc(u.id)}">
          <div class="creator-avatar">${u.avatar ? `<img src="${esc(u.avatar)}" alt="">` : esc((u.name || 'U').charAt(0).toUpperCase())}</div>
          <div class="name">${esc(u.name || u.username || 'Creator')}</div>
          <div class="stats">${u.presetCount || 0} presets · ${u.totalDownloads || 0} downloads</div>
          <div class="followers">${u.followers || 0} followers</div>
        </button>`).join('');
    } catch (_) {}
  }

  // ============ SHOW PRESET MODAL ============
  async function showPreset(id) {
    try {
      const p = await api(`/presets/${encodeURIComponent(id)}`);
      state.currentPreset = p;
      let reviews = [];
      let comments = [];
      try { reviews = await api(`/reviews/${encodeURIComponent(id)}`); } catch (_) {}
      try { comments = await api(`/comments/${encodeURIComponent(id)}`); } catch (_) {}
      const image = `<div class="preview-frame">${imgTag(p.previewImage, `${p.name} preset preview`, 'preset-detail-image')}<div class="preview-badge"><i class="fas fa-image"></i> Preview</div></div>`;
      openModal(`
        <div class="modal-grid">
          <div class="modal-preview">${image}</div>
          <div class="modal-details">
            <span class="tag">${esc(p.category || 'General')}</span>
            <h2>${esc(p.name)}</h2>
            <button class="author-link" data-action="profile" data-id="${esc(p.authorId || '')}">by ${esc(p.author || 'Creator')}</button>
            <p class="desc">${esc(p.description || 'No description yet.')}</p>
            <div class="price-lg ${Number(p.price || 0) === 0 ? 'free' : ''}">${money(p.price)}</div>
            <div class="meta-list">
              <span><i class="fas fa-star"></i>${Number(p.avgRating || 0).toFixed(1)}</span>
              <span><i class="fas fa-download"></i>${p.downloads || 0}</span>
              <span><i class="fas fa-eye"></i>${p.views || 0}</span>
              <span><i class="fas fa-heart"></i>${Number(p.likesCount || 0)}</span>
              <span><i class="fas fa-share-nodes"></i>${p.shares || 0}</span>
            </div>
            <div class="actions">
              <button class="btn btn-primary" data-action="download" data-id="${esc(p.id)}"><i class="fas fa-download"></i> Download</button>
              <button class="btn btn-outline" data-action="wishlist" data-id="${esc(p.id)}"><i class="far fa-heart"></i> Wishlist</button>
              <button class="btn btn-outline" data-action="share" data-id="${esc(p.id)}"><i class="fas fa-share-nodes"></i> Share</button>
              <a class="btn btn-outline" href="${presetUrl(p)}">SEO Page</a>
            </div>
            <div class="review-box">
              <h3>Reviews</h3>
              ${(reviews || []).slice(-5).reverse().map(r => `<div class="review"><b>${esc(r.userName)}</b> · ${'★'.repeat(Number(r.rating) || 0)}<p>${esc(r.comment)}</p></div>`).join('') || '<p>No reviews yet.</p>'}
              ${state.user ? `<form id="reviewForm" data-preset="${esc(p.id)}"><select name="rating" required><option value="">Rating</option>${[1, 2, 3, 4, 5].map(n => `<option>${n}</option>`).join('')}</select><input name="comment" maxlength="500" placeholder="Write a review…" required><button class="btn btn-primary btn-sm">Post review</button></form>` : ''}
            </div>
            <div class="comment-box">
              <h3>Comments</h3>
              ${comments.length ? comments.map(c => `<div class="comment"><b>${esc(c.userName)}</b><small>${new Date(c.createdAt).toLocaleString()}</small><p>${esc(c.text)}</p><button class="text-button" data-action="comment-like" data-preset="${esc(p.id)}" data-comment="${esc(c.id)}">♥ ${c.likes || 0}</button></div>`).join('') : '<p>No comments yet.</p>'}
              ${state.user ? `<form id="commentForm" data-preset="${esc(p.id)}"><textarea name="text" maxlength="500" placeholder="Write a comment…" required></textarea><button class="btn btn-primary btn-sm">Comment</button></form>` : ''}
            </div>
          </div>
        </div>`);
      try { await api(`/presets/${encodeURIComponent(id)}/view`, { method: 'POST' }); } catch (_) {}
    } catch (e) { toast(e.message, 'error'); }
  }

  // ============ DOWNLOAD (R2 SUPPORT) ============
  function downloadOverlay(name='Preset') {
    const old = document.getElementById('downloadProgress'); if (old) old.remove();
    const el = document.createElement('div'); el.id='downloadProgress'; el.innerHTML=`<div class="download-progress-card"><div class="download-spinner"><i class="fas fa-download"></i></div><div><strong>Preparing download</strong><span>${esc(name)}</span><div class="progress-line"><i></i></div></div></div>`; document.body.appendChild(el);
    return el;
  }
  async function notifyDownload(name, url) {
    toast(`Download ready: ${name}`);
    if ('Notification' in window) {
      try { if (Notification.permission === 'default') await Notification.requestPermission(); if (Notification.permission === 'granted') new Notification('PresetHub download complete', { body: name, icon:'/assets/icons/icon-192.png', data:url }); } catch (_) {}
    }
  }
  async function downloadPreset(id) {
    if (!requireAuth()) return;
    let progress;
    try {
      const p = state.currentPreset?.id === id ? state.currentPreset : await api(`/presets/${id}`);
      progress = downloadOverlay(p.name);
      if (Number(p.price || 0) > 0 && p.authorId !== state.user.id) return startPayment(p);
      const r = await api(`/presets/${encodeURIComponent(id)}/download`, { method: 'POST' });
      if (!r.downloadUrl) throw new Error('Download file unavailable');
      const a = document.createElement('a'); a.href = r.downloadUrl; a.download = r.originalName || `${slug(p.name)}.xmp`; a.target='_blank'; a.rel='noopener'; document.body.appendChild(a); a.click(); a.remove();
      await notifyDownload(p.name, r.downloadUrl);
    } catch (e) { toast(e.message, 'error'); }
    finally { setTimeout(()=>progress?.remove(), 650); }
  }

  // ============ PAYMENT ============
  async function startPayment(p) {
    if (!requireAuth()) return;
    try {
      if (!window.Razorpay) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://checkout.razorpay.com/v1/checkout.js';
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      const order = await api('/payments/create-order', { method: 'POST', body: JSON.stringify({ presetId: p.id }) });
      const rz = new Razorpay({
        key: order.key, amount: order.amount, currency: order.currency, order_id: order.orderId,
        name: 'PresetHub', description: p.name,
        prefill: { name: state.user.name, email: state.user.email },
        theme: { color: '#d4a373' },
        handler: async response => {
          try {
            await api('/payments/verify', { method: 'POST', body: JSON.stringify(response) });
            toast('Payment verified. Download now available.');
            downloadPreset(p.id);
          } catch (e) { toast(e.message, 'error'); }
        }
      });
      rz.open();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ============ WISHLIST / LIKE ============
  async function toggleWishlist(id) {
    if (!requireAuth()) return;
    try {
      const d = await api(`/users/me/wishlist/${id}`, { method: 'POST' });
      toast((d.wishlist || []).includes(id) ? 'Added to wishlist' : 'Removed from wishlist');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function likePreset(id) {
    if (!requireAuth()) return;
    try {
      const d = await api(`/presets/${id}/like`, { method: 'POST' });
      toast(d.liked ? 'Liked' : 'Like removed');
      loadPresets(false);
    } catch (e) { toast(e.message, 'error'); }
  }

  // ============ SHARE (RICH MODAL) ============
  async function sharePreset(id) {
    try {
      const p = state.currentPreset?.id === id ? state.currentPreset : await api(`/presets/${id}`);
      const baseUrl = location.origin;
      const shareUrl = `${baseUrl}/preset/${encodeURIComponent(p.id)}/${slug(p.name)}/`;
      const shortUrl = await getOrCreateShortLink(p.id);
      const finalUrl = shortUrl || shareUrl;

      const shareText = `Check out "${p.name}" by ${p.author} on PresetHub!\n${p.description ? p.description.slice(0, 100) + '…' : ''}`;
      const encodedUrl = encodeURIComponent(finalUrl);
      const encodedText = encodeURIComponent(shareText);
      const encodedTitle = encodeURIComponent(`${p.name} — PresetHub`);
      const previewImg = p.previewImage ? (p.previewImage.startsWith('http') ? p.previewImage : baseUrl + p.previewImage) : '';

      openModal(`
        <div class="share-panel">
          <div class="share-title"><div><span class="eyebrow">PresetHub</span><h2><i class="fas fa-share-nodes"></i> Share Preset</h2></div><button class="share-close" data-action="close" aria-label="Close"><i class="fas fa-xmark"></i></button></div>
          <div class="share-preview">
            ${imgTag(p.previewImage, `${p.name} preview`, 'share-preview-image')}
            <div>
              <h3>${esc(p.name)}</h3>
              <p>by ${esc(p.author)} · ${money(p.price)}</p>
            </div>
          </div>

          <div class="share-grid">
            <button class="share-btn whatsapp" data-share-platform="whatsapp" data-url="${encodedUrl}" data-text="${encodedText}">
              <i class="fab fa-whatsapp"></i><span>WhatsApp</span>
            </button>
            <button class="share-btn telegram" data-share-platform="telegram" data-url="${encodedUrl}" data-text="${encodedText}">
              <i class="fab fa-telegram"></i><span>Telegram</span>
            </button>
            <button class="share-btn facebook" data-share-platform="facebook" data-url="${encodedUrl}">
              <i class="fab fa-facebook"></i><span>Facebook</span>
            </button>
            <button class="share-btn twitter" data-share-platform="twitter" data-url="${encodedUrl}" data-text="${encodedText}">
              <i class="fab fa-x-twitter"></i><span>X</span>
            </button>
            <button class="share-btn linkedin" data-share-platform="linkedin" data-url="${encodedUrl}" data-title="${encodedTitle}">
              <i class="fab fa-linkedin"></i><span>LinkedIn</span>
            </button>
            <button class="share-btn reddit" data-share-platform="reddit" data-url="${encodedUrl}" data-title="${encodedTitle}">
              <i class="fab fa-reddit"></i><span>Reddit</span>
            </button>
            <button class="share-btn email" data-share-platform="email" data-url="${encodedUrl}" data-text="${encodedText}" data-title="${encodedTitle}">
              <i class="fas fa-envelope"></i><span>Email</span>
            </button>
            <button class="share-btn native" data-share-platform="native" data-url="${encodedUrl}" data-text="${encodedText}" data-title="${encodedTitle}">
              <i class="fas fa-share"></i><span>More…</span>
            </button>
          </div>

          <div class="share-link-box">
            <label>Short Link</label>
            <div class="share-link-input">
              <input readonly value="${esc(finalUrl)}" onclick="this.select()">
              <button class="btn btn-primary btn-sm" data-share-copy="${esc(finalUrl)}">Copy</button>
            </div>
          </div>

          <div class="share-qr">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodedUrl}" alt="QR Code" loading="lazy">
            <p>Scan to open on mobile</p>
          </div>

          <div class="share-footer" style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
            ${previewImg ? `<button class="btn btn-outline btn-sm" data-share-copy-image="${esc(previewImg)}" data-share-copy-url="${esc(finalUrl)}"><i class="fas fa-image"></i> Copy Image + Link</button>` : ''}
          </div>
        </div>`);

      trackShare(p.id, 'open_menu');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function getOrCreateShortLink(presetId) {
    if (!state.user) return null;
    try {
      const r = await api('/share/create', { method: 'POST', body: JSON.stringify({ presetId, platform: 'menu' }) });
      return r.shortUrl;
    } catch (_) { return null; }
  }

  function trackShare(presetId, platform) {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
    fetch(`${API}/presets/${presetId}/share`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ platform })
    }).catch(() => {});
  }

  function openSharePlatform(platform, url, text, title) {
    let link = '';
    switch (platform) {
      case 'whatsapp': link = `https://wa.me/?text=${text}%20${url}`; break;
      case 'telegram': link = `https://t.me/share/url?url=${url}&text=${text}`; break;
      case 'facebook': link = `https://www.facebook.com/sharer/sharer.php?u=${url}`; break;
      case 'twitter':  link = `https://twitter.com/intent/tweet?text=${text}&url=${url}`; break;
      case 'linkedin': link = `https://www.linkedin.com/sharing/share-offsite/?url=${url}`; break;
      case 'reddit':   link = `https://www.reddit.com/submit?url=${url}&title=${title}`; break;
      case 'email':    link = `mailto:?subject=${title}&body=${text}%0A%0A${url}`; break;
      case 'native':
        if (navigator.share) {
          navigator.share({
            title: decodeURIComponent(title || ''),
            text: decodeURIComponent(text || ''),
            url: decodeURIComponent(url || '')
          }).catch(() => {});
          return true;
        }
        return false;
      default: return false;
    }
    if (link) window.open(link, '_blank', 'noopener,width=600,height=600');
    return true;
  }

  // ============ MY SHARE LINKS ============
  async function showMyShares() {
    if (!requireAuth()) return;
    try {
      const links = await api('/share/me/list');
      openModal(`
        <h2><i class="fas fa-link"></i> My Share Links</h2>
        ${links.length === 0
          ? '<p>You have not created any share links yet. Open a preset and click Share to create one.</p>'
          : `<div class="share-links-list">
              ${links.map(l => `
                <div class="share-link-item">
                  <div>
                    <a href="${esc(l.shortUrl)}" target="_blank" rel="noopener">${esc(l.shortUrl)}</a>
                    <small>${esc(l.platform)} · ${new Date(l.createdAt).toLocaleDateString()}</small>
                  </div>
                  <div class="share-link-stats">
                    <b>${l.clicks}</b><span>clicks</span>
                  </div>
                </div>
              `).join('')}
            </div>`}
      `);
    } catch (e) { toast(e.message, 'error'); }
  }

  // ============ SHARE STATS (For Creator) ============
  async function showShareStats(presetId) {
    if (!requireAuth()) return;
    try {
      const stats = await api(`/presets/${presetId}/share-stats`);
      const platforms = stats.platforms || {};
      openModal(`
        <h2><i class="fas fa-chart-pie"></i> Share Analytics</h2>
        <div class="stats-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin:16px 0">
          <div class="stat-item" style="background:var(--input-bg);padding:14px;border-radius:12px;text-align:center">
            <div style="font-size:2rem;font-weight:700">${stats.totalShares || 0}</div>
            <div style="font-size:0.8rem;color:var(--muted)">Total Shares</div>
          </div>
          <div class="stat-item" style="background:var(--input-bg);padding:14px;border-radius:12px;text-align:center">
            <div style="font-size:2rem;font-weight:700">${stats.uniqueSharers || 0}</div>
            <div style="font-size:0.8rem;color:var(--muted)">Unique Sharers</div>
          </div>
        </div>
        <h3 style="margin-top:20px">By Platform</h3>
        ${Object.keys(platforms).length === 0
          ? '<p>No shares yet.</p>'
          : `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px">
              ${Object.entries(platforms).map(([p, c]) => `
                <div style="background:var(--input-bg);padding:10px;border-radius:10px;text-align:center">
                  <div style="font-size:1.3rem;font-weight:700">${c}</div>
                  <div style="font-size:0.75rem;color:var(--muted);text-transform:capitalize">${esc(p)}</div>
                </div>
              `).join('')}
            </div>`}
        <h3 style="margin-top:20px">Recent Shares</h3>
        ${(stats.recent || []).length === 0
          ? '<p>No recent shares.</p>'
          : `<div>${stats.recent.map(s => `<div style="padding:8px 0;border-bottom:1px solid var(--border)"><b>${esc(s.userName)}</b> on ${esc(s.platform)}<small style="display:block;color:var(--muted);font-size:0.75rem">${new Date(s.sharedAt).toLocaleString()}</small></div>`).join('')}</div>`}
      `);
    } catch (e) { toast(e.message, 'error'); }
  }

  // ============ PROFILE ============
  async function showProfile(id) {
    try {
      const u = await api(`/users/${encodeURIComponent(id)}`);
      const presets = await api(`/users/${encodeURIComponent(id)}/presets`);
      let following = false;
      if (state.user && state.user.id !== u.id) {
        try { following = (await api(`/users/${encodeURIComponent(id)}/follow-status`)).following; } catch (_) {}
      }
      const socialMap = { instagram:'fa-instagram', youtube:'fa-youtube', twitter:'fa-x-twitter', website:'fa-globe' };
      openModal(`
        <div class="profile-view professional-profile">
          <div class="profile-cover"></div>
          <div class="profile-head profile-head-pro">
            <div class="profile-avatar">${u.avatar ? imgTag(u.avatar, `${u.name || 'Creator'} avatar`) : esc((u.name || 'U').charAt(0).toUpperCase())}</div>
            <div class="profile-main"><span class="eyebrow">CREATOR PROFILE</span><h2>${esc(u.name || u.username || 'Creator')}</h2><p class="profile-handle">@${esc(u.username || 'creator')}</p><p class="profile-bio">${esc(u.bio || 'Preset creator on PresetHub.')}</p></div>
            <div class="profile-actions">${state.user && state.user.id !== u.id ? `<button class="btn btn-primary" data-action="follow" data-id="${esc(u.id)}"><i class="fas fa-user-plus"></i> ${following ? 'Following' : 'Follow'}</button>` : `<button class="btn btn-outline" data-action="edit-profile"><i class="fas fa-pen"></i> Edit profile</button>`}</div>
          </div>
          <div class="profile-stats"><b>${u.totalPresets || 0}<span>Presets</span></b><b>${u.totalDownloads || 0}<span>Downloads</span></b><b>${u.followers || 0}<span>Followers</span></b><b>${u.following || 0}<span>Following</span></b></div>
          <div class="social-row">${Object.entries(u.socialLinks || {}).filter(([,v]) => safeExternal(v) !== '#').map(([k,v]) => `<a class="social-icon" href="${esc(safeExternal(v))}" target="_blank" rel="noopener noreferrer" aria-label="${esc(k)}"><i class="fab ${socialMap[k] || 'fa-link'}"></i><span>${esc(k)}</span></a>`).join('') || '<span class="muted">No social links added yet.</span>'}</div>
          <div class="profile-section-head"><h3>Presets by ${esc(u.name || u.username || 'Creator')}</h3><span>${presets.length} published</span></div>
          <div class="mini-preset-grid">${(presets || []).map(presetCard).join('') || '<div class="empty-state"><i class="fas fa-images"></i><p>No presets yet.</p></div>'}</div>
        </div>`);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function editProfileModal() {
    if (!requireAuth()) return;
    const u = state.user;
    openModal(`<div class="profile-edit-panel"><span class="eyebrow">ACCOUNT SETTINGS</span><h2>Edit profile</h2><form id="profileForm">
      <div class="form-grid"><div class="form-group"><label>Name</label><input name="name" value="${esc(u.name || '')}" maxlength="50"></div><div class="form-group"><label>Username</label><input name="username" value="${esc(u.username || '')}" minlength="3" maxlength="30" pattern="[A-Za-z0-9_]+"></div></div>
      <div class="profile-avatar-upload"><div class="profile-avatar-preview">${u.avatar ? imgTag(u.avatar, 'Current profile image') : '<i class="fas fa-user"></i>'}</div><div class="form-group"><label>Profile image</label><input name="avatarFile" id="profileAvatarFile" type="file" accept="image/png,image/jpeg,image/webp"><small>JPG, PNG or WEBP · max 5MB. Upload continues/resumes if you leave the page.</small></div></div>
      <div class="form-group"><label>Bio</label><textarea name="bio" maxlength="500">${esc(u.bio || '')}</textarea></div>
      <div class="form-grid"><div class="form-group"><label><i class="fab fa-instagram"></i> Instagram</label><input name="instagram" value="${esc(u.socialLinks?.instagram || '')}" placeholder="https://instagram.com/username"></div><div class="form-group"><label><i class="fab fa-youtube"></i> YouTube</label><input name="youtube" value="${esc(u.socialLinks?.youtube || '')}" placeholder="https://youtube.com/@username"></div><div class="form-group"><label><i class="fab fa-x-twitter"></i> X / Twitter</label><input name="twitter" value="${esc(u.socialLinks?.twitter || '')}" placeholder="https://x.com/username"></div><div class="form-group"><label><i class="fas fa-globe"></i> Website</label><input name="website" value="${esc(u.socialLinks?.website || '')}" placeholder="https://example.com"></div></div>
      <button class="btn btn-primary" type="submit"><i class="fas fa-check"></i> Save profile</button></form></div>`);
  }

  // ============ AUTH ============
  function openAuth(mode = 'login', after = null) {
    openModal(`
      <div class="auth-box">
        <h2>${mode === 'login' ? 'Welcome back' : 'Create your PresetHub account'}</h2>
        <form id="authForm" data-mode="${mode}">
          ${mode === 'signup' ? '<div class="form-group"><label>Name</label><input name="name" maxlength="50" required></div><div class="form-group"><label>Username</label><input name="username" minlength="3" maxlength="30" pattern="[A-Za-z0-9_]+" required></div>' : ''}
          <div class="form-group"><label>Email</label><input type="email" name="email" required autocomplete="email"></div>
          <div class="form-group"><label>Password</label><input type="password" name="password" minlength="8" required autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></div>
          ${mode === 'signup' ? '<small>At least 8 characters with upper/lowercase and a number.</small>' : ''}
          <button class="btn btn-primary" type="submit">${mode === 'login' ? 'Log in' : 'Sign up'}</button>
        </form>
        <button class="text-button" data-action="switch-auth" data-mode="${mode === 'login' ? 'signup' : 'login'}">${mode === 'login' ? 'Create account' : 'Already have an account? Log in'}</button>
      </div>`);
  }

  async function submitAuth(form) {
    const mode = form.dataset.mode;
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const r = await api(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(data) });
      state.token = r.token; state.user = r.user;
      localStorage.setItem('presethub_token', state.token);
      updateAuthUI(); closeModal();
      toast(mode === 'login' ? 'Logged in' : 'Account created');
      await loadPresets();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function openAccount() {
    if (!requireAuth()) return;
    try {
      const [u, d] = await Promise.all([api('/auth/me'), api('/users/me/dashboard')]);
      state.user = u.user;
      const s = d.stats || {};
      openModal(`
        <div class="account-panel professional-dashboard">
          <div class="dashboard-head"><div><span class="eyebrow">CREATOR STUDIO</span><h2>Professional Dashboard</h2><p>@${esc(d.user.username || d.user.name || 'creator')}</p></div><button class="btn btn-accent" data-action="upload"><i class="fas fa-cloud-arrow-up"></i> Upload</button></div>
          <div class="dashboard-stats"><div><b>${s.views || 0}</b><span>Views</span></div><div><b>${s.downloads || 0}</b><span>Downloads</span></div><div><b>${s.likes || 0}</b><span>Likes</span></div><div><b>${d.followers || 0}</b><span>Followers</span></div><div><b>${d.unreadNotifications || 0}</b><span>Unread</span></div></div>
          <div class="account-actions"><button class="btn btn-outline" data-action="my-profile"><i class="fas fa-user"></i> Profile</button><button class="btn btn-outline" data-action="edit-profile"><i class="fas fa-pen"></i> Edit profile</button><button class="btn btn-outline" data-action="wishlist-page"><i class="fas fa-heart"></i> Wishlist</button><button class="btn btn-outline" data-action="downloads"><i class="fas fa-download"></i> Downloads</button><button class="btn btn-outline" data-action="notifications"><i class="fas fa-bell"></i> Notifications</button><button class="btn btn-outline" data-action="my-shares"><i class="fas fa-link"></i> Share links</button><button class="btn btn-danger" data-action="logout"><i class="fas fa-right-from-bracket"></i> Log out</button></div>
          <div class="profile-section-head"><h3>Your presets</h3><span>${(d.presets || []).length} uploads</span></div>
          <div class="dashboard-preset-list">${(d.presets || []).map(p => `<div class="dashboard-row"><div class="dashboard-thumb">${imgTag(p.previewImage, p.name, '')}</div><div class="dashboard-row-main"><b>${esc(p.name)}</b><small>${esc(p.status)} · ${p.views || 0} views · ${p.downloads || 0} downloads</small></div><div class="dashboard-row-actions"><button class="icon-action" data-action="view-preset" data-id="${esc(p.id)}" title="View"><i class="fas fa-eye"></i></button><button class="icon-action" data-action="edit-preset" data-id="${esc(p.id)}" title="Edit"><i class="fas fa-pen"></i></button><button class="icon-action danger" data-action="delete-preset" data-id="${esc(p.id)}" title="Delete"><i class="fas fa-trash"></i></button></div></div>`).join('') || '<div class="empty-state"><i class="fas fa-cloud-arrow-up"></i><p>No uploads yet.</p></div>'}</div>
        </div>`);
    } catch (e) { toast(e.message, 'error'); }
  }

  // ============ WISHLIST (BATCH) ============
  async function showWishlist() {
    if (!requireAuth()) return;
    try {
      const list = await api('/users/me/wishlist/presets');
      openModal(`<h2>My Wishlist</h2><div class="mini-preset-grid">${list.map(presetCard).join('') || '<p>Your wishlist is empty.</p>'}</div>`);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function showDownloads() {
    if (!requireAuth()) return;
    try {
      const list = await api('/users/me/downloads');
      openModal(`<h2>My Downloads</h2><div class="mini-preset-grid">${(list || []).map(presetCard).join('') || '<p>No downloads yet.</p>'}</div>`);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function showNotifications() {
    if (!requireAuth()) return;
    try {
      const list = await api('/users/me/notifications');
      openModal(`<h2>Notifications</h2><div class="notification-list">${(list || []).map(n => `<div class="notification ${n.read ? '' : 'unread'}"><b>${esc(n.type)}</b><p>${esc(n.message)}</p><small>${new Date(n.createdAt).toLocaleString()}</small></div>`).join('') || '<p>No notifications.</p>'}<button class="btn btn-outline" data-action="read-notifications">Mark all read</button></div>`);
    } catch (e) { toast(e.message, 'error'); }
  }

  // ============ UPLOAD (SINGLE + BULK TABS) ============
  function openUpload() {
    if (!requireAuth()) return;
    openModal(`
      <div class="upload-panel">
        <h2>Upload Presets</h2>
        <div class="upload-tabs">
          <button class="upload-tab active" data-upload-tab="single">📄 Single Upload</button>
          <button class="upload-tab" data-upload-tab="bulk">📦 Bulk Upload (max 20)</button>
        </div>

        <form id="uploadForm" enctype="multipart/form-data" data-tab="single">
          <p style="color:var(--muted);font-size:0.85rem;margin-bottom:14px">Accepted: XMP, DNG, LRTEMPLATE, CUBE, 3DL, LOOK, COSTYLE, XML, JSON, ZIP. Max 100MB each.</p>
          <div class="form-group"><label>Preset name</label><input name="name" required maxlength="100"></div>
          <div class="form-group"><label>Description</label><textarea name="description" maxlength="500"></textarea></div>
          <div class="form-group"><label>Category</label><input name="category" maxlength="50" placeholder="Natural, Vintage…"></div>
          <div class="form-group"><label>Tags</label><input name="tags" maxlength="300" placeholder="portrait, warm, mobile"></div>
          <div class="form-group"><label>Price (INR)</label><input name="price" type="number" min="0" max="999999.99" step="0.01" value="0"></div>
          <div class="form-group"><label>Preset file</label><input name="file" type="file" accept=".xmp,.dng,.lrtemplate,.cube,.3dl,.look,.costyle,.xml,.json,.zip" required></div>
          <div class="form-group"><label>Preview image</label><input name="previewImage" type="file" accept="image/png,image/jpeg,image/webp"></div>
          <button class="btn btn-accent" type="submit">Publish preset</button>
        </form>

        <form id="bulkUploadForm" enctype="multipart/form-data" data-tab="bulk" hidden>
          <div class="bulk-hint">
            <strong>💡 Tip:</strong> Preview images pair by matching filename.<br>
            Example: <code>Sunset.xmp</code> + <code>Sunset.jpg</code> → 1 preset. If no name match, previews pair by order.
          </div>
          <div class="form-group">
            <label>Preset files (up to 20)</label>
            <input name="files" type="file" accept=".xmp,.dng,.lrtemplate,.cube,.3dl,.look,.costyle,.xml,.json,.zip" multiple required>
          </div>
          <div class="form-group">
            <label>Preview images (optional, pair by name)</label>
            <input name="previewImages" type="file" accept="image/png,image/jpeg,image/webp" multiple>
          </div>
          <div class="form-group"><label>Category (applies to all)</label><input name="category" maxlength="50" placeholder="General" value="General"></div>
          <div class="form-group"><label>Tags (applies to all, comma-separated)</label><input name="tags" maxlength="300" placeholder="portrait, warm, mobile"></div>
          <div class="form-group"><label>Price (INR, applies to all)</label><input name="price" type="number" min="0" max="999999.99" step="0.01" value="0"></div>
          <div class="form-group"><label>Description (applies to all, optional)</label><textarea name="description" maxlength="500" placeholder="Common description (preset name used if empty)"></textarea></div>
          <button class="btn btn-accent" type="submit">Publish All Presets</button>
        </form>
      </div>`);
  }

  async function submitUpload(form) {
    if (!state.token) return requireAuth();
    const fd = new FormData(form);
    const tags = String(fd.get('tags') || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 10);
    fd.delete('tags'); tags.forEach(t => fd.append('tags', t));
    const uploadId = makeId(); fd.append('uploadId', uploadId);
    const record = { id: uploadId, kind: 'preset', method: 'POST', path: '/presets', token: state.token, name: String(fd.get('name')||'preset'), fields: [], files: [] };
    for (const [name,value] of fd.entries()) { if (value instanceof File) { if (value.size) record.files.push({field:name,file:value}); } else record.fields.push({name,value:String(value)}); }
    try { await queuePut(record); closeModal(); await processQueuedUpload(record, true); }
    catch (e) { toast('Upload queue could not be saved. Please retry.', 'error'); }
  }

  async function submitBulkUpload(form) {
    const fd = new FormData(form);
    const files = fd.getAll('files');
    if (!files.length) return toast('Select at least one preset file', 'error');
    if (files.length > 20) return toast('Max 20 presets per bulk upload', 'error');

    const btn = form.querySelector('button[type="submit"]');
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = `Uploading ${files.length} preset(s)…`;

    try {
      const r = await api('/presets/bulk', { method: 'POST', body: fd });
      closeModal();
      toast(`✅ ${r.created} preset(s) published${r.failed ? `, ${r.failed} failed` : ''}`);
      loadPresets();
      if (r.failed > 0 && r.errors) {
        console.warn('Bulk upload errors:', r.errors);
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }

  function updateSelectionUI() {
    const toolbar = $('#bulkToolbar');
    const count = $('#selectedCount');
    if (toolbar) toolbar.hidden = state.selected.size === 0;
    if (count) count.textContent = state.selected.size;
  }

  async function bulkDownload() {
    if (!requireAuth()) return;
    const ids = [...state.selected];
    if (!ids.length) return toast('Select presets first', 'error');
    try {
      const r = await api('/presets/bulk-download', { method: 'POST', body: JSON.stringify({ ids }) });
      if (r.skipped?.length) toast(`${r.skipped.length} item(s) skipped because purchase/file access is required`, 'info');
      r.downloads.forEach((d, i) => setTimeout(() => {
        const a = document.createElement('a'); a.href = d.url; a.download = d.filename; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
      }, i * 450));
      state.selected.clear(); updateSelectionUI(); loadPresets(false); toast(`Starting ${r.count} download(s)…`); if ('Notification' in window && Notification.permission === 'granted') new Notification('PresetHub', {body:`${r.count} preset download(s) started`, icon:'/assets/icons/icon-192.png'});
    } catch (e) { toast(e.message, 'error'); }
  }

  async function editPreset(id) {
    if (!requireAuth()) return;
    try {
      const p = await api(`/presets/${id}`);
      openModal(`<div class="edit-preset-panel"><span class="eyebrow">PRESET MANAGEMENT</span><h2>Edit preset</h2><form id="editPresetForm" data-id="${esc(id)}"><div class="form-group"><label>Name</label><input name="name" maxlength="100" value="${esc(p.name)}" required></div><div class="form-group"><label>Description</label><textarea name="description" maxlength="500">${esc(p.description || '')}</textarea></div><div class="form-grid"><div class="form-group"><label>Category</label><input name="category" maxlength="50" value="${esc(p.category || 'General')}"></div><div class="form-group"><label>Price (INR)</label><input name="price" type="number" min="0" step="0.01" value="${Number(p.price||0)}"></div></div><div class="form-group"><label>Tags</label><input name="tags" maxlength="300" value="${esc((p.tags||[]).join(', '))}"></div><div class="form-group"><label>Replace preset file (optional)</label><input name="file" type="file" accept=".xmp,.dng,.lrtemplate,.cube,.3dl,.look,.costyle,.xml,.json,.zip"></div><div class="form-group"><label>Replace poster / preview (optional)</label><input name="previewImage" type="file" accept="image/png,image/jpeg,image/webp"></div><button class="btn btn-primary"><i class="fas fa-check"></i> Save changes</button></form></div>`);
    } catch(e){ toast(e.message,'error'); }
  }
  async function deletePreset(id) {
    if (!requireAuth()) return;
    if (!confirm('Delete this preset permanently?')) return;
    try { await api(`/presets/${id}`, {method:'DELETE'}); toast('Preset deleted'); closeModal(); openAccount(); loadPresets(); } catch(e){ toast(e.message,'error'); }
  }

  // ============ FOLLOW ============
  async function follow(id) {
    if (!requireAuth()) return;
    try {
      const r = await api(`/users/${id}/follow`, { method: 'POST' });
      toast(r.following ? 'Followed' : 'Unfollowed');
      showProfile(id);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function submitComment(form) {
    try { await api(`/comments/${form.dataset.preset}`, { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) }); toast('Comment added'); showPreset(form.dataset.preset); }
    catch (e) { toast(e.message, 'error'); }
  }

  async function likeComment(presetId, commentId) {
    if (!requireAuth()) return;
    try { await api(`/comments/${presetId}/${commentId}/like`, { method: 'POST' }); showPreset(presetId); } catch (e) { toast(e.message, 'error'); }
  }

  // ============ REVIEW ============
  async function submitReview(form) {
    try {
      await api(`/reviews/${form.dataset.preset}`, {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
      });
      toast('Review added');
      showPreset(form.dataset.preset);
    } catch (e) { toast(e.message, 'error'); }
  }

  // ============ SEARCH HELPERS ============
  async function globalSearch(q) {
    q = String(q || '').trim();
    if (q.length < 2) { $('#searchEntityResults')?.setAttribute('hidden',''); return; }
    try {
      const r = await api(`/presets/global-search?q=${encodeURIComponent(q)}`);
      const box = $('#searchEntityResults');
      if (box) {
        const users = (r.users||[]).map(u => `<button class="search-entity user" data-action="profile" data-id="${esc(u.id)}"><span class="search-entity-avatar">${u.avatar?`<img src="${esc(assetUrl(u.avatar))}" alt="">`:esc((u.name||'U').charAt(0).toUpperCase())}</span><span><b>${esc(u.name||u.username||'User')}</b><small>@${esc(u.username||'user')} · ${u.followers||0} followers</small></span></button>`).join('');
        const cats = (r.categories||[]).map(c => `<button class="search-chip" data-action="category" data-category="${esc(c.name)}">Category: ${esc(c.name)} <small>${c.count}</small></button>`).join('');
        const tags = (r.tags||[]).map(t => `<button class="search-chip" data-action="tag-search" data-tag="${esc(t.name)}">#${esc(t.name)} <small>${t.count}</small></button>`).join('');
        box.innerHTML = `<div class="search-result-head"><div><span class="eyebrow">SEARCH</span><h3>Results for “${esc(q)}”</h3></div><span>${(r.presets||[]).length} presets</span></div>${users?`<div class="search-entity-group"><b>Users</b><div class="search-entity-list">${users}</div></div>`:''}${cats?`<div class="search-entity-group"><b>Categories</b><div class="search-chip-list">${cats}</div></div>`:''}${tags?`<div class="search-entity-group"><b>Tags</b><div class="search-chip-list">${tags}</div></div>`:''}`;
        box.hidden = false;
      }
      return r;
    } catch (e) { toast(e.message,'error'); return null; }
  }
  async function suggestions(q) {
    const box = $('#searchSuggestions');
    if (!box) return;
    if (q.length < 2) { box.hidden = true; return; }
    try {
      const r = await api(`/presets/global-search?q=${encodeURIComponent(q)}`);
      const rows = [];
      (r.presets||[]).slice(0,5).forEach(p => rows.push(`<button class="suggestion-item" data-action="view-preset" data-id="${esc(p.id)}"><span class="suggestion-thumb">${imgTag(p.previewImage,p.name,'')}</span><span><strong>${esc(p.name)}</strong><small>${esc(p.author||'Creator')} · ${esc(p.category||'General')}</small></span><i class="fas fa-arrow-right"></i></button>`));
      (r.users||[]).slice(0,3).forEach(u => rows.push(`<button class="suggestion-item" data-action="profile" data-id="${esc(u.id)}"><span class="suggestion-thumb">${u.avatar?imgTag(u.avatar,u.name,''):esc((u.name||'U').charAt(0))}</span><span><strong>${esc(u.name||u.username)}</strong><small>@${esc(u.username||'user')}</small></span><i class="fas fa-user"></i></button>`));
      (r.categories||[]).slice(0,3).forEach(c => rows.push(`<button class="suggestion-item" data-action="category" data-category="${esc(c.name)}"><span class="suggestion-google"><i class="fas fa-layer-group"></i></span><span><strong>${esc(c.name)}</strong><small>${c.count} presets</small></span><i class="fas fa-arrow-right"></i></button>`));
      (r.tags||[]).slice(0,4).forEach(t => rows.push(`<button class="suggestion-item" data-action="tag-search" data-tag="${esc(t.name)}"><span class="suggestion-google"><i class="fas fa-hashtag"></i></span><span><strong>#${esc(t.name)}</strong><small>${t.count} presets</small></span><i class="fas fa-arrow-right"></i></button>`));
      box.innerHTML = rows.join('') || `<div class="suggestion-empty">No results found for “${esc(q)}”</div>`;
      box.hidden = false;
    } catch (_) { box.hidden = true; }
  }

  // ============ PWA ============
  function installPWA() {
    if (state.installPrompt) {
      state.installPrompt.prompt();
      state.installPrompt.userChoice.finally(() => { state.installPrompt = null; });
    } else {
      toast('Browser menu → Add to Home screen / Install app', 'info');
    }
  }

  function registerSW() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.installPrompt = e; });
  }

  // ============ BOOTSTRAP ============
  async function bootstrap() {
    const savedTheme = localStorage.getItem('presethub_theme');
    if (savedTheme === 'dark') document.body.classList.add('dark');
    registerSW();

    if (state.token) {
      try { const r = await api('/auth/me'); state.user = r.user; } catch (_) {}
    }
    updateAuthUI();

    await Promise.all([loadPresets(), loadCategories(), loadCreators(), loadFeatured()]);
    await flushPendingProfile();
    await resumeQueuedUploads();

    const params = new URLSearchParams(location.search);
    if (params.get('q')) {
      state.query = params.get('q').trim();
      const input = $('#searchInput'); if (input) input.value = state.query;
      await globalSearch(state.query);
      await loadPresets();
    }
    if (params.get('action') === 'search') $('#searchInput')?.focus();
    if (params.get('action') === 'wishlist') showWishlist();
    if (params.get('action') === 'upload') openUpload();
    if (params.get('action') === 'profile') openAccount();
  }

  // ============ GLOBAL CLICK HANDLER ============
  document.addEventListener('click', async e => {
    // Upload tab switching
    if (e.target.dataset.uploadTab) {
      const tab = e.target.dataset.uploadTab;
      document.querySelectorAll('.upload-tab').forEach(t => t.classList.toggle('active', t.dataset.uploadTab === tab));
      document.querySelectorAll('form[data-tab]').forEach(f => { f.hidden = f.dataset.tab !== tab; });
      return;
    }

    // Share platform click
    if (e.target.closest('[data-share-platform]')) {
      const btn = e.target.closest('[data-share-platform]');
      const platform = btn.dataset.sharePlatform;
      const ok = openSharePlatform(platform, btn.dataset.url, btn.dataset.text, btn.dataset.title);
      if (ok && state.currentPreset) trackShare(state.currentPreset.id, platform);
      return;
    }

    // Share copy
    if (e.target.closest('[data-share-copy]')) {
      const btn = e.target.closest('[data-share-copy]');
      navigator.clipboard.writeText(btn.dataset.shareCopy)
        .then(() => toast('Link copied!'))
        .catch(() => toast('Copy failed', 'error'));
      return;
    }

    // Share copy image + link
    if (e.target.closest('[data-share-copy-image]')) {
      const btn = e.target.closest('[data-share-copy-image]');
      const text = `${btn.dataset.shareCopyUrl}\n${btn.dataset.shareCopyImage}`;
      navigator.clipboard.writeText(text)
        .then(() => toast('Link + image URL copied!'))
        .catch(() => toast('Copy failed', 'error'));
      return;
    }

    // data-action buttons
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;

    if (action === 'close') { closeModal(); return; }
    if (action === 'login') { openAuth('login'); return; }
    if (action === 'signup') { openAuth('signup'); return; }
    if (action === 'account') { openAccount(); return; }
    if (action === 'logout') {
      state.token = ''; state.user = null;
      localStorage.removeItem('presethub_token');
      updateAuthUI(); closeModal(); toast('Logged out');
      return;
    }
    if (action === 'upload') { openUpload(); return; }
    if (action === 'wishlist' || action === 'wishlist-page') {
      action === 'wishlist' ? toggleWishlist(el.dataset.id) : showWishlist();
      return;
    }
    if (action === 'downloads') { showDownloads(); return; }
    if (action === 'notifications') { showNotifications(); return; }
    if (action === 'read-notifications') {
      if (requireAuth()) {
        await api('/users/notifications/read-all', { method: 'POST' });
        showNotifications();
      }
      return;
    }
    if (action === 'my-profile') { showProfile(state.user.id); return; }
    if (action === 'edit-profile') { editProfileModal(); return; }
    if (action === 'edit-preset') { editPreset(el.dataset.id); return; }
    if (action === 'delete-preset') { deletePreset(el.dataset.id); return; }
    if (action === 'my-shares') { showMyShares(); return; }
    if (action === 'select-preset') {
      const id = String(el.dataset.id);
      if (el.checked) state.selected.add(id); else state.selected.delete(id);
      updateSelectionUI(); return;
    }
    if (action === 'bulk-download') { bulkDownload(); return; }
    if (action === 'clear-selection') { state.selected.clear(); $$('#presetGrid input[data-action=\"select-preset\"]').forEach(x => x.checked = false); updateSelectionUI(); return; }
    if (action === 'comment-like') { likeComment(el.dataset.preset, el.dataset.comment); return; }
    if (action === 'view-preset') { showPreset(el.dataset.id); return; }
    if (action === 'download') { downloadPreset(el.dataset.id); return; }
    if (action === 'like') { likePreset(el.dataset.id); return; }
    if (action === 'share') { sharePreset(el.dataset.id); return; }
    if (action === 'share-stats') { showShareStats(el.dataset.id); return; }
    if (action === 'profile') { showProfile(el.dataset.id); return; }
    if (action === 'follow') { follow(el.dataset.id); return; }
    if (action === 'switch-auth') { openAuth(el.dataset.mode); return; }
    if (action === 'tag-search') { state.query = el.dataset.tag || ''; state.category=''; $('#searchInput').value=state.query; $('#searchSuggestions')?.setAttribute('hidden',''); globalSearch(state.query); loadPresets(); return; }
    if (action === 'retry') { loadPresets(); return; }
    if (action === 'category') {
      state.query = ''; state.category = el.dataset.category;
      loadPresets();
      return;
    }
    if (action === 'install') { installPWA(); return; }
    if (action === 'theme') {
      document.body.classList.toggle('dark');
      localStorage.setItem('presethub_theme', document.body.classList.contains('dark') ? 'dark' : 'light');
      const icon = el.querySelector('i');
      if (icon) icon.className = document.body.classList.contains('dark') ? 'fas fa-sun' : 'fas fa-moon';
      return;
    }
  });

  // ============ GLOBAL SUBMIT HANDLER ============
  document.addEventListener('submit', async e => {
    if (e.target.id === 'searchForm') {
      e.preventDefault();
      state.query = $('#searchInput')?.value.trim() || '';
      state.category = '';
      $('#searchSuggestions')?.setAttribute('hidden', '');
      if (state.query) await globalSearch(state.query); else $('#searchEntityResults')?.setAttribute('hidden','');
      await loadPresets();
      document.querySelector('#presets')?.scrollIntoView({behavior:'smooth',block:'start'});
      return;
    }
    if (e.target.id === 'authForm') { e.preventDefault(); submitAuth(e.target); return; }
    if (e.target.id === 'uploadForm') { e.preventDefault(); submitUpload(e.target); return; }
    if (e.target.id === 'bulkUploadForm') { e.preventDefault(); submitBulkUpload(e.target); return; }
    if (e.target.id === 'profileForm') {
      e.preventDefault();
      if (!requireAuth()) return;
      const fd = new FormData(e.target);
      const avatarFile = fd.get('avatarFile');
      const payload = { name: fd.get('name'), username: fd.get('username'), bio: fd.get('bio'), socialLinks: { instagram: fd.get('instagram') || '', youtube: fd.get('youtube') || '', twitter: fd.get('twitter') || '', website: fd.get('website') || '' } };
      try {
        localStorage.setItem('presethub_pending_profile', JSON.stringify(payload));
        const r = await api('/auth/profile', { method: 'PUT', body: JSON.stringify(payload) });
        localStorage.removeItem('presethub_pending_profile'); state.user = r.user; updateAuthUI();
        if (avatarFile instanceof File && avatarFile.size) {
          const id=makeId(); const record={id,kind:'avatar',method:'PUT',path:'/users/me/avatar',token:state.token,name:'profile image',fields:[],files:[{field:'avatar',file:avatarFile}]};
          await queuePut(record); await processQueuedUpload(record,true);
        } else toast('Profile updated');
      } catch (err) { toast(err.message || 'Profile update failed. Your changes are saved and will retry when you return.', 'error'); }
      return;
    }
    if (e.target.id === 'editPresetForm') {
      e.preventDefault();
      try {
        const fd = new FormData(e.target);
        const files = []; for (const [k,v] of [...fd.entries()]) if (v instanceof File && v.size) files.push([k,v]);
        const clean = new FormData(); for (const [k,v] of fd.entries()) if (!(v instanceof File)) clean.append(k,v); files.forEach(([k,v])=>clean.append(k,v,v.name));
        const r = await api(`/presets/${e.target.dataset.id}`, { method:'PUT', body: clean });
        toast('Preset updated'); closeModal(); openAccount(); await loadPresets(); await loadFeatured(true);
      } catch(err){ toast(err.message,'error'); }
      return;
    }
    if (e.target.id === 'reviewForm') { e.preventDefault(); submitReview(e.target); return; }
    if (e.target.id === 'commentForm') { e.preventDefault(); submitComment(e.target); return; }
  });

  // ============ SEARCH INPUT ============
  $('#searchInput')?.addEventListener('input', e => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => suggestions(e.target.value.trim()), 220);
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.nav-search')) $('#searchSuggestions')?.setAttribute('hidden', '');
  });

  // ============ FILTERS ============
  $('#priceFilter')?.addEventListener('change', e => { state.price = e.target.value; loadPresets(true, true); });
  $('#sortFilter')?.addEventListener('change', e => { state.sort = e.target.value; loadPresets(true, true); });

  // ============ MODAL CLOSE ============
  $('#overlay')?.addEventListener('click', e => { if (e.target.id === 'overlay') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // ============ EXPORTS ============
  window.PresetHub = { showPreset, showProfile, openUpload, openAuth, installPWA, showShareStats };
  window.addEventListener('DOMContentLoaded', bootstrap);
})();