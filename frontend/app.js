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
  const assetUrl = v => { const x = String(v || '').trim(); if (!x) return fallbackPreview; if (/^https?:\/\//i.test(x)) return x; if (x.startsWith('/')) return `${location.origin}${x}`; if (x.startsWith('uploads/')) return `${location.origin}/${x}`; if (/^(previews|presets|avatars|covers)\//i.test(x)) return `${location.origin}/uploads/${x}`; return fallbackPreview; };
  const imgTag = (src, alt, cls='') => `<img class="${cls}" src="${esc(assetUrl(src))}" alt="${esc(alt)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${fallbackPreview}'">`;

  // ============ API HELPER ============
  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
    if (!(options.body instanceof FormData) && options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    let res;
    try { res = await fetch(`${API}${path}`, { ...options, headers }); }
    catch (networkError) {
      if (!location.pathname.endsWith('/status.html')) location.href = '/status.html?error=network';
      throw new Error('PresetHub server is temporarily unavailable.');
    }
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (res.status === 401) {
      state.user = null; state.token = '';
      localStorage.removeItem('presethub_token');
      updateAuthUI();
    }
    if (!res.ok) { if (res.status >= 500 && !location.pathname.endsWith('/status.html')) location.href='/status.html?error='+res.status; throw new Error(data.error || `Request failed (${res.status})`); }
    return data;
  }

  async function uploadApi(path, formData, onProgress) {
    return await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API}${path}`, true);
      if (state.token) xhr.setRequestHeader('Authorization', `Bearer ${state.token}`);
      xhr.responseType = 'json';
      xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)); };
      xhr.onerror = () => reject(new Error('Network error. Please check your connection.'));
      xhr.onload = () => {
        const data = xhr.response || {};
        if (xhr.status === 401) { state.user=null; state.token=''; localStorage.removeItem('presethub_token'); updateAuthUI(); }
        if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(data.error || `Upload failed (${xhr.status})`));
        resolve(data);
      };
      xhr.send(formData);
    });
  }

  function progressCard(title='Uploading…') {
    let el = $('#uploadProgressCard');
    if (!el) { el=document.createElement('div'); el.id='uploadProgressCard'; el.className='upload-progress-card'; document.body.appendChild(el); }
    el.innerHTML=`<div class="progress-head"><div class="progress-icon"><i class="fas fa-cloud-arrow-up"></i></div><div><strong>${esc(title)}</strong><span id="uploadProgressText">Preparing…</span></div></div><div class="progress-track"><i id="uploadProgressBar"></i></div>`;
    return el;
  }
  function updateProgress(percent, text) { const bar=$('#uploadProgressBar'), label=$('#uploadProgressText'); if(bar) bar.style.width=`${percent}%`; if(label) label.textContent=text || `${percent}%`; }
  function finishProgress(success=true, text='Completed') { updateProgress(100,text); const el=$('#uploadProgressCard'); if(el){ el.classList.toggle('success',success); setTimeout(()=>el.remove(),1400); } }

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
          <div class="preset-description">${esc(p.description || 'Lightroom preset')}</div><div class="card-tags">${(p.tags||[]).slice(0,3).map(t=>`<span>#${esc(t)}</span>`).join('')}</div>
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

  function presetSkeleton(){ return `<article class="preset-card skeleton-card"><div class="skeleton-thumb shimmer"></div><div class="skeleton-lines"><i></i><i></i><i></i></div></article>`; }

  // ============ LOAD PRESETS ============
  async function loadPresets(reset = true) {
    if (reset) state.page = 1;
    const params = new URLSearchParams({ page: state.page, limit: 24, sort: state.sort });
    if (state.query) params.set('q', state.query);
    if (state.price) params.set('price', state.price);
    if (state.category) params.set('category', state.category);
    const grid = $('#presetGrid');
    if (grid && reset) grid.innerHTML = Array.from({length:6}, presetSkeleton).join('');
    try {
      const data = await api(`/presets?${params.toString()}`);
      state.presets = reset ? data.presets : [...state.presets, ...data.presets];
      state.totalPages = data.totalPages || 1;
      if (grid) grid.innerHTML = state.presets.length
        ? state.presets.map(presetCard).join('')
        : `<div class="empty-state"><i class="fas fa-box-open"></i><h3>No presets found</h3><p>Try another search or upload the first preset.</p></div>`;
      const title = $('#listTitle');
      if (title) title.textContent = state.query ? `Search: ${state.query}` : 'सभी Presets';
      if ($('#statPresets')) $('#statPresets').textContent = data.total || 0;
      if ($('#statFree')) $('#statFree').textContent = state.presets.filter(p => Number(p.price || 0) === 0).length;
    } catch (e) {
      if (grid) grid.innerHTML = `<div class="empty-state"><h3>Could not load presets</h3><p>${esc(e.message)}</p><button class="btn btn-primary" data-action="retry">Retry</button></div>`;
    }
  }

  async function loadCategories() {
    try {
      const data = await api('/presets?limit=200&sort=newest');
      const counts = {};
      (data.presets || []).forEach(p => counts[p.category || 'General'] = (counts[p.category || 'General'] || 0) + 1);
      const cats = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      state.categories = cats;
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
    try {
      const creators = await api('/users/top');
      state.creators = creators;
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
              <button class="btn btn-primary" data-action="download" data-id="${esc(p.id)}"><i class="fas fa-download"></i> ${Number(p.price||0)>0?'Buy & Download':'Download'}</button>
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
      if (!confirm(`${Number(p.price||0)>0 && p.authorId!==state.user.id ? `Purchase and download \u201c${p.name}\u201d for ${money(p.price)}?` : `Start download for \u201c${p.name}\u201d?`}`)) return;
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
            toast('✅ Payment verified. Your preset is now unlocked.');
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
          <div class="profile-cover" style="${u.coverImage ? `background-image:url('${esc(assetUrl(u.coverImage))}')` : ''}"></div>
          <div class="profile-head profile-head-pro">
            <div class="profile-avatar">${u.avatar ? imgTag(u.avatar, `${u.name || 'Creator'} avatar`) : esc((u.name || 'U').charAt(0).toUpperCase())}</div>
            <div class="profile-main"><span class="eyebrow">CREATOR PROFILE</span><h2>${esc(u.name || u.username || 'Creator')}</h2><p class="profile-handle">@${esc(u.username || 'creator')}</p><p class="profile-bio">${esc(u.bio || 'Preset creator on PresetHub.')}</p></div>
            <div class="profile-actions">${state.user && state.user.id !== u.id ? `<div class="profile-action-stack"><button class="btn btn-primary" data-action="follow" data-id="${esc(u.id)}"><i class="fas fa-user-plus"></i> ${following ? 'Following' : 'Follow'}</button>${following ? `<button class="btn btn-outline" data-action="message" data-id="${esc(u.id)}"><i class="fas fa-message"></i> Message</button>` : ''}</div>` : `<button class="btn btn-outline" data-action="edit-profile"><i class="fas fa-pen"></i> Edit profile</button>`}</div>
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
      <div class="profile-media-grid"><div><label>Profile photo</label><div class="media-preview avatar-preview">${u.avatar ? imgTag(u.avatar,'Profile photo','') : '<i class="fas fa-user"></i>'}</div><input id="profileAvatarFile" type="file" accept="image/jpeg,image/png,image/webp"></div><div><label>Profile poster</label><div class="media-preview cover-preview">${u.coverImage ? imgTag(u.coverImage,'Profile poster','') : '<i class="fas fa-image"></i>'}</div><input id="profileCoverFile" type="file" accept="image/jpeg,image/png,image/webp"></div></div>
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
          <div class="account-actions"><button class="btn btn-outline" data-action="my-profile"><i class="fas fa-user"></i> Profile</button><button class="btn btn-outline" data-action="edit-profile"><i class="fas fa-pen"></i> Edit profile</button><button class="btn btn-outline" data-action="wishlist-page"><i class="fas fa-heart"></i> Wishlist</button><button class="btn btn-outline" data-action="downloads"><i class="fas fa-download"></i> Downloads</button><button class="btn btn-outline" data-action="notifications"><i class="fas fa-bell"></i> Notifications</button><button class="btn btn-outline" data-action="messages"><i class="fas fa-message"></i> Messages</button><button class="btn btn-outline" data-action="my-shares"><i class="fas fa-link"></i> Share links</button><button class="btn btn-danger" data-action="logout"><i class="fas fa-right-from-bracket"></i> Log out</button></div>
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
      openModal(`<h2>Notifications</h2><div class="notification-list">${(list || []).map(n => `<a class="notification ${n.read ? '' : 'unread'}" href="${esc(n.link || '#')}" data-notification-id="${esc(n.id || '')}"><div class="notification-icon"><i class="fas ${n.type==='message'?'fa-message':n.type==='follow'?'fa-user-plus':n.type==='like'?'fa-heart':n.type==='comment'?'fa-comment':n.type==='review'?'fa-star':n.type==='sale'?'fa-bag-shopping':'fa-bell'}"></i></div><div><b>${esc(n.type.replace(/-/g,' '))}</b><p>${esc(n.message)}</p><small>${new Date(n.createdAt).toLocaleString()}</small></div></a>`).join('') || '<p>No notifications.</p>'}<button class="btn btn-outline" data-action="read-notifications">Mark all read</button></div>`);
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
          <div class="form-group"><label>Preview poster (JPG / JPEG / PNG / WEBP)</label><input id="singlePreviewImage" name="previewImage" type="file" accept="image/png,image/jpeg,image/webp"></div><div id="singlePreviewBox" class="upload-preview-box" hidden></div>
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
    const fd = new FormData(form);
    const tags = String(fd.get('tags') || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 10);
    fd.delete('tags'); tags.forEach(t => fd.append('tags', t));
    const presetFile = form.querySelector('[name="file"]')?.files?.[0];
    if (!presetFile) return toast('Select a preset file first', 'error');
    if (!confirm('Publish this preset with the selected preview image?')) return;
    const card=progressCard('Publishing preset…'); closeModal();
    try {
      const r = await uploadApi('/presets', fd, p => updateProgress(p, `Uploading ${p}%`));
      finishProgress(true,'Preset published successfully');
      toast('✅ Preset published. SEO page is ready.');
      await loadPresets();
      if (r.id) showPreset(r.id);
    } catch (e) { card?.remove(); toast(e.message, 'error'); }
  }

  async function submitBulkUpload(form) {
    const fd = new FormData(form);
    const files = fd.getAll('files');
    if (!files.length) return toast('Select at least one preset file', 'error');
    if (files.length > 20) return toast('Max 20 presets per bulk upload', 'error');
    if (!confirm(`Publish ${files.length} preset(s) now?`)) return;

    const btn = form.querySelector('button[type="submit"]');
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = `Uploading ${files.length} preset(s)…`;

    const card = progressCard(`Uploading ${files.length} preset(s)…`);
    try {
      const r = await uploadApi('/presets/bulk', fd, p => { btn.textContent = `Uploading ${p}%…`; updateProgress(p, `Uploading ${p}%`); });
      closeModal();
      finishProgress(true, `${r.created} preset(s) published`);
      toast(`✅ ${r.created} preset(s) published${r.failed ? `, ${r.failed} failed` : ''}`);
      loadPresets();
      if (r.failed > 0 && r.errors) {
        console.warn('Bulk upload errors:', r.errors);
      }
    } catch (e) {
      card?.remove(); toast(e.message, 'error');
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
      openModal(`<div class="edit-preset-panel"><span class="eyebrow">PRESET MANAGEMENT</span><h2>Edit preset</h2><form id="editPresetForm" data-id="${esc(id)}"><div class="form-group"><label>Name</label><input name="name" maxlength="100" value="${esc(p.name)}" required></div><div class="form-group"><label>Description</label><textarea name="description" maxlength="500">${esc(p.description || '')}</textarea></div><div class="form-grid"><div class="form-group"><label>Category</label><input name="category" maxlength="50" value="${esc(p.category || 'General')}"></div><div class="form-group"><label>Price (INR)</label><input name="price" type="number" min="0" step="0.01" value="${Number(p.price||0)}"></div></div><div class="form-group"><label>Tags</label><input name="tags" maxlength="300" value="${esc((p.tags||[]).join(', '))}"></div><div class="form-grid"><div class="form-group"><label>Replace preview poster</label><input name="previewImage" type="file" accept="image/jpeg,image/png,image/webp"></div><div class="form-group"><label>Replace preset file (optional)</label><input name="file" type="file" accept=".xmp,.dng,.lrtemplate,.cube,.3dl,.look,.costyle,.xml,.json,.zip"></div></div><button class="btn btn-primary"><i class="fas fa-check"></i> Save changes</button></form></div>`);
    } catch(e){ toast(e.message,'error'); }
  }
  async function deletePreset(id) {
    if (!requireAuth()) return;
    if (!confirm('Delete this preset permanently?')) return;
    try { await api(`/presets/${id}`, {method:'DELETE'}); toast('Preset deleted'); closeModal(); openAccount(); loadPresets(); } catch(e){ toast(e.message,'error'); }
  }

  // ============ MESSAGES ============
  async function openMessages(targetId) {
    if (!requireAuth()) return;
    try {
      const thread = await api(`/messages/thread/${encodeURIComponent(targetId)}`);
      openModal(`<div class="message-panel"><div class="message-head"><div><span class="eyebrow">PRIVATE CHAT</span><h2>${esc(thread.user.name || thread.user.username || 'Creator')}</h2><small>@${esc(thread.user.username || '')}</small></div><button class="btn btn-outline btn-sm" data-action="messages"><i class="fas fa-inbox"></i> Inbox</button></div><div class="message-thread" id="messageThread">${(thread.messages||[]).map(m=>`<div class="message-bubble ${m.senderId===state.user.id?'mine':'theirs'}"><p>${esc(m.text)}</p><small>${new Date(m.createdAt).toLocaleString()}</small></div>`).join('') || '<div class="empty-state"><i class="fas fa-message"></i><p>Start the conversation.</p></div>'}</div><form id="messageForm" data-recipient="${esc(targetId)}"><textarea name="text" maxlength="2000" placeholder="Write a message…" required></textarea><button class="btn btn-primary"><i class="fas fa-paper-plane"></i> Send</button></form></div>`);
      const box=$('#messageThread'); if(box) box.scrollTop=box.scrollHeight;
    } catch(e){ toast(e.message,'error'); }
  }
  async function showMessages() {
    if (!requireAuth()) return;
    try { const rows=await api('/messages/conversations'); openModal(`<div class="message-panel"><div class="message-head"><div><span class="eyebrow">INBOX</span><h2>Messages</h2></div></div><div class="conversation-list">${rows.map(c=>`<button class="conversation-row" data-action="message" data-id="${esc(c.user.id)}"><div class="creator-avatar">${c.user.avatar?imgTag(c.user.avatar,c.user.name,''):esc((c.user.name||'U').charAt(0).toUpperCase())}</div><div><b>${esc(c.user.name||c.user.username)}</b><small>${esc(c.lastMessage?.text||'No messages yet')}</small></div>${c.unread?`<span class="unread-badge">${c.unread}</span>`:''}</button>`).join('') || '<div class="empty-state"><i class="fas fa-inbox"></i><p>No conversations yet.</p><p>Follow a creator to start messaging.</p></div>'}</div></div>`); }
    catch(e){ toast(e.message,'error'); }
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
  function googleSearch(q) {
    q = String(q || '').trim();
    if (!q) return;
    const url = `https://www.google.com/search?q=${encodeURIComponent(`site:presethub.site ${q} Lightroom preset`)}`;
    window.open(url, '_blank', 'noopener');
  }

  async function suggestions(q) {
    const box = $('#searchSuggestions');
    if (!box) return;
    if (q.length < 2) { box.hidden = true; return; }
    try {
      const r = await api(`/search?q=${encodeURIComponent(q)}`);
      const rows=[];
      (r.presets||[]).slice(0,5).forEach(p => rows.push(`<button class="suggestion-item" data-action="view-preset" data-id="${esc(p.id)}"><span class="suggestion-thumb">${imgTag(p.previewImage,p.name,'')}</span><span><strong>${esc(p.name)}</strong><small>${esc(p.author || 'Creator')} · ${esc(p.category || 'General')} · ${(p.tags||[]).slice(0,2).map(t=>'#'+esc(t)).join(' ')}</small></span><i class="fas fa-sliders"></i></button>`));
      (r.users||[]).slice(0,3).forEach(u => rows.push(`<button class="suggestion-item" data-action="profile" data-id="${esc(u.id)}"><span class="suggestion-thumb">${u.avatar?imgTag(u.avatar,u.name,''):`<span>${esc((u.name||'U').charAt(0).toUpperCase())}</span>`}</span><span><strong>${esc(u.name||u.username)}</strong><small>@${esc(u.username||'creator')} · Creator · ${u.presetCount||0} presets</small></span><i class="fas fa-user"></i></button>`));
      (r.categories||[]).slice(0,3).forEach(c => rows.push(`<button class="suggestion-item" data-action="category" data-category="${esc(c.name)}"><span class="suggestion-thumb"><i class="fas fa-layer-group"></i></span><span><strong>${esc(c.name)}</strong><small>Category · ${c.count||0} presets</small></span><i class="fas fa-arrow-right"></i></button>`));
      rows.push(`<button class="suggestion-item google-suggestion" data-action="google-search" data-query="${esc(q)}"><span class="suggestion-google"><i class="fab fa-google"></i></span><span><strong>Google पर खोजें</strong><small>site:presethub.site ${esc(q)}</small></span><i class="fas fa-arrow-up-right-from-square"></i></button>`);
      box.innerHTML = rows.join('');
      box.hidden = false;
    } catch (_) {
      box.innerHTML = `<button class="suggestion-item google-suggestion" data-action="google-search" data-query="${esc(q)}"><span class="suggestion-google"><i class="fab fa-google"></i></span><span><strong>Google पर खोजें</strong><small>site:presethub.site ${esc(q)}</small></span></button>`;
      box.hidden = false;
    }
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
    const themeIcon=$('[data-action="theme"] i'); if(themeIcon) themeIcon.className=document.body.classList.contains('dark')?'fas fa-sun':'fas fa-moon';
    registerSW();

    if (state.token) {
      try { const r = await api('/auth/me'); state.user = r.user; } catch (_) {}
    }
    updateAuthUI();

    await Promise.all([loadPresets(), loadCategories(), loadCreators()]);

    const params = new URLSearchParams(location.search);
    if (params.get('q')) {
      state.query = params.get('q').trim();
      const input = $('#searchInput'); if (input) input.value = state.query;
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

    const notification = e.target.closest('[data-notification-id]');
    if (notification && notification.dataset.notificationId) {
      e.preventDefault();
      try { await api(`/users/notifications/read/${encodeURIComponent(notification.dataset.notificationId)}`, {method:'POST'}); } catch (_) {}
      const href=notification.getAttribute('href') || '/'; closeModal(); if(href.startsWith('/')) location.href=href; else window.open(href,'_blank','noopener');
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
    if (action === 'message') { openMessages(el.dataset.id); return; }
    if (action === 'messages') { showMessages(); return; }
    if (action === 'switch-auth') { openAuth(el.dataset.mode); return; }
    if (action === 'google-search') { googleSearch(el.dataset.query); return; }
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
      loadPresets();
      return;
    }
    if (e.target.id === 'authForm') { e.preventDefault(); submitAuth(e.target); return; }
    if (e.target.id === 'uploadForm') { e.preventDefault(); submitUpload(e.target); return; }
    if (e.target.id === 'bulkUploadForm') { e.preventDefault(); submitBulkUpload(e.target); return; }
    if (e.target.id === 'profileForm') {
      e.preventDefault();
      if (!requireAuth()) return;
      try {
        const fd = Object.fromEntries(new FormData(e.target).entries());
        const payload = { name: fd.name, username: fd.username, bio: fd.bio, socialLinks: { instagram: fd.instagram || '', youtube: fd.youtube || '', twitter: fd.twitter || '', website: fd.website || '' } };
        const r = await api('/auth/profile', { method: 'PUT', body: JSON.stringify(payload) });
        const media = new FormData();
        const avatarFile = $('#profileAvatarFile')?.files?.[0]; const coverFile = $('#profileCoverFile')?.files?.[0];
        if (avatarFile) media.append('avatar', avatarFile); if (coverFile) media.append('coverImage', coverFile);
        let updated = r.user;
        if (avatarFile || coverFile) { const mr = await uploadApi('/users/me/profile-media', media, p => toast(`Uploading profile images: ${p}%`, 'info')); updated = { ...updated, ...mr }; }
        state.user = updated; updateAuthUI(); toast('✅ Profile updated successfully'); closeModal();
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
    if (e.target.id === 'editPresetForm') {
      e.preventDefault();
      try { const fd=new FormData(e.target); const r=await api(`/presets/${e.target.dataset.id}`, { method:'PUT', body: fd }); toast('✅ Preset updated successfully'); closeModal(); openAccount(); loadPresets(); } catch(err){ toast(err.message,'error'); }
      return;
    }
    if (e.target.id === 'reviewForm') { e.preventDefault(); submitReview(e.target); return; }
    if (e.target.id === 'commentForm') { e.preventDefault(); submitComment(e.target); return; }
    if (e.target.id === 'messageForm') { e.preventDefault(); try { const r=await api('/messages/send',{method:'POST',body:JSON.stringify({recipientId:e.target.dataset.recipient,text:new FormData(e.target).get('text')})}); e.target.reset(); toast('✅ Message sent'); openMessages(e.target.dataset.recipient); } catch(err){ toast(err.message,'error'); } return; }
  });

  // ============ SEARCH INPUT ============
  $('#searchInput')?.addEventListener('input', e => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => suggestions(e.target.value.trim()), 220);
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.nav-search')) $('#searchSuggestions')?.setAttribute('hidden', '');
  });

  document.addEventListener('change', e => {
    if (e.target.id === 'singlePreviewImage') {
      const file=e.target.files?.[0], box=$('#singlePreviewBox');
      if (!file || !box) return;
      const ok=['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(file.type);
      if (!ok) { toast('Preview must be JPG, PNG, WEBP, GIF or AVIF', 'error'); e.target.value=''; return; }
      const url=URL.createObjectURL(file); box.hidden=false; box.innerHTML=`<img src="${url}" alt="Preview poster">`;
    }
  });

  // ============ FILTERS ============
  $('#priceFilter')?.addEventListener('change', e => { state.price = e.target.value; loadPresets(); });
  $('#sortFilter')?.addEventListener('change', e => { state.sort = e.target.value; loadPresets(); });

  // ============ MODAL CLOSE ============
  $('#overlay')?.addEventListener('click', e => { if (e.target.id === 'overlay') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // ============ EXPORTS ============
  window.PresetHub = { showPreset, showProfile, openUpload, openAuth, installPWA, showShareStats };
  window.addEventListener('DOMContentLoaded', bootstrap);
})();