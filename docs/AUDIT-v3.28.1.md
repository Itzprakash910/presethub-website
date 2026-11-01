# PresetHub v3.28.1 — Static Code Audit & Fix Report

Audit basis: the supplied `PresetHub-v3.28.zip` archive. The archive contained 186 files (about 1.7 MB extracted). This was a source/static audit; it was not connected to the live MongoDB, Render deployment, email provider, or payment gateway accounts.

## High-impact issues found and fixed in v3.28.1

1. **Admin role was not propagated by authentication middleware.** The middleware selected only `role`, `status`, and `sessionVersion`, then omitted `adminRole` from `req.user`, while the admin permission layer depends on `req.user.adminRole`. This could cause non-super admin role permissions and admin operations to be denied. The middleware now selects and propagates `adminRole`.
2. **Admin bootstrap did not reliably set Super Admin role.** `create-admin.js` now sets `adminRole: 'super'`. Startup admin repair also assigns `super` when the configured `ADMIN_EMAIL` already exists as an admin but has no admin role.
3. **Admin UI had a password-reset button without a matching backend endpoint.** Added `POST /api/admin/users/:id/reset-password`. It validates the target ID, prevents self-reset through this tool, restricts resetting another admin account to Super Admin, hashes a one-time temporary password with bcrypt, clears reset tokens, increments `sessionVersion` to revoke existing sessions, and returns the temporary password once. Access is permission-gated to the support role (and Super Admin).
4. **Creator commission was configured as 80%, conflicting with the requested 90%.** Updated Render configuration and payout utility default to 90%. Payout arithmetic remains integer-paise based.
5. **Signup/reset password UI said/allowed 8 characters while server validation required 10.** Updated browser `minlength` and signup copy to match the backend 10-character, uppercase/lowercase/digit policy. Password reset endpoint now also uses the reset rate limiter.
6. **Payment provider selection ignored `PAYMENT_PROVIDER`.** The provider selector now honors explicit `cashfree` or `youpi`, returns disabled if the requested provider is not configured, and only auto-selects when the setting is `auto`/empty.
7. **Clerk cleanup was incomplete in deployment config.** Removed Clerk environment variables from `render.yaml`. The legacy `clerkId` model field/index remains intentionally for existing MongoDB record compatibility; it is not used for authentication.
8. **Version metadata was stale.** Root and backend package versions now both read `3.28.1`.

## Important incomplete feature / deployment findings

- **PhonePe is not implemented in the backend in this archive.** The frontend contains a PhonePe branch and constructs `/payments/phonepe/...` URLs, but the backend has no PhonePe route, gateway helper, webhook verifier, or route mount. The payment provider selector supports Cashfree and YouPI only. PhonePe payments must not be advertised as working until a backend integration and webhook are implemented and tested with merchant credentials.
- Render config currently selects `PAYMENT_PROVIDER: cashfree` and `CASHFREE_ENV: sandbox`. Production payments require the correct production credentials/environment and a verified webhook URL. Do not switch to live mode until merchant-side webhook/signature testing is completed.
- Password recovery email delivery requires `RESEND_API_KEY` and `MAIL_FROM`. Without both, production requests intentionally return the generic response but no email is sent. Configure and test these values.
- Users created previously through Clerk may have an empty bcrypt password. They cannot log in with a Clerk password; they need the PresetHub password-reset process or a secure admin reset.
- `clerkId` remains in the MongoDB schema/index for compatibility. Do not drop it without a database backup and a migration plan.
- The archive has no `npm test` script or committed automated test suite. No end-to-end browser test suite is included.

## Checks performed

| Check | Result |
|---|---|
| ZIP integrity (`unzip -t`) | PASS |
| JavaScript syntax (`node --check`) for backend/frontend JS files | PASS |
| JSON parsing | PASS (3 JSON files) |
| Local script/image/stylesheet references in HTML | PASS (0 missing) |
| Payout utility unit checks (90%, paise rounding) | PASS |
| Admin permission matrix checks (super/support/marketing/operations cases) | PASS |
| Admin role selection/propagation and bootstrap static checks | PASS |
| Package version consistency | PASS (3.28.1) |

## Not tested (requires environment or credentials)

- Actual signup/login/logout and session cookies against MongoDB.
- Forgot-password email delivery and reset-link round trip.
- Admin panel actions against a live database, including the new one-time password reset.
- Preset upload, GridFS media access, downloads, comments, reviews, creator payout request/approval, and subscription fulfilment against production data.
- Cashfree/YouPI checkout, webhook signature verification, refunds, and settlement.
- PhonePe (backend integration is absent).
- Render deployment, custom domain, PWA push notifications, and AdSense serving/approval.

## Deployment cautions

1. Back up MongoDB before deploying.
2. Set a unique 32+ character `JWT_SECRET`; changing it invalidates existing sessions.
3. Verify `CREATOR_SHARE=0.9` in Render after deployment.
4. Confirm `ADMIN_EMAIL` and run `npm run create-admin` from the backend directory only if needed; set a strong `ADMIN_PASSWORD` (12+ characters).
5. Configure `RESEND_API_KEY` and `MAIL_FROM` if email recovery is required.
6. Keep Cashfree sandbox until webhook and order verification tests pass. PhonePe must be treated as unavailable until its backend is built.
