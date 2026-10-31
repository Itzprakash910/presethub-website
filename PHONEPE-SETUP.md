# PhonePe PG v2 — PresetHub

PhonePe is an additional payment option. Existing Cashfree and YouPI integrations are retained.

## 1. PhonePe credentials

In the PhonePe Business / PG developer dashboard, create or select the API integration and obtain:
- Client ID
- Client Secret
- Client Version

Start with the sandbox/test environment. Do not paste credentials into frontend code, GitHub, screenshots, or chat.

Set these in Render → your backend service → Environment (or `backend/.env` for local testing):

```env
PAYMENT_PROVIDER=phonepe
PHONEPE_ENV=sandbox
PHONEPE_CLIENT_ID=your_client_id
PHONEPE_CLIENT_SECRET=your_client_secret
PHONEPE_CLIENT_VERSION=1

PHONEPE_WEBHOOK_USERNAME=choose_a_unique_webhook_username
PHONEPE_WEBHOOK_PASSWORD=choose_a_long_random_webhook_password
CLIENT_URL=https://presethub.site
```

Use the exact Client Version issued in your PhonePe dashboard; `1` above is only an example. Use the production credentials and `PHONEPE_ENV=production` only after successful sandbox testing and merchant activation.

## 2. Webhook setup

In PhonePe Developer Settings → Webhooks → Create New Webhook:

- Webhook URL: `https://presethub.site/api/payments/phonepe/webhook`
- Authentication: SHA / Username and Password (as shown in the dashboard screenshot)
- Username: same value as `PHONEPE_WEBHOOK_USERNAME`
- Password: same value as `PHONEPE_WEBHOOK_PASSWORD`
- Active Events: enable payment/order success and failure events available in your PhonePe dashboard.
- Save/Create the webhook.

The server checks the Basic authentication header, then independently fetches the order status from PhonePe before fulfilling anything. Do not use the webhook URL for the website return URL.

## 3. Provider priority and fallback

`PAYMENT_PROVIDER` is the preferred gateway. If it is not configured, the backend automatically tries the remaining configured gateways in this order:

1. Cashfree
2. PhonePe
3. YouPI

Examples:
- Prefer PhonePe: `PAYMENT_PROVIDER=phonepe`
- Prefer Cashfree: `PAYMENT_PROVIDER=cashfree`
- Prefer YouPI: `PAYMENT_PROVIDER=youpi`

A provider must have valid credentials before it is selected. This is configuration fallback, not a promise that a gateway outage will automatically move an already-created order to another gateway. Never create a second payment for the same order while the first is pending.

## 4. Payment verification

- The server creates the order and calculates the amount; browser-supplied amounts are not trusted.
- The customer is redirected to PhonePe checkout.
- PhonePe webhook is authenticated.
- The backend calls PhonePe's order-status API and checks `COMPLETED`, INR currency and exact amount.
- Only then is the existing order marked paid and the existing fulfillment logic activates Pro / unlocks the preset.
- The return page can call the authenticated refresh endpoint if webhook delivery is delayed.
- Replayed webhook calls cannot fulfill the same order twice because the order transition is atomic (`created` → `paid`).

## 5. Sandbox checklist

1. Deploy with `PHONEPE_ENV=sandbox` and test credentials.
2. Create a low-value test purchase in the sandbox.
3. Confirm the webhook reaches `/api/payments/phonepe/webhook`.
4. Confirm the MongoDB order has `provider: phonepe` and changes to `paid` only after server verification.
5. Retry the same webhook and verify no duplicate download/subscription is granted.
6. Try an incorrect webhook username/password; it must return HTTP 401.
7. Test a failed/cancelled checkout and the return-page status refresh.
8. Only after the tests pass, switch to production credentials and `PHONEPE_ENV=production`.

PhonePe may require merchant approval, KYC and production enablement. The dashboard's current API/version settings are authoritative; do not assume sandbox credentials work in production.
