# Security review: PresetHub v3.25.2

> Newer and more complete: `SECURITY-27-CHECKLIST.md` (item-by-item status with evidence) and `PRIVACY-COMPLIANCE-CHECKLIST.md`.

Method: manual source review of the backend (server, auth, payments, Cashfree, uploads, admin, bot, users, presets, texts, chat, comments, reviews, collections, share), the frontend (escaping, service worker) and the config files. No live penetration test and no `npm audit` (no network in the review environment): run `npm run security:check` and `npm audit` on your side.

## Fixed in this version
| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| 1 | High | `POST /api/users/ads/watched` gave 10 free Pro days per 10 calls with no proof of an ad view | Endpoint disabled (410) |
| 2 | High | Service worker cached every API GET except a short blocklist, so creator earnings, payout details, notifications, the personal feed and even paid preset files could be stored on the device and read offline by the next user | Allowlist of public endpoints only; old caches purged (`presethub-api-v8`); cache also cleared on logout |
| 3 | Medium | Admin and creator pages were served with a public 5-minute cache | `no-store` now sticks for private pages |
| 4 | Medium | Account lockout keyed by email only: anyone could lock any user (or the admin) out | Key = email + IP, plus a 5x higher per-account ceiling |
| 5 | Medium | Telegram `/link` 6-digit code could be guessed from many throw-away Telegram accounts | Global attempt ceiling (40 / 10 min) |
| 6 | Medium | HTTP to HTTPS redirect used the raw `Host` header | Redirects only to owned hosts |
| 7 | Medium | Open endpoint could add unlimited keys to `shareStats` (document bloat) | Fixed platform list |
| 8 | Low | View and impression counters inflatable in a loop | One count per visitor per window |
| 9 | Low | Login response time revealed whether an email is registered | Dummy bcrypt for unknown emails |
| 10 | Low | JWT algorithm not pinned | `HS256` pinned on every sign and verify, including download tickets |
| 11 | Low | `security.txt` had no `Expires` and was not at `/.well-known/` (dotfile folders are denied) | Served explicitly at `/.well-known/security.txt` |
| 12 | Low | Coupons: leaked uses, applied to tips/boosts, unlimited reuse per user | See changelog |

## Added
- `SECURITY.md`: reporting policy and the go-live checklist.
- `backend/scripts/security-check.js` (`npm run security:check`): 14 static checks (secrets, JWT, cookies, CSP, admin guard, service worker, security.txt, unauthenticated write routes, dangerous APIs).
- `.github/workflows/security.yml`: runs the checks and `npm audit` on every push and weekly.
- `.github/dependabot.yml`: weekly dependency update pull requests.

## Open items (not changed)
- **No `package-lock.json`**: builds are not reproducible and `npm audit` is weaker. Run `npm install` once in `backend/` and commit the lock file, then switch CI and Render to `npm ci`.
- **Uploads are buffered in RAM** (up to 300 MB per bulk request): a few parallel uploads can exhaust a small instance. Stream to GridFS.
- **Lockout and dedupe counters are in memory**: they reset on restart and are not shared across instances.
- **Signup says "User already exists"** (email enumeration; a common trade-off).
- **Bearer token in `localStorage`**: the strict CSP limits XSS risk, but the httpOnly cookie is the safer path. Consider dropping the stored token.
- **`CASHFREE_ENV=sandbox`** in `render.yaml`.
- Refunding an order whose earnings were already paid out does not create a negative creator balance.

## Verified as sound
Webhook HMAC with timestamp and server-side amount check, atomic order state changes, GridFS access checks on paid files, magic-byte and ZIP checks, AES-256-GCM payout encryption, CSRF double-submit, session revocation on password change, role-based admin permissions with an audit log, frontend output escaping (`esc()` on user fields and attributes), search regex escaping, no `eval` or `child_process` in the backend.
