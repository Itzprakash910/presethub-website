# PresetHub v2.9.6 — Security, Admin & Mobile UI Audit

## Scope
- Frontend HTML/CSS/JS, mobile header/search/menu/footer/PWA.
- Node.js + Express + MongoDB/Mongoose + GridFS.
- Authentication, CSRF, rate limiting, uploads, payment/webhook integrity.
- Admin authorization, user controls, notifications and home promotions.
- Service worker/cache and local icon assets.

## v2.9.6 changes
1. Header order changed for mobile/desktop: PresetHub brand → profile/avatar → messages → notifications → `•••` menu.
2. `•••` menu is no longer adjacent to the logo and the profile is no longer at the old far-right position.
3. Admin link removed from the narrow header and exposed inside the authenticated `•••` menu only for admins.
4. Search result surfaces use a 2% color layer plus blur/backdrop blur so underlying content does not visually overpower result text.
5. Exit confirmation copy improved for browser back/external navigation. Browser tab close still uses the browser-native confirmation because custom `beforeunload` text is not supported.
6. Footer now includes Install App and the official PresetHub Telegram Bot link below Contact/help links across public pages.
7. Added `HomeAd` model and public `/api/ads/home` endpoint.
8. Added admin CRUD for personal home ads: photo URL, description, product, original/sale price, automatic discount percentage, CTA link, badge and active state, plus impressions/click tracking.
9. Added responsive Admin Console controls for platform analytics, user search, block/activate/delete, user details, preset moderation, broadcast notifications and ads.
10. Broadcast admin notifications are written in one MongoDB update and background Web Push is attempted for users with active subscriptions.
11. Added MongoDB backup coverage for home ads.
12. Removed unused `frontend/assets/source-assets-pack/` assets after reference scan confirmed no runtime references.
13. Added `backend/.env.example` with secret placeholders. Real credentials are intentionally not hard-coded into source.

## Existing security controls retained
- HttpOnly/SameSite auth cookie with Secure in production.
- Password hashing with bcrypt cost 12.
- Password reset tokens stored as SHA-256 hashes with expiry.
- Session-version invalidation after password change/reset.
- CSRF protection for cookie-authenticated API writes.
- Admin middleware on `/api/admin`.
- Owner/admin checks for preset management and protected resources.
- Paid download authorization and short-lived download tickets.
- Upload extension allowlists and image magic-byte validation.
- SVG preview/avatar uploads blocked.
- GridFS storage with generated storage keys; uploaded files are not executed/extracted.
- Preset download forced to attachment + `application/octet-stream` + `nosniff`.
- Rate limiting on authentication and write-heavy APIs.
- Helmet security headers/CSP/HSTS in production.
- Local icon pack and service-worker caching instead of Font Awesome CDN runtime dependency.
- Razorpay webhook verification uses the raw request body.

## Admin account security
The requested admin email/password are NOT embedded in source code. Render should provide:
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

The server can initialize/promote the configured admin email on startup. The current security policy requires a strong admin password; use a password of at least 12 characters with upper/lowercase letters and a number. Do not commit the password to Git or ZIP source files.

## Validation
- `node --check`: PASS for all JavaScript files.
- JSON parse: PASS for all JSON files.
- Duplicate HTML IDs: 0.
- Missing local HTML asset references: 0 after query-string-aware validation.
- Missing local icon CSS assets: 0.
- PWA shortcut assets: checked.
- ZIP integrity: checked after packaging.

## Production limitation
Live Render/MongoDB Atlas, Razorpay, VAPID delivery and DNS were not queried from this session. After deployment, verify environment secrets, Atlas network access, webhook configuration, push permission and real mobile devices.
