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
  brand = brand || { mark: 'ROWBLAA', rest: 'LUXURY EXPERIENCES', tagline: '' };
  resolveImage = resolveImage || (async () => null);
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const modelFieldById = Object.fromEntries(model.fields.map((f) => [f.id, f]));
  const slotToField = Object.fromEntries(ir.fields.map((f) => [f.slot, f.id]));
  const emphasis = new Set((model.outputs || []).filter((o) => o.emphasis).map((o) => o.id));
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

  // ---------- car visuals (image asset, else silhouette) ----------
  const PAINT = { solid: ['#8a9099', '#6d737c'], metallic: ['#aeb7c4', '#7c8794'], premium: ['#3a4c6b', '#243149'], matte: ['#4a4d52', '#3a3d42'] };
  // silhouette fallback per model id (used only until an image is attached)
  const CAR_SHAPE = { hotHatch: 'hatch', sleekEstate: 'sedan', gtCoupe: 'coupe', ruggedOffroader: 'suv', luxuryPickup: 'suv', flagshipSuv: 'suv', midSupercar: 'coupe', hypercar: 'coupe' };
  const carType = (id) => CAR_SHAPE[id] || 'sedan';
  function carSVG(type, opts = {}) {
    const paint = PAINT[opts.colour] || PAINT.solid, gid = 'g' + Math.random().toString(36).slice(2, 7);
    const wheelR = { w17: 20, w18: 22, w19: 24, w20: 26 }[opts.wheels] || 20;
    const lift = type === 'suv' ? 12 : type === 'hatch' ? 3 : 0;
    const bodies = { hatch: 'M40 92 Q46 66 78 62 L120 40 Q140 30 168 32 L214 34 Q236 36 248 56 L300 66 Q330 72 336 92 Z', sedan: 'M30 94 Q38 70 92 66 L150 38 Q176 26 226 30 L286 34 Q322 40 338 62 L372 74 Q384 80 382 94 Z', suv: 'M36 90 Q40 58 74 56 L110 32 Q128 22 170 24 L240 26 Q272 28 286 52 L330 60 Q352 66 352 90 Z', coupe: 'M26 96 Q36 78 96 74 L156 48 Q192 30 244 36 L306 44 Q346 50 360 70 L382 82 Q390 88 386 96 Z' };
    const glass = { hatch: 'M92 62 L126 44 Q142 37 164 39 L206 41 Q220 43 230 58 Z', sedan: 'M104 64 L156 42 Q178 33 220 36 L270 39 Q292 43 300 60 Z', suv: 'M96 56 L122 36 Q136 28 168 30 L234 32 Q258 34 268 54 Z', coupe: 'M118 72 L160 50 Q194 36 236 41 L282 46 Q300 52 306 70 Z' };
    const wx = type === 'sedan' ? [110, 300] : type === 'suv' ? [104, 300] : type === 'coupe' ? [112, 306] : [104, 292];
    const wy = 96 - lift, wheel = (cx) => `<g transform="translate(${cx} ${wy})"><circle r="${wheelR}" fill="#111316" stroke="#2a2d33" stroke-width="2"/><circle r="${wheelR * 0.55}" fill="#1a1d22" stroke="#3a3f47" stroke-width="1.5"/><circle r="${wheelR * 0.16}" fill="#4a4f58"/></g>`;
    return `<svg viewBox="0 0 400 130" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${paint[0]}"/><stop offset="1" stop-color="${paint[1]}"/></linearGradient></defs><g transform="translate(0 ${-lift})"><path d="${bodies[type]}" fill="url(#${gid})" stroke="rgba(0,0,0,.35)" stroke-width="1"/><path d="${glass[type]}" fill="#10151c" opacity=".85"/><path d="${bodies[type]}" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="1"/></g>${wheel(wx[0])}${wheel(wx[1])}</svg>`;
  }
  const imgUrl = {}; // primary optionId -> resolved image URL
  function carVisual(optId, opts) {
    if (imgUrl[optId]) return `<img class="carimg" src="${imgUrl[optId]}" alt="">`;
    return carSVG(carType(optId), opts);
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
  // "from" = the genuine entry price: base/default config with the cheapest AVAILABLE engine
  const fromPrice = (id) => {
    const em = emOutput();
    const engField = ir.fields.find((f) => f.id === 'engine');
    const engines = engField ? engField.options.map((o) => o.id) : [null];
    let best = Infinity;
    for (const e of engines) {
      const base = Object.assign(defaultsConfig(), { [primary.id]: id, packages: [], financing: 'cash' });
      if (e) base.engine = e;
      const r = compute(base);
      if (e && r.avail.engine && r.avail.engine[e] === false) continue;
      best = Math.min(best, r.out[em.id].value);
    }
    return best === Infinity ? compute(Object.assign(defaultsConfig(), { [primary.id]: id })).out[em.id].value : best;
  };

  // ---------- shell ----------
  root.innerHTML = '';
  const shell = el('div', 'vdm');
  const hd = el('header', 'hd');
  const brandEl = el('div', 'brand'); brandEl.innerHTML = `<b>${brand.mark}</b> ${brand.rest || ''}`.trim();
  const tagEl = el('div', 'tag'); tagEl.textContent = brand.tagline || '';
  hd.appendChild(brandEl);
  if (links && links.length) { const nav = el('nav', 'sh-nav'); nav.setAttribute('aria-label', 'Edit'); for (const l of links) { const a = el('a'); a.href = l.href; a.textContent = l.label; nav.appendChild(a); } hd.appendChild(nav); }
  hd.appendChild(tagEl);
  const body = el('div', 'body');
  const stage = el('section', 'stage'); stage.setAttribute('aria-label', 'Showroom stage');
  const turntable = el('div', 'turntable');
  const dock = el('div', 'dock'); dock.setAttribute('role', 'radiogroup'); dock.setAttribute('aria-label', 'Choose a model');
  const dockLabel = el('span', 'dock-label'); dockLabel.textContent = 'The range'; dock.appendChild(dockLabel);
  stage.append(turntable, dock);
  const rail = el('aside', 'rail'); rail.setAttribute('aria-label', 'Specification');
  rail.innerHTML = `<div class="rail-hd"><div class="marque" id="sh-marque"></div><h1 id="sh-name">—</h1><div class="sub" id="sh-sub"></div></div>
    <div class="specsheet" id="sh-specsheet"></div>
    <div class="rail-body" id="sh-specs"></div>
    <div class="plate"><div class="micro"><span id="sh-veh">—</span><span style="display:flex;align-items:center;gap:8px"><span id="sh-range" class="num">—</span><span class="gauge"><i id="sh-rangebar" style="width:0"></i></span></span></div>
      <div class="otr-label">On-the-road</div><div class="otr"><span class="fig num" id="sh-otr">—</span></div>
      <div class="monthly" id="sh-monthly"></div><button class="cta" id="sh-cta">Request this build ▸</button></div>`;
  body.append(stage, rail);
  shell.append(hd, body);
  root.appendChild(shell);
  const $ = (id) => root.querySelector('#' + id);

  // ---------- controls (chips / powertrain / swatch / stepper) ----------
  function chip(label, delta, checked, disabled, onClick, extra) {
    const b = el('button', 'chip'); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(checked)); if (disabled) b.disabled = true;
    b.innerHTML = (extra || '') + `<span>${label}</span>` + (delta ? `<span class="cd num">${delta}</span>` : '');
    b.addEventListener('click', onClick); return b;
  }
  const deltaStr = (d) => (d ? '+' + money0(d) : '');

  function renderField(f, res) {
    const mf = modelFieldById[f.id];
    const wrap = el('div', 'field');
    const lab = el('div', 'flabel'); lab.innerHTML = `<span>${f.label || f.id}</span>` + (res.forced[f.id] ? '<span class="auto">Auto</span>' : '');
    wrap.appendChild(lab);
    const av = res.avail[f.id] || {};
    if (f.type === 'choice' && f.control === 'radio') {
      const list = el('div', 'plist');
      for (const o of f.options) {
        const b = el('button', 'prow'); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(state[f.id] === o.id)); if (av[o.id] === false) b.disabled = true;
        b.innerHTML = `<span class="rd"></span><span><span class="pn">${o.label || o.id}</span></span><span class="pd num">${deltaStr(o.priceDelta)}</span>`;
        b.addEventListener('click', () => setField(f.id, o.id)); list.appendChild(b);
      }
      wrap.appendChild(list);
    } else if (f.type === 'choice') {
      const box = el('div', 'chips');
      for (const o of f.options) {
        const swatch = f.id === 'colour' ? `<span class="dot" style="background:linear-gradient(135deg,${(PAINT[o.id] || PAINT.solid).join(',')})"></span>` : '';
        const glyph = f.id === 'wheels' ? `<span class="glyph" style="width:${10 + f.options.indexOf(o) * 2}px;height:${10 + f.options.indexOf(o) * 2}px"></span>` : '';
        box.appendChild(chip(o.label || o.id, deltaStr(o.priceDelta), state[f.id] === o.id, av[o.id] === false, () => setField(f.id, o.id), swatch + glyph));
      }
      wrap.appendChild(box);
    } else if (f.type === 'multichoice') {
      const box = el('div', 'chips');
      for (const o of f.options) {
        const on = (state[f.id] || []).includes(o.id);
        const b = chip(o.label || o.id, deltaStr(o.priceDelta), on, av[o.id] === false && !on, () => { const s = new Set(state[f.id] || []); s.has(o.id) ? s.delete(o.id) : s.add(o.id); setField(f.id, [...s]); });
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
  }

  function renderDock() {
    dock.querySelectorAll('.car-card').forEach((n) => n.remove());
    for (const o of primaryOpts()) {
      const b = el('button', 'car-card'); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(state[primary.id] === o.id));
      b.innerHTML = carVisual(o.id, { colour: state.colour, wheels: 'w17' }) + `<div class="cname">${o.label || o.id}</div><div class="cfrom">from <b>${money0(fromPrice(o.id))}</b></div>`;
      b.addEventListener('click', () => setField(primary.id, o.id));
      dock.appendChild(b);
    }
  }

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
    const range = ir.outputs.find((o) => (res.out[o.id].fmt || {}).format === 'unit');
    if (range) { $('sh-range').textContent = fmt(res.out[range.id]); $('sh-rangebar').style.width = Math.min(100, (res.out[range.id].value / 520) * 100) + '%'; } else { $('sh-range').textContent = ''; }
    const otrStr = fmt(res.out[emOut.id]); const otrEl = $('sh-otr');
    if (!RM && prevOtr !== null && prevOtr !== otrStr) otrEl.animate([{ transform: 'translateY(-6px)', opacity: .3 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(.2,.7,.2,1)' });
    otrEl.textContent = otrStr; prevOtr = otrStr;
    const mo = ir.outputs.find((o) => /month/i.test(o.id)); const rec = mo && res.out[mo.id];
    $('sh-monthly').innerHTML = rec && rec.visible ? `from <b>${fmt(rec)}</b> / mo` : '';
    // spec sheet: headline figures (read-only)
    const specIds = ['hp', 'topSpeed', 'zeroToSixty', 'range'].filter((id) => res.out[id] && res.out[id].visible);
    $('sh-specsheet').innerHTML = specIds.map((id) => { const o = res.out[id]; return `<div class="spec"><span class="spec-v num">${fmt(o)}</span><span class="spec-l">${o.label}</span></div>`; }).join('');
  }

  function setField(id, v) { state[id] = v; render(); }
  function render() {
    const res = compute(state); Object.assign(state, res.st);
    renderDock(); renderStage(); renderRail(res); renderSpecs(res);
  }

  $('sh-cta').addEventListener('click', () => { const res = compute(state); const emOut = ir.outputs.find((o) => emphasis.has(o.id)) || ir.outputs[0]; $('sh-cta').textContent = 'Enquiry drafted — ' + fmt(res.out[emOut.id]) + ' ✓'; setTimeout(() => { $('sh-cta').textContent = 'Request this build ▸'; }, 2200); });

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
