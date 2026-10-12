#!/usr/bin/env node
/* Lists the quote requests in the database. Read-only. Usage: npm run inbox [-- --all] */
'use strict';
const path = require('path');
const Database = require('better-sqlite3');
const file = process.env.KIOSK_DB || path.join(__dirname, '..', 'data', 'kiosk.db');
let db;
try { db = new Database(file, { readonly: true, fileMustExist: true }); } catch (e) { console.error(`No database at ${file}. Start the server first (npm start).`); process.exit(1); }
const rows = db.prepare(`SELECT * FROM quote_requests ${process.argv.includes('--all') ? '' : "WHERE status = 'new'"} ORDER BY created_at DESC`).all();
if (!rows.length) console.log(process.argv.includes('--all') ? 'No quote requests.' : 'No new quote requests. (Use --all to see every one.)');
for (const r of rows) {
  console.log(`${r.reference}  ${r.created_at.slice(0, 16).replace('T', ' ')}  [${r.status}]`);
  console.log(`  ${r.quantity} x ${r.item_name}   quote ${r.currency}${Number(r.total_price).toFixed(2)}${r.price_shown ? '' : ' (customer was not shown a price)'}   valid until ${r.valid_until.slice(0, 10)}`);
  console.log(`  from ${r.customer_email}${r.customer_name ? ` (${r.customer_name})` : ''}`);
  if (r.message) console.log(`  message: ${r.message}`);
  console.log(`  your cost ${r.currency}${Number(r.internal_cost).toFixed(2)}, profit ${r.currency}${Number(r.internal_profit).toFixed(2)}\n`);
}
