# PresetHub project structure (v3.23.0)

Folders and files, with the job of each important file. Secrets are never stored here: real values live only in Render's environment settings.

```
backend/
  config/
    db.js   # MongoDB connection and pool settings
    mongoStorage.js   # GridFS storage for preset files and images
  middleware/
    auth.js   # Clerk session verification, bot tokens, admin role and MFA gate
    upload.js   # Upload checks: file types, size, magic bytes, zip safety
  models/
    index.js   # All Mongoose schemas (User, Preset, Order, Payout, Coupon, Boost, AuditLogEntry…)
  routes/
    admin.js   # Admin APIs (overview, users, payouts, refunds, coupons, boosts, audit log, roles)
    ads.js   # Home ads API
    auth.js   # Account APIs (me, profile, my-data export, bot link code, account deletion)
    cashfree.js   # Cashfree checkout (preset, Pro, tip, boost), coupon check, signed webhook
    chat.js   # Support chat
    collections.js   # Preset collections (playlists)
    comments.js   # Comments on presets
    creator.js   # Creator dashboard, payout details, payout requests, Pro theme
    features.js   # Daily picks, streak, leaderboard, feed, reports, creator overview
    payments.js   # YOUPI and shared payment logic (order fulfilment)
    presets.js   # Presets: list, categories, search, upload, download, bulk
    reviews.js   # Verified-buyer reviews
    search.js   # Search API
    share.js   # Share links and click tracking
    texts.js   # Shayari and text prompts API
    users.js   # User profiles, follow, notifications
  scripts/
    generate-vapid.js   # Creates web-push keys
  seo/
    listPages.js   # Server-rendered list pages (presets, tags, categories, profiles)
    shayariPages.js   # Server-rendered shayari pages
  utils/
    alerts.js   # Admin alerts (Telegram, email, panel), process handlers, DB monitor
    boosts.js   # Boost prices and timing
    cashfree.js   # Cashfree REST client and webhook signature check
    clerk.js   # Clerk server helper (verify session, get user, delete user)
    coupons.js   # Coupon rules and discount maths
    crypto.js   # AES-256-GCM encryption for payout details
    errorHandler.js   # Error mapping (production-safe messages)
    features.js   # Streak, creator level, caption generator, daily index
    notifications.js   # In-app notifications
    payouts.js   # Payout rules, UPI/IFSC/account validation, creator share
    permissions.js   # Admin role permission map and refund limit
    plans.js   # Pro plans and prices
    security.js   # Lockout, rate limits, bot guard, zip checks, safety helpers
    tick.js   # Follower tick levels
    validators.js
    viral.js   # Viral detection and broadcast
  .env.example   # Environment variable template (no secrets)
  backup.js   # MongoDB JSON backup (daily timer and npm run backup)
  bot.js   # Telegram bot (Telegraf): menu, /link, admin commands, channel posts
  create-admin.js   # Grants admin role to an email (npm run create-admin)
  models.js   # Re-export of models/index.js (compatibility)
  package.json   # Backend dependencies, scripts and version
  server.js   # Entry point: security, routes, SEO pages, sitemap, HTML injection, cron jobs
docs/
  AUDIT-v3.21.0.md   # Security and code audit report
  COMPLIANCE.md   # DPDP, consumer rules, launch SEO, admin guide status and breach plan
frontend/
  assets/
    icons/   # PWA and favicon images
      apple-touch-icon.png
      favicon.ico
      icon-192.png
      icon-48.png
      icon-512.png
      icon-96.png
      icon-maskable-512.png
    icons-pack/
      svg/   # 71 SVG icons used as CSS masks
        fa-arrow-right.svg
        fa-ban.svg
        fa-bars.svg
        fa-bell.svg
        fa-bolt.svg
        fa-bookmark.svg
        fa-box-open.svg
        fa-camera.svg
        fa-chart-line.svg
        fa-chart-pie.svg
        fa-chart-simple.svg
        fa-check.svg
        fa-chevron-left.svg
        fa-chevron-right.svg
        fa-clock.svg
        fa-cloud-arrow-up.svg
        fa-comment.svg
        fa-copy.svg
        fa-crown.svg
        fa-cubes.svg
        fa-database.svg
        fa-download.svg
        fa-envelope.svg
        fa-eye-slash.svg
        fa-eye.svg
        fa-filter.svg
        fa-fire.svg
        fa-flag.svg
        fa-gauge.svg
        fa-globe.svg
        fa-hand-holding-heart.svg
        fa-hashtag.svg
        fa-heart.svg
        fa-image.svg
        fa-images.svg
        fa-layer-group.svg
        fa-life-ring.svg
        fa-link.svg
        fa-location-crosshairs.svg
        fa-location-dot.svg
        fa-lock.svg
        fa-message.svg
        fa-mobile-screen.svg
        fa-moon.svg
        fa-pen-nib.svg
        fa-pen-to-square.svg
        fa-pen.svg
        fa-plus.svg
        fa-receipt.svg
        fa-right-from-bracket.svg
        fa-search.svg
        fa-server.svg
        fa-share-nodes.svg
        fa-share.svg
        fa-star.svg
        fa-sun.svg
        fa-trash.svg
        fa-upload.svg
        fa-user-plus.svg
        fa-user.svg
        fa-users.svg
        fa-wand-magic-sparkles.svg
        fa-xmark.svg
        fab-facebook.svg
        fab-instagram.svg
        fab-linkedin.svg
        fab-reddit.svg
        fab-telegram.svg
        fab-whatsapp.svg
        fab-x-twitter.svg
        fab-youtube.svg
    images/   # og-image and logo
      og-image.png
      presethub-p-logo.jpg
    LICENSE-FONTAWESOME.txt
  about.html
  admin-v32.js   # Admin panels: overview, payouts, coupons, boosts, audit log, roles
  admin.css   # Admin panel styles
  admin.html   # Admin panel page (private, noindex)
  admin.js   # Admin panel core logic
  ads-init.js   # AdSense queue init (external for CSP)
  ads.txt   # AdSense publisher file (must stay at root)
  app.js   # Main site logic: catalogue, checkout, auth UI, menus
  apple-touch-icon.png
  async-css.js   # Switches non-critical CSS from print to all
  blog.html
  clerk-bridge.js   # Clerk SDK loader; adds session token to API calls; window.phAuth
  contact.html
  content.css   # Content pages and footer
  cookie-consent.css   # Cookie banner styles
  cookie-consent.js   # Cookie banner (Allow and Reject with equal prominence)
  cookies.html
  creator-program.html
  creator.css   # Creator dashboard styles
  creator.html   # Creator dashboard page (private, noindex)
  creator.js   # Creator dashboard client
  download-app.html
  download-app.js   # Install-app prompt
  download-guide.html
  faq.html
  favicon.ico
  features.js   # Daily picks, streak, leaderboard, reports, tips, collections
  googlebd85aa1dfde78f37.html   # Search Console verification file (must stay at root)
  icons.css   # SVG icon masks
  index.html   # Homepage
  lightroom-guide.html
  llms.txt   # Site summary for AI models
  manifest.json   # PWA manifest and icons
  privacy.html   # Privacy policy (DPDP)
  refund-policy.html   # Refund, cancellation and shipping policy
  robots.txt   # Crawler rules (AI crawler groups, sensitive paths blocked)
  security.txt   # Security contact for researchers
  style.css   # Main theme (light and dark variables)
  sw.js   # Service worker (cache, offline fallback, push)
  terms.html
  texts.js   # Shayari section and cards
  tools.html
  tools.js   # Caption generator and text-on-photo tool
  tracking.js   # GA4 and Meta Pixel loader (only after cookie consent)
.gitignore   # Files excluded from git (secrets, node_modules, backups)
CASHFREE-SETUP.md   # Cashfree sandbox and production setup
CHANGELOG-v3.22.0.md   # Latest version changelog
LICENSE   # License
package.json   # Root scripts (start, postinstall) and version
render.yaml   # Render deploy blueprint (services and env keys)
YOUPI-PAYMENT-SETUP.md   # YOUPI PG setup (legacy fallback)
```
