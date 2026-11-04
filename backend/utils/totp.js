'use strict';
/**
 * Time-based one-time passwords (RFC 6238, SHA-1, 6 digits, 30 s) for admin two-step verification,
 * plus one-time backup codes. Works with Google Authenticator, Authy, 1Password, Microsoft Authenticator and others.
 * No third-party package: only Node's crypto.
 */
const crypto = require('crypto');
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
const generateSecret = () => base32Encode(crypto.randomBytes(20));

function hotp(secretBase32, counter, digits = 6) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secretBase32)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}
const stepOf = (now = Date.now(), period = 30) => Math.floor(now / 1000 / period);
const totp = (secret, now = Date.now(), digits = 6) => hotp(secret, stepOf(now), digits);

// Returns the matching time step (so the caller can refuse a code that was already used), or null.
function verifyTotp(secret, code, now = Date.now(), window = 1) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const base = stepOf(now);
  for (let w = -window; w <= window; w++) {
    const a = Buffer.from(hotp(secret, base + w)), b = Buffer.from(c);
    if (crypto.timingSafeEqual(a, b)) return base + w;
  }
  return null;
}
const otpauthUrl = (label, secret, issuer = 'PresetHub') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// Backup codes look like "k3f9-a7q2"; only their SHA-256 hashes are stored.
const hashCode = c => crypto.createHash('sha256').update(String(c).toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');
function generateBackupCodes(n = 8) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const make = () => Array.from({ length: 8 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  const codes = Array.from({ length: n }, () => { const s = make(); return `${s.slice(0, 4)}-${s.slice(4)}`; });
  return { codes, hashes: codes.map(hashCode) };
}
const looksLikeBackupCode = c => /^[a-z0-9]{4}-?[a-z0-9]{4}$/i.test(String(c || '').trim());

module.exports = { generateSecret, totp, verifyTotp, otpauthUrl, generateBackupCodes, hashCode, looksLikeBackupCode, base32Encode, base32Decode, stepOf };
