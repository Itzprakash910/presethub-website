const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// ============================================================
// ===== ENVIRONMENT CHECKS =====
// ============================================================
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set and at least 32 characters long.');
}

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.warn('⚠️  Razorpay keys not set, payment features will fail');
}

if (!process.env.CLIENT_URL) {
  process.env.CLIENT_URL = 'https://presethub.site';
}

// ============================================================
// ===== DEPENDENCIES =====
// ============================================================
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const crypto = require('crypto');

// ============================================================
// ===== ROUTES =====
// ============================================================
const authRoutes = require('./routes/auth');
const presetRoutes = require('./routes/presets');
const userRoutes = require('./routes/users');
const reviewRoutes = require('./routes/reviews');
const paymentRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');
const chatRoutes = require('./routes/chat');
const errorHandler = require('./utils/errorHandler');

// ============================================================
// ===== APP INITIALIZATION =====
// ============================================================
const app = express();
const PORT = process.env.PORT || 4000;
const projectRoot = path.join(__dirname, '..');
const storageRoot = process.env.DATA_DIR || projectRoot;

// ============================================================
// ===== AUTO-CREATE MISSING FOLDERS & FILES =====
// ============================================================
function ensureDirectoriesAndFiles() {
  console.log('🔧 Checking project structure...');
  
  // 1. Create directories
  const dirs = [
    path.join(storageRoot, 'uploads'),
    path.join(storageRoot, 'uploads/previews'),
    path.join(storageRoot, 'uploads/avatars'),
    path.join(storageRoot, 'private_uploads'),
    path.join(storageRoot, 'backups'),
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
  
  // 2. Create .env if missing
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    const secret = crypto.randomBytes(64).toString('hex');
    fs.writeFileSync(envPath, `
PORT=4000
JWT_SECRET=${secret}
CLIENT_URL=https://presethub.site
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
NODE_ENV=production
API_BASE=https://presethub.site/api
BOT_TOKEN=
ADMIN_CHAT_ID=
    `.trim());
    console.log('✅ .env created with Bot Token');
  }
  
  // 3. Create .env.example
  const envExamplePath = path.join(__dirname, '.env.example');
  if (!fs.existsSync(envExamplePath)) {
    fs.writeFileSync(envExamplePath, `
PORT=4000
JWT_SECRET=your_super_secret_key_change_this
CLIENT_URL=https://presethub.site
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
NODE_ENV=production
API_BASE=https://presethub.site/api
BOT_TOKEN=your_telegram_bot_token
ADMIN_CHAT_ID=your_admin_chat_id
    `.trim());
    console.log('✅ .env.example created');
  }
  
  // 4. Create og-image.jpg placeholder
  const ogImagePath = path.join(projectRoot, 'frontend/assets/images/og-image.jpg');
  if (!fs.existsSync(ogImagePath)) {
    const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
      <rect width="1200" height="630" fill="#f8f6f2"/>
      <rect x="100" y="150" width="1000" height="330" rx="20" fill="#d4a373"/>
      <text x="600" y="300" font-family="Inter" font-size="64" font-weight="800" text-anchor="middle" fill="#1e1e1e">PresetHub</text>
      <text x="600" y="370" font-family="Inter" font-size="32" text-anchor="middle" fill="#1e1e1e">Lightroom Presets Marketplace</text>
      <text x="600" y="420" font-family="Inter" font-size="20" text-anchor="middle" fill="#555">Download Free &amp; Premium Presets</text>
    </svg>`;
    fs.writeFileSync(ogImagePath, svg);
    console.log('✅ og-image.jpg created');
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
    path.join(storageRoot, 'uploads/previews'),
    path.join(storageRoot, 'uploads/avatars'),
    path.join(projectRoot, 'backups')
  ];
  gitkeepDirs.forEach(dir => {
    const gitkeepPath = path.join(dir, '.gitkeep');
    if (!fs.existsSync(gitkeepPath)) {
      fs.writeFileSync(gitkeepPath, '');
    }
  });
  
  console.log('✅ All directories and files ready!');
  console.log(`🤖 Telegram Bot: ${process.env.BOT_TOKEN ? 'configured' : 'disabled (set BOT_TOKEN to enable)'}`);
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
app.disable('x-powered-by');
app.use((req,res,next)=>{ res.setHeader('Referrer-Policy','strict-origin-when-cross-origin'); res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()'); res.setHeader('X-Content-Type-Options','nosniff'); next(); });

// ============================================================
// ===== CORS CONFIGURATION =====
// ============================================================
const allowedOrigins = [
  process.env.CLIENT_URL || 'https://presethub.site',
  'https://presethub.site',
  'https://www.presethub.site',
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:4000','http://localhost:3000','http://localhost:5500','http://127.0.0.1:5500'] : [])
].filter(Boolean);

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

// Dynamic social preview for preset URLs
app.get('/preset/:id', async (req, res, next) => {
  try {
    const { getDB } = require('./config/db');
    const db = await getDB();
    const p = db.data.presets.find(x => x.id === req.params.id && x.status === 'approved');
    const base = process.env.CLIENT_URL || 'https://presethub.site';
    const esc = v => String(v || '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
    const title = esc(p ? `${p.name} – Lightroom Preset | PresetHub` : 'PresetHub – Lightroom Presets Marketplace');
    const desc = esc(p ? (p.description || `Download ${p.name} Lightroom preset by ${p.author}.`) : 'Discover free and premium Lightroom presets on PresetHub.');
    const image = p && p.previewImage ? (p.previewImage.startsWith('http') ? p.previewImage : base + p.previewImage) : `${base}/assets/images/og-image.png`;
    const html = `<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>${title}</title><meta name=\"description\" content=\"${desc}\"><meta property=\"og:type\" content=\"website\"><meta property=\"og:title\" content=\"${title}\"><meta property=\"og:description\" content=\"${desc}\"><meta property=\"og:image\" content=\"${esc(image)}\"><meta property=\"og:url\" content=\"${base}/preset/${encodeURIComponent(req.params.id)}\"><meta name=\"twitter:card\" content=\"summary_large_image\"><meta name=\"twitter:title\" content=\"${title}\"><meta name=\"twitter:description\" content=\"${desc}\"><meta name=\"twitter:image\" content=\"${esc(image)}\"><link rel=\"canonical\" href=\"${base}/preset/${encodeURIComponent(req.params.id)}\"><meta http-equiv=\"refresh\" content=\"0;url=/?preset=${encodeURIComponent(req.params.id)}\"></head><body><p>Opening PresetHub…</p><script>location.replace('/?preset=${encodeURIComponent(req.params.id)}')</script></body></html>`;
    res.type('html').send(html);
  } catch (e) { next(e); }
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
  console.log(`📱 Frontend: ${process.env.CLIENT_URL || 'https://presethub.site'}`);
  console.log(`🔧 Admin: ${process.env.CLIENT_URL || 'https://presethub.site'}/admin`);
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

if (process.env.BOT_TOKEN) { try { require('./bot'); } catch (e) { console.error('Telegram bot failed to start:', e.message); } }

module.exports = app;