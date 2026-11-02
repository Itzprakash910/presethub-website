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
  'auth.js POST /signup', 'auth.js POST /login', 'auth.js POST /forgot-password', 'auth.js POST /request-reset', 'auth.js POST /reset-password',
  'cashfree.js POST /webhook', 'payments.js POST /webhook', 'payments.js POST /youpi/webhook',
  'presets.js POST /:id/download', 'presets.js POST /:id/view', 'presets.js POST /:id/ad-impression', 'presets.js POST /:id/share',
  'texts.js POST /:id/view', 'texts.js POST /:id/copy', 'texts.js POST /:id/share',
  'ads.js POST /:id/click', 'features.js POST /track', 'tracking.js POST /'
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

// Report
let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : '\n      -> ' + r.detail}`);
  if (!r.ok) failed++;
}
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
