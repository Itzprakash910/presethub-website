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
const chatRoutes = require('./routes/chat');
const errorHandler = require('./utils/errorHandler');
const { connectDB } = require('./config/db');
const { startBot, stopBot, getBotStatus } = require('./bot');

const app = express();
const PORT = Number(process.env.PORT || 4000);

// ============ PATH DETECTION ============
let projectRoot = path.join(__dirname, '..');
let frontendRoot = path.join(projectRoot, 'frontend');
if (!fs.existsSync(frontendRoot)) {
  projectRoot = __dirname;
  frontendRoot = path.join(projectRoot, 'frontend');
}
const uploadsRoot = path.join(process.env.DATA_DIR || path.join(projectRoot, 'uploads'), 'uploads');

const SITE_URL = (process.env.CLIENT_URL || 'https://presethub.site').replace(/\/+$/, '');
const SITE_CREATOR = 'Omprakash (HeyOmii)';
const SITE_SOCIAL = 'https://www.instagram.com/heyomii_____08?stkn=cHQ5M3B4NzY0aGZn';
const FONT_AWESOME_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';

// ============ ENV CHECKS ============
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ JWT_SECRET required (32+ chars)');
    process.exit(1);
  }
  console.warn('⚠️  JWT_SECRET short — dev only');
}

const R2_CONFIGURED = !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME && process.env.R2_PUBLIC_URL);
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

async function autoPublishLegacyPresets_DISABLED() {
  try {
    const { Preset } = require('./models');
    const result = await Preset.updateMany(
      { status: 'pending' },
      { $set: { status: 'approved' } }
    );
    if (result.modifiedCount) console.log(`✅ Auto-published ${result.modifiedCount} legacy preset(s).`);
  } catch (err) {
    console.warn('⚠️ Legacy preset auto-publish skipped:', err.message);
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
    'manifest.json': JSON.stringify({name:'PresetHub – Free & Premium Lightroom Presets Marketplace',short_name:'PresetHub',description:'Discover, preview, download and sell free and premium Lightroom presets by creators on PresetHub.',id:'/',start_url:'/',scope:'/',display:'standalone',theme_color:'#d4a373',background_color:'#f8f6f2',lang:'en-IN',dir:'ltr',icons:[{src:'/assets/icons/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any maskable'},{src:'/assets/icons/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'}]}, null, 2)
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
        "https://cdnjs.cloudflare.com",
        "https://use.fontawesome.com"
      ],
      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com",
        "https://cdnjs.cloudflare.com",
        "https://use.fontawesome.com"
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
    if (!origin) return cb(null, true);
    if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_CORS === 'true') return cb(null, true);
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

