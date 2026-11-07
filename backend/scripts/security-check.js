#!/usr/bin/env node
/**
 * Static security checks for PresetHub. Run: npm run security:check   (also runs in CI).
 * It reads the source only (no database, no network). Exit code 1 = a check failed.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'backups', 'uploads'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const rel = p => path.relative(root, p).replace(/\\/g, '/');
const files = walk(root);
const textFiles = files.filter(f => /\.(js|json|html|md|yaml|yml|txt|css)$/i.test(f) && !/package-lock\.json$/.test(f));

// 1. Secrets must not be committed.
const SECRET_PATTERNS = [
  [/cfsk_[A-Za-z0-9_]{10,}/, 'Cashfree secret key'],
  [/mongodb(\+srv)?:\/\/[^\s:@/<]+:[^\s@<]{4,}@/, 'MongoDB URI with password'],
  [/-----BEGIN (RSA |EC )?PRIVATE KEY-----/, 'private key'],
  [/\b\d{8,10}:[A-Za-z0-9_-]{35}\b/, 'Telegram bot token'],
  [/\bre_[A-Za-z0-9]{20,}\b/, 'Resend API key'],
  [/\b[a-f0-9]{64}\b(?=['"]\s*[,;)])/, '64-hex value in code (possible PAYOUT_ENC_KEY)']
];
const hits = [];
for (const f of textFiles) {
  if (/security-check\.js$/.test(f)) continue;
  const s = fs.readFileSync(f, 'utf8');
  for (const [re, label] of SECRET_PATTERNS) if (re.test(s)) hits.push(`${rel(f)}: ${label}`);
}
check('No secrets committed', hits.length === 0, hits.join('; '));

// 2. .env files are ignored.
const gi = read('.gitignore');
check('.env is git-ignored', /^\.env$/m.test(gi) || /backend\/\.env/.test(gi));
check('No .env file in the project', !files.some(f => /(^|\/)\.env$/.test(rel(f))));

// 3. JWT usage pins the algorithm.
const jsFiles = files.filter(f => f.endsWith('.js') && rel(f).startsWith('backend/'));
const jwtBad = [];
// Returns the full text of each jwt.<fn>( ... ) call by matching parentheses.
function jwtCalls(src, fn) {
  const out = [];
  let i = 0;
  while ((i = src.indexOf(`jwt.${fn}(`, i)) !== -1) {
    let depth = 0, j = i + `jwt.${fn}`.length;
    for (; j < src.length; j++) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')' && --depth === 0) break;
    }
    out.push(src.slice(i, j + 1));
    i = j;
  }
  return out;
}
for (const f of jsFiles) {
  const s = fs.readFileSync(f, 'utf8');
  for (const c of jwtCalls(s, 'verify')) if (!/algorithms/.test(c)) jwtBad.push(rel(f) + ' (verify)');
  for (const c of jwtCalls(s, 'sign')) if (!/algorithm\b/.test(c)) jwtBad.push(rel(f) + ' (sign)');
}
check('JWT verify/sign pin HS256', jwtBad.length === 0, jwtBad.join(', '));

// 4. Auth cookie flags.
const authRoute = read('backend/routes/auth.js');
check('Auth cookie is httpOnly + sameSite + secure(prod)', /httpOnly:\s*true/.test(authRoute) && /sameSite:\s*'(lax|strict)'/.test(authRoute) && /secure:\s*process\.env\.NODE_ENV === 'production'/.test(authRoute));

// 5. CSP: no inline/eval scripts.
const server = read('backend/server.js');
const scriptSrc = (server.match(/scriptSrc:\s*\[([\s\S]*?)\]/) || [])[1] || '';
check('CSP scriptSrc has no unsafe-inline / unsafe-eval', scriptSrc && !/unsafe-(inline|eval)/.test(scriptSrc));
check('CSP blocks plugins and framing (objectSrc none, frameAncestors)', /objectSrc:\s*\["'none'"\]/.test(server) && /frameAncestors/.test(server));
check('x-powered-by disabled', /app\.disable\('x-powered-by'\)/.test(server));
check('Redirects do not trust the raw Host header', !/redirect\(301, `https:\/\/\$\{req\.headers\.host\}/.test(server));

// 6. Admin router is guarded.
const admin = read('backend/routes/admin.js');
check('Admin router requires auth + admin role', /router\.use\(auth,\s*isAdmin\)/.test(admin));

// 7. Service worker caches public API data only.
const sw = read('frontend/sw.js');
check('Service worker uses an allowlist for cached API data', /PUBLIC_API_PREFIXES/.test(sw) && !/'\/api\/(creator|admin|auth|payments|users\/me)/.test((sw.match(/PUBLIC_API_PREFIXES = \[[^\]]*\]/) || [''])[0]));

// 8. security.txt is valid and not expired.
const st = read('frontend/security.txt');
const exp = (st.match(/^Expires:\s*(.+)$/m) || [])[1];
check('security.txt has a future Expires date', exp && new Date(exp) > new Date(), exp ? `Expires ${exp}` : 'missing Expires');

// 9. Unauthenticated write routes must be on the known-public list.
const PUBLIC_WRITES = new Set([
  'auth.js POST /signup', 'auth.js POST /login', 'auth.js POST /logout', 'auth.js POST /forgot-password', 'auth.js POST /request-reset', 'auth.js POST /reset-password',
  'cashfree.js POST /webhook', 'payments.js POST /webhook', 'payments.js POST /youpi/webhook',
  'presets.js POST /:id/download', 'presets.js POST /:id/view', 'presets.js POST /:id/ad-impression', 'presets.js POST /:id/share',
  'texts.js POST /:id/view', 'texts.js POST /:id/copy', 'texts.js POST /:id/share',
  'ads.js POST /:id/click', 'features.js POST /track', 'tracking.js POST /', 'legal.js POST /consent'
]);
const open = [];
for (const f of files.filter(f => /backend\/routes\/[^/]+\.js$/.test(rel(f)) && !/admin\.js$/.test(f))) {
  const name = path.basename(f);
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/router\.(post|put|delete|patch)\(\s*'([^']+)'(.*)/);
    if (!m) continue;
    if (/\b(auth|authenticate|isAdmin|authorize)\b/.test(m[3])) continue;
    const key = `${name} ${m[1].toUpperCase()} ${m[2]}`;
    if (!PUBLIC_WRITES.has(key)) open.push(key);
  }
}
check('Every write route requires login (or is a known public endpoint)', open.length === 0, open.join('; '));

// 10. Dangerous APIs.
const danger = [];
for (const f of jsFiles) {
  const s = fs.readFileSync(f, 'utf8');
  if (/\beval\(|new Function\(|child_process/.test(s) && !/security-check\.js$/.test(f)) danger.push(rel(f));
}
check('No eval / new Function / child_process in backend', danger.length === 0, danger.join(', '));

// 11. Privacy and compliance (India: DPDP Act 2023 / Rules 2025, e-commerce rules).
const htmlFiles = files.filter(f => /frontend\/[^/]+\.html$/.test(rel(f)));
const placeholders = [];
for (const f of htmlFiles) {
  const t = fs.readFileSync(f, 'utf8');
  if (/\[(Name|Your|Postal|postal|Address|Registered|Legal|Business|designated)[^\]]{0,60}\]/.test(t)) placeholders.push(rel(f));
}
check('No unfilled [placeholders] on legal pages', placeholders.length === 0, placeholders.join(', '));
const inlineTrackers = htmlFiles.filter(f => /googletagmanager\.com|connect\.facebook\.net|pagead2\.googlesyndication/.test(fs.readFileSync(f, 'utf8'))).map(rel);
check('No analytics/ad script is hard-coded in HTML (they load only after consent)', inlineTrackers.length === 0, inlineTrackers.join(', '));
const cc = read('frontend/cookie-consent.js'), tr = read('frontend/tracking.js');
check('Cookie banner offers Reject, Customize and per-purpose choices', /data-cookie="reject"/.test(cc) && /data-cookie="customize"/.test(cc) && ['analytics', 'ads', 'marketing'].every(k => cc.includes(`'${k}'`)));
check('Trackers wait for the matching consent (GA=analytics, Pixel=marketing)', /c\.analytics && GA_OK/.test(tr) && /c\.marketing && PX_OK/.test(tr));
check('Consent choices are recorded on the server', /\/api\/legal\/consent/.test(cc) && /router\.post\('\/consent'/.test(read('backend/routes/legal.js')));
const val = read('backend/utils/validators.js');
check('Signup requires Terms/Privacy acceptance and 18+ confirmation, and stores the record', /acceptTerms/.test(val) && /ageConfirmed/.test(val) && /consent:\s*\{\s*termsVersion/.test(authRoute));
const priv = read('frontend/privacy.html');
const claimsMfa = /two-step|two-factor|2fa/i.test(priv);
check('Privacy Policy does not claim admin two-step unless it is implemented', !claimsMfa || (/MFA_REQUIRED/.test(authRoute) && fs.existsSync(path.join(root, 'backend/utils/totp.js'))));
check('Account deletion keeps order records the policy says are retained', !/Order\.deleteMany/.test(authRoute));
check('Database backups are encrypted', /backupCrypto/.test(read('backend/backup.js')));
check('Bot does not store a profile for visitors who have not linked an account', !/User\.create\(/.test(read('backend/bot.js')));
// Every documented environment variable must be used by the code (catches settings that do nothing).
const envKeys = read('backend/.env.example').split('\n').map(l => (l.match(/^([A-Z][A-Z0-9_]+)=/) || [])[1]).filter(Boolean);
const allSrc = jsFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');
const deadEnv = envKeys.filter(k => !['NODE_VERSION'].includes(k) && !allSrc.includes(k));
check('Every variable in .env.example is used by the code', deadEnv.length === 0, deadEnv.join(', '));
const legalMissing = (read('backend/.env.example').match(/^(LEGAL_ENTITY_NAME|LEGAL_ADDRESS|GRIEVANCE_OFFICER_NAME)=/gm) || []).length === 3;
check('Legal detail variables are documented in .env.example', legalMissing);

// 12. QR codes are generated locally (no share link is sent to a third-party QR service).
const frontJs = files.filter(f => /frontend\/[^/]+\.js$/.test(rel(f)));
const qrLeak = frontJs.filter(f => /quickchart\.io|api\.qrserver\.com|chart\.googleapis\.com\/chart|qr-code-generator\.com/i.test(fs.readFileSync(f, 'utf8'))).map(rel);
check('QR codes come from the local encoder (qr.js), not a third-party service', qrLeak.length === 0 && /PresetHubQR/.test(read('frontend/share-card.js')), qrLeak.join(', '));
check('Short link opens the full website with the preset (?preset=) and counts QR scans', /\?preset=\$\{preset\._id\}/.test(read('backend/server.js')) && /source: req\.query\.src === 'qr'/.test(read('backend/server.js')) && /get\('preset'\)/.test(read('frontend/app.js')));

// 13. Pages and icons.
const shellUsers = ['backend/server.js', 'backend/seo/listPages.js', 'backend/seo/shayariPages.js'].filter(f => /pageBody\(/.test(read(f)));
check('Preset, profile, list, shayari and app pages are built with the shared page shell', shellUsers.length === 3 && (read('backend/server.js').match(/pageBody\(/g) || []).length >= 3, shellUsers.join(', '));
const shellSrc = read('backend/seo/pageShell.js');
check('Every page has the home header, footer and a Back button', /PARTS\.header/.test(shellSrc) && /SITE_FOOTER/.test(shellSrc) && /data-page-back/.test(shellSrc));
const iconCss = read('frontend/icons.css');
const haveIcons = new Set([...iconCss.matchAll(/\.fa-([a-z0-9-]+)/g)].map(m => m[1]));
const usedIn = ['frontend/app.js', 'frontend/texts.js', 'frontend/features.js', 'frontend/share-card.js', 'backend/server.js', 'backend/seo/pageShell.js', 'backend/seo/listPages.js', 'backend/seo/shayariPages.js'];
const missingIcons = new Set();
for (const f of usedIn) for (const m of read(f).matchAll(/\bfa[sbr]? fa-([a-z0-9-]+)/g)) if (!haveIcons.has(m[1])) missingIcons.add(`${m[1]} (${f})`);
check('Every icon used in the code exists in the local icon pack (no black squares)', missingIcons.size === 0, [...missingIcons].join(', '));

// Report
let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : '\n      -> ' + r.detail}`);
  if (!r.ok) failed++;
}
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
