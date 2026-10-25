/* Creator dashboard (v3.8.0): profile, earnings, viral posts, text prompts, payout details and payout requests. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const when = d => d ? new Date(d).toLocaleDateString('en-IN') : '—';
  const csrf = () => { const m = document.cookie.match(/(?:^|; )ph_csrf=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; };
  const main = $('#cdMain');
  let state = { data: null, method: 'upi' };

  function toast(msg, type = 'ok') {
    const box = $('#cdToast');
    const d = document.createElement('div'); if (type === 'err') d.className = 'err'; d.textContent = msg;
    box.appendChild(d); setTimeout(() => d.remove(), 3600);
  }
  async function api(path, opts = {}) {
    const method = String(opts.method || 'GET').toUpperCase();
    const headers = new Headers(opts.headers || {});
    if (opts.body) headers.set('Content-Type', 'application/json');
    if (method !== 'GET') { const c = csrf(); if (c) headers.set('X-CSRF-Token', c); }
    const r = await fetch(`/api${path}`, { ...opts, headers, credentials: 'same-origin' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error || `Request failed (${r.status})`); e.status = r.status; throw e; }
    return d;
  }
  function loginNeeded() {
    main.innerHTML = `<div class="cd-card" style="text-align:center;display:grid;gap:12px;justify-items:center">
      <h2>Log in to see your dashboard</h2><p class="cd-muted">Your earnings, payouts and posts are private to your account.</p>
      <a class="cd-btn" href="/?action=login">Log in</a></div>`;
  }

  // ---------- render ----------
  function render(d) {
    const p = d.profile, m = d.money, t = d.totals;
    const initial = esc((p.name || p.username || 'C').trim().charAt(0).toUpperCase());
    const badges = [
      p.isPro ? '<span class="cd-badge pro"><i class="fas fa-crown"></i> PRO</span>' : '',
      p.tick ? `<span class="cd-badge ${p.tick === 'gold' ? 'gold' : 'ok'}">✔ ${p.tick === 'gold' ? 'Star creator' : p.tick === 'blue' ? 'Verified creator' : 'Rising creator'}</span>` : '',
      `<span class="cd-badge">${esc(p.level.label)}</span>`,
      p.verified ? '<span class="cd-badge ok">Verified</span>' : ''
    ].join('');
    const max = Math.max(1, ...d.series.map(x => x.amount));
    const viral = [...d.viral.presets.map(x => `<li><b>🔥 Preset:</b> <a href="/preset/${esc(x.id)}/">${esc(x.name)}</a><small class="cd-muted">${x.downloads} downloads · ${when(x.viralAt)}</small></li>`),
                   ...d.viral.texts.map(x => `<li><b>🔥 Shayari:</b> <a href="/shayari/${esc(x.id)}/">${esc(x.title)}</a><small class="cd-muted">${x.copies} copies · ${when(x.viralAt)}</small></li>`)];
    const texts = d.texts.map(x => `<li>
        <div class="cd-muted">${esc(x.category)} · ${when(x.createdAt)} ${x.viral ? '· 🔥 viral' : ''} ${x.status === 'rejected' ? '· <span class="cd-badge bad">hidden</span>' : ''}</div>
        ${x.title ? `<b>${esc(x.title)}</b>` : ''}
        <p>${esc(x.text)}</p>
        <div class="cd-muted">📋 ${x.copies} copies · ❤️ ${x.likes} · ↗️ ${x.shares} · 💬 ${x.comments} · 👁 ${x.views}</div>
        <a href="/shayari/${esc(x.id)}/">Open →</a></li>`).join('');
    const presets = d.presets.map(x => `<tr><td><a href="/preset/${esc(x.id)}/">${esc(x.name)}</a>${x.viral ? ' 🔥' : ''}</td><td>${esc(x.category)}</td><td>${x.price > 0 ? inr(x.price) : 'Free'}</td><td>${x.downloads}</td><td>${x.views}</td><td>${x.likes}</td><td>${x.status === 'approved' ? '<span class="cd-badge ok">live</span>' : `<span class="cd-badge warn">${esc(x.status)}</span>`}</td></tr>`).join('');
    const payouts = d.payouts.map(x => `<tr><td>${when(x.createdAt)}</td><td>${inr(x.amount)}</td><td>${esc(x.method.toUpperCase())}</td><td>${esc(x.destination)}</td><td><span class="cd-badge ${x.status === 'paid' ? 'ok' : x.status === 'rejected' ? 'bad' : 'warn'}">${esc(x.status)}</span>${x.reference ? `<div class="cd-muted">Ref: ${esc(x.reference)}</div>` : ''}${x.note ? `<div class="cd-muted">${esc(x.note)}</div>` : ''}</td></tr>`).join('');
    const pd = d.payoutDetails;
    const hasOpen = d.payouts.some(x => x.status === 'requested' || x.status === 'approved');
    const canRequest = pd.configured && pd.method && m.available >= m.minPayout && !hasOpen;

    main.innerHTML = `
      <section class="cd-card cd-head" aria-label="Profile">
        <div class="cd-avatar">${p.avatar ? `<img src="${esc(p.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer-when-downgrade">` : initial}</div>
        <div>
          <h1 class="cd-name">${esc(p.name || p.username)}</h1>
          <div class="cd-muted">@${esc(p.username)} · ${p.followers} followers · ${p.following} following · member since ${when(p.memberSince)}</div>
          ${p.bio ? `<p class="cd-muted">${esc(p.bio)}</p>` : ''}
          <div class="cd-badges">${badges}</div>
        </div>
        <a class="cd-btn ghost" href="/profile/${esc(p.id)}/${esc(p.username)}/">View public profile</a>
      </section>

      <section class="cd-card" aria-label="Earnings">
        <h2><i class="fas fa-wallet"></i> Earnings</h2>
        <div class="cd-kpis">
          <div class="cd-kpi hi"><b>${inr(m.available)}</b><span>Available to withdraw</span></div>
          <div class="cd-kpi"><b>${inr(m.earned)}</b><span>Total earned (${m.sharePercent}% share)</span></div>
          <div class="cd-kpi"><b>${inr(m.pending)}</b><span>Pending payout</span></div>
          <div class="cd-kpi"><b>${inr(m.paid)}</b><span>Paid out</span></div>
          <div class="cd-kpi"><b>${m.sales.count}</b><span>Preset sales · gross ${inr(m.sales.gross)}</span></div>
          <div class="cd-kpi"><b>${m.tips.count}</b><span>Tips · gross ${inr(m.tips.gross)}</span></div>
        </div>
        <h3 style="margin:18px 0 8px;font-size:.95rem">Last 30 days</h3>
        <div class="cd-bars" role="img" aria-label="Earnings by day">${d.series.map(x => `<div title="${esc(x.day)}: ${inr(x.amount)}"><span style="height:${Math.round((x.amount / max) * 100)}%"></span></div>`).join('')}</div>
      </section>

      <div class="cd-two">
        <section class="cd-card" aria-label="Request payout">
          <h2><i class="fas fa-paper-plane"></i> Request payout</h2>
          ${!pd.configured ? '<p class="cd-muted">Payouts are not active yet. Please check back later.</p>' : ''}
          ${pd.configured && !pd.method ? '<p class="cd-muted">Add your UPI or bank details first (below).</p>' : ''}
          ${pd.method ? `<p class="cd-muted">Paid to: <b>${esc(pd.masked)}</b></p>` : ''}
          ${hasOpen ? '<p class="cd-badge warn">You have a payout in progress.</p>' : ''}
          <form class="cd-form" id="cdPayoutForm">
            <label>Amount (₹) <input type="number" name="amount" min="${m.minPayout}" step="1" max="${m.available}" value="${Math.floor(m.available)}" ${canRequest ? '' : 'disabled'}></label>
            <p class="cd-muted">Minimum ₹${m.minPayout}. Available: ${inr(m.available)}.</p>
            <button class="cd-btn" type="submit" ${canRequest ? '' : 'disabled'}>Request payout</button>
          </form>
        </section>

        <section class="cd-card" aria-label="Payout details">
          <h2><i class="fas fa-building-columns"></i> Payout details</h2>
          <div class="cd-seg" role="group" aria-label="Method">
            <button type="button" data-method="upi" aria-pressed="${state.method === 'upi'}">UPI</button>
            <button type="button" data-method="bank" aria-pressed="${state.method === 'bank'}">Bank account</button>
          </div>
          <form class="cd-form" id="cdDetailsForm" style="margin-top:12px">
            <label>Account holder name <input name="accountHolder" maxlength="100" required placeholder="Name as per bank/UPI"></label>
            ${state.method === 'upi'
              ? '<label>UPI ID <input name="upi" maxlength="256" placeholder="name@bank" autocomplete="off"></label>'
              : '<label>Account number <input name="accountNumber" inputmode="numeric" maxlength="24" placeholder="Account number" autocomplete="off"></label><label>IFSC <input name="ifsc" maxlength="11" placeholder="SBIN0001234" autocomplete="off" style="text-transform:uppercase"></label>'}
            <p class="cd-muted">Details are encrypted and only shown to our payout team. Changes are blocked while a payout is in progress.</p>
            <button class="cd-btn" type="submit" ${pd.configured ? '' : 'disabled'}>Save details</button>
          </form>
        </section>
      </div>

      <section class="cd-card" aria-label="Viral posts">
        <h2><i class="fas fa-fire"></i> Viral posts</h2>
        ${viral.length ? `<ul class="cd-list">${viral.join('')}</ul>` : '<div class="cd-empty">Abhi koi viral post nahi. Preset ya shayari share karte rahiye, popular hone par yahan dikhega.</div>'}
      </section>

      <div class="cd-two">
        <section class="cd-card" aria-label="My presets">
          <h2><i class="fas fa-palette"></i> My presets <span class="cd-muted">(${t.presets})</span></h2>
          ${d.presets.length ? `<div style="overflow-x:auto"><table class="cd-table"><thead><tr><th>Name</th><th>Category</th><th>Price</th><th>Downloads</th><th>Views</th><th>Likes</th><th>Status</th></tr></thead><tbody>${presets}</tbody></table></div>` : '<div class="cd-empty">No presets yet. Upload your first preset to start earning.</div>'}
          <p class="cd-muted">Totals: ${t.downloads} downloads · ${t.presetViews} views · ${t.presetLikes} likes</p>
        </section>
        <section class="cd-card" aria-label="My text prompts">
          <h2><i class="fas fa-pen-nib"></i> My shayari &amp; text prompts <span class="cd-muted">(${t.texts})</span></h2>
          ${d.texts.length ? `<ul class="cd-list">${texts}</ul>` : '<div class="cd-empty">No text posts yet. Post shayari from the Shayari page.</div>'}
          <p class="cd-muted">Totals: ${t.copies} copies · ${t.textLikes} likes · ${t.shares} shares · ${t.comments} comments · ${t.textViews} views</p>
        </section>
      </div>

      <section class="cd-card" aria-label="Payout history">
        <h2><i class="fas fa-clock-rotate-left"></i> Payout history</h2>
        ${d.payouts.length ? `<div style="overflow-x:auto"><table class="cd-table"><thead><tr><th>Requested</th><th>Amount</th><th>Method</th><th>To</th><th>Status</th></tr></thead><tbody>${payouts}</tbody></table></div>` : '<div class="cd-empty">No payouts yet.</div>'}
      </section>`;
    bind();
  }

  function bind() {
    document.querySelectorAll('[data-method]').forEach(b => b.addEventListener('click', () => { state.method = b.dataset.method; load(); }));
    const det = $('#cdDetailsForm');
    det?.addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(det);
      const body = { method: state.method, accountHolder: f.get('accountHolder'), upi: f.get('upi'), accountNumber: f.get('accountNumber'), ifsc: f.get('ifsc') };
      try { await api('/creator/payout-details', { method: 'PUT', body: JSON.stringify(body) }); toast('Payout details saved'); load(); }
      catch (err) { toast(err.message, 'err'); }
    });
    const pf = $('#cdPayoutForm');
    pf?.addEventListener('submit', async e => {
      e.preventDefault();
      const amount = Number(new FormData(pf).get('amount'));
      if (!confirm(`Request a payout of ${inr(amount)}? It will be paid after admin review.`)) return;
      try { await api('/creator/payouts', { method: 'POST', body: JSON.stringify({ amount }) }); toast('Payout requested'); load(); }
      catch (err) { toast(err.message, 'err'); }
    });
  }

  async function load() {
    try {
      const d = await api('/creator/dashboard');
      state.data = d; render(d);
    } catch (e) {
      if (e.status === 401) return loginNeeded();
      main.innerHTML = `<div class="cd-card"><h2>Could not load the dashboard</h2><p class="cd-muted">${esc(e.message)}</p><button class="cd-btn" onclick="location.reload()">Try again</button></div>`;
    }
  }
  load();
})();
