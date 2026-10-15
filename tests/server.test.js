'use strict';
// The standalone server's own behaviour: things the kiosk-core tests can't see because they build their own app.
const assert = require('assert');
const http = require('http');
const { createApp, openDb, seedDemo } = require('../server');

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log(`ok ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}: ${e && e.message}`); } }

function post(port, headers) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ itemId: 1, quantity: 1 });
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/kiosk/quote', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.write(data); req.end();
  });
}
const listen = (app) => new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });

(async () => {
  await test('behind a proxy: with trustProxy each real address gets its own limit; without it they all share one', async () => {
    const db = openDb(':memory:'); seedDemo(db);
    const plain = await listen(createApp({ db }));
    let codes = [];
    for (let i = 0; i < 62; i++) codes.push(await post(plain.address().port, { 'X-Forwarded-For': `10.0.0.${i}` }));
    assert.ok(codes.includes(429), 'without trustProxy a spoofed header must NOT dodge the limit');
    plain.close();
    const behind = await listen(createApp({ db, trustProxy: 1 }));
    codes = [];
    for (let i = 0; i < 62; i++) codes.push(await post(behind.address().port, { 'X-Forwarded-For': `10.0.0.${i}` }));
    assert.ok(!codes.includes(429), `with one trusted proxy, different customers must not share a limit (${[...new Set(codes)]})`);
    behind.close();
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
