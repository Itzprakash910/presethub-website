/* Shared site footer for server-rendered pages (preset, shayari, lists, profiles).
   Read from frontend/index.html so every page shows the same footer as the static pages. */
const fs = require('fs');
const path = require('path');
function loadSiteFooter() {
  try {
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'index.html'), 'utf8');
    const m = html.match(/<footer class="site-footer"[\s\S]*?<\/footer>/);
    if (m) return m[0];
  } catch (_) { /* fall through */ }
  return '<footer class="site-footer"><div class="footer-bottom"><span>&copy; PresetHub</span></div></footer>';
}
module.exports = { SITE_FOOTER: loadSiteFooter() };
