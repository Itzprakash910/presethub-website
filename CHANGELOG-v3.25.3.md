# PresetHub v3.25.3 — review fixes (bugs, logic, SEO, privacy)

## Bugs fixed
- **Users looked logged out on shared/mobile networks** (`routes/auth.js`): a second rate limiter inside the auth router counted `GET /api/auth/me` (called on every page load). After 15 calls in 15 minutes from one IP the API returned 429 and the app treated it as "not logged in". Reads are now skipped; only writes are counted.
- **Moderation was undone on every restart** (`server.js`): all `pending` presets were set to `approved` at each boot. Now opt-in via `AUTO_PUBLISH_LEGACY_PENDING=on` (one-time migration).
- **Paid but not fulfilled** (`routes/payments.js`): if fulfilment threw after the order became `paid`, nothing retried and nobody knew. The error is now stored on the order and a critical admin alert is sent.
- **Download counter inflation** (`routes/presets.js`): logged-out visitors counted a download on every call (also raised Featured ranking). Now one per visitor + preset per 30 minutes.
- **Referral**: the referrer was rewarded before the new account was saved (and with a read-modify-write that lost counts under load). Reward now follows a successful save and uses atomic `$inc`.
- **Signup scalability**: signup loaded every username in the database. Now an indexed lookup per candidate.
- **Account deletion** is blocked while a payout is `requested`/`approved` (money would be lost).
- **Logout** works even when the session already expired.
- **Graceful shutdown** (`server.js`): HTTP server and MongoDB are now closed before exit (10 s limit).

## SEO / analytics
- Missing presets, profiles and unknown URLs now return **HTTP 404** (they returned 200 with the home page = soft 404).
- `sitemap.xml`: duplicate URLs removed, cached for 1 hour (it ran 6 DB queries per request), only creators that have published presets, image URLs resolved with `seoAssetUrl`.
- Server-rendered pages (preset, profile, shayari, lists) now include the consent-gated `tracking.js`, so GA4 / Pixel work on the pages Google visitors land on.
- JSON-LD `aggregateRating` only when real reviews exist (was always at least 1). `hreflang` is `en-IN` (was `hi` on English pages).

## Security / privacy (DPDP)
- Password-reset token is removed from the address bar immediately and never sent to GA as page URL.
- Short-link clicks no longer store IP addresses; `ShareClick` rows expire after 180 days; click counter is atomic.
- `/me` and profile responses no longer include the Telegram link hash.

## Tests
- New `npm run fixes:test` (13 checks), included in `npm test`. Security check allow-list now includes public `POST /logout`.
- Asset cache-bust version `?v=3.25.3`.

## Still open (decisions for the owner, not changed)
- `CASHFREE_ENV=sandbox` in `render.yaml`; switch to `production` before real money.
- Admin two-step verification is optional per admin; consider enforcing it.
- Email is not verified at signup (`verified: true`).
- Uploads are buffered in RAM; lockout counters are in memory (reset on restart); backups live on Render's disk (copy off-site).
- Deleting a creator account also deletes presets that other people bought.
- Google Fonts are loaded from Google (privacy policy mentions it); self-hosting would remove that transfer.
