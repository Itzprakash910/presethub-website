# YOUPI PG setup (PresetHub v3.2.0)

YOUPI PG is retained as one of the supported payment providers alongside Cashfree and PhonePe.

## Environment variables
- `YOUPI_API_URL` — YOUPI PG API base URL
- `YOUPI_MERCHANT_ID` — your merchant id
- `YOUPI_API_KEY` — server-side API key (never sent to the browser)
- `YOUPI_WEBHOOK_SECRET` — used to verify signed webhooks

Pro prices (optional, INR): `PRO_PRICE_MONTHLY` (49), `PRO_PRICE_QUARTERLY` (129), `PRO_PRICE_YEARLY` (399).

## Flow
1. Browser calls `POST /api/payments/youpi/create-order` (preset) or `POST /api/payments/youpi/subscribe` (Pro plan).
2. Server creates a local order (status `created`), amounts come from the database / plan table only.
3. Server creates a YOUPI payment session and returns `checkoutUrl`; the browser redirects to it.
4. YOUPI calls `POST /api/payments/youpi/webhook` with signed headers. The server verifies the signature, checks order id and amount, then marks the order `paid` exactly once.
5. Preset: the download unlocks. Subscription: Pro is activated and ads are removed.
6. Mismatches, invalid signatures and failed sessions raise admin alerts (Telegram / e-mail / admin panel).

## Webhook URL
`https://presethub.site/api/payments/youpi/webhook`

## Checks before going live
- Make a ₹1 test preset and a test subscription on a staging merchant.
- Confirm the order moves to `paid` only once, even if the webhook is retried.
- Confirm an invalid signature produces a critical alert in the admin panel.


Provider selection and fallback: set `PAYMENT_PROVIDER=youpi` to prefer YouPI. If it is not configured, another configured gateway can be selected. See `PHONEPE-SETUP.md`.
