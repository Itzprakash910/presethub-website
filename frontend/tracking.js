/* PresetHub analytics loader (v3.25.2).
   Google Analytics 4 loads only if the visitor allowed "Analytics"; Meta Pixel only if they allowed "Marketing".
   The choice comes from cookie-consent.js (localStorage key presethub_cookie_consent_v2, with the old v1 value still honoured).
   IDs come from data attributes set by the server from GA_MEASUREMENT_ID and META_PIXEL_ID. */
(function () {
  'use strict';
  var me = document.currentScript;
  if (!me) return;
  var GA = (me.getAttribute('data-ga') || '').trim();
  var PX = (me.getAttribute('data-pixel') || '').trim();
  var GA_OK = /^G-[A-Z0-9]{6,12}$/.test(GA);
  var PX_OK = /^\d{8,20}$/.test(PX);
  var gaStarted = false, pxStarted = false;

  function consent() {
    try {
      var raw = localStorage.getItem('presethub_cookie_consent_v2');
      if (raw) { var o = JSON.parse(raw); if (o && o.v === 2) return o; }
      var old = localStorage.getItem('presethub_cookie_consent_v1');
      if (old === 'accepted') return { analytics: true, ads: true, marketing: true };
    } catch (_) {}
    return {};
  }

  function loadGA() {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    var loc = location.href;
    try { var u = new URL(location.href); ['reset', 'token', 'orderId'].forEach(function (k) { u.searchParams.delete(k); }); loc = u.toString(); } catch (_) {}
    window.gtag('config', GA, { page_location: loc });
    var t = document.createElement('script');
    t.async = true;
    t.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA);
    document.head.appendChild(t);
  }

  // Meta Pixel base code (same loader as Meta's standard snippet, without inline script).
  function loadPixel() {
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', PX);
    window.fbq('track', 'PageView');
  }

  function apply() {
    var c = consent();
    if (c.analytics && GA_OK && !gaStarted) { gaStarted = true; loadGA(); }
    if (c.marketing && PX_OK && !pxStarted) { pxStarted = true; loadPixel(); }
  }

  // Helper for later events (e.g. purchase, lead): phTrack('lead') or phTrack('purchase', {value: 99, currency: 'INR'}).
  window.phTrack = function (name, params) {
    if (gaStarted && window.gtag) window.gtag('event', name, params || {});
    if (pxStarted && window.fbq) window.fbq('track', name.charAt(0).toUpperCase() + name.slice(1), params || {});
  };

  apply();
  window.addEventListener('presethub:consent', apply);
})();
