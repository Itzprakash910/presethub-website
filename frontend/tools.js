/* PresetHub free tools: caption/hashtag generator and text-on-photo overlay. Runs fully in the browser for the overlay. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- caption generator ----------
  let lastTags = [];
  async function generate() {
    const topic = $('#capTopic').value, tone = $('#capTone').value;
    try {
      const r = await fetch(`/api/features/caption?topic=${encodeURIComponent(topic)}&tone=${encodeURIComponent(tone)}&seed=${Date.now()}`);
      const d = await r.json();
      $('#capList').innerHTML = d.captions.map(c => `<li><span>${esc(c)}</span><button class="btn btn-outline btn-sm" data-copy="${esc(c)}">Copy</button></li>`).join('');
      lastTags = d.hashtags;
      $('#capTagText').textContent = d.hashtags.join(' ');
    } catch (_) { $('#capList').innerHTML = '<li>Could not generate. Please try again.</li>'; }
  }
  $('#capMake').addEventListener('click', generate);
  $('#capList').addEventListener('click', async e => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = 'Copy'; }, 1400); } catch (_) {}
  });
  $('#capTags').addEventListener('click', async () => { try { await navigator.clipboard.writeText(lastTags.join(' ')); $('#capTags').textContent = 'Copied ✓'; setTimeout(() => { $('#capTags').textContent = 'Copy hashtags'; }, 1400); } catch (_) {} });
  generate();

  // ---------- text on photo ----------
  const MAX_BYTES = 15 * 1024 * 1024;
  let img = null;
  const canvas = $('#ovCanvas'), ctx = canvas.getContext('2d');
  function wrap(text, maxW) {
    const out = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (const w of para.split(/\s+/).filter(Boolean)) {
        const t = line ? line + ' ' + w : w;
        if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
      }
      out.push(line);
    }
    return out;
  }
  function render() {
    if (!img) return;
    const maxSide = 1400, k = Math.min(1, maxSide / Math.max(img.width, img.height));
    canvas.width = Math.round(img.width * k); canvas.height = Math.round(img.height * k);
    canvas.hidden = false;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const text = $('#ovText').value.trim();
    if (!text) { $('#ovDownload').disabled = false; return; }
    const size = Math.round(canvas.width * Number($('#ovSize').value) / 1000);
    ctx.font = `600 ${size}px "Noto Sans Devanagari","Segoe UI",Arial,sans-serif`;
    const lines = wrap(text, canvas.width * 0.84);
    const lh = size * 1.3, block = lines.length * lh;
    const pos = $('#ovPos').value;
    let y = pos === 'top' ? canvas.height * 0.08 : pos === 'bottom' ? canvas.height * 0.92 - block : (canvas.height - block) / 2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(4, size / 7); ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.fillStyle = $('#ovColor').value;
    for (const ln of lines) { ctx.strokeText(ln, canvas.width / 2, y); ctx.fillText(ln, canvas.width / 2, y); y += lh; }
    $('#ovDownload').disabled = false;
  }
  $('#ovFile').addEventListener('change', e => {
    const f = e.target.files?.[0]; if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > MAX_BYTES) { alert('Please choose a JPG, PNG or WEBP image under 15 MB.'); e.target.value = ''; return; }
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => { img = im; render(); URL.revokeObjectURL(url); };
    im.onerror = () => { alert('This image could not be read.'); URL.revokeObjectURL(url); };
    im.src = url;
  });
  ['#ovText', '#ovPos', '#ovColor', '#ovSize'].forEach(sel => $(sel).addEventListener('input', render));
  $('#ovDownload').addEventListener('click', () => {
    canvas.toBlob(blob => {
      if (!blob) return;
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'presethub-text-photo.png';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/png');
  });
})();
