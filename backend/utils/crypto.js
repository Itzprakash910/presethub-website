/**
 * AES-256-GCM field encryption for sensitive payout details (bank account, UPI).
 * Key: PAYOUT_ENC_KEY = 64 hex characters (32 bytes). Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
const crypto = require('crypto');

function key() {
  const hex = String(process.env.PAYOUT_ENC_KEY || '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}
function isKeyConfigured() { return Boolean(key()); }

function encrypt(plain) {
  const k = key();
  if (!k) throw new Error('PAYOUT_ENC_KEY is not configured');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

function decrypt(token) {
  const k = key();
  if (!k) throw new Error('PAYOUT_ENC_KEY is not configured');
  const [v, iv, tag, data] = String(token || '').split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Bad ciphertext');
  const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, isKeyConfigured };
