# PresetHub v3.28.2 release notes

## Changes
- Render Blueprint now deploys from the repository root so `backend/server.js` can serve the sibling `frontend/` directory.
- Added `ADMIN_PASSWORD` as a Render environment variable. Automatic admin bootstrap now refuses to create a passwordless admin and requires a 12+ character password. Existing admin accounts are not overwritten on every restart.
- Removed automatic approval of all pending presets during startup. Pending content stays pending until an authorized admin approves it.
- Added a shared responsive safety stylesheet and linked it from all viewport-aware HTML pages.
- Added root and backend `.env.example` templates with placeholders only.
- Updated project structure documentation and added `/.well-known/security.txt`.
- Added `npm test` static verification script.

## Deployment notes
1. Keep a MongoDB backup before deploying.
2. In Render, use the updated Blueprint. Do not set `rootDir: backend`.
3. Set `JWT_SECRET` to a unique random value of at least 32 characters.
4. Set `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 12 characters, or run `npm run create-admin` as a one-off command.
5. Configure real Cashfree/YouPI credentials and webhook URLs before enabling live payments. PhonePe is not implemented in this release.
6. Confirm the deployment health check at `/healthz`, then test login, signup, upload, admin approval, checkout and payout in staging.

## Validation boundary
Static JavaScript syntax, JSON parsing, YAML parsing, HTML local asset references, CSS brace balance and project smoke checks were run. The production site could not be reached from the build environment due to DNS/network resolution failure; no claim of live production visual or payment verification is made. Browser screenshot automation did not complete in the build environment.
