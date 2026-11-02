# PresetHub v3.25.1 — bug and security fixes

## Bugs fixed
- **Admin/creator pages were cached publicly** (`server.js`): `no-store` was overwritten by `public, max-age=300`. Private pages now stay `no-store`.
- **Coupon uses leaked** (`routes/cashfree.js`): a use reserved at checkout is now given back when the order expires, is cancelled or fails.
- **Coupon scope**: coupons now apply only to presets and Pro plans (not tips or boosts), and each account can use a coupon once after a paid order.
- **Pro vs paid presets** (`routes/presets.js`): `/download` and `/bulk-download` let Pro users through, but `/file` then returned 403 (and a download was counted). Paid presets now always need a purchase, consistently. Pro keeps ad-free, badge and 30-item bulk download. To make Pro include paid presets instead, change `/:id/file` and `/media/:id` too.
- **Password rules in the UI**: signup, reset and change-password forms require 10 characters (matching the server). Login no longer blocks older, shorter passwords.
- **Rate-limit alert** now reports the real limit instead of a fixed "300".

## Security
- **Login lockout** is now keyed by account + IP, so a stranger can no longer lock a real user (or the admin) out. A higher per-account ceiling (5x) still blocks distributed guessing.
- **Login timing**: unknown emails now run the same bcrypt work, so timing no longer reveals registered emails.

## Round 2 (users, admin, bot review)
- **Free Pro exploit closed** (`routes/users.js`): `POST /api/users/ads/watched` gave 10 Pro days for every 10 calls with no proof an ad was watched, and the website never uses it. It now returns 410. Re-enable only with server-side ad verification.
- **Telegram link code** (`bot.js`): added a global attempt ceiling (40 per 10 minutes) so the 6-digit code cannot be guessed from many throw-away Telegram accounts.
- Reviewed and found sound: admin role guard and audit trail, refund flow, payout balance and race guard, block/delete protection for admins.

## Round 3 (second full review: presets, shares, texts, payments)
- **Share stats could bloat a preset document** (`routes/presets.js`): `POST /presets/:id/share` is open to anyone and created a new `shareStats.<platform>` key for every distinct text. It now accepts a fixed list of platforms (others count as `other`).
- **View and ad-impression counters could be inflated** by calling the open endpoints in a loop (this also pushed presets up the Featured ranking and triggered milestone notifications). Presets and text posts now count one view per visitor per 30 minutes (impressions: 5 minutes), via `utils/dedupe.js`. Views are counted only for approved presets.
- **Abandoned checkouts never closed** (`utils/cashfree.js`, `routes/cashfree.js`, `server.js`): Cashfree orders expired after 30 days, so unpaid orders stayed open and held coupon uses. Orders now expire after 60 minutes, and a sweeper (every 15 minutes) closes stale orders, releases their coupon use, and still fulfils a late PAID one.
- **Short links** (`routes/share.js`): the platform value is validated, an existing link for the same preset and platform is reused, and each user is capped at 1000 links.
- **Preset upload and edit**: single uploads now clean tags the same way as edits (max 10, 30 characters each) and clamp the price; editing can no longer set an empty preset name.
- **`GET /presets/featured`** joined every comment on every request; the result is now cached for 60 seconds.

## Round 4 (security review)
- **Service worker cached private API data** (`frontend/sw.js`): now an allowlist of public endpoints only; old caches are purged and the cache is cleared on logout (`app.js`).
- **Host-header-safe redirects** (`server.js`) and **`/.well-known/security.txt`** (with `Expires`).
- **JWT algorithm pinned to HS256** on every sign/verify, including preset download tickets.
- **New files**: `SECURITY.md`, `docs/SECURITY-REVIEW.md`, `backend/scripts/security-check.js` (`npm run security:check`), `.github/workflows/security.yml`, `.github/dependabot.yml`.

## Config
- `render.yaml`: note added that `CASHFREE_ENV` is `sandbox` (test mode). Switch to `production` for real payments.
- Cache-bust version `?v=3.25.1` on frontend assets and service worker.

## Known, not changed
- Uploads are buffered in RAM (up to 100 MB per preset, 300 MB per bulk request). Consider streaming to GridFS on a small Render instance.
- Lockout counters are in memory (reset on restart).
- Signup still says "User already exists" (email enumeration trade-off).
- Admin refund of an order whose earnings were already paid out reduces the creator's balance only down to zero (no negative balance), so that money is not recovered automatically.
- `GET /api/users/:id/earnings` shows gross sales (not the creator share) and a `canWithdraw` flag that the real payout flow does not use.
