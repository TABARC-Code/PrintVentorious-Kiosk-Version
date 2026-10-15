#!/usr/bin/env node
/*
 * Copies the database to data/backups/ using SQLite's own online backup, which is safe while the server is running
 * (copying the .db file by hand while it's in WAL mode can give you a backup that's missing the last few minutes,
 * or is quietly corrupt). It holds customer email addresses, so treat the backups like the original: keep them
 * somewhere private, and remember they are not covered by the retention clean-up.
 *
 *     npm run backup            writes data/backups/kiosk-2026-10-15-1430.db
 *
 * Environment: KIOSK_DB (same as the server). Exported for the test.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

async function backup(dbFile, outDir, now = new Date()) {
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = now.toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const out = path.join(outDir, `kiosk-${stamp}.db`);
  if (fs.existsSync(out)) throw new Error(`${out} already exists. Wait a minute, or move it.`);
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try { await db.backup(out); } finally { db.close(); }
  fs.chmodSync(out, 0o600);   // owner only: it's personal data
  return out;
}

module.exports = { backup };

if (require.main === module) {
  const file = process.env.KIOSK_DB || path.join(__dirname, '..', 'data', 'kiosk.db');
  backup(file, path.join(path.dirname(file), 'backups')).then((o) => console.log(`Backed up to ${o}`)).catch((e) => { console.error(`Backup failed: ${e.message}`); process.exit(1); });
}
