/**
 * Server-rendered discovery pages for Google:
 *   /presets/                         all Lightroom presets (sort, pagination)
 *   /presets/category/:cat/           presets per category
 *   /tags/                            hashtag index (presets + shayari)
 *   /tags/:tag/                       every preset and text post for one #hashtag
 * Each page has real HTML content, pagination links, breadcrumbs and JSON-LD.
 */
const mongoose = require('mongoose');
const { Preset, TextPost } = require('../models');

const PAGE = 24;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (v, n) => { const s = String(v || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
const slugOf = v => String(v || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'item';
const escRe = v => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TAG_RE = /^[\p{L}\p{N}_-]{2,30}$/u;
const money = p => Number(p) > 0 ? `₹${Number(p).toFixed(0)}` : 'Free';

function normTag(raw) {
  const t = String(raw || '').trim().replace(/^#/, '').toLowerCase();
  return TAG_RE.test(t) ? t : '';
}

module.exports = function registerListPages(app, h) {
  const { SITE_URL, SITE_CREATOR, SITE_SOCIAL, commonSeoHead, safeJson, seoAssetUrl } = h;

  function shell({ title, description, canonical, keywords, ld, body, noindex = false, prev, next }) {
    let head = commonSeoHead({ title, description, canonical, keywords });
    if (noindex) head = head.replace(/<meta name="robots" content="[^"]*">/, '<meta name="robots" content="noindex,follow">');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
${head}${prev ? `<link rel="prev" href="${esc(prev)}">` : ''}${next ? `<link rel="next" href="${esc(next)}">` : ''}
<script type="application/ld+json">${safeJson({ '@context': 'https://schema.org', '@graph': ld })}</script>
</head><body><main class="seo-page"><div class="shayari-page">
<a class="logo" href="/"><img class="brand-logo" src="/assets/images/presethub-p-logo.jpg" alt="PresetHub logo" width="36" height="36">Preset<span>Hub</span></a>
${body}
<footer style="margin-top:34px"><div class="footer-bottom" style="border-top:0"><span>© PresetHub</span><span>Website by <a href="${SITE_SOCIAL}" target="_blank" rel="me noopener noreferrer">${esc(SITE_CREATOR)}</a></span><span><a href="/">Presets</a> · <a href="/presets/">All presets</a> · <a href="/shayari/">Shayari</a> · <a href="/tags/">Tags</a></span></div></footer>
</div></main><script src="/texts.js?v=3.4.0" defer></script><script src="/features.js?v=3.4.0" defer></script><script src="/cookie-consent.js?v=3.4.0" defer></script></body></html>`;
  }

  const crumbs = items => ({ '@type': 'BreadcrumbList', itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it[0], item: SITE_URL + it[1] })) });
  const pager = (basePath, page, pages) => pages > 1
    ? `<nav class="load-more-wrap" aria-label="Pagination">${page > 1 ? `<a class="btn btn-outline btn-sm" href="${basePath}${page - 1 > 1 ? `?page=${page - 1}` : ''}" rel="prev">← Previous</a> ` : ''}<span>Page ${page} of ${pages}</span>${page < pages ? ` <a class="btn btn-outline btn-sm" href="${basePath}?page=${page + 1}" rel="next">Next →</a>` : ''}</nav>` : '';

  const presetCard = p => `<article class="seo-preset-card">
<a class="seo-preset-thumb" href="/preset/${p._id}/${slugOf(p.name)}/"><img src="${esc(seoAssetUrl(p.previewImage))}" alt="${esc(p.name)} Lightroom preset" width="320" height="200" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='/assets/images/og-image.png'"></a>
<div class="seo-preset-body"><h3><a href="/preset/${p._id}/${slugOf(p.name)}/">${esc(p.name)}</a></h3>
<p class="seo-preset-meta">${esc(p.category || 'Preset')} · by ${esc(p.author || 'Creator')} · <b>${money(p.price)}</b></p>
<p class="seo-preset-meta">↓ ${Number(p.downloads || 0)} downloads</p></div></article>`;

  const tagChips = tags => tags.map(t => `<a class="text-chip" href="/tags/${encodeURIComponent(t)}/">#${esc(t)}</a>`).join('');

  // ---------- /presets/ and /presets/category/:cat/ ----------
  async function presetList(req, res, next, category) {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const sortKey = ['popular', 'new', 'free', 'price-low', 'price-high'].includes(req.query.sort) ? req.query.sort : 'popular';
      const filter = { status: 'approved' };
      if (category) filter.category = new RegExp(`^${escRe(category)}$`, 'i');
      if (sortKey === 'free') filter.price = { $lte: 0 };
      const sort = { popular: { downloads: -1, views: -1 }, new: { createdAt: -1 }, free: { downloads: -1 }, 'price-low': { price: 1 }, 'price-high': { price: -1 } }[sortKey];
      const [items, total, cats] = await Promise.all([
        Preset.find(filter).sort(sort).skip((page - 1) * PAGE).limit(PAGE).select('name category author price downloads previewImage').lean(),
        Preset.countDocuments(filter),
        Preset.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: '$category', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 30 }])
      ]);
      const pages = Math.max(1, Math.ceil(total / PAGE));
      const basePath = category ? `/presets/category/${encodeURIComponent(category)}/` : '/presets/';
      const label = category || 'Lightroom';
      const h1 = category ? `${category} Lightroom Presets` : 'Free & Premium Lightroom Presets';
      const intro = category
        ? `Download ${total} ${category} Lightroom presets (XMP & DNG) made by PresetHub creators. Free and premium options, preview before you buy.`
        : 'Browse free and premium Lightroom presets for mobile and desktop — portrait, travel, moody, film, black & white and more. XMP & DNG downloads with previews.';
      const title = `${label} Lightroom Presets – Free Download | PresetHub${page > 1 ? ` – Page ${page}` : ''}`;
      const description = clip(intro, 158);
      const canonical = SITE_URL + basePath + (page > 1 ? `?page=${page}` : '');
      const body = `<h1>${esc(h1)}</h1><p class="lead">${esc(intro)}</p>
<nav class="text-chips" aria-label="Preset categories"><a class="text-chip ${!category ? 'active' : ''}" href="/presets/">All</a>${cats.filter(c => c._id).map(c => `<a class="text-chip ${category === c._id ? 'active' : ''}" href="/presets/category/${encodeURIComponent(c._id)}/">${esc(c._id)} (${c.n})</a>`).join('')}</nav>
<div class="seo-preset-grid">${items.map(presetCard).join('') || '<p class="lead">No presets here yet — check back soon.</p>'}</div>
${pager(basePath, page, pages)}
<p class="lead">Looking for something else? Explore <a href="/tags/">popular hashtags</a> or read <a href="/shayari/">shayari &amp; text prompts</a>.</p>`;
      const ld = [
        crumbs(category ? [['Home', '/'], ['Presets', '/presets/'], [category, basePath]] : [['Home', '/'], ['Presets', '/presets/']]),
        { '@type': 'CollectionPage', name: h1, url: canonical, description, isPartOf: { '@id': SITE_URL + '/#website' } },
        { '@type': 'ItemList', numberOfItems: total, itemListElement: items.map((p, i) => ({ '@type': 'ListItem', position: (page - 1) * PAGE + i + 1, url: `${SITE_URL}/preset/${p._id}/${slugOf(p.name)}/`, name: p.name })) }
      ];
      res.type('html').send(shell({
        title, description, canonical, ld, body,
        keywords: `${label} lightroom presets, free lightroom presets, xmp presets, dng presets, mobile lightroom presets, preset download, PresetHub`,
        prev: page > 1 ? SITE_URL + basePath + (page - 1 > 1 ? `?page=${page - 1}` : '') : '', next: page < pages ? `${SITE_URL}${basePath}?page=${page + 1}` : ''
      }));
    } catch (e) { next(e); }
  }
  app.get('/presets/', (req, res, next) => presetList(req, res, next, ''));
  app.get('/presets', (req, res) => res.redirect(301, '/presets/'));
  app.get('/presets/category/:cat/', (req, res, next) => presetList(req, res, next, String(req.params.cat || '').slice(0, 50)));

  // ---------- /tags/ index ----------
  app.get('/tags/', async (req, res, next) => {
    try {
      const [pt, tt] = await Promise.all([
        Preset.aggregate([{ $match: { status: 'approved' } }, { $unwind: '$tags' }, { $group: { _id: { $toLower: '$tags' }, n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 120 }]),
        TextPost.aggregate([{ $match: { status: 'approved' } }, { $unwind: '$tags' }, { $group: { _id: '$tags', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 120 }])
      ]);
      const map = new Map();
      for (const r of [...pt, ...tt]) { const k = String(r._id || '').trim(); if (TAG_RE.test(k)) map.set(k, (map.get(k) || 0) + r.n); }
      const tags = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 150);
      const canonical = `${SITE_URL}/tags/`;
      const title = 'Trending Hashtags – Lightroom Presets & Shayari Tags | PresetHub';
      const description = 'Browse every PresetHub hashtag: find Lightroom presets, sad shayari, love lines, captions and AI prompts by #tag.';
      const body = `<h1>Trending hashtags</h1><p class="lead">Tap a hashtag to see all presets and shayari posts tagged with it.</p>
<div class="text-chips tag-cloud">${tags.map(([t, n]) => `<a class="text-chip" href="/tags/${encodeURIComponent(t)}/">#${esc(t)} <small>${n}</small></a>`).join('') || '<p class="lead">No hashtags yet.</p>'}</div>`;
      res.type('html').send(shell({
        title, description, canonical, body,
        keywords: 'hashtags, lightroom preset tags, shayari hashtags, instagram hashtags, PresetHub',
        ld: [crumbs([['Home', '/'], ['Tags', '/tags/']]), { '@type': 'CollectionPage', name: 'Hashtags', url: canonical, description }]
      }));
    } catch (e) { next(e); }
  });

  // ---------- /tags/:tag/ ----------
  app.get('/tags/:tag/', async (req, res, next) => {
    try {
      const tag = normTag(req.params.tag);
      if (!tag) return res.redirect(301, '/tags/');
      const rx = new RegExp(`^${escRe(tag)}$`, 'i');
      const [presets, texts, presetCount, textCount] = await Promise.all([
        Preset.find({ status: 'approved', tags: rx }).sort({ downloads: -1 }).limit(48).select('name category author price downloads previewImage').lean(),
        TextPost.find({ status: 'approved', tags: rx }).sort({ copies: -1, createdAt: -1 }).limit(24).lean(),
        Preset.countDocuments({ status: 'approved', tags: rx }),
        TextPost.countDocuments({ status: 'approved', tags: rx })
      ]);
      if (!presetCount && !textCount) return res.status(404).type('html').send(shell({ title: `#${tag} | PresetHub`, description: 'No posts for this hashtag yet.', canonical: `${SITE_URL}/tags/`, noindex: true, body: `<h1>#${esc(tag)}</h1><p class="lead">Is hashtag par abhi koi post nahi hai. <a href="/tags/">Dusre hashtags dekhein →</a></p>` }));
      // related tags from the same posts
      const related = new Map();
      for (const p of presets) for (const t of (p.tags || [])) { const k = String(t).toLowerCase(); if (k !== tag && TAG_RE.test(k)) related.set(k, (related.get(k) || 0) + 1); }
      for (const t of texts) for (const x of (t.tags || [])) { if (x !== tag && TAG_RE.test(x)) related.set(x, (related.get(x) || 0) + 1); }
      const relTags = [...related.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => x[0]);
      const canonical = `${SITE_URL}/tags/${encodeURIComponent(tag)}/`;
      const total = presetCount + textCount;
      const title = `#${tag} – Lightroom Presets & Shayari | PresetHub`;
      const description = clip(`${presetCount} Lightroom preset(s) and ${textCount} shayari / text post(s) tagged #${tag}. Download, copy and share on PresetHub.`, 158);
      const body = `<div class="seo-breadcrumbs"><a href="/">Home</a><span>/</span><a href="/tags/">Tags</a><span>/</span><span>#${esc(tag)}</span></div>
<h1>#${esc(tag)}</h1><p class="lead">${total} post${total === 1 ? '' : 's'} tagged #${esc(tag)} — ${presetCount} preset${presetCount === 1 ? '' : 's'} and ${textCount} shayari / text post${textCount === 1 ? '' : 's'}.</p>
${relTags.length ? `<nav class="text-chips" aria-label="Related hashtags">${tagChips(relTags)}</nav>` : ''}
${presets.length ? `<h2>Lightroom presets</h2><div class="seo-preset-grid">${presets.map(presetCard).join('')}</div>` : ''}
${texts.length ? `<h2>Shayari &amp; text posts</h2><div class="text-grid">${texts.map(t => `<article class="text-card"><div class="text-card-top"><span class="text-cat">${esc(t.category)}</span></div>${t.title ? `<h3 class="text-title"><a href="/shayari/${t._id}/${slugOf(t.slug || t.title)}/">${esc(t.title)}</a></h3>` : ''}<p class="text-body"><a href="/shayari/${t._id}/${t.slug || t.category}/">${esc(clip(t.text, 280))}</a></p><div class="text-by">${esc(t.author)}</div></article>`).join('')}</div>` : ''}`;
      res.type('html').send(shell({
        title, description, canonical, body,
        keywords: `${tag}, #${tag}, ${tag} lightroom preset, ${tag} shayari, ${tag} status, PresetHub`,
        ld: [
          crumbs([['Home', '/'], ['Tags', '/tags/'], [`#${tag}`, `/tags/${encodeURIComponent(tag)}/`]]),
          { '@type': 'CollectionPage', name: `#${tag}`, url: canonical, description, about: tag, isPartOf: { '@id': SITE_URL + '/#website' } },
          { '@type': 'ItemList', numberOfItems: total, itemListElement: presets.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE_URL}/preset/${p._id}/${slugOf(p.name)}/`, name: p.name })) }
        ]
      }));
    } catch (e) { next(e); }
  });

  return { tagsFor: async () => [] };
};
