/*
 * Customer quote page. Stores NOTHING on this device: no cookies, no local or session
 * storage, no IndexedDB. Everything lives in the variables below and disappears when the
 * page is reloaded, when the idle timer fires, or when the customer starts again.
 * (The test for that looks for exactly those things.)
 *
 * Talks to five endpoints under /api/kiosk and nothing else.
 */
(function () {
  'use strict';

  const main = document.getElementById('k-main');
  let config = { title: 'Get a print quote', intro: '', privacy: '', showPrice: true, idleSeconds: 120, ready: true, mailCopy: false, currency: '£' };
  let state = null;          // what the customer is doing right now; wiped by reset()
  let lastTouch = Date.now();
  let idleTimer = null;
  let resetTimer = null;
  let dirty = false;

  const $ = (id) => document.getElementById(id);
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
  const money = (v) => `${config.currency}${Number(v).toFixed(2)}`;

  async function api(path, body) {
    const res = await fetch(`/api/kiosk${path}`, body === undefined ? { cache: 'no-store' } : { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let data = null;
    try { data = await res.json(); } catch (_) { /* not JSON */ }
    if (!res.ok) { const e = new Error((data && data.error) || 'Something went wrong. Please try again, or ask staff.'); e.status = res.status; throw e; }
    return data;
  }

  // Three plain steps, always shown, so nobody has to guess where they are.
  const STEPS = ['Pick something', 'Check your price', 'Sent'];
  function steps(n) {
    return el('ol', { class: 'k-steps', 'aria-label': `Step ${n} of 3` },
      STEPS.map((t, i) => el('li', { class: i + 1 < n ? 'k-did' : null, 'aria-current': i + 1 === n ? 'step' : null }, `${i + 1}. ${t}`)));
  }

  function show(heading, step, ...content) {
    main.textContent = '';
    const h = el('h2', { id: 'k-screen-title', text: heading, tabindex: '-1' });
    main.append(steps(step), h, ...content);
    h.focus({ preventScroll: false });
    window.scrollTo(0, 0);
  }

  function reset(clearPrefs) {
    clearTimeout(resetTimer);
    if (clearPrefs === true) setPrefs(DEFAULT_PREFS);   // a shared screen: the next person starts from the defaults
    state = { q: '', offset: 0, items: [], total: 0 };
    $('k-idle').hidden = true;
    dirty = false;
    catalogue();
  }

  // ---------- screens ----------
  async function catalogue() {
    const input = el('input', { type: 'search', id: 'k-q', autocomplete: 'off', 'aria-label': 'Search the catalogue', placeholder: 'Search by name or designer', value: state.q });
    const go = () => { state.q = input.value.trim(); state.offset = 0; state.items = []; loadItems(true); };
    const form = el('form', { class: 'k-search', onsubmit: (e) => { e.preventDefault(); go(); } }, input, el('button', { type: 'submit', class: 'k-btn' }, 'Find it'));
    const grid = el('div', { class: 'k-grid', id: 'k-grid' });
    const more = el('div', { class: 'k-more' });
    const status = el('p', { id: 'k-status', 'aria-live': 'polite' });
    show(config.title, 1, config.intro ? el('p', { text: config.intro }) : null, config.ready ? null : el('p', { class: 'k-error', text: 'Pricing is not set up yet. You can look around, but please ask staff for a quote.' }), form, status, grid, more);
    await loadItems(true);

    async function loadItems(fresh) {
      try {
        const r = await api(`/catalogue?q=${encodeURIComponent(state.q)}&offset=${state.offset}&limit=12`);
        if (fresh) { grid.textContent = ''; state.items = []; }
        state.items.push(...r.items); state.total = r.total; state.offset += r.items.length;
        r.items.forEach((it) => grid.append(card(it)));
        status.textContent = state.total === 0 ? (state.q ? 'Nothing matches that search.' : 'There is nothing in the catalogue yet.') : `${state.total} item${state.total === 1 ? '' : 's'}`;
        more.textContent = '';
        if (state.offset < state.total) more.append(el('button', { type: 'button', class: 'k-btn k-secondary', onclick: () => loadItems(false) }, 'Show more'));
      } catch (e) { status.textContent = ''; grid.before(el('p', { class: 'k-error', role: 'alert', text: e.message })); }
    }
  }

  function card(it) {
    return el('button', { type: 'button', class: 'k-card', onclick: () => itemScreen(it) },
      el('img', { src: `/api/kiosk/thumb/${it.id}`, alt: '', loading: 'lazy' }),
      el('span', { class: 'k-card-body' }, el('strong', { text: it.name }), it.designer ? el('small', { text: `by ${it.designer}` }) : null, it.size ? el('small', { class: 'k-size', text: it.size }) : null, el('span', { class: 'k-pick', text: 'Choose this' })));
  }

  function itemScreen(it) {
    dirty = true;
    let qty = 1;
    const error = el('p', { class: 'k-error', role: 'alert' });
    const input = el('input', { type: 'number', id: 'k-qty', min: '1', max: '100', value: '1', inputmode: 'numeric', 'aria-label': 'How many' });
    const setQty = (n) => { qty = Math.max(1, Math.min(100, Math.round(n) || 1)); input.value = String(qty); };
    input.addEventListener('input', () => { const n = Math.round(Number(input.value)); if (n >= 1 && n <= 100) qty = n; });
    const quoteBtn = el('button', { type: 'button', class: 'k-btn', disabled: !config.ready, onclick: async () => {
      error.textContent = ''; setQty(Number(input.value)); quoteBtn.disabled = true;
      try { quoteScreen(it, await api('/quote', { itemId: it.id, quantity: qty })); }
      catch (e) { error.textContent = e.message; quoteBtn.disabled = !config.ready; }
    } }, 'See my price');
    show(it.name, 1,
      el('div', { class: 'k-item' },
        el('img', { src: `/api/kiosk/thumb/${it.id}`, alt: it.name }),
        el('div', {},
          it.designer ? el('p', { text: `Designed by ${it.designer}` }) : null,
          it.size ? el('p', { class: 'k-sizeline' }, el('strong', { text: 'How big: ' }), it.size) : null,
          it.note ? el('p', { text: it.note }) : null,
          el('label', { for: 'k-qty', text: 'How many would you like?' }),
          el('div', { class: 'k-qty' }, el('button', { type: 'button', 'aria-label': 'One fewer', onclick: () => setQty(qty - 1) }, '-'), input, el('button', { type: 'button', 'aria-label': 'One more', onclick: () => setQty(qty + 1) }, '+')),
          error,
          el('div', { class: 'k-actions' }, quoteBtn, el('button', { type: 'button', class: 'k-btn k-secondary', onclick: catalogue }, 'Go back')))));
  }

  function quoteScreen(it, q) {
    const error = el('p', { class: 'k-error', role: 'alert' });
    const email = el('input', { type: 'email', id: 'k-email', autocomplete: 'off', required: true, maxlength: '254', 'aria-describedby': 'k-privacy' });
    const name = el('input', { type: 'text', id: 'k-name', autocomplete: 'off', maxlength: '80' });
    const message = el('textarea', { id: 'k-msg', maxlength: '500', autocomplete: 'off', placeholder: 'Colour, size, when you need it...' });
    const copy = config.mailCopy ? el('label', { class: 'k-check', for: 'k-copy' }, el('input', { type: 'checkbox', id: 'k-copy', checked: true }), el('span', { text: 'Email me a copy of this quote' })) : null;
    const trap = el('input', { type: 'text', class: 'k-hp', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });
    const send = el('button', { type: 'submit', class: 'k-btn' }, 'Send to us');
    const until = new Date(q.validUntil).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const form = el('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault(); error.textContent = ''; send.disabled = true;
      try { doneScreen(await api('/submit', { quoteId: q.quoteId, email: email.value, name: name.value, message: message.value, website: trap.value, copy: !!(copy && copy.querySelector('input').checked) })); }
      catch (err) {
        error.textContent = err.message; send.disabled = false;
        if (err.status === 410) send.replaceWith(el('button', { type: 'button', class: 'k-btn', onclick: () => itemScreen(it) }, 'Get a new quote'));
        else email.focus();
      }
    } },
      el('label', { for: 'k-email', text: 'Your email address' }), email,
      el('label', { for: 'k-name', text: 'Your name (optional)' }), name,
      el('label', { for: 'k-msg', text: 'Anything we should know? (optional)' }), message,
      copy, trap, error,
      el('p', { id: 'k-privacy', text: config.privacy }),
      el('div', { class: 'k-actions' }, send, el('button', { type: 'button', class: 'k-btn k-secondary', onclick: () => itemScreen(it) }, 'Go back'), el('button', { type: 'button', class: 'k-btn k-secondary', onclick: () => reset() }, 'Start again')));

    show('Your price', 2,
      el('div', { class: 'k-box' },
        el('p', { text: `${q.quantity} x ${q.name}` }),
        q.showPrice
          ? [el('div', { class: 'k-price', text: money(q.total) }), el('p', { text: q.quantity > 1 ? `That is ${money(q.unitPrice)} each.` : '' }), el('p', { text: `This is an estimate, valid until ${until}. We confirm the final price when we reply.` })]
          : [el('p', { text: `We will work out the price and email it to you. Our offer will be valid until ${until}.` })]),
      el('div', { class: 'k-box k-next' }, el('h3', { text: 'What happens next?' }), el('ol', {}, el('li', { text: 'You send us this form.' }), el('li', { text: 'We read it and check the price.' }), el('li', { text: 'We email you. You do not pay anything now.' }))),
      form);
  }

  function doneScreen(r) {
    dirty = true;
    show('Thank you. We have your request.', 3,
      el('div', { class: 'k-box' },
        el('p', { text: 'Your reference number is:' }),
        el('div', { class: 'k-ref', text: r.reference }),
        el('p', { text: 'Keep this number. We will email you.' }), r.copyRequested ? el('p', { text: 'We are also sending a copy of your quote to your email. It can take a few minutes.' }) : null),
      el('div', { class: 'k-actions' }, el('button', { type: 'button', class: 'k-btn', onclick: () => reset() }, 'Start again')),
      el('p', { text: 'This screen will clear itself shortly.' }));
    resetTimer = setTimeout(() => reset(true), 45000);
  }

  // ---------- idle clear ----------
  // Past the catalogue means there may be something typed or chosen that the next person shouldn't see.
  // After idleSeconds the page clears itself; for the last 15 seconds a box asks if anyone is still there.
  function touch() { lastTouch = Date.now(); $('k-idle').hidden = true; }
  function watchIdle() {
    clearInterval(idleTimer);
    idleTimer = setInterval(() => {
      const idleFor = (Date.now() - lastTouch) / 1000;
      const limit = config.idleSeconds;
      if (idleFor >= limit) { lastTouch = Date.now(); reset(true); }
      else if (dirty && idleFor >= limit - 15) { $('k-idle').hidden = false; $('k-idle-count').textContent = String(Math.max(0, Math.ceil(limit - idleFor))); }
    }, 1000);
  }

  async function start() {
    ['pointerdown', 'keydown', 'input', 'touchstart'].forEach((ev) => document.addEventListener(ev, touch, { passive: true }));
    $('k-idle-stay').addEventListener('click', touch);
    buildOptions();
    try { config = Object.assign(config, await api('/config')); } catch (e) { main.textContent = ''; main.append(el('p', { class: 'k-error', text: 'This service is not available right now.' })); return; }
    document.title = config.title; $('k-title').textContent = config.title;
    watchIdle();
    reset();
  }
  // ---------- reading options ----------
  // Held in this variable and as classes on <html>. Never written anywhere. The idle clear (and the
  // clear after an order) puts them back, so the next person on a shared screen starts clean.
  // I'm not claiming any of this "fixes" dyslexia: the evidence on fonts is mixed. It's here because
  // people have preferences and it costs nothing to let them choose.
  const DEFAULT_PREFS = Object.freeze({ font: 'standard', size: '1', space: 'normal', colour: 'dark' });
  const OPTIONS = [
    { key: 'font', label: 'Letters', choices: [['standard', 'Standard'], ['atkinson', 'Easy read'], ['lexend', 'Wide and open']] },
    { key: 'size', label: 'Size', choices: [['1', 'Normal'], ['1.25', 'Big'], ['1.5', 'Bigger'], ['1.75', 'Biggest']] },
    { key: 'space', label: 'Spacing', choices: [['normal', 'Normal'], ['roomy', 'Roomy']] },
    { key: 'colour', label: 'Colours', choices: [['dark', 'Dark'], ['cream', 'Soft cream'], ['contrast', 'Strong contrast']] }
  ];
  const CLASS_FOR = { font: { atkinson: 'f-atkinson', lexend: 'f-lexend' }, space: { roomy: 'sp-roomy' }, colour: { cream: 'c-cream', contrast: 'c-contrast' } };
  let prefs = Object.assign({}, DEFAULT_PREFS);

  function setPrefs(next) {
    prefs = Object.assign({}, DEFAULT_PREFS, next);
    const root = document.documentElement;
    for (const map of Object.values(CLASS_FOR)) for (const c of Object.values(map)) root.classList.remove(c);
    for (const [k, map] of Object.entries(CLASS_FOR)) { const c = map[prefs[k]]; if (c) root.classList.add(c); }
    root.style.setProperty('--size', prefs.size);
    document.querySelectorAll('#k-opts input[type=radio]').forEach((r) => { r.checked = prefs[r.name] === r.value; });
  }

  function buildOptions() {
    const grid = $('k-opts-grid');
    for (const o of OPTIONS) {
      const fs = el('fieldset', {}, el('legend', { text: o.label }));
      const row = el('div', { class: 'k-choice' });
      for (const [value, text] of o.choices) {
        const id = `k-o-${o.key}-${value.replace('.', '_')}`;
        row.append(el('label', { for: id }, el('input', { type: 'radio', name: o.key, value, id, onchange: () => setPrefs(Object.assign({}, prefs, { [o.key]: value })) }), el('span', { text })));
      }
      fs.append(row); grid.append(fs);
    }
    const btn = $('k-opts-btn'), panel = $('k-opts');
    const toggle = (open) => {
      panel.hidden = !open; btn.setAttribute('aria-expanded', String(open));
      if (open) $('k-opts-title').focus(); else btn.focus();
    };
    $('k-opts-title').setAttribute('tabindex', '-1');
    btn.addEventListener('click', () => toggle(panel.hidden));
    $('k-opts-close').addEventListener('click', () => toggle(false));
    $('k-opts-reset').addEventListener('click', () => setPrefs(DEFAULT_PREFS));
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });
    setPrefs(DEFAULT_PREFS);
  }

  start();
})();
