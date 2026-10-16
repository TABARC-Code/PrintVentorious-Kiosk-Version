'use strict';
// The owner's admin API: who can talk to it, what it will accept, and what it will and won't touch.
const assert = require('assert');
const http = require('http');
const path = require('path');
const Database = require('better-sqlite3');
const K = require('../src/kiosk-core');
const { createAdminApp, checkThumbnail, MODEL_MARK } = require('../src/admin');

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log(`ok ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}: ${e && e.message}`); } }

const TOKEN = 'correct-horse-battery';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const FARM = { currency: '£', electricityRate: 0.25, labourRate: 15, failureRatePct: 10, targetMarginPct: 40,
  printers: { 1: { price: 400, lifetimeHours: 2000, watts: 150, hoursPerMonth: 500 } }, filaments: { 1: { spoolPrice: 20, spoolGrams: 1000 } } };

function setup({ farm = null } = {}) {
  const db = new Database(':memory:');
  db.prepare('CREATE TABLE models (id INTEGER PRIMARY KEY AUTOINCREMENT, fileName TEXT, designer TEXT, license TEXT, thumbnail TEXT)').run();
  K.ensureSchema(db);
  const store = {}; if (farm) store.farmCostConfig = JSON.stringify(farm);
  const app = createAdminApp({ getDb: () => db, getSetting: (k) => store[k] ?? null, setSetting: (k, v) => { store[k] = v; },
    token: TOKEN, publicDir: path.join(__dirname, '..', 'public'), adminDir: path.join(__dirname, '..', 'admin') });
  return new Promise((resolve) => { const server = http.createServer(app); server.listen(0, '127.0.0.1', () => resolve({ server, db, store, port: server.address().port })); });
}
function call(port, { method = 'GET', p, body, headers = {}, auth = true }) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const h = { ...(auth ? { Authorization: `Bearer ${TOKEN}` } : {}), ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers };
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: h }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const raw = Buffer.concat(chunks); let json = null; try { json = JSON.parse(raw.toString()); } catch (_) {} resolve({ status: res.statusCode, headers: res.headers, json, raw }); });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const item = (extra = {}) => ({ name: 'Phone stand', designer: 'Acme', licence: 'CC-BY', printHours: 3, grams: 50, unitsPerPlate: 1, filamentId: '1', sizeNote: 'About 10 cm', note: 'Fits most phones', ...extra });

