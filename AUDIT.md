# AUDIT.md — PresetHub v3.25.5 pre-launch security audit
**Delete this file once you have read it (it lists weaknesses). It is git-ignored and is not served by the website.**

Scope: Node.js/Express + MongoDB (Mongoose) + vanilla-JS frontend, Render hosting, Cashfree/PhonePe/YOUPI payments, Telegram bot. FastAPI/Expo/Supabase/AI checks do not apply (areas 8, 13, 4.5, 10.3 skipped).
Method: static review + automated checks (syntax, TypeScript undefined-identifier scan, 11 self-test suites with mocks, headless-browser smoke tests). Live settings (Render, Atlas, DNS, Cloudflare) cannot be seen → CAN'T VERIFY.
Summary: **36 PASS / 17 FIXED in this pass / 3 NEED YOU (listed at the end) / 9 CAN'T VERIFY or N/A**.

## 1 Secrets
1.1 PASS — no keys/URIs in `frontend/` (grep for sk_/mongodb/AIza/secret). 1.2 PASS (`.gitignore` covers .env, keys, dumps, AUDIT.md) · git history CAN'T VERIFY (no .git in the zip).
1.3 PASS — all secrets from env (`render.yaml` uses `sync:false`). 1.4 PASS — access log strips query strings; errors are generic (`utils/errorHandler.js`).

## 2 Login
2.1 PASS — `security-check`: every write route needs login or is on a reviewed public list (36/36). 2.2 PASS — bcrypt cost 12; no default admin created at startup.
**FIXED** — common/guessable passwords ("Password123") now rejected (`utils/passwordPolicy.js`). 2.3 PASS — reset tokens hashed, 30 min, single use, same answer for unknown e-mails.
2.4 **FIXED** — limits were per-process memory; now shared in MongoDB with memory fallback (`utils/rateLimit.js`). 2.5 PASS — HS256 pinned on every verify; cookies httpOnly/Secure/SameSite; `sessionVersion` revokes tokens.
2.6 PASS — token in httpOnly cookie. 2.7 N/A.
**ADDED** — soft e-mail verification (needs RESEND_API_KEY + MAIL_FROM; `REQUIRE_VERIFIED_EMAIL=on` enforces it for uploads/texts).

## 3 Access control
3.1 PASS (ownership filters on presets, orders, messages, shares). 3.2 PASS — signup builds the user from explicit fields only. 3.3 PASS — `isAdmin` on the admin router + TOTP 2-step; **ADDED** optional `ADMIN_IP_ALLOWLIST`.
3.4 PASS (Pro/limits server-side). 3.5 N/A. 3.6 PASS — no debug/seed routes.

## 4 Database
4.1 PASS + **FIXED** — operator-key guard now also blocks operators hidden >6 levels deep; list filters accept strings only; malformed `%` URLs no longer crash (500→400); repeated query params collapsed (HPP).
4.2 Low — ObjectIds are public (ownership checks are the real protection). 4.3 PASS — preset files private, short-lived signed download tokens. 4.4 CAN'T VERIFY (Atlas network access/IP list).

## 5 Input/output
5.1 PASS (express-validator on routes). 5.2 PASS — user text escaped with `esc()`. 5.3 PASS — type/size/magic-byte/zip checks. 5.4 PASS — the server never fetches user-supplied URLs. 5.5 PASS — only fixed/allow-listed redirects.
5.6 PASS — generic errors; **FIXED** crash handlers (`unhandledRejection`/`uncaughtException`) so one bad promise cannot drop payments/uploads.

## 6 Abuse protection
6.1 FIXED (shared store) · client IP depends on `TRUST_PROXY_HOPS` (default 1 = Render; use 2 behind Cloudflare) → Suspected until you confirm your proxy chain. 6.2 PASS — allow-list, credentials off.
6.3 **FIXED/ADDED** — always-on honeypot; Cloudflare Turnstile ready but OFF until you set the two keys (**NEED YOU**). 6.4 PASS (explicit response shapes, paginated). 6.5 PASS (double-submit CSRF).
6.6 PASS — Cashfree/PhonePe/YOUPI webhooks verified + status re-checked; each order fulfilled once.

## 7 Payments
7.1 PASS (server prices/coupons). 7.2 PASS (webhook/status API, amount match). 7.3 PASS for orders; refunds are manual (admin). 7.4 CAN'T VERIFY (live vs test keys on Render). 7.5 **FIXED** — double checkout reuse, coupon not usable in two open checkouts. 7.6 CAN'T VERIFY visually.

## 9 Dependencies
9.1 CAN'T VERIFY — `npm audit` needs network (**NEED YOU**: run `cd backend && npm audit`). 9.2 **FAIL** — no `package-lock.json` in the repo (**NEED YOU**: run `npm install` in `backend/`, commit the lock file, use `npm ci`).
9.3 PASS — no AGENTS.md/hidden instructions; note `esbuild`/`sharp` run install scripts (both optional). 9.4 PASS — scripts only from AdSense/Cashfree/GTM-style official hosts. **ADDED** `.github/dependabot.yml`.

## 10 Deployment
10.1 PASS — HSTS, CSP (+ violation reports), X-Frame/frame-ancestors, Referrer-Policy, Permissions-Policy, nosniff. 10.2 PASS. 10.4 PASS — dotfiles denied, no directory listing; **ADDED** `deploy/` Nginx/Apache/IIS templates for self-hosting.
10.5 PASS — audit log + Telegram/e-mail alerts. **ADDED** slow-client timeouts, `SECURITY.md`.

## 11 Cost / health
11.1 **FIXED** — polling (30 s/15 s/2 s) pauses while the tab is hidden. 11.2 PASS (retries bounded). 11.3 note: `models.js` shim and the legacy YOUPI provider are still present (kept on purpose).

## 12 Privacy
12.1 PASS (privacy, terms, refund, cookies pages; consent at signup). 12.2 PASS (cookie consent gates ads/analytics). 12.3 **FIXED** — deleting an account now also removes texts, collections, support requests, reports and anonymises reviews; and a broken duplicate delete handler (asked for "DELETE" typed into a checkbox) was removed.

## Human checklist (answer these yourself)
H1 Never pasted keys in chats/tickets (else rotate) · H2 spending limits at Render/Cashfree/PhonePe/Resend/Telegram · H3 GitHub repo private? · H4 2FA on GitHub, Render, Atlas, domain registrar, payment dashboards ·
H5 two-account test in preview (A cannot touch B's data) · H7 Atlas backup restore tested · H12 SPF/DKIM/DMARC on the mail domain, registrar lock + WHOIS privacy · H14 uptime + error alerts · H15 age check (18+ is asked at signup) · H16 unsubscribe links in marketing mail.

## Do this on your live app (Render)
1. Set `PAYMENT_PROVIDER`, PhonePe keys, legal details (`LEGAL_ENTITY_NAME`, `LEGAL_ADDRESS`, `GRIEVANCE_OFFICER_NAME`). 2. Optional: `TURNSTILE_SITE_KEY/SECRET_KEY`, `ADMIN_IP_ALLOWLIST`, `TRUST_PROXY_HOPS`, `REQUIRE_VERIFIED_EMAIL=on`.
3. Commit `package-lock.json` and run `npm audit`. 4. Make sure only ONE process uses the Telegram `BOT_TOKEN`. 5. Re-test login, upload, checkout once after deploy.

This audit catches common, damaging mistakes; it is not a professional penetration test. Get one before handling payments or sensitive data at scale.
