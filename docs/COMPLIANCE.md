# PresetHub compliance and launch status (v3.20.0)

Developer checklist, not legal advice. A qualified lawyer should review the final privacy notice, refund policy and breach plan.

## 1. DPDP Act / Rules checklist

| # | Item | Status | Where |
|---|------|--------|-------|
| 1 | Privacy notice: data, purpose, retention, sharing, rights, complaint route | Done | `frontend/privacy.html` |
| 1 | Notice in an Indian language (Eighth Schedule) | Open | Translate privacy.html |
| 2 | Consent is specific, not pre-ticked | Done for analytics (loads only after "accept"); sign-up uses Clerk | `frontend/tracking.js`, `cookie-consent.js` |
| 2 | Withdraw consent as easily as giving it | Done (cookie banner choice can be changed; analytics stop) | `cookie-consent.js` |
| 3 | Named grievance officer + contact | Open: fill the placeholder name and address | `privacy.html` §5 |
| 4 | Analytics and pixels only after consent; reject = no scripts | Done | `tracking.js` |
| 4 | Accept and Reject buttons of equal prominence | Check the banner design | `cookie-consent.js` |
| 5 | Children under 18 | Statement in privacy.html; no behavioural ads. Age-check flow open | `privacy.html` §6 |
| 6 | HTTPS everywhere | Done (HSTS via helmet) | `backend/server.js` |
| 6 | Admin MFA | Done: Clerk 2-step verification is required for admins (`ADMIN_MFA_REQUIRED=on`) | `backend/middleware/auth.js` |
| 6 | Least privilege for admins | Done: roles super / operations / finance / marketing / support, enforced on the server | `backend/utils/permissions.js` |
| 6 | Access logs kept at least 1 year | Done for admin actions (audit log, 1 year). Full HTTP access logs: open | `AuditLogEntry` |
| 6 | Encryption of sensitive fields | Done for payout bank/UPI details (AES-256-GCM) | `backend/utils/crypto.js` |
| 6 | Backups + vendor security clauses | Daily backup done (local disk). Off-site copy and vendor contracts: open | `backend/backup.js` |
| 7 | Breach plan | Done (below) | this file |

## 2. Consumer protection (online sale)

| Item | Status |
|------|--------|
| Refund, cancellation, shipping (digital delivery) policy | Done: `frontend/refund-policy.html` (linked in footer) |
| Legal name, registered address, contact, grievance officer on the website | Open: fill placeholders in `refund-policy.html` §8 |

## 3. Launch SEO and tracking (Sundan Sharma checklist)

| Item | Status |
|------|--------|
| Own domain, HTTPS, one canonical host | Done in code; DNS/Render setting must point www and apex to one host |
| Unique title and meta description on every page | Done (static and server-rendered pages) |
| Search Console verification (HTML file + meta tag) | Done (`googlebd85aa1dfde78f37.html`, `GSC_VERIFICATION_TOKEN`) |
| Sitemap with absolute URLs, only indexable pages | Done (`/sitemap.xml`, dynamic) |
| robots.txt with AI crawler groups | Done |
| llms.txt | Done |
| GA4 and Meta Pixel (consent-gated) | Done; set `GA_MEASUREMENT_ID`, `META_PIXEL_ID` |
| Content visible without JavaScript (homepage presets, shayari) | Open: pre-rendering needed |
| Conversions API (server-side Meta events) | Open |

## 4. Admin panel guide

| Item | Status |
|------|--------|
| User management (block, verify, delete = deactivate) | Done (soft delete for accounts) |
| Content management without app update | Partly (banners and categories by admin; some content by DB) |
| Payments, refunds, commissions, filters | Done (refunds: Finance / Super; > ₹5,000 needs Super Admin) |
| Notifications with targeting | Partly (broadcast to all; targeting open) |
| Reports and CSV export | Done (payouts CSV; others open) |
| Roles and permissions on the server | Done |
| Audit log | Done |
| Dashboard | Done |
| Admin login OTP / 2-step | Done through Clerk MFA (required for admins) |
| App settings (fees, maintenance mode) | Open |
| Support tickets | Partly (support requests list) |
| Soft delete and confirmations | Done (confirm dialogs; accounts deactivated) |
| Daily backups | Done (local); off-site open |

## 5. Breach response plan

Owner: Super Admin. Keep this list up to date with the real names and contacts.

1. **Detect.** Sources: admin alerts (Telegram and email), audit log, Render and Clerk notices, and user reports to support@presethub.site.
2. **Contain (within the hour).** Revoke affected sessions (Clerk: sign out users, rotate keys), block the attacker's IP, disable the affected feature, and keep evidence (logs). Do not delete logs.
3. **Assess (same day).** What data, how many users, whether it was encrypted, whether payment or payout data is involved.
4. **Notify users without undue delay** by email, with what happened, what data, what they should do, and how to contact the grievance officer.
5. **Report to the Data Protection Board** as the DPDP Rules require (the summary used in this project says a detailed report within 72 hours). Check the current Rules before the deadline.
6. **Cyber incidents and CERT-In.** CERT-In has separate reporting rules (the summary used in this project says within 6 hours). Confirm whether they apply to PresetHub.
7. **Recover and learn.** Fix the cause, restore from backup if needed, and write a short post-incident note.

## 6. Setup needed before launch

- Fill the placeholders: grievance officer name and address (privacy.html §5), business legal name and address (refund-policy.html §8).
- Clerk Dashboard (Production): turn on 2-step verification for admin accounts; add Google OAuth credentials; keep "Verify at sign-up" on.
- Render: set `ADMIN_MFA_REQUIRED=on` (default), `GA_MEASUREMENT_ID` and `META_PIXEL_ID` if you use them, `BACKUP_DAILY=on`.
- Search Console: submit `https://presethub.site/sitemap.xml`; request indexing for the homepage after the live test.
