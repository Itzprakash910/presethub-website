const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '../..');
const LOCAL_UPLOAD_DIR = path.join(projectRoot, 'uploads');
const PUBLIC_URL = (process.env.CLIENT_URL || 'https://presethub.site').replace(/\/+$/, '');

if (!fs.existsSync(LOCAL_UPLOAD_DIR)) fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });

function useR2() {
  return !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME && process.env.R2_PUBLIC_URL);
}

async function uploadToR2(buffer, key, contentType) {
  if (useR2()) {
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const R2 = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      }
    });
    try {
      await R2.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key, Body: buffer, ContentType: contentType
      }));
      return `${(process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '')}/${key}`;
    } catch (err) {
      // Keep uploads usable if R2 is temporarily unavailable. The server log keeps
      // the real storage error; the client receives a working local URL instead.
      console.error('R2 upload failed; using local fallback:', err.message);
    }
  }
  // Local fallback
  const prefix = `${PUBLIC_URL}/uploads/`;
  const localKey = String(key).startsWith(prefix) ? String(key).slice(prefix.length) : String(key).replace(/^\/+/, '');
  if (localKey.includes('..')) return;
  const fullPath = path.join(LOCAL_UPLOAD_DIR, localKey);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, buffer);
  return `${PUBLIC_URL}/uploads/${key}`;
}

async function deleteFromR2(key) {
  if (!key) return;
  if (useR2()) {
    try {
      const prefix = `${String(process.env.R2_PUBLIC_URL).replace(/\/+$/, '')}/`;
      const objectKey = String(key).startsWith(prefix) ? String(key).slice(prefix.length) : String(key).replace(/^\/+/, '');
      const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
      const R2 = new S3Client({
        region: 'auto',
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
        }
      });
      await R2.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: objectKey }));
    } catch (err) { console.warn('R2 delete failed:', err.message); }
    return;
  }
  // Local fallback
  const prefix = `${PUBLIC_URL}/uploads/`;
  const localKey = String(key).startsWith(prefix) ? String(key).slice(prefix.length) : String(key).replace(/^\/+/, '');
  if (localKey.includes('..')) return;
  const fullPath = path.join(LOCAL_UPLOAD_DIR, localKey);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
}

async function getPresignedUploadUrl() {
  throw new Error('Presigned URLs require R2 configuration');
}

function isR2Configured() { return useR2(); }

module.exports = { uploadToR2, deleteFromR2, getPresignedUploadUrl, isR2Configured };