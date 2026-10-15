/*
 * Shop-owner page for the standalone quote kiosk. Plain JavaScript, no framework.
 *
 * The token is held in a variable and sent as a header. It is never put in the address bar, a cookie or storage,
 * so a reload asks again. Mildly annoying, deliberately so. Anything a customer typed (name, message, email) is
 * only ever put on the page with textContent, never as HTML.
 */
(function () {
  'use strict';
  const main = document.getElementById('a-main');
  let token = '';
  let state = null;       // /api/state
  let tab = 'requests';
  let filter = '';

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) { if (kid !== undefined && kid !== null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
    return n;
  }
  const money = (v) => (v === null || v === undefined ? '' : `${state && state.farm ? state.farm.currency : '£'}${Number(v).toFixed(2)}`);

  async function api(method, path, body) {
    const res = await fetch(`/api${path}`, { method, cache: 'no-store', headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    let data = null; try { data = await res.json(); } catch (_) { /* not JSON */ }
    if (res.status === 401) { token = ''; login('That token is not right. Check it and try again.'); throw new Error('signed out'); }
    if (!res.ok) throw new Error((data && data.error) || 'Something went wrong.');
    return data;
  }

  // ---------- how the page looks (only the owner's own browser, so remembering it is fine) ----------
  const LOOK = { size: 1, font: 'atkinson', theme: 'cream' };
  const FONTS = [['atkinson', 'Easy read', null], ['lexend', 'Wide and open', 'f-lexend'], ['standard', 'Standard', 'f-standard']];
  const THEMES = [['cream', 'Soft cream', null], ['dark', 'Dark', 't-dark'], ['contrast', 'Strong contrast', 't-contrast']];
  function applyLook() {
    const r = document.documentElement;
    for (const c of ['f-lexend', 'f-standard', 't-dark', 't-contrast']) r.classList.remove(c);
    const f = FONTS.find((x) => x[0] === LOOK.font); const t = THEMES.find((x) => x[0] === LOOK.theme);
    if (f[2]) r.classList.add(f[2]); if (t[2]) r.classList.add(t[2]);
    r.style.setProperty('--size', String(LOOK.size));
    document.getElementById('a-font').textContent = `Letters: ${f[1]}`;
    document.getElementById('a-colour').textContent = `Colours: ${t[1]}`;
    try { localStorage.setItem('kiosk-admin-look', JSON.stringify(LOOK)); } catch (_) { /* private window: fine */ }
  }
  function loadLook() {
    try { const s = JSON.parse(localStorage.getItem('kiosk-admin-look') || 'null'); if (s) { LOOK.size = Math.min(1.75, Math.max(0.85, Number(s.size) || 1)); if (FONTS.some((x) => x[0] === s.font)) LOOK.font = s.font; if (THEMES.some((x) => x[0] === s.theme)) LOOK.theme = s.theme; } } catch (_) { /* ignore */ }
  }
  const cycle = (list, cur) => list[(list.findIndex((x) => x[0] === cur) + 1) % list.length][0];

  // ---------- sign in ----------
  function login(message) {
    main.textContent = '';
    const input = el('input', { type: 'password', id: 'a-token', autocomplete: 'off', 'aria-describedby': 'a-token-help' });
    const err = el('p', { class: 'a-err', role: 'alert', text: message || '' });
    const go = async (e) => {
      e.preventDefault(); token = input.value.trim(); err.textContent = '';
      try { await refresh(); show(); } catch (x) { if (x.message !== 'signed out') err.textContent = x.message; }
    };
    main.append(el('h2', { text: 'Sign in' }),
      el('form', { onsubmit: go },
        el('label', { for: 'a-token', text: 'Admin token' }), input,
        el('p', { id: 'a-token-help', class: 'a-muted', text: 'It was printed in the terminal when the server started, or it is the KIOSK_ADMIN_TOKEN you set.' }),
        err, el('div', { class: 'a-actions' }, el('button', { type: 'submit', class: 'a-btn', text: 'Sign in' }))));
    input.focus();
  }

  async function refresh() { state = await api('GET', '/state'); }

  // ---------- frame ----------
  function show(note) {
    main.textContent = '';
    const labels = [['requests', 'Requests'], ['items', 'Items'], ['prices', 'Prices'], ['settings', 'Settings']];
    const tabs = el('div', { class: 'a-tabs', role: 'tablist', 'aria-label': 'Sections' },
      labels.map(([id, text]) => el('button', { type: 'button', role: 'tab', class: 'a-tab', id: `a-tab-${id}`, 'aria-selected': String(tab === id), onclick: () => { tab = id; show(); } },
        text, id === 'requests' && state.newRequests ? el('span', { class: 'a-badge', text: `${state.newRequests} new` }) : null)));
    const banner = state.ready.ok
      ? el('div', { class: 'a-banner a-fine' }, el('p', { text: state.settings.enabled ? 'The customer page is ON and ready to quote.' : 'Prices are ready, but the customer page is OFF. Turn it on in Settings when you are ready.' }))
      : el('div', { class: 'a-banner' }, el('p', { text: 'Customers cannot get a price yet.' }), el('ul', {}, state.ready.problems.map((p) => el('li', { text: p }))));
    const panel = el('section', { role: 'tabpanel', 'aria-labelledby': `a-tab-${tab}`, id: 'a-panel' });
    main.append(tabs, banner, panel);
    if (note) panel.append(el('p', { class: 'a-ok', role: 'status', text: note }));
    ({ requests: requestsView, items: itemsView, prices: pricesView, settings: settingsView })[tab](panel);
  }
  const reload = async (note) => { await refresh(); show(note); };

  // ---------- requests ----------
  async function requestsView(panel) {
    panel.append(el('h2', { text: 'Requests from customers' }));
    const sel = el('select', { id: 'a-filter', onchange: () => { filter = sel.value; requestsView(clear(panel)); } },
      [['', 'All'], ...state.statuses.map((s) => [s, s[0].toUpperCase() + s.slice(1)])].map(([v, t]) => el('option', { value: v, selected: v === filter, text: t })));
    panel.append(el('label', { for: 'a-filter', text: 'Show' }), sel);
    let rows;
    try { rows = await api('GET', `/requests?status=${encodeURIComponent(filter)}`); } catch (e) { panel.append(el('p', { class: 'a-err', text: e.message })); return; }
    if (!rows.length) { panel.append(el('p', { class: 'a-muted', text: 'Nothing here yet.' })); return; }
    for (const r of rows) panel.append(requestCard(r, panel));
  }
  const clear = (n) => { n.textContent = ''; return n; };

  function requestCard(r, panel) {
    const status = el('select', { 'aria-label': `Status of ${r.reference}`, onchange: async () => { try { await api('PATCH', `/requests/${r.id}`, { status: status.value }); await reload('Saved.'); } catch (e) { msg.textContent = e.message; } } },
      state.statuses.map((s) => el('option', { value: s, selected: s === r.status, text: s })));
    const msg = el('p', { class: 'a-err', role: 'alert' });
    let confirming = false;
    const del = el('button', { type: 'button', class: 'a-btn a-danger', text: 'Delete', onclick: async () => {
      if (!confirming) { confirming = true; del.textContent = 'Really delete? Press again'; return; }
      try { await api('DELETE', `/requests/${r.id}`); await reload('Deleted.'); } catch (e) { msg.textContent = e.message; }
    } });
    const subject = `Your quote ${r.reference}`;
    const body = `Hello${r.customer_name ? ` ${r.customer_name}` : ''},\n\nThank you for your request ${r.reference}: ${r.quantity} x ${r.item_name}.\n`;
    return el('article', { class: 'a-card' },
      el('h3', { text: `${r.reference}: ${r.quantity} x ${r.item_name}` }),
      el('dl', { class: 'a-kv' },
        el('dt', { text: 'Received' }), el('dd', { text: new Date(r.created_at).toLocaleString('en-GB') }),
        el('dt', { text: 'Email' }), el('dd', { text: r.customer_email }),
        r.customer_name ? [el('dt', { text: 'Name' }), el('dd', { text: r.customer_name })] : null,
        r.message ? [el('dt', { text: 'Message' }), el('dd', { text: r.message })] : null,
        el('dt', { text: 'Quoted' }), el('dd', { text: r.price_shown ? `${money(r.total_price)} (${money(r.unit_price)} each)` : 'Price not shown to the customer' }),
        el('dt', { text: 'Your cost' }), el('dd', { text: `${money(r.internal_cost)}, profit ${money(r.internal_profit)}` }),
        el('dt', { text: 'Copy emailed' }), el('dd', { text: { none: 'Not asked for', sent: 'Sent', failed: 'Failed', capped: 'Not sent: daily limit reached' }[r.mail_status] || r.mail_status })),
      el('label', { for: `a-st-${r.id}`, text: 'Where this is up to' }), (status.id = `a-st-${r.id}`, status),
      el('div', { class: 'a-actions' },
        el('a', { class: 'a-btn a-secondary', href: `mailto:${encodeURIComponent(r.customer_email).replace('%40', '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, text: 'Reply by email' }), del),
      msg);
  }

  // ---------- items ----------
  let editing = null;   // an item object, {} for new, or null
  async function itemsView(panel) {
    let items;
    try { items = await api('GET', '/items'); } catch (e) { panel.append(el('p', { class: 'a-err', text: e.message })); return; }
    panel.append(el('h2', { text: 'What customers can choose' }));
    if (editing) { panel.append(itemForm(editing, panel)); return; }
    panel.append(el('div', { class: 'a-actions' }, el('button', { type: 'button', class: 'a-btn', text: 'Add an item', onclick: () => { editing = {}; show(); } })));
    if (!items.length) panel.append(el('p', { class: 'a-muted', text: 'No items yet. Add one so customers have something to pick.' }));
    for (const it of items) {
      panel.append(el('article', { class: 'a-card a-item' },
        it.thumbnail ? el('img', { class: 'a-thumb', src: it.thumbnail, alt: '' }) : el('div', { class: 'a-thumb', role: 'img', 'aria-label': 'No picture' }),
        el('div', { class: 'a-grow' }, el('h3', { text: it.name }), el('p', { class: 'a-muted', text: `${it.printHours} h, ${it.grams} g, ${it.unitsPerPlate} per plate${it.enabled ? '' : '. Hidden from customers'}` })),
        el('button', { type: 'button', class: 'a-btn a-secondary', text: 'Change', 'aria-label': `Change ${it.name}`, onclick: () => { editing = it; show(); } })));
    }
  }

  // Shrinks a chosen picture in the browser so what we send is small: 512 px at most, JPEG.
  // (Read as a data URL, not a blob: URL. The page's Content-Security-Policy allows data: images but not blob:, which
  // I found out the hard way: pictures silently didn't save until the browser test complained.)
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader(); const img = new Image();
      reader.onerror = () => reject(new Error('That file could not be read.'));
      reader.onload = () => { img.src = reader.result; };
      img.onload = () => {
        const k = Math.min(1, 512 / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
        const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        let q = 0.85, out = c.toDataURL('image/jpeg', q);
        while (out.length > 150000 && q > 0.3) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
        resolve(out);
      };
      img.onerror = () => reject(new Error('That does not look like a picture.'));
      reader.readAsDataURL(file);
    });
  }

  function field(label, input, help) { return [el('label', { for: input.id, text: label }), input, help ? el('p', { class: 'a-muted', text: help }) : null]; }
  const text = (id, v, extra) => el('input', { type: 'text', id, value: v == null ? '' : v, autocomplete: 'off', ...extra });
  const num = (id, v, extra) => el('input', { type: 'number', id, value: v == null ? '' : v, step: 'any', inputmode: 'decimal', ...extra });

  function itemForm(it, panel) {
    const isNew = it.id === undefined;
    let picture = null;
    const msg = el('p', { class: 'a-err', role: 'alert' });
    const preview = el('p', { class: 'a-muted', role: 'status', 'aria-live': 'polite' });
    const f = {
      name: text('a-name', it.name, { maxlength: '120' }), designer: text('a-designer', it.designer, { maxlength: '120' }), licence: text('a-licence', it.licence, { maxlength: '120' }),
      hours: num('a-hours', it.printHours, { min: '0' }), grams: num('a-grams', it.grams, { min: '0' }), per: num('a-per', it.unitsPerPlate || 1, { min: '1' }),
      size: text('a-size', it.sizeNote, { maxlength: '60' }), note: text('a-note', it.note, { maxlength: '300' })
    };
    const filament = el('select', { id: 'a-filament' }, el('option', { value: '', text: 'Average of all my filaments' }),
      Object.keys(state.farm ? state.farm.filaments : {}).map((id) => el('option', { value: id, selected: String(it.filamentId) === id, text: filamentLabel(id) })));
    const enabled = el('input', { type: 'checkbox', id: 'a-enabled', checked: it.enabled !== false });
    const file = el('input', { type: 'file', id: 'a-pic', accept: 'image/png,image/jpeg,image/webp', onchange: async () => { msg.textContent = ''; try { picture = file.files[0] ? await shrink(file.files[0]) : null; } catch (e) { picture = null; msg.textContent = e.message; } } });
    const values = () => ({ name: f.name.value, designer: f.designer.value, licence: f.licence.value, printHours: f.hours.value, grams: f.grams.value, unitsPerPlate: f.per.value, filamentId: filament.value, sizeNote: f.size.value, note: f.note.value, enabled: enabled.checked, ...(picture ? { thumbnail: picture } : {}) });
    const doPreview = async () => {
      try { const q = await api('POST', '/preview', { ...values(), quantity: 1 }); preview.textContent = q.ok ? `One would cost the customer ${money(q.unitPrice)}. It costs you ${money(q.internal.cost)}, so your profit is ${money(q.internal.profit)}.` : q.error; } catch (e) { preview.textContent = e.message; }
    };
    const save = async () => {
      msg.textContent = '';
      try { await api(isNew ? 'POST' : 'PUT', isNew ? '/items' : `/items/${it.id}`, values()); editing = null; await reload('Saved.'); } catch (e) { msg.textContent = e.message; }
    };
    let confirming = false;
    const remove = isNew ? null : el('button', { type: 'button', class: 'a-btn a-danger', text: 'Remove this item', onclick: async function () {
      if (!confirming) { confirming = true; this.textContent = 'Really remove? Press again'; return; }
      try { await api('DELETE', `/items/${it.id}`); editing = null; await reload('Removed.'); } catch (e) { msg.textContent = e.message; }
    } });
    return el('form', { class: 'a-card', onsubmit: (e) => { e.preventDefault(); save(); } },
      el('h3', { text: isNew ? 'Add an item' : `Change ${it.name}` }),
      field('Name customers see', f.name), field('Designer (optional)', f.designer), field('Licence (optional, for your records)', f.licence),
      el('div', { class: 'a-row' }, el('div', {}, field('Print time for one plate (hours)', f.hours)), el('div', {}, field('Filament for one plate (grams)', f.grams)), el('div', {}, field('How many fit on one plate', f.per))),
      field('Filament', filament), field('How big is it? (optional)', f.size, 'For example: About 10 x 8 x 9 cm'), field('A short note for customers (optional)', f.note),
      field(isNew ? 'Picture (optional)' : 'New picture (optional, leave empty to keep the old one)', file),
      el('label', { class: 'a-check', for: 'a-enabled' }, enabled, el('span', { text: 'Show this to customers' })),
      preview, msg,
      el('div', { class: 'a-actions' },
        el('button', { type: 'submit', class: 'a-btn', text: 'Save' }),
        el('button', { type: 'button', class: 'a-btn a-secondary', text: 'Show me the price', onclick: doPreview }),
        el('button', { type: 'button', class: 'a-btn a-secondary', text: 'Cancel', onclick: () => { editing = null; show(); } }), remove));
  }
  const filamentLabel = (id) => (state.names.filaments[id] ? `${state.names.filaments[id]}` : `Filament ${id}`);
  const printerLabel = (id) => (state.names.printers[id] ? `${state.names.printers[id]}` : `Printer ${id}`);

  // ---------- prices ----------
  function pricesView(panel) {
    const farm = state.farm || { currency: '£', electricityRate: 0.25, labourRate: 15, failureRatePct: 10, targetMarginPct: 40, printers: {}, filaments: {} };
    const draft = JSON.parse(JSON.stringify(farm));
    const names = JSON.parse(JSON.stringify(state.names));
    const msg = el('p', { role: 'status' });
    panel.append(el('h2', { text: 'How prices are worked out' }),
      el('p', { class: 'a-muted', text: 'Customers are quoted from these numbers: the cost of running your printers and your filament, plus your margin. Be honest here. A quote is only as good as these figures.' }));
    const general = [['currency', 'Currency symbol', 'text'], ['electricityRate', 'Electricity, per kWh', 'number'], ['labourRate', 'Your time, per hour', 'number'], ['failureRatePct', 'Prints that fail (%)', 'number'], ['targetMarginPct', 'Margin you want (%)', 'number']];
    const inputs = {};
    const form = el('form', { onsubmit: async (e) => {
      e.preventDefault(); msg.className = ''; msg.textContent = '';
      for (const [k, , type] of general) draft[k] = type === 'number' ? Number(inputs[k].value) : inputs[k].value;
      try { const r = await api('PUT', '/farm', { ...draft, names }); state.farm = r.farm; state.names = r.names; state.ready = r.ready; show('Saved.'); } catch (x) { msg.className = 'a-err'; msg.textContent = x.message; }
    } });
    for (const [k, label, type] of general) { inputs[k] = type === 'number' ? num(`a-f-${k}`, draft[k], { min: '0' }) : text(`a-f-${k}`, draft[k], { maxlength: '4' }); form.append(...field(label, inputs[k])); }
    const group = (title, kind, specs, defaults, labelOf) => {
      form.append(el('h3', { text: title }));
      const holder = el('div', {}); form.append(holder);
      const draw = () => {
        holder.textContent = '';
        for (const id of Object.keys(draft[kind])) {
          const row = el('div', { class: 'a-card' });
          const nameIn = text(`a-${kind}-${id}-name`, names[kind][id], { maxlength: '40', oninput: () => { names[kind][id] = nameIn.value; } });
          row.append(...field('Name', nameIn));
          const grid = el('div', { class: 'a-row' });
          for (const [key, label, extra] of specs) {
            const inp = key === 'active' ? el('input', { type: 'checkbox', id: `a-${kind}-${id}-${key}`, checked: draft[kind][id][key] !== false, onchange: () => { draft[kind][id][key] = inp.checked; } })
              : num(`a-${kind}-${id}-${key}`, draft[kind][id][key], { ...extra, oninput: () => { draft[kind][id][key] = Number(inp.value); } });
            grid.append(el('div', {}, key === 'active' ? el('label', { class: 'a-check', for: inp.id }, inp, el('span', { text: label })) : field(label, inp)));
          }
          row.append(grid, el('button', { type: 'button', class: 'a-btn a-danger', text: 'Remove', 'aria-label': `Remove ${labelOf(id)}`, onclick: () => { delete draft[kind][id]; delete names[kind][id]; draw(); } }));
          holder.append(row);
        }
        holder.append(el('button', { type: 'button', class: 'a-btn a-secondary', text: kind === 'printers' ? 'Add a printer' : 'Add a filament', onclick: () => {
          const next = String(Math.max(0, ...Object.keys(draft[kind]).map(Number)) + 1); draft[kind][next] = { ...defaults }; names[kind][next] = ''; draw();
        } }));
      };
      draw();
    };
    group('Your printers', 'printers', [['price', 'What it cost to buy', { min: '0' }], ['lifetimeHours', 'Hours it should last', { min: '1' }], ['watts', 'Power used (watts)', { min: '0' }], ['hoursPerMonth', 'Hours it runs per month', { min: '0', max: '744' }], ['active', 'In service']], { price: 0, lifetimeHours: 5000, watts: 150, hoursPerMonth: 400, active: true }, printerLabel);
    group('Your filaments', 'filaments', [['spoolPrice', 'Price of one spool', { min: '0' }], ['spoolGrams', 'Grams on a spool', { min: '1' }]], { spoolPrice: 0, spoolGrams: 1000 }, filamentLabel);
    form.append(msg, el('div', { class: 'a-actions' }, el('button', { type: 'submit', class: 'a-btn', text: 'Save prices' })));
    panel.append(form);
  }

  // ---------- settings ----------
  function settingsView(panel) {
    const s = state.settings;
    const msg = el('p', { role: 'status' });
    const on = el('input', { type: 'checkbox', id: 'a-s-enabled', checked: !!s.enabled });
    const showPrice = el('input', { type: 'checkbox', id: 'a-s-showPrice', checked: !!s.showPrice });
    const f = {
      title: text('a-s-title', s.title, { maxlength: '80' }), intro: el('textarea', { id: 'a-s-intro', maxlength: '300', text: s.intro }), privacy: el('textarea', { id: 'a-s-privacy', maxlength: '400', text: s.privacy }),
      validityDays: num('a-s-validity', s.validityDays, { min: '1', max: '90' }), minimumCharge: num('a-s-min', s.minimumCharge, { min: '0' }),
      idleSeconds: num('a-s-idle', s.idleSeconds, { min: '20', max: '1800' }), retentionDays: num('a-s-keep', s.retentionDays, { min: '1', max: '3650' }), webhookUrl: text('a-s-webhook', s.webhookUrl, { maxlength: '500' })
    };
    f.intro.value = s.intro; f.privacy.value = s.privacy;
    const form = el('form', { onsubmit: async (e) => {
      e.preventDefault(); msg.className = ''; msg.textContent = '';
      try {
        state.settings = await api('PUT', '/settings', { enabled: on.checked, showPrice: showPrice.checked, title: f.title.value, intro: f.intro.value, privacy: f.privacy.value, validityDays: f.validityDays.value, minimumCharge: f.minimumCharge.value, idleSeconds: f.idleSeconds.value, retentionDays: f.retentionDays.value, webhookUrl: f.webhookUrl.value });
        show('Saved.');
      } catch (x) { msg.className = 'a-err'; msg.textContent = x.message; }
    } },
      el('label', { class: 'a-check', for: 'a-s-enabled' }, on, el('span', { text: 'Customer page is ON' })),
      el('label', { class: 'a-check', for: 'a-s-showPrice' }, showPrice, el('span', { text: 'Show customers the price (if off, you email it to them)' })),
      field('Page title', f.title), field('Welcome words', f.intro), field('Privacy words (shown before they send)', f.privacy, 'This is yours to word. It is not legal advice, and neither is the default.'),
      field('A quote stays valid for (days)', f.validityDays), field('Smallest amount you will charge', f.minimumCharge),
      field('Clear the screen after this many seconds untouched', f.idleSeconds), field('Delete requests after this many days', f.retentionDays),
      field('Webhook address (optional: Discord, Slack or your own)', f.webhookUrl, 'https only. We send a short message when a request arrives.'),
      msg,
      el('div', { class: 'a-actions' },
        el('button', { type: 'submit', class: 'a-btn', text: 'Save settings' }),
        el('button', { type: 'button', class: 'a-btn a-secondary', text: 'Send a test message', onclick: async () => { try { const r = await api('POST', '/test-webhook'); msg.className = r.ok ? 'a-ok' : 'a-err'; msg.textContent = r.ok ? 'The test message was sent.' : (r.error || 'It did not go through.'); } catch (x) { msg.className = 'a-err'; msg.textContent = x.message; } } })));
    panel.append(el('h2', { text: 'Settings' }), form);
  }

  // ---------- start ----------
  document.getElementById('a-smaller').addEventListener('click', () => { LOOK.size = Math.max(0.85, +(LOOK.size - 0.15).toFixed(2)); applyLook(); });
  document.getElementById('a-larger').addEventListener('click', () => { LOOK.size = Math.min(1.75, +(LOOK.size + 0.15).toFixed(2)); applyLook(); });
  document.getElementById('a-font').addEventListener('click', () => { LOOK.font = cycle(FONTS, LOOK.font); applyLook(); });
  document.getElementById('a-colour').addEventListener('click', () => { LOOK.theme = cycle(THEMES, LOOK.theme); applyLook(); });
  loadLook(); applyLook();
  login();
})();
