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


## PresetHub final build notes

- User uploads are published immediately; admin approval is not required. Admin remains a separate control/reporting area.
- Supported preset uploads include XMP, DNG, LRTEMPLATE, CUBE, 3DL, LOOK, COSTYLE, XML, JSON and ZIP preset packs.
- Each published preset receives a server-rendered SEO URL, canonical URL, Open Graph preview, Twitter metadata, JSON-LD and inclusion in `/sitemap.xml`.
- Search suggestions include a Google `site:presethub.site` search option. Search ranking cannot be guaranteed by code; indexing and ranking are controlled by Google.
- MongoDB creates collections/indexes through Mongoose. Configure `MONGODB_URI` and allow the Render service to reach the Atlas cluster.
- In MongoDB Atlas, add an appropriate Network Access rule for the Render deployment. Render outbound IPs can change; use the provider-recommended secure allowlist for your plan rather than embedding credentials in code.
- AdSense Auto Ads are loaded from `ADSENSE_CLIENT`; `frontend/ads.txt` is included. AdSense approval and ad serving are controlled by Google.
- Keep secrets only in Render environment variables; never commit `.env`.
