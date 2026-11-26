# Security policy

## Reporting a vulnerability
E-mail **security@presethub.site** (also listed in `/.well-known/security.txt`). Please include the page/endpoint, steps to reproduce and the impact.
Do not test with real users' accounts or data, do not run load tests, and give us a reasonable time to fix before disclosing. We reply within 3 working days.

## What the app already enforces
HTTPS + HSTS · CSP / X-Frame / Referrer / Permissions policies (with violation reports) · httpOnly SameSite cookies + CSRF token · bcrypt passwords, common-password denylist, lockout after repeated failures ·
shared (MongoDB) rate limits · honeypot + optional Cloudflare Turnstile on public forms · NoSQL-operator / prototype-pollution / HPP guard · admin 2-step verification (TOTP) and optional IP allowlist ·
verified payment webhooks, server-side prices, one open checkout per item · upload type/size/zip-bomb checks · field encryption for payout details · audit log + admin alerts · account deletion that removes personal data.

## If a key or password leaks (do this in order)
1. **Revoke** it at the provider (Render env, MongoDB Atlas user, Cashfree/PhonePe/YOUPI dashboard, Resend, Telegram BotFather `/revoke`).
2. **Create a new one** and set it in Render → Environment, then redeploy.
3. Rotate `JWT_SECRET` if sessions might be exposed (all users are logged out — that is intended).
4. Check provider dashboards and the admin audit log for activity since the leak.
5. If user data may be affected, tell users and the authorities as the DPDP Act requires.

## Settings you control outside the code
Two-factor on GitHub, Render, MongoDB Atlas, your domain registrar and payment dashboards · registrar lock + WHOIS privacy · SPF/DKIM/DMARC on the sending domain ·
Cloudflare (WAF / DDoS) in front of the site (then set `TRUST_PROXY_HOPS=2`) · MongoDB Atlas backups tested by a restore · uptime + error alerts · spending limits at every paid provider.

## Optional switches (environment)
`TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` · `ADMIN_IP_ALLOWLIST` · `REQUIRE_VERIFIED_EMAIL=on` · `TRUST_PROXY_HOPS` · `HSTS_PRELOAD` / `HSTS_INCLUDE_SUBDOMAINS` — see `backend/.env.example`.

## PresetHub 3.25.6 hardening notes
- Application startup no longer promotes an existing account to administrator based on `ADMIN_EMAIL`.
- Startup admin creation requires an explicit strong `ADMIN_PASSWORD`; use `npm run create-admin` for a deliberate bootstrap.
- Bulk upload count limits have been reduced to constrain memory use; the 200 MB request aggregate limit remains a post-parse check, so deployments should additionally enforce request/body limits at the reverse proxy.
- Configure encrypted off-site backups; local backup files are not disaster recovery by themselves.
