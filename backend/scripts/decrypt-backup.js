#!/usr/bin/env node
/** Decrypts one backup file.  Usage: node scripts/decrypt-backup.js backups/<stamp>/users.json.enc > users.json
 *  Needs the same BACKUP_ENC_KEY (or PAYOUT_ENC_KEY) in the environment. Keep the output private and delete it after use. */
require('dotenv').config();
const fs = require('fs');
const { decrypt } = require('../utils/backupCrypto');
const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/decrypt-backup.js <file.json.enc>'); process.exit(1); }
process.stdout.write(decrypt(fs.readFileSync(file)));
