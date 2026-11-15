# AUDIT.md — PresetHub v3.25.5 pre-launch audit
(Checklist: "Pre-Launch Security Audit" by Mayank Shah, v2.0, adapted to this stack: Node/Express + MongoDB (GridFS) + vanilla JS, Cashfree/PhonePe/YOUPI payments, Telegram bot, no AI calls, no mobile app, no Supabase/Firebase.)
**This file lists weaknesses. It is git-ignored; delete it after the fixes are done. Do not serve or publish it.**

Scope: whole repository read + automated checks (syntax, TypeScript undefined-name scan, 9 self-test suites incl. 36 security checks, headless-browser smoke tests). Not possible here: live Preview/production settings, Git history, `npm audit` (no network).

## Summary
**Passed 52 · Fixed in this round 5 · Failed/open 2 · Need you (can't verify) 5 · Not applicable 9** (67 code checks; evidence is "Confirmed" unless stated)

## Fixed in this round
| ID | What | Change |
|---|---|---|
| 7.6 | Billing terms next to the pay button | Checkout dialog now says: one-time INR payment, no auto-renewal, link to Refund policy (`app.js`) |
| 11.1 | Wasteful polling | Ad-blocker check interval (every 3 s forever) now pauses when the tab is hidden and stops after its warning (`app.js`) |
| 12.3 | Deletion completeness | Account deletion now also removes Boost records and unlinks cookie-consent proofs (`routes/auth.js`) |
| 12.1 (+) | Missing policies | Added `copyright-policy.html` (notice-and-takedown, counter-notice, repeat infringers) and `community-guidelines.html`; linked in every footer and the sitemap |
| 9.2 (partly) | Version drift | All asset URLs now carry one release version (`?v=3.25.5`); `backend/.npmrc` added (`save-exact`, `audit-level=high`) |

## Open
| ID | Sev | Finding | Who |
|---|---|---|---|
| 9.2 | Medium | **No `package-lock.json`** in the repo and dependencies use `^` ranges, so every deploy can pull different versions. Evidence: no lockfile in root or `backend/`. | You: run `cd backend && npm install`, commit `backend/package-lock.json`, then use `npm ci` in the build command |
| 4.2 | Low | Public IDs are MongoDB ObjectIds (partly predictable). Ownership checks (3.1) pass, so impact is low. Left as is: changing IDs would break every URL. | Accepted risk |

## Need you (CAN'T VERIFY here)
- **1.2** Git history: no `.git` in the ZIP. If a secret was ever committed, rotate it. `.env` and keys are git-ignored.
- **4.4** MongoDB Atlas Network Access: confirm it is not `0.0.0.0/0` (or that a strong password + TLS are used) and that backups are enabled and restore-tested.
- **6.1** `TRUST_PROXY_HOPS` on Render must match the real number of proxies (normally `1`), otherwise IP rate limits see the proxy IP.
- **7.4** Render env: live keys only in production; sandbox keys for Preview/staging.
- **9.1** Run `cd backend && npm audit` (earlier deploy log showed 1 moderate + 1 high). Do not use `--force`.

## Findings (all 67)
### 1 Secrets and API keys
- 1.1 PASS — no key/DB-URL/secret patterns in `frontend/`; only public values (Turnstile site key, GA/AdSense IDs) ship to browsers.
- 1.2 PASS (files) · history CAN'T VERIFY — `.gitignore` covers `.env*`, `*.pem`, `*.key`, `AUDIT.md`, dumps, uploads.
- 1.3 PASS — secrets only via `process.env`; `server.js:127` refuses to start in production with a missing/short `JWT_SECRET`.
- 1.4 PASS — no log line prints tokens/passwords/keys; errors are generic in production (`utils/errorHandler.js`).
### 2 Login and sessions
- 2.1 PASS — `auth` middleware on private routes; `security-check.js` fails if any write route lacks login (only webhooks are whitelisted). Admin router: `router.use(auth, isAdmin)`.
- 2.2 PASS — bcrypt cost 12; admin created from `ADMIN_EMAIL/ADMIN_PASSWORD` env (≥12 chars, hashed), no default account; password policy in `utils/passwordPolicy.js`.
- 2.3 PASS — reset token = 32 random bytes, only the SHA-256 is stored, expires, single use; same public response for unknown emails (`auth.js:312-342`).
- 2.4 PASS — 15 requests/15 min on `/api/auth`, per-email+IP lockout, Turnstile + honeypot on public forms, per-hour limit on resend-verification.
- 2.5 PASS — `jwt.verify(..., { algorithms: ['HS256'] })`, 7-day expiry, `sessionVersion` invalidates all sessions on password change; cookie `HttpOnly`, `Secure` (production), `SameSite=Lax`. Note: logout clears the cookie but a stolen JWT stays valid until expiry (Low).
- 2.6 PASS — auth is in the `ph_auth` HttpOnly cookie; the legacy `presethub_token` in localStorage is removed on load.
- 2.7 N/A — no social login / OAuth. Only redirects are fixed canonical paths (`server.js`, `seo/*.js`).
### 3 Access control
- 3.1 PASS — checked: presets PUT/DELETE, texts PUT/DELETE/comments, comments DELETE, reviews DELETE (owner or admin), collections PUT/DELETE/toggle (`ownCollection`), users/me*, profile, creator/*, chat/messages, downloads (per user).
- 3.2 PASS — no `req.body` is written to the DB wholesale; profile/signup pick named fields only (role, plan, balance never read from the body).
- 3.3 PASS — admin API behind `auth + isAdmin`, admin IP allowlist option (`middleware/adminIp.js`), TOTP for admin (`utils/totp.js`), audit log.
- 3.4 PASS — Pro, boosts, coupons, payouts evaluated on the server (`isProUser`, `plans`, `boosts`, `coupons`).
- 3.5 N/A — no teams/workspaces.
- 3.6 PASS — no debug/test/seed routes; botGuard blocks probes.
### 4 Database and files
- 4.1 PASS — query values are coerced to strings/numbers; `?category[$ne]=x` hole in presets list fixed earlier; login validated with express-validator (`isEmail`, `isString`); no `$where`.
- 4.2 FAIL (Low, accepted) — ObjectIds are public.
- 4.3 PASS — preset files are `private, no-store` and only served after the download check; previews/avatars are intentionally public; uploads renamed to random GridFS ids.
- 4.4 CAN'T VERIFY — see above.
- 4.5 N/A.
### 5 Input / output
- 5.1 PASS — express-validator + manual length/type checks; limits on body size.
- 5.2 PASS — user text goes through `esc()` before `innerHTML`; scan of all templates found no raw user field (alt/canvas/text uses are safe).
- 5.3 PASS — size + extension limits, magic-byte check (`middleware/upload.js`), ZIP safety (`zipSafety`), SVG/HTML not accepted, files stored in GridFS (never executed).
- 5.4 PASS — no server-side fetch of user-supplied URLs (bot downloads only Telegram file links; payment calls use fixed hosts).
- 5.5 PASS — no `?redirect=/?next=` parameters.
- 5.6 PASS — generic 500s in production; coupon reserved/rolled back if checkout creation fails; unhandled rejections/exceptions now alert (added earlier).
### 6 API abuse
- 6.1 PASS (code) — `utils/rateLimit.js` HybridStore (shared store, per user else per IP), `trust proxy` from `TRUST_PROXY_HOPS`; value on live CAN'T VERIFY.
- 6.2 PASS — exact origin allowlist, `credentials:false`.
- 6.3 PASS — Cloudflare Turnstile (`utils/captcha.js`) + honeypot.
- 6.4 PASS — responses strip password/token/reset fields; lists capped (limit ≤ 50).
- 6.5 PASS — SameSite=Lax + double-submit CSRF token on state-changing requests.
- 6.6 PASS — Cashfree HMAC + timestamp, PhonePe SHA-256 header, YOUPI HMAC (`timingSafeEqual`); only status `created` can become `paid` (idempotent); status re-checked with the gateway API.
### 7 Payments
- 7.1 PASS — client sends ids/plan; server prices from DB; amount verified against gateway (`amountMatches`).
- 7.2 PASS — access granted only by verified webhook / gateway status call, orders must belong to the user.
- 7.3 PASS (prepaid model) — Pro does not auto-renew; failed/expired orders closed and coupons released; refunds and disputes are handled manually in admin (documented in Refund policy).
- 7.4 CAN'T VERIFY — see above.
- 7.5 PASS — coupon use reserved atomically, one paid use per account, plus new "one open checkout per coupon" guard.
- 7.6 FIXED.
### 8 AI features — N/A (no LLM calls).
### 9 Dependencies
- 9.1 CAN'T VERIFY — run `npm audit`.
- 9.2 FAIL (Medium) — no lockfile.
- 9.3 PASS — no AGENTS.md/rules files; the only install script is the root `postinstall` that installs `backend/` (own project).
- 9.4 PASS — external scripts: Turnstile, Cashfree/PhonePe checkout, AdSense/GA/Meta pixel (consent-gated), Font Awesome; all from official hosts and allowed in CSP.
### 10 Deployment
- 10.1 PASS — CSP (with report endpoint), `nosniff`, frame-ancestors `'self'`, Referrer-Policy, Permissions-Policy, HSTS (production).
- 10.2 PASS — production mode switches, no `.map` files published.
- 10.3 N/A — Express has no auto docs.
- 10.4 PASS — dotfiles denied, botGuard blocks `.env/.git/backup` probes, no directory listing.
- 10.5 PASS — audit log of admin actions, security/payment alerts without secrets.
### 11 Cost and code health
- 11.1 FIXED — other timers already skip hidden tabs.
- 11.2 PASS — Telegram restart back-off fixed (409 loop), sweeps are capped, no recursion/unbounded retries.
- 11.3 PASS (note) — `models.js` is a thin alias of `models/index.js`; `admin.js` and `admin-v32.js` are both loaded by `admin.html` (v32 extends v1), so neither is dead code.
### 12 Privacy and legal
- 12.1 PASS — Privacy, Terms, Cookies, Refund & Shipping, Copyright & Takedown, Community Guidelines in every footer; signup has an accept checkbox; grievance officer details from env (`LEGAL_*`).
- 12.2 PASS — `tracking.js` loads GA/Meta only after consent (`cookie-consent.js` v2); consent logged 3 years.
- 12.3 PASS — `DELETE /auth/account` needs the password; removes presets, files (GridFS), comments, messages, texts, collections, boosts, reports, follows; keeps only orders required by law.
### 13 Mobile app — N/A.

## Human checklist (what only you can do)
H1 rotate any key ever pasted in chats · H2 spending caps on payment/e-mail services · H3 keep the GitHub repo private · H4 2FA on Render, Atlas, domain, e-mail, payment dashboards · H5 two-account test (A must not read/edit/delete B's data) · H6 store no card/ID data (you don't) · H7 test an Atlas restore · H9 refund policy exists, GST invoicing if required · H11 test data only on staging · H12 SPF/DKIM/DMARC for your sending domain (Resend) · H13 know how to roll back on Render · H14 uptime monitor + error alerts (alerts exist; add an external monitor on `/healthz`) · H15 DPDP: age/parental-consent policy if under-18 users are possible · H16 unsubscribe link in marketing e-mails.

## If a key leaks
1) Identify it (JWT_SECRET, Cashfree/PhonePe/YOUPI keys, RESEND_API_KEY, TELEGRAM token, Mongo URI) · 2) revoke/regenerate it at its provider · 3) update it in Render → Environment · 4) redeploy · 5) check payments, e-mails and Mongo logs for abuse; changing `JWT_SECRET` logs everyone out.

This audit catches the most common and most damaging mistakes, but it isn't a professional penetration test. Before you handle payments or sensitive data at scale, get a human security review.
