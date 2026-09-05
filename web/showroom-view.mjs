// =============================================================================
// showroom-view.mjs — the SHOWROOM configurator renderer (real, engine-driven).
//
// mountShowroom(root, { model, ir, engine, brand, resolveImage }) renders the
// Rowblaa "Dusk Showroom": the first choice field becomes a GTA-style turntable
// of cars on the stage; every other field is a luxury glass spec-rail; the wasm
// engine drives pricing, availability, forcing, limits and validation. Cars use
// an associated image (option.image, resolved via resolveImage) when present,
// else a built-in silhouette. Styling: showroom.css.
//
// This is a sibling of render-form.mjs (the standard form) — same engine, a
// different presentation. The engine result is mapped once into a small shape
// the view code consumes, so the wasm/engine stay untouched.
// =============================================================================

const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

export function mountShowroom(root, { model, ir, engine, brand, resolveImage, links }) {
  brand = brand || { mark: 'ROWBLAA', rest: 'LUXURY', tagline: '' };
  resolveImage = resolveImage || (async () => null);
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const modelFieldById = Object.fromEntries(model.fields.map((f) => [f.id, f]));
  const slotToField = Object.fromEntries(ir.fields.map((f) => [f.slot, f.id]));
  const emphasis = new Set((model.outputs || []).filter((o) => o.emphasis).map((o) => o.id));
  // presentation-declared roles (domain-agnostic): which outputs are headline spec
  // tiles, which appear in Compare (with a best-direction), and which drives the plate gauge.
  const specIds = (model.outputs || []).filter((o) => o.spec).map((o) => o.id);
  const gaugeMeta = (model.outputs || []).find((o) => o.gaugeMax);
  const primary = ir.fields.find((f) => f.type === 'choice' && f.options && f.options.length) || ir.fields[0];
  const sections = [...(model.sections || [])].sort((a, b) => (a.order || 0) - (b.order || 0));

  // ---------- engine bridge: engine.evaluate(state) -> view shape ----------
  const decode = (f, num) => {
    if (f.type === 'choice') return (f.options.find((o) => o.code === num) || f.options[0]).id;
    if (f.type === 'multichoice') { const m = num | 0; return f.options.filter((o) => (m >> o.code) & 1).map((o) => o.id); }
    if (f.type === 'boolean') return num !== 0;
    return num;
  };
  function compute(input) {
    const ei = {}; for (const f of ir.fields) ei[f.id] = f.type === 'number' ? (input[f.id] ?? 0) : input[f.id];
    let res = engine.evaluate(ei);
    // seed unset number fields (e.g. deposit) to their engine-computed minimum, once
    let reseed = false;
    for (const f of ir.fields) if (f.type === 'number' && input[f.id] == null && res.limits[f.id] && res.limits[f.id].min != null) { input[f.id] = res.limits[f.id].min; ei[f.id] = input[f.id]; reseed = true; }
    if (reseed) res = engine.evaluate(ei);
    const st = {};
    for (const f of ir.fields) st[f.id] = f.type === 'number' ? ei[f.id] : decode(f, res.valueById[f.id]);
    const forced = {}; for (const f of ir.fields) if (res.forced.includes(f.slot)) forced[f.id] = true;
    const avail = {}; for (const f of ir.fields) if (f.options) { avail[f.id] = {}; const os = res.optionState[f.id]; for (const o of f.options) avail[f.id][o.id] = os ? os[o.id] !== false : true; }
    const vis = {}; for (const f of ir.fields) vis[f.id] = res.visible[f.id] !== false;
    const out = {}; ir.outputs.forEach((o, i) => { const r = res.outputs[i]; out[o.id] = { value: r.value, visible: r.visible !== false, fmt: r, label: o.label, emphasis: emphasis.has(o.id) }; });
    const sev = { 2: 'error', 1: 'warning', 0: 'info' };
    const msgs = res.messages.map((m) => ({ field: slotToField[m.targetSlot], severity: sev[m.severity], message: m.message }));
    const limits = {}; for (const f of ir.fields) if (res.limits[f.id]) limits[f.id] = res.limits[f.id];
    return { st, forced, avail, out, vis, msgs, limits };
  }

  const fmt = (o) => {
    const v = o.value, r = o.fmt || {};
    const nf = (opts) => new Intl.NumberFormat('en-GB', opts).format(v);
    if (r.format === 'currency') return nf({ style: 'currency', currency: r.currencyCode || 'GBP', minimumFractionDigits: r.decimals ?? 0, maximumFractionDigits: r.decimals ?? 0 });
    if (r.format === 'percent') return nf({ style: 'percent', minimumFractionDigits: r.decimals ?? 0, maximumFractionDigits: r.decimals ?? 0 });
    if (r.format === 'unit') return nf({ maximumFractionDigits: r.decimals ?? 0 }) + (r.unit ? ' ' + r.unit : '');
    return nf({ maximumFractionDigits: r.decimals ?? 0 });
  };
  const money0 = (v) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(v);

  // ---------- item visuals (image asset, else a neutral placeholder) ----------
  // Colour swatch palette (used only by a field flagged render:"swatch", e.g. paint).
  const PAINT = { solid: ['#8a9099', '#6d737c'], metallic: ['#aeb7c4', '#7c8794'], premium: ['#3a4c6b', '#243149'], matte: ['#4a4d52', '#3a3d42'] };
  // domain-agnostic placeholder shown until an image is attached: a framed monogram
  // of the option's label (works for a car, a painting, a chandelier — anything).
  function placeholderSVG(optId) {
    const o = (modelFieldById[primary.id].options || []).find((x) => x.id === optId);
    const lbl = (o && o.label) || optId;
    const initials = String(lbl).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '◆';
    const gid = 'ph' + Math.random().toString(36).slice(2, 7);
    return `<svg viewBox="0 0 400 250" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" preserveAspectRatio="xMidYMid meet"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#232830"/><stop offset="1" stop-color="#12141a"/></linearGradient></defs><rect width="400" height="250" fill="url(#${gid})"/><rect x="148" y="52" width="104" height="146" rx="4" fill="none" stroke="rgba(216,162,74,.45)" stroke-width="2"/><text x="200" y="142" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-weight="600" font-size="46" fill="rgba(244,239,231,.9)">${initials}</text></svg>`;
  }
  const imgUrl = {}; // primary optionId -> resolved image URL
  function carVisual(optId) {
    if (imgUrl[optId]) return `<img class="carimg" src="${imgUrl[optId]}" alt="">`;
    return placeholderSVG(optId);
  }

  // ---------- state ----------
  const state = {};
  for (const f of ir.fields) state[f.id] = f.type === 'multichoice' ? (f.defaultRaw ? f.defaultRaw.slice() : []) : f.type === 'boolean' ? !!f.defaultRaw : f.type === 'number' ? (f.defaultRaw ?? null) : (f.defaultRaw ?? f.options[0].id);
  const primaryOpts = () => modelFieldById[primary.id].options || [];
  const emOutput = () => ir.outputs.find((o) => emphasis.has(o.id)) || ir.outputs[0];
  // a config built from field DEFAULTS (not the live selection) — the base every
  // "from" price starts from, so it's independent of what's currently selected.
  const defaultsConfig = () => {
    const b = {};
    for (const f of ir.fields) b[f.id] = f.type === 'multichoice' ? [] : f.type === 'boolean' ? !!f.defaultRaw : f.type === 'number' ? (f.defaultRaw ?? null) : (f.defaultRaw ?? f.options[0].id);
    return b;
  };
  // "from" = the price of the model's DEFAULT build for this option (all other fields
  // at their declared defaults). Domain-agnostic — no per-field ("cheapest engine")
  // special-casing — so it equals the landing headline and the breakdown's base line.
  const baseConfigFor = (id) => Object.assign(defaultsConfig(), { [primary.id]: id, packages: [], financing: 'cash' });
  const fromPrice = (id) => compute(baseConfigFor(id)).out[emOutput().id].value;

  // ---------- model-driven price deltas (relative to the CURRENT selection) ----------
  // Every "+£x" / "−£x" shown on an option is the genuine change the MODEL computes
  // for choosing it, versus the price you're on now — derived by re-evaluating the
  // model, never a hand-authored number that can drift from the pricing tables.
  const emId = emOutput() ? emOutput().id : null;
  const emOutIdx = Math.max(0, ir.outputs.findIndex((o) => emphasis.has(o.id)));
  const priceIf = (overrides) => {
    const ei = {}; for (const f of ir.fields) { const v = (overrides && f.id in overrides) ? overrides[f.id] : state[f.id]; ei[f.id] = f.type === 'number' ? (v ?? 0) : v; }
    const r = engine.evaluate(ei); const o = r.outputs[emOutIdx];
    return o ? o.value : null;
  };
  const signed = (d) => ({ text: (d > 0 ? '+' : '−') + money0(Math.abs(d)), cls: d > 0 ? 'up' : 'down' });
  // delta of switching a single-choice field to optId; null for the current option,
  // for unavailable options, and for a zero change.
  const relDelta = (fieldId, optId, cur, av) => {
    if (state[fieldId] === optId) return null;
    if (av && av[optId] === false) return null;
    const p = priceIf({ [fieldId]: optId }); if (p == null) return null;
    const d = Math.round(p - cur); return d ? signed(d) : null;
  };
  // marginal cost to ADD a multichoice option (captures any bundle effect it triggers).
  const addDelta = (fieldId, optId, cur, av) => {
    if (av && av[optId] === false) return null;
    const set = new Set(state[fieldId] || []); set.add(optId);
    const p = priceIf({ [fieldId]: [...set] }); if (p == null) return null;
    const d = Math.round(p - cur); return d ? signed(d) : null;
  };

  // ---------- shell ----------
  root.innerHTML = '';
  const shell = el('div', 'vdm');
  const hd = el('header', 'hd');
  const brandEl = el('div', 'brand');
  brandEl.innerHTML = `<a class="brand-home" href="index.html"><b>${brand.mark}</b> ${brand.rest || ''}</a>`.trim()
    + (brand.descriptor ? `<span class="descriptor">${brand.descriptor}</span>` : '');
  const tagEl = el('div', 'tag'); tagEl.textContent = brand.tagline || '';
  hd.appendChild(brandEl);
  if (links && links.length) { const nav = el('nav', 'sh-nav'); nav.setAttribute('aria-label', 'Edit'); for (const l of links) { const a = el('a'); a.href = l.href; a.textContent = l.label; nav.appendChild(a); } hd.appendChild(nav); }
  hd.appendChild(tagEl);
  const body = el('div', 'body');
  const stage = el('section', 'stage'); stage.setAttribute('aria-label', 'Showroom stage');
  const turntable = el('div', 'turntable');
  const dock = el('div', 'dock');
  const dockHd = el('div', 'dock-hd');
  const dockLabel = el('span', 'dock-label'); dockLabel.textContent = 'The range';
  const cmpBtn = el('button', 'compare-btn'); cmpBtn.type = 'button'; cmpBtn.innerHTML = '<span aria-hidden="true">⇆</span> Compare'; cmpBtn.setAttribute('aria-haspopup', 'dialog');
  cmpBtn.addEventListener('click', openCompare);
  dockHd.append(dockLabel, cmpBtn);
  // the range as a single-row coverflow "deck": the selected car is face-up & centred,
  // neighbours fan away in 3D, and it loops (the last card's right neighbour is the first).
  const deck = el('div', 'deck');
  // the radiogroup owns ONLY the radio cards (nav arrows sit outside it so the
  // group's membership stays clean); the track is a positioning layer for the cards.
  const deckTrack = el('div', 'deck-track'); deckTrack.setAttribute('role', 'radiogroup'); deckTrack.setAttribute('aria-label', 'Choose a model');
  const navPrev = el('button', 'deck-nav prev'); navPrev.type = 'button'; navPrev.innerHTML = '<span aria-hidden="true">‹</span>'; navPrev.setAttribute('aria-label', 'Previous vehicle');
  const navNext = el('button', 'deck-nav next'); navNext.type = 'button'; navNext.innerHTML = '<span aria-hidden="true">›</span>'; navNext.setAttribute('aria-label', 'Next vehicle');
  // loop only when there are enough cards to hide the wrap off-stage (>=7); with
  // fewer, a wrapping card would visibly pop across the deck, so clamp at the ends.
  const stepDeck = (dir) => { const opts = primaryOpts(); const n = opts.length; const i = Math.max(0, opts.findIndex((o) => o.id === state[primary.id])); const j = n >= 7 ? ((i + dir) % n + n) % n : Math.max(0, Math.min(n - 1, i + dir)); const nx = opts[j].id; setField(primary.id, nx); const c = deckCards && deckCards[nx]; if (c) c.focus({ preventScroll: true }); };
  navPrev.addEventListener('click', () => stepDeck(-1)); navNext.addEventListener('click', () => stepDeck(1));
  deckTrack.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); stepDeck(1); }
    else if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); stepDeck(-1); }
    else if (k === 'Home') { e.preventDefault(); const o = primaryOpts()[0]; setField(primary.id, o.id); deckCards[o.id] && deckCards[o.id].focus({ preventScroll: true }); }
    else if (k === 'End') { e.preventDefault(); const os = primaryOpts(); const o = os[os.length - 1]; setField(primary.id, o.id); deckCards[o.id] && deckCards[o.id].focus({ preventScroll: true }); }
  });
  deck.append(deckTrack, navPrev, navNext);
  dock.append(dockHd, deck);
  stage.append(turntable, dock);
  const rail = el('aside', 'rail'); rail.setAttribute('aria-label', 'Specification');
  rail.innerHTML = `<div class="rail-hd"><div class="marque" id="sh-marque"></div><h1 id="sh-name">—</h1><div class="sub" id="sh-sub"></div></div>
    <div class="specsheet" id="sh-specsheet"></div>
    <div class="rail-body" id="sh-specs"></div>
    <div class="plate"><div class="micro"><span id="sh-veh">—</span><span id="sh-gauge" style="display:flex;align-items:center;gap:8px"><span id="sh-range" class="num">—</span><span class="gauge"><i id="sh-rangebar" style="width:0"></i></span></span></div>
      <div class="otr-label" id="sh-otr-label">Total</div><div class="otr"><span class="fig num" id="sh-otr">—</span></div>
      <div class="monthly" id="sh-monthly"></div><div class="savings" id="sh-savings"></div><button class="cta" id="sh-cta">Request this build ▸</button></div>`;
  body.append(stage, rail);
  shell.append(hd, body);
  root.appendChild(shell);
  const $ = (id) => root.querySelector('#' + id);

  // ---------- controls (chips / powertrain / swatch / stepper) ----------
  function chip(label, delta, checked, disabled, onClick, extra) {
    const b = el('button', 'chip'); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(checked)); if (disabled) b.disabled = true;
    const dHtml = delta ? `<span class="cd num ${delta.cls || ''}">${delta.text}</span>` : '';
    b.innerHTML = (extra || '') + `<span>${label}</span>` + dHtml;
    b.addEventListener('click', onClick); return b;
  }

  function renderField(f, res) {
    const mf = modelFieldById[f.id];
    const wrap = el('div', 'field');
    const lab = el('div', 'flabel'); lab.innerHTML = `<span>${f.label || f.id}</span>` + (res.forced[f.id] ? '<span class="auto">Auto</span>' : '');
    wrap.appendChild(lab);
    const av = res.avail[f.id] || {};
    const curP = emId != null ? res.out[emId].value : 0;   // current headline price, for relative deltas
    if (f.type === 'choice' && f.control === 'radio') {
      const list = el('div', 'plist');
      for (const o of f.options) {
        const b = el('button', 'prow'); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(state[f.id] === o.id)); if (av[o.id] === false) b.disabled = true;
        const dd = relDelta(f.id, o.id, curP, av);
        const pd = dd ? `<span class="pd num ${dd.cls}">${dd.text}</span>` : '<span class="pd num"></span>';
        b.innerHTML = `<span class="rd"></span><span><span class="pn">${o.label || o.id}</span></span>${pd}`;
        b.addEventListener('click', () => setField(f.id, o.id)); list.appendChild(b);
      }
      wrap.appendChild(list);
    } else if (f.type === 'choice') {
      const box = el('div', 'chips');
      for (const o of f.options) {
        const swatch = f.id === 'colour' ? `<span class="dot" style="background:linear-gradient(135deg,${(PAINT[o.id] || PAINT.solid).join(',')})"></span>` : '';
        const glyph = f.id === 'wheels' ? `<span class="glyph" style="width:${10 + f.options.indexOf(o) * 2}px;height:${10 + f.options.indexOf(o) * 2}px"></span>` : '';
        box.appendChild(chip(o.label || o.id, relDelta(f.id, o.id, curP, av), state[f.id] === o.id, av[o.id] === false, () => setField(f.id, o.id), swatch + glyph));
      }
      wrap.appendChild(box);
    } else if (f.type === 'multichoice') {
      const box = el('div', 'chips');
      for (const o of f.options) {
        const on = (state[f.id] || []).includes(o.id);
        const b = chip(o.label || o.id, on ? null : addDelta(f.id, o.id, curP, av), on, av[o.id] === false && !on, () => { const s = new Set(state[f.id] || []); s.has(o.id) ? s.delete(o.id) : s.add(o.id); setField(f.id, [...s]); });
        b.setAttribute('role', 'checkbox'); b.setAttribute('aria-pressed', String(on)); b.removeAttribute('aria-checked'); box.appendChild(b);
      }
      wrap.appendChild(box);
    } else if (f.type === 'number') {
      const st = el('div', 'step'); const lim = res.limits[f.id] || {}; const step = mf.step || 1;
      const dec = el('button'); dec.type = 'button'; dec.textContent = '−'; dec.setAttribute('aria-label', 'decrease');
      const val = el('span', 'val num'); const inc = el('button'); inc.type = 'button'; inc.textContent = '+'; inc.setAttribute('aria-label', 'increase');
      const affix = el('span', 'affix'); affix.textContent = f.unit === 'GBP' ? '£' : (f.unit || '');
      const cur = state[f.id] ?? lim.min ?? 0; val.textContent = new Intl.NumberFormat('en-GB').format(cur);
      const clamp = (v) => Math.max(lim.min ?? -1e9, Math.min(lim.max ?? 1e9, v));
      dec.addEventListener('click', () => setField(f.id, clamp(cur - step))); inc.addEventListener('click', () => setField(f.id, clamp(cur + step)));
      st.append(dec, val, affix, inc); wrap.appendChild(st);
      if (f.id === 'deposit' && lim.max) { const t = el('div', 'hinttrack'); t.innerHTML = `<i style="width:${Math.min(100, (cur / lim.max) * 100)}%"></i>`; wrap.appendChild(t); }
    }
    for (const m of res.msgs) if (m.field === f.id) { const d = el('div', 'msg ' + m.severity); d.textContent = m.message; wrap.appendChild(d); }
    return wrap;
  }

  function renderSpecs(res) {
    const host = $('sh-specs'); host.innerHTML = '';
    const bySection = {}; for (const s of sections) bySection[s.id] = [];
    for (const f of ir.fields) if (f.id !== primary.id && res.vis[f.id]) (bySection[modelFieldById[f.id].section] || (bySection[modelFieldById[f.id].section] = [])).push(f);
    for (const s of sections) {
      const fs = bySection[s.id] || []; if (!fs.length) continue;
      const sec = el('section', 'sec'); sec.innerHTML = `<div class="eyebrow">${s.label}</div>`;
      for (const f of fs) sec.appendChild(renderField(f, res));
      host.appendChild(sec);
    }
    renderBundles(host);
  }

  // Bundles: x+y+z packages -> a discount. Shows each bundle's state; clicking a
  // locked one adds its packages. The discount itself is applied by the engine
  // (the compiled bundlesDiscount computed folded into vehiclePrice).
  const pkgLabel = () => Object.fromEntries((modelFieldById.packages?.options || []).map((o) => [o.id, o.label || o.id]));
  function renderBundles(host) {
    const bundles = model.bundles || [];
    if (!bundles.length) return;
    const labels = pkgLabel();
    const selected = new Set(state.packages || []);
    const sec = el('section', 'sec');
    sec.innerHTML = '<div class="eyebrow">Bundles &amp; savings</div>';
    for (const b of bundles) {
      const missing = b.requires.filter((r) => !selected.has(r));
      const active = missing.length === 0;
      const row = el('button', 'bundle' + (active ? ' is-active' : '')); row.type = 'button';
      row.setAttribute('aria-pressed', String(active));
      row.innerHTML = `<div class="bundle-h"><span class="bundle-name">${b.label}</span><span class="bundle-save num">−${money0(b.discount)}</span></div>`
        + `<div class="bundle-req">${active ? 'Applied · ' + b.requires.map((r) => labels[r]).join(' + ') : 'Add ' + missing.map((r) => labels[r]).join(' + ')}</div>`;
      row.addEventListener('click', () => { const set = new Set(state.packages || []); b.requires.forEach((r) => set.add(r)); setField('packages', [...set]); });
      sec.appendChild(row);
    }
    host.appendChild(sec);
  }
  const activeSavings = () => (model.bundles || []).reduce((s, b) => s + (b.requires.every((r) => (state.packages || []).includes(r)) ? b.discount : 0), 0);

  // ---------- comparison (premium, flexible: 2–4 cars, swappable, best-in-row) ----------
  const COMPARE_ROWS = (model.outputs || []).filter((o) => o.compare)
    .map((o) => ({ id: o.id, label: o.compareLabel || o.label, dir: o.compare }))
    .filter((r) => ir.outputs.some((o) => o.id === r.id));
  let compareIds = null;

  // a model option's headline metrics at its default build (the same basis as "from")
  function carMetrics(id) { return compute(baseConfigFor(id)); }
  let cmpOpener = null;
  function openCompare() {
    const all = primaryOpts().map((o) => o.id);
    const cur = state[primary.id];
    compareIds = [cur, ...all.filter((id) => id !== cur)].slice(0, 3);
    cmpOpener = document.activeElement;         // to restore focus on close
    shell.inert = true;                          // make the app behind the dialog inert (no focus/AT reach)
    renderCompare('init');
  }
  function closeCompare() { compareIds = null; shell.inert = false; const ov = root.querySelector('.cmp-overlay'); if (ov) ov.remove(); document.removeEventListener('keydown', cmpKey); if (cmpOpener && cmpOpener.focus) cmpOpener.focus(); cmpOpener = null; }
  function cmpKey(e) { if (e.key === 'Escape') closeCompare(); }
  // focusReq: 'init' (focus the dialog on open) | <number> (focus the i-th picker
  // after a rebuild, so keyboard focus survives select/add/remove) | undefined.
  function renderCompare(focusReq) {
    if (!compareIds) return;
    let ov = root.querySelector('.cmp-overlay');
    if (!ov) { ov = el('div', 'cmp-overlay'); ov.addEventListener('click', (e) => { if (e.target === ov) closeCompare(); }); root.appendChild(ov); document.addEventListener('keydown', cmpKey); }
    ov.innerHTML = '';
    const modal = el('div', 'cmp-modal'); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', 'Compare vehicles');
    const opts = primaryOpts();
    const metrics = compareIds.map(carMetrics);
    const best = {};
    for (const row of COMPARE_ROWS) {
      const vals = metrics.map((m) => (m ? m.out[row.id]?.value : null));
      const valid = vals.filter((v) => v != null);
      if (valid.length < 2) continue; // no winner to mark with a single car
      const target = row.dir === 'low' ? Math.min(...valid) : Math.max(...valid);
      best[row.id] = vals.map((v) => v != null && v === target);
    }
    const cell = (cls, html) => { const c = el('div', cls); if (html != null) c.innerHTML = html; return c; };
    const hd = el('div', 'cmp-hd');
    const title = el('div', 'cmp-title'); title.innerHTML = `<span class="cmp-eyebrow">${brand.mark}</span>Compare the range`;
    const x = el('button', 'cmp-x'); x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', 'Close comparison'); x.addEventListener('click', closeCompare);
    hd.append(title, x); modal.appendChild(hd);

    const wrap = el('div', 'cmp-scroll');
    // responsive columns (inline, so shrink them ourselves on small screens)
    const narrow = (window.innerWidth || 1024) < 560;
    const carW = narrow ? 126 : 148, labW = narrow ? 62 : 84;
    const grid = el('div', 'cmp-grid'); grid.style.gridTemplateColumns = `${labW}px repeat(${compareIds.length}, ${carW}px)`;
    // picker row
    grid.appendChild(cell('cmp-lbl', ''));
    compareIds.forEach((id, i) => {
      const c = el('div', 'cmp-pick');
      const sel = el('select', 'cmp-select'); sel.setAttribute('aria-label', `Vehicle ${i + 1}`);
      for (const o of opts) { const op = el('option'); op.value = o.id; op.textContent = o.label; if (o.id === id) op.selected = true; sel.appendChild(op); }
      sel.addEventListener('change', () => { compareIds[i] = sel.value; renderCompare(i); });
      c.appendChild(sel);
      if (compareIds.length > 2) { const rm = el('button', 'cmp-rm'); rm.type = 'button'; rm.textContent = '✕'; rm.setAttribute('aria-label', 'Remove vehicle'); rm.addEventListener('click', () => { compareIds.splice(i, 1); renderCompare(Math.min(i, compareIds.length - 1)); }); c.appendChild(rm); }
      grid.appendChild(c);
    });
    // image row
    grid.appendChild(cell('cmp-lbl', ''));
    compareIds.forEach((id) => { const c = el('div', 'cmp-img'); if (imgUrl[id]) { const im = el('img'); im.src = imgUrl[id]; im.alt = ''; c.appendChild(im); } else c.innerHTML = placeholderSVG(id); grid.appendChild(c); });
    // name row (mark the shopper's current build so there's a "you are here" anchor)
    grid.appendChild(cell('cmp-lbl', ''));
    compareIds.forEach((id) => { const o = opts.find((x) => x.id === id); grid.appendChild(cell('cmp-name', ((o && o.label) || id) + (id === state[primary.id] ? '<span class="cmp-current">Your build</span>' : ''))); });
    // metric rows (the "From" price is the headline figure — give it accent weight)
    for (const row of COMPARE_ROWS) {
      grid.appendChild(cell('cmp-lbl', row.label));
      compareIds.forEach((id, i) => { const m = metrics[i]; const o = m && m.out[row.id]; const cls = 'cmp-val' + (row.id === 'otr' ? ' cmp-price' : '') + (best[row.id] && best[row.id][i] ? ' is-best' : ''); grid.appendChild(cell(cls, o ? fmt(o) : '—')); });
    }
    // configure row
    grid.appendChild(cell('cmp-lbl', ''));
    compareIds.forEach((id) => { const c = el('div', 'cmp-cfg'); const b = el('button', 'cmp-configure'); b.type = 'button'; b.textContent = 'Configure ▸'; b.addEventListener('click', () => { setField(primary.id, id); closeCompare(); }); c.appendChild(b); grid.appendChild(c); });
    wrap.appendChild(grid);
    if (compareIds.length < 4) { const add = el('button', 'cmp-add'); add.type = 'button'; add.textContent = '+ Add a vehicle'; add.addEventListener('click', () => { const a = opts.map((o) => o.id).find((id) => !compareIds.includes(id)) || opts[0].id; compareIds.push(a); renderCompare(compareIds.length - 1); }); wrap.appendChild(add); }
    modal.appendChild(wrap);
    ov.appendChild(modal);
    // horizontal-scroll affordance when the grid is wider than the modal (mobile)
    if (wrap.scrollWidth > wrap.clientWidth + 2) { const hint = el('div', 'cmp-hint'); hint.textContent = '‹ swipe to compare ›'; hint.setAttribute('aria-hidden', 'true'); modal.appendChild(hint); }
    // focus: into the dialog on open; back onto the rebuilt picker after an edit
    if (focusReq === 'init') { modal.tabIndex = -1; modal.focus(); }
    else if (typeof focusReq === 'number') { const sels = ov.querySelectorAll('.cmp-select'); (sels[Math.min(focusReq, sels.length - 1)] || modal).focus(); }
  }

  // ---------- itemised breakdown ("Request this build") ----------
  // Model-driven & domain-agnostic: reads the model's own price outputs (subtotal +
  // total), walks the config from its base one field at a time (so forced knock-on
  // changes are captured and the lines sum EXACTLY to the total), itemises every
  // choice, every selected multichoice option at its solo cost, every active bundle
  // as a saving, and the total−subtotal gap as fees. No hard-coded pricing.
  const optLabel = (f, id) => { const o = (f && f.options || []).find((x) => x.id === id); return (o && o.label) || id; };
  function buildBreakdown() {
    const em = emOutput();
    const veh = ir.outputs.find((o) => /price/i.test(o.id) && o.id !== em.id) || null;   // subtotal (pre-fees)
    const priceId = veh ? veh.id : em.id;
    const val = (cfg, oid) => { const r = compute(cfg); const o = r.out[oid]; return o ? o.value : 0; };
    const pkgF = ir.fields.find((f) => f.type === 'multichoice');
    const total = val(state, em.id);
    const baseCfg = baseConfigFor(state[primary.id]);
    const primaryLabel = optLabel(modelFieldById[primary.id], state[primary.id]);
    const baseSub = val(baseCfg, priceId);
    const items = [];
    let cfg = { ...baseCfg };
    for (const f of ir.fields) {                          // choice fields, incremental from base
      if (f.id === primary.id || f.type !== 'choice') continue;
      const sel = state[f.id]; const baseOpt = (f.defaultRaw ?? f.options[0].id);
      if (sel === baseOpt) { cfg[f.id] = sel; continue; }
      const before = val(cfg, priceId); cfg = { ...cfg, [f.id]: sel }; const after = val(cfg, priceId);
      if (Math.round(after - before) !== 0) items.push({ label: `${f.label} · ${optLabel(f, sel)}`, amount: after - before });
    }
    const savings = [];
    if (pkgF) {                                           // packages: incremental in option order (respects deps)
      const chosen = new Set(state[pkgF.id] || []);
      const prefix = []; const seen = new Set();
      for (const o of pkgF.options) {
        if (!chosen.has(o.id)) continue;
        const before = val({ ...cfg, [pkgF.id]: [...prefix] }, priceId);
        prefix.push(o.id);
        let delta = val({ ...cfg, [pkgF.id]: [...prefix] }, priceId) - before;
        // if adding this option newly completes a bundle, add its discount back so the
        // option reads at its gross price and the saving shows as its own line
        for (const b of (model.bundles || [])) if (!seen.has(b.id) && b.requires.every((r) => prefix.includes(r))) { delta += b.discount; savings.push({ label: b.label, amount: -b.discount }); seen.add(b.id); }
        if (Math.round(delta) !== 0) items.push({ label: optLabel(pkgF, o.id), amount: delta });
      }
    }
    const fees = veh ? total - val(state, veh.id) : 0;
    return { primaryLabel, baseSub, items, savings, fees, total, hasSub: !!veh, totalLabel: em.label || 'Total' };
  }

  let bdOpener = null;
  function openBreakdown() { bdOpener = document.activeElement; shell.inert = true; renderBreakdown(); }
  function closeBreakdown() { shell.inert = false; const ov = root.querySelector('.bd-overlay'); if (ov) ov.remove(); document.removeEventListener('keydown', bdKey); if (bdOpener && bdOpener.focus) bdOpener.focus(); bdOpener = null; }
  function bdKey(e) { if (e.key === 'Escape') closeBreakdown(); }
  function renderBreakdown() {
    const b = buildBreakdown();
    const ov = el('div', 'bd-overlay'); ov.addEventListener('click', (e) => { if (e.target === ov) closeBreakdown(); });
    root.appendChild(ov); document.addEventListener('keydown', bdKey);
    const modal = el('div', 'bd-modal'); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', b.primaryLabel + ' build summary');
    const hd = el('div', 'bd-hd');
    hd.innerHTML = `<div class="bd-title"><span class="bd-eyebrow">${brand.mark}</span>${b.primaryLabel}</div>`;
    const x = el('button', 'bd-x'); x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', 'Close summary'); x.addEventListener('click', closeBreakdown);
    hd.appendChild(x); modal.appendChild(hd);
    const body = el('div', 'bd-body');
    const row = (label, amount, cls) => { const r = el('div', 'bd-row' + (cls ? ' ' + cls : '')); r.innerHTML = `<span class="bd-l">${label}</span><span class="bd-a num">${amount}</span>`; body.appendChild(r); };
    row(b.primaryLabel + ' · Base specification', money0(b.baseSub), 'bd-base');
    for (const it of b.items) row(it.label, (it.amount > 0 ? '+' : '−') + money0(Math.abs(it.amount)), it.amount < 0 ? 'bd-save' : '');
    for (const s of b.savings) row(s.label, '−' + money0(Math.abs(s.amount)), 'bd-save');
    if (b.hasSub && Math.round(b.fees) !== 0) row(b.totalLabel === 'Total' ? 'Fees' : 'Fees & taxes', (b.fees > 0 ? '+' : '−') + money0(Math.abs(b.fees)), 'bd-fees');
    modal.appendChild(body);
    const foot = el('div', 'bd-foot');
    foot.innerHTML = `<div class="bd-total"><span>${b.totalLabel}</span><span class="num">${money0(b.total)}</span></div>`;
    const cta = el('button', 'bd-cta'); cta.type = 'button'; cta.textContent = brand.cta || 'Request this build ▸';
    cta.addEventListener('click', () => { cta.disabled = true; cta.textContent = 'Request submitted ✓'; setTimeout(closeBreakdown, 1500); });
    foot.appendChild(cta); modal.appendChild(foot);
    ov.appendChild(modal);
    modal.tabIndex = -1; modal.focus();
  }

  // Build the deck cards ONCE (so CSS can animate their transforms between renders);
  // fromPrice() is computed here, once per card, not on every re-render.
  let deckCards = null;
  function buildDeck() {
    deckTrack.querySelectorAll('.deck-card').forEach((n) => n.remove());
    deckCards = {};
    for (const o of primaryOpts()) {
      const b = el('button', 'deck-card'); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.id = o.id;
      b.innerHTML = `<div class="dc-img">${carVisual(o.id, { colour: state.colour, wheels: 'w17' })}</div>`
        + `<div class="dc-cap"><div class="dc-name">${o.label || o.id}</div><div class="dc-from">from <b>${money0(fromPrice(o.id))}</b></div></div>`;
      b.addEventListener('click', () => { setField(primary.id, o.id); b.focus({ preventScroll: true }); });
      deckTrack.appendChild(b); deckCards[o.id] = b;
    }
  }
  // Position every card by its signed circular offset from the centred (selected) car.
  // |off|<=2 are visible & animate; |off|===3 is an off-stage buffer (still animates, so
  // edges slide in/out); |off|===4 (the antipode) snaps with no transform transition, so
  // the wrap-around never streaks across the deck.
  function positionDeck() {
    const opts = primaryOpts(); const n = opts.length;
    const centerIdx = Math.max(0, opts.findIndex((o) => o.id === state[primary.id]));
    opts.forEach((o, i) => {
      const card = deckCards[o.id]; if (!card) return;
      if (imgUrl[o.id] && !card.querySelector('img')) { const dci = card.querySelector('.dc-img'); if (dci) dci.innerHTML = `<img class="carimg" src="${imgUrl[o.id]}" alt="">`; }
      let off = ((i - centerIdx) % n + n) % n; if (off > n / 2) off -= n;
      const a = Math.abs(off), dir = Math.sign(off), hidden = a >= 3;
      card.classList.toggle('is-center', off === 0);
      card.style.opacity = hidden ? '0' : a === 2 ? '.46' : a === 1 ? '.9' : '1';
      // off-stage cards are hidden VISUALLY only (opacity/pointer-events) — they stay
      // in the a11y tree so the radiogroup always exposes the full range of options.
      card.style.pointerEvents = hidden ? 'none' : 'auto';
      card.setAttribute('aria-checked', String(off === 0));
      card.tabIndex = off === 0 ? 0 : -1;
      card.style.zIndex = String(40 - a * 8);
      card.style.transitionProperty = a >= 4 ? 'opacity' : 'transform, opacity';
      const x = off === 0 ? 0 : dir * (128 + (a - 1) * 82);
      const rot = off === 0 ? 0 : -dir * Math.min(46, 30 + (a - 1) * 8);
      const sc = off === 0 ? 1 : a === 1 ? 0.84 : a === 2 ? 0.66 : 0.56;
      const lift = off === 0 ? -6 : 0;
      card.style.transform = `translate(-50%, calc(-50% + ${lift}px)) translateX(${x}px) rotateY(${rot}deg) scale(${sc})`;
    });
  }
  function renderDeck() { if (!deckCards) buildDeck(); positionDeck(); }

  function buildPodium() {
    const p = el('div', 'podium');
    const disc = el('div', 'disc');
    const carwrap = el('div', 'carwrap'); carwrap.innerHTML = carVisual(state[primary.id], { colour: state.colour, wheels: state.wheels });
    const refl = el('div', 'reflection'); refl.innerHTML = carVisual(state[primary.id], { colour: state.colour, wheels: state.wheels }); carwrap.appendChild(refl);
    const badges = el('div', 'badges');
    for (const [id, label] of [['performance', 'Performance'], ['panoramicRoof', 'Panoramic roof'], ['towing', 'Tow package']]) if ((state.packages || []).includes(id)) { const s = el('span', 'badge'); s.textContent = label; badges.appendChild(s); }
    p.append(disc, carwrap, badges); return p;
  }
  let stageModel = null;
  function renderStage() {
    const podiums = [...turntable.querySelectorAll('.podium')]; while (podiums.length > 1) podiums.shift().remove();
    const outgoing = turntable.querySelector('.podium');
    if (stageModel === state[primary.id]) { const np = buildPodium(); if (outgoing) turntable.replaceChild(np, outgoing); else turntable.appendChild(np); return; }
    const incoming = buildPodium(); turntable.appendChild(incoming);
    if (!RM && outgoing) {
      outgoing.style.zIndex = '1'; incoming.style.zIndex = '2';
      const kill = () => outgoing.remove();
      const a = outgoing.animate([{ transform: 'rotateY(0deg)', opacity: 1 }, { transform: 'rotateY(-108deg)', opacity: 0 }], { duration: 520, easing: 'cubic-bezier(.55,.06,.4,1)', fill: 'forwards' });
      a.onfinish = kill; a.oncancel = kill; setTimeout(kill, 900);
      incoming.animate([{ transform: 'rotateY(108deg)', opacity: 0 }, { transform: 'rotateY(0deg)', opacity: 1 }], { duration: 580, easing: 'cubic-bezier(.2,.7,.2,1)' });
    } else if (outgoing) { outgoing.remove(); }
    stageModel = state[primary.id];
  }

  let prevOtr = null;
  function renderRail(res) {
    const opt = primaryOpts().find((o) => o.id === state[primary.id]) || {};
    $('sh-marque').textContent = brand.mark + ' · ' + (opt.label || state[primary.id]).toUpperCase();
    $('sh-name').textContent = opt.label || state[primary.id];
    const bits = ir.fields.filter((f) => f.type === 'choice' && f.id !== primary.id).slice(0, 2).map((f) => { const o = f.options.find((x) => x.id === state[f.id]); return o ? (o.label || o.id) : null; }).filter(Boolean);
    $('sh-sub').textContent = bits.join(' · ');
    const emOut = ir.outputs.find((o) => emphasis.has(o.id)) || ir.outputs[0];
    const veh = ir.outputs.find((o) => /price/i.test(o.id) && o.id !== emOut.id);
    $('sh-veh').textContent = veh ? (res.out[veh.id].label + ' ' + fmt(res.out[veh.id])) : '';
    // the plate gauge shows only for a model that declares one (gaugeMax); its bar
    // scales to that declared maximum — no domain-specific constant.
    const g = gaugeMeta && res.out[gaugeMeta.id] && res.out[gaugeMeta.id].visible ? gaugeMeta : null;
    $('sh-gauge').style.display = g ? 'flex' : 'none';
    if (g) { $('sh-range').textContent = fmt(res.out[g.id]); $('sh-rangebar').style.width = Math.min(100, (res.out[g.id].value / g.gaugeMax) * 100) + '%'; }
    else { $('sh-range').textContent = ''; $('sh-rangebar').style.width = '0'; }
    $('sh-otr-label').textContent = emOut.label || 'Total';
    const otrStr = fmt(res.out[emOut.id]); const otrEl = $('sh-otr');
    if (!RM && prevOtr !== null && prevOtr !== otrStr) otrEl.animate([{ transform: 'translateY(-6px)', opacity: .3 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(.2,.7,.2,1)' });
    otrEl.textContent = otrStr; prevOtr = otrStr;
    const mo = ir.outputs.find((o) => /month/i.test(o.id)); const rec = mo && res.out[mo.id];
    $('sh-monthly').innerHTML = rec && rec.visible ? `from <b>${fmt(rec)}</b> / mo` : '';
    // spec sheet: the model's declared headline figures (read-only)
    const shownSpecs = specIds.filter((id) => res.out[id] && res.out[id].visible);
    $('sh-specsheet').innerHTML = shownSpecs.map((id) => { const o = res.out[id]; return `<div class="spec"><span class="spec-v num">${fmt(o)}</span><span class="spec-l">${o.label}</span></div>`; }).join('');
    const sav = activeSavings();
    $('sh-savings').innerHTML = sav > 0 ? `Bundle savings <b class="num">−${money0(sav)}</b>` : '';
  }

  // Selecting a model keeps the other fields as-is; the engine (or any field) that
  // becomes invalid for the new model is corrected by the VM's own availability
  // fallback during evaluation, so state stays valid without domain-specific code.
  function setField(id, v) { state[id] = v; render(); }
  function render() {
    const res = compute(state); Object.assign(state, res.st);
    renderDeck(); renderStage(); renderRail(res); renderSpecs(res);
  }

  $('sh-cta').textContent = brand.cta || 'Request this build ▸';
  $('sh-cta').setAttribute('aria-haspopup', 'dialog');
  $('sh-cta').addEventListener('click', openBreakdown);

  render();
  // resolve associated images and TEST-LOAD each independently — repaint as each
  // one arrives (so the default car shows first, not after all 8), and a missing
  // image simply never loads, leaving its silhouette (no broken icons).
  for (const o of primaryOpts()) {
    if (!o.image) continue;
    resolveImage(o.image).then((u) => {
      if (!u) return;
      const im = new Image();
      im.onload = () => { imgUrl[o.id] = u; render(); }; // in-place repaint (no re-swap)
      im.src = u;
    }).catch(() => {});
  }

  return { recompute: render };
}
