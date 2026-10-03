# PresetHub Final QA v3

### Automated checks
- Node.js syntax check: PASS for all `.js` files.
- JSON parse check: PASS for `package.json` and `manifest.json`.
- Private `backend/db.json` removed from distributable ZIP.
- No real Telegram token/Razorpay secret/JWT secret included in ZIP.
- AdSense publisher ID is intentionally public and appears in frontend/ads.txt.

### Main functional checks covered by code review
- Login/signup buttons
- Theme toggle
- Upload modal and multipart upload
- Preset poster fallback/cache busting
- Avatar fallback/cache busting
- Preset list responsive layout
- Selection toolbar visibility
- Preset download authorization
- Preset edit/delete
- Likes/wishlist
- Reviews
- Share + QR + short link
- Creator menu/profile/follow
- Profile message/chat expiry
- Notifications and milestone links
- Admin server authorization
- Telegram command registration
- PWA offline public-cache strategy
- AdSense and SEO metadata

### Deployment requirement
Set `backend/.env` (or Railway variables) with a strong `JWT_SECRET`. Set `BOT_TOKEN` only if the Telegram bot should run. Keep `DATA_DIR=/data` on Railway for persistence.
