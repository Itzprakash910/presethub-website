#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const root = path.resolve(__dirname, '..');
const failures = [];
const checks = [];
function check(label, ok, detail = '') {
  checks.push({ label, ok: !!ok, detail });
  if (!ok) failures.push(label);
}
function exists(rel) { return fs.existsSync(path.join(root, rel)); }
check('Root package exists', exists('package.json'));
check('Backend entry exists', exists('backend/server.js'));
check('Frontend homepage exists', exists('frontend/index.html'));
check('Responsive stylesheet exists', exists('frontend/responsive.css'));
const render = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8');
check('Render builds from repository root', !/^\s*rootDir:\s*backend\s*$/m.test(render));
check('Render ADMIN_PASSWORD variable declared', /key:\s*ADMIN_PASSWORD/.test(render));
const server = fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8');
check('Startup does not auto-approve pending presets', !/autoPublishPendingPresets\s*\(/.test(server));
const htmlFiles = fs.readdirSync(path.join(root, 'frontend')).filter(f => f.endsWith('.html'));
const missingResponsive = htmlFiles.filter(f => {
  const html = fs.readFileSync(path.join(root, 'frontend', f), 'utf8');
  return /name=["']viewport["']/i.test(html) && !html.includes('/responsive.css?v=3.28.2');
});
check('All viewport pages load responsive.css', missingResponsive.length === 0, missingResponsive.join(', '));
const jsFiles = [];
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full);
    else if (ent.isFile() && full.endsWith('.js')) jsFiles.push(full);
  }
}
walk(path.join(root, 'backend'));
walk(path.join(root, 'frontend'));
walk(path.join(root, 'scripts'));
let syntaxOk = true;
for (const file of jsFiles) {
  const r = cp.spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) { syntaxOk = false; failures.push(`JS syntax: ${path.relative(root, file)}`); }
}
checks.push({ label: `JavaScript syntax (${jsFiles.length} files)`, ok: syntaxOk, detail: '' });
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.detail ? ` — ${c.detail}` : ''}`);
console.log(`\n${checks.filter(c => c.ok).length}/${checks.length} checks passed.`);
if (failures.length) process.exit(1);
