/* PresetHub Text Prompts / Shayari — shared by the home page section and the SEO pages (/shayari/...). v3.2.0 */
(() => {
  'use strict';
  const API = `${location.origin}/api/texts`;
  const CATS = {
    'sad': 'Sad Shayari', 'true-lines': 'True Lines', 'love': 'Love Shayari', 'attitude': 'Attitude', 'motivation': 'Motivation',
    'friendship': 'Dosti', 'life': 'Life Quotes', 'good-morning': 'Good Morning', 'good-night': 'Good Night', 'funny': 'Funny',
    'romantic': 'Romantic', 'breakup': 'Breakup', 'ai-prompt': 'AI Prompts', 'caption': 'Captions', 'other': 'Other'
  };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v = '') => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = s => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'creator';
  const postUrl = t => `${location.origin}/shayari/${t.id}/${t.slug || 'shayari'}/`;
  const copiedOnce = new Set();
  let me = null;
  let meLoaded = false;

  const csrf = () => { const m = document.cookie.match(/(?:^|; )ph_csrf=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; };
  async function api(path, opts = {}) {
    const method = String(opts.method || 'GET').toUpperCase();
    const headers = new Headers(opts.headers || {});
    if (opts.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (method !== 'GET') { const c = csrf(); if (c) headers.set('X-CSRF-Token', c); }
    const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, { ...opts, headers, credentials: 'same-origin' });
    let data = {}; try { data = await res.json(); } catch (_) {}
    if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
    return data;
  }
  async function loadMe() {
    if (window.PresetHubApp?.user) { me = window.PresetHubApp.user(); }
    if (!me && !meLoaded) { try { me = (await api(`${location.origin}/api/auth/me`)).user; } catch (_) { me = null; } }
    meLoaded = true; return me;
  }
  function toast(msg, type = 'success') {
    if (window.PresetHubApp?.toast) return window.PresetHubApp.toast(msg, type);
    let box = $('#txToast'); if (!box) { box = document.createElement('div'); box.id = 'txToast'; box.className = 'tx-toast'; document.body.appendChild(box); }
    const n = document.createElement('div'); n.className = `tx-toast-item ${type}`; n.textContent = msg; box.appendChild(n); setTimeout(() => n.remove(), 3200);
  }
  async function needLogin() {
    await loadMe();
    if (me) return false;
    toast('Please log in first', 'info');
    if (window.PresetHubApp?.openAuth) { closeModal(); window.PresetHubApp.openAuth('login'); }
    else setTimeout(() => { location.href = '/?action=login'; }, 600);
    return true;
  }

  // ---------- small modal (works with or without app.js) ----------
  function closeModal() { $('#txModal')?.remove(); document.body.style.overflow = ''; }
  function openModal(html) {
    closeModal();
    const m = document.createElement('div'); m.id = 'txModal'; m.className = 'tx-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = `<div class="tx-modal-card"><button class="tx-modal-close" data-t-action="close" aria-label="Close">×</button>${html}</div>`;
    m.addEventListener('click', e => { if (e.target === m) closeModal(); });
    document.body.appendChild(m); document.body.style.overflow = 'hidden';
    return m;
  }

  // ---------- markup (server renders the same structure for SEO pages) ----------
  const tagLinks = (tags = []) => (tags || []).slice(0, 6).map(x => `<a class="tx-tag" href="/tags/${encodeURIComponent(x)}/">#${esc(x)}</a>`).join('');
  const textSkeleton = (n = 6) => `<div class="sr-only" role="status">Loading shayari…</div>` + Array.from({ length: n }, () => `<div class="text-card skel-card" aria-hidden="true"><div class="skel-line w-40 skeleton"></div><div class="skel-line skeleton"></div><div class="skel-line skeleton"></div><div class="skel-line w-70 skeleton"></div><div class="skel-row"><span class="skel-pill skeleton"></span><span class="skel-pill skeleton"></span></div></div>`).join('');
  const tick = t => t ? `<span class="tick tick-${esc(t)}" title="${t === 'gold' ? 'Star creator' : t === 'blue' ? 'Verified creator' : 'Rising creator'}"><i class="fas fa-circle-check"></i></span>` : '';
  const pro = p => p ? '<span class="pro-chip"><i class="fas fa-crown"></i> PRO</span>' : '';
  function cardHtml(t, { full = false } = {}) {
    return `<article class="text-card" data-text-card data-text-id="${esc(t.id)}" data-author-id="${esc(t.authorId)}">
      <div class="text-card-top"><a class="text-cat" href="/shayari/category/${esc(t.category)}/">${esc(CATS[t.category] || t.category)}</a><small>${new Date(t.createdAt).toLocaleDateString()}</small></div>
      ${t.title ? `<h3 class="text-title"><a href="${esc(postUrl(t))}">${esc(t.title)}</a></h3>` : ''}${t.boosted ? '<span class="boost-chip" title="Boosted">⚡ Boosted</span>' : ''}
      <p class="text-body ${full ? 'full' : ''}" data-text-body>${esc(t.text)}</p>
      ${t.tags?.length ? `<div class="tx-tags">${tagLinks(t.tags)}</div>` : ''}
      <div class="text-by"><a href="/profile/${esc(t.authorId)}/${esc(slug(t.authorUsername || t.author))}/">${esc(t.author)}</a> ${tick(t.authorTick)}${pro(t.authorPro)}</div>
      <div class="text-actions">
        <button class="tx-btn tx-copy" data-t-action="copy" title="Copy text"><i class="fas fa-copy"></i> <span>Copy</span></button>
        <button class="tx-btn ${t.liked ? 'liked' : ''}" data-t-action="like" title="Like"><i class="${t.liked ? 'fas' : 'far'} fa-heart"></i> <span data-t-count="likes">${t.likes || 0}</span></button>
        <button class="tx-btn" data-t-action="comment" title="Comments"><i class="far fa-comment"></i> <span data-t-count="comments">${t.comments || 0}</span></button>
        <button class="tx-btn" data-t-action="share" title="Share"><i class="fas fa-share-nodes"></i> <span data-t-count="shares">${t.shares || 0}</span></button>
        <button class="tx-btn" data-share-image title="Share as image"><i class="fas fa-image"></i></button>
        <button class="tx-btn" data-tip="${esc(t.authorId)}" data-name="${esc(t.author)}" title="Tip creator"><i class="fas fa-hand-holding-heart"></i></button>
        <button class="tx-btn" data-report="text" data-id="${esc(t.id)}" title="Report"><i class="fas fa-flag"></i></button>
      </div>
    </article>`;
  }

  // ---------- actions ----------
  const cardData = card => ({ id: card.dataset.textId, text: $('[data-text-body]', card)?.textContent || '', title: $('.text-title', card)?.textContent || '', author: $('.text-by a', card)?.textContent || '' });
  const bump = (card, key, val) => { const el = $(`[data-t-count="${key}"]`, card); if (el) el.textContent = val; };

  async function copyText(card) {
    const d = cardData(card);
    const payload = d.text;
    try { await navigator.clipboard.writeText(payload); }
    catch (_) { const ta = document.createElement('textarea'); ta.value = payload; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (__) {} ta.remove(); }
    const btn = $('.tx-copy span', card); if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 1600); }
    toast('Text copied');
    if (!copiedOnce.has(d.id)) { copiedOnce.add(d.id); api(`/${d.id}/copy`, { method: 'POST', body: '{}' }).catch(() => {}); }
  }
  async function likeText(card) {
    if (await needLogin()) return;
    try {
      const r = await api(`/${card.dataset.textId}/like`, { method: 'POST', body: '{}' });
      const b = $('[data-t-action="like"]', card); b.classList.toggle('liked', r.liked);
      b.querySelector('i').className = `${r.liked ? 'fas' : 'far'} fa-heart`; bump(card, 'likes', r.likes);
    } catch (e) { toast(e.message, 'error'); }
  }
  function shareText(card) {
    const d = cardData(card); const url = `${location.origin}/shayari/${d.id}/`;
    const msg = `${d.text.slice(0, 180)}${d.text.length > 180 ? '…' : ''}\n— ${d.author} on PresetHub`;
    const track = async platform => { try { const r = await api(`/${d.id}/share`, { method: 'POST', body: JSON.stringify({ platform }) }); bump(card, 'shares', r.shares); } catch (_) {} };
    if (navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
      navigator.share({ title: d.title || 'PresetHub Shayari', text: msg, url }).then(() => track('native')).catch(() => {});
      return;
    }
    const e = encodeURIComponent;
    const links = [
      ['whatsapp', 'fab fa-whatsapp', 'WhatsApp', `https://wa.me/?text=${e(msg + '\n' + url)}`],
      ['telegram', 'fab fa-telegram', 'Telegram', `https://t.me/share/url?url=${e(url)}&text=${e(msg)}`],
      ['x', 'fab fa-x-twitter', 'X', `https://twitter.com/intent/tweet?text=${e(msg)}&url=${e(url)}`],
      ['facebook', 'fab fa-facebook', 'Facebook', `https://www.facebook.com/sharer/sharer.php?u=${e(url)}`]
    ];
    const m = openModal(`<h2 class="tx-h">Share</h2><div class="tx-share-grid">${links.map(l => `<a class="tx-share" data-share="${l[0]}" href="${esc(l[3])}" target="_blank" rel="noopener noreferrer"><i class="${l[1]}"></i><span>${l[2]}</span></a>`).join('')}<button class="tx-share" data-t-action="copylink"><i class="fas fa-link"></i><span>Copy link</span></button></div>`);
    m.addEventListener('click', ev => {
      const a = ev.target.closest('[data-share]'); if (a) track(a.dataset.share);
      if (ev.target.closest('[data-t-action="copylink"]')) { navigator.clipboard?.writeText(url).then(() => toast('Link copied')); track('link'); }
    });
  }
  async function commentsModal(card) {
    const id = card.dataset.textId;
    const m = openModal(`<h2 class="tx-h">Comments</h2><div class="tx-comments" id="txComments"><p class="tx-muted">Loading…</p></div>
      <div class="tx-comment-form"><textarea id="txCommentInput" maxlength="500" rows="2" placeholder="Write a comment…"></textarea><button class="tx-primary" data-t-action="send-comment">Send</button></div>`);
    const list = $('#txComments', m);
    const draw = rows => { list.innerHTML = rows.length ? rows.map(c => `<div class="tx-comment"><b>${esc(c.userName)}</b><small>${new Date(c.createdAt).toLocaleString()}</small><p>${esc(c.text)}</p></div>`).join('') : '<p class="tx-muted">No comments yet. Be the first!</p>'; };
    try { draw(await api(`/${id}/comments`)); } catch (e) { list.innerHTML = `<p class="tx-muted">${esc(e.message)}</p>`; }
    m.addEventListener('click', async ev => {
      if (!ev.target.closest('[data-t-action="send-comment"]')) return;
      if (await needLogin()) return;
      const input = $('#txCommentInput', m); const text = input.value.trim(); if (!text) return;
      try { await api(`/${id}/comments`, { method: 'POST', body: JSON.stringify({ text }) }); input.value = ''; draw(await api(`/${id}/comments`)); bump(card, 'comments', list.querySelectorAll('.tx-comment').length); }
      catch (e) { toast(e.message, 'error'); }
    });
  }
  async function composer(onDone) {
    if (await needLogin()) return;
    const m = openModal(`<h2 class="tx-h">✍️ Post a Shayari / Text</h2>
      <label class="tx-label">Title (optional)<input id="txTitle" maxlength="120" placeholder="e.g. Dil ki baat"></label>
      <label class="tx-label">Your text<textarea id="txText" rows="6" maxlength="2000" placeholder="Apni shayari, true lines ya prompt yahan likhein…"></textarea></label>
      <div class="tx-count"><span id="txCount">0</span>/2000</div>
      <div class="tx-row"><label class="tx-label">Category<select id="txCat">${Object.entries(CATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label class="tx-label">Language<select id="txLang"><option value="hindi">Hindi</option><option value="hinglish">Hinglish</option><option value="english">English</option><option value="urdu">Urdu</option><option value="other">Other</option></select></label></div>
      <label class="tx-label">Tags (comma separated)<input id="txTags" maxlength="120" placeholder="dard, yaad, zindagi"></label>
      <button class="tx-primary tx-wide" data-t-action="submit-post">Publish</button>`);
    const ta = $('#txText', m); ta.addEventListener('input', () => { $('#txCount', m).textContent = ta.value.length; });
    m.addEventListener('click', async ev => {
      const btn = ev.target.closest('[data-t-action="submit-post"]'); if (!btn) return;
      const text = ta.value.trim(); if (text.length < 5) return toast('Write at least 5 characters', 'error');
      btn.disabled = true; btn.textContent = 'Publishing…';
      try {
        const post = await api('', { method: 'POST', body: JSON.stringify({ title: $('#txTitle', m).value, text, category: $('#txCat', m).value, language: $('#txLang', m).value, tags: $('#txTags', m).value }) });
        closeModal(); toast('Posted! 🎉'); if (onDone) onDone(post); else location.href = `/shayari/${post.id}/`;
      } catch (e) { btn.disabled = false; btn.textContent = 'Publish'; toast(e.message, 'error'); }
    });
  }

  // ---------- delegation ----------
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-t-action]'); if (!b) return;
    const act = b.dataset.tAction; const card = b.closest('[data-text-card]');
    if (act === 'close') return closeModal();
    if (act === 'new-post') return composer(window.__txAfterPost);
    if (!card) return;
    if (act === 'copy') copyText(card); else if (act === 'like') likeText(card);
    else if (act === 'comment') commentsModal(card); else if (act === 'share') shareText(card);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // ---------- home page section ----------
  async function mountHome() {
    const box = $('#textSection'); if (!box) return;
    const grid = $('#textGrid', box);
    const chips = $('#textChips', box);
    if (chips) chips.innerHTML = Object.entries(CATS).slice(0, 8).map(([k, v]) => `<a class="text-chip" href="/shayari/category/${k}/">${v}</a>`).join('');
    const load = async () => {
      grid.setAttribute('aria-busy', 'true');
      grid.innerHTML = textSkeleton(6);
      try {
        const r = await api('?limit=6&sort=new');
        grid.removeAttribute('aria-busy');
        grid.innerHTML = r.items.length ? r.items.map(t => cardHtml(t)).join('') : '<div class="empty-state"><h3>No shayari yet</h3><p>Be the first to post.</p></div>';
      } catch (e) { grid.removeAttribute('aria-busy'); grid.innerHTML = `<div class="empty-state"><p>${esc(e.message)}</p><button class="btn btn-outline btn-sm" data-retry-texts>Try again</button></div>`; }
    };
    window.__txAfterPost = load;
    await load();
  }

  // ---------- list pages (/shayari/ ...) progressive "load more" ----------
  function mountList() {
    const more = $('[data-load-more]'); if (!more) return;
    const grid = $('#textGrid'); let page = Number(more.dataset.page || 1); const cat = more.dataset.category || ''; const q = more.dataset.q || '';
    more.addEventListener('click', async () => {
      more.disabled = true; page++;
      try {
        const r = await api(`?limit=12&page=${page}${cat ? `&category=${encodeURIComponent(cat)}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
        grid.insertAdjacentHTML('beforeend', r.items.map(t => cardHtml(t)).join(''));
        if (page >= r.pages) more.remove(); else more.disabled = false;
      } catch (e) { toast(e.message, 'error'); more.disabled = false; }
    });
    if (Number(more.dataset.pages || 1) <= page) more.remove();
  }

  document.addEventListener('click', e => { if (e.target.closest('[data-retry-texts]')) { const g = $('#textGrid'); if (g && window.__txAfterPost) window.__txAfterPost(); } });

  // ---------- single post: count a view, show like state ----------
  async function mountSingle() {
    const card = $('[data-text-card][data-single]'); if (!card) return;
    const id = card.dataset.textId;
    api(`/${id}/view`, { method: 'POST', body: '{}' }).catch(() => {});
    try {
      await api(`/${id}`).then(async t => { const b = $('[data-t-action="like"]', card); b.classList.toggle('liked', t.liked); });
      const meNow = await loadMe();
      if (meNow) { const t = await api(`/${id}`); const b = $('[data-t-action="like"]', card); b.classList.toggle('liked', t.liked); b.querySelector('i').className = `${t.liked ? 'fas' : 'far'} fa-heart`; }
    } catch (_) {}
  }

  function boot() {
    mountHome(); mountList(); mountSingle();
    $$('[data-search-form]').forEach(f => f.addEventListener('submit', e => { e.preventDefault(); const q = f.querySelector('input').value.trim(); location.href = q ? `/shayari/?q=${encodeURIComponent(q)}` : '/shayari/'; }));
  }
  window.PresetHubTexts = { composer, cardHtml };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
