# PresetHub

PresetHub is a mobile-first Lightroom preset marketplace with search, SEO-friendly preset pages, creator profiles, follow, wishlist, reviews, downloads, Razorpay payments, admin moderation and PWA installation.

## Production structure

- `frontend/` — website/PWA
- `backend/` — Express API
- `uploads/` — runtime user uploads (ignored by Git)
- `db.seed.json` — safe demo seed data; runtime `db.json` is created automatically and ignored by Git
- `render.yaml` — Render deployment
- `.env.example` — environment template

## Render

Recommended settings:

```text
Root Directory: backend
Build Command: npm ci --omit=dev
Pre-Deploy Command: (empty)
Start Command: npm start
Auto-Deploy: On Commit
```

Add the variables from `backend/.env.example` in Render Environment Variables.

Required in production:
- `JWT_SECRET` — random secret, 64+ characters
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD` — strong password, 12+ characters

Optional:
- Razorpay keys
- Telegram bot token/admin chat ID
- `API_BASE`

## SEO

Approved presets receive crawlable canonical pages:

`/preset/<id>/<slug>/`

The server generates:
- unique title and description
- canonical URL
- Open Graph metadata
- Product structured data
- creator profile links
- dynamic `/sitemap.xml`
- `/robots.txt`
- internal search suggestions
- Google site-search fallback for unmatched queries

Google indexing and ranking are not guaranteed. Submit the sitemap in Google Search Console and use URL Inspection for important pages.

## AdSense

Replace the `ads.txt` publisher ID only with the publisher ID shown in your own AdSense account. Do not publish someone else's seller ID.

Keep `ads.txt` available at:

`https://your-domain.example/ads.txt`

AdSense approval depends on Google's current policies, original/valuable content and site quality; code cannot guarantee approval or a top Search position.

## Security

Never commit `.env`, real credentials, database backups, private uploads or bot tokens.

Admin creation is environment-driven; there is no default admin password in source code.

## PWA

PresetHub is installable as a PWA. Open `/download-app.html` for install instructions. A real signed native APK is not included as a fake placeholder; build/sign an Android wrapper separately if a native APK is required.
