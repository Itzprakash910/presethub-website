# Website privacy and compliance audit: PresetHub v3.25.2

Based on "The Website Privacy & Compliance Playbook" (India). This is an implementation checklist, **not legal advice**. Have an Indian lawyer or privacy professional review the final setup.

**DPDP timing note (from the playbook):** the Digital Personal Data Protection Act, 2023 and the DPDP Rules, 2025 commence in phases. The core notice, consent, security and rights duties are scheduled for **13 May 2027** (18 months after the Rules were published on 13 November 2025). Check the latest Gazette notifications before relying on a date. The Consumer Protection (E-Commerce) Rules, 2020 already apply to online sellers.

| # | Playbook item | Status | What the site does now | What you must do |
|---|---------------|--------|------------------------|------------------|
| 1 | Clear privacy notice | Done | `privacy.html` (3 Nov 2026) lists data, purposes, recipients (Cashfree, Render, MongoDB Atlas, Resend, Google, Meta, Telegram), retention and rights. Footer link on every page. | Re-read it whenever a tool or purpose changes (see `DATA-MAP.md`). |
| 2 | Valid consent where required | Done | Cookie banner: unticked choices for Analytics, Advertising, Marketing; "Reject optional" really rejects; withdrawal from footer "Cookie settings" removes cookies and reloads. Every choice is recorded (random visitor ID, choice, version, page, time; no IP) for 3 years. Signup now requires an unticked box for Terms + Privacy and an 18+ box; versions and time are stored on the account. There are no marketing emails (service emails only), so no separate marketing opt-in is needed. If you ever add a newsletter, add an unticked opt-in. | Existing accounts have no consent record: optionally ask them to accept on next login. |
| 3 | Contact and grievance route | Needs your details | Privacy and Refund pages show the grievance officer and business details from environment variables, with a truthful fallback (support@presethub.site) when unset. Contact page links to the grievance section. | **Set `LEGAL_ENTITY_NAME`, `LEGAL_ADDRESS`, `GRIEVANCE_OFFICER_NAME` (and email/address) in Render.** The server warns at startup until these are set. Assign an owner, keep a complaint log, test the inbox monthly. |
| 4 | Cookies, pixels, analytics audit | Done | No tracker is hard-coded in HTML. GA4 loads only with "Analytics", Meta Pixel only with "Marketing", AdSense only with "Advertising" (never for Pro members). `cookies.html` has the tool table (purpose, when it loads, retention). Google Fonts is disclosed (IP reaches Google). | Test in browser dev tools after each new tag. |
| 5 | Website terms and policies | Present | `terms.html`, `refund-policy.html`, `cookies.html`, `privacy.html`. | Lawyer review for subscriptions (Pro) and creator payouts. |
| 6 | E-commerce disclosures | Needs your details | Refund page has seller identity, contact and grievance officer fields (now filled from the same variables, no brackets). | Fill the variables; add GST/registration details if applicable. |
| 7 | Children's data | Done | Service is 18+: signup requires the confirmation (server-enforced, recorded). No date of birth or ID collected. Policy says AdSense/advertising is not knowingly aimed at children. | Decide with your lawyer whether any parental-consent flow is needed if minors might use the site. |
| 8 | Security and incident readiness | Mostly done | HTTPS, encrypted payout details, **encrypted backups** (AES-256-GCM), admin two-step verification (TOTP), audit log, alerts, rate limits. Incident plan in `INCIDENT-RESPONSE.md`. | Turn on MFA for **hosting, domain, email, MongoDB Atlas, Cashfree and GitHub** accounts (they are outside this code). Test a backup restore. Copy backups off-site. |

## Data-subject rights (how each is met)
- Access: Profile → "Download my data" (`/api/auth/my-data`).
- Correction: edit profile; email change via support.
- Erasure: Profile → Delete account (removes profile, comments, downloads, etc.). Order and payout records are kept for tax/accounting but contain no name or email and no longer point to a person. Telegram: `/forgetme`.
- Withdraw consent: footer "Cookie settings".
- Complaint: grievance officer, then the Data Protection Board of India.

## Retention (matches the policy)
Account data while active · orders/payouts as required by law · security and audit logs 1 year · alerts 60 days · cookie consent records 3 years · support requests 1 year · Telegram link until unlink/deletion · backups: newest 7 (encrypted).

## Launch checklist
- [ ] `LEGAL_ENTITY_NAME`, `LEGAL_ADDRESS`, `GRIEVANCE_OFFICER_NAME` set
- [ ] Privacy page shows the real officer and address (open it logged out)
- [ ] Cookie banner: Reject → no `googletagmanager`/`facebook`/`googlesyndication` requests in the Network tab
- [ ] Signup refuses without both boxes ticked
- [ ] Download my data and Delete account tested with a test account
- [ ] Grievance inbox monitored by a named person
- [ ] MFA on all admin, hosting, domain, email, database and payment accounts
- [ ] Lawyer review done; latest DPDP notifications checked
