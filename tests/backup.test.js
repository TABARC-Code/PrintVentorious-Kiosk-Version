'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { backup } = require('../scripts/backup');

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log(`ok ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}: ${e && e.message}`); } }

(async () => {
  await test('backup: a readable copy with the same rows, owner-only, and it will not overwrite one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiosk-backup-'));
    const file = path.join(dir, 'kiosk.db');
    const db = new Database(file); db.pragma('journal_mode = WAL');
    db.prepare('CREATE TABLE t (n INTEGER)').run(); db.prepare('INSERT INTO t VALUES (1), (2), (3)').run();   // still in the WAL, not yet in the main file
    const when = new Date('2026-10-15T14:30:00Z');
    const out = await backup(file, path.join(dir, 'backups'), when);
    assert.ok(out.endsWith('kiosk-2026-10-15-1430.db'), out);
    const copy = new Database(out, { readonly: true });
    assert.strictEqual(copy.prepare('SELECT COUNT(*) AS n FROM t').get().n, 3, 'the backup is missing rows that were only in the WAL');
    copy.close();
    assert.strictEqual(fs.statSync(out).mode & 0o077, 0, 'backup is readable by other users');
    await assert.rejects(() => backup(file, path.join(dir, 'backups'), when), /already exists/);
    await assert.rejects(() => backup(path.join(dir, 'nope.db'), path.join(dir, 'backups'), new Date('2026-10-15T15:00:00Z')));
    db.close(); fs.rmSync(dir, { recursive: true, force: true });
  });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
