const fs = require('fs');

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const isEmail = e => typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

// Only http/https URLs (blocks javascript:, data:, etc.)
function safeUrl(v, max = 300) {
  const s = str(v, max);
  if (!s) return '';
  try {
    const u = new URL(s);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : null;
  } catch { return null; }
}

function removeFiles(files) {
  Object.values(files || {}).flat().forEach(f => fs.unlink(f.path, () => {}));
}

// Check real file signature, not just extension
function isRealImage(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const b = Buffer.alloc(12);
    fs.readSync(fd, b, 0, 12, 0);
    fs.closeSync(fd);
    const jpg = b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;
    const png = b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
    const webp = b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP';
    return jpg || png || webp;
  } catch { return false; }
}

// Public view of a preset (never expose fileUrl / internal fields)
const publicPreset = ({ fileUrl, ...rest }) => ({ ...rest, hasFile: !!fileUrl });

module.exports = { str, isEmail, safeUrl, removeFiles, isRealImage, publicPreset };
