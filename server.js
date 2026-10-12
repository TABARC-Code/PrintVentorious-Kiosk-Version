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
  const items = [['Phone stand', 'Demo Designs', 3, 50, 'Fits most phones'], ['Cable organiser', 'Demo Designs', 1.5, 25, ''], ['Plant pot', 'Demo Designs', 5, 110, 'Drainage hole included'], ['Chess pawn', 'Demo Designs', 1, 18, 'Sold singly'], ['Desk tidy', 'Demo Designs', 6, 140, ''], ['Key hook', 'Demo Designs', 2, 40, '']];
  for (const [name, designer, hours, grams, note] of items) {
    const id = db.prepare('INSERT INTO models (fileName, designer, license, thumbnail) VALUES (?, ?, ?, ?)').run(`${name}.stl`, designer, 'DEMO', PNG).lastInsertRowid;
    K.saveItem(db, { modelId: id, printHours: hours, grams, unitsPerPlate: 1, filamentId: 1, note });
  }
  setSetting(db, 'farmCostConfig', JSON.stringify({ currency: '£', electricityRate: 0.25, labourRate: 15, failureRatePct: 8, targetMarginPct: 40, printers: { 1: { price: 400, lifetimeHours: 2000, watts: 150, hoursPerMonth: 400 } }, filaments: { 1: { spoolPrice: 20, spoolGrams: 1000 } } }));
  setSetting(db, K.SETTINGS_KEY, JSON.stringify({ enabled: true, title: 'Get a print quote (DEMO)' }));
  return true;
}

function createApp({ db, publicDir = path.join(__dirname, 'public'), onNewRequest } = {}) {
  const app = express();
  app.disable('x-powered-by');
  K.registerRoutes(app, { getDb: () => db, getSetting: getSetting(db), publicDir, onNewRequest });
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
  createApp({ db }).listen(port, () => console.log(`Quote page: http://localhost:${port}/kiosk`));
}

module.exports = { createApp, openDb, seedDemo, getSetting, setSetting };
