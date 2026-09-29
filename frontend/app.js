(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CATS = [['Portrait', '🧑'], ['Travel', '✈️'], ['सनसेट', '🌅'], ['Street', '🏙️'], ['Wedding', '💍'], ['Moody', '🌫️'], ['General', '🎨']];
  const state = { token: localStorage.getItem('token'), me: null, category: '', q: '', list: [] };

  // ---------- helpers ----------
  async function api(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    if (opts.json) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.json); }
    const res = await fetch('/api' + path, { ...opts, headers });
    if (res.status === 401 && state.token) { logout(true); throw new Error('Session expired, login again'); }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Request failed');
    return opts.blob ? res : res.json();
  }
  function toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    $('#toastBox').appendChild(t); setTimeout(() => t.remove(), 3200);
  }
  const money = p => (p > 0 ? '₹' + p : 'Free');
  const stars = r => '★'.repeat(Math.round(r || 0)) + '☆'.repeat(5 - Math.round(r || 0));
  const openModal = html => { $('#modalBody').innerHTML = html; $('#overlay').classList.add('active'); };
  const closeModal = () => $('#overlay').classList.remove('active');
  const need = () => { if (state.token) return true; showAuth('login'); toast('पहले लॉग इन करें'); return false; };

  // ---------- auth ----------
  function renderUser() {
    const on = !!state.me;
    $('#authSection').classList.toggle('hidden', on);
    $('#userSection').style.display = on ? 'flex' : 'none';
    if (on) {
      $('#avatar').textContent = (state.me.name || '?').trim().charAt(0).toUpperCase();
      $('#adminLink').classList.toggle('hidden', state.me.role !== 'admin');
    }
  }
  function logout(silent) {
    closeModal(); localStorage.removeItem('token'); state.token = null; state.me = null; renderUser();
    if (!silent) toast('लॉग आउट हो गए');
  }
  function showAuth(mode) {
    const su = mode === 'signup';
    openModal(`<h2 style="margin-bottom:16px">${su ? 'नया अकाउंट' : 'लॉग इन'}</h2>
      <form id="authForm" novalidate>
        ${su ? '<div class="form-group"><label for="fName">नाम</label><input id="fName" required maxlength="60" autocomplete="name"></div>' : ''}
        <div class="form-group"><label for="fEmail">ईमेल</label><input id="fEmail" type="email" required autocomplete="email"></div>
        <div class="form-group"><label for="fPass">पासवर्ड ${su ? '(कम से कम 8)' : ''}</label>
          <input id="fPass" type="password" required minlength="8" maxlength="72" autocomplete="${su ? 'new-password' : 'current-password'}"></div>
        <div id="formErr" role="alert" style="color:#c0392b;min-height:22px;margin-bottom:8px"></div>
        <button class="btn btn-primary" style="width:100%;justify-content:center" type="submit">${su ? 'साइन अप' : 'लॉग इन'}</button>
      </form>
      <p class="mt-2 text-center"><a href="#" data-action="${su ? 'login' : 'signup'}" style="color:var(--accent-text)">${su ? 'पहले से अकाउंट है? लॉग इन' : 'नया अकाउंट बनाएं'}</a></p>`);
    $('#authForm').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = e.target.querySelector('button'); btn.disabled = true;
      try {
        const body = { email: $('#fEmail').value, password: $('#fPass').value };
        if (su) body.name = $('#fName').value;
        const d = await api('/auth/' + mode, { method: 'POST', json: body });
        state.token = d.token; localStorage.setItem('token', d.token);
        state.me = await api('/users/me'); renderUser(); closeModal(); toast('स्वागत है, ' + d.user.name + '!');
      } catch (err) { $('#formErr').textContent = err.message; btn.disabled = false; }
    });
  }

  // ---------- lists ----------
  function card(p) {
    const img = p.previewImage
      ? `<img src="${esc(p.previewImage)}" alt="${esc(p.name)}" loading="lazy" style="width:100%;height:100%;object-fit:cover">`
      : '<span style="font-size:3rem" aria-hidden="true">🎞️</span>';
    return `<article class="preset-card" data-action="open" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(p.name)}">
      <div class="thumb">${img}<div class="overlay"><span class="btn btn-sm">देखें</span></div></div>
      <div class="info"><span class="tag">${esc(p.category)}</span><h3>${esc(p.name)}</h3>
        <div class="author">by ${esc(p.author)}</div>
        <div class="meta"><span class="price ${p.price > 0 ? '' : 'free'}">${money(p.price)}</span>
        <span class="rating" aria-label="${p.avgRating || 0} stars">${stars(p.avgRating)}</span></div></div></article>`;
  }
  async function loadPresets() {
    const grid = $('#presetGrid');
    const qs = new URLSearchParams({ sort: $('#sortFilter').value });
    if ($('#priceFilter').value) qs.set('price', $('#priceFilter').value);
    if (state.category) qs.set('category', state.category);
    if (state.q) qs.set('q', state.q);
    grid.innerHTML = '<div class="skeleton" style="height:260px"></div>'.repeat(4);
    try {
      state.list = await api('/presets?' + qs);
      grid.innerHTML = state.list.length ? state.list.map(card).join('')
        : '<p style="grid-column:1/-1;text-align:center;color:var(--muted)">कोई preset नहीं मिला।</p>';
      if (!qs.has('q') && !qs.has('category') && !qs.has('price')) {
        $('#statPresets').textContent = state.list.length;
        $('#statFree').textContent = state.list.filter(p => !p.price).length;
      }
    } catch (err) { grid.innerHTML = `<p style="grid-column:1/-1">${esc(err.message)}</p>`; }
    $('#listTitle').textContent = state.q ? `"${state.q}" के नतीजे` : state.category || 'सभी Presets';
  }
  function renderCategories() {
    $('#categories').innerHTML = CATS.map(([n, i]) =>
      `<div class="category-card" data-action="cat" data-cat="${esc(n)}" tabindex="0" role="button"><div class="icon">${i}</div><div class="name">${esc(n)}</div></div>`).join('');
  }
  async function loadCreators() {
    try {
      const c = await api('/users/top');
      $('#creators').innerHTML = c.map(u => `<div class="creator-card" data-action="creator" data-id="${esc(u.id)}" tabindex="0" role="button"><div class="user-avatar" style="margin:0 auto 8px">${esc((u.name || '?')[0].toUpperCase())}</div>
        <div class="name">${esc(u.name)}</div><div class="stats">${u.presetCount} presets · ${u.totalDownloads} downloads</div></div>`).join('')
        || '<p style="color:var(--muted)">अभी कोई creator नहीं।</p>';
    } catch { /* non-critical */ }
  }

  // ---------- preset modal ----------
  async function openPreset(id) {
    const p = state.list.find(x => x.id === id) || (await api('/presets?q=')).find(x => x.id === id);
    if (!p) return;
    openModal(`<div class="modal-grid">
      <div class="modal-preview">${p.previewImage ? `<img src="${esc(p.previewImage)}" alt="${esc(p.name)}">` : '<span style="font-size:4rem">🎞️</span>'}</div>
      <div class="modal-details"><h2>${esc(p.name)}</h2><div class="author">by ${esc(p.author)} · ${esc(p.category)}</div>
        <div class="price-lg ${p.price > 0 ? '' : 'free'}">${money(p.price)}</div>
        <p class="desc">${esc(p.description) || 'कोई विवरण नहीं।'}</p>
        <div class="actions">
          <button class="btn btn-primary" data-action="get" data-id="${esc(p.id)}"><i class="fas fa-download" aria-hidden="true"></i> ${p.price > 0 ? 'खरीदें' : 'Download'}</button>
          <button class="btn btn-outline" data-action="wish" data-id="${esc(p.id)}" aria-label="Wishlist"><i class="${state.me?.wishlist?.includes(p.id) ? 'fas' : 'far'} fa-heart" aria-hidden="true"></i></button>
        </div>
        <div class="meta-list"><span><i class="fas fa-download"></i>${p.downloads || 0}</span><span><i class="fas fa-star"></i>${p.avgRating || 0}</span></div>
      </div></div>
      <h3 style="margin:24px 0 8px">Reviews</h3><div id="reviews"><div class="skeleton" style="height:50px"></div></div>
      <form id="revForm" class="mt-2"><div class="form-group"><label for="rRate">Rating</label>
        <select id="rRate">${[5, 4, 3, 2, 1].map(n => `<option value="${n}">${'★'.repeat(n)}</option>`).join('')}</select></div>
        <div class="form-group"><textarea id="rText" maxlength="500" placeholder="आपका अनुभव…" aria-label="Comment"></textarea></div>
        <button class="btn btn-accent btn-sm" type="submit">Review भेजें</button></form>`);
    try {
      const r = await api('/reviews/' + encodeURIComponent(id));
      $('#reviews').innerHTML = r.length ? r.map(x => `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
        <strong>${esc(x.userName)}</strong> <span style="color:var(--star)">${stars(x.rating)}</span><p>${esc(x.comment)}</p></div>`).join('')
        : '<p style="color:var(--muted)">अभी कोई review नहीं।</p>';
    } catch { $('#reviews').textContent = ''; }
    $('#revForm').addEventListener('submit', async e => {
      e.preventDefault(); if (!need()) return;
      try {
        await api('/reviews/' + encodeURIComponent(id), { method: 'POST', json: { rating: +$('#rRate').value, comment: $('#rText').value } });
        toast('Review जुड़ गया'); openPreset(id); loadPresets();
      } catch (err) { toast(err.message); }
    });
  }

  async function download(id) {
    const res = await api(`/presets/${encodeURIComponent(id)}/download`, { method: 'POST', blob: true });
    const name = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'preset.xmp';
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: decodeURIComponent(name) });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Download शुरू हो गया');
  }
  const loadRzp = () => new Promise((ok, no) => {
    if (window.Razorpay) return ok();
    const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = ok; s.onerror = () => no(new Error('Payment gateway load नहीं हुआ')); document.head.appendChild(s);
  });
  async function get(id) {
    if (!need()) return;
    const p = state.list.find(x => x.id === id);
    try {
      if (p && p.price > 0) {
        const o = await api('/payments/create-order', { method: 'POST', json: { presetId: id } }).catch(e => {
          if (/already own/i.test(e.message)) return null; throw e; });
        if (o) {
          await loadRzp();
          return new Promise(resolve => new window.Razorpay({
            key: o.key, amount: o.amount, currency: o.currency, order_id: o.orderId, name: 'PresetHub', description: p.name,
            prefill: { email: state.me?.email, name: state.me?.name },
            handler: async r => { try { await api('/payments/verify', { method: 'POST', json: r }); await download(id); } catch (e) { toast(e.message); } resolve(); },
            modal: { ondismiss: resolve }
          }).open());
        }
      }
      await download(id);
    } catch (err) { toast(err.message); }
  }

  // ---------- upload ----------
  function showUpload() {
    if (!need()) return;
    openModal(`<h2 style="margin-bottom:16px">Preset अपलोड करें</h2><form id="upForm">
      <div class="form-group"><label for="uName">नाम</label><input id="uName" name="name" required minlength="3" maxlength="80"></div>
      <div class="form-group"><label for="uDesc">विवरण</label><textarea id="uDesc" name="description" maxlength="1000"></textarea></div>
      <div class="form-group"><label for="uCat">Category</label><select id="uCat" name="category">${CATS.map(([n]) => `<option>${esc(n)}</option>`).join('')}</select></div>
      <div class="form-group"><label for="uTags">Tags (comma से अलग)</label><input id="uTags" name="tags" maxlength="200"></div>
      <div class="form-group"><label for="uPrice">कीमत ₹ (0 = free)</label><input id="uPrice" name="price" type="number" min="0" max="100000" step="1" value="0"></div>
      <div class="form-group"><label for="uFile">Preset फ़ाइल (.xmp .dng .lrtemplate, max 10MB)</label><input id="uFile" name="file" type="file" accept=".xmp,.dng,.lrtemplate" required></div>
      <div class="form-group"><label for="uPrev">Preview फ़ोटो (JPG/PNG/WEBP)</label><input id="uPrev" name="previewImage" type="file" accept="image/jpeg,image/png,image/webp"></div>
      <div id="formErr" role="alert" style="color:#c0392b;min-height:22px"></div>
      <button class="btn btn-primary" type="submit">अपलोड करें</button></form>`);
    $('#upForm').addEventListener('submit', async e => {
      e.preventDefault(); const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      const fd = new FormData(e.target); if (!fd.get('previewImage')?.size) fd.delete('previewImage');
      try {
        const p = await api('/presets', { method: 'POST', body: fd });
        closeModal(); toast(p.status === 'approved' ? 'Preset live है!' : 'Preset admin approval के लिए भेजा गया');
        loadPresets();
      } catch (err) { $('#formErr').textContent = err.message; btn.disabled = false; }
    });
  }

  // ---------- account / profile / wishlist / follow ----------
  const remember = items => { state.list = [...new Map([...state.list, ...items].map(p => [p.id, p])).values()]; };
  const skel = h => `<div class="skeleton" style="height:${h}px"></div>`;

  function showAccount() {
    if (!state.me) return;
    openModal(`<h2>${esc(state.me.name)}</h2><p class="author" style="color:var(--muted)">${esc(state.me.email)}</p>
      <div style="display:grid;gap:10px;margin-top:18px">
        <button class="btn btn-outline" data-action="profile">✏️ प्रोफ़ाइल एडिट करें</button>
        <button class="btn btn-outline" data-action="mine">📦 मेरे Presets</button>
        <button class="btn btn-outline" data-action="wishlist">❤️ Wishlist</button>
        <button class="btn btn-outline" data-action="downloads">⬇️ मेरे Downloads</button>
        <button class="btn btn-outline" data-action="viewme">👤 पब्लिक प्रोफ़ाइल देखें</button>
        <button class="btn btn-danger" data-action="logout">लॉग आउट</button></div>`);
  }

  async function showList(title, path, mine) {
    openModal(`<h2 style="margin-bottom:16px">${title}</h2><div id="listBox">${skel(120)}</div>`);
    try {
      const items = await api(path); remember(items);
      $('#listBox').innerHTML = !items.length ? '<p style="color:var(--muted)">यहाँ अभी कुछ नहीं है।</p>'
        : `<div class="preset-grid" style="margin:0">${items.map(p => mine
          ? `<div>${card(p)}<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 4px">
              <span class="status-badge status-${esc(p.status)}" style="font-size:.75rem;font-weight:700">${esc(p.status)}</span>
              <button class="btn btn-danger btn-sm" data-action="delpreset" data-id="${esc(p.id)}">हटाएं</button></div></div>`
          : card(p)).join('')}</div>`;
    } catch (err) { $('#listBox').textContent = err.message; }
  }

  async function delPreset(id) {
    if (!confirm('यह preset हमेशा के लिए हटाएं?')) return;
    try { await api('/presets/' + encodeURIComponent(id), { method: 'DELETE' }); toast('हटा दिया गया'); showList('📦 मेरे Presets', '/users/me/presets', true); loadPresets(); }
    catch (err) { toast(err.message); }
  }

  async function toggleWish(id, el) {
    if (!need()) return;
    try {
      const r = await api('/users/me/wishlist/' + encodeURIComponent(id), { method: 'POST' });
      state.me.wishlist = r.wishlist; const on = r.wishlist.includes(id);
      const i = el.querySelector('i'); if (i) i.className = (on ? 'fas' : 'far') + ' fa-heart';
      toast(on ? 'Wishlist में जोड़ा ❤️' : 'Wishlist से हटाया');
    } catch (err) { toast(err.message); }
  }

  function showProfileEdit() {
    const m = state.me, s = m.socialLinks || {};
    const f = (id, label, val, extra = '') => `<div class="form-group"><label for="${id}">${label}</label><input id="${id}" value="${esc(val)}" ${extra}></div>`;
    openModal(`<h2 style="margin-bottom:16px">प्रोफ़ाइल एडिट</h2><form id="profForm">
      ${f('pName', 'नाम', m.name, 'maxlength="60" required')}
      ${f('pUser', 'Username (a-z, 0-9, _)', m.username || '', 'maxlength="30" pattern="[A-Za-z0-9_]{3,30}" placeholder="जैसे: rahul_photo"')}
      <div class="form-group"><label for="pBio">Bio</label><textarea id="pBio" maxlength="300">${esc(m.bio || '')}</textarea></div>
      ${f('pAvatar', 'Avatar (फोटो का https लिंक)', m.avatar || '', 'type="url" placeholder="https://…"')}
      ${f('pInsta', 'Instagram लिंक', s.instagram || '', 'type="url"')}${f('pYt', 'YouTube लिंक', s.youtube || '', 'type="url"')}
      ${f('pTw', 'Twitter/X लिंक', s.twitter || '', 'type="url"')}${f('pWeb', 'Website', s.website || '', 'type="url"')}
      <div id="formErr" role="alert" style="color:#c0392b;min-height:22px"></div>
      <button class="btn btn-primary" type="submit">सेव करें</button></form>`);
    $('#profForm').addEventListener('submit', async e => {
      e.preventDefault(); const btn = e.target.querySelector('button'); btn.disabled = true;
      const json = { name: $('#pName').value, bio: $('#pBio').value, avatar: $('#pAvatar').value,
        socialLinks: { instagram: $('#pInsta').value, youtube: $('#pYt').value, twitter: $('#pTw').value, website: $('#pWeb').value } };
      if ($('#pUser').value.trim()) json.username = $('#pUser').value.trim();
      try { state.me = await api('/users/me', { method: 'PUT', json }); renderUser(); toast('प्रोफ़ाइल सेव हो गई ✅'); showAccount(); }
      catch (err) { $('#formErr').textContent = err.message; btn.disabled = false; }
    });
  }

  const ICONS = { instagram: 'fab fa-instagram', youtube: 'fab fa-youtube', twitter: 'fab fa-x-twitter', website: 'fas fa-globe' };
  async function openCreator(id) {
    openModal(skel(200));
    try {
      const [u, list] = await Promise.all([api('/users/' + encodeURIComponent(id)), api('/users/' + encodeURIComponent(id) + '/presets')]);
      remember(list);
      const self = state.me?.id === u.id, fol = state.me?.following?.includes(u.id);
      const links = Object.entries(u.socialLinks || {}).filter(([k, v]) => v && ICONS[k]).map(([k, v]) =>
        `<a class="social-icon" href="${esc(v)}" target="_blank" rel="noopener noreferrer nofollow" aria-label="${esc(k)}"><i class="${ICONS[k]}"></i></a>`).join('');
      openModal(`<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        ${u.avatar ? `<img src="${esc(u.avatar)}" alt="" style="width:72px;height:72px;border-radius:50%;object-fit:cover">` : `<div class="user-avatar" style="width:72px;height:72px;font-size:1.8rem">${esc((u.name || '?')[0].toUpperCase())}</div>`}
        <div style="flex:1;min-width:160px"><h2>${esc(u.name)} ${u.verified ? '<i class="fas fa-circle-check" style="color:var(--accent-text)" title="Verified"></i>' : ''}</h2>
          ${u.username ? `<div style="color:var(--muted)">@${esc(u.username)}</div>` : ''}</div>
        ${self ? '' : `<button class="btn ${fol ? 'btn-outline' : 'btn-accent'}" id="followBtn" data-action="follow" data-id="${esc(u.id)}">${fol ? 'Following ✓' : '+ Follow'}</button>`}</div>
        ${u.bio ? `<p class="desc" style="margin:14px 0">${esc(u.bio)}</p>` : ''}<div>${links}</div>
        <div class="meta-list" style="margin:14px 0"><span><b>${u.totalPresets}</b> presets</span><span><b>${u.totalDownloads}</b> downloads</span><span><b>${u.followers}</b> followers</span><span><b>${u.following}</b> following</span></div>
        <div class="preset-grid" style="margin:0">${list.map(card).join('') || '<p style="color:var(--muted)">अभी कोई preset नहीं।</p>'}</div>`);
    } catch (err) { openModal(`<p>${esc(err.message)}</p>`); }
  }

  async function toggleFollow(id) {
    if (!need()) return;
    try {
      const r = await api('/users/' + encodeURIComponent(id) + '/follow', { method: 'POST' });
      const set = new Set(state.me.following || []); r.following ? set.add(id) : set.delete(id);
      state.me.following = [...set]; openCreator(id);
    } catch (err) { toast(err.message); }
  }

  // ---------- events (one delegated listener = works with strict CSP) ----------
  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-action]'); if (!el) return;
    const { action, id, cat } = el.dataset;
    if (el.tagName === 'A') e.preventDefault();
    if (action === 'open') openPreset(id);
    else if (action === 'get') get(id);
    else if (action === 'close') closeModal();
    else if (action === 'login' || action === 'signup') showAuth(action);
    else if (action === 'logout') logout();
    else if (action === 'upload') showUpload();
    else if (action === 'cat') { state.category = state.category === cat ? '' : cat; loadPresets(); $('#presets').scrollIntoView({ behavior: 'smooth' }); }
    else if (action === 'wish') toggleWish(id, el);
    else if (action === 'account') showAccount();
    else if (action === 'profile') showProfileEdit();
    else if (action === 'wishlist') showList('❤️ Wishlist', '/users/me/wishlist');
    else if (action === 'downloads') showList('⬇️ मेरे Downloads', '/users/me/downloads');
    else if (action === 'mine') showList('📦 मेरे Presets', '/users/me/presets', true);
    else if (action === 'viewme') openCreator(state.me.id);
    else if (action === 'creator') openCreator(id);
    else if (action === 'follow') toggleFollow(id);
    else if (action === 'delpreset') delPreset(id);
    else if (action === 'theme') { document.body.classList.toggle('dark'); localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light'); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-action="open"],[data-action="cat"],[data-action="creator"]')) { e.preventDefault(); e.target.click(); }
  });
  $('#overlay').addEventListener('click', e => { if (e.target.id === 'overlay') closeModal(); });
  $('#priceFilter').addEventListener('change', loadPresets);
  $('#sortFilter').addEventListener('change', loadPresets);

  let t;
  const box = $('#searchSuggestions');
  $('#searchInput').addEventListener('input', e => {
    clearTimeout(t); const q = e.target.value.trim();
    if (q.length < 2) { box.hidden = true; return; }
    t = setTimeout(async () => {
      try {
        const r = await api('/presets/search?q=' + encodeURIComponent(q));
        state.list = [...new Map([...state.list, ...r].map(p => [p.id, p])).values()];
        box.innerHTML = r.map(p => `<div class="suggestion-item" data-action="open" data-id="${esc(p.id)}"><strong>${esc(p.name)}</strong> <small>by ${esc(p.author)}</small></div>`).join('');
        box.hidden = !r.length;
      } catch { box.hidden = true; }
    }, 250);
  });
  document.addEventListener('click', e => { if (!e.target.closest('.nav-search')) box.hidden = true; });
  $('#searchForm').addEventListener('submit', e => { e.preventDefault(); state.q = $('#searchInput').value.trim(); box.hidden = true; loadPresets(); });

  // ---------- init ----------
  (async function init() {
    if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark');
    renderCategories(); renderUser();
    if (state.token) { try { state.me = await api('/users/me'); } catch { /* logout() already ran on 401 */ } renderUser(); }
    loadPresets(); loadCreators();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  })();
})();
