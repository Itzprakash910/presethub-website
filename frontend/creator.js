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
  const PRO_THEME_COLORS = { gold: '#d4a373', rose: '#e88da0', ocean: '#4ca1af', emerald: '#2fa37a', classic: '#5b5b5b' };

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
    if (!r.ok) { const e = new Error(d.error || `Request failed (${r.status})`); e.status = r.status; e.code = d.code || ''; throw e; }
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


      <section class="cd-card" aria-label="Boost">
        <h2><i class="fas fa-bolt"></i> Boost your content</h2>
        <p class="cd-muted">Boosted items appear first on the site until the boost ends. Payment is secure via Cashfree.</p>
        <form class="cd-form" id="cdBoostForm">
          <label>What to boost
            <select name="targetType">
              <option value="profile">My profile (top of Creators)</option>
              ${d.presets.length ? '<option value="preset">A preset</option>' : ''}
              ${d.texts.length ? '<option value="text">A shayari / text prompt</option>' : ''}
            </select></label>
          ${d.presets.length ? `<label>Preset <select name="presetId">${d.presets.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></label>` : ''}
          ${d.texts.length ? `<label>Text prompt <select name="textId">${d.texts.map(x => `<option value="${esc(x.id)}">${esc(x.title || x.text.slice(0, 50))}</option>`).join('')}</select></label>` : ''}
          <label>Duration
            <select name="days"><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></label>
          <div id="cdBoostPhone"></div>
          <div class="cd-muted" id="cdBoostPrice">Choose an option to see the price.</div>
          <button class="cd-btn" type="submit">Continue to payment</button>
        </form>
      </section>

      <section class="cd-card" aria-label="Pro theme">
        <h2><i class="fas fa-palette"></i> Pro colour theme</h2>
        ${p.isPro ? `<p class="cd-muted">Choose the accent colour for the site when you are signed in.</p>
          <div class="cd-seg" role="group" aria-label="Theme colour">${Object.keys(PRO_THEME_COLORS).map(k => `<button type="button" data-theme="${k}" aria-pressed="${d.profile.theme === k}" style="background:${PRO_THEME_COLORS[k]};color:#1c1c1c;border:0;min-width:44px" title="${k}">${k[0].toUpperCase()}</button>`).join('')}</div>`
          : '<p class="cd-muted">Pro members can choose a colour theme. <a href="/?action=pro">Go Pro</a></p>'}
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
    document.querySelectorAll('[data-theme]').forEach(b => b.addEventListener('click', async () => {
      try { await api('/creator/theme', { method: 'PUT', body: JSON.stringify({ theme: b.dataset.theme }) }); applyTheme(b.dataset.theme); toast('Theme saved'); load(); }
      catch (err) { toast(err.message, 'err'); }
    }));
    const bf = $('#cdBoostForm');
    const priceEl = $('#cdBoostPrice');
    const priceOf = (type, days) => ({ profile: { 7: 99, 14: 179, 30: 299 }, preset: { 7: 49, 14: 89, 30: 149 }, text: { 7: 29, 14: 49, 30: 89 } })[type]?.[days];
    const refresh = () => {
      const f = new FormData(bf); const type = f.get('targetType'); const days = Number(f.get('days'));
      const pr = priceOf(type, days);
      priceEl.textContent = pr ? `Price: ₹${pr} for ${days} days` : 'Choose an option to see the price.';
      document.querySelectorAll('[name=presetId]').forEach(sel => sel.closest('label').style.display = type === 'preset' ? '' : 'none');
      document.querySelectorAll('[name=textId]').forEach(sel => sel.closest('label').style.display = type === 'text' ? '' : 'none');
    };
    bf?.addEventListener('change', refresh); refresh();
    bf?.addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(bf); const type = f.get('targetType'); const days = Number(f.get('days'));
      const targetId = type === 'preset' ? f.get('presetId') : type === 'text' ? f.get('textId') : state.data.profile.id;
      const phoneInput = bf.querySelector('[name=customerPhone]');
      const body = { targetType: type, targetId, days, customerPhone: phoneInput ? String(phoneInput.value || '').replace(/\D/g, '').slice(-10) : undefined };
      try {
        const order = await api('/payments/cashfree/boost', { method: 'POST', body: JSON.stringify(body) });
        await openCashfree(order);
      } catch (err) {
        if (err.code === 'PHONE_REQUIRED' && !phoneInput) {
          $('#cdBoostPhone').innerHTML = '<label>Mobile number (10 digits) <input name="customerPhone" inputmode="numeric" maxlength="12" required></label>';
          toast('Enter your mobile number to continue', 'err');
        } else toast(err.message, 'err');
      }
    });
    document.querySelectorAll('[data-method]').forEach(b => b.addEventListener('click', () => { state.method = b.dataset.method; load(); }));
    const det = $('#cdDetailsForm');
    det?.addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(det);
      const body = { method: state.method, accountHolder: String(f.get('accountHolder') || '').trim(), upi: String(f.get('upi') || '').trim(), accountNumber: String(f.get('accountNumber') || '').trim(), ifsc: String(f.get('ifsc') || '').trim() };
      if (!body.accountHolder) return toast('Enter the account holder name', 'err');
      if (state.method === 'upi' && !body.upi) return toast('Enter your UPI ID', 'err');
      if (state.method === 'bank' && (!body.accountNumber || !body.ifsc)) return toast('Enter account number and IFSC', 'err');
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

  // Loads Cashfree's checkout script only when a payment starts.
  let cfPromise = null;
  function loadCashfree() {
    if (window.Cashfree) return Promise.resolve(window.Cashfree);
    if (!cfPromise) cfPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = 'https://sdk.cashfree.com/js/v3/cashfree.js'; s.async = true;
      s.onload = () => (window.Cashfree ? resolve(window.Cashfree) : reject(new Error('Checkout did not load.')));
      s.onerror = () => { cfPromise = null; reject(new Error('Could not load secure checkout.')); };
      document.head.appendChild(s);
    });
    return cfPromise;
  }
  async function openCashfree(order) {
    if (!order.paymentSessionId) throw new Error('Payment session was not created. Please try again.');
    const Factory = await loadCashfree();
    const cf = Factory({ mode: order.mode === 'production' ? 'production' : 'sandbox' });
    toast('Opening secure checkout…');
    await cf.checkout({ paymentSessionId: order.paymentSessionId, redirectTarget: '_self' });
  }
  // Pro theme: colours the accent on this page too.
  function applyTheme(key) {
    const c = PRO_THEME_COLORS[key]; if (!c) return;
    document.documentElement.style.setProperty('--accent', c);
    document.documentElement.style.setProperty('--accent-text', c);
  }

  async function load() {
    try {
      const d = await api('/creator/dashboard');
      // Start on the method the creator already saved (UPI is only the default for new users).
      if (!state.methodInitialised) { if (d.payoutDetails?.method) state.method = d.payoutDetails.method; state.methodInitialised = true; }
      applyTheme(d.profile.theme || 'gold');
      state.data = d; render(d);
    } catch (e) {
      if (e.status === 401) return loginNeeded();
      main.innerHTML = `<div class="cd-card"><h2>Could not load the dashboard</h2><p class="cd-muted">${esc(e.message)}</p><button class="cd-btn" onclick="location.reload()">Try again</button></div>`;
    }
  }
  load();
})();
