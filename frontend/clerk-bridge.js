/* PresetHub Clerk bridge (v3.19.0).
   1. Loads Clerk's browser SDK from jsDelivr with the publishable key (sign-in, sign-up, profile UI).
   2. Adds "Authorization: Bearer <session token>" to every same-origin /api/ request, so the server can verify the user.
   3. Exposes window.phAuth for the site, and fires "presethub:auth" when the sign-in state changes. */
(function () {
  'use strict';
  var me = document.currentScript;
  var PK = (me && me.getAttribute('data-pk')) || '';
  var PK_OK = /^pk_(test|live)_[A-Za-z0-9+/=_-]{20,}$/.test(PK);
  var ready = false;

  // 2. Token on API calls (installed first, so every later fetch goes through it).
  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var sameApi = false;
    try {
      var u = new URL(url, location.origin);
      sameApi = u.origin === location.origin && u.pathname.indexOf('/api/') === 0;
    } catch (_) { sameApi = false; }
    if (!sameApi || !window.Clerk || !window.Clerk.session) return origFetch(input, init);
    return window.Clerk.session.getToken().then(function (token) {
      var headers = new Headers((init && init.headers) || (input && input.headers) || {});
      if (token && !headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
      return origFetch(input, Object.assign({}, init || {}, { headers: headers }));
    }).catch(function () { return origFetch(input, init); });
  };

  function announce() {
    window.dispatchEvent(new CustomEvent('presethub:auth', { detail: { signedIn: !!(window.Clerk && window.Clerk.user) } }));
  }

  // 1. Clerk SDK.
  if (PK_OK) {
    var s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.setAttribute('data-clerk-publishable-key', PK);
    s.src = 'https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js';
    s.onload = function () {
      if (!window.Clerk || typeof window.Clerk.load !== 'function') return;
      window.Clerk.load().then(function () {
        ready = true;
        announce();
        if (typeof window.Clerk.addListener === 'function') window.Clerk.addListener(announce);
      }).catch(function () { announce(); });
    };
    document.head.appendChild(s);
  }

  // 3. Site API.
  window.phAuth = {
    isReady: function () { return ready; },
    openSignIn: function () { return window.Clerk && window.Clerk.openSignIn({}); },
    openSignUp: function () { return window.Clerk && window.Clerk.openSignUp({}); },
    openUserProfile: function () { return window.Clerk && window.Clerk.openUserProfile(); },
    signOut: function () { return window.Clerk ? window.Clerk.signOut({ redirectUrl: '/' }) : Promise.resolve(); },
    getToken: function () { return window.Clerk && window.Clerk.session ? window.Clerk.session.getToken() : Promise.resolve(''); },
    user: function () { return window.Clerk ? window.Clerk.user : null; }
  };
  if (!PK_OK) window.PH_AUTH_DISABLED = true;
})();
