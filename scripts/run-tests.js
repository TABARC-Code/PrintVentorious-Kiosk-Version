#!/usr/bin/env node
/* Runs every tests/*.test.js, one process each, and reports all failures rather than stopping at the first. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dir = path.join(__dirname, '..', 'tests');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort();
const failed = [];
for (const f of files) {
  const t = Date.now();
  const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8', timeout: 120000 });
  console.log(`${r.status === 0 ? 'ok  ' : 'FAIL'} ${f} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  if (r.status !== 0) { failed.push(f); console.log(`${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-12).join('\n').replace(/^/gm, '     ')); }
}
console.log(`\n${files.length - failed.length}/${files.length} test files passed`);
process.exit(failed.length ? 1 : 0);
