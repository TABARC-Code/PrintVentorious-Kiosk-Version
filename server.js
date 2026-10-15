#!/usr/bin/env node
/*
 * A small stand-alone server for the customer quote page, so it can be run, looked at and tested without
 * the rest of PrintVentorious. It's a development and demonstration tool. The real home of this code is
 * inside PrintVentorious (see integration/printventory/), where the admin side lives.
 *
 *     npm install
 *     npm start                  then open http://localhost:5080/kiosk
 *     npm run inbox              list the quote requests received so far
 *
 * First run on an empty database seeds a handful of DEMO items and DEMO costs. The demo numbers are
 * made up. Do not quote real customers from them. Replace them with your own (see README.md).
 *
 * Environment:  PORT (5080)  KIOSK_DB (./data/kiosk.db)  KIOSK_WEBHOOK (optional https address)
 *              KIOSK_TRUST_PROXY (number of reverse proxies in front, e.g. 1; leave unset if none)
 *              KIOSK_SMTP_URL, KIOSK_MAIL_FROM, KIOSK_MAIL_REPLY_TO (optional: lets customers tick "email me a copy")
 *
 * There is deliberately no admin web page here. Settings and items are plain rows in the database
 * (settings, kiosk_items, models), and the inbox is `npm run inbox`. An admin interface is a separate piece
 * of work with its own security questions, and PrintVentorious already has one.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');
const K = require('./src/kiosk-core');
const { mailerFromEnv } = require('./src/mailer');
const { createAdminApp } = require('./src/admin');
const crypto = require('crypto');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.prepare('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)').run();
  db.prepare('CREATE TABLE IF NOT EXISTS models (id INTEGER PRIMARY KEY AUTOINCREMENT, fileName TEXT, designer TEXT, license TEXT, thumbnail TEXT)').run();
  K.ensureSchema(db);
  return db;
}

const getSetting = (db) => (key) => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key); return r ? r.value : null; };
const setSetting = (db, key, value) => db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));

/** Demo content, only when the library is empty. Every number here is invented. */
function seedDemo(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM models').get().n > 0) return false;
  const items = [['Phone stand', 'Demo Designs', 3, 50, 'Fits most phones', 'About 10 x 8 x 9 cm'], ['Cable organiser', 'Demo Designs', 1.5, 25, '', 'About 6 x 4 x 3 cm'], ['Plant pot', 'Demo Designs', 5, 110, 'Drainage hole included', 'About 12 cm wide, 11 cm tall'], ['Chess pawn', 'Demo Designs', 1, 18, 'Sold singly', 'About 2.5 cm wide, 4 cm tall'], ['Desk tidy', 'Demo Designs', 6, 140, '', 'About 15 x 10 x 8 cm'], ['Key hook', 'Demo Designs', 2, 40, '', 'About 14 x 4 x 3 cm']];
  for (const [name, designer, hours, grams, note, sizeNote] of items) {
    const id = db.prepare('INSERT INTO models (fileName, designer, license, thumbnail) VALUES (?, ?, ?, ?)').run(`${name}.stl`, designer, 'DEMO', PNG).lastInsertRowid;
    K.saveItem(db, { modelId: id, printHours: hours, grams, unitsPerPlate: 1, filamentId: 1, note, sizeNote });
  }
  setSetting(db, 'farmCostConfig', JSON.stringify({ currency: '£', electricityRate: 0.25, labourRate: 15, failureRatePct: 8, targetMarginPct: 40, printers: { 1: { price: 400, lifetimeHours: 2000, watts: 150, hoursPerMonth: 400 } }, filaments: { 1: { spoolPrice: 20, spoolGrams: 1000 } } }));
  setSetting(db, K.SETTINGS_KEY, JSON.stringify({ enabled: true, title: 'Get a print quote (DEMO)' }));
  return true;
}

