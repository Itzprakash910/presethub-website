# PresetHub — production-ready Lightroom preset marketplace

PresetHub is a Node.js + Express + vanilla-JS marketplace for Lightroom presets.

## Included
- Responsive mobile-first frontend and PWA
- Search, autocomplete, filters, sorting, wishlist, auth, uploads, reviews, creator/admin tools
- SEO-friendly individual preset URLs: `/preset/<id>/<slug>/`
- Server-rendered preset landing pages for crawlers
- Dynamic + static sitemap and robots.txt
- Product structured data, canonical URLs, Open Graph and Twitter metadata
- Google search fallback from site search
- Google AdSense publisher code + root `ads.txt` served from `frontend/ads.txt`
- Helmet, CORS allowlist, rate limits and validation
- No secrets or default admin credentials shipped

## Important deployment steps
1. Set `JWT_SECRET` to a strong secret (Render can generate it).
2. Set `CLIENT_URL` to the real canonical domain.
3. Add the domain to Google AdSense and wait for approval before expecting ads to serve.
4. Keep `frontend/ads.txt` at the public root (`https://your-domain/ads.txt`).
5. If an admin is required, set `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` (12+ chars) as server environment variables. Never put these in source code.
6. Submit `/sitemap.xml` in Google Search Console and use URL Inspection for important new preset URLs.

## Preset files
The original ZIP did not contain the `uploads/` binary directory. Existing database records therefore contain metadata but their original downloadable files are not bundled. Re-upload/restore those binaries on the deployed server or persistent storage.

## Local run
```bash
cd backend
npm install
cp .env.example .env
# edit .env
npm start
```

The server serves the frontend from `../frontend`.

## AdSense / SEO note
AdSense approval and Google Search ranking/indexing are controlled by Google and cannot be guaranteed by code. The project is configured for crawlability, unique preset pages, structured data, sitemap submission and clear navigation.
