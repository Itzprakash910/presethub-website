const path = require('path');
const fs = require('fs');
const ROOT = process.env.DATA_DIR || path.join(__dirname, '../..');
const paths = {
  root: ROOT,
  privateUploads: path.join(ROOT, 'private_uploads'),
  previews: path.join(ROOT, 'uploads', 'previews'),
  avatars: path.join(ROOT, 'uploads', 'avatars'),
  backups: path.join(ROOT, 'backups')
};
for (const p of Object.values(paths)) fs.mkdirSync(p, {recursive:true});
module.exports = paths;
