# PresetHub v3.25.2 — bug, security, bot and compliance fixes

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

## Round 5: Telegram bot rewrite (`backend/bot.js`, `utils/botKit.js`)
- One command registry drives every command, `/help`, the Telegram menu, "did you mean" suggestions and the inline buttons. 53 commands incl. `/free`, `/toprated`, `/top`, `/saved`, `/orders`, `/earnings`, `/referral`, `/privacy`, `/forgetme`, and admin `/support`, `/errors`, `/botstats`.
- New welcome (different for visitors, linked users, blocked accounts, admins) with inline buttons and a persistent reply keyboard; deep link `/start preset_<id>`.
- Inline UI: preset cards (Download, Like, Save, Share, Open), paged lists with filters and sort, account hub, 7-step upload wizard with buttons, shayari browser and guided posting, account-help flow, admin panel with confirmations before Block and Reject.
- Wrong commands and buttons: mistyped commands get suggestions, missing arguments show usage and an example, stale buttons explain themselves, odd input is sanitised.
- Errors: classified (usage, auth, forbidden, not found, rate limit, server down, server error, database, Telegram), the user gets a clear message with a reference code, and serious errors reach the admin with the same reference. `/errors` and `/botstats` for admins.
- Fixed bugs from the old bot: the "❓ Help" keyboard button only sent the text "/help"; commands typed during upload became the preset name; the Pro text promised free paid presets; Markdown broke on names with `*` or `_`; preview photo failures were not caught; no ID validation before API calls; the bot could be stuck "not started" because `launch()` never resolves, and a 409 during overlapping deploys was not recovered. `server.js` no longer re-starts the bot every 15 s (the bot restarts itself with backoff).
- Docs: `docs/BOT-GUIDE.md` (generated from the registry). Tests: `npm run bot:test` (60 checks).

## Round 6: PDF checklists (27-step security + India privacy playbook)
- **Admin two-step verification** (TOTP, no new packages): setup and backup codes in Admin → System, login asks for the code, each code works once. The old `ADMIN_MFA_REQUIRED` setting did nothing and the Privacy Policy claimed a feature that did not exist; both fixed.
- **Consent**: granular cookie banner (Analytics / Advertising / Marketing, Reject, Customize, withdraw from the footer), GA4 and Meta Pixel now wait for their own purpose, every choice is recorded (3 years, no IP). Signup requires Terms/Privacy acceptance and an 18+ confirmation and stores the record. Cookie Policy now has the tool table.
- **No placeholders**: the Privacy and Refund pages read business and grievance-officer details from `LEGAL_*` / `GRIEVANCE_*` variables (`/api/legal/contact`); fallbacks are truthful.
- **Policy matches the code**: Google AdSense, Telegram, push, location, fonts and retention periods are disclosed; account deletion no longer deletes order records the policy says are kept.
- **Data minimisation**: the bot stores no profile for visitors who have not linked an account (old placeholder profiles are purged); unlinking removes the stored Telegram profile; support requests expire after one year.
- **Backups are encrypted** (AES-256-GCM, `BACKUP_ENC_KEY` or derived from `PAYOUT_ENC_KEY`) with `scripts/decrypt-backup.js`.
- **Bug**: `Permissions-Policy: geolocation=()` blocked the "nearby creators" feature; now `geolocation=(self)`.
- Docs: `docs/SECURITY-27-CHECKLIST.md`, `docs/PRIVACY-COMPLIANCE-CHECKLIST.md`, `docs/DATA-MAP.md`, `docs/INCIDENT-RESPONSE.md`. `npm test` runs bot, consent, TOTP and security checks (26 static checks).

## Round 7: Share Preset QR (screenshot bug)
- **Cause of "QR image is temporarily unavailable":** the QR came from a third-party service (quickchart.io) that was unreachable, and every shared link was being sent to that service. QR codes are now generated in the browser by `frontend/qr.js` (no service, works offline). The encoder was checked with a real decoder (OpenCV) on 2,100+ codes: versions 1-10, every mask, all four error-correction levels, Unicode.
- **New QR card** (`frontend/share-card.js`): preview image, preset name, creator with follower count, rating and review count, likes, views, downloads, price, category, the QR, the short link and the site name. Buttons: **Download QR Card** (PNG), **QR only** (PNG), **Share image** (where the phone supports it) and **Copy Short Link**. "Copy Image + Link" is removed. If the preview image or creator data cannot be loaded, the card still builds; if the card fails, a plain working QR is shown.
- **Scanning opens the full website with the preset**: the short link goes straight to `/?preset=<id>` (preview, download or buy, like, save, comments, reviews, share), not to the static SEO page. QR scans are counted separately (`?src=qr`). The SEO preset page's "Open & Download" button now opens the same view instead of the home page.
- **Bugs found while testing**: the one-time service-worker reload could interrupt a visitor and drop a deep link (now it waits until no dialog is open, and `?preset=` stays in the address bar); server-rendered pages still requested old asset versions (`?v=3.2.0`/`3.4.0`).
- Tests: `npm run qr:test` (7), `python3 backend/scripts/e2e/share-qr.py` (15 checks in headless Chromium: deep link, card, both downloads, QR decoded from the PNGs, failure cases), `security:check` (28).

## Config
- `render.yaml`: note added that `CASHFREE_ENV` is `sandbox` (test mode). Switch to `production` for real payments.
- Cache-bust version `?v=3.25.2` on frontend assets and service worker.

## Known, not changed
- Uploads are buffered in RAM (up to 100 MB per preset, 300 MB per bulk request). Consider streaming to GridFS on a small Render instance.
- Lockout counters are in memory (reset on restart).
- Signup still says "User already exists" (email enumeration trade-off).
- Admin refund of an order whose earnings were already paid out reduces the creator's balance only down to zero (no negative balance), so that money is not recovered automatically.
- `GET /api/users/:id/earnings` shows gross sales (not the creator share) and a `canWithdraw` flag that the real payout flow does not use.
