# Railway पर Deploy (GitHub से)

## 1. GitHub पर code डालें
```bash
cd presethub            # यही folder जिसमें package.json और railway.json है
git init && git add . && git commit -m "PresetHub"
git branch -M main
git remote add origin https://github.com/<username>/presethub.git
git push -u origin main
```
`.gitignore` की वजह से `.env`, `node_modules` और `backend/data/` push नहीं होंगे। **कभी `.env` push न करें।**

## 2. Railway project
1. railway.com → **New Project → Deploy from GitHub repo** → अपना repo चुनें।
2. Railway (Railpack builder) root पर `npm install` चलाएगा → `postinstall` backend की dependencies install करेगा। Build Command **खाली** छोड़ें।
3. Service → Settings में: Start Command `node backend/server.js`, Healthcheck Path `/health`, Restart On Failure (10 retries), Serverless **OFF**।

## 3. Volume (ज़रूरी – वरना restart पर सारा data मिट जाएगा)
Service → **Volumes → New Volume → Mount path: `/data`**

## 4. Variables (Service → Variables)
| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | नया random: `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"` |
| `DATA_DIR` | `/data` |
| `RAZORPAY_KEY_ID` | Razorpay dashboard से (**नई** key, पुरानी rotate करें) |
| `RAZORPAY_KEY_SECRET` | Razorpay dashboard से |
| `ADMIN_EMAIL` | आपका admin email |
| `ADMIN_PASSWORD` | 12+ अक्षर का मज़बूत password |

`PORT` Railway खुद देता है – सेट न करें। पहली बार admin बनने के बाद `ADMIN_PASSWORD` variable **delete** कर दें।

## 5. Public URL
Service → **Settings → Networking → Generate Domain**. वही URL खोलें, `/admin.html` पर admin login (साइट पर लॉग इन करने के बाद)।

## 6. Test checklist
- `https://<domain>/health` → `{"ok":true}`
- Signup → preset upload → admin से approve → download
- Razorpay test payment (test keys के साथ)
- Redeploy करें → data बना रहना चाहिए (Volume ठीक है)

## Notes
- Volume के साथ Railway पर **सिर्फ 1 replica** रखें (JSON DB एक ही server के लिए है)।
- असली traffic के लिए Railway का Postgres/Mongo इस्तेमाल करना बेहतर होगा।
- Custom domain लगाएं तो कुछ बदलना नहीं पड़ेगा (same-origin है)।
