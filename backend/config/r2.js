const path = require('path');
const mongoose = require('mongoose');
const { GridFSBucket, ObjectId } = mongoose.mongo;

const PUBLIC_URL = (process.env.CLIENT_URL || 'https://presethub.site').replace(/\/+$/, '');

function useR2() {
  return !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME && process.env.R2_PUBLIC_URL);
}

function gridBucket() {
  if (!mongoose.connection.db) throw new Error('MongoDB is not connected');
  return new GridFSBucket(mongoose.connection.db, { bucketName: 'presethub_media' });
}

async function uploadToR2(buffer, key, contentType) {
  if (useR2()) {
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const R2 = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
    });
    try {
      await R2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: buffer, ContentType: contentType }));
      return `${String(process.env.R2_PUBLIC_URL).replace(/\/+$/, '')}/${key}`;
    } catch (err) {
      console.error('R2 upload failed; using MongoDB GridFS:', err.message);
    }
  }

  const bucket = gridBucket();
  const uploadStream = bucket.openUploadStream(path.basename(key), {
    contentType: contentType || 'application/octet-stream',
    metadata: { storageKey: key, originalKey: key, uploadedAt: new Date() }
  });
  await new Promise((resolve, reject) => {
    uploadStream.on('finish', resolve);
    uploadStream.on('error', reject);
    uploadStream.end(buffer);
  });
  return `${PUBLIC_URL}/media/${uploadStream.id.toString()}`;
}

async function deleteFromR2(key) {
  if (!key) return;
  const value = String(key);
  if (useR2()) {
    try {
      const prefix = `${String(process.env.R2_PUBLIC_URL).replace(/\/+$/, '')}/`;
      const objectKey = value.startsWith(prefix) ? value.slice(prefix.length) : value.replace(/^\/+/, '');
      const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
      const R2 = new S3Client({
        region: 'auto',
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
      });
      await R2.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: objectKey }));
      return;
    } catch (err) { console.warn('R2 delete failed:', err.message); }
  }

  const match = value.match(/\/media\/([a-f0-9]{24})(?:$|\?)/i);
  if (!match || !mongoose.isValidObjectId(match[1])) return;
  try { await gridBucket().delete(new ObjectId(match[1])); } catch (err) { console.warn('GridFS delete failed:', err.message); }
}

async function getPresignedUploadUrl() { throw new Error('Presigned URLs require R2 configuration'); }
function isR2Configured() { return useR2(); }

module.exports = { uploadToR2, deleteFromR2, getPresignedUploadUrl, isR2Configured, gridBucket };
