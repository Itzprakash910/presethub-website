#!/usr/bin/env node
/** Offline test of frontend/cookie-consent.js and frontend/tracking.js (fake browser). Run: npm run consent:test */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const FRONT = path.join(__dirname, '..', '..', 'frontend');
let passed = 0, failed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log('PASS  ' + name); } catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + String(e.message).split('\n')[0]); } };

function browser(initial = {}, opts = {}) {
  const ls = { ...initial };
  const fetches = [], appended = [], scripts = [], listeners = {};
  const mkEl = () => {
    const el = { innerHTML: '', className: '', id: '', dataset: {}, hidden: false, children: [], handlers: {}, attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.handlers[t] = f; }, remove() { this.removed = true; },
      querySelector(sel) { const k = sel; this.q = this.q || {}; return (this.q[k] = this.q[k] || { checked: false, hidden: k === '.cookie-choices', dataset: {}, textContent: '' }); } };
    return el;
  };
  const doc = {
    readyState: 'complete', cookie: opts.cookie || '', head: { appendChild: s => scripts.push(s) }, body: { appendChild: el => { appended.push(el); doc.__banner = el; } },
    createElement: () => mkEl(), querySelector: sel => (sel === '#cookieConsent' && doc.__banner && !doc.__banner.removed ? doc.__banner : null),
    addEventListener: (t, f) => { listeners['doc:' + t] = f; }
  };
  const win = {
    crypto: { getRandomValues: b => { for (let i = 0; i < b.length; i++) b[i] = (i * 37 + 11) & 255; return b; } },
    addEventListener: (t, f) => { listeners[t] = f; }, dispatchEvent: e => { events.push(e); (listeners[e.type] || (() => {}))(e); },
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } }
  };
  const events = [];
  const ctx = {
    window: win, document: doc, location: { hostname: 'presethub.site', pathname: '/privacy.html', reload() { ctx.reloaded = true; } },
    localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); } },
    fetch: (url, o) => { fetches.push({ url, o }); return Promise.resolve({}); }, CustomEvent: win.CustomEvent, console, Date, JSON, Number, Array, Object, Uint8Array, encodeURIComponent, decodeURIComponent, RegExp, Math, String
  };
  win.window = win; win.document = doc;
  ctx.globalThis = ctx; vm.createContext(ctx);
  return { ctx, ls, fetches, appended, scripts, events, listeners, doc, win, run: file => vm.runInContext(fs.readFileSync(path.join(FRONT, file), 'utf8'), ctx, { filename: file }) };
}
const click = (banner, action) => banner.handlers.click({ target: { closest: () => ({ dataset: { cookie: action } }) } });

