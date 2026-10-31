# PresetHub v3.20.0 — Creator payout, admin tracking and privacy

## Decisions implemented
- Creator share default changed to 90% (platform share 10%). Set `CREATOR_SHARE=0.9` in the Render backend environment. Earnings are calculated from the current share setting; this setting also changes the displayed historical lifetime creator share calculation.
- Manual payout workflow: all new requests remain `requested`; no automatic approval is performed. Admin reviews, approves, rejects with a reason, or marks paid only after entering the bank/UPI UTR/reference.
- Payout records now snapshot gross request, configured transfer fee, GST on that fee and net transfer amount. Defaults are zero transfer fee, so no fee/GST is deducted unless the operator explicitly configures the real applicable fee. `PAYOUT_FEE_PAISE` is a fixed fee per payout request; `PAYOUT_FEE_GST_PERCENT` defaults to 18% on that fee. Confirm actual provider charges and tax treatment with your accountant before enabling deductions.
- Admin payout list/details show requested amount, fee, GST and net transfer; full payout destination access remains on-demand and audit-alerted.
- Admin user details now include payout history in addition to profile, purchases, creator presets and downloads.
- Compact alert/record layout for mobile admin screens.
- Privacy Policy expanded with data collection/use, payment and payout handling, encryption/access limits, retention, rights, cookies, provider sharing and realistic breach/security language.

## Preset purchase/download audit
- Existing paid-preset flow uses provider order status and server-side paid-order verification before issuing a short-lived download ticket; file streaming is served from MongoDB GridFS. The implementation preserves that authorization boundary. The browser download action now uses same-tab navigation for the signed attachment URL to avoid popup blockers interrupting mobile downloads.
- A real paid transaction and GridFS download require live Render/MongoDB/payment credentials and cannot be simulated by a local static ZIP test. Verify with a low-value sandbox purchase before production.

## Deployment notes
- Set `CREATOR_SHARE=0.9` on Render. Existing `.env` values override code defaults.
- Keep `PAYOUT_ENC_KEY` stable; changing it makes previously encrypted payout destinations unreadable.
- Leave `PAYOUT_FEE_PAISE=0` unless an actual fee is known and contractually applicable. GST is calculated only on that configured fee, not on the creator's payout principal.
- Do not enable a payout fee without publishing it to creators and confirming tax/accounting treatment.
