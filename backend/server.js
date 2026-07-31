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
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline scripts for frontend
  crossOriginEmbedderPolicy: false
}));

// CORS
const allowedOrigins = [
  process.env.CLIENT_URL || 'https://presethub.site',
  'http://localhost:4000',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Logging
app.use(morgan('dev'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, please try again later' }
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/presets', presetRoutes);
app.use('/api/users', userRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);

// Admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin.html'));
});

// Static legal & info pages
const staticPages = [
  'terms.html', 'privacy.html', 'about.html', 'blog.html',
  'creator-program.html', 'faq.html', 'contact.html',
  'download-guide.html', 'lightroom-guide.html', 'terms.css'
];

staticPages.forEach(page => {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, `../frontend/${page}`));
  });
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));

// Catch-all → index.html for SPA routes
app.get('*', (req, res) => {
  if (req.accepts('html')) {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// Error handler
app.use(errorHandler);

// Ensure upload directories exist
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
  console.log(`📱 Frontend: ${process.env.CLIENT_URL || 'http://localhost:' + PORT}`);
  console.log(`🔧 Admin: ${process.env.CLIENT_URL || 'http://localhost:' + PORT}/admin`);
  console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
});