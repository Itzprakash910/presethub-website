require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const authRoutes = require('./routes/auth');
const presetRoutes = require('./routes/presets');
const userRoutes = require('./routes/users');
const reviewRoutes = require('./routes/reviews');
const paymentRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');
const shareRoutes = require('./routes/share');
const commentRoutes = require('./routes/comments');
const errorHandler = require('./utils/errorHandler');
const { connectDB } = require('./config/db');

const app = express();
const PORT = Number(process.env.PORT || 4000);

// ============ PATH DETECTION ============
let projectRoot = path.join(__dirname, '..');
let frontendRoot = path.join(projectRoot, 'frontend');
if (!fs.existsSync(frontendRoot)) {
  projectRoot = __dirname;
  frontendRoot = path.join(projectRoot, 'frontend');
}
const uploadsRoot = path.join(projectRoot, 'uploads');

const SITE_URL = (process.env.CLIENT_URL || 'https://presethub.site').replace(/\/+$/, '');

// ============ ENV CHECKS ============
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ JWT_SECRET required (32+ chars)');
    process.exit(1);
  }
  console.warn('⚠️  JWT_SECRET short — dev only');
}

const R2_CONFIGURED = !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME && process.env.R2_PUBLIC_URL);
async function normalizePresetPublishing() {
  try {
    const { Preset } = require('./models');
    const result = await Preset.updateMany({ status: 'pending' }, { $set: { status: 'approved' } });
    if (result.modifiedCount) console.log(`✅ Published ${result.modifiedCount} existing pending preset(s) automatically.`);
  } catch (err) { console.warn('⚠️ Preset publish migration skipped:', err.message); }
}

async function ensureAdminUser() {
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) return;
  if (String(process.env.ADMIN_PASSWORD).length < 12) {
    console.warn('⚠️ ADMIN_PASSWORD should be at least 12 characters.');
    return;
  }
  const { User } = require('./models');
  const email = process.env.ADMIN_EMAIL.toLowerCase().trim();
  const existing = await User.findOne({ email });
  if (!existing) {
    const usernameBase = email.split('@')[0].replace(/[^a-z0-9_]/g, '').slice(0, 24) || 'admin';
    let username = usernameBase;
    let n = 1;
    while (await User.exists({ username })) username = `${usernameBase}${n++}`;
    const password = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
    await User.create({ email, password, name: 'PresetHub Admin', username, role: 'admin', verified: true });
    console.log('✅ Admin account initialized.');
  } else if (existing.role !== 'admin') {
    existing.role = 'admin';
    existing.verified = true;
    await existing.save();
    console.log('✅ Existing admin email promoted to admin role.');
  }
}


