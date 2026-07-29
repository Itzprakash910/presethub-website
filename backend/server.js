require('dotenv').config();

// Critical environment variables check
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET not set, using default (insecure for production)');
}
if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.warn('⚠️  Razorpay keys not set, payment features will fail');
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const presetRoutes = require('./routes/presets');
const userRoutes = require('./routes/users');
const reviewRoutes = require('./routes/reviews');
const paymentRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 4000;

// Security middleware
app.use(helmet());

// CORS – Allow multiple origins
const allowedOrigins = [
  process.env.CLIENT_URL || 'https://presethub.site',
  'http://localhost:4000',
  'http://localhost:3000'
];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// Logging
app.use(morgan('dev'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later' }
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ✅ Serve uploaded preset files FIRST (before API routes)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ✅ API routes (MUST be before the catch-all)
app.use('/api/auth', authRoutes);
app.use('/api/presets', presetRoutes);
app.use('/api/users', userRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);

// ✅ Admin page route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin.html'));
});

// ============================================================
// ✅ STATIC PAGES (Legal, Info, Help, etc.)
// ============================================================
app.get('/terms.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/terms.html'));
});
app.get('/privacy.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/privacy.html'));
});
app.get('/about.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/about.html'));
});
app.get('/blog.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/blog.html'));
});
app.get('/creator-program.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/creator-program.html'));
});
app.get('/faq.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/faq.html'));
});
app.get('/contact.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/contact.html'));
});
app.get('/download-guide.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/download-guide.html'));
});
app.get('/lightroom-guide.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/lightroom-guide.html'));
});
app.get('/terms.css', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/terms.css'));
});

// ✅ Serve frontend static files (AFTER API routes)
app.use(express.static(path.join(__dirname, '../frontend')));

// ============================================================
// ✅ CATCH-ALL: Serve index.html ONLY for non-API routes
// ============================================================
app.get('*', (req, res) => {
  // If the request accepts HTML, serve index.html (SPA support)
  if (req.accepts('html')) {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// Error handler
app.use(errorHandler);

// Ensure uploads directories exist
const fs = require('fs');
const uploadsDir = path.join(__dirname, '../uploads');
const previewsDir = path.join(uploadsDir, 'previews');
const avatarsDir = path.join(uploadsDir, 'avatars');
[uploadsDir, previewsDir, avatarsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created directory: ${dir}`);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 PresetHub server running on port ${PORT}`);
  console.log(`📱 Frontend: ${process.env.CLIENT_URL || 'https://presethub.site'}`);
  console.log(`🔧 Admin: ${process.env.CLIENT_URL || 'https://presethub.site'}/admin`);
  console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
});