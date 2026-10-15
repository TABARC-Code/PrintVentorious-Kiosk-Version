/*
 * The shop-owner's side of the standalone kiosk: a small web page and a JSON API to set prices, choose
 * what's in the catalogue, and work through the requests that customers send.
 *
 * This is NOT the customer page with a few buttons hidden. It's a separate server on a separate port, and
 * it is locked down harder than the customer side because it can see people's email addresses and change
 * your prices:
 *
 *   - Listens on 127.0.0.1 by default. Reaching it from another machine is a deliberate choice (see server.js),
 *     and then a token you set yourself is mandatory.
 *   - Every API call needs `Authorization: Bearer <token>`. No cookies, so there's no session to steal or
 *     forge. The page keeps the token in memory only.
 *   - The Host header must be one we expect (stops DNS rebinding: a hostile website pointing its own name at
 *     127.0.0.1 and talking to this as if it were that site).
 *   - Anything that changes something also has to carry an Origin that matches the Host, if the browser sends one.
 *   - Wrong tokens are rate limited per address.
 *   - Strict Content-Security-Policy, nothing external, text from customers only ever goes in with textContent.
 *
 * It does not make this safe to put on the open internet. Put TLS and a proper login in front of it if you ever
 * want that. I haven't built that, so I'm not pretending.
 */
'use strict';

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const FarmCost = require('./farm-cost-lib');
const K = require('./kiosk-core');

const PAGE_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'";
const ASSETS = Object.freeze({
  '/': ['admin.html', 'text/html; charset=utf-8'],
  '/admin.js': ['admin.js', 'text/javascript; charset=utf-8'],
  '/admin.css': ['admin.css', 'text/css; charset=utf-8']
});
// The reading fonts live with the customer page; the admin page borrows two of them by exact name.
const FONTS = Object.freeze({
  '/fonts/atkinson.css': ['atkinson.css', 'text/css; charset=utf-8'],
  '/fonts/lexend.css': ['lexend.css', 'text/css; charset=utf-8'],
  '/fonts/atkinson-hyperlegible-normal-400-latin.woff2': ['atkinson-hyperlegible-normal-400-latin.woff2', 'font/woff2'],
  '/fonts/atkinson-hyperlegible-normal-700-latin.woff2': ['atkinson-hyperlegible-normal-700-latin.woff2', 'font/woff2'],
  '/fonts/atkinson-hyperlegible-italic-400-latin.woff2': ['atkinson-hyperlegible-italic-400-latin.woff2', 'font/woff2'],
  '/fonts/atkinson-hyperlegible-italic-700-latin.woff2': ['atkinson-hyperlegible-italic-700-latin.woff2', 'font/woff2'],
  '/fonts/lexend-normal-100-900-latin.woff2': ['lexend-normal-100-900-latin.woff2', 'font/woff2']
});

const MODEL_MARK = '[kiosk] ';   // models this admin created carry this in the licence column; only those are ever deleted
const MAX_THUMB_BYTES = 120 * 1024;

function tokenOk(given, expected) {
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

/** A thumbnail is a small PNG, JPEG or WebP sent as a data URL. Check the bytes, not just the label. */
function checkThumbnail(dataUrl) {
  if (dataUrl === undefined || dataUrl === null || dataUrl === '') return { ok: true, value: null };
  const m = typeof dataUrl === 'string' && dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return { ok: false, error: 'The picture must be a PNG, JPEG or WebP.' };
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_THUMB_BYTES) return { ok: false, error: 'That picture is too big. Please use one under 120 KB.' };
  const magic = { 'image/png': () => buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), 'image/jpeg': () => buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])), 'image/webp': () => buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP' };
  if (!magic[m[1]]()) return { ok: false, error: 'That file is not really a picture of the type it says it is.' };
  return { ok: true, value: dataUrl };
}

/**
 * ctx: { getDb(), getSetting(key), setSetting(key, value), token, publicDir, adminDir,
 *        allowedHosts?: string[], now?, sendWebhook? }
 */
