require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const fs = require('fs');

const authRoutes = require('./routes/auth');
const presetRoutes = require('./routes/presets');
const userRoutes = require('./routes/users');
const reviewRoutes = require('./routes/reviews');
const paymentRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');
const errorHandler = require('./utils/errorHandler');
const { getDB } = require('./config/db');

const app = express();
const PORT = Number(process.env.PORT || 4000);

// Dynamic path detection for Render
let projectRoot = path.join(__dirname, '..');
let frontendRoot = path.join(projectRoot, 'frontend');

// Fallback if frontend is not a sibling of backend
if (!fs.existsSync(frontendRoot)) {
  projectRoot = __dirname;
  frontendRoot = path.join(projectRoot, 'frontend');
}

const SITE_URL = (process.env.CLIENT_URL || 'https://presethub.site').replace(/\/+$/, '');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  if (process.env.NODE_ENV === 'production') {
    console.error('JWT_SECRET is required and must be at least 32 characters in production.');
    process.exit(1);
  }
  console.warn('JWT_SECRET is missing/short; development only.');
}

function ensureStructure() {
  const dirs = [
    path.join(projectRoot, 'uploads'),
    path.join(projectRoot, 'uploads/previews'),
    path.join(projectRoot, 'uploads/avatars'),
    path.join(projectRoot, 'backups'),
    path.join(frontendRoot, 'assets'),
    path.join(frontendRoot, 'assets/icons'),
    path.join(frontendRoot, 'assets/images'),
    path.join(frontendRoot, 'assets/screenshots')
  ];
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.warn(`[Warning] Could not create directory ${dir}:`, err.message);
    }
  }

  const dbPath = path.join(projectRoot, 'db.json');
  if (!fs.existsSync(dbPath)) {
    const seedPath = path.join(projectRoot, 'db.seed.json');
    try {
      if (fs.existsSync(seedPath)) {
        fs.copyFileSync(seedPath, dbPath);
      } else {
        fs.writeFileSync(dbPath, JSON.stringify({
          users: [], presets: [], downloads: [], orders: [], reviews: [],
          categories: ['Sunset', 'Black & White', 'Natural', 'Vintage', 'Cityscape']
        }, null, 2));
      }
    } catch (err) {
      console.warn(`[Warning] Could not initialize DB at ${dbPath}:`, err.message);
      // Fallback to local directory
      const fallbackDbPath = path.join(__dirname, 'db.json');
      if (!fs.existsSync(fallbackDbPath)) {
        fs.writeFileSync(fallbackDbPath, JSON.stringify({
          users: [], presets: [], downloads: [], orders: [], reviews: [],
          categories: ['Sunset', 'Black & White', 'Natural', 'Vintage', 'Cityscape']
        }, null, 2));
      }
    }
  }

  const required = {
    'robots.txt': `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nSitemap: ${SITE_URL}/sitemap.xml\n`,
    'ads.txt': `google.com, pub-3554311294133493, DIRECT, f08c47fec0942fa0\n`
  };
  for (const [name, content] of Object.entries(required)) {
    const file = path.join(frontendRoot, name);
    try {
      if (!fs.existsSync(file)) fs.writeFileSync(file, content);
    } catch (err) {
      console.warn(`[Warning] Could not write ${file}:`, err.message);
    }
  }
}

try {
  ensureStructure();
} catch (err) {
  console.error('Critical error in ensureStructure:', err);
}

app.disable('x-powered-by');
app.set('trust proxy', 1);

const allowedOrigins = new Set(
  [process.env.CLIENT_URL, SITE_URL, 'https://www.presethub.site']
    .filter(Boolean).map(x => x.replace(/\/+$/, ''))
);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://pagead2.googlesyndication.com", "https://checkout.razorpay.com", "https://googleads.g.doubleclick.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "https://api.razorpay.com", "https://pagead2.googlesyndication.com", "https://*.google.com", "https://*.googlesyndication.com", "https://*.doubleclick.net"],
      frameSrc: ["'self'", "https://api.razorpay.com", "https://checkout.razorpay.com", "https://googleads.g.doubleclick.net", "https://*.google.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: []
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }
}));

