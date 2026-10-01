require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { connectDB } = require('./config/db');
const { User, Preset, Order, Download } = require('./models');

const backupDir = path.join(__dirname, '../backups');

async function runBackup() {
  await connectDB();
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const [users, presets, orders, downloads] = await Promise.all([
    User.find({}).lean(),
    Preset.find({}).lean(),
    Order.find({}).lean(),
    Download.find({}).lean()
  ]);

  const date = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(backupDir, `backup_${date}.json`);
  fs.writeFileSync(dest, JSON.stringify({ users, presets, orders, downloads, exportedAt: new Date().toISOString() }, null, 2));
  console.log(`✅ Backup saved: ${dest}`);

  const BOT_TOKEN = process.env.BOT_TOKEN;
  const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
  if (BOT_TOKEN && ADMIN_CHAT_ID) {
    try {
      const form = new FormData();
      form.append('document', fs.createReadStream(dest));
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, form, {
        headers: form.getHeaders(), params: { chat_id: ADMIN_CHAT_ID }
      });
      console.log('📤 Sent to Telegram');
    } catch (e) { console.error('Telegram send failed:', e.message); }
  }
  process.exit(0);
}

runBackup().catch(err => { console.error('Backup failed:', err); process.exit(1); });