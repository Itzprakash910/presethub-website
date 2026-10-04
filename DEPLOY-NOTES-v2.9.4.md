# PresetHub v2.9.4 — Security + Responsive Hardening

## Main fixes
- Fixed mobile header: PresetHub brand, overflow `•••` menu and account/message/notification actions stay aligned on narrow screens.
- Replaced the broken local ellipsis/hashtag icon mapping with a CSS-rendered vertical ellipsis.
- Added upload magic-byte validation for JPEG/PNG/WebP; preset downloads are forced to `application/octet-stream` + attachment.
- Reduced bulk upload per-file memory pressure to 25MB and added a 300MB request total cap.
- Added session-version invalidation on password change/reset/refresh.
- Hardened Razorpay webhook verification to use the raw request body.
- Purchases require an approved preset.
- Added stricter comment parent integrity and review helpful-vote de-duplication.
- Hardened admin user deletion to clean owned data/media and prevent self-admin status changes.
- Fixed the MongoDB-based `create-admin.js`; removed dependency on obsolete LowDB helpers.
- Telegram bot JWTs are no longer persisted in MongoDB; bot API tokens are held only in process memory.
- Service-worker/cache versions aligned to v2.9.4 and PWA shortcut message icon uses a local PNG.

## Important deployment checks
1. Render runs `npm install` from `backend`; `web-push` is declared in `backend/package.json`.
2. Set `JWT_SECRET` to a random value of at least 32 characters.
3. Set `MONGODB_URI`, `CLIENT_URL`, Razorpay secrets, and VAPID values as applicable.
4. Use HTTPS only in production. Render should terminate TLS before Express.
5. Verify MongoDB Atlas Network Access allows only the required Render egress/network configuration.
6. Run `npm audit` in CI and review lockfile changes before production deployment.
7. Test upload with valid images and deliberately mismatched image extensions; both should be rejected.
8. Test Razorpay webhook with the provider's official signature verification flow.
9. Test account password change/reset and verify the old session becomes invalid.
10. Test 320px, 360px, 390px, 412px, 768px and desktop widths for header/menu/buttons.

## Verification limitation
This package was statically audited and locally syntax/integrity tested. A live Render/MongoDB production environment was not directly queried from this session, so production DNS, Atlas allow-list, secrets, payment credentials and live push delivery must still be verified after deployment.
