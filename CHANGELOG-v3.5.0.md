# PresetHub v3.5.0 — Cashfree payment gateway

## Added
- Cashfree PG as the active gateway (`utils/cashfree.js`, `routes/cashfree.js`).
  - Checkout for presets, Pro subscriptions and tips.
  - Signed webhook (`POST /api/payments/cashfree/webhook`) with HMAC-SHA256 and a 5-minute replay window.
  - Server-side confirmation (`GET /pg/orders/{id}`) before any order is marked paid. Amount and currency must match.
  - Refresh path for the return page (`/api/payments/youpi/refresh/{id}` dispatches Cashfree orders).
- Mobile number prompt at checkout (Cashfree requires a 10-digit number). Saved to the profile.
- `User.phone`, `Order.paymentSessionId`, provider `cashfree`.
- Cashfree SDK loaded only when a payment starts. CSP updated for `*.cashfree.com`.
- `CASHFREE-SETUP.md`, updated `render.yaml` and `.env.example`.

## Changed
- `/api/payments/provider` returns `cashfree` (with `mode`) when configured, otherwise YOUPI.
- One checkout function for presets, Pro and tips (`PresetHubApp.checkout`).
- Order filters accept both `youpi` and `cashfree` orders.

## Tests run
- Webhook signature: valid accepted, tampered body rejected, wrong secret rejected, stale timestamp rejected, missing headers rejected.
- Amount and currency match and mismatch. Mobile number format.
- Static checks: all JS parses, all relative requires resolve, no undefined helpers.

## Not tested live
- No network in this environment, so the Cashfree API calls, SDK checkout and webhook delivery were not run against Cashfree. Run the sandbox checklist in `CASHFREE-SETUP.md` before switching to production.
