/* PresetHub QR encoder: generates QR codes in the browser, so no link is ever sent to a third-party QR service.
   ISO/IEC 18004, byte mode (UTF-8), versions 1-10 (up to 213 bytes at level M), error correction L/M/Q/H.
   window.PresetHubQR.create(text, { ecc: 'M' }) -> { size, version, mask, get(x, y) }
   window.PresetHubQR.drawToCanvas(ctx, qr, x, y, px, { border, dark, light, radius })
   window.PresetHubQR.toSvg(qr, { border, dark, light })                                                      */
(function (root) {
  'use strict';

  // [ec codewords per block, blocks in group 1, data codewords per block (g1), blocks in group 2, data codewords per block (g2)]
  var TABLE = {
    L: [null, [7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0], [26, 1, 108, 0, 0], [18, 2, 68, 0, 0], [20, 2, 78, 0, 0], [24, 2, 97, 0, 0], [30, 2, 116, 0, 0], [18, 2, 68, 2, 69]],
    M: [null, [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]],
    Q: [null, [13, 1, 13, 0, 0], [22, 1, 22, 0, 0], [18, 2, 17, 0, 0], [26, 2, 24, 0, 0], [18, 2, 15, 2, 16], [24, 4, 19, 0, 0], [18, 2, 14, 4, 15], [22, 4, 18, 2, 19], [20, 4, 16, 4, 17], [24, 6, 19, 2, 20]],
    H: [null, [17, 1, 9, 0, 0], [28, 1, 16, 0, 0], [22, 2, 13, 0, 0], [16, 4, 9, 0, 0], [22, 2, 11, 2, 12], [28, 4, 15, 0, 0], [26, 4, 13, 1, 14], [26, 4, 14, 2, 15], [24, 4, 12, 4, 13], [28, 6, 15, 2, 16]]
  };
  var FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };
  var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  var MAX_VERSION = 10;

  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return Array.prototype.slice.call(new TextEncoder().encode(str));
    var out = [], s = unescape(encodeURIComponent(str));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }
  function dataCapacity(version, ecc) { var t = TABLE[ecc][version]; return t[1] * t[2] + t[3] * t[4]; }
  function bit(x, i) { return ((x >>> i) & 1) !== 0; }

  // ---- Reed-Solomon over GF(256), polynomial 0x11D ----
  function gfMul(a, b) {
    var z = 0;
    for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((b >>> i) & 1) * a; }
    return z & 255;
  }
  function rsDivisor(degree) {
    var res = [], i, j;
    for (i = 0; i < degree - 1; i++) res.push(0);
    res.push(1);
    var root = 1;
    for (i = 0; i < degree; i++) {
      for (j = 0; j < res.length; j++) { res[j] = gfMul(res[j], root); if (j + 1 < res.length) res[j] ^= res[j + 1]; }
      root = gfMul(root, 0x02);
    }
    return res;
  }
  function rsRemainder(data, divisor) {
    var res = divisor.map(function () { return 0; });
    data.forEach(function (b) {
      var factor = b ^ res.shift();
      res.push(0);
      divisor.forEach(function (coef, i) { res[i] ^= gfMul(coef, factor); });
    });
    return res;
  }

  function buildCodewords(bytes, version, ecc) {
    var cap = dataCapacity(version, ecc) * 8, bits = [];
    function push(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    push(4, 4);                                  // byte mode
    push(bytes.length, version <= 9 ? 8 : 16);   // character count
    bytes.forEach(function (b) { push(b, 8); });
    push(0, Math.min(4, cap - bits.length));     // terminator
    while (bits.length % 8) bits.push(0);
    for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) push(pad, 8);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) { var v = 0; for (var k = 0; k < 8; k++) v = (v << 1) | bits[i + k]; data.push(v); }

    var t = TABLE[ecc][version], ecLen = t[0], blocks = [], div = rsDivisor(ecLen), pos = 0;
    function addBlocks(count, len) {
      for (var b = 0; b < count; b++) { var d = data.slice(pos, pos + len); pos += len; blocks.push({ data: d, ec: rsRemainder(d, div) }); }
    }
    addBlocks(t[1], t[2]); addBlocks(t[3], t[4]);
    var out = [], maxData = Math.max(t[2], t[4]);
    for (var c = 0; c < maxData; c++) blocks.forEach(function (bl) { if (c < bl.data.length) out.push(bl.data[c]); });
    for (var e = 0; e < ecLen; e++) blocks.forEach(function (bl) { out.push(bl.ec[e]); });
    return out;
  }

  function create(text, opts) {
    opts = opts || {};
    var ecc = TABLE[opts.ecc] ? opts.ecc : 'M';
    var bytes = utf8(String(text));
    var version = 0, v;
    for (v = 1; v <= MAX_VERSION; v++) {
      var need = 4 + (v <= 9 ? 8 : 16) + bytes.length * 8;
      if (need <= dataCapacity(v, ecc) * 8) { version = v; break; }
    }
    if (!version) throw new Error('QR: text too long (max ' + dataCapacity(MAX_VERSION, ecc) + ' bytes at level ' + ecc + ')');

    var size = 17 + 4 * version, i, x, y;
    var mod = [], fn = [];
    for (y = 0; y < size; y++) { mod.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    function setFn(px, py, dark) { if (px >= 0 && px < size && py >= 0 && py < size) { mod[py][px] = dark; fn[py][px] = true; } }

    for (i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) { var d = Math.max(Math.abs(dx), Math.abs(dy)); setFn(c[0] + dx, c[1] + dy, d !== 2 && d !== 4); }
    });
    var ap = ALIGN[version], last = ap.length - 1;
    ap.forEach(function (ax, ia) {
      ap.forEach(function (ay, ib) {
        if ((ia === 0 && ib === 0) || (ia === 0 && ib === last) || (ia === last && ib === 0)) return;
        for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) setFn(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      });
    });
    function drawFormat(mask) {
      var data = (FORMAT_BITS[ecc] << 3) | mask, rem = data, k;
      for (k = 0; k < 10; k++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var bits = ((data << 10) | rem) ^ 0x5412;
      for (k = 0; k <= 5; k++) setFn(8, k, bit(bits, k));
      setFn(8, 7, bit(bits, 6)); setFn(8, 8, bit(bits, 7)); setFn(7, 8, bit(bits, 8));
      for (k = 9; k < 15; k++) setFn(14 - k, 8, bit(bits, k));
      for (k = 0; k < 8; k++) setFn(size - 1 - k, 8, bit(bits, k));
      for (k = 8; k < 15; k++) setFn(8, size - 15 + k, bit(bits, k));
      setFn(8, size - 8, true);
    }
    drawFormat(0);
    if (version >= 7) {
      var rem = version, k;
      for (k = 0; k < 12; k++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var vbits = (version << 12) | rem;
      for (k = 0; k < 18; k++) { var b = bit(vbits, k), a = size - 11 + (k % 3), c2 = Math.floor(k / 3); setFn(a, c2, b); setFn(c2, a, b); }
    }

    // place codewords in the zig-zag order
    var cw = buildCodewords(bytes, version, ecc), n = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          x = right - j;
          var upward = ((right + 1) & 2) === 0;
          y = upward ? size - 1 - vert : vert;
          if (!fn[y][x] && n < cw.length * 8) { mod[y][x] = bit(cw[n >>> 3], 7 - (n & 7)); n++; }
        }
      }
    }

    function applyMask(m) {
      for (var yy = 0; yy < size; yy++) for (var xx = 0; xx < size; xx++) {
        var inv;
        switch (m) {
          case 0: inv = (xx + yy) % 2 === 0; break;
          case 1: inv = yy % 2 === 0; break;
          case 2: inv = xx % 3 === 0; break;
          case 3: inv = (xx + yy) % 3 === 0; break;
          case 4: inv = (Math.floor(xx / 3) + Math.floor(yy / 2)) % 2 === 0; break;
          case 5: inv = (xx * yy) % 2 + (xx * yy) % 3 === 0; break;
          case 6: inv = ((xx * yy) % 2 + (xx * yy) % 3) % 2 === 0; break;
          default: inv = ((xx + yy) % 2 + (xx * yy) % 3) % 2 === 0;
        }
        if (!fn[yy][xx] && inv) mod[yy][xx] = !mod[yy][xx];
      }
    }
    function penalty() {
      var p = 0, r, c, run, dark = 0;
      for (r = 0; r < size; r++) {
        run = 1;
        for (c = 1; c < size; c++) { if (mod[r][c] === mod[r][c - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; }
      }
      for (c = 0; c < size; c++) {
        run = 1;
        for (r = 1; r < size; r++) { if (mod[r][c] === mod[r - 1][c]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; }
      }
      for (r = 0; r < size - 1; r++) for (c = 0; c < size - 1; c++) { var v0 = mod[r][c]; if (v0 === mod[r][c + 1] && v0 === mod[r + 1][c] && v0 === mod[r + 1][c + 1]) p += 3; }
      var pat = [true, false, true, true, true, false, true];
      function finderLike(get) {
        var cnt = 0;
        for (var s = 0; s + 7 <= size; s++) {
          var ok = true;
          for (var q = 0; q < 7; q++) if (get(s + q) !== pat[q]) { ok = false; break; }
          if (!ok) continue;
          var before = true, after = true;
          for (q = 1; q <= 4; q++) { if (s - q >= 0 && get(s - q)) before = false; if (s + 6 + q < size && get(s + 6 + q)) after = false; }
          if (before || after) cnt++;
        }
        return cnt;
      }
      for (r = 0; r < size; r++) p += 40 * finderLike(function (i2) { return mod[r][i2]; });
      for (c = 0; c < size; c++) p += 40 * finderLike(function (i2) { return mod[i2][c]; });
      for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (mod[r][c]) dark++;
      var total = size * size;
      p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
      return p;
    }

    var best = 0, bestScore = Infinity;
    if (typeof opts.mask === 'number' && opts.mask >= 0 && opts.mask <= 7) best = opts.mask;
    else for (var m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      var score = penalty();
      if (score < bestScore) { bestScore = score; best = m; }
      applyMask(m);
    }
    applyMask(best); drawFormat(best);

    return { size: size, version: version, mask: best, ecc: ecc, get: function (px, py) { return px >= 0 && px < size && py >= 0 && py < size && mod[py][px]; } };
  }

  function drawToCanvas(ctx, qr, x, y, px, o) {
    o = o || {};
    var border = o.border == null ? 4 : o.border, dark = o.dark || '#111', light = o.light === undefined ? '#fff' : o.light;
    var cells = qr.size + border * 2, r = o.radius || 0;
    // Whole-pixel modules keep every edge crisp (no faint grid lines) and are the easiest for cameras to read.
    var cell = Math.max(1, Math.floor(px / cells)), used = cell * cells, off = Math.floor((px - used) / 2);
    if (light) { ctx.fillStyle = light; if (r && ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, px, px, r); ctx.fill(); } else ctx.fillRect(x, y, px, px); }
    ctx.fillStyle = dark;
    for (var yy = 0; yy < qr.size; yy++) {
      for (var xx = 0; xx < qr.size; xx++) {
        if (!qr.get(xx, yy)) continue;
        var run = 1; // merge horizontal runs into one rectangle
        while (xx + run < qr.size && qr.get(xx + run, yy)) run++;
        ctx.fillRect(x + off + (xx + border) * cell, y + off + (yy + border) * cell, run * cell, cell);
        xx += run - 1;
      }
    }
  }
  function toSvg(qr, o) {
    o = o || {};
    var border = o.border == null ? 4 : o.border, dark = o.dark || '#111', light = o.light === undefined ? '#fff' : o.light, d = '';
    for (var y = 0; y < qr.size; y++) for (var x = 0; x < qr.size; x++) if (qr.get(x, y)) d += 'M' + (x + border) + ',' + (y + border) + 'h1v1h-1z';
    var s = qr.size + border * 2;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + s + ' ' + s + '" shape-rendering="crispEdges">' + (light ? '<rect width="100%" height="100%" fill="' + light + '"/>' : '') + '<path d="' + d + '" fill="' + dark + '"/></svg>';
  }

  root.PresetHubQR = { create: create, drawToCanvas: drawToCanvas, toSvg: toSvg, maxBytes: function (ecc) { return dataCapacity(MAX_VERSION, ecc || 'M'); } };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PresetHubQR;
})(typeof window !== 'undefined' ? window : globalThis);