(async () => {
  await test('refuses to start with a weak token', () => {
    assert.throws(() => createAdminApp({ token: 'short' }), /12 characters/);
    assert.throws(() => createAdminApp({}), /12 characters/);
  });

  await test('the Host header must be one we expect (DNS rebinding), localhost is fine', async () => {
    const a = await setup();
    assert.strictEqual((await call(a.port, { p: '/api/state', headers: { Host: 'evil.example' } })).status, 421);
    assert.strictEqual((await call(a.port, { p: '/', headers: { Host: 'evil.example:5081' } })).status, 421);
    assert.strictEqual((await call(a.port, { p: '/api/state', headers: { Host: `localhost:${a.port}` } })).status, 200);
    assert.strictEqual((await call(a.port, { p: '/api/state', headers: { Host: `127.0.0.1:${a.port}` } })).status, 200);
    a.server.close();
  });

  await test('the API needs the token; wrong or missing is 401 and leaks nothing', async () => {
    const a = await setup();
    for (const p of ['/api/state', '/api/items', '/api/requests']) {
      const none = await call(a.port, { p, auth: false }); assert.strictEqual(none.status, 401, p);
      const wrong = await call(a.port, { p, auth: false, headers: { Authorization: 'Bearer nope-nope-nope' } }); assert.strictEqual(wrong.status, 401);
      assert.ok(!/settings|farm|items/.test(wrong.raw.toString().replace('That token is not right.', '')), 'body leaked');
    }
    assert.strictEqual((await call(a.port, { p: '/api/state' })).status, 200);
    assert.ok(!(await call(a.port, { p: '/api/state' })).headers['set-cookie'], 'no cookies');
    a.server.close();
  });

  await test('brute force: ten wrong tries and then even the right token is refused for a while', async () => {
    const a = await setup();
    for (let i = 0; i < 10; i++) assert.strictEqual((await call(a.port, { p: '/api/state', auth: false, headers: { Authorization: `Bearer guess-number-${i}` } })).status, 401);
    const locked = await call(a.port, { p: '/api/state' });
    assert.strictEqual(locked.status, 429); assert.ok(Number(locked.headers['retry-after']) >= 1);
    a.server.close();
  });

  await test('changes need a matching Origin when the browser sends one', async () => {
    const a = await setup();
    const same = await call(a.port, { method: 'PUT', p: '/api/settings', body: { title: 'Same' }, headers: { Origin: `http://127.0.0.1:${a.port}` } });
    assert.strictEqual(same.status, 200);
    const other = await call(a.port, { method: 'PUT', p: '/api/settings', body: { title: 'Evil' }, headers: { Origin: 'http://evil.example' } });
    assert.strictEqual(other.status, 403);
    assert.notStrictEqual(JSON.parse(a.store[K.SETTINGS_KEY]).title, 'Evil');
    assert.strictEqual((await call(a.port, { method: 'PUT', p: '/api/settings', body: {}, headers: { Origin: 'file:///x' } })).status, 403);
    a.server.close();
  });

  await test('static files: only the exact page, script, styles and two fonts, with a strict CSP and no source leaks', async () => {
    const a = await setup();
    const page = await call(a.port, { p: '/', auth: false });
    assert.strictEqual(page.status, 200); assert.ok(/default-src 'self'/.test(page.headers['content-security-policy'])); assert.ok(page.headers['cache-control'].includes('no-store'));
    for (const p of ['/admin.js', '/admin.css', '/fonts/atkinson.css', '/fonts/lexend.css']) assert.strictEqual((await call(a.port, { p, auth: false })).status, 200, p);
    for (const p of ['/server.js', '/../server.js', '/src/admin.js', '/fonts/../../server.js', '/fonts/inter.css', '/package.json', '/.env']) {
      const r = await call(a.port, { p, auth: false }); assert.strictEqual(r.status, 404, p);
      assert.ok(!/require\(/.test(r.raw.toString()), `${p} leaked source`);
    }
    a.server.close();
  });

  await test('prices: not ready until real numbers are saved; ids and sizes are checked; junk is normalised', async () => {
    const a = await setup();
    let st = (await call(a.port, { p: '/api/state' })).json; assert.strictEqual(st.ready.ok, false); assert.strictEqual(st.farm, null);
    assert.strictEqual((await call(a.port, { method: 'PUT', p: '/api/farm', body: '{"printers":{"__proto__":{"price":1}}}' })).status, 422);   // a real own key, which an object literal can't make
    assert.strictEqual((await call(a.port, { method: 'PUT', p: '/api/farm', body: { printers: { 'a b': {} } } })).status, 422);
    const many = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [String(i + 1), { price: 1 }]));
    assert.strictEqual((await call(a.port, { method: 'PUT', p: '/api/farm', body: { printers: many } })).status, 422);
    const ok = await call(a.port, { method: 'PUT', p: '/api/farm', body: { ...FARM, failureRatePct: 9999, names: { printers: { 1: '  Prusa  ' }, filaments: { 1: 'PLA black' } } } });
    assert.strictEqual(ok.status, 200); assert.strictEqual(ok.json.ready.ok, true);
    assert.strictEqual(ok.json.farm.failureRatePct, 90, 'out-of-range values are clamped');
    assert.strictEqual(ok.json.names.printers['1'], 'Prusa');
    st = (await call(a.port, { p: '/api/state' })).json; assert.strictEqual(st.ready.ok, true); assert.strictEqual(st.names.filaments['1'], 'PLA black');
    a.server.close();
  });

  await test('settings: merged, clamped, and a rubbish body does not break anything', async () => {
    const a = await setup();
    const r = await call(a.port, { method: 'PUT', p: '/api/settings', body: { enabled: true, validityDays: 9999, title: '  Shop  ' } });
    assert.strictEqual(r.json.enabled, true); assert.strictEqual(r.json.validityDays, 90); assert.strictEqual(r.json.title, 'Shop');
    assert.strictEqual((await call(a.port, { method: 'PUT', p: '/api/settings', body: 'not json at all' })).status, 400);
    assert.strictEqual((await call(a.port, { method: 'PUT', p: '/api/settings', body: [1, 2, 3] })).status, 200);
    a.server.close();
  });

  await test('thumbnails: the bytes must match the label, and they must be small', () => {
    assert.strictEqual(checkThumbnail(PNG).ok, true);
    assert.strictEqual(checkThumbnail('').ok, true);
    assert.strictEqual(checkThumbnail('data:text/html;base64,PGgxPg==').ok, false);
    assert.strictEqual(checkThumbnail('data:image/svg+xml;base64,PHN2Zz4=').ok, false);                 // SVG can carry script: refused outright
    assert.strictEqual(checkThumbnail(`data:image/jpeg;base64,${Buffer.from('this is not a jpeg').toString('base64')}`).ok, false);
    assert.strictEqual(checkThumbnail(`data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(130 * 1024)]).toString('base64')}`).ok, false);
    assert.strictEqual(checkThumbnail('javascript:alert(1)').ok, false);
  });

  await test('items: add, show to customers, change, hide, remove; only models made here are ever deleted', async () => {
    const a = await setup({ farm: FARM });
    const bad = await call(a.port, { method: 'POST', p: '/api/items', body: item({ thumbnail: 'data:text/html;base64,PGgxPg==' }) });
    assert.strictEqual(bad.status, 422);
    assert.strictEqual((await call(a.port, { method: 'POST', p: '/api/items', body: item({ name: '  ' }) })).status, 422);
    assert.strictEqual((await call(a.port, { method: 'POST', p: '/api/items', body: item({ printHours: 0 }) })).status, 422);
    assert.strictEqual(a.db.prepare('SELECT COUNT(*) AS n FROM models').get().n, 0, 'a failed save leaves nothing behind');
    const made = await call(a.port, { method: 'POST', p: '/api/items', body: item({ thumbnail: PNG }) });
    assert.strictEqual(made.status, 200); const id = made.json.id;
    const pub = K.publicCatalogue(a.db, {}).items; assert.strictEqual(pub.length, 1); assert.strictEqual(pub[0].size, 'About 10 cm'); assert.ok(K.thumbnailFor(a.db, id));
    const listed = (await call(a.port, { p: '/api/items' })).json; assert.strictEqual(listed[0].licence, 'CC-BY'); assert.ok(listed[0].thumbnail.startsWith('data:image/png'));
    assert.ok(a.db.prepare('SELECT license FROM models WHERE id = ?').get(id).license.startsWith(MODEL_MARK));
    assert.strictEqual((await call(a.port, { method: 'PUT', p: `/api/items/${id}`, body: item({ name: 'Phone stand v2', enabled: false }) })).status, 200);
    assert.strictEqual(K.publicCatalogue(a.db, {}).total, 0, 'hidden items disappear from the customer page');
    assert.ok(K.thumbnailFor(a.db, id) === null);
    // the picture is kept when a change doesn't include a new one
    assert.ok(a.db.prepare('SELECT thumbnail FROM models WHERE id = ?').get(id).thumbnail.startsWith('data:image/png'));
    // a model this page did not create can't be edited here, and removing its item leaves the model alone
    const foreign = Number(a.db.prepare("INSERT INTO models (fileName, designer, license, thumbnail) VALUES ('Library.stl', 'X', 'CC0', ?)").run(PNG).lastInsertRowid);
    K.saveItem(a.db, { modelId: foreign, printHours: 1, grams: 10 });
    assert.strictEqual((await call(a.port, { method: 'PUT', p: `/api/items/${foreign}`, body: item() })).status, 422);
    assert.strictEqual((await call(a.port, { method: 'DELETE', p: `/api/items/${foreign}` })).status, 200);
    assert.ok(a.db.prepare('SELECT id FROM models WHERE id = ?').get(foreign), 'the library model survived');
    assert.strictEqual((await call(a.port, { method: 'DELETE', p: `/api/items/${id}` })).status, 200);
    assert.strictEqual(a.db.prepare('SELECT id FROM models WHERE id = ?').get(id), undefined, 'the model made here went with it');
    assert.strictEqual((await call(a.port, { method: 'DELETE', p: `/api/items/${id}` })).status, 404);
    assert.strictEqual((await call(a.port, { method: 'PUT', p: '/api/items/abc', body: item() })).status, 404);
    a.server.close();
  });

  await test('preview: what the customer pays and what it costs you', async () => {
    const a = await setup({ farm: FARM });
    const r = await call(a.port, { method: 'POST', p: '/api/preview', body: { printHours: 3, grams: 50, unitsPerPlate: 1, filamentId: '1', quantity: 1 } });
    const expect = K.computeQuote({ farmConfig: FARM, item: { print_hours: 3, grams: 50, units_per_plate: 1, filament_id: 1 }, quantity: 1, settings: K.normaliseSettings({}) });
    assert.strictEqual(r.json.ok, true); assert.strictEqual(r.json.total, expect.total); assert.ok(r.json.internal.cost > 0);
    assert.strictEqual((await call(a.port, { method: 'POST', p: '/api/preview', body: { printHours: 0, grams: 5 } })).json.ok, false);
    a.server.close();
  });

  await test('requests: listed with the shop-only figures, status changes are checked, delete works', async () => {
    const a = await setup({ farm: FARM });
    const m = Number(a.db.prepare("INSERT INTO models (fileName, designer, license, thumbnail) VALUES ('P.stl', '', '', ?)").run(PNG).lastInsertRowid);
    K.saveItem(a.db, { modelId: m, printHours: 2, grams: 30 });
    const snap = { itemId: m, itemName: 'P', quantity: 1, unitPrice: 5, total: 5, currency: '£', validityDays: 7, showPrice: true, internal: { cost: 3, profit: 2 } };
    const r1 = K.createRequest(a.db, { snapshot: snap, email: '<img src=x onerror=alert(1)>@evil.example', name: '<script>alert(1)</script>', message: 'hi' });
    const list = (await call(a.port, { p: '/api/requests' })).json; assert.strictEqual(list.length, 1); assert.strictEqual(list[0].internal_cost, 3);
    assert.strictEqual(list[0].customer_name, '<script>alert(1)</script>', 'hostile text comes back as plain data; the page uses textContent');
    assert.strictEqual((await call(a.port, { p: '/api/state' })).json.newRequests, 1);
    assert.strictEqual((await call(a.port, { method: 'PATCH', p: `/api/requests/${r1.id}`, body: { status: 'weird' } })).status, 422);
    assert.strictEqual((await call(a.port, { method: 'PATCH', p: `/api/requests/${r1.id}`, body: { status: 'done' } })).status, 200);
    assert.strictEqual((await call(a.port, { p: '/api/requests?status=new' })).json.length, 0);
    assert.strictEqual((await call(a.port, { method: 'DELETE', p: `/api/requests/${r1.id}` })).status, 200);
    assert.strictEqual((await call(a.port, { method: 'DELETE', p: `/api/requests/${r1.id}` })).status, 404);
    a.server.close();
  });

  await test('webhook test: reports what happened, and says so when none is saved', async () => {
    const a = await setup();
    assert.strictEqual((await call(a.port, { method: 'POST', p: '/api/test-webhook' })).json.ok, false);
    a.server.close();
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
