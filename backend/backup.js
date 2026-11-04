/**
 * Logical backup: exports every MongoDB collection (except raw GridFS chunks) to
 * backups/<timestamp>/<collection>.json and keeps only the newest 7 backups.
 * Usage: npm run backup   (needs MONGODB_URI in .env)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const backupCrypto = require('./utils/backupCrypto');

const SKIP = new Set(['presethub_media.chunks']);
const KEEP = 7;

async function run({ reuse = false } = {}) {
  const own = mongoose.connection.readyState !== 1;
  if (own) {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
    await mongoose.connect(process.env.MONGODB_URI);
  }
  const db = mongoose.connection.db;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(__dirname, '..', 'backups', stamp);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const cols = (await db.listCollections().toArray()).map(c => c.name).filter(n => !n.startsWith('system.') && !SKIP.has(n));
  const summary = {};
  for (const name of cols) {
    const docs = await db.collection(name).find({}).toArray();
    const json = Buffer.from(JSON.stringify(docs));
    // Encrypted whenever a key is configured (BACKUP_ENC_KEY or PAYOUT_ENC_KEY). Without a key the file is plain, so set one.
    if (backupCrypto.isConfigured()) fs.writeFileSync(path.join(dir, `${name}.json.enc`), backupCrypto.encrypt(json), { mode: 0o600 });
    else fs.writeFileSync(path.join(dir, `${name}.json`), json, { mode: 0o600 });
    summary[name] = docs.length;
  }
  fs.writeFileSync(path.join(dir, '_manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), encrypted: backupCrypto.isConfigured(), collections: summary }, null, 2));
  if (!backupCrypto.isConfigured()) console.warn('⚠️ Backup written WITHOUT encryption: set BACKUP_ENC_KEY (64 hex characters).');
  // retention
  const root = path.dirname(dir);
  const all = fs.readdirSync(root).filter(n => fs.statSync(path.join(root, n)).isDirectory()).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) fs.rmSync(path.join(root, old), { recursive: true, force: true });
  console.log('Backup written to', dir, summary);
  if (own && !reuse) await mongoose.disconnect();
  return { dir, summary };
}

if (require.main === module) {
  run().catch(err => { console.error('Backup failed:', err.message); process.exit(1); });
}
module.exports = { run };