function createApp({ db, publicDir = path.join(__dirname, 'public'), onNewRequest, mailer = null, mailDailyCap = 200, trustProxy = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Behind a reverse proxy every customer arrives from the proxy's address, so the per-address limits (five requests
  // in ten minutes) would throttle the whole shop at once. Say how many proxies you have and the real address is read
  // from X-Forwarded-For. Only set it if a proxy really is in front: otherwise anyone can fake that header to dodge the limits.
  if (trustProxy) app.set('trust proxy', trustProxy);
  K.registerRoutes(app, { getDb: () => db, getSetting: getSetting(db), publicDir, onNewRequest, mailer, mailAllowed: mailer ? K.createDailyCap(mailDailyCap) : undefined });
  app.get('/', (req, res) => res.redirect('/kiosk'));
  app.use((req, res) => res.status(404).type('text/plain').send('Not found'));
  return app;
}

if (require.main === module) {
  const db = openDb(process.env.KIOSK_DB || path.join(__dirname, 'data', 'kiosk.db'));
  if (seedDemo(db)) console.log('Empty database: added DEMO items and DEMO costs. These numbers are invented.');
  if (process.env.KIOSK_WEBHOOK) {
    const s = K.loadSettings(getSetting(db));
    setSetting(db, K.SETTINGS_KEY, JSON.stringify({ ...s, webhookUrl: process.env.KIOSK_WEBHOOK }));
  }
  const purge = () => { try { K.purgeOld(db, K.loadSettings(getSetting(db)).retentionDays); } catch (e) { console.error('purge failed:', e.message); } };
  purge(); setInterval(purge, 6 * 60 * 60 * 1000).unref();
  const port = Number(process.env.PORT) || 5080;
  createApp({ db, mailer: mailerFromEnv(), trustProxy: /^\d+$/.test(process.env.KIOSK_TRUST_PROXY || '') ? Number(process.env.KIOSK_TRUST_PROXY) : false }).listen(port, () => console.log(`Quote page: http://localhost:${port}/kiosk`));

  const adminHost = process.env.KIOSK_ADMIN_HOST || '127.0.0.1';
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(adminHost);
  const chosen = process.env.KIOSK_ADMIN_TOKEN;
  if (!loopback && !chosen) { console.error('KIOSK_ADMIN_HOST is not loopback, so KIOSK_ADMIN_TOKEN (12+ characters) is required. Admin page not started.'); }
  else if (chosen && chosen.length < 12) { console.error('KIOSK_ADMIN_TOKEN must be at least 12 characters. Admin page not started.'); }
  else {
    const token = chosen || crypto.randomBytes(18).toString('base64url');
    const adminPort = Number(process.env.KIOSK_ADMIN_PORT) || 5081;
    const allowedHosts = (process.env.KIOSK_ADMIN_ALLOWED_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);
    createAdmin({ db, token, allowedHosts }).listen(adminPort, adminHost, () => {
      console.log(`Admin page: http://localhost:${adminPort}/  (${loopback ? 'this machine only' : `listening on ${adminHost}`})`);
      if (!chosen) console.log(`Admin token for this run: ${token}`);
    });
  }
}

/**
 * The owner's admin page: a second server on a second port. Loopback only unless you say otherwise, and saying
 * otherwise (KIOSK_ADMIN_HOST) insists on a token you chose yourself. A random one is made for loopback use and
 * printed once at start-up. It isn't written anywhere, so a restart means a new one (set KIOSK_ADMIN_TOKEN to keep one).
 */
function createAdmin({ db, token, allowedHosts } = {}) {
  return createAdminApp({ getDb: () => db, getSetting: getSetting(db), setSetting: (k, v) => setSetting(db, k, v), token, allowedHosts, publicDir: path.join(__dirname, 'public'), adminDir: path.join(__dirname, 'admin') });
}

module.exports = { createApp, createAdmin, openDb, seedDemo, getSetting, setSetting };
