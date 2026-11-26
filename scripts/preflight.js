'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const required = ['backend/server.js', 'backend/package.json', 'backend/.env.example', 'frontend/index.html'];
const missing = required.filter(file => !fs.existsSync(path.join(root, file)));
if (missing.length) { console.error('Missing required project files:', missing.join(', ')); process.exit(1); }
const pkg = require('../backend/package.json');
if (!pkg.dependencies || !pkg.dependencies.mongoose || !pkg.dependencies.express) { console.error('Core backend dependencies are missing.'); process.exit(1); }
console.log('PresetHub preflight passed. Configure backend/.env before starting the server.');
