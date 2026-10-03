# PresetHub – Lightroom Presets Marketplace

PresetHub is a Node.js + Express + vanilla-JS PWA for discovering, previewing, uploading and downloading Lightroom presets.

## Final QA highlights
- Responsive 4/3/2-column preset cards with stable poster/DP fallbacks.
- Public preset data uses stale-while-revalidate caching so previously loaded public data remains visible offline.
- Private preset files are **not** served as static `/uploads` files; downloads go through the authenticated API.
- Uploads use random filenames and file-size/type limits. Preview images and avatars are public only.
- Search suggestions use a compact Instagram-style bordered result list with backdrop blur.
- Selected-download toolbar stays hidden until at least one preset is selected.
- Creator cards include a three-dot action menu.
- Share sheet supports QR, short preset link, native share and image+link copy fallback.
- Preset URLs generate server-side Open Graph/Twitter metadata for social previews.
- Google AdSense publisher metadata/script and `ads.txt` are included.
- Telegram bot can run in the same Node process as the website when `BOT_TOKEN` is configured.
- Admin routes are server-authorized; frontend admin pages are `noindex,nofollow`.

## Security
Never put JWT secrets, Telegram bot tokens, Razorpay secrets, admin passwords or database files in the public ZIP/repository. Browser-delivered HTML/CSS/JS can never be made secret; security comes from protecting server routes, secrets and private files.

## Local setup
```bash
npm install
cp backend/.env.example backend/.env
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
# put the generated value into JWT_SECRET
cd backend && npm install
npm run create-admin
npm start
```

## Production
Use HTTPS and a persistent volume such as `/data`. Set `DATA_DIR=/data`. Keep one replica when using the included JSON storage. For high concurrency, migrate the data layer to MongoDB/Postgres before scaling horizontally.

## Telegram bot
The bot starts automatically with the website process when `BOT_TOKEN` is present. Commands are registered through Telegram's command menu. If the token is blank, the website still runs normally.

## AdSense
The frontend contains the publisher ID `ca-pub-3554311294133493`, the standard AdSense loader and `frontend/ads.txt`. AdSense approval/account settings are still controlled by Google.
