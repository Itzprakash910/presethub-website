# PresetHub v3.21.0

## Production fixes
- Render default creator commission corrected to 90% (`CREATOR_SHARE=0.9`); removed obsolete payout auto-approval setting. Payouts remain manual-only.
- Replaced the incomplete logical backup with gzip-compressed BSON Extended JSON Lines exports for every MongoDB collection, including both GridFS `.files` and `.chunks` collections.
- Added guarded restore command (`CONFIRM_RESTORE=YES npm run restore -- <backup-directory>`); restore merges/replaces documents by `_id` and intentionally does not delete unrelated live records.
- Added creator earnings ledger API with pagination and CSV export. Refunded orders are shown as reversals with zero creator/platform earned share.
- Added compound indexes for creator sales/tip ledger queries.
- Added static asset caching and deferred the main homepage JavaScript bundle.
- Added a Hindi privacy summary alongside the detailed English policy.
- Removed duplicate root-level legacy backup script and a 5-byte stray SEO artifact. Kept `db.seed.json` because its role must be confirmed before deletion.
- Synchronized root/backend package versions to 3.21.0; backend's stale lockfile (which did not describe the current backend manifest) was removed so Render's `npm install` resolves the declared dependencies instead of using incorrect locked dependencies.

## Deliberately not added
- Firebase Authentication/Firestore/Realtime Database/Storage: excluded as requested. Existing JWT + MongoDB + GridFS architecture is preserved.
- AI photo matching/recommendations, automated affiliate payouts, and before/after image editor: these require external AI/image services, product UX and/or provider credentials. No fake buttons or non-working placeholders have been added. See `FUTURE-ROADMAP-v3.21.0.md`.
- PhonePe HMAC webhook: not guessed. Current implementation continues to verify the configured Basic Authorization credentials and independently fetches authoritative order status. Obtain the exact merchant-specific PhonePe HMAC header/canonicalization specification before migrating.

## Environment
- Set `CREATOR_SHARE=0.9` in Render dashboard. Render environment values override `render.yaml`.
- Keep existing `PAYOUT_ENC_KEY` unchanged.
- Keep `PAYOUT_FEE_PAISE=0` until a real payout fee is confirmed. GST is calculated only on configured fee; confirm applicable tax treatment before enabling deductions.
- Backup files contain personal and financial records. Keep them private, restrict access to the host, and copy encrypted backups to a separate secure location.
