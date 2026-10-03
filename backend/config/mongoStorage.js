const path = require('path');
const mongoose = require('mongoose');
const { GridFSBucket, ObjectId } = mongoose.mongo;

// PresetHub storage is MongoDB-only. Binary files (preset packages, preview
// posters and profile images) are stored in MongoDB GridFS.
const PUBLIC_URL = (process.env.CLIENT_URL || 'https://presethub.site').replace(/\/+$/, '');
const BUCKET_NAME = 'presethub_media';

function gridBucket() {
  if (!mongoose.connection.db) throw new Error('MongoDB is not connected');
  return new GridFSBucket(mongoose.connection.db, { bucketName: BUCKET_NAME });
}

function mediaUrl(id) {
  return `${PUBLIC_URL}/media/${id.toString()}`;
}

/**
 * Store a binary buffer directly in MongoDB GridFS.
 */
async function uploadToMongo(buffer, key, contentType, metadata = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('Empty upload');
  const bucket = gridBucket();
  const safeName = path.basename(String(key || `upload-${Date.now()}`)).slice(0, 180);
  const uploadStream = bucket.openUploadStream(safeName, {
    contentType: contentType || 'application/octet-stream',
    metadata: {
      ...metadata,
      storageKey: String(key || ''),
      originalKey: String(key || ''),
      uploadedAt: new Date()
    }
  });

  await new Promise((resolve, reject) => {
    uploadStream.once('finish', resolve);
    uploadStream.once('error', reject);
    uploadStream.end(buffer);
  });
  return mediaUrl(uploadStream.id);
}

async function deleteFromMongo(key) {
  if (!key) return;
  const value = String(key);
  const match = value.match(/\/media\/([a-f0-9]{24})(?:$|\?)/i);
  if (!match || !mongoose.isValidObjectId(match[1])) return;
  try {
    await gridBucket().delete(new ObjectId(match[1]));
  } catch (err) {
    // A missing GridFS object should not prevent deletion of its MongoDB record.
    if (!/FileNotFound/i.test(String(err.message))) console.warn('GridFS delete failed:', err.message);
  }
}

function isMongoStorageConfigured() { return false; }
async function getDirectUploadUrl() { throw new Error('Direct storage URLs are disabled; MongoDB GridFS is the only storage backend.'); }

async function getStoredFileStream(fileUrl, storageKey = '', filename = '') {
  const value = String(fileUrl || '').trim();
  const match = value.match(/\/media\/([a-f0-9]{24})(?:$|\?)/i);
  if (!match || !mongoose.isValidObjectId(match[1])) throw new Error('Stored media not found');
  const id = new ObjectId(match[1]);
  const db = mongoose.connection.db;
  const bucket = gridBucket();
  const meta = await db.collection(`${BUCKET_NAME}.files`).findOne({ _id: id });
  if (!meta) throw new Error('Stored media not found');
  return {
    stream: bucket.openDownloadStream(id),
    contentType: meta.contentType || 'application/octet-stream',
    length: meta.length,
    filename: filename || meta.filename,
    metadata: meta.metadata || {}
  };
}

module.exports = { uploadToMongo, deleteFromMongo, getDirectUploadUrl, isMongoStorageConfigured, gridBucket, getStoredFileStream, BUCKET_NAME };
