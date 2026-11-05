/** Regression checks for the v3.25.3 fixes. Run: node scripts/fixes-selftest.js (no database or network needed) */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
let pass = 0, fail = 0;
function check(name, ok) { console.log((ok ? 'PASS  ' : 'FAIL  ') + name); ok ? pass++ : fail++; }

const auth = read('backend/routes/auth.js'), server = read('backend/server.js'), pay = read('backend/routes/payments.js');
check('auth router limiter skips GET (/me must never return 429)', /const authLimiter = rateLimit\(\{[\s\S]*?skip: \(req\) => \['GET'/.test(auth));
check('signup no longer loads every username (User.distinct)', !/User\.distinct\('username'/.test(auth));
check('referral reward happens after user.save()', auth.indexOf('await user.save();\n\n    if (referrerId)') > 0);
check('legacy pending presets are not auto-approved on every restart', /AUTO_PUBLISH_LEGACY_PENDING/.test(server));
check('sitemap is cached and de-duplicated', /sitemapCache/.test(server) && /seenLoc/.test(server));
check('missing pages answer HTTP 404 (no soft 404)', (server.match(/indexFallback\(res, 404\)/g) || []).length >= 5);
check('SEO pages carry the consent-gated tracking loader', /SEO_TRACKING_TAG/.test(server));
check('graceful shutdown closes HTTP server and database', /httpServer\.close/.test(server) && /connection\.close\(\)/.test(server));
check('payment fulfilment failure alerts the admin', /fulfilment FAILED/.test(pay));
check('ShareClick expires and stores no IP', /ShareClickSchema\.index\(\{ clickedAt: 1 \}/.test(read('backend/models/index.js')) && !/ip: req\.ip/.test(server));
check('reset token is removed from the address bar', /params\.delete\('reset'\)/.test(read('frontend/app.js')));
check('Google Analytics never receives the reset token', /searchParams\.delete\(k\)/.test(read('frontend/tracking.js')));
check('sitemap has no duplicate hard-coded pages', (() => { const m = server.match(/const urls = \[([\s\S]*?)\];/); const items = m[1].match(/'[^']+'/g); return new Set(items).size === items.length; })());
console.log(`\n${pass} passed, ${fail} failed.`); process.exit(fail ? 1 : 0);
