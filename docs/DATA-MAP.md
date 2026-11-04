# Data map and tracking inventory: PresetHub v3.25.2

Keep this file current. Review it whenever you add a form, tool, vendor or purpose.

## Personal data
| Data | Where collected | Purpose | Stored in | Who can access | Retention |
|------|-----------------|---------|-----------|----------------|-----------|
| Email, name, password hash | Signup | Account, login | MongoDB `users` | Admins (no hash exposed) | While account exists |
| Username, bio, mobile (optional) | Profile | Public profile, payments | `users` | Public (username/bio), admins | While account exists |
| Consent proof (terms/privacy version, time, 18+) | Signup | Show valid consent | `users.consent` | Admins | While account exists |
| Cookie choice record (visitor ID, choice, version, page, time) | Cookie banner | Show valid consent | `consentlogs` | Admins | 3 years (TTL) |
| Orders, coupons, tips, boosts | Checkout | Deliver purchases, accounting | `orders` | Admins | As required by law |
| Payout details | Creator dashboard | Pay creators | `users.payoutEnc` (AES-GCM) | Admins with payouts permission | While needed |
| Presets, shayari, comments, reviews | User posts | Marketplace | `presets`, `textposts`, `comments` | Public / admins | Until deleted |
| IP address, browser, security events | Every request | Security, fraud | Alert and audit logs | Admins | Audit 1 year, alerts 60 days |
| Telegram ID, name, username, language, last activity | Linking the bot | Bot features | `users.telegram*` | Admins | Until unlink or account deletion |
| Support requests (Telegram ID, name, email, message) | Website / bot | Resolve requests | `supportrequests` | Admins | 1 year (TTL) |
| Push subscription | Allow notifications | Notifications | `users.pushSubscriptions` | System | Until revoked |
| Coordinates (optional) | "Nearby creators" | Show nearby creators | `users.location`, browser storage | Admins | While account exists |
| Database backups | Daily job | Recovery | Server disk, encrypted | Operator | Newest 7 |

Visitors who only chat with the Telegram bot: **no profile is stored**.

## Trackers and third parties
| Tool / vendor | Purpose | Data / events | When it fires | Owner / action |
|---------------|---------|---------------|---------------|----------------|
| Google Analytics 4 (Google) | Analytics | Page views, events | Only with "Analytics" consent | Owner: site admin. Retention 14 months. |
| Google AdSense (Google) | Advertising | Ad cookies | Only with "Advertising" consent; never for Pro | Review ad settings for personalised ads. |
| Meta Pixel (Meta) | Marketing | Page views, events | Only with "Marketing" consent | Remove if unused. |
| Google Fonts (Google) | Fonts | IP address | Every page | Consider self-hosting fonts to remove this transfer. |
| Cashfree / Youpi | Payments | Order and buyer details | At checkout | Check vendor security settings. |
| Render, MongoDB Atlas | Hosting, database | All data | Always | MFA, IP allow-list, least privilege. |
| Resend | Email | Email address, message | Account and order emails | Check sender domain (SPF/DKIM). |
| Telegram | Bot, admin alerts | Chat messages | When using the bot | Admin chat only for alerts. |
