/**
 * Server-rendered Shayari / Text Prompt pages so Google indexes the FULL text:
 *   /shayari/                      – latest + search (?q=) + pagination (?page=)
 *   /shayari/category/:cat/        – per-category collections (sad, true-lines, love, …)
 *   /shayari/:id/:slug?/           – a single post with the complete paragraph, JSON-LD and related posts
 * The interactive buttons (copy / like / comment / share) are progressively added by /texts.js.
 */
const mongoose = require('mongoose');
const { TextPost, User, TEXT_CATEGORIES } = require('../models');
const { tickForFollowers } = require('../utils/tick');
const { isProUser } = require('../utils/plans');

const CAT_INFO = {
  'sad': ['Sad Shayari', 'दर्द भरी सैड शायरी', 'Dard bhari sad shayari in Hindi & Hinglish — dil ko chhu jane wali sad lines. Copy karo aur apne dost ke saath share karo.'],
  'true-lines': ['True Lines', 'सच्ची बातें — True Lines', 'Zindagi ki sachchi baatein: true lines, deep lines aur reality quotes jo seedha dil par lagti hain.'],
  'love': ['Love Shayari', 'लव शायरी', 'Pyaar bhari love shayari — apne partner ke liye romantic lines copy karein aur bhejein.'],
  'attitude': ['Attitude Shayari', 'एटीट्यूड शायरी', 'Royal attitude shayari aur status lines for Instagram, WhatsApp aur Facebook.'],
  'motivation': ['Motivational Shayari', 'मोटिवेशनल शायरी', 'Himmat aur junoon jagane wali motivational shayari aur quotes.'],
  'friendship': ['Dosti Shayari', 'दोस्ती शायरी', 'Yaari-dosti ki best shayari — apne best friend ko tag karein.'],
  'life': ['Life Quotes', 'ज़िन्दगी पर शायरी', 'Zindagi par gehri shayari aur life quotes.'],
  'good-morning': ['Good Morning Shayari', 'गुड मॉर्निंग शायरी', 'Subah ko khoobsurat banane wali good morning shayari aur wishes.'],
  'good-night': ['Good Night Shayari', 'गुड नाइट शायरी', 'Sukoon bhari good night shayari aur messages.'],
  'funny': ['Funny Shayari', 'फनी शायरी', 'Hansi se lot-pot kar dene wali funny shayari.'],
  'romantic': ['Romantic Shayari', 'रोमांटिक शायरी', 'Romantic shayari aur sweet lines for your special one.'],
  'breakup': ['Breakup Shayari', 'ब्रेकअप शायरी', 'Toote dil ki breakup shayari aur emotional lines.'],
  'ai-prompt': ['AI Prompts', 'AI Prompts', 'Ready-to-use text prompts for ChatGPT, image generators and creative tools — copy & paste.'],
  'caption': ['Captions', 'Instagram Captions', 'Short, catchy captions and bios for Instagram, Reels and WhatsApp status.'],
  'other': ['More Text', 'अन्य शायरी', 'Aur bhi shayari, quotes aur text posts.']
};
const PAGE = 12;

