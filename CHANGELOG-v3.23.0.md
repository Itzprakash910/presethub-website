# PresetHub v3.23.0 — full project review and cleanup

## Analysis summary
- **Size:** backend about 600 KB (routes 16 files, utils 14, models 1 schema file, seo 2, scripts 2). Frontend about 1 MB (15 HTML pages, 6 main JS files, 5 CSS files, icons and images).
- **Dependencies:** 18 runtime packages, all used. `bcryptjs` removed.
- **Routes:** all 16 route files are mounted. Admin routes are behind login, admin role and MFA. Public write routes are rate-limited; webhooks are signature-checked.
- **Security:** no shell execution, no `eval`, no hardcoded secrets, no unescaped user input in HTML sinks, CSP-safe (no inline handlers or scripts), HTTPS forced in production, admin passwords are no longer stored anywhere.
- **Privacy:** consent-gated analytics and pixels; data export and account deletion; privacy and refund policy pages; audit log for admin actions.

## Removed
- `backend/scripts/migrate-lowdb-to-mongo.js` and the `migrate` npm script (LowDB is no longer used).
- `bcryptjs` dependency (no passwords are stored since Clerk).
- `frontend/favicon.svg`, `frontend/assets/icons/favicon-16x16.png`, `favicon-32x32.png`, `favicon.svg` (not referenced).
- `CHANGELOG-v3.20.0.md` and `CHANGELOG-v3.22.0.md` (only the latest changelog is kept; history is in this file).
- Dead bot code: the password login step and its state map.
- Server startup code that stored `ADMIN_PASSWORD` as a bcrypt hash. Admin accounts now come from `ADMIN_EMAIL` and sign in with Clerk.

## Changed
- `server.js`: `ensureAdminUser` creates or promotes the admin without a password and with the super admin role.
- `manifest.json`: the maskable icon is listed as its own entry (it was missing); normal icons are `purpose: any`.
- `render.yaml`, `backend/.env.example`: `ADMIN_PASSWORD` removed.
- `docs/AUDIT-v3.21.0.md`: the bcrypt item is marked closed.
- `docs/PROJECT-STRUCTURE.md`: new. Full folder tree with the job of each file.

## Checks run
- Syntax of all JS files; relative requires; HTML local links; admin and account auth test (8 scenarios) — all pass.

## Environment changes
- Remove `ADMIN_PASSWORD` from Render (no longer used).
