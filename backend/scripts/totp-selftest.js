#!/usr/bin/env node
/** Tests utils/totp.js against the official RFC 6238 / RFC 4226 vectors. Run: npm run totp:test */
const assert = require('assert');
const T = require('../utils/totp');
let ok = 0;
const test = (n, f) => { f(); ok++; console.log('PASS  ' + n); };
const RFC_SECRET = T.base32Encode(Buffer.from('12345678901234567890'));
test('RFC 6238 test vectors (SHA-1, 8 digits)', () => {
  const v = { 59: '94287082', 1111111109: '07081804', 1111111111: '14050471', 1234567890: '89005924', 2000000000: '69279037', 20000000000: '65353130' };
  for (const [t, code] of Object.entries(v)) assert.strictEqual(T.totp(RFC_SECRET, Number(t) * 1000, 8), code, 'time ' + t);
});
test('6-digit code for T=59 is 287082', () => assert.strictEqual(T.totp(RFC_SECRET, 59000), '287082'));
test('base32 round trip', () => { const b = require('crypto').randomBytes(20); assert.ok(T.base32Decode(T.base32Encode(b)).equals(b)); });
test('verify: accepts current and +-1 step, rejects older, wrong and malformed codes', () => {
  const now = 1700000000000, s = RFC_SECRET;
  assert.strictEqual(T.verifyTotp(s, T.totp(s, now), now), T.stepOf(now));
  assert.strictEqual(T.verifyTotp(s, T.totp(s, now - 30000), now), T.stepOf(now) - 1);
  assert.strictEqual(T.verifyTotp(s, T.totp(s, now + 30000), now), T.stepOf(now) + 1);
  assert.strictEqual(T.verifyTotp(s, T.totp(s, now - 90000), now), null);
  for (const bad of ['', '12345', '1234567', 'abcdef', null, undefined, '12 34 5']) assert.strictEqual(T.verifyTotp(s, bad, now), null);
});
test('secrets are 160-bit base32 and unique; otpauth URL is well formed', () => {
  const a = T.generateSecret(), b = T.generateSecret();
  assert.ok(/^[A-Z2-7]{32}$/.test(a) && a !== b);
  const u = T.otpauthUrl('admin@presethub.site', a); assert.ok(u.startsWith('otpauth://totp/PresetHub:admin%40presethub.site?secret=' + a) && /issuer=PresetHub/.test(u));
});
test('backup codes: 8 unique codes, only hashes stored, matching ignores case and dash', () => {
  const { codes, hashes } = T.generateBackupCodes();
  assert.strictEqual(codes.length, 8); assert.strictEqual(new Set(codes).size, 8);
  assert.ok(codes.every(c => /^[a-z2-9]{4}-[a-z2-9]{4}$/.test(c) && T.looksLikeBackupCode(c)));
  assert.ok(hashes.includes(T.hashCode(codes[0].toUpperCase().replace('-', ''))) && !hashes.some(h => codes.includes(h)));
  assert.ok(!T.looksLikeBackupCode('123456'));
});
console.log(`\n${ok} passed, 0 failed.`);
