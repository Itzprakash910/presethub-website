require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be set to a strong 32+ character secret in production.');
}
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = require('crypto').randomBytes(48).toString('hex');
}

const path = require('path');

// ============================================================
// ===== DEPENDENCIES =====
// ============================================================
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

// ============================================================
// ===== ROUTES =====
// ============================================================
const authRoutes = require('./routes/auth');
const presetRoutes = require('./routes/presets');
const userRoutes = require('./routes/users');
const reviewRoutes = require('./routes/reviews');
const paymentRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');
const errorHandler = require('./utils/errorHandler');

// ============================================================
// ===== APP INITIALIZATION =====
// ============================================================
const app = express();
const PORT = process.env.PORT || 4000;
const projectRoot = path.join(__dirname, '..');

// ============================================================
// ===== AUTO-CREATE MISSING FOLDERS & FILES =====
// ============================================================
function ensureDirectoriesAndFiles() {
  console.log('🔧 Checking project structure...');
  
  // 1. Create directories
  const dirs = [
    path.join(projectRoot, 'uploads'),
    path.join(projectRoot, 'uploads/previews'),
    path.join(projectRoot, 'uploads/avatars'),
    path.join(projectRoot, 'backups'),
    path.join(projectRoot, 'frontend/assets'),
    path.join(projectRoot, 'frontend/assets/icons'),
    path.join(projectRoot, 'frontend/assets/screenshots'),
    path.join(projectRoot, 'frontend/assets/images')
  ];
  
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 Created: ${dir}`);
    }
  });
  
  // Secrets are never generated into the source tree. Configure them via the host environment.
  // 3. Ensure an environment template exists (never a secret file).
  const envExamplePath = path.join(__dirname, '.env.example');
  if (!fs.existsSync(envExamplePath)) {
    fs.writeFileSync(envExamplePath, `PORT=4000
NODE_ENV=production
CLIENT_URL=https://presethub.site
JWT_SECRET=replace-with-a-random-64-character-secret
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
BOT_TOKEN=
ADMIN_CHAT_ID=
ADMIN_EMAIL=
ADMIN_PASSWORD=
API_BASE=https://presethub.site/api`.trim());
    console.log('✅ .env.example created');
  }
  
  // 4. Create og-image.jpg placeholder
  const ogImagePath = path.join(projectRoot, 'frontend/assets/images/og-image.svg');
  if (!fs.existsSync(ogImagePath)) {
    const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
      <rect width="1200" height="630" fill="#f8f6f2"/>
      <rect x="100" y="150" width="1000" height="330" rx="20" fill="#d4a373"/>
      <text x="600" y="300" font-family="Inter" font-size="64" font-weight="800" text-anchor="middle" fill="#1e1e1e">PresetHub</text>
      <text x="600" y="370" font-family="Inter" font-size="32" text-anchor="middle" fill="#1e1e1e">Lightroom Presets Marketplace</text>
      <text x="600" y="420" font-family="Inter" font-size="20" text-anchor="middle" fill="#555">Download Free &amp; Premium Presets</text>
    </svg>`;
    fs.writeFileSync(ogImagePath, svg);
    console.log('✅ og-image.svg created');
  }
  
  // 5. Create robots.txt
  const robotsPath = path.join(projectRoot, 'frontend/robots.txt');
  if (!fs.existsSync(robotsPath)) {
    fs.writeFileSync(robotsPath, `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api
Sitemap: https://presethub.site/sitemap.xml`);
    console.log('✅ robots.txt created');
  }
  
  // 6. Create sitemap.xml
  const sitemapPath = path.join(projectRoot, 'frontend/sitemap.xml');
  if (!fs.existsSync(sitemapPath)) {
    fs.writeFileSync(sitemapPath, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://presethub.site/</loc><priority>1.0</priority></url>
  <url><loc>https://presethub.site/about.html</loc><priority>0.8</priority></url>
  <url><loc>https://presethub.site/blog.html</loc><priority>0.8</priority></url>
  <url><loc>https://presethub.site/contact.html</loc><priority>0.8</priority></url>
  <url><loc>https://presethub.site/faq.html</loc><priority>0.7</priority></url>
  <url><loc>https://presethub.site/terms.html</loc><priority>0.7</priority></url>
  <url><loc>https://presethub.site/privacy.html</loc><priority>0.7</priority></url>
  <url><loc>https://presethub.site/creator-program.html</loc><priority>0.8</priority></url>
  <url><loc>https://presethub.site/download-guide.html</loc><priority>0.7</priority></url>
  <url><loc>https://presethub.site/lightroom-guide.html</loc><priority>0.7</priority></url>
</urlset>`);
    console.log('✅ sitemap.xml created');
  }
  
  // 7. Create .gitignore
  const gitignorePath = path.join(projectRoot, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, `
node_modules/
npm-debug.log
.env
*.log
db.json
db-backup.json
uploads/
!uploads/.gitkeep
backups/
!backups/.gitkeep
.DS_Store
Thumbs.db
.vscode/
.idea/
    `.trim());
    console.log('✅ .gitignore created');
  }
  
  // 8. Create .gitkeep files
  const gitkeepDirs = [
    path.join(projectRoot, 'uploads'),
    path.join(projectRoot, 'uploads/previews'),
    path.join(projectRoot, 'uploads/avatars'),
    path.join(projectRoot, 'backups')
  ];
  gitkeepDirs.forEach(dir => {
    const gitkeepPath = path.join(dir, '.gitkeep');
    if (!fs.existsSync(gitkeepPath)) {
      fs.writeFileSync(gitkeepPath, '');
    }
  });
  
  console.log('✅ All directories and files ready!');
}

// Run auto-create
ensureDirectoriesAndFiles();

// ============================================================
// ===== SECURITY MIDDLEWARE =====
// ============================================================
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false
}));

// ============================================================
// ===== CORS CONFIGURATION =====
// ============================================================
const allowedOrigins = [
  process.env.CLIENT_URL,
  'https://presethub.site',
  'https://www.presethub.site',
  'http://presethub.site',
  'http://www.presethub.site',
'https://presethub-website.onrender.com/',
  'https://preset.site',
  'https://www.preset.site',
  'http://localhost:4000',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://192.168.1.100:5500',
  'http://192.168.1.101:5500'
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      console.warn('❌ CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// ============================================================
// ===== LOGGING =====
// ============================================================
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// ============================================================
// ===== RATE LIMITING =====
// ============================================================
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Too many authentication attempts, please try again later' }
});
app.use('/api/auth/', authLimiter);

// ============================================================
// ===== BODY PARSING =====
// ============================================================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ============================================================
// ===== STATIC FILES =====
// ============================================================
app.use('/uploads', express.static(path.join(projectRoot, 'uploads')));
app.use('/uploads/previews', express.static(path.join(projectRoot, 'uploads/previews')));
app.use('/uploads/avatars', express.static(path.join(projectRoot, 'uploads/avatars')));
app.use(express.static(path.join(projectRoot, 'frontend')));

// ============================================================
// ===== API ROUTES =====
// ============================================================
app.use('/api/auth', authRoutes);
app.use('/api/presets', presetRoutes);
app.use('/api/users', userRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);

// ============================================================
// ===== SEO: robots, sitemap & indexable preset landing pages =====
// ============================================================
function slugify(value) {
  return String(value || 'preset')
    .toLowerCase().trim()
    .replace(/[^a-z0-9\u0900-\u097f]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'preset';
}
function esc(value) {
  return String(value ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
}
function presetUrl(p) { return `/preset/${encodeURIComponent(p.id)}/${encodeURIComponent(slugify(p.name))}`; }

app.get('/robots.txt', (req,res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /uploads/\nSitemap: ${process.env.CLIENT_URL || 'https://presethub.site'}/sitemap.xml\n`);
});

