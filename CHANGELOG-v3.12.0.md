# PresetHub v3.12.0 — payout rules, status updates, CSV export

## Payout rules
- Small payouts are approved automatically. Default limit ₹500, set with `PAYOUT_AUTO_APPROVE_RUPEES`. Approval does not send money. The admin still pays and records the reference.
- Bigger payouts wait in the admin queue for manual approval, as before.

## Creator notifications
- Request received, approved (auto or manual), rejected (with reason) and paid (with reference) each send a notification.

## Admin: payout CSV export
- "Export CSV" in the Payouts section. Filter by status and date range.
- Columns: payout ID, requested and processed times, creator name and email, amount (₹), method, masked destination, status, reference, note.
- No full bank account or UPI is exported.
- Cells starting with `=`, `+`, `-`, `@` are prefixed with `'` so spreadsheets cannot run them as formulas. Fields with commas or quotes are escaped.
- Each export is recorded in the alert log.

## Tests run
- CSV escaping and formula guard (passes, including reading the cell back the way a spreadsheet does).
- Syntax, local links, relative requires.

## Still pending (needs your input or external setup)
- **Cashfree Payouts automatic transfer.** Needs Cashfree Payouts activation, KYC, and the API docs to verify the request format. Not started.
- **TDS and GST on payouts.** Needs the rates and your accountant's rules. Not started.
- **Admin control of `.env` keys.** Kept out of the panel on purpose.
