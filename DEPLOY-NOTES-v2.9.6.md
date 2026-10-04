# PresetHub v2.9.6 Deployment Notes

1. Deploy with Node 20.x and MongoDB.
2. Set `MONGODB_URI`, `JWT_SECRET` (32+ random chars), `ADMIN_EMAIL`, and a strong `ADMIN_PASSWORD` as Render secrets. Do not place real credentials in source.
3. Keep `CLIENT_URL=https://presethub.site`.
4. Optional Razorpay, Resend, Telegram, and Web Push environment variables may be configured as needed.
5. After deploy, verify `/healthz`, login, preset search, preset download, admin dashboard, notifications, share, PWA install, and mobile header/menu.
6. Because v2.9.6 uses QuickChart for the share-modal QR image, an outbound HTTPS image request is required for that optional QR visual. If the QR provider is unavailable, the share link and native/social share buttons still work.
