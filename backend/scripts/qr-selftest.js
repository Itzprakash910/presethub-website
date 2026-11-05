#!/usr/bin/env node
/** Structural tests for frontend/qr.js (no camera needed). Run: npm run qr:test
 *  A full scan test with a real QR decoder is in scripts/e2e-share-qr.py (needs Python, Playwright and OpenCV). */
const assert = require('assert');
const Q = require('../../frontend/qr.js');
let ok = 0; const test = (n, f) => { f(); ok++; console.log('PASS  ' + n); };

test('picks the smallest version and the right size', () => {
  assert.strictEqual(Q.create('https://presethub.site/s/AQhyzit', { ecc: 'Q' }).version, 3);
  assert.strictEqual(Q.create('A', { ecc: 'M' }).size, 21);
  assert.strictEqual(Q.create('x'.repeat(14), { ecc: 'M' }).version, 1);
  assert.strictEqual(Q.create('x'.repeat(15), { ecc: 'M' }).version, 2);
  assert.strictEqual(Q.create('x'.repeat(213), { ecc: 'M' }).version, 10);
});
test('rejects text that is too long instead of producing a broken code', () => {
  assert.throws(() => Q.create('x'.repeat(214), { ecc: 'M' }), /too long/);
});
test('finder, timing and dark module are in place', () => {
  const q = Q.create('https://presethub.site/preset/abc', { ecc: 'M' }), n = q.size;
  for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
      const edge = i === 0 || j === 0 || i === 6 || j === 6, core = i >= 2 && i <= 4 && j >= 2 && j <= 4;
      assert.strictEqual(q.get(ox + i, oy + j), edge || core, `finder at ${ox},${oy}`);
    }
  }
  for (let i = 8; i < n - 8; i++) { assert.strictEqual(q.get(i, 6), i % 2 === 0); assert.strictEqual(q.get(6, i), i % 2 === 0); }
  assert.strictEqual(q.get(8, n - 8), true);
});
test('format information is a valid BCH codeword in both copies', () => {
  const q = Q.create('hello', { ecc: 'Q', mask: 3 }), n = q.size;
  const read1 = [];
  for (let i = 0; i <= 5; i++) read1[i] = q.get(8, i); read1[6] = q.get(8, 7); read1[7] = q.get(8, 8); read1[8] = q.get(7, 8);
  for (let i = 9; i < 15; i++) read1[i] = q.get(14 - i, 8);
  const read2 = [];
  for (let i = 0; i < 8; i++) read2[i] = q.get(n - 1 - i, 8);
  for (let i = 8; i < 15; i++) read2[i] = q.get(8, n - 15 + i);
  const val = a => a.reduce((v, b, i) => v | ((b ? 1 : 0) << i), 0);
  assert.strictEqual(val(read1), val(read2), 'both copies match');
  const bits = val(read1) ^ 0x5412, data = bits >>> 10;
  let rem = data; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  assert.strictEqual(bits & 0x3FF, rem, 'BCH check');
  assert.strictEqual(data & 7, 3, 'mask number'); assert.strictEqual(data >>> 3, 3, 'level Q = 3');
});
test('same input gives the same code, different input differs', () => {
  const a = Q.create('https://presethub.site/s/AAAA', { ecc: 'Q' }), b = Q.create('https://presethub.site/s/AAAA', { ecc: 'Q' }), c = Q.create('https://presethub.site/s/AAAB', { ecc: 'Q' });
  const dump = q => Array.from({ length: q.size }, (_, y) => Array.from({ length: q.size }, (_, x) => +q.get(x, y)).join('')).join('|');
  assert.strictEqual(dump(a), dump(b)); assert.notStrictEqual(dump(a), dump(c));
});
test('SVG output is valid and sized for the quiet zone', () => {
  const q = Q.create('abc', { ecc: 'L' }), svg = Q.toSvg(q, { border: 4 });
  assert.ok(svg.startsWith('<svg') && svg.includes(`viewBox="0 0 ${q.size + 8} ${q.size + 8}"`) && svg.includes('<path'));
});
test('unicode text is encoded as UTF-8 bytes', () => {
  const q = Q.create('आपकी शायरी 😀', { ecc: 'M' }); assert.ok(q.version >= 1 && q.size === 17 + 4 * q.version);
});
console.log(`\n${ok} passed, 0 failed.`);
