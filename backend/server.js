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

// CORS
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:4000',
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

// ✅ Serve frontend static files (now correct path)
app.use(express.static(path.join(__dirname, '../frontend')));

// Serve uploaded preset files (uploads is inside backend)
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

// Terms of Use
app.get('/terms.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/terms.html'));
});

// Privacy Policy
app.get('/privacy.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/privacy.html'));
});

// About Us
app.get('/about.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/about.html'));
});

// Blog
app.get('/blog.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/blog.html'));
});

// Creator Program
app.get('/creator-program.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/creator-program.html'));
});

// FAQ
app.get('/faq.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/faq.html'));
});

// Contact
app.get('/contact.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/contact.html'));
});

// Download Guide
app.get('/download-guide.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/download-guide.html'));
});

// Lightroom Guide
app.get('/lightroom-guide.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/lightroom-guide.html'));
});

// Common CSS for all static pages (terms.css)
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
  console.log(`📱 Frontend: http://localhost:${PORT}`);
  console.log(`🔧 Admin: http://localhost:${PORT}/admin`);
  console.log(`📄 Terms: http://localhost:${PORT}/terms.html`);
  console.log(`🔒 Privacy: http://localhost:${PORT}/privacy.html`);
  console.log(`ℹ️  About: http://localhost:${PORT}/about.html`);
  console.log(`📝 Blog: http://localhost:${PORT}/blog.html`);
  console.log(`🚀 Creator Program: http://localhost:${PORT}/creator-program.html`);
  console.log(`❓ FAQ: http://localhost:${PORT}/faq.html`);
  console.log(`📧 Contact: http://localhost:${PORT}/contact.html`);
  console.log(`⬇️  Download Guide: http://localhost:${PORT}/download-guide.html`);
  console.log(`📷 Lightroom Guide: http://localhost:${PORT}/lightroom-guide.html`);
  console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
});