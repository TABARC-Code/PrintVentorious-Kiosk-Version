/*
 * axe-core over the owner's admin page: sign-in, every tab, the item form and the price form, in all three
 * colour choices and all three fonts at a big text size. axe does the contrast sums. It finds only part of
 * what can go wrong, so it's a floor, not a verdict.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const { chromium } = require('playwright-core');
const { createAdmin, openDb, seedDemo } = require('../server');

const TOKEN = 'a-long-enough-token-1';
(async () => {
  const db = openDb(':memory:'); seedDemo(db);
  db.prepare("INSERT INTO quote_requests (reference, created_at, quantity, item_name, customer_email, status, unit_price, total_price, currency, valid_until, internal_cost, internal_profit) VALUES ('Q-AAAAAA', ?, 2, 'Phone stand', 'sam@example.com', 'new', 5, 10, '£', ?, 6, 4)").run(new Date().toISOString(), new Date(Date.now() + 6e8).toISOString());
  const server = await new Promise((r) => { const s = createAdmin({ db, token: TOKEN }).listen(0, '127.0.0.1', () => r(s)); });
  const launch = { args: ['--no-sandbox'] }; if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(launch);
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
  const axeSrc = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  const problems = [];
  const scan = async (label) => {
    await page.evaluate(axeSrc);
    const r = await page.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }));
    for (const v of r.violations) problems.push(`${label}: ${v.id} (${v.nodes.length}) ${v.nodes[0].html.slice(0, 100)}`);
  };
  try {
    const looks = [['cream', 'atkinson', 1], ['dark', 'lexend', 1.45], ['contrast', 'standard', 1.75]];
    for (const [theme, font, size] of looks) {
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.evaluate(([t, f, s]) => localStorage.setItem('kiosk-admin-look', JSON.stringify({ theme: t, font: f, size: s })), [theme, font, size]);
      await page.reload();
      const tag = `${theme}/${font}/${size}`;
      await scan(`${tag} sign-in`);
      await page.fill('#a-token', TOKEN); await page.click('button:has-text("Sign in")'); await page.waitForSelector('.a-tabs');
      await page.waitForSelector('.a-card');
      await scan(`${tag} requests`);
      await page.click('#a-tab-items'); await page.waitForSelector('.a-item'); await scan(`${tag} items`);
      await page.click('button:has-text("Change")'); await page.waitForSelector('#a-name'); await scan(`${tag} item form`);
      await page.click('button:has-text("Show me the price")'); await page.waitForFunction(() => /customer/.test(document.querySelector('[role=status]').textContent)); await scan(`${tag} item form with price`);
      await page.click('button:has-text("Cancel")');
      await page.click('#a-tab-prices'); await page.waitForSelector('#a-f-currency'); await scan(`${tag} prices`);
      await page.click('#a-tab-settings'); await page.waitForSelector('#a-s-title'); await scan(`${tag} settings`);
    }
    assert.deepStrictEqual(problems, [], problems.join('\n'));
    console.log('ok admin axe: 3 looks x sign-in and every tab');
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(`FAIL ${e.message}`); process.exit(1); });
