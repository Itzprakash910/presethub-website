# PresetHub – Audit & Fix Report

## CRITICAL (fixed / action needed)
| # | Problem | Fix |
|---|---------|-----|
| 1 | `backend/.env` was inside the zip: JWT secret + Razorpay key/secret exposed | Removed, `.env.example` added. **You must rotate these keys.** |
| 2 | `.gitignore` was named `". gitignore"` (space) so Git ignored nothing → `.env` and `db.json` get pushed | Renamed to `.gitignore` |
| 3 | `/uploads` served statically → anyone downloads **paid** presets by URL, bypassing payment | Preset files moved to `private_uploads/`, only via authenticated download route |
| 4 | Admin panel: names/emails inserted with `innerHTML` → stored XSS steals admin token | All output escaped, inline `onclick` removed, CSP added |
| 5 | Fallback JWT secret `'supersecretkey'` | Server refuses to start without a 32+ char secret |
| 6 | Admin password hash in `db.json` is 59 chars (invalid) → admin can never log in | `npm run create-admin` script |
| 7 | `index.html`, `app.js`, icons were **empty (1 byte)** | Rebuilt: new `index.html` + `app.js` (CSP-safe, no inline scripts), icons regenerated |

## HIGH
- Role was trusted from the JWT for 7 days → now re-read from DB on every request.
- Uploads were auto-`approved` (moderation bypass) → now `pending` (admin approves).
- Public API leaked `fileUrl`, user emails, roles, wishlist → whitelisted fields only.
- `socialLinks`/`avatar` accepted `javascript:` URLs → only http/https, key whitelist.
- Wide-open `cors()`, no rate limit, no Helmet → CORS allow-list, rate limits, Helmet CSP.
- Payments: order ownership not checked in `/verify`, non-constant-time compare, `err.message` leaked, float rounding on paise → all fixed.
- Reviews: rating could be NaN/999, unlimited reviews & "helpful" votes per user → validated, one per user.
- `multer` 1.x has known DoS CVEs → upgraded to 2.x; `.gif` previews removed; random file names; magic-byte check.
- Header injection via preset name in `Content-Disposition` → sanitized.
- `?q=a&q=b` crashed search (`toLowerCase` on array) → coerced to string.

## LOGIC BUGS
- `POST /presets/featured/download` was unreachable (caught by `/:id/download`) → route order fixed.
- Downloads counter increased on every click → once per user.
- Fake "Demo preset" text was delivered when file missing (even for paid) → 404.
- Revenue counted unpaid orders → only `paid`.
- `db.json` writes were non-atomic → temp file + rename, serialized.
- `dotenv` path depended on the working directory → absolute path.
- Bio could not be cleared (`if (bio)`) → fixed.
- Admin panel used the public list (approved only) → new `GET /admin/presets`.
- `lowdb`, Firebase env vars unused → removed.

## PWA
- `sw.js` `cache.addAll` failed because icons didn't exist → PWA never installed. Now resilient.
- Service worker cached `/api/*` (stale/private data) → API, uploads, admin are never cached.
- Manifest icons pointed to missing files; `any maskable` combined → real 192/512/maskable icons generated.

## UI / UX
- Dark mode was half-implemented (comment "and so on…") → full token system.
- Accent `#d4a373` text on white = 2.2:1 contrast → `--accent-text` (AA).
- Hindi text: Inter has no Devanagari → Noto Sans Devanagari fallback, line-height 1.6.
- Mobile: `.hero-badge` caused horizontal scroll, tap targets 42px → 44px, bottom-sheet modal, 2-col grid.
- Added: focus-visible, skip link, reduced-motion, skeleton loaders, fade-up animation, touch-hover fix.

## Not changed (your decision)
- Token in `localStorage` (XSS-exposed). CSP now limits the risk; httpOnly cookies + CSRF token is the stricter option.
- JSON file DB is fine for a demo, not for real traffic/concurrent servers. Use Postgres/MongoDB later.
- Email verification / password reset not implemented.
- Font Awesome CDN has no SRI hash; self-host it for full control.

## v1.2 additions
- Profile edit, public creator page + Follow, Wishlist, My Downloads, My Presets (with delete).
- Railway: root `package.json` + `railway.json`, `/health`, `DATA_DIR` (Volume), auto admin bootstrap, trust-proxy, `0.0.0.0` bind.
