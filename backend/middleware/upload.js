const multer = require('multer');
const path = require('path');

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
const PRESET_EXTS = ['.xmp', '.dng', '.lrtemplate'];

const fileFilter = (req, file, cb) => {
  const isImage = ['previewImage', 'previewImages', 'avatar'].includes(file.fieldname);
  const ext = path.extname(file.originalname).toLowerCase();
  if (isImage) {
    if (IMAGE_EXTS.includes(ext)) return cb(null, true);
    return cb(new Error('Only JPG, JPEG, PNG or WEBP images are allowed'), false);
  }
  if (PRESET_EXTS.includes(ext)) return cb(null, true);
  return cb(new Error('Only .xmp, .dng and .lrtemplate files are allowed'), false);
};

const uploadFields = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024, files: 2, fields: 20, parts: 25 }
}).fields([
  { name: 'file', maxCount: 1 },
  { name: 'previewImage', maxCount: 1 }
]);

// Bulk uploads intentionally use a lower per-file limit to prevent excessive RAM use:
// 20 preset files + 20 previews can otherwise allocate a very large multipart payload.
const bulkUploadFields = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 25 * 1024 * 1024, files: 40, fields: 30, parts: 80 }
}).fields([
  { name: 'files', maxCount: 20 },
  { name: 'previewImages', maxCount: 20 }
]);

const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10, parts: 12 }
}).single('avatar');

module.exports = { uploadFields, bulkUploadFields, uploadAvatar };
