// Hardening self-test: password policy, honeypot, admin IP allowlist, injection guard, e-mail verification. Mocks DB/mail; no network.
const Module = require('module'), path = require('path'), crypto = require('crypto');
const users = [];
const mk = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : mk()), apply: () => mk(), construct: () => mk() });
const alerts = [];
const User = { updateOne: async (f, u) => {
  const d = users.find(x => (f._id ? x._id === f._id : f.emailVerifyHash === x.emailVerifyHash && x.emailVerifyExpires > f.emailVerifyExpires.$gt));
  if (!d) return { modifiedCount: 0 }; Object.assign(d, u.$set); return { modifiedCount: 1 }; } };
const mocks = { '../models': new Proxy({ User }, { get: (t, k) => t[k] || mk() }), './alerts': { securityAlert: (r, m) => alerts.push(m) }, '../utils/alerts': { securityAlert: (r, m) => alerts.push(m) } };
const sent = []; global.fetch = async (url, o) => { sent.push(JSON.parse(o.body)); return { ok: true }; };
const orig = Module._load; Module._load = function (r, p, ...a) { if (mocks[r]) return mocks[r]; try { return orig.call(this, r, p, ...a); } catch (e) { if (r.startsWith('.')) throw e; return mk(); } };
const U = f => path.join(__dirname, '..', f);
const { isCommonPassword } = require(U('utils/passwordPolicy.js'));
const { honeypot } = require(U('utils/honeypot.js'));
const adminIp = require(U('middleware/adminIp.js'));
const ev = require(U('utils/emailVerification.js'));
const { securityGuard } = require(U('utils/alerts.js'));
const res = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } });
(async () => {
  let ok = 0, bad = 0; const t = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); c ? ok++ : bad++; };
  // password policy
  t('"Password123" is rejected', isCommonPassword('Password123'));
  t('"Welcome@786" (word + digits) is rejected', isCommonPassword('Welcome@786'));
  t('"aaaaaaaaaaaa" is rejected', isCommonPassword('aaaaaaaaaaaa'));
  t('password containing the e-mail name is rejected', isCommonPassword('Rahul2024xyz!', { email: 'rahul@example.com' }));
  t('a strong unique password is accepted', !isCommonPassword('Tq7!vLm29#Bz', { email: 'rahul@example.com' }));
  // honeypot
  let r = res(), passed = false; honeypot({ success: true })({ body: { company_website: 'http://spam' }, ip: '1' }, r, () => { passed = true; });
  t('filled honeypot gets a fake success and stops', !passed && r.body && r.body.success === true);
  passed = false; honeypot({ success: true })({ body: { company_website: '' } }, res(), () => { passed = true; });
  t('empty honeypot continues to the real handler', passed);
  // admin IP allowlist
  delete process.env.ADMIN_IP_ALLOWLIST; passed = false; adminIp({ ip: '9.9.9.9' }, res(), () => { passed = true; }); t('no allowlist = everyone passes (default unchanged)', passed);
  process.env.ADMIN_IP_ALLOWLIST = '1.2.3.4, 5.6.7.8';
  passed = false; adminIp({ ip: '::ffff:1.2.3.4' }, res(), () => { passed = true; }); t('listed IP (IPv4-mapped IPv6) passes', passed);
  r = res(); passed = false; adminIp({ ip: '9.9.9.9' }, r, () => { passed = true; }); t('other IP gets 404', !passed && r.code === 404);
  delete process.env.ADMIN_IP_ALLOWLIST;
  // injection guard
  const guard = (req) => { const rr = res(); let next = false; securityGuard({ ip: '1', originalUrl: '/api/x', query: {}, params: {}, body: {}, ...req }, rr, () => { next = true; }); return { rr, next }; };
  t('{"$ne":null} in body is blocked', guard({ body: { password: { $ne: null } } }).rr.code === 400);
  const deep = { a: { b: { c: { d: { e: { f: { g: { $ne: 1 } } } } } } } };
  t('operator hidden 8 levels deep is blocked', guard({ body: deep }).rr.code === 400);
  t('malformed %-encoding returns 400 instead of crashing', guard({ originalUrl: '/api/%E0%A4%A' }).rr.code === 400);
  const q = { x: ['1', '2'] }; guard({ query: q }); t('repeated query parameter keeps only the last value (HPP)', q.x === '2');
  t('normal request passes', guard({ body: { name: 'ok' } }).next === true);
  // e-mail verification
  process.env.RESEND_API_KEY = 'k'; process.env.MAIL_FROM = 'a@b.c'; process.env.CLIENT_URL = 'https://presethub.site';
  const u = { _id: 'u1', email: 'a@x.com', name: 'A', emailVerified: false }; users.push(u);
  t('verification is enabled when mail is configured', ev.enabled());
  await ev.sendVerification(u);
  const link = (sent[0].html.match(/verify=([a-f0-9]{64})/) || [])[1];
  t('mail contains a 64-hex token link', !!link);
  t('only the SHA-256 hash of the token is stored', u.emailVerifyHash === crypto.createHash('sha256').update(link).digest('hex') && u.emailVerifyHash !== link);
  t('wrong token is rejected', (await ev.confirm('0'.repeat(64))) === false);
  t('garbage token is rejected', (await ev.confirm("x' || 1")) === false);
  t('right token verifies the e-mail', (await ev.confirm(link)) === true && u.emailVerified === true);
  t('token cannot be reused', (await ev.confirm(link)) === false);
  delete process.env.RESEND_API_KEY; t('verification is off when mail is not configured', !ev.enabled());
  console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