app.use(cors({
  origin(origin, cb) {
    if (!origin || process.env.NODE_ENV !== 'production') return cb(null, true);
    cb(null, allowedOrigins.has(origin.replace(/\/+$/, '')));
  },
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 300,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again later.' }
});
app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use('/uploads/previews', express.static(path.join(projectRoot, 'uploads/previews'), {
  index: false, dotfiles: 'deny', maxAge: '1h'
}));
app.use('/uploads/avatars', express.static(path.join(projectRoot, 'uploads/avatars'), {
  index: false, dotfiles: 'deny', maxAge: '1h'
}));
app.use(express.static(frontendRoot, { index: 'index.html', dotfiles: 'deny' }));

app.use('/api/auth', authRoutes);
app.use('/api/presets', presetRoutes);
app.use('/api/users', userRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);

const staticPages = ['terms.html', 'privacy.html', 'about.html', 'blog.html', 'creator-program.html', 'faq.html', 'contact.html', 'download-guide.html', 'lightroom-guide.html', 'download-app.html'];
for (const page of staticPages) {
  const p = path.join(frontendRoot, page);
  app.get('/' + page, (req, res) => fs.existsSync(p) ? res.sendFile(p) : res.status(404).send('Page not found'));
}
app.get('/admin', (req, res) => res.sendFile(path.join(frontendRoot, 'admin.html')));

function slugify(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset';
}
function escHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function safeJson(obj) { return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026'); }

app.get('/preset/:id/:slug?/', async (req, res, next) => {
  try {
    const db = await getDB();
    const p = db.data.presets.find(x => x.id === req.params.id && x.status === 'approved');
    if (!p) return res.status(404).sendFile(path.join(frontendRoot, 'index.html'));
    const canonical = `${SITE_URL}/preset/${encodeURIComponent(p.id)}/${slugify(p.name)}/`;
    const description = (p.description || `Download ${p.name} Lightroom preset on PresetHub.`).slice(0, 155);
    const preview = p.previewImage ? `${SITE_URL}${p.previewImage}` : `${SITE_URL}/assets/images/og-image.png`;
    const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(p.name)} Lightroom Preset | PresetHub</title>
<meta name="description" content="${escHtml(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="product"><meta property="og:title" content="${escHtml(p.name)} Lightroom Preset"><meta property="og:description" content="${escHtml(description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${escHtml(preview)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escHtml(p.name)} Lightroom Preset"><meta name="twitter:description" content="${escHtml(description)}"><meta name="twitter:image" content="${escHtml(preview)}">
<link rel="manifest" href="/manifest.json"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3554311294133493" crossorigin="anonymous"></script>
<script type="application/ld+json">${safeJson({
      "@context": "https://schema.org", "@type": "Product", "name": p.name, "description": description,
      "image": [preview], "brand": { "@type": "Brand", "name": "PresetHub" },
      "category": "Lightroom Preset", "url": canonical,
      "offers": { "@type": "Offer", "priceCurrency": "INR", "price": String(Number(p.price || 0).toFixed(2)), "availability": "https://schema.org/InStock", "url": canonical },
      ...(Number(p.avgRating || 0) > 0 ? { "aggregateRating": { "@type": "AggregateRating", "ratingValue": Number(p.avgRating).toFixed(1), "ratingCount": Math.max((p.reviews || []).length, 1) } } : {})
    })}</script>
</head><body><main class="container" style="padding-top:40px;padding-bottom:60px">
<a class="logo" href="/">Preset<span>Hub</span></a>
<nav style="margin:24px 0"><a href="/">Home</a> · <a href="/?q=${encodeURIComponent(p.name)}">More presets</a></nav>
<article class="admin-card"><div class="modal-grid">
<div class="modal-preview">${p.previewImage ? `<img src="${escHtml(p.previewImage)}" alt="${escHtml(p.name)} preview" style="width:100%">` : `<div class="preview-fallback large"><i class="fas fa-sliders"></i><span>Preset Preview</span></div>`}</div>
<div class="modal-details"><span class="tag">${escHtml(p.category || 'General')}</span><h1>${escHtml(p.name)}</h1>
<p>Created by <a href="/profile/${encodeURIComponent(p.authorId || '')}/${slugify(p.author)}/">${escHtml(p.author || 'Creator')}</a></p>
<p class="desc">${escHtml(description)}</p><p class="price-lg ${Number(p.price || 0) === 0 ? 'free' : ''}">${Number(p.price || 0) === 0 ? 'Free' : `₹${Number(p.price).toFixed(2)}`}</p>
<p>${Number(p.avgRating || 0).toFixed(1)}★ · ${p.downloads || 0} downloads · ${p.views || 0} views</p>
<div class="actions"><a class="btn btn-primary" href="/">Open PresetHub</a></div>
</div></div></article></main></body></html>`;
    res.type('html').send(html);
  } catch (e) { next(e); }
});

app.get('/profile/:id/:slug?/', async (req, res, next) => {
  try {
    const db = await getDB();
    const u = db.data.users.find(x => x.id === req.params.id);
    if (!u) return res.status(404).sendFile(path.join(frontendRoot, 'index.html'));
    const presets = db.data.presets.filter(p => p.authorId === u.id && p.status === 'approved');
    const canonical = `${SITE_URL}/profile/${encodeURIComponent(u.id)}/${slugify(u.username || u.name)}/`;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(u.name || u.username || 'Creator')} Presets | PresetHub</title>
<meta name="description" content="${escHtml((u.bio || `Discover Lightroom presets by ${u.name || u.username || 'this creator'}.`).slice(0, 155))}">
<link rel="canonical" href="${canonical}"><link rel="manifest" href="/manifest.json"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
<script type="application/ld+json">${safeJson({ "@context": "https://schema.org", "@type": "ProfilePage", "name": u.name || u.username, "url": canonical, "mainEntity": { "@type": "Person", "name": u.name || u.username } })}</script>
</head><body><main class="container" style="padding:40px 0 60px"><a class="logo" href="/">Preset<span>Hub</span></a>
<section class="admin-card" style="margin-top:25px"><div class="profile-head"><div class="profile-avatar">${u.avatar ? `<img src="${escHtml(u.avatar)}" alt="">` : escHtml((u.name || 'U').charAt(0).toUpperCase())}</div><div><h1>${escHtml(u.name || u.username)}</h1><p>@${escHtml(u.username || 'creator')}</p><p>${escHtml(u.bio || '')}</p></div></div>
<div class="profile-stats"><b>${presets.length}<span>Presets</span></b><b>${presets.reduce((s, p) => s + (p.downloads || 0), 0)}<span>Downloads</span></b><b>${u.followers?.length || 0}<span>Followers</span></b></div>
<h2>Published presets</h2><div class="mini-preset-grid">${presets.map(p => `<a class="preset-card" href="/preset/${encodeURIComponent(p.id)}/${slugify(p.name)}/"><div class="thumb">${p.previewImage ? `<img src="${escHtml(p.previewImage)}" alt="${escHtml(p.name)}" style="width:100%;height:100%;object-fit:cover">` : '<div class="preview-fallback"><i class="fas fa-sliders"></i></div>'}</div><div class="info"><h3>${escHtml(p.name)}</h3><div class="price">${Number(p.price || 0) === 0 ? 'Free' : '₹' + Number(p.price).toFixed(2)}</div></div></a>`).join('') || '<p>No published presets yet.</p>'}</div>
</section></main></body></html>`;
    res.type('html').send(html);
  } catch (e) { next(e); }
});

app.get('/sitemap.xml', async (req, res, next) => {
  try {
    const db = await getDB();
    const urls = [
      '/', '/about.html', '/blog.html', '/contact.html', '/faq.html', '/privacy.html', '/terms.html',
      '/creator-program.html', '/download-guide.html', '/lightroom-guide.html', '/download-app.html'
    ];
    for (const p of db.data.presets || []) if (p.status === 'approved') urls.push(`/preset/${encodeURIComponent(p.id)}/${slugify(p.name)}/`);
    const creators = new Set((db.data.presets || []).filter(p => p.status === 'approved').map(p => p.authorId).filter(Boolean));
    for (const id of creators) {
      const u = db.data.users.find(x => x.id === id); if (u) urls.push(`/profile/${encodeURIComponent(id)}/${slugify(u.username || u.name)}/`);
    }
    const body = urls.map(u => `<url><loc>${escHtml(SITE_URL + u)}</loc></url>`).join('');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`);
  } catch (e) { next(e); }
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API endpoint not found' });
  if (req.path.startsWith('/uploads/')) return res.status(404).end();
  if (req.accepts('html')) return res.sendFile(path.join(frontendRoot, 'index.html'));
  return res.status(404).json({ error: 'Not found' });
});

app.use(errorHandler);

(async () => {
  try {
    await getDB();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`PresetHub listening on ${PORT}`);
      console.log(`Site: ${SITE_URL}`);
      console.log(`Admin: ${SITE_URL}/admin`);
      console.log(`Telegram bot: ${process.env.BOT_TOKEN ? 'configured' : 'not configured'}`);
    });
  } catch (err) {
    console.error('Startup failed:', err);
    process.exit(1);
  }
})();

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

module.exports = app;