app.get('/sitemap.xml', async (req,res) => {
  try {
    const db = await getDB();
    const base = (process.env.CLIENT_URL || 'https://presethub.site').replace(/\/$/, '');
    const pages = [
      '/', '/about.html', '/blog.html', '/contact.html', '/faq.html',
      '/terms.html', '/privacy.html', '/creator-program.html',
      '/download-guide.html', '/lightroom-guide.html'
    ];
    const urls = pages.map(u => `<url><loc>${esc(base + u)}</loc></url>`);
    (db.data.presets || []).filter(p => p.status === 'approved').forEach(p => {
      urls.push(`<url><loc>${esc(base + presetUrl(p))}</loc><lastmod>${new Date(p.updatedAt || p.createdAt || Date.now()).toISOString()}</lastmod></url>`);
    });
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
  } catch (e) { res.status(500).type('text/plain').send('Sitemap unavailable'); }
});

app.get(/^\/preset\/([^/]+)(?:\/[^/]+)?\/?$/, async (req,res,next) => {
  try {
    const db = await getDB();
    const preset = db.data.presets.find(p => p.id === req.params[0] && p.status === 'approved');
    if (!preset) return next();
    const base = (process.env.CLIENT_URL || 'https://presethub.site').replace(/\/$/, '');
    const canonical = base + presetUrl(preset);
    const image = preset.previewImage ? (String(preset.previewImage).startsWith('http') ? preset.previewImage : base + preset.previewImage) : `${base}/android-icon-192x192.png`;
    const description = `${preset.description || `Download ${preset.name} Lightroom preset.`} Category: ${preset.category || 'Lightroom presets'}. Created by ${preset.author || 'PresetHub creator'}.`;
    const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(preset.name)} – ${esc(preset.category || 'Lightroom')} Preset | PresetHub</title>
<meta name="description" content="${esc(description.slice(0,160))}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(preset.name)} – PresetHub">
<meta property="og:description" content="${esc(description.slice(0,200))}"><meta property="og:url" content="${esc(canonical)}"><meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(preset.name)} – PresetHub"><meta name="twitter:description" content="${esc(description.slice(0,200))}"><meta name="twitter:image" content="${esc(image)}">
<link rel="stylesheet" href="/style.css">
<script type="application/ld+json">${JSON.stringify({
  "@context":"https://schema.org","@type":"Product","name":preset.name,"description":description,
  "image":[image],"url":canonical,"category":preset.category || "Lightroom Preset",
  "brand":{"@type":"Brand","name":"PresetHub"},
  "offers":{"@type":"Offer","price":String(Number(preset.price||0)),"priceCurrency":"INR","availability":"https://schema.org/InStock","url":canonical},
  ...(preset.avgRating ? {"aggregateRating":{"@type":"AggregateRating","ratingValue":Number(preset.avgRating),"reviewCount":Math.max(1,(preset.reviews||[]).length)}} : {})
})}</script></head><body>
<main class="container" style="max-width:980px;padding:40px 18px">
<nav aria-label="Breadcrumb"><a href="/">PresetHub</a> / <a href="/?q=${encodeURIComponent(preset.category || '')}">${esc(preset.category || 'Presets')}</a> / <span>${esc(preset.name)}</span></nav>
<article style="margin-top:24px"><img src="${esc(image)}" alt="${esc(preset.name)} Lightroom preset preview" loading="eager" style="max-width:100%;border-radius:16px;display:block;margin-bottom:24px">
<h1>${esc(preset.name)}</h1><p>${esc(description)}</p>
<p><strong>Category:</strong> ${esc(preset.category || 'General')} · <strong>Creator:</strong> ${esc(preset.author || 'PresetHub creator')} · <strong>Rating:</strong> ${Number(preset.avgRating||0).toFixed(1)}/5</p>
<p><strong>Price:</strong> ${Number(preset.price||0) === 0 ? 'Free' : '₹'+Number(preset.price).toFixed(2)}</p>
<div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn btn-primary" href="/?preset=${encodeURIComponent(preset.id)}">View & Download</a><a class="btn btn-outline" href="https://www.google.com/search?q=${encodeURIComponent('site:presethub.site '+preset.name)}" target="_blank" rel="noopener">Search on Google</a></div>
</article></main></body></html>`;
    res.type('html').send(html);
  } catch (e) { next(e); }
});

// ============================================================
// ===== ADMIN PAGE =====
// ============================================================
const adminPath = path.join(projectRoot, 'frontend/admin.html');
if (fs.existsSync(adminPath)) {
  app.get('/admin', (req, res) => res.sendFile(adminPath));
} else {
  app.get('/admin', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><title>Admin Panel</title></head><body><h1>Admin Panel</h1><p>admin.html not found.</p></body></html>`);
  });
}

