(function () {
  'use strict';
  const API = '/api';
  const token = localStorage.getItem('token');
  if (!token) { location.replace('/'); return; }

  // Escape EVERYTHING that comes from the server – names/emails are user-controlled (stored XSS)
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = id => document.getElementById(id);

  async function api(path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(opts.headers || {}) }
    });
    if (res.status === 401) { localStorage.removeItem('token'); location.replace('/'); throw new Error('Session expired'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  let timer;
  function msg(text, type = 'success') {
    const el = $('message');
    el.textContent = text; el.className = type;
    clearTimeout(timer); timer = setTimeout(() => { el.className = ''; }, 4000);
  }

  async function loadAnalytics() {
    const d = await api('/admin/analytics');
    const item = (n, l) => `<div class="stat-item"><div class="num">${esc(n)}</div><div class="label">${l}</div></div>`;
    $('analytics').innerHTML =
      item(d.totalUsers, 'कुल उपयोगकर्ता') + item(d.totalPresets, 'कुल प्रीसेट') +
      item(d.pendingPresets, 'अनुमोदन बाकी') + item(d.totalDownloads, 'कुल डाउनलोड') +
      item('₹' + d.totalRevenue, 'कुल राजस्व');
  }

  async function loadUsers() {
    const users = await api('/admin/users');
    if (!users.length) { $('usersList').innerHTML = '<p>कोई उपयोगकर्ता नहीं।</p>'; return; }
    $('usersList').innerHTML = `<table class="user-table"><thead><tr>
      <th>नाम</th><th>ईमेल</th><th>भूमिका</th><th>सत्यापित</th></tr></thead><tbody>` +
      users.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td>
        <td>${u.verified ? '✅' : '❌'}</td></tr>`).join('') + '</tbody></table>';
  }

  async function loadPresets() {
    const presets = await api('/admin/presets');
    if (!presets.length) { $('presetsList').innerHTML = '<p>कोई प्रीसेट नहीं।</p>'; return; }
    presets.sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0));  // pending first
    const okStatus = s => ['approved', 'rejected', 'pending'].includes(s) ? s : 'pending';
    $('presetsList').innerHTML = '<div class="preset-list">' + presets.map(p => `
      <div class="preset-item">
        <div><strong>${esc(p.name)}</strong> – ${esc(p.author)} (${esc(p.category)}) · ₹${esc(p.price)}
          <span class="status-badge status-${okStatus(p.status)}">${okStatus(p.status)}</span></div>
        <div class="actions">
          <button class="btn btn-sm btn-primary" data-id="${esc(p.id)}" data-status="approved">✅ Approve</button>
          <button class="btn btn-sm btn-danger" data-id="${esc(p.id)}" data-status="rejected">❌ Reject</button>
        </div>
      </div>`).join('') + '</div>';
  }

  // Event delegation instead of inline onclick (works with strict CSP, no injection via ids)
  $('presetsList').addEventListener('click', async e => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    btn.disabled = true;
    try {
      await api(`/admin/presets/${encodeURIComponent(btn.dataset.id)}/status`, {
        method: 'PUT', body: JSON.stringify({ status: btn.dataset.status })
      });
      msg(`प्रीसेट ${btn.dataset.status} कर दिया गया।`);
      await Promise.all([loadPresets(), loadAnalytics()]);
    } catch (err) { msg('Status update विफल: ' + err.message, 'error'); btn.disabled = false; }
  });

  (async function init() {
    try {
      const me = await api('/users/me');
      if (me.role !== 'admin') { alert('केवल Admin के लिए।'); location.replace('/'); return; }
    } catch { return; }
    for (const [fn, label] of [[loadAnalytics, 'Analytics'], [loadPresets, 'Presets'], [loadUsers, 'Users']]) {
      fn().catch(err => msg(`${label} लोड नहीं हुए: ${err.message}`, 'error'));
    }
  })();
})();