// ============ ENSURE FOLDERS ============
function ensureStructure() {
  const dirs = [
    uploadsRoot,
    path.join(uploadsRoot, 'previews'),
    path.join(uploadsRoot, 'avatars'),
    path.join(projectRoot, 'backups')
  ];
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.warn(`⚠️  Cannot create ${dir}:`, err.message);
    }
  }

  const required = {
    'robots.txt': `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nSitemap: ${SITE_URL}/sitemap.xml\n`,
    'ads.txt': `google.com, ${(process.env.ADSENSE_CLIENT || 'ca-pub-3554311294133493').replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`,
    'security.txt': `Contact: ${SITE_URL}/contact.html\nPolicy: ${SITE_URL}/privacy.html\nExpires: 2030-01-01T00:00:00Z\n`,
    'manifest.json': JSON.stringify({name:'PresetHub – Lightroom Presets Marketplace',short_name:'PresetHub',start_url:'/',scope:'/',display:'standalone',theme_color:'#d4a373',background_color:'#f8f6f2',icons:[{src:'/assets/images/presethub-logo-1.jpg',sizes:'1536x1536',type:'image/jpeg',purpose:'any maskable'}]}, null, 2)
  };
  for (const [name, content] of Object.entries(required)) {
    const file = path.join(frontendRoot, name);
    try {
      if (!fs.existsSync(file)) fs.writeFileSync(file, content);
    } catch (err) {
      console.warn(`⚠️  Cannot write ${file}:`, err.message);
    }
  }

  const essentialPages = ['privacy.html','terms.html','about.html','faq.html','contact.html','blog.html','creator-program.html','download-guide.html','lightroom-guide.html','download-app.html'];
  for (const name of essentialPages) {
    const file = path.join(frontendRoot, name);
    try {
      if (!fs.existsSync(file)) {
        const title = name.replace('.html','').replace(/-/g, ' ');
        fs.writeFileSync(file, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | PresetHub</title><meta name="robots" content="index,follow"><link rel="stylesheet" href="/style.css"></head><body><main class="container" style="padding:40px 0"><a class="logo" href="/"><img class="brand-logo" src="/assets/images/presethub-logo-1.jpg" alt="PresetHub logo">Preset<span>Hub</span></a><h1>${title}</h1><p>PresetHub information page.</p></main></body></html>`);
      }
    } catch (err) { console.warn(`⚠️ Cannot create ${file}:`, err.message); }
  }
}

try { ensureStructure(); } catch (err) { console.error('ensureStructure error:', err); }

// ============ APP CONFIG ============
app.disable('x-powered-by');
app.set('trust proxy', 1);

const allowedOrigins = new Set(
  [process.env.CLIENT_URL, SITE_URL, 'https://www.presethub.site']
    .filter(Boolean)
    .map(x => x.replace(/\/+$/, ''))
);

// ============ SECURITY (Helmet) ============
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "https://pagead2.googlesyndication.com",
        "https://checkout.razorpay.com",
        "https://googleads.g.doubleclick.net"
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com",
        "https://cdnjs.cloudflare.com"
      ],
      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com",
        "https://cdnjs.cloudflare.com"
      ],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: [
        "'self'",
        "https://api.razorpay.com",
        "https://pagead2.googlesyndication.com",
        "https://*.google.com",
        "https://*.googlesyndication.com",
        "https://*.doubleclick.net",
        "https://*.r2.cloudflarestorage.com",
        process.env.R2_PUBLIC_URL || ''
      ].filter(Boolean),
      frameSrc: [
        "'self'",
        "https://api.razorpay.com",
        "https://checkout.razorpay.com",
        "https://googleads.g.doubleclick.net",
        "https://*.google.com"
      ],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// ============ CORS ============
app.use(cors({
  origin(origin, cb) {
    if (!origin || process.env.NODE_ENV !== 'production') return cb(null, true);
    cb(null, allowedOrigins.has(origin.replace(/\/+$/, '')));
  },
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ============ MIDDLEWARE ============
app.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

app.use(cookieParser());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ============ RATE LIMITING ============
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again later.' }
});
app.use('/api/', apiLimiter);
app.use('/api/auth', authLimiter);

// ============ BODY PARSERS ============
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ============ STATIC FILES ============
// Local uploads (used when R2 not configured)
app.use('/uploads', express.static(uploadsRoot, {
  index: false,
  dotfiles: 'deny',
  maxAge: '1h',
  fallthrough: true
}));

// Frontend static files
app.use(express.static(frontendRoot, {
  index: 'index.html',
  dotfiles: 'deny'
}));

// ============ HEALTH ============
app.get('/healthz', (req, res) => res.json({ ok: true, service: 'presethub', database: require('mongoose').connection.readyState === 1 ? 'connected' : 'disconnected', time: new Date().toISOString() }));

// ============ API ROUTES ============
app.use('/api/auth', authRoutes);
app.use('/api/presets', presetRoutes);
app.use('/api/users', userRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/share', shareRoutes);
app.use('/api/comments', commentRoutes);

// ============ STATIC PAGES ============
const staticPages = [
  'terms.html', 'privacy.html', 'about.html', 'blog.html',
  'creator-program.html', 'faq.html', 'contact.html',
  'download-guide.html', 'lightroom-guide.html', 'download-app.html'
];
for (const page of staticPages) {
  const p = path.join(frontendRoot, page);
  app.get('/' + page, (req, res) =>
    fs.existsSync(p) ? res.sendFile(p) : res.status(404).send('Page not found')
  );
}

app.get('/admin', (req, res) => {
  const adminPage = path.join(frontendRoot, 'admin.html');
  if (fs.existsSync(adminPage)) return res.sendFile(adminPage);
  res.status(404).send('Admin page not found');
});

// ============ HELPERS ============
function slugify(value) {
  return String(value || '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'preset';
}
function escHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function adsenseHead() {
  const client = process.env.ADSENSE_CLIENT || 'ca-pub-3554311294133493';
  return `<meta name="google-adsense-account" content="${escHtml(client)}"><script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}" crossorigin="anonymous"></script>`;
}

function safeJson(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
function indexFallback(res) {
  const indexPath = path.join(frontendRoot, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  return res.status(200).type('html').send(
    '<!doctype html><html><body><h1>PresetHub</h1><p>API is running. Frontend not deployed.</p></body></html>'
  );
}

// ============ SHORT LINK REDIRECT ============
app.get('/s/:code', async (req, res, next) => {
  try {
    const { ShortLink, Preset, ShareClick } = require('./models');
    const link = await ShortLink.findOne({ code: req.params.code });
    if (!link) return indexFallback(res);

    link.clicks = (link.clicks || 0) + 1;
    link.lastClickAt = new Date();
    await link.save();

    await ShareClick.create({
      code: link.code,
      presetId: link.presetId,
      userId: link.userId,
      ip: req.ip,
      userAgent: (req.headers['user-agent'] || '').slice(0, 200)
    });

    const preset = await Preset.findById(link.presetId);
    if (!preset) return indexFallback(res);

    res.cookie('ph_ref', link.code, {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: false,
      sameSite: 'lax'
    });

    return res.redirect(302, `/preset/${preset._id}/${slugify(preset.name)}/?ref=${link.code}`);
  } catch (e) { next(e); }
});

// ============ SEO PRESET PAGE ============
app.get('/preset/:id/:slug?/', async (req, res, next) => {
  try {
    const { Preset } = require('./models');
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return indexFallback(res);

    const p = await Preset.findOne({ _id: req.params.id, status: 'approved' }).lean();
    if (!p) return indexFallback(res);

    const canonical = `${SITE_URL}/preset/${p._id}/${slugify(p.name)}/`;
    const description = (p.description || `Download ${p.name} Lightroom preset on PresetHub.`).slice(0, 155);
    const keywords = [...new Set([p.name, 'Lightroom preset', 'XMP preset', 'DNG preset', p.category || 'photo preset', ...(p.tags || [])])].slice(0, 20).join(', ');
    const preview = p.previewImage
      ? (p.previewImage.startsWith('http') ? p.previewImage : `${SITE_URL}${p.previewImage}`)
      : `${SITE_URL}/assets/images/og-image.png`;

    const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${adsenseHead()}
<title>${escHtml(p.name)} Lightroom Preset | PresetHub</title>
<meta name="description" content="${escHtml(description)}">
<meta name="keywords" content="${escHtml(keywords)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="product">
<meta property="og:title" content="${escHtml(p.name)} Lightroom Preset">
<meta property="og:description" content="${escHtml(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${escHtml(preview)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escHtml(p.name)}">
<meta name="twitter:description" content="${escHtml(description)}">
<meta name="twitter:image" content="${escHtml(preview)}">
<link rel="manifest" href="/manifest.json">
<link rel="stylesheet" href="/style.css">
<script type="application/ld+json">${safeJson({
      "@context": "https://schema.org", "@type": "Product",
      "name": p.name, "description": description,
      "image": [preview], "brand": { "@type": "Brand", "name": "PresetHub" },
      "category": "Lightroom Preset", "url": canonical,
      "offers": {
        "@type": "Offer", "priceCurrency": "INR",
        "price": String(Number(p.price || 0).toFixed(2)),
        "availability": "https://schema.org/InStock", "url": canonical
      },
      ...(Number(p.avgRating || 0) > 0 ? {
        "aggregateRating": {
          "@type": "AggregateRating",
          "ratingValue": Number(p.avgRating).toFixed(1),
          "ratingCount": Math.max((p.reviews || []).length, 1)
        }
      } : {})
    })}</script>
</head><body><main class="container" style="padding:40px 0 60px">
<a class="logo" href="/"><img class="brand-logo" src="/assets/images/presethub-logo-1.jpg" alt="PresetHub logo">Preset<span>Hub</span></a>
<article class="admin-card" style="margin-top:25px"><div class="modal-grid">
<div class="modal-preview">${preview ? `<img src="${escHtml(preview)}" alt="${escHtml(p.name)}" style="width:100%">` : ''}</div>
<div class="modal-details">
<span class="tag">${escHtml(p.category || 'General')}</span>
<h1>${escHtml(p.name)}</h1>
<p>By ${escHtml(p.author || 'Creator')}</p>
<p class="desc">${escHtml(description)}</p>
<p class="price-lg ${Number(p.price || 0) === 0 ? 'free' : ''}">
${Number(p.price || 0) === 0 ? 'Free' : `₹${Number(p.price).toFixed(2)}`}
</p>
<div class="actions"><a class="btn btn-primary" href="/">Open PresetHub</a></div>
</div></div></article></main></body></html>`;

    res.type('html').send(html);
  } catch (e) { next(e); }
});

// ============ SEO PROFILE PAGE ============
app.get('/profile/:id/:slug?/', async (req, res, next) => {
  try {
    const { User, Preset } = require('./models');
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return indexFallback(res);

    const u = await User.findById(req.params.id).lean();
    if (!u) return indexFallback(res);

    const presets = await Preset.find({ authorId: u._id, status: 'approved' }).lean();
    const canonical = `${SITE_URL}/profile/${u._id}/${slugify(u.username || u.name)}/`;

    const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${adsenseHead()}
<title>${escHtml(u.name || u.username)} Presets | PresetHub</title>
<meta name="description" content="${escHtml((u.bio || `Presets by ${u.name || u.username}`).slice(0, 155))}">
<link rel="canonical" href="${canonical}">
<link rel="stylesheet" href="/style.css">
<script type="application/ld+json">${safeJson({
      "@context": "https://schema.org", "@type": "ProfilePage",
      "name": u.name || u.username, "url": canonical,
      "mainEntity": { "@type": "Person", "name": u.name || u.username }
    })}</script>
</head><body><main class="container" style="padding:40px 0 60px">
<a class="logo" href="/"><img class="brand-logo" src="/assets/images/presethub-logo-1.jpg" alt="PresetHub logo">Preset<span>Hub</span></a>
<section class="admin-card" style="margin-top:25px">
<div class="profile-head">
<div class="profile-avatar">${u.avatar ? `<img src="${escHtml(u.avatar)}" alt="">` : escHtml((u.name || 'U').charAt(0).toUpperCase())}</div>
<div>
<h1>${escHtml(u.name || u.username)}</h1>
<p>@${escHtml(u.username || 'creator')}</p>
<p>${escHtml(u.bio || '')}</p>
</div></div>
<h2>Published presets (${presets.length})</h2>
<div class="mini-preset-grid">
${presets.map(p => `<a class="preset-card" href="/preset/${p._id}/${slugify(p.name)}/">
<div class="thumb">${p.previewImage ? `<img src="${escHtml(p.previewImage)}" alt="${escHtml(p.name)}" style="width:100%;height:100%;object-fit:cover">` : ''}</div>
<div class="info"><h3>${escHtml(p.name)}</h3></div></a>`).join('') || '<p>No presets yet.</p>'}
</div></section></main></body></html>`;

    res.type('html').send(html);
  } catch (e) { next(e); }
});

// ============ SITEMAP ============
app.get('/sitemap.xml', async (req, res, next) => {
  try {
    const { Preset, User } = require('./models');
    const urls = [
      '/', '/about.html', '/blog.html', '/contact.html', '/faq.html',
      '/privacy.html', '/terms.html', '/creator-program.html',
      '/download-guide.html', '/lightroom-guide.html', '/download-app.html'
    ];

    const presets = await Preset.find({ status: 'approved' }).select('_id name previewImage updatedAt').lean();
    for (const p of presets) {
      urls.push({ loc: `/preset/${p._id}/${slugify(p.name)}/`, lastmod: p.updatedAt, image: p.previewImage });
    }

    const creators = await User.find({}).select('_id username name').lean();
    for (const u of creators) {
      urls.push({ loc: `/profile/${u._id}/${slugify(u.username || u.name)}/` });
    }

    const body = urls.map(u => {
      const item = typeof u === 'string' ? { loc: u } : u;
      const image = item.image ? (String(item.image).startsWith('http') ? item.image : SITE_URL + item.image) : null;
      return `<url><loc>${escHtml(SITE_URL + item.loc)}</loc>${item.lastmod ? `<lastmod>${new Date(item.lastmod).toISOString()}</lastmod>` : ''}${image ? `<image:image><image:loc>${escHtml(image)}</image:loc></image:image>` : ''}</url>`;
    }).join('');

    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${body}</urlset>`
    );
  } catch (e) { next(e); }
});

// ============ 404 FALLBACK ============
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  // Note: /uploads handled by static middleware; if reaches here, file not found
  if (req.path.startsWith('/uploads/')) {
    return res.status(404).end();
  }
  if (req.accepts('html')) return indexFallback(res);
  return res.status(404).json({ error: 'Not found' });
});

// ============ ERROR HANDLER ============
app.use(errorHandler);

// ============ STARTUP ============
(async () => {
  try {
    await connectDB();
    await normalizePresetPublishing();
    await ensureAdminUser();
    app.listen(PORT, '0.0.0.0', () => {
      console.log('');
      console.log('═══════════════════════════════════════');
      console.log(`🚀 PresetHub listening on port ${PORT}`);
      console.log(`🌐 Site: ${SITE_URL}`);
      console.log(`📁 Uploads: ${uploadsRoot}`);
      console.log(`☁️  Storage: ${R2_CONFIGURED ? 'Cloudflare R2' : 'Local (files in uploads/)'}`);
      console.log(`🤖 Telegram bot: ${process.env.BOT_TOKEN ? 'configured' : 'not configured'}`);
      console.log(`🍃 Database: ${process.env.MONGODB_URI ? 'MongoDB' : 'not configured'}`);
      console.log('═══════════════════════════════════════');
      console.log('');
    });
  } catch (err) {
    console.error('❌ Startup failed:', err);
    process.exit(1);
  }
})();

// ============ GRACEFUL SHUTDOWN ============
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

module.exports = app;