const path = require('path');
const fs = require('fs');

// All persistent data (db + uploads) lives under DATA_DIR.
// On Railway: attach a Volume at /data and set DATA_DIR=/data
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const PRIVATE_DIR = path.join(DATA_DIR, 'private_uploads');   // preset files (never public)
const PREVIEW_DIR = path.join(DATA_DIR, 'previews');          // public preview images
[DATA_DIR, PRIVATE_DIR, PREVIEW_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

module.exports = { DATA_DIR, PRIVATE_DIR, PREVIEW_DIR, DB_PATH: path.join(DATA_DIR, 'db.json') };
