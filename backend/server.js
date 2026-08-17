require('dotenv').config();

// ============================================================
// ===== ENVIRONMENT CHECKS =====
// ============================================================
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET not set, using default (insecure for production)');
  process.env.JWT_SECRET = 'supersecretkey';
}

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.warn('⚠️  Razorpay keys not set, payment features will fail');
}

if (!process.env.CLIENT_URL) {
  process.env.CLIENT_URL = 'http://localhost:4000';
}

// ============================================================
// ===== DEPENDENCIES =====
// ============================================================
const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const fs = require('fs');

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
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use(express.static(path.join(__dirname, '../frontend')));

// ============================================================
// ===== ENSURE UPLOAD DIRECTORIES =====
// ============================================================
const uploadsDir = path.join(__dirname, '../uploads');
const previewsDir = path.join(uploadsDir, 'previews');
const avatarsDir = path.join(uploadsDir, 'avatars');

[uploadsDir, previewsDir, avatarsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created directory: ${dir}`);
  }
});

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
// ===== ADMIN PAGE =====
// ============================================================
const adminPath = path.join(__dirname, '../frontend/admin.html');
if (fs.existsSync(adminPath)) {
  app.get('/admin', (req, res) => {
    res.sendFile(adminPath);
  });
} else {
  console.warn('⚠️  admin.html not found at:', adminPath);
  app.get('/admin', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html><head><title>Admin Panel</title></head>
      <body><h1>Admin Panel</h1><p>admin.html not found. Please build the frontend.</p></body>
      </html>
    `);
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
  const pagePath = path.join(__dirname, `../frontend/${page}`);
  if (fs.existsSync(pagePath)) {
    app.get(`/${page}`, (req, res) => res.sendFile(pagePath));
  } else {
    app.get(`/${page}`, (req, res) => {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>${page.replace('.html', '').replace(/-/g, ' ').toUpperCase()} | PresetHub</title>
        <style>body{font-family:'Inter',sans-serif;max-width:800px;margin:50px auto;padding:20px;line-height:1.6;}
        h1{color:#d4a373;}a{color:#d4a373;text-decoration:none;}.container{background:#f8f6f2;padding:30px;border-radius:12px;}</style>
        </head>
        <body><div class="container"><h1>📄 ${page.replace('.html', '').replace(/-/g, ' ').toUpperCase()}</h1>
        <p>This page is coming soon. Please check back later.</p>
        <p><a href="/">← Back to Home</a></p></div></body>
        </html>
      `);
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
    const indexPath = path.join(__dirname, '../frontend/index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send(`<h1>🚀 PresetHub</h1><p>Frontend files not found at: ${indexPath}</p>`);
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
app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════');
  console.log('🚀 PresetHub Server Started');
  console.log('═══════════════════════════════════════════════');
  console.log(`📡 Server: http://localhost:${PORT}`);
  console.log(`📱 Frontend: ${process.env.CLIENT_URL || 'http://localhost:' + PORT}`);
  console.log(`🔧 Admin: ${process.env.CLIENT_URL || 'http://localhost:' + PORT}/admin`);
  console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('═══════════════════════════════════════════════');
  console.log('\n📋 API Endpoints:');
  console.log('  POST   /api/auth/signup     - Register user');
  console.log('  POST   /api/auth/login      - Login user');
  console.log('  GET    /api/auth/me         - Get profile');
  console.log('  GET    /api/presets         - List presets');
  console.log('  POST   /api/presets         - Upload preset');
  console.log('  GET    /api/presets/:id     - Get preset');
  console.log('  POST   /api/presets/:id/download - Download');
  console.log('  GET    /api/users/top       - Top creators');
  console.log('  POST   /api/payments/create-order - Razorpay');
  console.log('  GET    /api/admin/analytics - Admin analytics');
  console.log('═══════════════════════════════════════════════\n');
});

process.on('SIGTERM', () => { console.log('🛑 SIGTERM received'); process.exit(0); });
process.on('SIGINT', () => { console.log('🛑 SIGINT received'); process.exit(0); });
process.on('uncaughtException', (err) => console.error('❌ Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('❌ Unhandled Rejection:', reason));

module.exports = app;