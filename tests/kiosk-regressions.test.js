'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const Module = require('module');
const K = require('../src/kiosk-core');
let Database;
try { Database = require('better-sqlite3'); } catch (_) {
  const { DatabaseSync } = require('node:sqlite');
  Database = class {
    constructor(file) { this.raw = new DatabaseSync(file); }
    prepare(sql) { return this.raw.prepare(sql); }
    transaction(fn) { return (...args) => { this.raw.exec('BEGIN'); try { const result = fn(...args); this.raw.exec('COMMIT'); return result; } catch (e) { this.raw.exec('ROLLBACK'); throw e; } }; }
    close() { this.raw.close(); }
  };
  console.log('Using built-in SQLite for local regression checks; Express routing is stubbed.');
}
function database() {
  const db = new Database(':memory:');
  db.prepare('CREATE TABLE models (id INTEGER PRIMARY KEY, fileName TEXT, designer TEXT, license TEXT, thumbnail TEXT)').run();
  K.ensureSchema(db); K.ensureSchema(db);
  db.prepare("INSERT INTO models VALUES (1, 'Stand.stl', '', '', '')").run();
  K.saveItem(db, { modelId: 1, printHours: 2, grams: 30, sizeNote: '12 cm' });
  return db;
}
function routes(db, extras = {}) {
  const handlers = {}; const router = { use() {}, get() {}, post(path, ...fns) { handlers[path] = fns.at(-1); } };
  const original = Module._load;
  Module._load = function(name, ...args) { if (name === 'express') return { Router: () => router, json: () => () => {} }; return original.call(this, name, ...args); };
  let time = Date.now(); const created = [], sent = [];
  try {
    K.registerRoutes({ get() {}, use() {} }, { getDb: () => db, getSetting: key => key === K.SETTINGS_KEY ? '{"enabled":true}' : JSON.stringify({ printers: { 1: { price: 400 } }, filaments: { 1: { spoolPrice: 20 } } }), publicDir: '/tmp', now: () => time, onNewRequest: r => created.push(r), mailer: { send: async m => { sent.push(m); return { ok: true }; } }, ...extras });
  } finally { Module._load = original; }
  async function call(path, body) { const res = { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; } }; await handlers[path]({ ip: 'test', body }, res); return res; }
  return { call, created, sent, advance: ms => { time += ms; } };
}
async function submissions() {
  const db = database(); const r = routes(db);
  const quote = (await r.call('/quote', { itemId: 1, quantity: 2 })).body;
  const body = { quoteId: quote.quoteId, email: 'sam@example.com', copy: true };
  const first = await r.call('/submit', body);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.validUntil, quote.validUntil);
  const retry = await r.call('/submit', { ...body, copy: false });
  assert.deepStrictEqual(retry.body, first.body);
  assert.equal(r.created.length, 1); assert.equal(r.sent.length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM quote_requests').get().n, 1);
  assert.equal((await r.call('/submit', { ...body, email: 'other@example.com' })).statusCode, 410);
  const restarted = routes(db);
  assert.deepStrictEqual((await restarted.call('/submit', body)).body, first.body);
  assert.equal(restarted.created.length, 0); assert.equal(restarted.sent.length, 0);
  r.advance(3600001); assert.equal((await r.call('/submit', body)).statusCode, 410);
  const failedDb = database(); const failed = routes(failedDb);
  const q = (await failed.call('/quote', { itemId: 1, quantity: 1 })).body;
  failedDb.prepare("CREATE TRIGGER fail_insert BEFORE INSERT ON quote_requests BEGIN SELECT RAISE(ABORT, 'disk failure'); END").run();
  const submission = { quoteId: q.quoteId, email: 'sam@example.com' };
  assert.equal((await failed.call('/submit', submission)).statusCode, 500);
  assert.equal(failed.created.length, 0);
  failedDb.prepare('DROP TRIGGER fail_insert').run();
  assert.equal((await failed.call('/submit', submission)).statusCode, 200);
  assert.equal(failed.created.length, 1);
  db.close(); failedDb.close();
  console.log('ok retries: one row and notification, restart, expiry, identity, failed insert recovery');
}

