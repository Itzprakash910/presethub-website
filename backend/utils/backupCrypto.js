'use strict';
/**
 * Encryption for database backups (AES-256-GCM). A backup holds password hashes, emails and orders, so it must never sit on disk in plain text.
 * Key: BACKUP_ENC_KEY (64 hex characters). If it is not set, a key is derived from PAYOUT_ENC_KEY, so existing setups are protected too.
 * File format: "PHB1" + 12-byte IV + 16-byte auth tag + ciphertext.
 */
const crypto = require('crypto');
const MAGIC = Buffer.from('PHB1');

function getKey() {
  const own = String(process.env.BACKUP_ENC_KEY || '');
  if (/^[a-f0-9]{64}$/i.test(own)) return Buffer.from(own, 'hex');
  const payout = String(process.env.PAYOUT_ENC_KEY || '');
  if (/^[a-f0-9]{64}$/i.test(payout)) return crypto.createHmac('sha256', Buffer.from(payout, 'hex')).update('presethub-backup-v1').digest();
  return null;
}
const isConfigured = () => !!getKey();

function encrypt(buf) {
  const key = getKey();
  if (!key) throw new Error('BACKUP_ENC_KEY (or PAYOUT_ENC_KEY) is not configured');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}
function decrypt(file) {
  const key = getKey();
  if (!key) throw new Error('BACKUP_ENC_KEY (or PAYOUT_ENC_KEY) is not configured');
  if (file.length < 32 || !file.subarray(0, 4).equals(MAGIC)) throw new Error('Not a PresetHub encrypted backup');
  const d = crypto.createDecipheriv('aes-256-gcm', key, file.subarray(4, 16));
  d.setAuthTag(file.subarray(16, 32));
  return Buffer.concat([d.update(file.subarray(32)), d.final()]);
}
module.exports = { encrypt, decrypt, isConfigured };