// ============ MONGODB GRIDFS MEDIA ============
// Uploaded presets, posters and profile images are stored in MongoDB GridFS
// when Cloudflare R2 is not configured. The media route exposes only an
// opaque GridFS ObjectId, never a filesystem path or directory listing.
app.get('/media/:id', async (req, res, next) => {
  try {
    const mongoose = require('mongoose');
    const { ObjectId, GridFSBucket } = mongoose.mongo;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
    const db = mongoose.connection.db;
    if (!db) return res.status(503).json({ error: 'Database unavailable' });
    const bucket = new GridFSBucket(db, { bucketName: 'presethub_media' });
    const id = new ObjectId(req.params.id);
    const files = await db.collection('presethub_media.files').find({ _id: id }).limit(1).toArray();
    if (!files.length) return res.status(404).end();
    const meta = files[0];
    res.setHeader('Content-Type', meta.contentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.query.download === '1') {
      const filename = String(meta.filename || 'download').replace(/[\r\n\"\\]/g, '_');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }
    bucket.openDownloadStream(id).on('error', next).pipe(res);
  } catch (err) { next(err); }
});

// ============ STATIC FILES ============
// Do not expose server filesystem uploads. New user media is served only through
// the authenticated application's opaque MongoDB GridFS media URLs.
// Legacy/demo media: only public preview/avatar folders are exposed. Preset files remain blocked.
const legacyUploadRoot = path.join(projectRoot, 'uploads');
app.use('/uploads/previews', express.static(path.join(legacyUploadRoot, 'previews'), { dotfiles: 'deny', immutable: true, maxAge: '7d' }));
app.use('/uploads/avatars', express.static(path.join(legacyUploadRoot, 'avatars'), { dotfiles: 'deny', immutable: true, maxAge: '7d' }));
app.use('/uploads', (req, res) => res.status(404).end());

// Frontend static files
app.use(express.static(frontendRoot, {
  index: 'index.html',
  dotfiles: 'deny'
}));

// ============ HEALTH CHECK ============
app.get('/health', (req, res) => res.status(200).json({ ok: true, service: 'presethub', database: require('mongoose').connection.readyState === 1 ? 'connected' : 'disconnected', time: new Date().toISOString() }));
app.get('/healthz', (req, res) => res.status(200).json({ ok: true, service: 'presethub', database: require('mongoose').connection.readyState === 1 ? 'connected' : 'disconnected', bot: getBotStatus(), time: new Date().toISOString() }));
app.get('/api/bot/status', require('./middleware/auth').authenticate, require('./middleware/auth').isAdmin, (req, res) =>
  res.json({ ...getBotStatus(), time: new Date().toISOString() })
);

// ============ API ROUTES ============
app.use('/api/auth', authRoutes);
app.use('/api/presets', presetRoutes);
app.use('/api/users', userRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/share', shareRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/chat', chatRoutes);

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
function commonSeoHead({ title, description, canonical, image = `${SITE_URL}/assets/images/og-image.png`, type = 'website', keywords = '' }) {
  const safeTitle = escHtml(title);
  const safeDescription = escHtml(String(description || '').slice(0, 160));
  const safeCanonical = escHtml(canonical);
  const safeImage = escHtml(image);
  const safeKeywords = escHtml(keywords);
  return `<meta name="description" content="${safeDescription}"><meta name="keywords" content="${safeKeywords}"><meta name="author" content="${SITE_CREATOR}"><meta name="creator" content="${SITE_CREATOR}"><meta name="publisher" content="PresetHub"><meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1"><meta name="referrer" content="strict-origin-when-cross-origin"><meta name="theme-color" content="#d4a373"><meta name="application-name" content="PresetHub"><meta property="og:site_name" content="PresetHub"><meta property="og:type" content="${escHtml(type)}"><meta property="og:locale" content="en_IN"><meta property="og:title" content="${safeTitle}"><meta property="og:description" content="${safeDescription}"><meta property="og:url" content="${safeCanonical}"><meta property="og:image" content="${safeImage}"><meta property="og:image:secure_url" content="${safeImage}"><meta property="og:image:type" content="image/png"><meta property="og:image:alt" content="PresetHub preview"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${safeTitle}"><meta name="twitter:description" content="${safeDescription}"><meta name="twitter:image" content="${safeImage}"><link rel="canonical" href="${safeCanonical}"><link rel="icon" href="/assets/icons/favicon.ico" type="image/x-icon"><link rel="icon" href="/assets/icons/icon-192.png" sizes="192x192" type="image/png"><link rel="apple-touch-icon" href="/assets/icons/icon-192.png"><link rel="preconnect" href="https://cdnjs.cloudflare.com" crossorigin><link rel="preload" href="${FONT_AWESOME_CSS}" as="style" crossorigin><link rel="stylesheet" href="${FONT_AWESOME_CSS}" onerror="this.onerror=null;this.href='https://use.fontawesome.com/releases/v6.5.1/css/all.css'"><link rel="stylesheet"  href="/style.css"><link rel="me" href="${SITE_SOCIAL}">`;
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
    await ShareClick.create({ code: link.code, presetId: link.presetId, userId: link.userId, ip: req.ip, userAgent: (req.headers['user-agent'] || '').slice(0, 200) });
    const preset = await Preset.findById(link.presetId).lean();
    if (!preset) return indexFallback(res);
    const canonical = `${SITE_URL}/preset/${preset._id}/${slugify(preset.name)}/`;
    const preview = seoAssetUrl(preset.previewImage);
    const description = String(preset.description || `Download ${preset.name} Lightroom preset on PresetHub.`).slice(0,155);
    const title = `${preset.name} Lightroom Preset | PresetHub`;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${adsenseHead()}${commonSeoHead({title,description,canonical,image:preview,type:'article',keywords:[preset.name,preset.category,...(preset.tags||[]),'Lightroom preset','PresetHub'].join(', ')})}<meta http-equiv="refresh" content="2;url=${escHtml(canonical)}"><script>setTimeout(()=>location.replace(${JSON.stringify(canonical)}),150);</script></head><body><main class="seo-page"><div class="container seo-shell"><section class="seo-hero"><div class="seo-hero-image"><img src="${escHtml(preview)}" alt="${escHtml(preset.name)} preview"></div><div class="seo-copy"><span class="eyebrow">PRESETHUB</span><h1>${escHtml(preset.name)}</h1><p>${escHtml(description)}</p><a class="btn btn-primary" href="${escHtml(canonical)}">Open preset</a></div></section></div></main></body></html>`;
    res.type('html').send(html);
  } catch (e) { next(e); }
});

function seoAssetUrl(value) {
  const v = String(value || '').trim();
  if (!v) return `${SITE_URL}/assets/images/og-image.png`;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith('/')) return `${SITE_URL}${v}`;
  if (v.startsWith('uploads/')) return `${SITE_URL}/${v}`;
  if (v.startsWith('/media/')) return `${SITE_URL}${v}`;
  if (v.startsWith('media/')) return `${SITE_URL}/${v}`;
  if (/^(previews|presets|avatars)\//i.test(v)) return `${SITE_URL}/uploads/${v}`;
  return `${SITE_URL}/assets/images/og-image.png`;
}

// ============ SEO PRESET PAGE ============
app.get('/preset/:id/:slug?/', async (req, res, next) => {
  try {
    const { Preset, User, Comment } = require('./models');
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return indexFallback(res);
    const p = await Preset.findOne({ _id: req.params.id, status: 'approved' }).lean();
    if (!p) return indexFallback(res);
    const author = await User.findById(p.authorId).select('username name avatar').lean();
    const canonical = `${SITE_URL}/preset/${p._id}/${slugify(p.name)}/`;
    const description = (p.description || `Download ${p.name} Lightroom preset on PresetHub.`).slice(0, 155);
    const keywords = [...new Set([p.name, `${p.name} Lightroom preset`, 'Lightroom preset', 'free Lightroom preset', 'XMP preset', 'DNG preset', 'mobile Lightroom preset', p.category || 'photo preset', ...(p.tags || [])])].slice(0, 30).join(', ');
    const preview = seoAssetUrl(p.previewImage);
    const price = Number(p.price || 0);
    const related = await Preset.find({ status:'approved', category:p.category, _id:{ $ne:p._id } }).sort({ downloads:-1 }).limit(6).select('_id name previewImage category author price').lean();
    const commentsCount = await Comment.countDocuments({ presetId: p._id });
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${adsenseHead()}<title>${escHtml(p.name)} Lightroom Preset — ${escHtml(p.category || 'Photo Preset')} | PresetHub</title>
${commonSeoHead({ title: `${p.name} Lightroom Preset | PresetHub`, description, canonical, image: preview, type: 'article', keywords })}
<script type="application/ld+json">${safeJson({"@context":"https://schema.org","@type":"Product","name":p.name,"description":description,"image":[preview],"url":canonical,"brand":{"@type":"Brand","name":"PresetHub"},"creator":{"@type":"Organization","name":"PresetHub","url":"https://presethub.site/","sameAs":["https://www.instagram.com/heyomii_____08?stkn=cHQ5M3B4NzY0aGZn"]},"category":p.category || 'Lightroom Preset',"offers":{"@type":"Offer","priceCurrency":"INR","price":price.toFixed(2),"availability":"https://schema.org/InStock","url":canonical},...(Number(p.avgRating||0)>0?{"aggregateRating":{"@type":"AggregateRating","ratingValue":Number(p.avgRating).toFixed(1),"ratingCount":Math.max((p.reviews||[]).length,1)}}:{})})}</script>
</head><body><main class="seo-page"><div class="container seo-shell"><a class="logo" href="/"><img class="brand-logo" src="/assets/images/presethub-logo-1.jpg" alt="PresetHub logo">Preset<span>Hub</span></a><div class="seo-breadcrumbs"><a href="/">Home</a><span>/</span><a href="/?q=${encodeURIComponent(p.category || 'Lightroom preset')}">${escHtml(p.category || 'Presets')}</a><span>/</span><span>${escHtml(p.name)}</span></div>
<section class="seo-hero"><div class="seo-hero-image"><img src="${escHtml(preview)}" alt="${escHtml(p.name)} Lightroom preset preview" onerror="this.onerror=null;this.src='/assets/images/og-image.png'"></div><div class="seo-copy"><span class="eyebrow">${escHtml(p.category || 'LIGHTROOM PRESET')}</span><h1>${escHtml(p.name)}</h1><p class="author">By ${escHtml(p.author || 'Creator')}</p><p class="desc">${escHtml(description)}</p><div class="seo-price ${price===0?'free':''}">${price===0?'Free':`₹${price.toFixed(2)}`}</div><div class="seo-tags">${(p.tags||[]).slice(0,10).map(t=>`<span>${escHtml(t)}</span>`).join('')}</div><div class="seo-actions"><a class="btn btn-primary" href="/"><i class="fas fa-download"></i> Open &amp; Download</a><a class="btn btn-outline" href="#details"><i class="fas fa-circle-info"></i> Show Details</a><a class="btn btn-outline" href="/profile/${p.authorId}/${slugify(author?.username || author?.name || p.author)}/"><i class="fas fa-user"></i> Creator</a></div></div></section>
<div class="seo-info-grid"><div class="seo-info-card"><b>${Number(p.downloads||0)}</b><span>Downloads</span></div><div class="seo-info-card"><b>${Number(p.views||0)}</b><span>Views</span></div><div class="seo-info-card"><b>${Number(p.avgRating||0).toFixed(1)}</b><span>Rating</span></div><div class="seo-info-card"><b>${Number((p.likes||[]).length)}</b><span>Likes</span></div><div class="seo-info-card"><b>${Number(commentsCount)}</b><span>Comments</span></div><div class="seo-info-card"><b>${Number(p.shares||0)}</b><span>Shares</span></div></div><section id="details" class="seo-details"><h2>Preset Details</h2><p>${escHtml(p.description || 'A Lightroom preset published on PresetHub.')}</p><div class="seo-tags">${(p.tags||[]).slice(0,10).map(t=>`<span>#${escHtml(t)}</span>`).join('')}</div></section>
<section class="seo-related"><div class="profile-section-head"><h2>More ${escHtml(p.category || 'Lightroom')} Presets</h2><a class="btn btn-outline btn-sm" href="/?q=${encodeURIComponent(p.category || '')}">View all</a></div><div class="seo-related-grid">${related.map(r=>`<a class="seo-related-card" href="/preset/${r._id}/${slugify(r.name)}/"><img src="${escHtml(seoAssetUrl(r.previewImage))}" alt="${escHtml(r.name)} preview" onerror="this.onerror=null;this.src='/assets/images/og-image.png'"><div><h3>${escHtml(r.name)}</h3><p>${escHtml(r.author||'Creator')} · ${Number(r.price||0)===0?'Free':`₹${Number(r.price).toFixed(2)}`}</p></div></a>`).join('') || '<p>No related presets yet.</p>'}</div></section>
<footer style="margin-top:34px"><div class="footer-bottom" style="border-top:0"><span>© PresetHub</span><span>Website by <a href="${SITE_SOCIAL}" target="_blank" rel="me noopener noreferrer">${SITE_CREATOR}</a></span><span><a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a> · <a href="/about.html">About</a></span></div></footer></div></main></body></html>`;
    res.type('html').send(html);
  } catch (e) { next(e); }
});

// ============ SEO PROFILE PAGE ============
app.get('/profile/:id/:slug?/', async (req, res, next) => {
  try {
    const { User, Preset } = require('./models'); const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return indexFallback(res);
    const u = await User.findById(req.params.id).lean(); if (!u) return indexFallback(res);
    const presets = await Preset.find({ authorId:u._id, status:'approved' }).sort({createdAt:-1}).lean();
    const canonical = `${SITE_URL}/profile/${u._id}/${slugify(u.username || u.name)}/`;
    const avatar = seoAssetUrl(u.avatar); const description=(u.bio || `Lightroom presets by ${u.name || u.username} on PresetHub.`).slice(0,155);
    const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${adsenseHead()}<title>${escHtml(u.name||u.username)} Presets &amp; Lightroom Presets | PresetHub</title>${commonSeoHead({ title: `${u.name||u.username} Presets | PresetHub`, description, canonical, image: avatar, type: 'profile', keywords: `${u.name||u.username}, Lightroom presets, preset creator, ${SITE_CREATOR}, PresetHub` })}<script type="application/ld+json">${safeJson({"@context":"https://schema.org","@type":"ProfilePage","name":u.name||u.username,"url":canonical,"mainEntity":{"@type":"Person","name":u.name||u.username,"image":avatar,"sameAs":(u.socialLinks && Object.values(u.socialLinks).filter(Boolean).slice(0,4)) || []}})}</script></head><body><main class="seo-page"><div class="container seo-shell"><a class="logo" href="/"><img class="brand-logo" src="/assets/images/presethub-logo-1.jpg" alt="PresetHub logo">Preset<span>Hub</span></a><section class="seo-hero"><div class="seo-hero-image"><img src="${escHtml(avatar)}" alt="${escHtml(u.name||'Creator')} profile" onerror="this.onerror=null;this.src='/assets/images/og-image.png'"></div><div class="seo-copy"><span class="eyebrow">CREATOR PROFILE</span><h1>${escHtml(u.name||u.username)}</h1><p class="author">@${escHtml(u.username||'creator')}</p><p class="desc">${escHtml(description)}</p><div class="seo-info-grid" style="margin:12px 0"><div class="seo-info-card"><b>${presets.length}</b><span>Presets</span></div><div class="seo-info-card"><b>${presets.reduce((a,p)=>a+Number(p.downloads||0),0)}</b><span>Downloads</span></div></div><a class="btn btn-primary" href="/"><i class="fas fa-arrow-left"></i> Open PresetHub</a></div></section><section class="seo-related"><div class="profile-section-head"><h2>Published Presets</h2><span>${presets.length} presets</span></div><div class="seo-related-grid">${presets.map(p=>`<a class="seo-related-card" href="/preset/${p._id}/${slugify(p.name)}/"><img src="${escHtml(seoAssetUrl(p.previewImage))}" alt="${escHtml(p.name)} preview" onerror="this.onerror=null;this.src='/assets/images/og-image.png'"><div><h3>${escHtml(p.name)}</h3><p>${escHtml(p.category||'General')} · ${Number(p.price||0)===0?'Free':`₹${Number(p.price).toFixed(2)}`}</p></div></a>`).join('') || '<p>No published presets yet.</p>'}</div></section><footer style="margin-top:34px"><div class="footer-bottom" style="border-top:0"><span>© PresetHub</span><span>Website by <a href="${SITE_SOCIAL}" target="_blank" rel="me noopener noreferrer">${SITE_CREATOR}</a></span><span><a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a> · <a href="/about.html">About</a></span></div></footer></div></main></body></html>`;
    res.type('html').send(html);
  } catch(e){ next(e); }
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
      return `<url><loc>${escHtml(SITE_URL + item.loc)}</loc>${item.lastmod ? `<lastmod>${new Date(item.lastmod).toISOString()}</lastmod>` : ''}${image ? `<image:image xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><image:loc>${escHtml(image)}</image:loc></image:image>` : ''}</url>`;
    }).join('');

    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`
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
    await ensureAdminUser();
    if (process.env.AUTO_PUBLISH_LEGACY === 'true') await autoPublishLegacyPresets_DISABLED();
    app.listen(PORT, '0.0.0.0', async () => {
      console.log('');
      console.log('═══════════════════════════════════════');
      console.log(`🚀 PresetHub listening on port ${PORT}`);
      console.log(`🌐 Site: ${SITE_URL}`);
      console.log(`📁 Uploads: ${uploadsRoot}`);
      console.log(`☁️  Storage: ${R2_CONFIGURED ? 'Cloudflare R2' : 'Local (files in uploads/)'}`);
      console.log(`🤖 Telegram bot: ${process.env.BOT_TOKEN ? 'configured' : 'not configured'}`);
      if (process.env.BOT_TOKEN) {
        const bootTelegram = async () => {
          const ok = await startBot();
          if (!ok) setTimeout(bootTelegram, 15000);
        };
        bootTelegram().catch(err => console.error('Telegram bot startup failed:', err.message));
      }
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
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await stopBot('SIGTERM');
  process.exit(0);
});
process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  await stopBot('SIGINT');
  process.exit(0);
});

module.exports = app;