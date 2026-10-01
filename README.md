# PresetHub — production-ready Lightroom preset marketplace

PresetHub is a mobile-first Lightroom preset marketplace with:
- MongoDB persistence via Mongoose
- optional Cloudflare R2 object storage (local uploads fallback)
- signup/login, profiles, follow, wishlist, notifications
- single and bulk preset upload (up to 20 per batch)
- preview, views, likes, reviews and comments
- multi-select + bulk download
- paid presets with Razorpay verification hooks
- creator dashboard and admin dashboard
- SEO-friendly server-rendered preset/profile pages, sitemap and robots.txt
- PWA install/offline shell
- Google AdSense publisher integration with Auto Ads support
- security headers, rate limits, upload validation and centralized errors
- 3-column responsive preset catalog with skeleton loading and image previews
- creator avatar + profile poster uploads, preset poster replacement and metadata editing
- rich search across preset name, creator username, tags and categories
- follow-gated creator messaging, inbox, unread counts and message notifications
- like/comment/review/follow/purchase/download notifications
- signed R2 download URLs when R2 is configured to keep paid preset files protected
- canonical production host redirect to https://presethub.site and a dedicated service-error page
- stronger favicon/PWA/OG/JSON-LD/robots/sitemap SEO assets

## Production setup
1. Copy `backend/.env.example` to `.env` and fill secrets.
2. Set `MONGODB_URI`, `JWT_SECRET` (32+ random chars), `CLIENT_URL`.
3. For durable uploaded files on Render, configure Cloudflare R2 variables.
4. Set your real AdSense publisher and enable Auto Ads in the AdSense dashboard. Do not invent ad slot IDs.
5. Deploy the `backend` directory as the service root. `render.yaml` is included.
6. After DNS/HTTPS is live, submit `https://presethub.site/sitemap.xml` in Google Search Console.

## Important SEO note
The project creates a dedicated crawlable URL for each approved preset and includes it in the sitemap. This improves discoverability, but no software can guarantee a #1 Google ranking.


## Final production checklist
- Set `CLIENT_URL=https://presethub.site` in production. Requests to other web hosts are redirected to the canonical site; `/healthz` remains available for Render health checks.
- Configure MongoDB and R2 before production uploads. R2 is strongly recommended because Render local disk is ephemeral.
- Keep the R2 bucket private for preset files when possible. The backend creates short-lived signed download URLs when R2 is configured.
- Configure Razorpay keys to enable paid presets. Never put the Razorpay secret in frontend code.
- Submit `https://presethub.site/sitemap.xml` in Google Search Console. Google controls when snippets, icons and sitelinks appear; metadata cannot guarantee a specific search result layout.
- Do not commit `.env` or production secrets. Use Render environment variables.

## Telegram Bot deployment

The Telegram bot runs as a separate Render Worker (`presethub-telegram-bot`) using `npm run bot`.
Set these environment variables on the worker:
- `BOT_TOKEN`
- `MONGODB_URI`
- `JWT_SECRET` (same value as the web service)
- `API_BASE=https://presethub.site/api`
- `CLIENT_URL=https://presethub.site`
- `ADMIN_CHAT_ID` (optional)

Do not run multiple polling bot instances with the same `BOT_TOKEN`, otherwise Telegram may return a 409 conflict because only one long-polling consumer should be active.
