const multer = require('multer');
const path = require('path');
const fs = require('fs');

const projectRoot = path.join(__dirname, '../..');
const uploadDir = path.join(projectRoot, 'uploads');
const previewDir = path.join(uploadDir, 'previews');

[uploadDir, previewDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (file.fieldname === 'previewImage') {
      cb(null, previewDir);
    } else {
      cb(null, uploadDir);
    }
  },
  filename: function (req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  if (file.fieldname === 'previewImage') {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only images are allowed for preview'), false);
  } else {
    const allowed = ['.xmp', '.dng', '.lrtemplate'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only .xmp, .dng, .lrtemplate files are allowed'), false);
  }
};

const uploadFields = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
}).fields([
  { name: 'file', maxCount: 1 },
  { name: 'previewImage', maxCount: 1 }
]);

module.exports = { uploadFields };