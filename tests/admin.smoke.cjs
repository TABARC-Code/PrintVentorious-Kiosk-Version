/*
 * Browser test for the owner's admin page, joined to the real customer page: the owner sets prices, adds an item,
 * turns the kiosk on; a customer asks for a quote; the owner sees it. Plus the things that matter for safety:
 * a wrong token gets nowhere, the token isn't kept anywhere, hostile text from a customer renders as text.
 * Needs Playwright + Chromium (CHROMIUM_PATH).
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { console.log('skip: Playwright is not installed'); process.exit(0); }
const { createApp, createAdmin, openDb } = require('../server');
const K = require('../src/kiosk-core');

const TOKEN = 'a-long-enough-token-1';
// a real 8x8 PNG so the canvas has something to chew on
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEklEQVR42mP8z8Dwn4EIwDiqEAAjSgIAWKHtIAAAAABJRU5ErkJggg==';

(async () => {
  const db = openDb(':memory:');
  const listen = (app) => new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const kiosk = await listen(createApp({ db }));
  const admin = await listen(createAdmin({ db, token: TOKEN }));
  const kioskUrl = `http://127.0.0.1:${kiosk.address().port}`; const adminUrl = `http://127.0.0.1:${admin.address().port}`;

  const launch = { args: ['--no-sandbox'] };
  if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(launch);
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  const errors = []; const external = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('request', (r) => { if (!/^(http:\/\/127\.0\.0\.1|data:|blob:)/.test(r.url())) external.push(r.url()); });
  try {
    // ---- sign in: wrong token first ----
    await page.goto(adminUrl);
    await page.fill('#a-token', 'definitely-not-it'); await page.click('button:has-text("Sign in")');
    await page.waitForSelector('.a-err:not(:empty)');
    assert.ok((await page.textContent('.a-err')).includes('not right'));
    assert.ok(!(await page.$('.a-tabs')), 'a wrong token gets no further');
    await page.fill('#a-token', TOKEN); await page.click('button:has-text("Sign in")');
    await page.waitForSelector('.a-tabs');
    assert.ok((await page.textContent('.a-banner')).includes('cannot get a price'), 'it says why customers cannot get a price yet');

    // ---- prices ----
    await page.click('#a-tab-prices');
    await page.click('button:has-text("Add a printer")');
    await page.fill('#a-printers-1-name', 'Prusa'); await page.fill('#a-printers-1-price', '400'); await page.fill('#a-printers-1-lifetimeHours', '2000'); await page.fill('#a-printers-1-watts', '150'); await page.fill('#a-printers-1-hoursPerMonth', '400');
    await page.click('button:has-text("Add a filament")');
    await page.fill('#a-filaments-1-name', 'PLA black'); await page.fill('#a-filaments-1-spoolPrice', '20'); await page.fill('#a-filaments-1-spoolGrams', '1000');
    await page.click('button:has-text("Save prices")');
    await page.waitForSelector('.a-ok:has-text("Saved")');
    assert.ok((await page.textContent('.a-banner')).includes('OFF'), 'prices ready, page still off');

    // ---- an item, with a picture ----
    await page.click('#a-tab-items'); await page.click('button:has-text("Add an item")');
    await page.fill('#a-name', 'Phone stand'); await page.fill('#a-designer', 'Acme'); await page.fill('#a-hours', '3'); await page.fill('#a-grams', '50'); await page.fill('#a-size', 'About 10 x 8 x 9 cm');
    assert.ok((await page.textContent('#a-filament')).includes('PLA black'), 'filament shows its name');
    await page.setInputFiles('#a-pic', { name: 'p.png', mimeType: 'image/png', buffer: Buffer.from(PNG_B64, 'base64') });
    await page.click('button:has-text("Show me the price")');
    await page.waitForFunction(() => /would cost the customer/.test(document.querySelector('[role=status]').textContent));
    await page.click('button[type=submit]:has-text("Save")');
    await page.waitForSelector('.a-ok:has-text("Saved")');
    assert.ok((await page.textContent('.a-card.a-item')).includes('Phone stand'));
    assert.ok(await page.evaluate(() => { const i = document.querySelector('.a-thumb'); return i && i.tagName === 'IMG' && i.complete && i.naturalWidth > 0; }), 'the picture shows');

    // ---- turn the customer page on ----
    await page.click('#a-tab-settings'); await page.check('#a-s-enabled'); await page.click('button:has-text("Save settings")');
    await page.waitForSelector('.a-ok:has-text("Saved")');
    assert.ok((await page.textContent('.a-banner')).includes('ON and ready'));

    // ---- a customer uses it ----
    const cust = await ctx.newPage();
    await cust.goto(`${kioskUrl}/kiosk`); await cust.waitForSelector('.k-card');
    assert.ok((await cust.textContent('.k-card')).includes('About 10 x 8 x 9 cm'), 'the size from the admin page reaches the customer');
    assert.ok(await cust.evaluate(() => { const i = document.querySelector('.k-card img'); return i.complete && i.naturalWidth > 0; }), 'and so does the picture');
    await cust.click('.k-card'); await cust.waitForSelector('#k-qty'); await cust.click('text=See my price'); await cust.waitForSelector('.k-price');
    await cust.fill('#k-email', 'sam@example.com'); await cust.fill('#k-name', '<img src=x onerror=window.__pwned=1>'); await cust.fill('#k-msg', '<script>window.__pwned=1</script>');
    await cust.click('text=Send to us'); await cust.waitForSelector('.k-ref');
    const ref = await cust.textContent('.k-ref'); await cust.close();

    // ---- the owner sees it; hostile text is only text ----
    await page.click('#a-tab-requests');
    await page.waitForSelector(`.a-card:has-text("${ref}")`);
    const card = page.locator(`.a-card:has-text("${ref}")`);
    const t = await card.textContent();
    assert.ok(t.includes('sam@example.com') && t.includes('<img src=x onerror=window.__pwned=1>') && t.includes('Your cost'), 'full details, shop-only figures included, hostile text shown literally');
    assert.strictEqual(await page.evaluate(() => window.__pwned), undefined, 'nothing the customer typed ran');
    assert.strictEqual(await card.locator('img').count(), 0, 'no element was injected');
    assert.ok((await card.locator('a:has-text("Reply by email")').getAttribute('href')).startsWith('mailto:sam@example.com?subject='));
    await card.locator('select').selectOption('done');
    await page.waitForSelector('.a-ok:has-text("Saved")');
    assert.strictEqual(db.prepare('SELECT status FROM quote_requests WHERE reference = ?').get(ref).status, 'done');
    // delete needs two presses
    await page.locator(`.a-card:has-text("${ref}") button:has-text("Delete")`).click();
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM quote_requests').get().n, 1, 'one press does not delete');
    await page.locator(`.a-card:has-text("${ref}") button:has-text("Really delete")`).click();
    await page.waitForSelector('.a-ok:has-text("Deleted")');
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM quote_requests').get().n, 0);

    // ---- the token is kept nowhere; a reload asks again; the look settings do persist ----
    await page.click('#a-colour');
    const kept = await page.evaluate(() => ({ local: JSON.stringify({ ...localStorage }), session: sessionStorage.length, cookie: document.cookie, url: location.href }));
    assert.ok(!kept.local.includes('a-long-enough-token') && !kept.url.includes('token') && kept.session === 0 && kept.cookie === '', JSON.stringify(kept));
    assert.deepStrictEqual(await ctx.cookies(), []);
    await page.reload(); await page.waitForSelector('#a-token');
    assert.ok(!(await page.$('.a-tabs')), 'a reload signs you out');
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains('t-dark')), 'but your colours are remembered');

    assert.deepStrictEqual(external, [], `requests left the machine: ${external.join(', ')}`);
    assert.deepStrictEqual(errors, [], `page errors: ${errors.join('; ')}`);

    // ---- an item can be removed ----
    await page.fill('#a-token', TOKEN); await page.click('button:has-text("Sign in")'); await page.waitForSelector('.a-tabs');
    await page.click('#a-tab-items'); await page.click('button:has-text("Change")');
    await page.click('button:has-text("Remove this item")');
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM kiosk_items').get().n, 1, 'one press does not remove');
    await page.click('button:has-text("Really remove")'); await page.waitForSelector('.a-ok:has-text("Removed")');
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM kiosk_items').get().n, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM models').get().n, 0, 'and the model made on this page went with it');
    console.log('ok kiosk admin page smoke test');
  } finally { await browser.close(); kiosk.close(); admin.close(); }
})().catch((e) => { console.error(`FAIL ${e.message}`); process.exit(1); });
