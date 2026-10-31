/** Restore a backup created by backend/backup.js. Destructive: merges/replaces docs by _id. */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib');
const { EJSON } = require('bson');
const mongoose = require('mongoose');

async function restore(dir) {
  if (!dir || !fs.existsSync(path.join(dir, '_manifest.json'))) throw new Error('Pass a valid backup directory containing _manifest.json');
  if (process.env.CONFIRM_RESTORE !== 'YES') throw new Error('Set CONFIRM_RESTORE=YES to confirm this destructive restore operation.');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, '_manifest.json'), 'utf8'));
  if (manifest.format !== 'presethub-mongodb-ejsonl-gzip-v1') throw new Error('Unsupported backup format');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const db = mongoose.connection.db;
    for (const [name, meta] of Object.entries(manifest.collections || {})) {
      const file = path.join(dir, meta.file || `${name}.ejsonl.gz`);
      if (!fs.existsSync(file)) throw new Error(`Missing backup collection file: ${file}`);
      const collection = db.collection(name);
      let batch = [];
      const input = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
      for await (const line of input) {
        if (!line) continue;
        const doc = EJSON.parse(line, { relaxed: false });
        batch.push({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } });
        if (batch.length >= 500) { await collection.bulkWrite(batch, { ordered: false }); batch = []; }
      }
      if (batch.length) await collection.bulkWrite(batch, { ordered: false });
      console.log(`Restored ${name}: ${meta.count} documents`);
    }
  } finally { await mongoose.disconnect(); }
}

if (require.main === module) restore(path.resolve(process.argv[2] || '')).catch(err => { console.error('Restore failed:', err); process.exit(1); });
module.exports = { restore };
