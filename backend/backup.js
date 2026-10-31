/**
 * Full logical MongoDB backup, including GridFS binary chunks.
 * Each collection is stored as gzip-compressed Extended JSON Lines so BSON
 * Binary/ObjectId/Date/Decimal128 values survive a backup/restore round-trip.
 * Usage: npm run backup
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const mongoose = require('mongoose');
const { EJSON } = require('bson');

const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP || 7));
const BATCH_SIZE = Math.max(100, Number(process.env.BACKUP_BATCH_SIZE || 500));

async function exportCollection(db, name, dir) {
  const dest = path.join(dir, `${name}.ejsonl.gz`);
  const cursor = db.collection(name).find({}).batchSize(BATCH_SIZE);
  const gzip = zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED });
  const output = fs.createWriteStream(dest, { mode: 0o600 });
  let count = 0;
  const writer = (async () => {
    for await (const doc of cursor) {
      if (!gzip.write(`${EJSON.stringify(doc, { relaxed: false })}\n`)) await new Promise(resolve => gzip.once('drain', resolve));
      count++;
    }
    gzip.end();
  })();
  await Promise.all([writer, pipeline(gzip, output)]);
  try { fs.chmodSync(dest, 0o600); } catch (_) {}
  return { count, file: path.basename(dest), bytes: fs.statSync(dest).size };
}

async function run() {
  const own = mongoose.connection.readyState !== 1;
  if (own) {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
    await mongoose.connect(process.env.MONGODB_URI);
  }
  try {
    const db = mongoose.connection.db;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const root = path.join(__dirname, '..', 'backups');
    const dir = path.join(root, stamp);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const names = (await db.listCollections().toArray()).map(c => c.name).filter(n => !n.startsWith('system.')).sort();
    const collections = {};
    for (const name of names) collections[name] = await exportCollection(db, name, dir);
    const manifest = {
      format: 'presethub-mongodb-ejsonl-gzip-v1',
      createdAt: new Date().toISOString(),
      database: db.databaseName,
      includesGridFS: names.some(n => n.endsWith('.chunks')) && names.some(n => n.endsWith('.files')),
      collections
    };
    fs.writeFileSync(path.join(dir, '_manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    const dirs = fs.readdirSync(root).filter(n => fs.statSync(path.join(root, n)).isDirectory()).sort();
    for (const old of dirs.slice(0, Math.max(0, dirs.length - KEEP))) fs.rmSync(path.join(root, old), { recursive: true, force: true });
    const summary = Object.fromEntries(Object.entries(collections).map(([name, meta]) => [name, meta.count]));
    console.log(`Backup complete: ${dir}`);
    console.log(`Collections: ${names.length}; GridFS included: ${manifest.includesGridFS}`);
    return { dir, manifest, summary };
  } finally {
    if (own) await mongoose.disconnect();
  }
}

if (require.main === module) run().catch(err => { console.error('Backup failed:', err); process.exit(1); });
module.exports = { run, exportCollection };
