# Cashfree setup (PresetHub v3.5.0)

Cashfree is now the active payment gateway. It is used automatically when `CASHFREE_APP_ID` and `CASHFREE_SECRET_KEY` are set. YOUPI PG stays as a fallback if Cashfree is not configured.

## 1. Get keys
1. Sign up at cashfree.com and complete KYC (PAN, bank account, business details).
2. Start in **Sandbox** (test mode) and copy the sandbox App ID and Secret Key.
3. After KYC approval, copy the production App ID and Secret Key.

## 2. Environment variables (Render → Environment)
- `CASHFREE_ENV` = `sandbox` for testing, `production` for real money
- `CASHFREE_APP_ID` = App ID
- `CASHFREE_SECRET_KEY` = Secret Key (keep private; it also signs webhooks)
- `CASHFREE_API_VERSION` = `2025-01-01`
- `CLIENT_URL` = `https://presethub.site` (used for the return page)
- `API_BASE` = `https://presethub.site/api` (used to build the webhook URL)

## 3. Webhook
In the Cashfree dashboard, set the payment webhook URL to:

    https://presethub.site/api/payments/cashfree/webhook

Enable the **payment success** and **payment failed** events. The server verifies the `x-webhook-signature` header with HMAC-SHA256 and rejects requests older than 5 minutes.

## 4. How a payment is confirmed
1. The browser creates an order via `POST /api/payments/cashfree/create-order` (or `/subscribe`, `/tip`).
2. The server stores the order as `created` and gets a `payment_session_id` from Cashfree.
3. The browser opens Cashfree checkout with that session.
4. Cashfree sends a signed webhook. The server then calls `GET /pg/orders/{id}` itself.
5. Only if that check says `PAID` and the amount and currency match is the order marked `paid`. The preset unlocks, Pro activates, or the tip is credited.
6. If the webhook is delayed, the return page calls `/api/payments/youpi/refresh/{id}`, which runs the same server-side check.

## 5. Customer mobile number
Cashfree requires a 10-digit Indian mobile number. If the user has none saved, the checkout asks for it once and saves it to the profile.

## 6. Test before going live
- Sandbox: buy a ₹1 preset, subscribe to a plan, and send a tip. Check that each order becomes `paid` only once.
- Replay the same webhook: the order must not be fulfilled twice.
- Send a webhook with a bad signature: it must return 401 and raise a critical alert in the admin panel.
- Switch `CASHFREE_ENV` to `production` only after the sandbox tests pass.

## Notes
- Fees and offers change. Check the Cashfree pricing page before going live.
- The checkout SDK call (`Cashfree({mode})` then `checkout({...})`) and the API version should be confirmed against the current Cashfree docs during the sandbox test. They could not be tested live in this environment.
