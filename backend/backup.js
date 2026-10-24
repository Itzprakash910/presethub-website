/**
 * Logical backup: exports every MongoDB collection (except raw GridFS chunks) to
 * backups/<timestamp>/<collection>.json and keeps only the newest 7 backups.
 * Usage: npm run backup   (needs MONGODB_URI in .env)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const SKIP = new Set(['presethub_media.chunks']);
const KEEP = 7;

async function run() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(__dirname, '..', 'backups', stamp);
  fs.mkdirSync(dir, { recursive: true });
  const cols = (await db.listCollections().toArray()).map(c => c.name).filter(n => !n.startsWith('system.') && !SKIP.has(n));
  const summary = {};
  for (const name of cols) {
    const docs = await db.collection(name).find({}).toArray();
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(docs));
    summary[name] = docs.length;
  }
  fs.writeFileSync(path.join(dir, '_manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), collections: summary }, null, 2));
  // retention
  const root = path.dirname(dir);
  const all = fs.readdirSync(root).filter(n => fs.statSync(path.join(root, n)).isDirectory()).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) fs.rmSync(path.join(root, old), { recursive: true, force: true });
  console.log('Backup written to', dir, summary);
  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch(err => { console.error('Backup failed:', err.message); process.exit(1); });
}
module.exports = { run };
