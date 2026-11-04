/* PresetHub consent manager v2 (granular, withdrawable, recorded).
   Purposes: analytics (Google Analytics 4), ads (Google AdSense), marketing (Meta Pixel). Everything is OFF until the visitor chooses.
   The choice is kept on this device and a record (random visitor id, choice, version, page, time; no IP address) is sent to /api/legal/consent. */
(() => {
  'use strict';
  const KEY = 'presethub_cookie_consent_v2';
  const LEGACY_KEY = 'presethub_cookie_consent_v1';
  const VISITOR_KEY = 'presethub_visitor_id';
  const VERSION = '2026-11-03';
  const ADSENSE_CLIENT = 'ca-pub-3554311294133493';
  const PURPOSES = ['analytics', 'ads', 'marketing'];

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  };
  function parse(raw) {
    try { const o = JSON.parse(raw); return o && o.v === 2 ? o : null; } catch (_) { return null; }
  }
  // Older single-choice value: "accepted" covered all optional tools, "rejected" none.
  function migrateLegacy() {
    const old = store.get(LEGACY_KEY);
    if (old !== 'accepted' && old !== 'rejected') return null;
    const on = old === 'accepted';
    const s = { v: 2, analytics: on, ads: on, marketing: on, at: new Date().toISOString(), version: VERSION, migrated: true };
    store.set(KEY, JSON.stringify(s));
    return s;
  }
  let state = parse(store.get(KEY)) || migrateLegacy();

  const api = {
    get: () => (state ? { ...state } : null),
    has: purpose => !!(state && state[purpose]),
    open: () => showBanner(true)
  };
  window.PresetHubConsent = api;

  // Pro members never load ads (flag is written by app.js after a verified subscription).
  const isPro = () => { try { return Number(localStorage.getItem('ph_pro_until') || 0) > Date.now(); } catch (_) { return false; } };
  function loadAds() {
    if (!api.has('ads') || isPro() || window.__presetHubAdsLoaded || !ADSENSE_CLIENT) return;
    window.__presetHubAdsLoaded = true;
    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADSENSE_CLIENT)}`;
    script.onload = () => { window.dispatchEvent(new CustomEvent('presethub:ads-ready')); };
    script.onerror = () => { window.__presetHubAdsLoaded = false; };
    document.head.appendChild(script);
  }

  function visitorId() {
    let id = store.get(VISITOR_KEY);
    if (!/^[a-f0-9]{32}$/.test(id || '')) {
      const b = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(b);
      id = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
      store.set(VISITOR_KEY, id);
    }
    return id;
  }
  function record(s, withdrawn) {
    try {
      const m = document.cookie.match(/(?:^|; )ph_csrf=([^;]+)/);
      const headers = { 'Content-Type': 'application/json' };
      if (m) headers['X-CSRF-Token'] = decodeURIComponent(m[1]);
      fetch('/api/legal/consent', {
        method: 'POST', credentials: 'same-origin', headers, keepalive: true,
        body: JSON.stringify({ visitorId: visitorId(), choice: withdrawn ? 'withdrawn' : '', purposes: { analytics: s.analytics, ads: s.ads, marketing: s.marketing }, page: location.pathname })
      }).catch(() => {});
    } catch (_) {}
  }
  // Best effort: remove cookies set by the optional tools when a purpose is switched off.
  function clearThirdPartyCookies() {
    const names = (document.cookie.match(/(?:^|; )(_ga[^=]*|_gid|_gat[^=]*|_fbp|_fbc|__gads|__gpi|_gcl[^=]*)=/g) || []).map(x => x.replace(/^; /, '').replace(/=$/, ''));
    const parts = location.hostname.split('.');
    const domains = ['', location.hostname];
    for (let i = 1; i < parts.length - 1; i++) domains.push('.' + parts.slice(i).join('.'));
    names.forEach(n => domains.forEach(d => { document.cookie = `${n}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d ? '; domain=' + d : ''}`; }));
  }

  function save(choices) {
    const prev = state;
    const withdrawn = !!prev && PURPOSES.some(k => prev[k] && !choices[k]) && PURPOSES.every(k => !choices[k]);
    state = { v: 2, analytics: !!choices.analytics, ads: !!choices.ads, marketing: !!choices.marketing, at: new Date().toISOString(), version: VERSION };
    store.set(KEY, JSON.stringify(state));
    record(state, withdrawn);
    try { window.dispatchEvent(new CustomEvent('presethub:consent', { detail: { ...state } })); } catch (_) {}
    removeBanner();
    loadAds();
    // Scripts that were already running cannot be unloaded: clear their cookies and reload without them.
    if (prev && PURPOSES.some(k => prev[k] && !state[k])) { clearThirdPartyCookies(); location.reload(); }
  }

  function removeBanner() { const el = document.querySelector('#cookieConsent'); if (el) el.remove(); }
  const ROW = (key, title, text) => `
    <label class="cookie-choice"><input type="checkbox" data-purpose="${key}"><span><strong>${title}</strong><small>${text}</small></span></label>`;
  function showBanner(reopen) {
    removeBanner();
    const banner = document.createElement('section');
    banner.id = 'cookieConsent';
    banner.className = 'cookie-consent';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-live', 'polite');
    banner.setAttribute('aria-labelledby', 'cookieConsentTitle');
    banner.innerHTML = `
      <div class="cookie-consent-copy">
        <strong id="cookieConsentTitle">Privacy &amp; cookies</strong>
        <p>PresetHub uses essential storage to keep you signed in and remember preferences. Optional tools run <b>only if you allow them</b>. You can change your choice at any time from “Cookie settings” in the footer.</p>
        <a href="/privacy.html">Privacy Policy</a> · <a href="/cookies.html">Cookie Policy</a>
        <div class="cookie-choices" hidden>
          ${ROW('analytics', 'Analytics', 'Google Analytics 4 measures visits and which pages are used.')}
          ${ROW('ads', 'Advertising', 'Google AdSense shows ads. Pro members never see ads.')}
          ${ROW('marketing', 'Marketing', 'Meta Pixel measures the results of our ads.')}
        </div>
      </div>
      <div class="cookie-consent-actions">
        <button type="button" class="btn btn-primary" data-cookie="reject">Reject optional</button>
        <button type="button" class="btn btn-secondary" data-cookie="customize">Customize</button>
        <button type="button" class="btn btn-primary" data-cookie="accept">Allow all</button>
        ${reopen && state ? '<button type="button" class="btn btn-secondary cookie-close" data-cookie="close">Close</button>' : ''}
      </div>`;
    const panel = banner.querySelector('.cookie-choices');
    PURPOSES.forEach(k => { const i = banner.querySelector(`[data-purpose="${k}"]`); if (i) i.checked = !!(state && state[k]); });
    banner.addEventListener('click', e => {
      const action = e.target.closest('[data-cookie]')?.dataset.cookie;
      if (!action) return;
      if (action === 'reject') return save({});
      if (action === 'accept') return save({ analytics: true, ads: true, marketing: true });
      if (action === 'close') return removeBanner();
      if (action === 'customize') {
        const open = panel.hidden;
        panel.hidden = !open;
        const btn = banner.querySelector('[data-cookie="customize"]');
        btn.textContent = open ? 'Save choices' : 'Customize';
        btn.dataset.cookie = open ? 'save' : 'customize';
        return;
      }
      if (action === 'save') {
        const choices = {};
        PURPOSES.forEach(k => { choices[k] = !!banner.querySelector(`[data-purpose="${k}"]`)?.checked; });
        save(choices);
      }
    });
    document.body.appendChild(banner);
    if (reopen) { panel.hidden = false; const b = banner.querySelector('[data-cookie="customize"]'); b.textContent = 'Save choices'; b.dataset.cookie = 'save'; }
  }
  // The settings link lives in the footer ([data-cookie-settings]); it reopens the choices with the current values.
  function settingsButton() {
    document.addEventListener('click', e => {
      if (!e.target.closest('[data-cookie-settings]')) return;
      e.preventDefault();
      showBanner(true);
    });
  }
  loadAds();
  const init = () => { if (!state) showBanner(false); settingsButton(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
