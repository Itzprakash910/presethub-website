# PresetHub — YOUPI PG Integration & Deployment Notes

## What changed

- Added provider selection via `GET /api/payments/provider` without exposing payment secrets.
- Added `POST /api/payments/youpi/create-order`. PresetHub decides the price from MongoDB; the browser never submits the authoritative amount.
- Added `POST /api/payments/youpi/webhook` with raw-body HMAC-SHA256 verification, timestamp freshness checks, delivery-ID checks, constant-time signature comparison, provider/order/currency/amount checks and idempotent order state transitions.
- Added an authenticated server-to-server status refresh for delayed webhooks. A browser success message alone never unlocks the preset.
- Added a return-flow poll; a download is offered only after the backend confirms `paid`.
- Kept Razorpay available as an alternate provider. Paid orders continue to use the same MongoDB purchase checks and secure download path.

## Required gateway setup

1. Deploy and configure YOUPI PG independently. In its merchant dashboard, create or select a merchant and obtain its merchant ID and webhook secret. The `YOUPI_API_URL` must be the externally reachable payment API base URL that serves `POST /api/v1/payments` and `GET /api/v1/payments/:paymentId`; do not enter only the checkout portal URL.
2. Configure the merchant webhook URL exactly as `https://presethub.site/api/payments/youpi/webhook` (replace the domain if your storefront uses another HTTPS hostname). The webhook secret in YOUPI PG must exactly match `YOUPI_WEBHOOK_SECRET` in PresetHub.
3. In the PresetHub hosting dashboard (Render or equivalent), set:
   - `PAYMENT_PROVIDER=youpi`
   - `YOUPI_API_URL` = public YOUPI payment API base URL
   - `YOUPI_MERCHANT_ID` = merchant UUID
   - `YOUPI_WEBHOOK_SECRET` = that merchant's webhook secret
   - `YOUPI_API_KEY` = merchant API key, if the YOUPI instance uses a separate API key. If not, this integration uses the webhook secret as the `X-Merchant-Key` credential as documented by the SDK.
   - `CLIENT_URL=https://presethub.site` (must match the live storefront origin).
4. Keep `MONGODB_URI`, `JWT_SECRET`, and other existing required PresetHub environment variables configured. Never add real keys or secrets to Git. Redeploy after setting the environment variables.
5. Verify from the merchant dashboard that the webhook endpoint is reachable and that successful deliveries receive HTTP 200. Review PresetHub server logs and the relevant order record if an event is marked suspicious.

## Local testing

Copy `backend/.env.example` to `backend/.env` and replace all example values. The local gateway/API must be reachable by the PresetHub backend; if the gateway is on another device/container, `localhost` from PresetHub will point to PresetHub itself, not the gateway. For local HTTP URLs, keep `NODE_ENV` out of `production`.

Before testing, confirm that the YOUPI merchant is provisioned in the selected instance and that its webhook points to a URL the gateway can reach. Use the gateway's supported development/test setup and a low-risk test transaction. Verify the full round trip: create order → hosted checkout → signed webhook/status confirmation → MongoDB order `paid` → authorized download. Also test failed, cancelled, expired, mismatched-amount and duplicate-webhook paths.

## Switch back to Razorpay

Set `PAYMENT_PROVIDER=razorpay` and configure `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET`. Razorpay remains optional and does not run as an automatic retry after a failed YOUPI PG transaction; customers should not be sent to a second gateway until the first order's status has been checked.

## Important safety note about YOUPI PG

The upstream [YOUPI PG repository](https://github.com/youpi-pg/YouPI-PG) explicitly describes YOUPI PG V2 as an **experimental research/learning project**, not as a certified, bank-approved, NPCI-approved, independently audited, or production-ready payment gateway. This integration is therefore code-level integration work, not a guarantee that real-money payments are safe, compliant, settled, or production-ready. Do an independent security/compliance review and reconcile payment outcomes against official bank records before accepting real customer payments. Do not use it as the sole authority for high-value or business-critical payments.

## Dependency lockfile note

The uploaded source ZIP contains a `backend/package-lock.json` whose declared dependency list/ranges do not match `backend/package.json` (the lockfile is from an older dependency set). Render is configured to run `npm install`, which reconciles the lockfile with the manifest during deployment. Do not switch this service to `npm ci` until you regenerate and commit the lockfile with network access. The current workspace had no installed dependencies or npm cache, so dependency installation/runtime tests could not be executed here.

## Verification scope

The final project was syntax-checked and statically inspected locally. All 35 project JavaScript files passed `node --check`; JSON manifests and local HTML references were also checked. This workspace does not have your merchant credentials, live gateway service, webhook dashboard, production MongoDB, or installed backend dependencies, so it cannot certify a real transaction or fully verify provider delivery/reconciliation.
