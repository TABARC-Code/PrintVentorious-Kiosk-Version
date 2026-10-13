/*
 * axe-core over every customer screen in every colour choice and at the biggest text size.
 * axe does the contrast sums for us, which is the bit I'd otherwise get wrong by eye.
 * Run with CHROMIUM_PATH set to a Chromium. It's a check, not a guarantee: axe finds roughly
 * a third of real accessibility problems, so someone still needs to use the thing.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const { chromium } = require('playwright-core');
const { createApp, openDb, seedDemo } = require('../server');

(async () => {
  const db = openDb(':memory:'); seedDemo(db);
  const server = await new Promise((r) => { const s = createApp({ db, mailer: { send: async () => ({ ok: true }) } }).listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const launch = { args: ['--no-sandbox'] };
  if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(launch);
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
  const axeSrc = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  const problems = [];
  const scan = async (label) => {
    await page.evaluate(axeSrc);
    const r = await page.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }));
    for (const v of r.violations) problems.push(`${label}: ${v.id} (${v.nodes.length}) ${v.nodes[0].html.slice(0, 90)}`);
  };
  try {
    for (const colour of ['dark', 'cream', 'contrast']) {
      for (const [font, size] of [['standard', '1'], ['atkinson', '1.75'], ['lexend', '1.25']]) {
        await page.goto(`${base}/kiosk`); await page.waitForSelector('.k-card');
        await page.click('#k-opts-btn');
        await page.check(`input[name="colour"][value="${colour}"]`, { force: true });
        await page.check(`input[name="font"][value="${font}"]`, { force: true });
        await page.check(`input[name="size"][value="${size}"]`, { force: true });
        await page.check('input[name="space"][value="roomy"]', { force: true });
        const tag = `${colour}/${font}/${size}`;
        await scan(`${tag} options open`);
        await page.click('#k-opts-close');
        await scan(`${tag} catalogue`);
        await page.click('.k-card >> nth=0'); await page.waitForSelector('#k-qty');
        await scan(`${tag} item`);
        await page.click('text=See my price'); await page.waitForSelector('.k-price');
        await scan(`${tag} quote`);
        if (size === '1.75') {   // the server allows 5 submissions per 10 minutes per address, so only send a few
          await page.fill('#k-email', 'a@example.com'); await page.click('text=Send to us'); await page.waitForSelector('.k-ref');
          await scan(`${tag} done`);
        }
      }
    }
    assert.deepStrictEqual(problems, [], problems.join('\n'));
    console.log('ok kiosk axe: 9 combinations, 5 screens (done screen once per colour)');
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(`FAIL ${e.message}`); process.exit(1); });
