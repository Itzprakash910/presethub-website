const fs = require('fs');
const { DB_PATH } = require('../utils/paths');
const DEFAULTS = () => ({ users: [], presets: [], downloads: [], orders: [] });

let dbData = null;
let writing = Promise.resolve();

function loadData() {
  if (!fs.existsSync(DB_PATH)) {
    dbData = DEFAULTS();
    fs.writeFileSync(DB_PATH, JSON.stringify(dbData, null, 2));
    return;
  }
  try {
    dbData = { ...DEFAULTS(), ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) };
  } catch (err) {
    // Corrupt file: keep a backup instead of silently wiping data
    fs.copyFileSync(DB_PATH, `${DB_PATH}.corrupt-${Date.now()}`);
    console.error('db.json corrupt, backup saved. Starting empty.', err.message);
    dbData = DEFAULTS();
  }
}

// Atomic + serialized write: temp file -> rename, one at a time
function saveData() {
  writing = writing.then(() => {
    const tmp = `${DB_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(dbData, null, 2));
    fs.renameSync(tmp, DB_PATH);
  }).catch(err => console.error('DB write failed:', err));
  return writing;
}

async function getDB() {
  if (!dbData) loadData();
  return { data: dbData, write: saveData };
}

module.exports = { getDB };
