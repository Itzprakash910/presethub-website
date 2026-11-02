# PresetHub v3.24.0 — password login restored, Clerk removed, ads as preset cards, shared footer

## Login and signup (Clerk removed)
- Clerk sign-in is removed from the backend and the frontend (`clerk-bridge.js` deleted, `utils/clerk.js` deleted, `@clerk/backend` removed).
- Login, signup, logout, profile, change password, forgot and reset password, and account deletion use the original email and password flow (restored from the pre-Clerk build). Cookie session `ph_auth`, CSRF protection and rate limits apply again.
- `bcryptjs` is back: passwords are stored only as bcrypt hashes.
- Account deletion asks for the password (as before).
- The admin "temporary password" action works again.
- `ADMIN_PASSWORD` (optional) sets the admin password at startup, hashed. `ADMIN_EMAIL` still grants the admin role.
- Admin role checks (super, operations, finance, marketing, support) and refund limits are kept.
- Kept from the newer build: data export (`GET /api/auth/my-data`), Telegram link code (`/bot-link-code`, `/link CODE`), bot token with session version.
- Note: the admin MFA gate was a Clerk feature and is not in the password flow. Use strong passwords for admin accounts.

## Ads look like presets
- The home sponsored slot renders as a preset card: same thumbnail size, title, creator line, stats and "Open" button. The "Sponsored" label is kept.
- Clicking the image, the title, the creator line or the button opens the advertiser link in a new tab (http and https only).

## Footer everywhere
- Server-rendered pages (preset detail, shayari pages, lists, profiles) use the same footer as the static pages, loaded from `frontend/index.html` (`backend/seo/footer.js`).

## Wording
- Privacy policy and cookie policy describe the password login and the `ph_auth` cookie. The Clerk entries are removed.

## Environment
- Remove `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` from Render.
- Optional: set `ADMIN_PASSWORD` (12+ characters).

## Not run here
- Sign-in, signup, reset and account deletion must be tested live. The restored code comes from the pre-Clerk build and is checked by syntax, requires and route matching only.
- The exact v3.3.0 zip was not available in this workspace. The restored code is the closest copy found (the pre-Clerk build in the uploaded snapshot). If you need byte-for-byte v3.3.0, upload that zip and it will be restored from it.
