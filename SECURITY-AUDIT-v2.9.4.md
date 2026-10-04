# PresetHub v2.9.4 — Full Security / Logic / UI Audit

## Audit scope
- Backend Node.js + Express + MongoDB/Mongoose + GridFS
- Authentication/session/cookies/CSRF
- Preset upload/download/payment flows
- User/profile/follow/message/notification/achievement flows
- Admin APIs and account deletion
- PWA/service worker/local icon system
- Frontend HTML/CSS/JS references and duplicate IDs
- Responsive header/menu layout
- Legacy/unused runtime files

## Critical / High priority fixes applied

### Critical
1. **Razorpay webhook integrity** — verification now uses the raw HTTP request body captured before JSON parsing instead of re-serializing parsed JSON.
2. **Session invalidation** — password change/reset increments `sessionVersion`; JWTs carry the version and old sessions are rejected.
3. **Sensitive API exposure** — `/auth/me`, profile responses and admin user responses no longer expose password-reset hashes, push subscriptions or session-version internals.
4. **Preset file safety** — preset binaries are stored in MongoDB GridFS and download responses are forced to `application/octet-stream` with `Content-Disposition: attachment` and `nosniff`.
5. **Image upload validation** — JPEG/PNG/WebP uploads require matching magic bytes; spoofed extensions are rejected.
6. **Bulk upload memory pressure** — bulk per-file limit reduced to 25MB with a 300MB request total limit.
7. **Admin deletion cleanup** — deleting a user also removes owned presets/media and related application data; admin cannot accidentally change their own admin status.

### High
- CSRF protection is applied to cookie-authenticated API writes; static assets no longer receive unnecessary CSRF cookies.
- Global write rate limiting added for preset/comment/review/chat APIs.
- Approved-only purchasing and public preset flows enforced.
- Comment replies must reference a comment belonging to the same preset.
- Review helpful votes are de-duplicated per user.
- Referral codes use cryptographically secure random bytes.
- Notification links are restricted to internal PresetHub paths.
- Legacy plaintext Telegram/API JWT storage was removed from the User schema; Telegram bot session tokens are kept in process memory only.
- Obsolete LowDB-style runtime model files were removed.
- Obsolete seed/demo upload data and obvious example asset files were removed.
- Broken MongoDB `create-admin.js` was replaced with a working MongoDB implementation.
- Backup output redacts passwords, reset hashes, push subscriptions and session internals and uses restrictive file permissions.

## Upload security model
- Allowlisted extensions: XMP, DNG, LRTEMPLATE, CUBE, 3DL, LOOK, COSTYLE, XML, JSON, ZIP.
- Preview/avatar extensions: JPG, JPEG, PNG, WEBP only.
- Preview/avatar content signatures are checked server-side; MIME headers are not trusted.
- SVG is not accepted for user preview/avatar uploads.
- Upload filenames are never used as storage paths; generated UUID storage keys are used.
- Preset files are never extracted or executed server-side.
- GridFS media is not exposed as a public filesystem directory.
- Legacy non-image GridFS objects are denied by the generic `/media/:id` route.

## Authentication/session
- HttpOnly, SameSite=Lax auth cookie.
- Production cookie uses Secure.
- JWT secret is required in production and must be at least 32 characters.
- Passwords use bcrypt cost 12.
- Signup/change/reset password rules require 10–128 characters with upper/lowercase and a number.
- Login responses are generic for invalid/blocked/deactivated accounts.
- Password reset responses are generic to reduce account enumeration.
- Password changes/resets invalidate existing sessions.

## Access control
- Admin API uses authentication + admin role middleware.
- Preset update/delete is owner-or-admin.
- Paid downloads require ownership/purchase.
- Download tickets are short-lived JWTs and paid tickets are bound to the user ID.
- Earnings endpoint is owner-or-admin.
- Message conversations require following the recipient.
- Account deletion requires the current password and cannot be used by admin accounts.

