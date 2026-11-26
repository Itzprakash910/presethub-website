# PresetHub v3.25.6 – audit hardening patch

## Security fixes
- Removed startup-time privilege escalation: an existing non-admin account matching `ADMIN_EMAIL` is never promoted.
- Automatic first-admin creation now requires `ADMIN_PASSWORD` with at least 12 characters.
- Explicit `create-admin` bootstrap refuses to change an existing admin password or promote an existing non-admin account implicitly.

## Resource protection
- Reduced bulk upload count to at most 8 preset files and 8 preview images (16 total multipart files).
- Retained the 25 MB per-file parser cap and reduced aggregate bulk request cap to 200 MB. Because Multer memory storage buffers before aggregate validation, configure a matching or lower request-body cap at the reverse proxy and avoid high-concurrency bulk uploads on small instances.

## Deployment
- Added a hosting-neutral deployment guide for Node.js 20.x, MongoDB Atlas/GridFS, trusted proxy configuration, gateway webhooks, admin bootstrap and off-site backups.
- Added root preflight, test and security-check scripts.
- Preserved Cashfree, PhonePe and legacy Youpi payment modules and their webhook routes.

## Verification
- JavaScript syntax: 91 files checked, zero syntax errors.
- Backend self-tests: 151 passed, zero failed (bot 60, consent 8, TOTP 6, QR 7, fixes 13, PhonePe 12, profile 6, coupon 6, rate-limit 10, hardening 23).
- Static security checks: 38 passed after adding admin-bootstrap regression checks.
- Dependency installation and online vulnerability audit could not be completed in this environment; run `npm install` and `npm audit` before production release.