module.exports = function registerShayariRoutes(app, h) {
  const { SITE_URL, SITE_CREATOR, SITE_SOCIAL, escHtml, safeJson, commonSeoHead } = h;
  const isId = v => mongoose.Types.ObjectId.isValid(v);
  const clip = (v, n) => { const s = String(v || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
  const postPath = t => `/shayari/${t._id}/${t.slug || `${t.category}-shayari`}/`;
  const label = c => (CAT_INFO[c] || CAT_INFO.other)[0];

  async function authorsFor(items) {
    const ids = [...new Set(items.map(i => String(i.authorId)))];
    const users = await User.find({ _id: { $in: ids } }).select('name username followers subscription').lean();
    return new Map(users.map(u => [String(u._id), u]));
  }
  const tickHtml = tk => tk ? `<span class="tick tick-${tk}" title="${tk === 'gold' ? 'Star creator' : tk === 'blue' ? 'Verified creator' : 'Rising creator'}"><i class="fas fa-circle-check"></i></span>` : '';

  // Mirrors cardHtml() in /texts.js so the buttons work on server-rendered markup.
  function card(t, authors, { full = false, single = false } = {}) {
    const a = authors.get(String(t.authorId));
    const tk = tickForFollowers(a?.followers?.length);
    return `<article class="text-card" data-text-card data-text-id="${t._id}" data-author-id="${t.authorId}"${single ? ' data-single' : ''}>
<div class="text-card-top"><a class="text-cat" href="/shayari/category/${t.category}/">${escHtml(label(t.category))}</a><small>${new Date(t.createdAt).toLocaleDateString('en-IN')}</small></div>
${t.title ? `<h${single ? 1 : 3} class="text-title"><a href="${postPath(t)}">${escHtml(t.title)}</a></h${single ? 1 : 3}>` : ''}
<p class="text-body ${full ? 'full' : ''}" data-text-body>${escHtml(t.text)}</p>
${(t.tags||[]).length ? `<div class="tx-tags">${(t.tags||[]).slice(0,6).map(x=>`<a class="tx-tag" href="/tags/${encodeURIComponent(x)}/">#${escHtml(x)}</a>`).join("")}</div>` : ""}
<div class="text-by"><a href="/profile/${t.authorId}/${encodeURIComponent((a?.username || t.author || 'creator').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'creator')}/">${escHtml(t.author)}</a> ${tickHtml(tk)}${isProUser(a) ? '<span class="pro-chip"><i class="fas fa-crown"></i> PRO</span>' : ''}</div>
<div class="text-actions">
<button class="tx-btn tx-copy" data-t-action="copy" title="Copy text"><i class="fas fa-copy"></i> <span>Copy</span></button>
<button class="tx-btn" data-t-action="like" title="Like"><i class="far fa-heart"></i> <span data-t-count="likes">${(t.likes || []).length}</span></button>
<button class="tx-btn" data-t-action="comment" title="Comments"><i class="far fa-comment"></i> <span data-t-count="comments">${t.commentsCount || 0}</span></button>
<button class="tx-btn" data-t-action="share" title="Share"><i class="fas fa-share-nodes"></i> <span data-t-count="shares">${t.shares || 0}</span></button>
<button class="tx-btn" data-share-image title="Share as image"><i class="fas fa-image"></i></button>
<button class="tx-btn" data-tip="${t.authorId}" data-name="${escHtml(t.author)}" title="Tip creator"><i class="fas fa-hand-holding-heart"></i></button>
<button class="tx-btn" data-report="text" data-id="${t._id}" title="Report"><i class="fas fa-flag"></i></button>
</div></article>`;
  }

  function shell({ title, description, canonical, keywords, ld, body, noindex = false, prev, next }) {
    let head = commonSeoHead({ title, description, canonical, keywords });
    if (noindex) head = head.replace(/<meta name="robots" content="[^"]*">/, '<meta name="robots" content="noindex,follow">');
    return `<!doctype html><html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escHtml(title)}</title>
${head}${prev ? `<link rel="prev" href="${escHtml(prev)}">` : ''}${next ? `<link rel="next" href="${escHtml(next)}">` : ''}
<script type="application/ld+json">${safeJson({ '@context': 'https://schema.org', '@graph': ld })}</script>
</head><body><main class="seo-page"><div class="shayari-page">
<a class="logo" href="/"><img class="brand-logo" src="/assets/images/presethub-p-logo.jpg" alt="PresetHub logo" width="36" height="36">Preset<span>Hub</span></a>
${body}
<footer style="margin-top:34px"><div class="footer-bottom" style="border-top:0"><span>© PresetHub</span><span>Website by <a href="${SITE_SOCIAL}" target="_blank" rel="me noopener noreferrer">${SITE_CREATOR}</a></span><span><a href="/">Presets</a> · <a href="/shayari/">Shayari</a> · <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a></span></div></footer>
</div></main><script src="/texts.js?v=3.4.0" defer></script><script src="/features.js?v=3.4.0" defer></script><script src="/cookie-consent.js?v=3.4.0" defer></script></body></html>`;
  }

  const catChips = active => `<nav class="text-chips" aria-label="Shayari categories"><a class="text-chip ${!active ? 'active' : ''}" href="/shayari/">All</a>${TEXT_CATEGORIES.map(c => `<a class="text-chip ${active === c ? 'active' : ''}" href="/shayari/category/${c}/">${escHtml(label(c))}</a>`).join('')}</nav>`;
  const crumbs = items => ({ '@type': 'BreadcrumbList', itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it[0], item: SITE_URL + it[1] })) });

  async function listPage(req, res, next, category) {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const q = String(req.query.q || '').trim().slice(0, 60);
      const filter = { status: 'approved' };
      if (category) filter.category = category;
      if (q) { const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); filter.$or = [{ title: rx }, { text: rx }, { tags: rx }]; }
      const [items, total] = await Promise.all([
        TextPost.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE).limit(PAGE).lean(),
        TextPost.countDocuments(filter)
      ]);
      const pages = Math.max(1, Math.ceil(total / PAGE));
      const authors = await authorsFor(items);
      const info = category ? CAT_INFO[category] : null;
      const basePath = category ? `/shayari/category/${category}/` : '/shayari/';
      const canonical = SITE_URL + basePath + (page > 1 && !q ? `?page=${page}` : '');
      const h1 = info ? `${info[0]} — ${info[1]}` : 'Shayari, True Lines & Text Prompts';
      const intro = info ? info[2] : 'Sad shayari, true lines, love shayari, attitude quotes, captions aur AI prompts — ek tap me copy karein, like, comment aur share karein. Apni shayari bhi post karein, free me.';
      const title = (info ? `${info[0]} in Hindi – Copy & Share | PresetHub` : 'Shayari, Sad Lines, True Lines & Text Prompts – Copy Paste | PresetHub') + (page > 1 ? ` – Page ${page}` : '');
      const description = clip(`${intro} ${items[0] ? items[0].text : ''}`, 158);
      const keywords = info
        ? `${info[0].toLowerCase()}, ${info[0].toLowerCase()} in hindi, ${category.replace('-', ' ')} shayari, ${category.replace('-', ' ')} lines, shayari copy paste, hindi shayari, PresetHub`
        : 'shayari, sad shayari, true lines, love shayari, attitude shayari, hindi shayari, shayari copy paste, caption, quotes, text prompts, AI prompts, PresetHub';
      const body = `<h1>${escHtml(h1)}</h1><p class="lead">${escHtml(intro)}</p>
<div class="shayari-bar"><form data-search-form role="search" action="/shayari/" method="get"><input name="q" type="search" value="${escHtml(q)}" placeholder="Shayari search karein… (sad, dosti, true lines)" aria-label="Search shayari"><button class="btn btn-primary btn-sm" type="submit">Search</button></form><button class="btn btn-outline btn-sm" data-t-action="new-post"><i class="fas fa-pen-nib"></i> Post shayari</button></div>
${catChips(category)}
<div class="text-grid" id="textGrid">${items.length ? items.map(t => card(t, authors)).join('') : '<p class="lead">Is category me abhi koi post nahi hai. Pehli shayari aap post karein!</p>'}</div>
${pages > 1 && page < pages ? `<div class="load-more-wrap"><button class="btn btn-outline" data-load-more data-page="${page}" data-pages="${pages}" data-category="${category || ''}" data-q="${escHtml(q)}">Load more</button></div>` : ''}
${pages > 1 ? `<nav class="load-more-wrap" aria-label="Pagination">${page > 1 ? `<a class="btn btn-outline btn-sm" href="${basePath}${page - 1 > 1 ? `?page=${page - 1}` : ''}">← Previous</a> ` : ''}<span>Page ${page} / ${pages}</span>${page < pages ? ` <a class="btn btn-outline btn-sm" href="${basePath}?page=${page + 1}">Next →</a>` : ''}</nav>` : ''}`;
      const ld = [
        crumbs(category ? [['Home', '/'], ['Shayari', '/shayari/'], [info[0], basePath]] : [['Home', '/'], ['Shayari', '/shayari/']]),
        { '@type': 'CollectionPage', name: h1, url: canonical, description, inLanguage: 'hi', isPartOf: { '@id': SITE_URL + '/#website' } },
        { '@type': 'ItemList', itemListElement: items.map((t, i) => ({ '@type': 'ListItem', position: (page - 1) * PAGE + i + 1, url: SITE_URL + postPath(t), name: t.title || clip(t.text, 70) })) }
      ];
      res.type('html').send(shell({
        title, description, canonical, keywords, ld, body, noindex: Boolean(q),
        prev: page > 1 ? SITE_URL + basePath + (page - 1 > 1 ? `?page=${page - 1}` : '') : '', next: page < pages ? `${SITE_URL}${basePath}?page=${page + 1}` : ''
      }));
    } catch (e) { next(e); }
  }

  app.get('/shayari/', (req, res, next) => listPage(req, res, next, ''));
  app.get('/shayari', (req, res) => res.redirect(301, '/shayari/'));
  app.get('/shayari/category/:cat/', (req, res, next) => {
    if (!TEXT_CATEGORIES.includes(req.params.cat)) return res.redirect(301, '/shayari/');
    return listPage(req, res, next, req.params.cat);
  });

  app.get('/shayari/:id/:slug?/', async (req, res, next) => {
    try {
      if (!isId(req.params.id)) return res.redirect(302, '/shayari/');
      const t = await TextPost.findOne({ _id: req.params.id, status: 'approved' }).lean();
      if (!t) return res.status(404).type('html').send(shell({ title: 'Post not found | PresetHub', description: 'This post is not available.', canonical: SITE_URL + '/shayari/', ld: [], noindex: true, body: '<h1>Post not found</h1><p class="lead">Ye shayari available nahi hai. <a href="/shayari/">Dusri shayari dekhein →</a></p>' }));
      const canonicalPath = postPath(t);
      if (req.path !== canonicalPath) return res.redirect(301, canonicalPath);
      const [authors, related] = await Promise.all([
        authorsFor([t]),
        TextPost.find({ status: 'approved', category: t.category, _id: { $ne: t._id } }).sort({ copies: -1, createdAt: -1 }).limit(6).lean()
      ]);
      const relAuthors = await authorsFor(related);
      const first = (t.title || t.text.split('\n')[0]).trim();
      const title = `${clip(first, 60)} – ${label(t.category)} | PresetHub`;
      const description = clip(t.text, 158);
      const canonical = SITE_URL + canonicalPath;
      const keywords = [...new Set([label(t.category).toLowerCase(), `${t.category.replace('-', ' ')} shayari`, 'shayari copy paste', 'hindi shayari', ...(t.tags || []), 'PresetHub'])].join(', ');
      const body = `<div class="seo-breadcrumbs"><a href="/">Home</a><span>/</span><a href="/shayari/">Shayari</a><span>/</span><a href="/shayari/category/${t.category}/">${escHtml(label(t.category))}</a></div>
<div class="shayari-single">${card(t, authors, { full: true, single: true })}</div>
<section class="shayari-related"><h2>More ${escHtml(label(t.category))}</h2><div class="text-grid">${related.map(r => card(r, relAuthors)).join('') || '<p class="lead">Aur shayari jald aa rahi hai.</p>'}</div><p><a class="btn btn-outline btn-sm" href="/shayari/category/${t.category}/">Sab ${escHtml(label(t.category))} dekhein →</a></p></section>`;
      const ld = [
        crumbs([['Home', '/'], ['Shayari', '/shayari/'], [label(t.category), `/shayari/category/${t.category}/`], [clip(first, 50), canonicalPath]]),
        {
          '@type': 'CreativeWork', '@id': canonical + '#post', url: canonical, name: clip(first, 110), headline: clip(first, 110), text: t.text,
          inLanguage: t.language === 'english' ? 'en' : 'hi', genre: label(t.category), keywords: (t.tags || []).join(', '),
          author: { '@type': 'Person', name: t.author, url: `${SITE_URL}/profile/${t.authorId}/` },
          publisher: { '@id': SITE_URL + '/#organization' }, datePublished: new Date(t.createdAt).toISOString(), dateModified: new Date(t.updatedAt || t.createdAt).toISOString(),
          mainEntityOfPage: canonical,
          interactionStatistic: [
            { '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction', userInteractionCount: (t.likes || []).length },
            { '@type': 'InteractionCounter', interactionType: 'https://schema.org/CommentAction', userInteractionCount: t.commentsCount || 0 },
            { '@type': 'InteractionCounter', interactionType: 'https://schema.org/ShareAction', userInteractionCount: t.shares || 0 }
          ]
        }
      ];
      res.type('html').send(shell({ title, description, canonical, keywords, ld, body }));
    } catch (e) { next(e); }
  });

  // used by sitemap
  return { postPath, CAT_INFO };
};
module.exports.CAT_INFO = CAT_INFO;
