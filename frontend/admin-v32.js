/* PresetHub admin — v3.4 panels (reports added): Overview, Alerts, System, Subscriptions, Shayari moderation. */
(() => {
  'use strict';
  const API = location.origin + '/api/admin';
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Number(n || 0).toLocaleString('en-IN');
  const when = d => d ? new Date(d).toLocaleString('en-IN') : '—';
  const csrf = () => { const m = document.cookie.match(/(?:^|; )ph_csrf=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; };
  async function api(path, opts = {}) {
    const method = String(opts.method || 'GET').toUpperCase();
    const headers = new Headers(opts.headers || {});
    if (method !== 'GET') { const c = csrf(); if (c) headers.set('X-CSRF-Token', c); }
    if (opts.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const r = await fetch(API + path, { ...opts, headers, credentials: 'same-origin' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
    return d;
  }
  function note(text, type = 'success') {
    const box = $('#message'); if (!box) return;
    box.innerHTML = `<i class="fas ${type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check'}"></i><span>${esc(text)}</span><button type="button" aria-label="Close">×</button>`;
    box.className = `admin-message ${type}`;
    box.querySelector('button').onclick = () => { box.className = ''; };
    clearTimeout(note.t); note.t = setTimeout(() => { box.className = ''; }, 5000);
  }
  const sevIcon = s => s === 'critical' ? '🚨' : s === 'warning' ? '⚠️' : 'ℹ️';
  const bar = pct => `<div class="v32-bar"><span style="width:${Math.min(100, Number(pct) || 0)}%" class="${pct >= 85 ? 'hot' : pct >= 70 ? 'warm' : ''}"></span></div>`;

  // ---------- OVERVIEW + SYSTEM ----------
  async function loadOverview() {
    const [o, s] = await Promise.all([api('/overview'), api('/system')]);
    const cards = [
      ['Users', o.users], ['Online now', o.online], ['New today', o.usersToday], ['Presets', o.presets],
      ['Text posts', o.texts], ['New texts today', o.textsToday], ['Pro members', o.proUsers], ['Downloads', o.downloads],
      ['Open support', o.openSupport], ['Pending payments', o.pendingOrders], ['Suspicious orders', o.suspiciousOrders],
      ['Revenue (₹)', Number(o.revenue?.total || 0).toFixed(0)]
    ];
    $('#v32Overview').innerHTML = cards.map(([k, v]) => `<div class="stat-item"><div class="num">${esc(typeof v === 'number' ? fmt(v) : v)}</div><div class="label">${esc(k)}</div></div>`).join('');
    const db = s.database;
    $('#v32System').innerHTML = `
      <div class="v32-kv">
        <div><b>Database</b><span>${db ? `${db.usedMB} MB of ${db.limitMB} MB (${db.usedPercent}%)` : 'not connected'}</span>${db ? bar(db.usedPercent) : ''}</div>
        <div><b>Media (GridFS)</b><span>${db ? `${fmt(db.mediaFiles)} files · ${db.mediaMB} MB` : '—'}</span></div>
        <div><b>Server</b><span>Uptime ${s.uptimeMinutes} min · RAM ${s.memoryMB?.rss} MB · ${esc(s.node)} · ${esc(s.env)}</span></div>
        <div><b>Telegram bot</b><span>${s.bot?.configured ? (s.bot.started ? '✅ running' : '⚠️ configured, not started') : '❌ not configured'}</span></div>
        <div><b>Services</b><span>${Object.entries(s.services || {}).map(([k, v]) => `<em class="svc ${v ? 'on' : 'off'}">${esc(k)} ${v ? '✓' : '✗'}</em>`).join(' ')}</span></div>
        <div><b>Viral score</b><span>${fmt(s.viralScore)}</span></div>
      </div>`;
    const sig = o.signupSeries || [];
    const max = Math.max(1, ...sig.map(x => x.users));
    $('#v32Signups').innerHTML = `<div class="v32-chart">${sig.map(x => `<div title="${esc(x.date)}: ${x.users}"><span style="height:${Math.round((x.users / max) * 100)}%"></span><small>${esc(x.date.slice(5))}</small></div>`).join('')}</div>`;
    $('#v32Recent').innerHTML = (o.recentUsers || []).map(u => `<li><b>${esc(u.name || u.username)}</b> <small>${esc(u.email)} · ${when(u.createdAt)}</small></li>`).join('') || '<li>No users yet.</li>';
    const badge = $('#alertBadge');
    if (badge) { badge.textContent = o.unreadAlerts || ''; badge.classList.toggle('hidden', !o.unreadAlerts); badge.classList.toggle('crit', !!o.criticalAlerts); }
    return o;
  }

  // ---------- ALERTS ----------
  async function loadAlerts() {
    const type = $('#alertType').value, severity = $('#alertSeverity').value, unread = $('#alertUnread').checked ? '1' : '';
    const q = [type && `type=${type}`, severity && `severity=${severity}`, unread && `unread=${unread}`, 'limit=40'].filter(Boolean).join('&');
    const d = await api(`/alerts?${q}`);
    $('#alertList').innerHTML = (d.items || []).map(a => `
      <article class="v32-alert sev-${esc(a.severity)} ${a.read ? 'read' : ''}">
        <div class="v32-alert-main">
          <div><span class="v32-type">${esc(a.type)}</span> ${sevIcon(a.severity)} <b>${esc(a.title)}</b>${a.count > 1 ? ` <em class="v32-count">×${a.count}</em>` : ''}</div>
          <small>${when(a.lastAt)}</small>
          <details><summary>Details</summary><pre>${esc(JSON.stringify(a.details || {}, null, 2))}</pre></details>
        </div>
        <div class="actions">
          ${a.read ? '' : `<button class="btn btn-sm btn-outline" data-alert-read="${esc(a.id)}">Mark read</button>`}
          <button class="btn btn-sm btn-danger" data-alert-del="${esc(a.id)}">Delete</button>
        </div>
      </article>`).join('') || '<p class="admin-note">कोई alert नहीं। सब ठीक है ✅</p>';
    $('#alertCount').textContent = `${fmt(d.total)} total · page ${d.page}/${d.pages}`;
  }

  // ---------- SUBSCRIPTIONS ----------
  async function loadSubscriptions() {
    const d = await api('/subscriptions');
    $('#subPlans').innerHTML = (d.plans || []).map(p => `<div class="v32-plan"><b>${esc(p.label)}</b><span>₹${Number(p.price).toFixed(0)}</span><small>${p.days} days ${p.badge ? '· ' + esc(p.badge) : ''}</small></div>`).join('');
    $('#subUsers').innerHTML = (d.users || []).map(u => `
      <tr><td>${esc(u.name || u.username)}<br><small>${esc(u.email)}</small></td><td>${esc(u.plan)}</td>
      <td>${when(u.expiry)}</td><td><span class="status-badge ${u.active ? 'status-approved' : 'status-rejected'}">${u.active ? 'Active' : 'Expired'}</span></td>
      <td class="v32-grant"><input type="number" step="1" value="30" aria-label="Days"><button class="btn btn-sm btn-outline" data-pro-grant="${esc(u.id)}">Add days</button><button class="btn btn-sm btn-danger" data-pro-revoke="${esc(u.id)}">Revoke</button></td></tr>`).join('') || '<tr><td colspan="5">No subscribers yet.</td></tr>';
    $('#subOrders').innerHTML = (d.orders || []).map(o => `
      <tr><td>${esc(o.user)}</td><td>${esc(o.plan || '—')}</td><td>₹${Number(o.amount).toFixed(2)}</td>
      <td><span class="status-badge status-${esc(o.status)}">${esc(o.status)}</span></td><td>${when(o.createdAt)}</td></tr>`).join('') || '<tr><td colspan="5">No subscription orders.</td></tr>';
  }

  // ---------- SHAYARI MODERATION ----------
  async function loadTexts() {
    const q = $('#txtSearch').value.trim(), status = $('#txtStatus').value;
    const d = await api(`/texts?limit=30${q ? '&q=' + encodeURIComponent(q) : ''}${status ? '&status=' + status : ''}`);
    $('#txtList').innerHTML = (d.items || []).map(t => `
      <article class="v32-text">
        <div><span class="v32-type">${esc(t.category)}</span> <small>by ${esc(t.author)} · ${when(t.createdAt)}</small>
        <p>${esc(t.text)}</p>
        <small>❤️ ${t.likes} · 📋 ${t.copies} · ↗️ ${t.shares} · 💬 ${t.comments} · 👁 ${t.views}</small></div>
        <div class="actions">
          <button class="btn btn-sm ${t.status === 'approved' ? 'btn-outline' : 'btn-primary'}" data-txt-status="${esc(t.id)}" data-next="${t.status === 'approved' ? 'rejected' : 'approved'}">${t.status === 'approved' ? 'Hide' : 'Approve'}</button>
          <button class="btn btn-sm btn-danger" data-txt-del="${esc(t.id)}">Delete</button>
        </div>
      </article>`).join('') || '<p class="admin-note">No text posts.</p>';
  }

  // ---------- REPORTS ----------
  const REASON = { spam: 'Spam', copyright: 'Copyright', abuse: 'Abuse', hate: 'Hate', adult: 'Adult', scam: 'Scam', other: 'Other' };
  async function loadReports() {
    const st = $('#repStatus').value, tp = $('#repType').value;
    const d = await api(`/reports?status=${st}${tp ? '&targetType=' + tp : ''}&limit=30`);
    $('#repCount').textContent = `${fmt(d.total)} ${st} report(s)`;
    $('#repList').innerHTML = (d.items || []).map(r => `
      <article class="v32-text">
        <div><span class="v32-type">${esc(r.targetType)}</span> <b>${esc(REASON[r.reason] || r.reason)}</b> <small>by ${esc(r.reporter)} · ${when(r.createdAt)}</small>
        <p>${esc(r.preview)}</p>${r.details ? `<small>“${esc(r.details)}”</small>` : ''}</div>
        <div class="actions">
          ${r.status === 'open' ? `<button class="btn btn-sm btn-danger" data-rep="hide" data-id="${esc(r.id)}">Hide content</button>
          <button class="btn btn-sm btn-outline" data-rep="dismiss" data-id="${esc(r.id)}">Dismiss</button>
          <button class="btn btn-sm btn-outline" data-rep="resolve" data-id="${esc(r.id)}">Resolve</button>` : `<button class="btn btn-sm btn-outline" data-rep="restore" data-id="${esc(r.id)}">Restore content</button>`}
        </div>
      </article>`).join('') || '<p class="admin-note">Nothing to review ✅</p>';
  }

  // ---------- actions ----------
  document.addEventListener('click', async e => {
    const t = e.target.closest('button'); if (!t) return;
    try {
      if (t.dataset.alertRead) { await api(`/alerts/${t.dataset.alertRead}/read`, { method: 'PUT', body: '{}' }); await loadAlerts(); await loadOverview(); }
      else if (t.dataset.alertDel) { if (!confirm('Delete this alert?')) return; await api(`/alerts/${t.dataset.alertDel}`, { method: 'DELETE' }); await loadAlerts(); }
      else if (t.id === 'alertReadAll') { await api('/alerts/read-all', { method: 'POST', body: '{}' }); note('All alerts marked read'); await loadAlerts(); await loadOverview(); }
      else if (t.id === 'alertTest') { await api('/alerts/test', { method: 'POST', body: '{}' }); note('Test alert sent (check Telegram / e-mail / panel)'); setTimeout(loadAlerts, 1500); }
      else if (t.dataset.proGrant || t.dataset.proRevoke) {
        const id = t.dataset.proGrant || t.dataset.proRevoke;
        const days = t.dataset.proRevoke ? -3650 : Number(t.closest('.v32-grant').querySelector('input').value);
        if (!Number.isFinite(days) || days === 0) return note('Enter days (not 0)', 'error');
        if (t.dataset.proRevoke && !confirm('Remove all Pro time for this user?')) return;
        await api(`/users/${id}/pro`, { method: 'POST', body: JSON.stringify({ days }) });
        note(t.dataset.proRevoke ? 'Pro removed' : `Added ${days} day(s) of Pro`); await loadSubscriptions();
      }
      else if (t.dataset.rep) {
        if (t.dataset.rep === 'hide' && !confirm('Hide this content from the public site?')) return;
        await api(`/reports/${t.dataset.id}`, { method: 'PUT', body: JSON.stringify({ action: t.dataset.rep }) });
        note(t.dataset.rep === 'hide' ? 'Content hidden' : 'Report updated'); await loadReports();
      }
      else if (t.dataset.txtStatus) { await api(`/texts/${t.dataset.txtStatus}/status`, { method: 'PUT', body: JSON.stringify({ status: t.dataset.next }) }); note('Updated'); await loadTexts(); }
      else if (t.dataset.txtDel) { if (!confirm('Delete this text post permanently?')) return; await api(`/texts/${t.dataset.txtDel}`, { method: 'DELETE' }); note('Deleted'); await loadTexts(); }
      else if (t.id === 'v32Refresh') { await refreshAll(); }
    } catch (err) { note(err.message, 'error'); }
  });
  ['#repStatus', '#repType'].forEach(sel => document.addEventListener('change', e => { if (e.target.matches(sel)) loadReports().catch(err => note(err.message, 'error')); }));
  ['#alertType', '#alertSeverity', '#alertUnread'].forEach(sel => document.addEventListener('change', e => { if (e.target.matches(sel)) loadAlerts().catch(err => note(err.message, 'error')); }));
  document.addEventListener('change', e => { if (e.target.matches('#txtStatus')) loadTexts().catch(err => note(err.message, 'error')); });
  document.addEventListener('input', e => { if (e.target.matches('#txtSearch')) { clearTimeout(loadTexts.t); loadTexts.t = setTimeout(() => loadTexts().catch(() => {}), 350); } });

  async function refreshAll() {
    await Promise.allSettled([loadOverview(), loadAlerts(), loadSubscriptions(), loadTexts(), loadReports()]);
  }
  function boot() {
    if (!$('#v32Overview')) return;
    refreshAll();
    setInterval(() => { loadOverview().catch(() => {}); if (document.visibilityState === 'visible') loadAlerts().catch(() => {}); }, 60000);
    $('#refreshAdmin')?.addEventListener('click', () => setTimeout(refreshAll, 200));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