test('first visit: banner shown, nothing optional loads, no consent stored', () => {
  const b = browser(); b.run('cookie-consent.js');
  assert.strictEqual(b.appended.length, 1); assert.ok(!b.ls.presethub_cookie_consent_v2);
  assert.ok(!b.win.PresetHubConsent.has('ads') && !b.win.PresetHubConsent.has('analytics') && !b.win.PresetHubConsent.has('marketing'));
  assert.strictEqual(b.scripts.length, 0, 'no ad script before consent');
  assert.ok(/Reject optional/.test(b.appended[0].innerHTML) && /Allow all/.test(b.appended[0].innerHTML) && /Customize/.test(b.appended[0].innerHTML));
});
test('Reject optional: stored, recorded without IP/UA, no scripts, banner closed', () => {
  const b = browser(); b.run('cookie-consent.js');
  click(b.appended[0], 'reject');
  const s = JSON.parse(b.ls.presethub_cookie_consent_v2); assert.deepStrictEqual([s.analytics, s.ads, s.marketing], [false, false, false]);
  assert.ok(b.appended[0].removed && b.scripts.length === 0);
  const f = b.fetches[0]; assert.strictEqual(f.url, '/api/legal/consent');
  const body = JSON.parse(f.o.body); assert.ok(/^[a-f0-9]{32}$/.test(body.visitorId) && body.page === '/privacy.html');
  assert.deepStrictEqual(Object.keys(body).sort(), ['choice', 'page', 'purposes', 'visitorId']);
});
test('Allow all: ads script loads, event dispatched, all purposes true', () => {
  const b = browser(); b.run('cookie-consent.js'); click(b.appended[0], 'accept');
  assert.ok(b.win.PresetHubConsent.has('ads') && b.win.PresetHubConsent.has('analytics') && b.win.PresetHubConsent.has('marketing'));
  assert.strictEqual(b.scripts.length, 1); assert.ok(b.scripts[0].src.includes('pagead2.googlesyndication.com'));
  assert.ok(b.events.some(e => e.type === 'presethub:consent' && e.detail.analytics === true));
});
test('Customize: only the ticked purposes are enabled (analytics only -> no ads script)', () => {
  const b = browser(); b.run('cookie-consent.js'); const el = b.appended[0];
  click(el, 'customize'); assert.ok(el.q['.cookie-choices'].hidden === false);
  el.q['[data-purpose="analytics"]'].checked = true;
  click(el, 'save');
  const s = JSON.parse(b.ls.presethub_cookie_consent_v2); assert.deepStrictEqual([s.analytics, s.ads, s.marketing], [true, false, false]);
  assert.strictEqual(b.scripts.length, 0);
});
test('legacy "accepted"/"rejected" choices are honoured and migrated; no banner', () => {
  let b = browser({ presethub_cookie_consent_v1: 'accepted' }); b.run('cookie-consent.js');
  assert.ok(b.win.PresetHubConsent.has('ads') && b.appended.length === 0 && b.scripts.length === 1);
  b = browser({ presethub_cookie_consent_v1: 'rejected' }); b.run('cookie-consent.js');
  assert.ok(!b.win.PresetHubConsent.has('ads') && b.appended.length === 0 && b.scripts.length === 0);
});
test('Pro members never load ads even with consent', () => {
  const b = browser({ presethub_cookie_consent_v1: 'accepted', ph_pro_until: String(Date.now() + 1e7) }); b.run('cookie-consent.js');
  assert.strictEqual(b.scripts.length, 0);
});
test('withdrawing consent clears tracker cookies and reloads the page', () => {
  const b = browser({}, { cookie: '_ga=1; _ga_ABC=2; _fbp=3; ph_csrf=tok; other=1' }); b.run('cookie-consent.js'); click(b.appended[0], 'accept');
  b.ctx.reloaded = false;
  b.win.PresetHubConsent.open(); const el = b.doc.__banner; assert.ok(/Close/.test(el.innerHTML), 'reopened with a Close button');
  click(el, 'reject');
  assert.ok(b.ctx.reloaded, 'page reloaded so running trackers stop');
  assert.strictEqual(JSON.parse(b.fetches.at(-1).o.body).choice, 'withdrawn');
  assert.ok(b.fetches.at(-1).o.headers['X-CSRF-Token'] === 'tok', 'CSRF header sent for signed-in users');
});
test('tracking.js: GA only with analytics, Pixel only with marketing, nothing without consent', () => {
  const run = (consent, attrs) => {
    const b = browser(consent ? { presethub_cookie_consent_v2: JSON.stringify({ v: 2, ...consent }) } : {});
    b.ctx.document.currentScript = { getAttribute: k => attrs[k] || '' };
    b.ctx.document.getElementsByTagName = () => [{ parentNode: { insertBefore: s => b.scripts.push(s) } }];
    b.ctx.document.createElement = () => ({});
    b.run('tracking.js'); return b;
  };
  const attrs = { 'data-ga': 'G-ABCDEF1234', 'data-pixel': '123456789012345' };
  let b = run(null, attrs); assert.strictEqual(b.scripts.length, 0);
  b = run({ analytics: false, ads: true, marketing: false }, attrs); assert.strictEqual(b.scripts.length, 0);
  b = run({ analytics: true, ads: false, marketing: false }, attrs); assert.ok(b.scripts.length === 1 && b.scripts[0].src.includes('googletagmanager.com'));
  b = run({ analytics: false, marketing: true }, attrs); assert.ok(b.scripts.length === 1 && b.scripts[0].src.includes('connect.facebook.net'));
  b = run({ analytics: true, marketing: true }, { 'data-ga': 'bad id', 'data-pixel': 'x' }); assert.strictEqual(b.scripts.length, 0, 'invalid ids never load');
});
console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