// ============================================================
// ===== STATIC LEGAL & INFO PAGES =====
// ============================================================
const staticPages = [
  'terms.html', 'privacy.html', 'about.html', 'blog.html',
  'creator-program.html', 'faq.html', 'contact.html',
  'download-guide.html', 'lightroom-guide.html'
];

staticPages.forEach(page => {
  const pagePath = path.join(projectRoot, `frontend/${page}`);
  if (fs.existsSync(pagePath)) {
    app.get(`/${page}`, (req, res) => res.sendFile(pagePath));
  } else {
    app.get(`/${page}`, (req, res) => {
      res.send(`<!DOCTYPE html><html><head><title>${page}</title></head><body><h1>📄 ${page}</h1><p>Coming soon.</p><a href="/">← Back</a></body></html>`);
    });
  }
});

// ============================================================
// ===== SPA CATCH-ALL =====
// ============================================================
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  if (req.accepts('html')) {
    const indexPath = path.join(projectRoot, 'frontend/index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send(`<h1>🚀 PresetHub</h1><p>Frontend not found at: ${indexPath}</p>`);
    }
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// ============================================================
// ===== ERROR HANDLER =====
// ============================================================
app.use(errorHandler);

// ============================================================
// ===== START SERVER =====
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log('═══════════════════════════════════════════════');
  console.log('🚀 PresetHub Server Started');
  console.log('═══════════════════════════════════════════════');
  console.log(`📡 Server: http://localhost:${PORT}`);
  console.log(`📱 Frontend: ${process.env.CLIENT_URL || 'http://localhost:' + PORT}`);
  console.log(`🔧 Admin: ${process.env.CLIENT_URL || 'http://localhost:' + PORT}/admin`);
  console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🤖 Bot Token: ${process.env.BOT_TOKEN ? '✅ Configured' : '❌ Missing'}`);
  console.log(`📱 Admin Chat ID: ${process.env.ADMIN_CHAT_ID || '❌ Missing'}`);
  console.log('═══════════════════════════════════════════════');
  console.log('\n📋 API Endpoints:');
  console.log('  POST   /api/auth/signup     - Register user');
  console.log('  POST   /api/auth/login      - Login user');
  console.log('  GET    /api/auth/me         - Get profile');
  console.log('  PUT    /api/auth/me/avatar  - Upload avatar');
  console.log('  PUT    /api/auth/change-password - Change password');
  console.log('  GET    /api/presets         - List presets');
  console.log('  POST   /api/presets         - Upload preset');
  console.log('  GET    /api/presets/:id     - Get preset');
  console.log('  POST   /api/presets/:id/download - Download');
  console.log('  POST   /api/presets/:id/like - Like preset');
  console.log('  POST   /api/presets/:id/share - Share preset');
  console.log('  GET    /api/users/top       - Top creators');
  console.log('  GET    /api/users/:id       - Get user profile');
  console.log('  POST   /api/users/:id/follow - Follow user');
  console.log('  POST   /api/payments/create-order - Razorpay');
  console.log('  POST   /api/payments/verify - Verify payment');
  console.log('  GET    /api/admin/analytics - Admin analytics');
  console.log('═══════════════════════════════════════════════\n');
  console.log('🤖 Telegram Bot is ready!');
  console.log('📱 Start bot with: npm run bot');
  console.log('📱 Or visit: https://t.me/presethub_bot');
});

process.on('SIGTERM', () => { console.log('🛑 SIGTERM received'); process.exit(0); });
process.on('SIGINT', () => { console.log('🛑 SIGINT received'); process.exit(0); });
process.on('uncaughtException', (err) => console.error('❌ Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('❌ Unhandled Rejection:', reason));

module.exports = app;
