require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { connectDB } = require('./backend/config/db');
const { User, Preset, Order, Download, Share, Comment, Message, HomeAd } = require('./backend/models');

const backupDir = path.join(__dirname, 'backups');

async function runBackup() {
  await connectDB();
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const collections = await Promise.all([
    ['users', User.find({}).lean()],
    ['presets', Preset.find({}).lean()],
    ['orders', Order.find({}).lean()],
    ['downloads', Download.find({}).lean()],
    ['shares', Share.find({}).lean()],
    ['comments', Comment.find({}).lean()],
    ['messages', Message.find({}).lean()],
    ['homeAds', HomeAd.find({}).lean()]
  ].map(async ([name, query]) => [name, await query]));
  const data = Object.fromEntries(collections);
  data.users = (data.users || []).map(u => {
    const safe = { ...u };
    delete safe.password; delete safe.token; delete safe.passwordResetTokenHash; delete safe.passwordResetExpires;
    delete safe.pushSubscriptions; delete safe.sessionVersion;
    return safe;
  });
  data.exportedAt = new Date().toISOString();
  const date = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(backupDir, `mongo_backup_${date}.json`);
  fs.writeFileSync(dest, JSON.stringify(data, null, 2), { mode: 0o600 });
  try { fs.chmodSync(dest, 0o600); } catch (_) {}
  console.log(`✅ MongoDB backup saved: ${dest}`);

  const BOT_TOKEN = process.env.BOT_TOKEN;
  const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
  if (BOT_TOKEN && ADMIN_CHAT_ID) {
    try {
      const form = new FormData();
      form.append('document', fs.createReadStream(dest));
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, form, {
        headers: form.getHeaders(), params: { chat_id: ADMIN_CHAT_ID }
      });
      console.log('📤 Backup sent to Telegram');
    } catch (e) { console.error('Telegram send failed:', e.message); }
  }
  process.exit(0);
}
runBackup().catch(err => { console.error('Backup failed:', err); process.exit(1); });
