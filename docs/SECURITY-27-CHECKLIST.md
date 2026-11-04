# 27-step AI app security checklist: PresetHub v3.25.2

Based on "The 27-Step AI App Security Checklist". Method: read-only code inspection of the whole project plus the offline tests listed at the end. **Nothing is marked PASS without evidence.** This is not a certification and not a penetration test.

Legend: PASS = verified in code/config and (where noted) by a test that was run. NEEDS REVIEW = cannot be verified from the code; an action for you is listed. 

| # | Check | Status | Evidence / action |
|---|-------|--------|-------------------|
| 1 | Proper authentication | PASS | bcrypt login, JWT (HS256 pinned) in httpOnly cookie, account lockout per account+IP, session revocation on password change. Admin two-step verification (TOTP) added in 3.25.2 and tested against RFC 6238 vectors. It is opt-in per admin: **turn it on** (Admin → System). |
| 2 | Hide API keys | PASS | Secrets only from environment variables (`render.yaml` uses `sync: false`). `security:check` scans for committed keys. The only keys in the frontend are public by design (AdSense client ID, VAPID public key). |
| 3 | Secure the database | NEEDS REVIEW | Code side is PASS (NoSQL-operator guard, `select:false` on secrets, TTL indexes). The MongoDB Atlas network allow-list and the database user's privileges are outside the code: allow only your host, use a least-privilege user. |
| 4 | Enforce HTTPS | PASS | HTTP→HTTPS redirect (Host header allow-listed), Helmet HSTS, `Secure` cookies in production. Verify live: `curl -I http://presethub.site`. |
| 5 | Hash passwords | PASS | bcrypt cost 12 (`utils`/`routes/auth.js`); reset tokens stored as SHA-256. |
| 6 | Server-side validation | PASS | express-validator on signup/login/uploads/payments; signup now also requires Terms and 18+ confirmation server-side; length caps and `clean()` in the bot. |
| 7 | XSS | PASS | Output escaping (`esc()`), CSP without inline/eval scripts (tested by `security:check`). Informational: `style-src` still allows `'unsafe-inline'`. |
| 8 | Logging and monitoring | PASS | Admin alerts (in-app, Telegram, email), failed-login alerts, audit log of admin actions, bot errors with reference codes. |
| 9 | Lock down admin routes | PASS | `router.use(auth, isAdmin)` plus per-role permissions, admins cannot block/delete other admins, bot admin commands also need role + allow-list. |
| 10 | Parameterized queries | PASS (N/A for SQL) | MongoDB with Mongoose; user text used in regex is escaped; `$`-operators stripped by `securityGuard`. |
| 11 | Environment variables | PASS | `.env` ignored, `.env.example` documented, `security:check` fails if a documented variable is unused (this found the dead `ADMIN_MFA_REQUIRED`, now removed). |
| 12 | Rate limiting | PASS | Global API limit, login/signup/reset limiters, upload and text limits, consent endpoint limit, per-user limits in the Telegram bot. |
| 13 | CORS | PASS | Allow-list of own origins, no credentialed cross-origin access. |
| 14 | Security headers | PASS | Helmet (CSP, HSTS, frame-ancestors, nosniff), Referrer-Policy, Permissions-Policy (geolocation now allowed for the site itself, because the "nearby creators" feature needs it). |
| 15 | Session cookies | PASS | httpOnly, SameSite=Lax, Secure in production (checked by `security:check`). |
| 16 | CSRF | PASS | Double-submit token for cookie sessions; the consent endpoint sends it too. |
| 17 | Password-reset links | PASS | Random token, hash stored, 30-minute expiry, single use, other sessions revoked. |
| 18 | File uploads | PASS (one Medium risk) | Extension + magic-byte + ZIP checks, size limits, GridFS storage, access check before paid downloads. Open: files are buffered in RAM (see below). |
| 19 | Server-side price/payment checks | PASS | Prices and coupons computed on the server, Cashfree webhook HMAC + amount re-check, atomic order state changes. |
| 20 | Debug mode off | PASS | `NODE_ENV=production` in `render.yaml`; the error handler hides internals in production. |
| 21 | Update vulnerable dependencies | NEEDS REVIEW | No `package-lock.json` and no network in the review environment, so `npm audit` was **not run**. Run `npm install` once in `backend/`, commit the lock file, then `npm audit --omit=dev` (CI does this weekly). |
| 22 | Remove unused packages | PASS | Script check: 0 unused and 0 undeclared dependencies. |
| 23 | Exposed files and directories | PASS (verify live) | Static root is `frontend/` only, dotfiles denied, `/uploads` disabled, backups are outside the web root and now encrypted. Verify live: `/.env`, `/backend/server.js`, `/backups/` must all return 404. |
| 24 | Git history secrets | NEEDS REVIEW | The zip has no `.git` folder. Run `gitleaks detect` (or `trufflehog git file://.`) on the real repository. |
| 25 | Rotate compromised credentials | NEEDS REVIEW | Rotate any key that was ever pasted into chat, email, a screenshot or a zip: `JWT_SECRET`, `PAYOUT_ENC_KEY` (re-encrypt payout data first), Cashfree/Youpi keys, `BOT_TOKEN`, `RESEND_API_KEY`, MongoDB password, VAPID keys. |
| 26 | Comprehensive review | PASS (with limits) | All routes, middleware, the bot and the frontend scripts were read. `routes/admin.js` (2,200 lines) was sampled on its guards, refund, status and support flows, not every line. |
| 27 | Test protections and report | PASS (with limits) | See "Tests executed". No live penetration test was done. |

## Findings by severity (this review series)
| Severity | Found | Fixed | Still open |
|----------|-------|-------|------------|
| Critical | 0 | 0 | 0 |
| High | 3 | 3 | 0 |
| Medium | 9 | 8 | 1 (uploads buffered in RAM) |
| Low | 9 | 8 | 1 (no lock file / `npm audit` pending) |
| Informational | 3 | 2 | 1 (`style-src 'unsafe-inline'`) |

High: free-Pro endpoint with no ad proof; service worker cached private API data; admin two-step verification promised in the policy but absent. Medium examples: lockout abuse, Telegram link brute force, plain-text backups with password hashes, `geolocation=()` header breaking a feature, signup without consent record.

## Top five risks that remain
1. Dependencies were not audited (item 21).
2. Atlas network/user settings are unverified (item 3).
3. Git history and previously shared secrets are unverified (items 24-25).
4. Large uploads held in memory can exhaust a small instance.
5. Admin two-step verification is optional until each admin turns it on.

## Tests executed (offline, no network)
- `npm run bot:test`: 60 checks of the Telegram bot (commands, buttons, errors, admin rules, privacy).
- `npm run consent:test`: 8 checks of the cookie banner and tracker loading in a fake browser.
- `npm run totp:test`: RFC 6238 vectors, replay-safe verification, backup codes.
- `npm run security:check`: 26 static checks (secrets, JWT, cookies, CSP, routes, privacy claims).
- Earlier: lockout, coupon, dedupe and backup-encryption round trips.

## Not executed
Live scanning, authenticated penetration testing, load testing, `npm audit`, MongoDB Atlas configuration review, Git-history scan.
