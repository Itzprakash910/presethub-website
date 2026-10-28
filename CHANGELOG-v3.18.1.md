# PresetHub v3.18.1 — complete environment configuration

## Environment variables
- `render.yaml` now declares every variable the code reads (44 keys). Secrets use `sync: false` (entered in the Render dashboard). Non-secret settings have safe defaults:
  - Added: `GA_MEASUREMENT_ID`, `META_PIXEL_ID`, `GSC_VERIFICATION_TOKEN`, `TELEGRAM_CHANNEL_ID`, `ADMIN_ALERT_EMAIL`, `PAYOUT_AUTO_APPROVE_RUPEES`, `PRO_PRICE_*`, `VIRAL_SCORE`, `AUTO_HIDE_REPORTS`, `BACKUP_DAILY`, `DB_LIMIT_MB`, `LOGIN_LOCK_AFTER`, `SIGNUP_PER_HOUR`, `UPLOAD_PER_HOUR`.
- `backend/.env.example` lists every variable with a comment on how to generate it.
- Optional variables with no set value: `PORT` (Render sets it), `ALLOW_DEV_CORS`, `ALERT_THROTTLE_MS`, `MONGO_MAX_POOL_SIZE`, `MONGO_MIN_POOL_SIZE`, `BASE_PAYMENT_API_URL` (alias of `YOUPI_API_URL`).

## Keys
- `JWT_SECRET`: 48 random bytes in hex (96 characters). Generated outside the project and supplied for this deployment.
- `PAYOUT_ENC_KEY`: 32 random bytes in hex (64 characters). Keep it fixed once payouts exist.

## Files
- `render.yaml`, `backend/.env.example`, `CHANGELOG-v3.18.1.md`, `package.json`, `backend/package.json`.
- Outside the zip: `render-environment.txt` (complete Render environment, secrets included, do not commit).
