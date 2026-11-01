# PresetHub code audit (v3.21.0)

Static audit of backend, frontend, privacy, security and launch configuration. Method: route auth coverage scan, XSS sink scan, inline-handler and CSP check, rate-limit review, secret and default-credential scan, dependency usage, syntax, links, requires, and behavioural tests of auth, permissions, coupons, boosts, streaks and payouts. Runtime and live-service behaviour (Clerk, Cashfree, MongoDB, Telegram) is NOT tested here.

## Fixed in this version

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| 1 | High | CSP blocked inline `onerror`/`onclick` handlers: preset image placeholders and the creator "Try again" button never ran. | Delegated capturing `error` listener with `data-ph-img` modes; `data-cd-reload` button. |
| 2 | High | After the Clerk migration, `authLimiter` (15 requests / 15 min per IP) covered `GET /api/auth/me`, which every page load calls. Normal users could be rate-limited quickly. | Limit now counts writes only (30 / 15 min). |
| 3 | High | `writeLimiter` (60 / min) counted GET requests, so browsing presets, shayari and comments could hit 429. | Limiter skips GET, HEAD and OPTIONS. |
| 4 | Medium | General API limit (300 / 15 min) too low for shared and mobile IPs (carrier NAT). | Raised to 1200, configurable with `API_LIMIT_PER_15MIN`. |
| 5 | Medium | Telegram `/link CODE` had no attempt limit; a 6-digit code could be guessed within its 10-minute life. | Max 5 attempts per Telegram user per 10 minutes. |
| 6 | Medium | Inline AdSense `push` in `index.html` blocked by CSP. | Moved to `frontend/ads-init.js`. |
| 7 | Medium | Privacy policy described old password and YOUPI processes. | Rewritten (v3.20). |
| 8 | Low | Cookie banner "Reject" less prominent than "Allow". | Same style (v3.20). |
| 9 | High (earlier) | Admin had one role; no MFA; no audit trail for role changes. | Roles, server-side permissions, Clerk MFA gate, audit log (v3.18 to v3.20). |

## Checked and found acceptable

- Admin routes: all behind `router.use(auth, isAdmin)`, then the role guard (v3.20).
- Public mutating routes: Cashfree and YOUPI webhooks are signed; preset and text counters are public by design and covered by the general limiter.
- Error handler: production returns a generic 500 message, no stack traces to clients.
- No mass assignment: no `req.body` is written directly to the database; updates use explicit field lists.
- XSS: user-controlled values in innerHTML go through `esc()`. Remaining interpolations are numbers, dates, or internal icons.
- Secrets: no hardcoded keys or default passwords in code; `.env` and `render-environment.txt` are excluded from the zip.
- CORS: allow-list of site origins only.
- Dependencies: all 19 declared packages are used.
- Clerk tokens: verified with JWKS and the authorized-party list; bot tokens need `purpose: "bot"`.

## Open (recommended next work)

| Severity | Item |
|----------|------|
| Closed in v3.23 | Legacy `bcryptjs` and the stored admin password were removed. The `password` schema field remains as an unused legacy column. |
| Medium | `csrfProtection` only checks the `ph_auth` cookie, which no longer exists; it is effectively off. Bearer tokens are not sent automatically by browsers, so CSRF risk is low, but remove or document. |
| Medium | Full HTTP access logs (DPDP guide: keep at least one year). Only admin actions are logged now. |
| Medium | Off-site database backups; backups currently live on the server disk. |
| Low | Dead code: the password login state block in `bot.js` and the `loginStates` map. |
| Low | Anonymous view/copy/share counters can be inflated; add per-IP or per-session de-duplication. |
| Low | Homepage content loads through API after JavaScript (SEO: pre-render). |
| Low | Server-side Meta Conversions API not built. |
| Setup | Enable 2-step verification for every admin in Clerk (the app enforces it); enable Clerk bot protection. |
| Setup | Google OAuth credentials in Clerk, and placeholders in privacy and refund pages. |

## Live tests still required
Clerk sign-in and MFA gate; Cashfree sandbox payment, coupon, boost, tip and webhook replay; Telegram `/link`; payout request and admin payment; refund; data export; account deletion; Search Console live test after the robots and www fixes.
