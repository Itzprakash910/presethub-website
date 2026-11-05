/* PresetHub share card.
   Draws a shareable PNG card for a preset: preview image, name, creator (followers), reviews, likes, views, downloads and a
   QR code that opens the preset on the website. The QR is generated in the browser (qr.js); nothing is sent to a QR service.
   window.PresetHubShareCard.build({ preset, creator, url, qrUrl, previewUrl, avatarUrl }) -> { canvas, toBlob(), filename }
   window.PresetHubShareCard.buildQrOnly({ qrUrl, label })                                  -> { canvas, toBlob(), filename } */
(function () {
  'use strict';
  var W = 1080, H = 1660;
  var C = { bg1: '#15120e', bg2: '#1f1a13', gold: '#d9a46c', goldDark: '#b9824a', text: '#f5efe6', muted: '#a99d8c', panel: '#231e17', line: '#3b3226', cream: '#f6efe3', ink: '#1c1711' };
  var FONT = '"Inter","Noto Sans Devanagari",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';

  function slug(v) { return String(v || 'preset').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'preset'; }
  function compact(n) { n = Number(n || 0); return n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.0', '') + 'k' : String(Math.round(n)); }
  function money(p) { p = Number(p || 0); return p > 0 ? '\u20B9' + (p % 1 ? p.toFixed(2) : p.toFixed(0)) : 'Free'; }

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function wrap(ctx, text, maxW, maxLines) {
    var words = String(text || '').split(/\s+/).filter(Boolean), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var test = cur ? cur + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width <= maxW) { cur = test; continue; }
      if (cur) lines.push(cur);
      cur = words[i];
      // one very long word: cut it
      while (ctx.measureText(cur).width > maxW && cur.length > 1) { var k = cur.length; while (k > 1 && ctx.measureText(cur.slice(0, k)).width > maxW) k--; lines.push(cur.slice(0, k)); cur = cur.slice(k); }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1];
      while (last.length > 1 && ctx.measureText(last + '\u2026').width > maxW) last = last.slice(0, -1);
      lines[maxLines - 1] = last.replace(/\s+$/, '') + '\u2026';
    }
    return lines;
  }

  // Loads an image without tainting the canvas (same-origin or CORS-enabled only). Returns null if it cannot be used.
  function loadImage(url) {
    if (!url) return Promise.resolve(null);
    return fetch(url, { credentials: 'same-origin', mode: 'cors' }).then(function (r) { if (!r.ok) throw new Error('img ' + r.status); return r.blob(); }).then(function (blob) {
      if (window.createImageBitmap) return createImageBitmap(blob);
      return new Promise(function (res, rej) { var u = URL.createObjectURL(blob), im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = u; });
    }).catch(function () { return null; });
  }
  function cover(ctx, img, x, y, w, h, r) {
    ctx.save(); rr(ctx, x, y, w, h, r); ctx.clip();
    var iw = img.width, ih = img.height, s = Math.max(w / iw, h / ih), dw = iw * s, dh = ih * s;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
  }

  // ---- small vector icons (no icon-font dependency) ----
  function iconStar(ctx, cx, cy, r, color) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r * 0.45 : r; ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); }
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  }
  function iconHeart(ctx, cx, cy, s, color) {
    ctx.beginPath(); ctx.moveTo(cx, cy + s * 0.9);
    ctx.bezierCurveTo(cx - s * 1.5, cy - s * 0.1, cx - s * 0.7, cy - s * 1.1, cx, cy - s * 0.35);
    ctx.bezierCurveTo(cx + s * 0.7, cy - s * 1.1, cx + s * 1.5, cy - s * 0.1, cx, cy + s * 0.9);
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  }
  function iconEye(ctx, cx, cy, s, color) {
    ctx.beginPath(); ctx.moveTo(cx - s * 1.3, cy); ctx.quadraticCurveTo(cx, cy - s * 1.25, cx + s * 1.3, cy); ctx.quadraticCurveTo(cx, cy + s * 1.25, cx - s * 1.3, cy);
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, s * 0.5, 0, Math.PI * 2); ctx.fillStyle = C.panel; ctx.fill();
  }
  function iconDownload(ctx, cx, cy, s, color) {
    ctx.strokeStyle = color; ctx.lineWidth = s * 0.28; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy - s); ctx.lineTo(cx, cy + s * 0.45); ctx.moveTo(cx - s * 0.7, cy - s * 0.2); ctx.lineTo(cx, cy + s * 0.5); ctx.lineTo(cx + s * 0.7, cy - s * 0.2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - s, cy + s); ctx.lineTo(cx + s, cy + s); ctx.stroke();
  }

  function fontsReady() {
    try {
      if (document.fonts && document.fonts.load) {
        return Promise.all([document.fonts.load('800 54px Inter'), document.fonts.load('600 30px Inter'), document.fonts.load('600 30px "Noto Sans Devanagari"')]).catch(function () {});
      }
    } catch (_) {}
    return Promise.resolve();
  }
  function toBlob(canvas) {
    return new Promise(function (res, rej) { canvas.toBlob(function (b) { b ? res(b) : rej(new Error('Could not create the image')); }, 'image/png'); });
  }

  function build(o) {
    var p = o.preset || {}, creator = o.creator || {};
    var qr = window.PresetHubQR.create(o.qrUrl || o.url, { ecc: 'Q' });
    return Promise.all([fontsReady(), loadImage(o.previewUrl), loadImage(o.avatarUrl)]).then(function (res) {
      var preview = res[1], avatar = res[2];
      var canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      var ctx = canvas.getContext('2d');

      // background
      var g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, C.bg1); g.addColorStop(1, C.bg2);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      var glow = ctx.createRadialGradient(W - 120, 120, 10, W - 120, 120, 520); glow.addColorStop(0, 'rgba(217,164,108,.20)'); glow.addColorStop(1, 'rgba(217,164,108,0)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

      // header
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      ctx.font = '800 40px ' + FONT; ctx.fillStyle = C.text; ctx.fillText('Preset', 60, 92);
      var pw = ctx.measureText('Preset').width; ctx.fillStyle = C.gold; ctx.fillText('Hub', 60 + pw, 92);
      ctx.textAlign = 'right'; ctx.font = '600 26px ' + FONT; ctx.fillStyle = C.muted; ctx.fillText('Lightroom Presets', W - 60, 90);

      // preview image
      var ix = 60, iy = 128, iw = 960, ih = 520;
      if (preview) cover(ctx, preview, ix, iy, iw, ih, 40);
      else {
        var pg = ctx.createLinearGradient(ix, iy, ix + iw, iy + ih); pg.addColorStop(0, '#2b241a'); pg.addColorStop(1, '#3a2e1e');
        rr(ctx, ix, iy, iw, ih, 40); ctx.fillStyle = pg; ctx.fill();
        ctx.fillStyle = 'rgba(217,164,108,.55)'; ctx.font = '800 120px ' + FONT; ctx.textAlign = 'center'; ctx.fillText('P', ix + iw / 2, iy + ih / 2 + 40);
      }
      var shade = ctx.createLinearGradient(0, iy + ih - 160, 0, iy + ih); shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,.45)');
      ctx.save(); rr(ctx, ix, iy, iw, ih, 40); ctx.clip(); ctx.fillStyle = shade; ctx.fillRect(ix, iy + ih - 160, iw, 160); ctx.restore();
      // chips on the image
      function chip(text, x, y, bg, fg, align) {
        ctx.font = '700 28px ' + FONT; var tw = ctx.measureText(text).width, w = tw + 44, h = 54, cx = align === 'right' ? x - w : x;
        rr(ctx, cx, y, w, h, 27); ctx.fillStyle = bg; ctx.fill();
        ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.fillText(text, cx + 22, y + 37);
      }
      chip(String(p.category || 'Preset').slice(0, 22), ix + 24, iy + 24, 'rgba(20,17,13,.78)', C.text, 'left');
      chip(money(p.price), ix + iw - 24, iy + 24, Number(p.price) > 0 ? C.gold : '#3fb97a', Number(p.price) > 0 ? C.ink : '#07210f', 'right');

      // title (max 2 lines)
      ctx.textAlign = 'left'; ctx.font = '800 56px ' + FONT; ctx.fillStyle = C.text;
      var tl = wrap(ctx, p.name || 'Lightroom preset', 960, 2);
      tl.forEach(function (ln, i) { ctx.fillText(ln, 60, 722 + i * 66); });
      var after = 722 + (tl.length - 1) * 66;

      // creator row
      var cy0 = after + 44, ar = 38, acx = 60 + ar, acy = cy0 + ar;
      ctx.save(); ctx.beginPath(); ctx.arc(acx, acy, ar, 0, Math.PI * 2); ctx.clip();
      if (avatar) ctx.drawImage(avatar, acx - ar, acy - ar, ar * 2, ar * 2);
      else { ctx.fillStyle = C.goldDark; ctx.fillRect(acx - ar, acy - ar, ar * 2, ar * 2); ctx.fillStyle = C.ink; ctx.font = '800 38px ' + FONT; ctx.textAlign = 'center'; ctx.fillText(String(creator.name || p.author || 'C').trim().charAt(0).toUpperCase() || 'C', acx, acy + 13); }
      ctx.restore();
      ctx.textAlign = 'left'; ctx.fillStyle = C.muted; ctx.font = '600 26px ' + FONT; ctx.fillText('Creator', 156, cy0 + 28);
      ctx.fillStyle = C.text; ctx.font = '700 36px ' + FONT;
      var nm = wrap(ctx, creator.name || p.author || 'Creator', 520, 1)[0]; ctx.fillText(nm, 156, cy0 + 70);
      // followers pill on the right
      var ft = compact(creator.followers) + ' followers';
      ctx.font = '700 28px ' + FONT; var fw = ctx.measureText(ft).width + 48;
      rr(ctx, W - 60 - fw, cy0 + 12, fw, 60, 30); ctx.fillStyle = C.panel; ctx.fill(); ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = C.gold; ctx.textAlign = 'left'; ctx.fillText(ft, W - 60 - fw + 24, cy0 + 52);

      // stats row
      var sy = cy0 + 116, sh = 132, gap = 18, sw = (960 - gap * 3) / 4;
      var reviews = (p.reviews || []).length, rating = Number(p.avgRating || 0);
      var stats = [
        { icon: iconStar, color: '#f5c34a', value: rating > 0 ? rating.toFixed(1) : 'New', label: reviews ? reviews + (reviews === 1 ? ' review' : ' reviews') : 'no reviews yet' },
        { icon: iconHeart, color: '#ff5d7a', value: compact(p.likesCount != null ? p.likesCount : (p.likes || []).length), label: 'likes' },
        { icon: iconEye, color: '#6fb6ff', value: compact(p.views), label: 'views' },
        { icon: iconDownload, color: '#5fd39a', value: compact(p.downloads), label: 'downloads' }
      ];
      stats.forEach(function (s, i) {
        var x = 60 + i * (sw + gap);
        rr(ctx, x, sy, sw, sh, 28); ctx.fillStyle = C.panel; ctx.fill(); ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.stroke();
        s.icon(ctx, x + 40, sy + 48, 17, s.color);
        ctx.textAlign = 'left'; ctx.fillStyle = C.text; ctx.font = '800 42px ' + FONT; ctx.fillText(s.value, x + 72, sy + 62);
        ctx.fillStyle = C.muted; ctx.font = '600 23px ' + FONT; ctx.fillText(wrap(ctx, s.label, sw - 40, 1)[0], x + 26, sy + 106);
      });

      // QR panel
      var qy = sy + sh + 44, qh = 1660 - qy - 96;
      rr(ctx, 60, qy, 960, qh, 40); ctx.fillStyle = C.cream; ctx.fill();
      var qs = Math.min(qh - 60, 380), qx = 60 + 34, qyy = qy + (qh - qs) / 2;
      window.PresetHubQR.drawToCanvas(ctx, qr, qx, qyy, qs, { border: 2, dark: C.ink, light: '#ffffff', radius: 22 });
      var tx = qx + qs + 40, tw2 = 60 + 960 - 34 - tx;
      ctx.textAlign = 'left'; ctx.fillStyle = C.ink; ctx.font = '800 46px ' + FONT;
      ctx.fillText('Scan to open', tx, qyy + 58);
      ctx.font = '600 27px ' + FONT; ctx.fillStyle = '#5b4f3f';
      var desc = wrap(ctx, 'Opens this preset on PresetHub with preview, download, likes and reviews.', tw2, 4);
      desc.forEach(function (ln, i) { ctx.fillText(ln, tx, qyy + 106 + i * 38); });
      var link = String(o.url || '').replace(/^https?:\/\//, '');
      ctx.font = '800 28px ' + FONT; var lw = Math.min(tw2, ctx.measureText(link).width + 40), ly = qyy + qs - 70;
      rr(ctx, tx, ly, lw, 62, 31); ctx.fillStyle = C.ink; ctx.fill();
      ctx.fillStyle = C.gold; ctx.fillText(wrap(ctx, link, lw - 36, 1)[0], tx + 20, ly + 41);

      // footer
      ctx.textAlign = 'center'; ctx.fillStyle = C.muted; ctx.font = '600 26px ' + FONT;
      ctx.fillText('presethub.site  \u00B7  Free & premium Lightroom presets', W / 2, H - 40);

      return { canvas: canvas, toBlob: function () { return toBlob(canvas); }, filename: 'presethub-' + slug(p.name) + '-qr-card.png' };
    });
  }

  // Plain QR image (white background, quiet zone, label underneath), good for print or stories.
  function buildQrOnly(o) {
    var qr = window.PresetHubQR.create(o.qrUrl || o.url, { ecc: 'Q' });
    return fontsReady().then(function () {
      var S = 1024, pad = 48, label = String(o.label || '').trim();
      var canvas = document.createElement('canvas'); canvas.width = S; canvas.height = S + (label ? 120 : 0);
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      window.PresetHubQR.drawToCanvas(ctx, qr, pad, pad, S - pad * 2, { border: 2, dark: '#111111', light: '#ffffff' });
      if (label) {
        ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.font = '700 38px ' + FONT;
        ctx.fillText(wrap(ctx, label, S - 120, 1)[0], S / 2, S + 40);
        ctx.fillStyle = '#6b6254'; ctx.font = '600 28px ' + FONT; ctx.fillText('Scan to open on PresetHub', S / 2, S + 88);
      }
      return { canvas: canvas, toBlob: function () { return toBlob(canvas); }, filename: 'presethub-' + slug(label || 'preset') + '-qr.png' };
    });
  }

  function saveBlob(blob, filename) {
    var a = document.createElement('a'), u = URL.createObjectURL(blob);
    a.href = u; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(u); }, 1500);
  }

  window.PresetHubShareCard = { build: build, buildQrOnly: buildQrOnly, saveBlob: saveBlob, slug: slug };
})();
