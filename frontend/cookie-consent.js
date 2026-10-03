/* PresetHub consent-gated advertising and privacy controls. */
(() => {
  'use strict';
  const CONSENT_KEY = 'presethub_cookie_consent_v1';
  const ADSENSE_CLIENT = 'ca-pub-3554311294133493';
  const read = () => {
    try { return localStorage.getItem(CONSENT_KEY); } catch (_) { return null; }
  };
  const write = value => {
    try { localStorage.setItem(CONSENT_KEY, value); } catch (_) {}
  };
  function loadAds() {
    if (window.__presetHubAdsLoaded || !ADSENSE_CLIENT) return;
    window.__presetHubAdsLoaded = true;
    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADSENSE_CLIENT)}`;
    script.onload = () => { window.dispatchEvent(new CustomEvent('presethub:ads-ready')); };
    script.onerror = () => { window.__presetHubAdsLoaded = false; };
    document.head.appendChild(script);
  }
  function removeBanner() {
    document.querySelector('#cookieConsent')?.remove();
  }
  function showBanner() {
    if (document.querySelector('#cookieConsent')) return;
    const banner = document.createElement('section');
    banner.id = 'cookieConsent';
    banner.className = 'cookie-consent';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-live', 'polite');
    banner.setAttribute('aria-labelledby', 'cookieConsentTitle');
    banner.innerHTML = `
      <div class="cookie-consent-copy">
        <strong id="cookieConsentTitle">Privacy & cookies</strong>
        <p>PresetHub uses essential storage for login and site preferences. Optional advertising cookies are used only if you allow them.</p>
        <a href="/privacy.html">Read the Privacy Policy</a>
      </div>
      <div class="cookie-consent-actions">
        <button type="button" class="btn btn-outline" data-cookie="reject">Reject optional</button>
        <button type="button" class="btn btn-primary" data-cookie="accept">Allow optional cookies</button>
      </div>`;
    banner.addEventListener('click', e => {
      const action = e.target.closest('[data-cookie]')?.dataset.cookie;
      if (!action) return;
      write(action === 'accept' ? 'accepted' : 'rejected');
      removeBanner();
      if (action === 'accept') loadAds();
    });
    document.body.appendChild(banner);
  }
  function settingsButton() {
    if (document.querySelector('#cookieSettings')) return;
    const btn = document.createElement('button');
    btn.id = 'cookieSettings';
    btn.className = 'cookie-settings';
    btn.type = 'button';
    btn.textContent = 'Cookie settings';
    btn.addEventListener('click', () => { write(''); showBanner(); });
    document.body.appendChild(btn);
  }
  const consent = read();
  if (consent === 'accepted') loadAds();
  else if (!consent) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showBanner, { once: true });
    else showBanner();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', settingsButton, { once: true });
  else settingsButton();
})();
