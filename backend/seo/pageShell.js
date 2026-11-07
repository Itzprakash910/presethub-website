'use strict';
/**
 * Shared shell for every server-rendered PresetHub page (preset, profile, lists, shayari, app pages).
 * The header, footer, dialog container and toast box are read from frontend/index.html at start-up, so every page looks
 * exactly like the home page, and the same app.js runs on it ("page mode"): login, download, buy, like, save, share,
 * comments, reviews and all dialogs work on the page itself.
 *
 *   pageBody({ page, pageId, back, crumbs, main })  ->  "<body ...>...</body>"
 * The caller writes "<!doctype html><html><head>...</head>" + pageBody(...) + "</html>".
 */
const fs = require('fs');
const path = require('path');
const { SITE_FOOTER } = require('./footer');

let ASSET_V = '3.25.2';
try { ASSET_V = require('../../package.json').version || ASSET_V; } catch (_) { /* keep default */ }

const FALLBACK_HEADER = '<header><div class="container nav"><div class="brand-cluster"><a class="logo" href="/" aria-label="PresetHub home">Preset<span>Hub</span></a></div></div></header>';

function loadParts() {
  let html = '';
  try { html = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'index.html'), 'utf8'); } catch (_) { /* use fallbacks */ }
  const pick = (re, fb) => { const m = html.match(re); return m ? m[0] : fb; };
  return {
    header: pick(/<header>[\s\S]*?<\/header>/, FALLBACK_HEADER),
    overlay: pick(/<div class="modal-overlay" id="overlay"[\s\S]*?<div id="modalBody"><\/div><\/div>\s*<\/div>/, '<div class="modal-overlay" id="overlay" role="dialog" aria-modal="true"><div class="modal"><button class="close" data-action="close" aria-label="Close">×</button><div id="modalBody"></div></div></div>'),
    toast: pick(/<div id="toastBox"[^>]*><\/div>/, '<div id="toastBox" aria-live="polite"></div>')
  };
}
const PARTS = loadParts();

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SCRIPTS = ['qr.js', 'share-card.js', 'app.js', 'async-css.js', 'texts.js', 'features.js', 'cookie-consent.js']
  .map(f => `<script src="/${f}?v=${ASSET_V}" defer></script>`).join('');

/**
 * page:    name used by app.js to mount the right view (preset, profile, wishlist, downloads, notifications, messages, pro,
 *          account, upload, myshares) or "static" for pages that are fully server-rendered (lists, shayari)
 * pageId:  id of the item to show (preset or profile id)
 * back:    { href, label }: where the Back button goes when there is no browser history
 * crumbs:  [[name, href], ...] shown next to the Back button (last item has no link)
 * main:    the page content (also the fallback for crawlers and for visitors without JavaScript)
 */
function pageBody({ page = 'static', pageId = '', back, crumbs = [], main = '', mainClass = '' } = {}) {
  const b = back && back.href ? back : { href: '/', label: 'Home' };
  const trail = crumbs.length
    ? `<nav class="page-crumbs" aria-label="Breadcrumb">${crumbs.map((c, i) => (c[1] && i < crumbs.length - 1 ? `<a href="${esc(c[1])}">${esc(c[0])}</a>` : `<span aria-current="page">${esc(c[0])}</span>`)).join('<i aria-hidden="true">/</i>')}</nav>`
    : '';
  return `<body data-page="${esc(page)}" data-page-id="${esc(pageId)}">
<a class="skip-link" href="#pageRoot">Skip to content</a>
${PARTS.header}
<div class="container page-toolbar"><a class="page-back" href="${esc(b.href)}" data-page-back title="Back to ${esc(b.label)}"><i class="fas fa-chevron-left" aria-hidden="true"></i><span>Back</span></a>${trail}</div>
<main id="pageRoot" class="container page-root seo-page ${esc(mainClass)}">
${main}
</main>
${SITE_FOOTER}
${PARTS.overlay}
${PARTS.toast}
${SCRIPTS}
</body>`;
}

// Works out the Back target and breadcrumb trail from a page's path, so list and shayari pages need no extra settings.
function autoNav(urlOrPath) {
  let p = '/';
  try { p = new URL(urlOrPath, 'https://x.local').pathname; } catch (_) { /* keep "/" */ }
  const parts = p.split('/').filter(Boolean);
  const pretty = v => { let t = v; try { t = decodeURIComponent(v); } catch (_) { /* keep */ } t = t.replace(/[-_]+/g, ' ').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Page'; };
  const home = ['Home', '/'];
  if (!parts.length) return { back: { href: '/', label: 'Home' }, crumbs: [] };
  if (parts[0] === 'presets') {
    if (parts[1] === 'category' && parts[2]) return { back: { href: '/presets/', label: 'All presets' }, crumbs: [home, ['Presets', '/presets/'], [pretty(parts[2]), '']] };
    return { back: { href: '/', label: 'Home' }, crumbs: [home, ['All presets', '']] };
  }
  if (parts[0] === 'tags') {
    if (parts[1]) return { back: { href: '/tags/', label: 'All tags' }, crumbs: [home, ['Tags', '/tags/'], ['#' + pretty(parts[1]), '']] };
    return { back: { href: '/', label: 'Home' }, crumbs: [home, ['Tags', '']] };
  }
  if (parts[0] === 'shayari') {
    if (parts[1] === 'category' && parts[2]) return { back: { href: '/shayari/', label: 'Shayari' }, crumbs: [home, ['Shayari', '/shayari/'], [pretty(parts[2]), '']] };
    if (parts[1]) return { back: { href: '/shayari/', label: 'Shayari' }, crumbs: [home, ['Shayari', '/shayari/'], [pretty(parts[2] || 'Post'), '']] };
    return { back: { href: '/', label: 'Home' }, crumbs: [home, ['Shayari & Text Prompts', '']] };
  }
  return { back: { href: '/', label: 'Home' }, crumbs: [home, [pretty(parts[parts.length - 1]), '']] };
}

module.exports = { autoNav, pageBody, SCRIPTS, ASSET_V, PARTS };
