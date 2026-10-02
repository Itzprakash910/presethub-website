# PresetHub — production-ready MongoDB preset marketplace

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

## Production setup
1. Copy `backend/.env.example` to `.env` and fill secrets.
2. Set `MONGODB_URI`, `JWT_SECRET` (32+ random chars), `CLIENT_URL`.
3. For durable uploaded files on Render, configure Cloudflare R2 variables.
4. Set your real AdSense publisher and enable Auto Ads in the AdSense dashboard. Do not invent ad slot IDs.
5. Deploy the `backend` directory as the service root. `render.yaml` is included.
6. After DNS/HTTPS is live, submit `https://presethub.site/sitemap.xml` in Google Search Console.

## Important SEO note
The project creates a dedicated crawlable URL for each approved preset and includes it in the sitemap. This improves discoverability, but no software can guarantee a #1 Google ranking.


## v2.3 final integration
- Telegram bot now runs inside the same `npm start` web-server process when `BOT_TOKEN` is configured; no second service is required.
- Upload queues resume on page return/focus/visibility changes using IndexedDB.
- Profile poster/avatar upload uses the same resumable queue.
- Free preset downloads can start without login; paid presets require login and successful payment (creator-owned paid presets remain downloadable by the creator).
- Home hero uses the first preset returned by the weighted Featured ranking, so it is a real high-engagement preset rather than a placeholder illustration.
- Search results show presets, users, categories and tags.
- The supplied PresetHub icon/logo/social pack is included under `frontend/assets/*-pack`.
- No Telegram token, MongoDB URI, Razorpay secret or R2 secret is bundled in the ZIP; configure them as deployment secrets.
