# Incident response plan: PresetHub

Use this when you suspect a data breach, account takeover, leaked key or payment fraud. Keep a copy outside the server.

## Roles
- **Incident owner:** the person named as grievance officer (decides, coordinates).
- **Technical lead:** whoever can change hosting, database and keys.
- **Legal contact:** your Indian lawyer or privacy professional (fill in the number here: __________).

## First hour
1. **Contain.** Rotate the exposed secret (see list below), block affected accounts (Admin → Users), revoke sessions (changing `JWT_SECRET` logs everyone out), disable the affected feature if needed.
2. **Preserve evidence.** Do not delete logs. Export the audit log and alerts (Admin → Alerts), note times, IPs, accounts, and what was accessed. Keep the Render and Atlas logs.
3. **Assess.** What data (emails, hashes, orders, payout details)? How many people? Was it only read, or changed? Payout details are encrypted; password hashes are bcrypt.

## Keys to rotate (in this order for a suspected server compromise)
MongoDB password → `JWT_SECRET` → `BOT_TOKEN` → Cashfree/Youpi keys and webhook secrets → `RESEND_API_KEY` → VAPID keys → `PAYOUT_ENC_KEY` and `BACKUP_ENC_KEY` (re-encrypt stored payout data and old backups first, otherwise they become unreadable) → admin passwords and MFA.

## Notify
- Affected people: without undue delay, in plain language: what happened, what data, what you did, what they should do (change password, watch for phishing).
- Regulator: report to the Data Protection Board of India and affected people as required once the DPDP breach provisions are in force (see `PRIVACY-COMPLIANCE-CHECKLIST.md` for the timeline); also CERT-In for cyber incidents (they currently ask for reporting within 6 hours of noticing). Your lawyer decides the exact content and timing.
- Payment provider (Cashfree/Youpi) if payment data or fraud is involved.

## Recover and learn
Restore from the latest encrypted backup if data was damaged (`node scripts/decrypt-backup.js backups/<stamp>/<collection>.json.enc`), patch the cause, run `npm test`, write a short post-incident note (cause, impact, fix, what changes), and update `DATA-MAP.md` if needed.

## Monthly drill (15 minutes)
Send a test message to the grievance inbox, check that the alert chat receives a test alert, and confirm that you can find and decrypt a backup.