function createAdminApp(ctx) {
  if (!ctx.token || String(ctx.token).length < 12) throw new Error('The admin token must be at least 12 characters.');
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]', ...(ctx.allowedHosts || []).map((h) => String(h).toLowerCase())]);
  // Wrong guesses are counted per address, and once an address has used up its ten a minute it is refused
  // outright, even with the right token. (Checking the token first would let a patient guesser find the
  // right one anyway: the limit would only ever stop the wrong guesses.) The price is that someone on the
  // same address can lock you out for a minute. Fine for a tool that listens on localhost.
  const now = ctx.now || Date.now;
  const misses = new Map();
  const recentMisses = (key) => { const t = now(); const r = (misses.get(key) || []).filter((x) => t - x < 60000); misses.set(key, r); return r; };
  const db = () => ctx.getDb();
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
    if (!hosts.has(host)) { res.status(421).type('text/plain').send('Unexpected host name'); return; }
    next();
  });

  app.get(Object.keys(ASSETS), (req, res) => {
    const [file, type] = ASSETS[req.path];
    if (req.path === '/') res.setHeader('Content-Security-Policy', PAGE_CSP);
    res.type(type).sendFile(path.join(ctx.adminDir, file));
  });
  app.get(Object.keys(FONTS), (req, res) => {
    const [file, type] = FONTS[req.path];
    res.type(type).sendFile(path.join(ctx.publicDir, 'fonts', file));
  });

  const api = express.Router();
  api.use((req, res, next) => {
    const key = req.ip || 'unknown';
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin && !/^https?:\/\//.test(origin)) { res.status(403).json({ error: 'Blocked.' }); return; }
      if (origin && new URL(origin).host.toLowerCase() !== String(req.headers.host || '').toLowerCase()) { res.status(403).json({ error: 'Blocked: this request came from somewhere else.' }); return; }
    }
    const recent = recentMisses(key);
    if (recent.length >= 10) { res.setHeader('Retry-After', String(Math.max(1, Math.ceil((60000 - (now() - recent[0])) / 1000)))); res.status(429).json({ error: 'Too many wrong tries. Wait a minute.' }); return; }
    const m = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''));
    if (!m || !tokenOk(m[1], ctx.token)) {
      recent.push(now()); misses.set(key, recent);
      if (misses.size > 2000) for (const [k, v] of misses) if (!v.some((x) => now() - x < 60000)) misses.delete(k);
      res.status(401).json({ error: 'That token is not right.' }); return;
    }
    next();
  });
  api.use(express.json({ limit: '300kb' }));
  api.use((err, req, res, next) => { if (err) { res.status(400).json({ error: 'That did not make sense.' }); return; } next(); });   // eslint-disable-line no-unused-vars

  const NAMES_KEY = 'kioskFarmNames';
  const loadNames = () => { try { return JSON.parse(ctx.getSetting(NAMES_KEY) || '{}'); } catch (_) { return {}; } };
  const namesFor = (raw, farm) => {
    const src = raw && typeof raw === 'object' ? raw : loadNames();
    const pick = (group, ids) => Object.fromEntries(Object.keys(ids).map((id) => [id, String((src[group] && src[group][id]) || '').trim().slice(0, 40)]));
    return { printers: pick('printers', farm.printers), filaments: pick('filaments', farm.filaments) };
  };
  const farmRaw = () => K.loadFarmConfig(ctx.getSetting);
  const itemOut = (r) => ({
    id: r.model_id, enabled: !!r.enabled, name: r.title || String(r.fileName || '').replace(/\.[a-z0-9]{2,5}$/i, ''), designer: r.designer === 'Unknown' ? '' : (r.designer || ''),
    licence: String(r.license || '').replace(MODEL_MARK, ''), printHours: r.print_hours, grams: r.grams, unitsPerPlate: r.units_per_plate,
    filamentId: r.filament_id, note: r.note || '', sizeNote: r.size_note || '', thumbnail: r.thumbnail || ''
  });
  const listItems = () => db().prepare(`SELECT k.*, m.fileName, m.designer, m.license, m.thumbnail FROM kiosk_items k JOIN models m ON m.id = k.model_id
    ORDER BY lower(coalesce(k.title, m.fileName))`).all().map(itemOut);

  api.get('/state', (req, res) => {
    const farm = farmRaw();
    res.json({
      settings: K.loadSettings(ctx.getSetting),
      farm: farm ? FarmCost.normaliseConfig(farm) : null,
      names: farm ? namesFor(null, FarmCost.normaliseConfig(farm)) : { printers: {}, filaments: {} },
      ready: K.pricingReady(farm),
      newRequests: K.countNew(db()),
      statuses: K.REQUEST_STATUSES
    });
  });

  api.put('/settings', (req, res) => {
    const merged = K.normaliseSettings({ ...K.loadSettings(ctx.getSetting), ...(req.body && typeof req.body === 'object' ? req.body : {}) });
    ctx.setSetting(K.SETTINGS_KEY, JSON.stringify(merged));
    res.json(merged);
  });

  api.put('/farm', (req, res) => {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const count = (o) => (o && typeof o === 'object' ? Object.keys(o).length : 0);
    if (count(b.printers) > 30 || count(b.filaments) > 60) { res.status(422).json({ error: 'That is more printers or filaments than this page handles.' }); return; }
    const badId = [...Object.keys(b.printers || {}), ...Object.keys(b.filaments || {})].find((k) => !/^[0-9]{1,6}$/.test(k));
    if (badId !== undefined) { res.status(422).json({ error: 'Printer and filament ids are whole numbers (the page makes them for you).' }); return; }
    const { names: rawNames, ...rest } = b;
    const clean = FarmCost.normaliseConfig({ ...(farmRaw() || {}), ...rest });
    ctx.setSetting('farmCostConfig', JSON.stringify(clean));
    // The calculator library has no field for a name, so labels live beside it. Only for the page's benefit.
    const names = namesFor(rawNames, clean);
    ctx.setSetting(NAMES_KEY, JSON.stringify(names));
    res.json({ farm: clean, names, ready: K.pricingReady(clean) });
  });

  api.get('/items', (req, res) => res.json(listItems()));

  const writeItem = (req, res, id) => {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const pic = checkThumbnail(b.thumbnail);
    if (!pic.ok) { res.status(422).json({ error: pic.error }); return; }
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : '';
    if (!name) { res.status(422).json({ error: 'Give the item a name.' }); return; }
    try {
      const run = db().transaction(() => {
        let modelId = id;
        const licence = MODEL_MARK + (typeof b.licence === 'string' ? b.licence.trim().slice(0, 120) : '');
        const designer = typeof b.designer === 'string' ? b.designer.trim().slice(0, 120) : '';
        if (modelId === null) {
          modelId = Number(db().prepare('INSERT INTO models (fileName, designer, license, thumbnail) VALUES (?, ?, ?, ?)').run(name, designer, licence, pic.value).lastInsertRowid);
        } else {
          const own = db().prepare('SELECT id, license FROM models WHERE id = ?').get(modelId);
          if (!own || !String(own.license || '').startsWith(MODEL_MARK)) throw new Error('That item was not made on this page, so it cannot be edited here.');
          db().prepare('UPDATE models SET fileName = ?, designer = ?, license = ?, thumbnail = coalesce(?, thumbnail) WHERE id = ?').run(name, designer, licence, pic.value, modelId);
        }
        K.saveItem(db(), { modelId, title: name, printHours: b.printHours, grams: b.grams, unitsPerPlate: b.unitsPerPlate, filamentId: b.filamentId, note: b.note, sizeNote: b.sizeNote, enabled: b.enabled !== false });
        return modelId;
      });
      res.json({ id: run() });
    } catch (e) { res.status(422).json({ error: e.message }); }
  };
  api.post('/items', (req, res) => writeItem(req, res, null));
  api.put('/items/:id', (req, res) => { const id = Number(req.params.id); if (!Number.isInteger(id)) { res.status(404).json({ error: 'No such item.' }); return; } writeItem(req, res, id); });

  api.delete('/items/:id', (req, res) => {
    const id = Number(req.params.id);
    const removed = K.removeItem(db(), id);
    // Only models this page created are ever deleted. A library you pointed this at is left alone.
    db().prepare('DELETE FROM models WHERE id = ? AND license LIKE ?').run(id, `${MODEL_MARK.replace(/[%_\\]/g, '\\$&')}%`);
    res.status(removed ? 200 : 404).json({ ok: removed });
  });

  // What a customer would be quoted and what it costs you, before an item goes live.
  api.post('/preview', (req, res) => {
    const i = req.body && typeof req.body === 'object' ? req.body : {};
    const item = { print_hours: Number(i.printHours), grams: Number(i.grams), units_per_plate: Math.min(500, Math.max(1, Math.round(Number(i.unitsPerPlate)) || 1)), filament_id: i.filamentId === '' || i.filamentId == null ? null : Number(i.filamentId) };
    if (!(item.print_hours > 0) || !(item.grams > 0)) { res.json({ ok: false, error: 'Enter a print time and a filament weight.' }); return; }
    res.json(K.computeQuote({ farmConfig: farmRaw(), item, quantity: i.quantity || 1, settings: K.loadSettings(ctx.getSetting) }));
  });

  api.get('/requests', (req, res) => {
    // Hand back what the owner needs. Customer free text goes out as data and is only ever shown with textContent.
    res.json(K.listRequests(db(), { status: String(req.query.status || '') }));
  });
  api.patch('/requests/:id', (req, res) => {
    try { const ok = K.updateRequest(db(), req.params.id, req.body && req.body.status); res.status(ok ? 200 : 404).json({ ok }); }
    catch (e) { res.status(422).json({ error: e.message }); }
  });
  api.delete('/requests/:id', (req, res) => { const ok = K.deleteRequest(db(), req.params.id); res.status(ok ? 200 : 404).json({ ok }); });

  api.post('/test-webhook', async (req, res) => {
    const s = K.loadSettings(ctx.getSetting);
    if (!s.webhookUrl) { res.json({ ok: false, error: 'No webhook address saved.' }); return; }
    const send = ctx.sendWebhook || K.sendWebhook;
    res.json(await send(s.webhookUrl, { content: 'Test message from the quote kiosk.', text: 'Test message from the quote kiosk.', test: true }));
  });

  api.use((req, res) => res.status(404).json({ error: 'No such thing.' }));
  app.use('/api', api);
  app.use((req, res) => res.status(404).type('text/plain').send('Not found'));
  return app;
}

module.exports = { createAdminApp, checkThumbnail, tokenOk, MODEL_MARK };
