(() => {
  'use strict';
  const API = location.origin + '/api';
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let token = '';
  let busy = false;

  function csrfToken() {
    const match = document.cookie.match(/(?:^|; )ph_csrf=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }
  function authHeaders(opts = {}) {
    const h = new Headers(opts.headers || {});
    if (token) h.set('Authorization', `Bearer ${token}`);
    const method = String(opts.method || 'GET').toUpperCase();
    if (!['GET','HEAD','OPTIONS'].includes(method)) {
      const csrf = csrfToken();
      if (csrf) h.set('X-CSRF-Token', csrf);
    }
    if (opts.body && !(opts.body instanceof FormData) && !h.has('Content-Type')) h.set('Content-Type', 'application/json');
    return h;
  }
  async function api(path, opts = {}) {
    const r = await fetch(API + path, { ...opts, headers: authHeaders(opts), credentials: 'same-origin' });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) {
      token = '';
      throw new Error(r.status === 403 ? 'Admin access required' : 'Admin login required');
    }
    if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
    return d;
  }
  function msg(text, type = 'success') {
    const box = $('#message');
    if (!box) return;
    box.innerHTML = `<i class="fas ${type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check'}"></i><span>${esc(text)}</span><button type="button" aria-label="Close">×</button>`;
    box.className = `admin-message ${type}`;
    box.querySelector('button')?.addEventListener('click', () => { box.className = ''; });
    clearTimeout(msg.timer); msg.timer = setTimeout(() => { box.className = ''; }, 5000);
  }
  function setLoading(on) { busy = on; $('#refreshAdmin')?.toggleAttribute('disabled', on); }

  async function load() {
    if (busy) return;
    setLoading(true);
    try {
      const [a, p, u, s] = await Promise.all([
        api('/admin/analytics'), api('/admin/presets?limit=50'), api('/admin/users?limit=50'), api('/admin/stats')
      ]);
      const stats = {...a, ...s};
      $('#analytics').innerHTML = Object.entries(stats).filter(([k]) => !['success'].includes(k)).map(([k,v]) => `<div class="stat-item"><div class="num">${esc(v)}</div><div class="label">${esc(k)}</div></div>`).join('');
      const presets = p.items || [];
      $('#presetsList').innerHTML = presets.map(x => `<div class="preset-item"><div class="preset-main"><b>${esc(x.name)}</b><span class="status-badge status-${esc(x.status||'pending')}">${esc(x.status||'pending')}</span><br><small>${esc(x.author||'')} · ${x.downloads||0} downloads · ${x.views||0} views · ₹${Number(x.price||0).toFixed(2)}</small></div><div class="actions">${['approved','pending','rejected'].map(st => `<button class="btn btn-sm ${st==='rejected'?'btn-danger':'btn-outline'}" data-preset="${esc(x.id)}" data-status="${st}" ${x.status===st?'disabled':''}>${st}</button>`).join('')}</div></div>`).join('') || '<p>No presets.</p>';
      const users = u.items || [];
      $('#usersList').innerHTML = `<table class="user-table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Stats</th><th>Action</th></tr></thead><tbody>${users.map(x => `<tr><td><b>${esc(x.name||x.username||'')}</b><br><small>@${esc(x.username||'user')} · ${esc(x.email||'')}</small></td><td>${esc(x.role||'user')}</td><td><span class="status-badge status-${esc(x.status||'active')}">${esc(x.status||'active')}</span></td><td>${x.stats?.totalPresets||0} presets · ${x.stats?.userDownloads||0} downloads</td><td><button class="btn btn-sm btn-outline" data-user-details="${esc(x.id)}">Details</button>${x.role!=='admin'?`<button class="btn btn-danger btn-sm" data-user="${esc(x.id)}">Delete</button>`:''}</td></tr>`).join('')}</tbody></table>`;
      msg('Admin data refreshed');
    } catch (e) {
      msg(e.message, 'error');
      if (/Admin login|required|access required/i.test(e.message)) setTimeout(() => location.href = '/', 900);
    } finally { setLoading(false); }
  }

  document.addEventListener('click', async e => {
    if (e.target.closest('#refreshAdmin')) return load();
    if (e.target.closest('#themeAdmin')) {
      document.body.classList.toggle('dark');
      localStorage.setItem('presethub_theme', document.body.classList.contains('dark') ? 'dark' : 'light');
      const i = e.target.closest('#themeAdmin').querySelector('i'); if (i) i.className = document.body.classList.contains('dark') ? 'fas fa-sun' : 'fas fa-moon';
      return;
    }
    if (e.target.closest('#adminHome')) return location.href = '/';
    const p = e.target.closest('[data-preset]');
    const u = e.target.closest('[data-user]');
    const d = e.target.closest('[data-user-details]');
    try {
      if (p) { await api(`/admin/presets/${p.dataset.preset}/status`, {method:'PUT', body:JSON.stringify({status:p.dataset.status})}); msg('Preset status updated'); return load(); }
      if (d) { const r=await api(`/admin/users/${d.dataset.userDetails}/details`); const u=r.user||r; alert(`User: ${u.name||''}\nEmail: ${u.email||''}\nRole: ${u.role||''}\nStatus: ${u.status||''}\nPresets: ${u.stats?.totalPresets??u.totalPresets??0}\nDownloads: ${u.stats?.userDownloads??u.totalDownloads??0}`); return; }
      if (u && confirm('Delete this user permanently? This cannot be undone.')) { await api(`/admin/users/${u.dataset.user}`,{method:'DELETE'}); msg('User deleted'); return load(); }
    } catch (err) { msg(err.message, 'error'); }
  });

  document.body.classList.toggle('dark', localStorage.getItem('presethub_theme') === 'dark');
  const themeIcon = $('#themeAdmin i'); if (themeIcon) themeIcon.className = document.body.classList.contains('dark') ? 'fas fa-sun' : 'fas fa-moon';
  load();
})();
