# PresetHub v3.8.0 — creator dashboard and payouts

## Creator dashboard (`/creator.html`, login required)
- **Profile:** name, username, avatar, bio, followers and following, tick (green/blue/gold), PRO badge, creator level, member since. Link to public profile.
- **Earnings:** available to withdraw, total earned, pending, paid out, preset sales and tips (count and gross), last 30 days chart (India days).
- **Viral posts:** your presets and shayari that crossed the viral threshold, with downloads or copies and date.
- **My presets:** downloads, views, likes, price, live or hidden status, viral flag.
- **My shayari & text prompts:** copies, likes, shares, comments, views, viral flag, hidden status.
- **Payout details:** UPI or bank account (account number and IFSC). Stored encrypted (AES-256-GCM). Only a masked version is returned to the browser.
- **Request payout:** minimum ₹100 (configurable), cannot exceed the available balance, one open request at a time, maximum 5 per day.
- **Payout history:** status, reference number and admin note.

## Money rules
- Earned = `CREATOR_SHARE` (default 80%) of paid preset sales and tips. Amounts are handled in paise (integers).
- Available = earned − (requested + approved + paid payouts). It can never go negative.
- Two simultaneous requests are detected after insert and the extra one is rolled back.
- Destination details are copied into the payout when it is requested, so later changes do not affect it.
- Details cannot be changed while a payout is in progress.

## Admin (Payouts panel)
- Queue filtered by status: requested, approved, paid, rejected.
- **Show details** decrypts the bank/UPI details and records the view in the alert log (who viewed, when, which payout).
- **Approve**, **Reject** (reason required, shown to creator) and **Mark paid** (bank/UPI reference required).
- Each status change is atomic, so a payout cannot be paid twice. The creator gets a notification on every change.

## Important
- **Payouts are paid manually by the admin.** The platform does not send money automatically. Automatic transfers need Cashfree Payouts (separate activation, KYC and whitelisting). This is planned for later.
- Gateway fees and taxes (such as TDS) are not calculated yet. Check them with your accountant before paying creators.
- Refunds do not reverse creator earnings yet.

## Required env (Render)
- `PAYOUT_ENC_KEY` — 64 hex characters. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Do not change it after payouts exist, or old details cannot be decrypted.
- `CREATOR_SHARE` (default 0.8), `PAYOUT_MIN_RUPEES` (default 100).

## Tests run
- Encryption round trip, random IV, tamper detection.
- UPI, IFSC and account validation, masking, creator share rounding, balance never negative.
- Static checks: all JS parses, all local links and requires resolve.

## Not tested live
- Earnings aggregation and payouts need MongoDB. Run one sandbox sale, one tip, one payout request and one admin payment before going live.
