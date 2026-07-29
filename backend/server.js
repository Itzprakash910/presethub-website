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

// CORS – ✅ Render URL को अनुमति दें
const allowedOrigin = process.env.CLIENT_URL || 'https://preset-hub.onrender.com';
app.use(cors({
  origin: allowedOrigin,
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));

// Serve uploaded preset files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// API routes
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

// ============================================================
// ✅ CATCH-ALL: Serve index.html for any other route (SPA support)
// ============================================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Error handler
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 PresetHub server running on port ${PORT}`);
  console.log(`📱 Frontend: ${allowedOrigin}`);
  console.log(`🔧 Admin: ${allowedOrigin}/admin`);
  console.log(`📄 Terms: ${allowedOrigin}/terms.html`);
  console.log(`🔒 Privacy: ${allowedOrigin}/privacy.html`);
  console.log(`ℹ️  About: ${allowedOrigin}/about.html`);
  console.log(`📝 Blog: ${allowedOrigin}/blog.html`);
  console.log(`🚀 Creator Program: ${allowedOrigin}/creator-program.html`);
  console.log(`❓ FAQ: ${allowedOrigin}/faq.html`);
  console.log(`📧 Contact: ${allowedOrigin}/contact.html`);
  console.log(`⬇️  Download Guide: ${allowedOrigin}/download-guide.html`);
  console.log(`📷 Lightroom Guide: ${allowedOrigin}/lightroom-guide.html`);
  console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
});