const multer = require('multer');
const path = require('path');

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
const PRESET_EXTS = ['.xmp', '.dng', '.lrtemplate', '.cube', '.3dl', '.look', '.costyle', '.xml', '.json', '.zip'];

function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function validateUploadedFile(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const isImage = ['previewImage', 'previewImages', 'avatar'].includes(file.fieldname);

  if (isImage) {
    if (!IMAGE_EXTS.includes(ext)) throw new Error('Only JPG, JPEG, PNG or WEBP images are allowed');
    const detected = detectImageType(file.buffer);
    if (!detected || !['image/jpeg','image/png','image/webp'].includes(detected)) {
      throw new Error('Invalid image file signature');
    }
    if (ext === '.jpg' || ext === '.jpeg') {
      if (detected !== 'image/jpeg') throw new Error('Image extension does not match file content');
    } else if (ext === '.png') {
      if (detected !== 'image/png') throw new Error('Image extension does not match file content');
    } else if (ext === '.webp') {
      if (detected !== 'image/webp') throw new Error('Image extension does not match file content');
    }
    return;
  }

  if (!PRESET_EXTS.includes(ext)) {
    throw new Error('Unsupported preset format. Allowed: XMP, DNG, LRTEMPLATE, CUBE, 3DL, LOOK, COSTYLE, XML, JSON, ZIP.');
  }

  // Preset files are never executed by the server. They are stored as opaque
  // downloads and are always served with Content-Disposition: attachment.
  if (!Buffer.isBuffer(file.buffer) || file.buffer.length === 0) throw new Error('Empty preset file');
  if (ext === '.zip' && file.buffer.subarray(0,4).toString('hex') !== '504b0304' && file.buffer.subarray(0,4).toString('hex') !== '504b0506') {
    throw new Error('Invalid ZIP preset file');
  }
}

const fileFilter = (req, file, cb) => {
  // Multer's fileFilter runs before memoryStorage has exposed the complete
  // buffer, so extension filtering happens here; content/magic validation is
  // performed immediately after parsing in the route-level helper below.
  const isImage = ['previewImage', 'previewImages', 'avatar'].includes(file.fieldname);
  const ext = path.extname(file.originalname).toLowerCase();
  if (isImage && IMAGE_EXTS.includes(ext)) return cb(null, true);
  if (!isImage && PRESET_EXTS.includes(ext)) return cb(null, true);
  return cb(new Error(isImage ? 'Only JPG, JPEG, PNG or WEBP images are allowed' : 'Unsupported preset format. Allowed: XMP, DNG, LRTEMPLATE, CUBE, 3DL, LOOK, COSTYLE, XML, JSON, ZIP.'), false);
};

const uploadFields = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024, files: 2, fields: 20, parts: 25 }
}).fields([
  { name: 'file', maxCount: 1 },
  { name: 'previewImage', maxCount: 1 }
]);

const bulkUploadFields = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  // Bulk uploads use a smaller per-file limit to prevent multi-GB RAM pressure.
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

function validateParsedUploads(req) {
  const all = [
    ...(req.files?.file || []),
    ...(req.files?.files || []),
    ...(req.files?.previewImage || []),
    ...(req.files?.previewImages || []),
    ...(req.file ? [req.file] : [])
  ];
  for (const file of all) validateUploadedFile(file);
  const total = all.reduce((sum, file) => sum + Number(file.size || file.buffer?.length || 0), 0);
  if ((req.files?.files?.length || 0) > 0 && total > 300 * 1024 * 1024) {
    throw new Error('Bulk upload total size cannot exceed 300MB per request');
  }
  return true;
}

function safeImageContentType(file) { return detectImageType(file?.buffer) || 'application/octet-stream'; }

module.exports = { uploadFields, bulkUploadFields, uploadAvatar, validateParsedUploads, detectImageType, safeImageContentType };
