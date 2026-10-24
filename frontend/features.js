/* PresetHub growth features (v3.4.0): daily picks, streak, leaderboard, follow feed, creator earnings,
   report, tip, and collections. Works on the home page and on server-rendered /shayari and /tags pages. */
(() => {
  'use strict';
  const API = location.origin + '/api';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const csrf = () => { const m = document.cookie.match(/(?:^|; )ph_csrf=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; };
  async function api(path, opts = {}) {
    const method = String(opts.method || 'GET').toUpperCase();
    const headers = new Headers(opts.headers || {});
    if (opts.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (method !== 'GET') { const c = csrf(); if (c) headers.set('X-CSRF-Token', c); }
    const r = await fetch(API + path, { ...opts, headers, credentials: 'same-origin' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error || `Request failed (${r.status})`); e.status = r.status; throw e; }
    return d;
  }
  let me = null;
  async function loadMe() {
    if (window.PresetHubApp?.user) me = window.PresetHubApp.user();
    if (!me) { try { me = (await api('/auth/me')).user; } catch (_) { me = null; } }
    return me;
  }
  function toast(msg, type = 'success') {
    if (window.PresetHubApp?.toast) return window.PresetHubApp.toast(msg, type);
    const n = document.createElement('div'); n.className = `tx-toast-item ${type}`; n.textContent = msg;
    let box = $('#txToast'); if (!box) { box = document.createElement('div'); box.id = 'txToast'; box.className = 'tx-toast'; document.body.appendChild(box); }
    box.appendChild(n); setTimeout(() => n.remove(), 3200);
  }
  function modal(html) {
    closeModal();
    const m = document.createElement('div'); m.id = 'featModal'; m.className = 'tx-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = `<div class="tx-modal-card"><button class="tx-modal-close" data-f="close" aria-label="Close">×</button>${html}</div>`;
    m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-f="close"]')) closeModal(); });
    document.body.appendChild(m); document.body.style.overflow = 'hidden';
    return m;
  }
  function closeModal() { $('#featModal')?.remove(); document.body.style.overflow = ''; }
  async function requireLogin() {
    await loadMe();
    if (me) return false;
    toast('Please log in first', 'info');
    if (window.PresetHubApp?.openAuth) window.PresetHubApp.openAuth('login'); else location.href = '/?action=login';
    return true;
  }
  const when = d => d ? new Date(d).toLocaleDateString('en-IN') : '';

  // ---------- 1. Daily preset + shayari ----------
  async function renderDaily() {
    const box = $('#dailyBox'); if (!box) return;
    try {
      const d = await api('/features/daily');
      box.innerHTML = `
        <div class="feat-card">
          <span class="feat-tag">🎨 Preset of the day</span>
          ${d.preset ? `<h3><a href="/preset/${esc(d.preset.id)}/">${esc(d.preset.name)}</a></h3>
          <p>by ${esc(d.preset.author)} · ${esc(d.preset.category)} · <b>${d.preset.price > 0 ? '₹' + d.preset.price : 'Free'}</b></p>
          <a class="btn btn-primary btn-sm" href="/preset/${esc(d.preset.id)}/">Open preset</a>` : '<p>Coming soon.</p>'}
        </div>
        <div class="feat-card">
          <span class="feat-tag">✍️ Shayari of the day</span>
          ${d.text ? `<p class="feat-quote">${esc(d.text.text.slice(0, 220))}${d.text.text.length > 220 ? '…' : ''}</p>
          <div class="feat-row"><a class="btn btn-outline btn-sm" href="/shayari/${esc(d.text.id)}/">Read &amp; copy</a>
          <button class="btn btn-outline btn-sm" data-share-text="${esc(d.text.id)}">Share</button></div>` : '<p>Coming soon.</p>'}
        </div>`;
    } catch (_) { box.innerHTML = ''; }
  }

  // ---------- 2. Streak ----------
  async function checkin() {
    if (!(await loadMe())) return;
    const chip = $('#streakChip');
    try {
      const r = await api('/features/checkin', { method: 'POST', body: '{}' });
      if (chip) { chip.hidden = false; chip.textContent = `🔥 ${r.current}-day streak`; chip.title = `Best: ${r.best} days. Every 7 days = 1 free Pro day.`; }
      if (r.rewarded) toast('🔥 7-day streak! 1 free Pro day added.', 'success', 6000);
    } catch (_) { if (chip) chip.hidden = true; }
  }

  // ---------- 3. Leaderboard + following feed ----------
  let lbTab = 'creators';
  async function renderLeaderboard() {
    const box = $('#leaderBox'); if (!box) return;
    box.innerHTML = '<div class="sr-only" role="status">Loading…</div><div class="skeleton" style="height:140px"></div>';
    try {
      if (lbTab === 'following') {
        if (!(await loadMe())) { box.innerHTML = '<p class="feat-muted">Log in and follow creators to see their latest posts here.</p>'; return; }
        const d = await api('/features/feed');
        box.innerHTML = d.items.length ? `<ul class="feat-list">${d.items.slice(0, 12).map(i => i.kind === 'preset'
          ? `<li><a href="/preset/${esc(i.id)}/">🎨 ${esc(i.name)}</a><small> by ${esc(i.author)}</small></li>`
          : `<li><a href="/shayari/${esc(i.id)}/">✍️ ${esc((i.title || i.text).slice(0, 70))}</a><small> by ${esc(i.author)}</small></li>`).join('')}</ul>`
          : `<p class="feat-muted">${esc(d.note || 'No new posts from people you follow yet.')}</p>`;
        return;
      }
      const d = await api(`/features/leaderboard?type=${lbTab === 'texts' ? 'texts' : 'creators'}`);
      if (!d.items.length) { box.innerHTML = '<p class="feat-muted">Is hafte abhi koi entry nahi. Pehle post karne wale bano!</p>'; return; }
      box.innerHTML = `<ol class="feat-list lb">${d.items.map(i => d.type === 'creators'
        ? `<li><span class="lb-rank">${i.rank}</span><a href="/profile/${esc(i.userId)}/${esc(i.username || 'creator')}/">${esc(i.name)}</a>${i.tick ? `<span class="tick tick-${esc(i.tick)}"><i class="fas fa-circle-check"></i></span>` : ''}<small>${i.downloads} downloads</small></li>`
        : `<li><span class="lb-rank">${i.rank}</span><a href="/shayari/${esc(i.id)}/">${esc((i.title || i.text).slice(0, 60))}</a><small>${i.copies} copies</small></li>`).join('')}</ol>`;
    } catch (e) { box.innerHTML = `<p class="feat-muted">${esc(e.message)}</p>`; }
  }

  // ---------- 4. Creator earnings ----------
  async function openEarnings() {
    if (await requireLogin()) return;
    const m = modal('<h2 class="tx-h">📈 Creator earnings</h2><div id="earnBody"><div class="skeleton" style="height:180px"></div></div>');
    try {
      const d = await api('/features/creator/overview');
      const max = Math.max(1, ...d.series.map(x => x.amount));
      $('#earnBody', m).innerHTML = `
        <div class="feat-level lv-${esc(d.level.key)}"><b>${esc(d.level.label)}</b><span>${d.level.downloads} downloads</span>
          <div class="v32-bar"><span style="width:${d.level.progress}%"></span></div>
          <small>${d.level.toNext ? `${d.level.toNext} more downloads to the next level` : 'Top level reached 🏆'}</small></div>
        <div class="feat-stats">
          <div><b>₹${d.totals.revenueLast30d}</b><span>Sales (30 days)</span></div>
          <div><b>${d.totals.salesLast30d}</b><span>Orders (30 days)</span></div>
          <div><b>₹${d.totals.tipsReceived}</b><span>Tips received</span></div>
          <div><b>${d.totals.presets}</b><span>Presets</span></div>
        </div>
        <h3 class="v32-h">Last 30 days</h3>
        <div class="feat-bars" aria-label="Daily sales chart">${d.series.map(x => `<div title="${esc(x.day)}: ₹${x.amount}"><span style="height:${Math.round((x.amount / max) * 100)}%"></span></div>`).join('')}</div>
        <h3 class="v32-h">Top presets</h3>
        <ul class="feat-list">${d.top.map(p => `<li><a href="/preset/${esc(p.id)}/">${esc(p.name)}</a><small>${p.downloads} downloads · ${p.salesLast30d} sales (30d)</small></li>`).join('') || '<li>Upload a preset to start earning.</li>'}</ul>`;
    } catch (e) { $('#earnBody', m).innerHTML = `<p class="feat-muted">${esc(e.message)}</p>`; }
  }

  // ---------- 5. Report ----------
  function openReport(type, id) {
    modal(`<h2 class="tx-h">🚩 Report</h2>
      <label class="tx-label">Reason<select id="repReason">
        <option value="spam">Spam</option><option value="copyright">Copyright / stolen content</option><option value="abuse">Abuse or harassment</option>
        <option value="hate">Hate speech</option><option value="adult">Adult content</option><option value="scam">Scam or fraud</option><option value="other">Other</option></select></label>
      <label class="tx-label">Details (optional)<textarea id="repDetails" rows="3" maxlength="500"></textarea></label>
      <button class="tx-primary tx-wide" id="repSend">Submit report</button>`);
    $('#repSend').onclick = async () => {
      if (await requireLogin()) return;
      const btn = $('#repSend'); btn.disabled = true;
      try {
        const r = await api('/features/reports', { method: 'POST', body: JSON.stringify({ targetType: type, targetId: id, reason: $('#repReason').value, details: $('#repDetails').value }) });
        closeModal(); toast(r.message || 'Report received');
      } catch (e) { btn.disabled = false; toast(e.message, 'error'); }
    };
  }

  // ---------- 6. Tip ----------
  function openTip(authorId, name) {
    modal(`<h2 class="tx-h">💝 Tip ${esc(name || 'creator')}</h2>
      <p class="feat-muted">Tip goes directly to the creator through secure YOUPI PG checkout.</p>
      <div class="feat-amounts">${[10, 20, 50, 100].map(a => `<button class="tx-btn" data-amt="${a}">₹${a}</button>`).join('')}</div>
      <label class="tx-label">Or enter amount (₹10–₹500)<input id="tipAmt" type="number" min="10" max="500" step="1" value="20"></label>
      <label class="tx-label">Note (optional)<input id="tipNote" maxlength="140" placeholder="Loved your shayari!"></label>
      <button class="tx-primary tx-wide" id="tipGo">Continue to payment</button>`);
    $$('[data-amt]').forEach(b => b.onclick = () => { $('#tipAmt').value = b.dataset.amt; });
    $('#tipGo').onclick = async () => {
      if (await requireLogin()) return;
      const amount = Number($('#tipAmt').value);
      if (!(amount >= 10 && amount <= 500)) return toast('Enter ₹10 to ₹500', 'error');
      const btn = $('#tipGo'); btn.disabled = true; btn.textContent = 'Opening secure checkout…';
      try {
        const r = await api('/payments/youpi/tip', { method: 'POST', body: JSON.stringify({ recipientId: authorId, amount, note: $('#tipNote').value }) });
        location.assign(r.checkoutUrl);
      } catch (e) { btn.disabled = false; btn.textContent = 'Continue to payment'; toast(e.message, 'error'); }
    };
  }

  // ---------- 7. Collections (save a preset) ----------
  async function openSave(presetId) {
    if (await requireLogin()) return;
    const m = modal('<h2 class="tx-h">🔖 Save to collection</h2><div id="colBody"><div class="skeleton" style="height:120px"></div></div>');
    const draw = async () => {
      const d = await api('/collections/mine');
      const ids = new Set();
      $('#colBody', m).innerHTML = `
        <div class="feat-row"><input id="colName" maxlength="60" placeholder="New collection name (e.g. Wedding)" class="feat-input"><button class="btn btn-primary btn-sm" id="colNew">Create</button></div>
        <ul class="feat-list" id="colList">${d.items.map(c => `<li><button class="tx-btn" data-col="${esc(c.id)}"><i class="far fa-bookmark"></i> ${esc(c.name)} <small>(${c.count})</small></button></li>`).join('') || '<li class="feat-muted">No collections yet. Create one above.</li>'}</ul>`;
    };
    try { await draw(); } catch (e) { $('#colBody', m).innerHTML = `<p class="feat-muted">${esc(e.message)}</p>`; return; }
    m.addEventListener('click', async ev => {
      const cbtn = ev.target.closest('[data-col]');
      if (cbtn) {
        try { const r = await api(`/collections/${cbtn.dataset.col}/presets/${presetId}`, { method: 'POST', body: '{}' }); toast(r.added ? 'Saved to collection ✓' : 'Removed from collection'); await draw(); }
        catch (e) { toast(e.message, 'error'); }
      }
      if (ev.target.closest('#colNew')) {
        const name = $('#colName', m).value.trim();
        if (name.length < 2) return toast('Name must be 2+ characters', 'error');
        try { const c = await api('/collections', { method: 'POST', body: JSON.stringify({ name }) }); await api(`/collections/${c.id}/presets/${presetId}`, { method: 'POST', body: '{}' }); toast(`Saved to “${name}”`); await draw(); }
        catch (e) { toast(e.message, 'error'); }
      }
    });
  }

  // ---------- share a shayari as a PNG card (Instagram / WhatsApp status ready) ----------
  const PALETTES = [['#f6d365', '#fda085'], ['#a18cd1', '#fbc2eb'], ['#84fab0', '#8fd3f4'], ['#d4a373', '#f0c987'], ['#2c3e50', '#4ca1af'], ['#232526', '#414345']];
  function wrapLines(ctx, text, maxW) {
    const out = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxW && line) { out.push(line); line = word; } else line = test;
      }
      out.push(line);
    }
    return out;
  }
  async function drawShareCard(text, author, seed = 0, size = 1080) {
    const c = document.createElement('canvas'); c.width = size; c.height = Math.round(size * 1.25);
    const ctx = c.getContext('2d');
    const [a, b] = PALETTES[seed % PALETTES.length];
    const g = ctx.createLinearGradient(0, 0, c.width, c.height); g.addColorStop(0, a); g.addColorStop(1, b);
    ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    const pad = 110, boxW = c.width - pad * 2;
    let fs = 56; let lines = [];
    ctx.font = `600 ${fs}px "Noto Sans Devanagari","Segoe UI",Arial,sans-serif`;
    // shrink font until the text fits the card
    for (; fs >= 30; fs -= 4) {
      ctx.font = `600 ${fs}px "Noto Sans Devanagari","Segoe UI",Arial,sans-serif`;
      lines = wrapLines(ctx, String(text).slice(0, 900), boxW);
      if (lines.length * fs * 1.45 < c.height * 0.6) break;
    }
    const lh = fs * 1.45, blockH = lines.length * lh;
    let y = (c.height - blockH) / 2;
    ctx.fillStyle = '#1c1c1c'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const ln of lines) { ctx.fillText(ln, c.width / 2, y); y += lh; }
    ctx.font = '600 38px "Segoe UI",Arial,sans-serif'; ctx.fillStyle = '#1c1c1c';
    ctx.fillText(`— ${String(author || 'PresetHub').slice(0, 40)}`, c.width / 2, c.height - 190);
    ctx.font = '500 30px "Segoe UI",Arial,sans-serif'; ctx.fillStyle = 'rgba(28,28,28,.7)';
    ctx.fillText('PresetHub · presethub.site', c.width / 2, c.height - 120);
    return c;
  }
  async function shareImage(card) {
    if (!card) return;
    const text = card.querySelector('[data-text-body]')?.textContent || '';
    const author = card.querySelector('.text-by a')?.textContent || '';
    const seed = Array.from(card.dataset.textId || '').reduce((s, ch) => s + ch.charCodeAt(0), 0);
    toast('Creating image…', 'info');
    const canvas = await drawShareCard(text, author, seed);
    canvas.toBlob(blob => {
      if (!blob) return toast('Could not create image', 'error');
      const file = new File([blob], 'presethub-shayari.png', { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) return navigator.share({ files: [file], title: 'PresetHub Shayari' }).catch(() => {});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'presethub-shayari.png';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Image downloaded');
    }, 'image/png');
  }

  // ---------- share a shayari / daily text as a link ----------
  function shareLink(id) {
    const url = `${location.origin}/shayari/${id}/`;
    if (navigator.share) return navigator.share({ url, title: 'PresetHub Shayari', text: 'Read this on PresetHub' }).catch(() => {});
    navigator.clipboard?.writeText(url).then(() => toast('Link copied'));
  }

  // ---------- delegated clicks (works on every page that loads this file) ----------
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-report],[data-tip],[data-save-preset],[data-share-text],[data-lb-tab],[data-earn],[data-share-image]');
    if (!t) return;
    if (t.hasAttribute('data-share-image')) return shareImage(t.closest('[data-text-card]'));
    if (t.dataset.report) openReport(t.dataset.report, t.dataset.id);
    else if (t.dataset.tip !== undefined && t.dataset.tip !== '') openTip(t.dataset.tip, t.dataset.name);
    else if (t.dataset.savePreset) openSave(t.dataset.savePreset);
    else if (t.dataset.shareText) shareLink(t.dataset.shareText);
    else if (t.dataset.lbTab) { lbTab = t.dataset.lbTab; $$('[data-lb-tab]').forEach(b => b.classList.toggle('active', b === t)); renderLeaderboard(); }
    else if (t.dataset.earn !== undefined) openEarnings();
  });

  async function boot() {
    renderDaily();
    renderLeaderboard();
    checkin();
    $('#featEarnings') && (async () => { if (await loadMe()) $('#featEarnings').hidden = false; })();
  }
  window.PresetHubFeatures = { openReport, openTip, openSave, drawShareCard };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