async function adminNotifications() {
  const db = database();
  const recipients = ['owner@example.com', 'team@example.com'];
  const r = routes(db, { adminRecipients: recipients });
  const quote = (await r.call('/quote', { itemId: 1, quantity: 2 })).body;
  const body = { quoteId: quote.quoteId, email: 'sam@example.com', name: 'Sam', message: 'Please use blue filament', copy: false };
  const first = await r.call('/submit', body);
  assert.equal(first.statusCode, 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(r.sent.map((message) => message.to), recipients);
  for (const message of r.sent) {
    assert.equal(message.replyTo, 'sam@example.com');
    assert(message.text.includes(first.body.reference));
    assert(message.text.includes('Please use blue filament'));
    assert(!message.text.includes('owner@example.com'));
  }
  const status = db.prepare('SELECT admin_mail_status, mail_status FROM quote_requests WHERE reference = ?').get(first.body.reference);
  assert.equal(status.admin_mail_status, 'sent');
  assert.equal(status.mail_status, 'none');
  assert.equal((await r.call('/submit', body)).body.reference, first.body.reference);
  assert.equal(r.sent.length, 2, 'retry must not notify admins again');

  const failing = routes(db, { adminRecipients: recipients, mailer: { send: async ({ to }) => ({ ok: to !== 'team@example.com' }) } });
  const secondQuote = (await failing.call('/quote', { itemId: 1, quantity: 1 })).body;
  const second = await failing.call('/submit', { quoteId: secondQuote.quoteId, email: 'lee@example.com' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(db.prepare('SELECT admin_mail_status FROM quote_requests WHERE reference = ?').get(second.body.reference).admin_mail_status, 'failed');
  db.close();
  console.log('ok admin email: separate recipients, reply address, no duplicate on retry, partial failure recorded');
}
class Element {
  constructor(tag, ids) { this.tag = tag; this.ids = ids; this.nodeType = 1; this.children = []; this.listeners = {}; this.value = ''; this.classList = { toggle() {} }; }
  set textContent(v) { this.text = v; this.children = []; } get textContent() { return this.text || ''; }
  setAttribute(k, v) { this[k] = v; if (k === 'id') this.ids[v] = this; }
  append(...kids) { this.children.push(...kids); } addEventListener(k, f) { this.listeners[k] = f; }
  focus() {} before() {} querySelector() { return null; }
  prepend(...kids) { this.children.unshift(...kids); } scrollIntoView() {}
}
function find(node, predicate) { if (!node) return null; if (predicate(node)) return node; for (const child of node.children || []) { const result = find(child, predicate); if (result) return result; } }
async function client() {
  const ids = {}; const pending = [];
  const document = { getElementById: id => ids[id] || (ids[id] = new Element('div', ids)), createElement: tag => new Element(tag, ids), createTextNode: text => ({ nodeType: 3, textContent: text }) };
  const context = { document, window: { scrollTo() {} }, Date, setTimeout: () => 0, clearTimeout() {}, fetch: path => new Promise(resolve => pending.push({ path, resolve })) };
  vm.createContext(context);
  const code = fs.readFileSync(require.resolve('../public/kiosk-client.js'), 'utf8').replace('  start();', '  globalThis.hooks = { reset, quoteScreen, itemScreen };');
  vm.runInContext(code, context);
  const respond = (entry, value) => entry.resolve({ ok: true, json: async () => value });
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  const item = { id: 1, name: 'Stand' };
  const quote = { quoteId: 'token', quantity: 1, name: 'Stand', showPrice: true, total: 5, unitPrice: 5, validUntil: '2026-12-01' };
  context.hooks.reset(); respond(pending.shift(), { items: [], total: 0 }); await flush();
  context.hooks.quoteScreen(item, quote); ids['k-email'].value = 'previous@example.com';
  const form = find(ids['k-main'], n => n.tag === 'form');
  const sending = form.listeners.submit({ preventDefault() {} }); const submission = pending.shift();
  context.hooks.reset(); respond(pending.shift(), { items: [], total: 0 }); await flush();
  respond(submission, { reference: 'Q-PREVIOUS' }); await sending;
  assert.equal(ids['k-screen-title'].textContent, 'Get a print quote');
  assert(!find(ids['k-main'], n => n.textContent === 'Q-PREVIOUS'));
  context.hooks.itemScreen(item);
  ids['k-qty'].value = '1.5';
  const invalidButton = find(ids['k-main'], n => n.tag === 'button' && n.children.some(c => c.textContent === 'See my price'));
  await invalidButton.listeners.click();
  assert.equal(pending.length, 0, 'fractional quantities must not reach the server');
  assert(find(ids['k-main'], n => n.textContent.includes('whole number')));
  ids['k-qty'].value = '1';
  const button = find(ids['k-main'], n => n.tag === 'button' && n.children.some(c => c.textContent === 'See my price'));
  const quoting = button.listeners.click(); const request = pending.shift();
  context.hooks.reset(); respond(pending.shift(), { items: [], total: 0 }); await flush();
  respond(request, quote); await quoting;
  assert.equal(ids['k-screen-title'].textContent, 'Get a print quote');
  const searchForm = find(ids['k-main'], n => n.tag === 'form');
  ids['k-q'].value = 'old'; searchForm.listeners.submit({ preventDefault() {} }); const old = pending.shift();
  ids['k-q'].value = 'new'; searchForm.listeners.submit({ preventDefault() {} }); const newer = pending.shift();
  respond(newer, { items: [{ id: 2, name: 'New result' }], total: 1 }); await flush();
  respond(old, { items: [{ id: 3, name: 'Old result' }], total: 1 }); await flush();
  assert(find(ids['k-grid'], n => n.textContent === 'New result'));
  assert(!find(ids['k-grid'], n => n.textContent === 'Old result'));
  console.log('ok client: late submit and quote ignored after reset; newest search wins');
}
async function adminSize() {
  const ids = {}; const saved = []; const db = database();
  const document = { readyState: 'loading', addEventListener() {}, getElementById: id => ids[id] || (ids[id] = new Element('div', ids)), createElement: tag => new Element(tag, ids), createTextNode: text => ({ nodeType: 3, textContent: text }) };
  const context = { document, window: { electron: { saveKioskItem: async value => { saved.push(value); K.saveItem(db, value); }, previewKioskQuote: async () => ({ ok: false, error: 'preview' }) } }, setTimeout: () => 0, clearTimeout() {} };
  vm.createContext(context);
  const code = fs.readFileSync(require.resolve('../integration/printventory/kiosk-admin.js'), 'utf8').replace("  if (document.readyState === 'loading')", '  globalThis.addForm = addForm; globalThis.requestCard = requestCard;\n  if (document.readyState === \'loading\')');
  vm.runInContext(code, context);
  const pane = new Element('div', ids);
  context.addForm(pane, K.listItemsAdmin(db)[0]);
  const input = find(pane, n => n.tag === 'input' && n.maxlength === '60');
  assert.equal(input.value, '12 cm');
  const save = find(pane, n => n.tag === 'button' && n.children.some(c => c.textContent === 'Save'));
  await save.listeners.click();
  assert.equal(saved[0].sizeNote, '12 cm');
  input.value = '15 x 8 cm'; await save.listeners.click();
  assert.equal(K.publicCatalogue(db).items[0].size, '15 x 8 cm');
  const row = { reference: 'Q-TEST', quantity: 1, customer_email: 'sam@example.com' };
  for (const [status, fragment] of [['pending', 'waiting to send'], ['sent', 'accepted by the mail server'], ['failed', 'failed to send'], ['capped', 'daily limit']]) {
    const card = context.requestCard({ ...row, mail_status: status });
    assert(find(card, n => n.textContent.includes(fragment)), status);
  }
  for (const [status, fragment] of [['pending', 'waiting to send'], ['sent', 'accepted by the mail server'], ['failed', 'one or more messages failed']]) {
    const card = context.requestCard({ ...row, admin_mail_status: status });
    assert(find(card, n => n.textContent.includes(fragment)), status);
  }
  db.close(); console.log('ok admin: size labels round-trip; email delivery status is visible');
}
function pricing() {
  const farm = { printers: { 1: { price: 400 } }, filaments: { 1: { spoolPrice: 20 } } };
  const item = { print_hours: 2, grams: 30, units_per_plate: 1 };
  for (const quantity of [1.5, 0, 101, true, [2], '2.5', '']) {
    assert.equal(K.computeQuote({ farmConfig: farm, item, quantity, settings: K.DEFAULT_SETTINGS }).ok, false);
  }
  for (const quantity of [1, 100, '2']) assert.equal(K.computeQuote({ farmConfig: farm, item, quantity, settings: K.DEFAULT_SETTINGS }).ok, true);
  assert.equal(K.pricingReady({ ...farm, printers: { ...farm.printers, 2: { price: 0 } } }).ok, false);
  assert.equal(K.pricingReady({ ...farm, printers: { ...farm.printers, 2: { price: 0, active: false } } }).ok, true);
  console.log('ok pricing: whole quantities only; unpriced active printers block quotes');
}
(async () => { pricing(); await submissions(); await adminNotifications(); await client(); await adminSize(); })().catch(e => { console.error(e); process.exitCode = 1; });
