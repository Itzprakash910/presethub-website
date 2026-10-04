# PresetHub v2.9.6 — Deployment Notes

## Deploy
Render:
- Root directory: `backend`
- Build: `npm install`
- Start: `npm start`

Required secrets:
- `MONGODB_URI`
- `JWT_SECRET` (32+ random characters)
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD` (strong; 12+ characters recommended/required by admin bootstrap policy)
- Razorpay secrets as applicable
- VAPID keys as applicable for background notifications

## Admin login
Do not hard-code the admin password in the repository. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in Render Environment Variables. On startup the configured admin email is created/promoted to `role=admin`.

The source intentionally does not contain a real admin password.

## New Admin features
- Platform analytics and payment overview.
- User search, details, block/activate and permanent deletion.
- Preset approved/rejected moderation.
- Broadcast notifications to all active users.
- Individual user notifications.
- Personal home promotion/ad creation and editing.
- Product price, sale price and discount display.
- Ad impressions/click tracking.

## Home ad fields
- Title
- Description
- Photo URL (`https://...` or a PresetHub `/media/...` URL)
- Product name
- Original price
- Sale price
- Discount percentage (auto-calculated when omitted)
- CTA link (internal path or HTTPS URL)
- Badge
- Active state

## Mobile UI
Header order is now:
`PresetHub → Profile → Messages → Notifications → •••`

Search is on the next row on narrow screens. The `•••` menu contains account actions and the Admin Panel link for admin users.

## Footer
Public footers now include:
- Install App
- Telegram Bot

## Testing after deploy
1. Login with a normal user.
2. Login with the configured admin email.
3. Confirm Admin Panel appears inside `•••` only for admin users.
4. Create a test home ad and confirm it appears on the home page.
5. Click the ad and verify click count increases.
6. Send a broadcast notification and verify the in-app notification badge.
7. If VAPID is configured, verify browser permission and background push.
8. Test header at 320/360/390/412px widths.
9. Test browser back and external navigation exit confirmation.
10. Test search suggestions/result readability in light and dark themes.
11. Run `npm audit` in CI and review the dependency lockfile before production release.
