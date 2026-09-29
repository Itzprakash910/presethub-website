const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Preset files are PRIVATE (served only via authenticated download route).
// Preview images are public.
const { PRIVATE_DIR, PREVIEW_DIR } = require('../utils/paths');

const IMG_EXT = ['.jpg', '.jpeg', '.png', '.webp'];   // gif/svg removed (svg = XSS risk)
const IMG_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const PRESET_EXT = ['.xmp', '.dng', '.lrtemplate'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, file.fieldname === 'previewImage' ? PREVIEW_DIR : PRIVATE_DIR),
  filename: (req, file, cb) => {
    // random name, extension whitelisted below – user filename is never used on disk
    cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).toLowerCase());
  }
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (file.fieldname === 'previewImage') {
    if (IMG_EXT.includes(ext) && IMG_MIME.includes(file.mimetype)) return cb(null, true);
    return cb(new Error('Preview must be JPG, PNG or WEBP'));
  }
  if (file.fieldname === 'file') {
    if (PRESET_EXT.includes(ext)) return cb(null, true);
    return cb(new Error('Only .xmp, .dng, .lrtemplate files are allowed'));
  }
  cb(new Error('Unexpected field'));
};

module.exports = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024, files: 2, fields: 10 }
}).fields([{ name: 'file', maxCount: 1 }, { name: 'previewImage', maxCount: 1 }]);

module.exports.PRIVATE_DIR = PRIVATE_DIR;
module.exports.PREVIEW_DIR = PREVIEW_DIR;
