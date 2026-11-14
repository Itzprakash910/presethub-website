# PresetHub v3.25.5 — PageSpeed / console-error fix release

Based on the PageSpeed Insights reports (mobile + desktop, Nov 6 2026) and a code audit.

## Fixed
| Problem (report) | Cause | Fix |
|---|---|---|
| `…/auth/me` 401 ×4 in console (Best Practices 96) | Every page load asks `/api/auth/me`; logged-out visitors got 401 | `routes/auth.js`: no credentials at all → `200 {user:null}` (invalid/expired tokens still 401). `app.js`: guard in `openAccount()` |
| Render-blocking requests (80 ms desktop / 440 ms mobile) | `style.css` **and** `cookie-consent.css` blocked first paint | `cookie-consent.css` merged into `style.css`; link removed from all pages, `server.js` SEO head and `sw.js` |
| Hero image 1200×630 shown at ~550×290 (Improve image delivery) | One big PNG for every viewport | `hero-640.webp` + `srcset/sizes`; srcset dropped when the real featured preview replaces it |
| `/media/*` `net::ERR_FAILED` ×14 + 503 on API | GridFS streams kept running after the visitor cancelled; no `Content-Length`/304 → pool exhaustion under load | `/media`: ETag + 304, `Content-Length`, stream destroyed on client abort |
| Multi-MB preview images | Originals served for 500 px cards | Optional `/media/:id?w=320..1200` → WebP thumbnail via `sharp` (cached, max 2 parallel). Falls back to original if `sharp` missing. Cards/featured/hero request `?w=` |
| Minify JS/CSS, no compression | Sources served as-is | `utils/assetMinify.js`: esbuild minify + gzip/brotli in memory, `?v=` URLs cached 1 year, ETag/304. Sources in `/frontend` unchanged. `sw.js` excluded |
| Non-composited animations (`background-position`) | Skeleton shimmer | Shimmer now uses `transform` on `::after`; `prefers-reduced-motion` respected |
| "Links rely on color" (Accessibility 97) | Footer links (`@HeyOmii`) only coloured | Footer links underlined |
| llms.txt "Timed out fetching resource" | Served only by generic static handler | Explicit `/llms.txt` route (`text/markdown`, cached) |
| Image/font caching | No cache headers on static images | `Cache-Control: public, max-age=604800` for images/fonts |

## Other
- HSTS `includeSubDomains`/`preload` now switchable with `HSTS_INCLUDE_SUBDOMAINS=off`, `HSTS_PRELOAD=off`.
- Version bumped to 3.25.5 (all `?v=` URLs, `sw.js` cache names bumped so users get the new CSS/JS).
- `esbuild` and `sharp` added as **optionalDependencies** (install failure cannot break deploy).

## Not code bugs (action needed outside the ZIP)
- **503 on `/api/presets`, `/api/texts`, `/api/features/*`** are not returned by this code (only `/media` returns 503 when Mongo is not connected). They come from the host/proxy (cold start or overload on Render) — keep the instance warm (ping `/healthz`), use a paid/always-on plan, and check Mongo Atlas connectivity.
- Existing 2.29 MiB GridFS previews: thumbnails now fix delivery size; re-uploading as WebP still saves storage.
- Remaining "Reduce unused JS (55 KiB)" needs splitting `app.js` into route-level chunks (larger refactor).

## Deploy-log follow-up (Render, commit c9321d9)
- **Telegram 409 loop**: restart back-off was reset to zero as soon as the bot "started", so it retried every 20 s forever and kept kicking the other instance out. Now: back-off resets only after 90 s of stable polling, 409 waits 1→10 min with a clear log message, and the command menu is set once per process (stops the 429 flood).
- **Mongoose duplicate index warning** (`createdAt`): removed the extra `index: true` on AuditLogEntry (TTL index already covers it).

