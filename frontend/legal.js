/* Fills the business and grievance-officer details on legal pages from /api/legal/contact.
   Without JavaScript (or if a detail is not configured) the page shows a generic, truthful fallback. */
(function () {
  'use strict';
  var nodes = document.querySelectorAll('[data-legal]');
  if (!nodes.length || !window.fetch) return;
  fetch('/api/legal/contact', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (c) {
    if (!c) return;
    var map = { entity: c.entityName, address: c.address, officer: c.officerName, officerEmail: c.officerEmail, officerAddress: c.officerAddress, supportEmail: c.supportEmail };
    nodes.forEach(function (el) {
      var v = map[el.getAttribute('data-legal')];
      if (!v) return;
      if (el.tagName === 'A' && /Email$|email/.test(el.getAttribute('data-legal'))) { el.href = 'mailto:' + v; }
      el.textContent = v;
    });
  }).catch(function () {});
})();
