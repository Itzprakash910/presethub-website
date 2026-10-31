# PresetHub v3.21.0 implementation report

## Source and scope
Based on the supplied PresetHub v3.20 final source archive. Existing MongoDB/JWT/GridFS architecture and existing features are retained. Firebase Authentication, Firebase database and Firebase Storage are not included, per request.

## Implemented
- Render creator share default corrected to 90%; obsolete payout auto-approval variable removed. Manual payout remains the only payout mode.
- Full logical backup now includes every non-system collection, including GridFS files and chunks. BSON Extended JSON preserves ObjectId, Date, Binary and other BSON types; collection exports are gzip compressed and permission-restricted.
- Added guarded restore utility. It upserts documents by `_id` and does not delete records absent from the backup. Always test on a disposable database first.
- Added creator earnings ledger JSON API and CSV download. It derives earning share from paid Order records, marks refunded orders as zero earning, and includes provider/date/order metadata.
- Added query indexes for creator sales and tips.
- Added production static asset cache headers and deferred homepage `app.js`.
- Added Hindi privacy summary; English policy retained with realistic security wording.
- Updated package version metadata to 3.21.0, removed stale backend lockfile that did not match current manifest, duplicate legacy root backup script and stray 5-byte SEO file.

## Verification performed
- ZIP archive integrity check.
- JavaScript syntax check across project files.
- Existing payout unit tests (4 tests) pass.
- Added static code checks for the backup/restore implementation.

## Not live-tested
No live MongoDB, GridFS media, payment provider sandbox, Render deployment, browser session or bank transfer was available in this environment. Run the deployment checklist below before production release.

## Deployment checklist
1. Set `CREATOR_SHARE=0.9` in Render Environment; this overrides YAML defaults.
2. Keep `PAYOUT_ENC_KEY` unchanged.
3. Keep payout fees at zero until actual fees and applicable tax treatment are confirmed.
4. Run `npm install` from backend service root and `npm test`.
5. Run `npm run backup` and verify both `presethub_media.files.ejsonl.gz` and `presethub_media.chunks.ejsonl.gz` exist if GridFS has data.
6. Test restore on a disposable MongoDB database using `CONFIRM_RESTORE=YES npm run restore -- /path/to/backup-folder`.
7. Run sandbox preset purchase and verify order becomes paid, paid preset downloads, duplicate webhook is harmless, refund reverses creator earnings.
8. Test a creator withdrawal request and admin manual UTR flow.
9. Verify Privacy Policy, cookies and mobile performance in a real browser.

## Important known limitation
PhonePe source still uses Basic Authorization webhook credentials, not HMAC. Do not set HMAC-only configuration until the exact PhonePe merchant-specific signature format is implemented and tested. Firebase is intentionally excluded.