## Multi-tab audit fixes (approved #1–#4)
- **Cross-tab auth sync** (`app.js`): login, logout and account deletion are announced through a `BroadcastChannel('presethub-auth')`; other tabs re-read `/auth/me`, close open modals and refresh (fixes "tab B still shows user X while the cookie belongs to Y").
- **Double checkout** (`routes/cashfree.js`): a second `create-order` for the same user + preset + coupon within 10 minutes returns the already-open unpaid order (`reused: true`) instead of creating another payable order. Other order kinds are unchanged.
- **Pending profile** (`app.js`): `presethub_pending_profile` now stores `{uid, payload, t}`; only the same account applies it, entries older than 7 days or without uid are dropped.
- Not changed (not approved): profile last-write-wins, coupon check on paid orders only, Youpi payment route.

## PhonePe Payment Gateway (Standard Checkout v2) — new third provider
- `utils/phonepe.js`: OAuth token (cached, single-flight, retried once on 401), `POST /checkout/v2/pay`, `GET /checkout/v2/order/{id}/status`, webhook auth (`Authorization = SHA256(username:password)`), paise amount check.
- `routes/phonepe.js`: `create-order`, `subscribe`, `tip`, `boost` (same validation/coupons as Cashfree via shared `registerCheckoutRoutes`), `webhook`, `refresh/:orderId`, stale-order sweep. Orders are fulfilled **only** after PhonePe's status API says `COMPLETED` and the amount matches; webhook body is never trusted alone.
- `routes/payments.js`: `activeProvider()` now Cashfree → PhonePe → YOUPI, or force with `PAYMENT_PROVIDER=phonepe`. Order model enum + all `provider $in` filters include `phonepe`. Return page `/refresh` dispatches to PhonePe.
- Frontend: PhonePe = full-page redirect to the hosted checkout (`app.js`, `creator.js` boost); coupon dialog unchanged, phone number not required.
- Env: `PHONEPE_ENV`, `PHONEPE_CLIENT_ID`, `PHONEPE_CLIENT_SECRET`, `PHONEPE_CLIENT_VERSION`, `PHONEPE_WEBHOOK_USERNAME`, `PHONEPE_WEBHOOK_PASSWORD`, `PAYMENT_PROVIDER` (also in `.env.example` and `render.yaml`).
- Test: `node backend/scripts/phonepe-selftest.js` (mocked API/DB, 12 checks).

## Full-project review fixes
- `server.js`: `unhandledRejection` (log + throttled admin alert, site keeps running) and `uncaughtException` (alert, graceful shutdown, Render restarts the instance).
- `routes/presets.js`: list filters accept plain strings only (`?category[$ne]=x` no longer reaches MongoDB), NaN-safe `page`/`limit`/`rating`.
- `frontend/features.js`: toast now forwards its duration (streak message was cut short); `app.js`: `loadCategories(force)` honours `force`.
- `.env.example`: documented `AUTO_PUBLISH_LEGACY_PENDING`, `RENDER_EXTERNAL_HOSTNAME`.
- CI (`security.yml`) now also runs `npm test` (bot, consent, totp, qr, fixes, phonepe self-tests + security check); `npm test` includes the PhonePe test.

## Multi-tab leftovers fixed
- **Profile lost-update** (`models/index.js`, `routes/auth.js`, `app.js`): new `profileRev` counter. The client sends the revision it last saw; if the profile was saved in another tab/device meanwhile, the server answers `409 PROFILE_CONFLICT` with the current profile (atomic compare-and-increment, so two simultaneous saves cannot both win). The tab adopts the latest profile, drops its queued retry and asks the user to save again. Requests without `baseRev` (offline replay) still work.
- **Coupon used twice from two tabs** (`routes/cashfree.js` `resolveCoupon`, shared by Cashfree and PhonePe): besides one paid use per account, a second *unpaid* checkout with the same coupon for a different item is refused for 30 minutes. Retrying the same item is not blocked (presets reuse their open order).
- New self-tests: `profile-selftest.js`, `coupon-selftest.js` (in `npm test` and CI).
- Known limit: two simultaneous *subscription* checkouts of the same plan with one coupon are not blocked (retry of the same item is intentionally allowed).
