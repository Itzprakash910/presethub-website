# PresetHub Final QA Patch – v3

## Frontend
- Fixed dead header buttons by wiring `data-action` handlers for login, signup, upload, theme, account and close.
- Replaced hero placeholder illustration with a real top/popular preset preview loaded from API.
- Added stable image fallback + cache-busting for preset posters and profile avatars.
- Added selected-preset checkboxes; **Download selected** remains hidden until a selection exists.
- Changed marketplace layout to 4 columns desktop / 3 tablet / 2 mobile.
- Added professional Top Creators cards and three-dot action menu.
- Added QR share sheet, short link copy, native share and image+link copy fallback.
- Added public profile Message button and 24-hour in-memory chat polling.
- Added creator profile navigation from review/comment author names.
- Added preset Edit/Delete controls in My Presets.
- Added dark/light compatible search result sheet with backdrop blur and bordered results.
- Added stronger footer, legal/info pages and back buttons.
- Added PWA icons, manifest and resilient service worker caching.

## Backend
- Rebuilt missing route modules required by `server.js`.
- Preset files are stored privately and are delivered only through authenticated download.
- Preview/avatars are public static assets only.
- Upload size/type limits and randomized filenames are enforced.
- JWT secret is mandatory (32+ chars); no insecure fallback.
- CORS is restricted in production; request body limits reduced.
- Helmet/security headers enabled; `x-powered-by` disabled.
- Admin authorization is checked server-side.
- Added preset CRUD, likes, views, shares, reviews and moderation endpoints.
- Added authenticated profile/follow/wishlist/download/notification routes.
- Added payment endpoints with server-side Razorpay order/signature verification; paid-preset activation remains optional.
- Added ephemeral chat API: messages expire after 24h and are not stored in the database.
- Added view milestone notifications (50/100/150/200/500/1000) with clickable preset links.

## Telegram
- Removed hard-coded bot credentials from source.
- Website server starts the Telegram bot in the same Node process when `BOT_TOKEN` is configured.
- Telegram command menu is registered automatically.

## Google AdSense / SEO
- Added standard AdSense loader for publisher `ca-pub-3554311294133493`.
- Added `google-adsense-account` metadata.
- Added `frontend/ads.txt`.
- Added expanded SEO metadata, Open Graph/Twitter metadata and structured WebSite/Organization data.
- Added dynamic `/preset/:id` social metadata so shared preset links can show title, description and preview image.

## Important security note
Browser HTML/CSS/JS must be public for a website to work. The patch protects secrets/private preset files and server endpoints; it does not pretend that frontend source can be hidden from a determined browser user.
