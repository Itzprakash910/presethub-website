const path = require('path');
const fs = require('fs');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..');
const dbPath = path.join(dataDir, 'db.json');
const defaultData = { users: [], presets: [], downloads: [], orders: [], categories: [] };
let db;
let writeQueue = Promise.resolve();

async function getDB() {
  if (!db) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const adapter = new JSONFile(dbPath);
    db = new Low(adapter, defaultData);
    await db.read();
    db.data = Object.assign(defaultData, db.data || {});
    for (const k of Object.keys(defaultData)) if (!Array.isArray(db.data[k])) db.data[k] = [];
  }
  return db;
}

async function writeDB() {
  const current = await getDB();
  writeQueue = writeQueue.then(async () => {
    const tmp = `${dbPath}.tmp`;
    const text = JSON.stringify(current.data, null, 2);
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, dbPath);
    await current.read();
  });
  return writeQueue;
}

module.exports = { getDB, writeDB, dbPath };