## Frontend/UI hardening
- `•••` overflow icon no longer uses the incorrect hashtag asset; it is rendered locally with CSS.
- Mobile header uses a two-row responsive grid so the PresetHub brand + `•••` menu + account actions remain aligned, with search occupying a full second row.
- Tested static HTML references: no missing local `link`, `script`, or `img` targets.
- Duplicate HTML ID scan: no duplicates found.
- Local icon CSS references: no missing local asset targets.
- Service-worker/static cache versions aligned to v2.9.4.
- PWA shortcut icons are local; Messages uses a local PNG icon.

## OWASP Top 10:2025 mapping
1. **A01 Broken Access Control** — owner/admin checks, paid download authorization, admin middleware, message/follow authorization.
2. **A02 Security Misconfiguration** — Helmet, CSP, HSTS via Helmet in production, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, disabled `/uploads` serving.
3. **A03 Software Supply Chain Failures** — obsolete dependencies/files removed; `web-push` explicitly declared; production deployment should run dependency auditing and commit a freshly generated lockfile from a networked CI environment.
4. **A04 Cryptographic Failures** — bcrypt password hashing, HTTPS production cookies, random reset tokens, JWT secret requirement, session versioning.
5. **A05 Injection** — Mongoose filters use validated IDs/escaped regex; user HTML is escaped in frontend templates; no shell/SQL/LDAP execution path was found.
6. **A06 Insecure Design** — paid download tickets, account deletion confirmation/password, upload restrictions, rate limits and business-flow checks.
7. **A07 Authentication Failures** — rate-limited login/reset, strong passwords, HttpOnly auth cookie, generic auth errors, session invalidation.
8. **A08 Software/Data Integrity Failures** — raw payment webhook signature verification, upload ID de-duplication, constrained status values, integrity checks for image/ZIP signatures.
9. **A09 Logging & Alerting Failures** — Morgan request logs, centralized error handler, security/runtime warnings, notification system; production monitoring/alert routing still needs platform-level configuration.
10. **A10 Mishandling of Exceptional Conditions** — centralized error handling, upload limit handling, duplicate-key handling, graceful DB shutdown, defensive media/file streaming.

## API Security Top 10 considerations
- BOLA/IDOR: checked on preset ownership, earnings, order access, messages and downloads.
- Broken authentication: cookie + JWT validation and session-version checks.
- Property-level authorization: profile fields are allowlisted; sensitive fields are excluded from API responses.
- Resource consumption: API/write rate limits, upload limits, bulk limits and pagination.
- Function-level authorization: admin middleware protects admin routes.
- Sensitive business flows: purchase/download/upload/comment/chat writes are rate limited.
- SSRF: no user-controlled server-side arbitrary URL fetch path was found; external integrations use fixed provider endpoints.
- Inventory: active API routes are explicitly mounted in `backend/server.js`; legacy model-route duplicates were removed.

## Verification performed
- `node --check` passed for all backend/frontend JavaScript files.
- JSON parsing passed for package/manifest/release metadata.
- No duplicate HTML IDs found.
- No missing local HTML asset references found.
- No missing local CSS URL references found.
- Upload magic-byte helper tests passed for JPEG/PNG/WebP and spoofed-image rejection.
- ZIP header validation test passed.
- Final ZIP integrity is checked before release.

## Production limitations
- Live Render runtime, MongoDB Atlas data, DNS, secrets, Razorpay credentials, VAPID delivery and WAF/DDoS provider settings were not directly accessible from this audit environment.
- `backend/package-lock.json` was intentionally removed because the supplied lockfile was materially stale and did not match `backend/package.json`. The audit environment could not safely regenerate it offline. For production reproducibility, run `npm install --package-lock-only` in a networked CI/developer environment, review the resulting lockfile, run `npm audit`, and commit that generated lockfile before the final production deploy.
