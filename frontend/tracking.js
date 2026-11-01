/* PresetHub analytics loader (v3.18.0).
   GA4 and Meta Pixel load ONLY after the visitor accepts cookies (consent key from cookie-consent.js).
   IDs come from data attributes set by the server from GA_MEASUREMENT_ID and META_PIXEL_ID. */
(function () {
  'use strict';
  var me = document.currentScript;
  if (!me) return;
  var GA = (me.getAttribute('data-ga') || '').trim();
  var PX = (me.getAttribute('data-pixel') || '').trim();
  var GA_OK = /^G-[A-Z0-9]{6,12}$/.test(GA);
  var PX_OK = /^\d{8,20}$/.test(PX);
  var started = false;

  function loadGA() {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA);
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

  function start() {
    if (started) return;
    started = true;
    if (GA_OK) loadGA();
    if (PX_OK) loadPixel();
  }

  // Helper for later events (e.g. purchase, lead): phTrack('lead') or phTrack('purchase', {value: 99, currency: 'INR'}).
  window.phTrack = function (name, params) {
    if (!started) return;
    if (GA_OK && window.gtag) window.gtag('event', name, params || {});
    if (PX_OK && window.fbq) window.fbq('track', name.charAt(0).toUpperCase() + name.slice(1), params || {});
  };

  var consent = null;
  try { consent = localStorage.getItem('presethub_cookie_consent_v1'); } catch (_) {}
  if (consent === 'accepted') start();
  window.addEventListener('presethub:consent', function (e) { if (e.detail === 'accepted') start(); });
})();
