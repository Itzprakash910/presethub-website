# PresetHub – Lightroom Preset Marketplace

Node.js + Express + JSON file DB, vanilla JS frontend, PWA.

## Setup
```bash
cd backend
npm install
cp .env.example .env
# put a strong secret in .env:
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
# add ADMIN_EMAIL / ADMIN_PASSWORD (12+ chars) to .env, then:
npm run create-admin      # afterwards delete ADMIN_PASSWORD from .env
npm run dev               # http://localhost:4000
```

## Deploy
See **DEPLOY.md** (GitHub → Railway, Volume at `/data`, env variables).

## Security model
- Preset files are stored in `DATA_DIR/private_uploads/` (default `backend/data/`) and only delivered by `POST /api/presets/:id/download` (login + purchase check).
- Only `DATA_DIR/previews/` (images) is public.
- New uploads are `pending` until an admin approves them.
- Helmet CSP, strict CORS allow-list, rate limits (login/signup/payments), 50kb body limit.
- Prices are always read from the server DB; Razorpay signature checked with timing-safe compare.

## Production checklist
1. `NODE_ENV=production`, serve over HTTPS, `TRUST_PROXY=1` behind a proxy.
2. Rotate any key that was ever committed/shared (JWT secret, Razorpay).
3. Back up `backend/db/db.json` (or move to a real DB like Postgres/Mongo before real traffic).
4. Run `npm audit`.

## License
MIT
