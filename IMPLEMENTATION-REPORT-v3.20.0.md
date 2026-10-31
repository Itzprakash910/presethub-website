# PresetHub v3.20.0 — Implementation report

## Included
- 90% creator commission / 10% platform share default.
- Manual-only payout queue; automatic approval removed.
- Configurable, transparent payout fee/GST calculation. Defaults remain ₹0 fee and ₹0 GST. GST applies only to an explicitly configured payout fee.
- Payout gross, fee, GST and net values persisted per request and surfaced to creators/admins.
- Admin user details include payout history, purchases, downloads and creator content already available in the user detail view.
- Admin payout actions continue to require approve/reject/mark-paid; marking paid requires a UTR/reference and creator receives a net-paid notification.
- Compact alert cards and mobile admin records.
- Privacy policy rewritten with account, payment, creator payout, data-sharing, access, security, retention and rights explanations.
- Same-tab signed preset attachment navigation to reduce mobile popup-blocker failures.
- Node built-in tests for creator share, payout fee/GST math and payout detail validators.

## Deployment checklist (Render)
1. Deploy the ZIP/source to the existing backend service.
2. Set `CREATOR_SHARE=0.9` in Render → backend service → Environment. Existing Render values override code defaults.
3. Keep the existing `PAYOUT_ENC_KEY` unchanged. If it is missing, generate a 32-byte key with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and set it once. Do not rotate it casually; old encrypted bank/UPI details depend on it.
4. Keep `PAYOUT_FEE_PAISE=0` unless a real fee is confirmed. If used, this is a fixed fee in paise per withdrawal; `PAYOUT_FEE_GST_PERCENT=18` calculates GST on that fee only. Confirm applicable GST/tax treatment with your accountant and disclose charges before enabling them.
5. Keep MongoDB and payment-provider credentials already in use. Do not replace production secrets with examples.
6. Run `npm test` from `backend/` after deployment. Then perform a low-value sandbox purchase and verify the matching Order becomes `paid`, a creator sale notification is created, and the purchased preset downloads successfully from GridFS.
7. Submit a creator payout test request. Confirm it appears as Requested in Admin → Payouts, review destination, approve/reject, and only mark Paid after sending the exact net amount and recording the UTR.

## Test status and limits
- All JavaScript files pass `node --check`.
- Payout unit tests: 4 passed, 0 failed.
- ZIP archive integrity is verified.
- A live payment, MongoDB/GridFS download and bank transfer cannot be end-to-end tested from this offline build environment; use the sandbox/deployment checklist above.

## Existing PhonePe webhook configuration note
The source currently verifies PhonePe webhook requests using the configured username/password Basic Authorization header (`PHONEPE_WEBHOOK_USERNAME` / `PHONEPE_WEBHOOK_PASSWORD`). It does not implement an HMAC signature verifier. Do not configure an HMAC-only webhook expecting this build to validate it. The exact PhonePe HMAC header, canonical payload and digest rules must be taken from the specific merchant dashboard/API documentation before changing verification; guessing these would risk accepting forged payment events. Payment fulfillment still independently fetches authoritative PhonePe order status before marking an order paid.
