// backend/backup.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data'); // ✅ import form-data

const source = path.join(__dirname, 'db.json');
const backupDir = path.join(__dirname, '../backups');

if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

const date = new Date().toISOString().replace(/[:.]/g, '-');
const dest = path.join(backupDir, `db_backup_${date}.json`);

// Copy file first
fs.copyFile(source, dest, async (err) => {
  if (err) {
    console.error('❌ Backup failed:', err);
    return;
  }
  console.log(`✅ Database backed up to ${dest}`);

  // Send to Telegram (optional)
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

  if (BOT_TOKEN && ADMIN_CHAT_ID) {
    try {
      const form = new FormData();
      form.append('document', fs.createReadStream(dest));
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, form, {
        headers: form.getHeaders(),
        params: { chat_id: ADMIN_CHAT_ID }
      });
      console.log('📤 Backup sent to Telegram.');
    } catch (teleErr) {
      console.error('❌ Failed to send to Telegram:', teleErr.message);
    }
  }
});