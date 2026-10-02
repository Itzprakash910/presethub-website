# PresetHub v2.3 Final QA

## Implemented
- Same-process Telegram bot startup via `npm start` + BOT_TOKEN.
- Bot status exposed at `/api/bot/status` and health includes bot state.
- Resumable IndexedDB upload queue resumes on pageshow, focus and visibility return.
- Profile avatar upload remains queued if navigation interrupts the request.
- Local/R2 asset URL handling normalized.
- Free download path supports anonymous users; paid download requires authenticated ownership/payment.
- Home hero uses the weighted `/api/presets/featured` result.
- Search entity panel includes matching presets, users, categories and tags.
- Preset card descriptions/titles use bounded text layout.
- Supplied icon/logo/social pack merged into frontend assets.
- `.env.example` added with secrets left blank.

## Required deployment secrets
`MONGODB_URI`, `JWT_SECRET`, `BOT_TOKEN`, `ADMIN_CHAT_ID` and payment/storage credentials are intentionally not hard-coded.
