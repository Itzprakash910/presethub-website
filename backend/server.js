const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') }); // must be first

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const presetRoutes = require('./routes/presets');
const userRoutes = require('./routes/users');
const reviewRoutes = require('./routes/reviews');
const paymentRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');
const { PREVIEW_DIR } = require('./utils/paths');
const { ensureAdmin } = require('./utils/bootstrap');

const app = express();
const PORT = process.env.PORT || 4000;
const isProd = process.env.NODE_ENV === 'production';

if (process.env.TRUST_PROXY === '1' || process.env.RAILWAY_ENVIRONMENT) app.set('trust proxy', 1);  // Railway sits behind a proxy
app.disable('x-powered-by');

// ---- Security headers (CSP allows only own scripts + the CDNs/fonts/Razorpay we use)
app.get('/health', (req, res) => res.json({ ok: true }));   // Railway healthcheck

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://api.razorpay.com', 'https://lumberjack.razorpay.com'],
      frameSrc: ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      ...(isProd ? { upgradeInsecureRequests: [] } : { upgradeInsecureRequests: null })
    }
  },
  crossOriginResourcePolicy: { policy: 'same-origin' }
}));

// ---- CORS: only listed origins (same-origin needs no CORS at all)
const allowed = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => (!origin || allowed.includes(origin) ? cb(null, true) : cb(null, false)),
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));

// ---- Rate limits
const limiter = (windowMin, max, msg) => rateLimit({
  windowMs: windowMin * 60 * 1000, max, standardHeaders: true, legacyHeaders: false,
  message: { error: msg }
});
app.use('/api', limiter(15, 300, 'Too many requests, try again later'));
app.use('/api/auth/login', limiter(15, 10, 'Too many login attempts, try again in 15 minutes'));
app.use('/api/auth/signup', limiter(60, 10, 'Too many signups from this IP'));
app.use('/api/payments', limiter(15, 30, 'Too many payment requests'));

// ---- Static: frontend (no dotfiles) + PUBLIC preview images only.
// Preset files live in private_uploads/ and are never served statically.
app.use(express.static(path.join(__dirname, '../frontend'), { dotfiles: 'deny' }));
app.use('/uploads/previews', express.static(PREVIEW_DIR, {
  dotfiles: 'deny', index: false,
  setHeaders: res => res.setHeader('X-Content-Type-Options', 'nosniff')
}));

// ---- API
app.use('/api/auth', authRoutes);
app.use('/api/presets', presetRoutes);
app.use('/api/users', userRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// SPA fallback (never for /api or file-like paths)
app.get('*', (req, res) => {
  if (path.extname(req.path)) return res.status(404).send('Not found');
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ---- Central error handler (no stack traces to client)
app.use((err, req, res, next) => {
  if (err && err.name === 'MulterError') return res.status(400).json({ error: err.message });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(err);
  res.status(err.status && err.status < 500 ? err.status : 500).json({ error: err.expose ? err.message : 'Server error' });
});

ensureAdmin()
  .catch(err => console.error('Admin bootstrap failed:', err.message))
  .finally(() => app.listen(PORT, '0.0.0.0', () => console.log(`PresetHub running on port ${PORT}`)));
