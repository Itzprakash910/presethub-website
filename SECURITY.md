# Security Policy

## Reporting a vulnerability
Please email **security@presethub.site** with steps to reproduce. Do not open a public issue for security problems.
You will get a reply within 3 working days. Please give us reasonable time to fix the problem before sharing details.

In scope: the website, `/api/*`, payments, uploads, accounts and the Telegram bot.
Out of scope: spam, social engineering, denial-of-service by traffic volume, and reports from automated scanners with no proof of impact.

## What is already protected
- Passwords: bcrypt (cost 12); password rules enforced on the server; sessions are revoked when a password changes.
- Sessions: signed JWT (HS256 only) in an httpOnly, SameSite=Lax, Secure cookie; double-submit CSRF check for cookie sessions.
- Payments: Cashfree webhooks are HMAC-verified with a timestamp; the amount is re-checked with Cashfree's API; orders move `created -> paid` atomically.
- Uploads: file type, magic bytes and ZIP structure are checked; paid files are served only after a purchase check.
- Headers: Helmet with a strict CSP (no inline scripts), HSTS, `nosniff`, frame protection.
- Payout bank/UPI details are encrypted with AES-256-GCM (`PAYOUT_ENC_KEY`).
- Admin actions are role-checked and written to an audit log.
- The service worker caches only public API data, and clears it on logout.

## Operations checklist (before going live)
1. `NODE_ENV=production`, `JWT_SECRET` (32+ random characters), `PAYOUT_ENC_KEY` (64 hex characters) set in the host dashboard, never in git.
2. `CASHFREE_ENV=production` with live keys (the sample `render.yaml` uses `sandbox`).
3. Change the admin password after the first login; keep admin accounts to the minimum.
4. Run `npm audit --omit=dev` (also runs in CI) and update dependencies monthly.
5. Refresh the `Expires` date in `frontend/security.txt` at least once a year.
6. Rotate secrets if they were ever shared in chat, email or screenshots.
7. Keep daily backups enabled and test a restore.
