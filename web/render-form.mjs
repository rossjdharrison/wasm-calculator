// =============================================================================
// render-form.mjs — the reusable Configurator renderer.
//
// mountConfigurator(root, { model, ir, engine, onEdit }) renders the real quote
// form from a model + assembled IR + a loaded wasm engine, drives it live, and
// paints results. It powers the Presentation editor's WYSIWYG preview and the
// journey's downstream-capture step. (The public Configurator uses the richer
// showroom-view; this plain form still reflects the same presentation affordances
// — option swatch/badge, field render mode, output role — so preview edits show.)
//
// `onEdit(kind, id)` (optional) makes the form click-to-edit: clicking a field,
// section title, or output calls it. `highlight(kind, id)` rings the matching
// element. Emits the stable qc-* DOM contract.
// =============================================================================

import { formatOutput } from './ui.mjs';
import { decodeValue } from './assembler.mjs';

const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
const setChecked = (b, on) => { b.setAttribute('aria-checked', on ? 'true' : 'false'); b.classList.toggle('is-selected', on); };
const setPressed = (b, on) => { b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('is-selected', on); };

export function mountConfigurator(root, { model, ir, engine, onEdit, initialConfig, lockedFields, onConfigChange, onRequest, ctaLabel }) {
  const controls = {}, wraps = {}, errs = {}, outEls = {}, secEls = {};
  // fields written by an upstream binding (single-authority): rendered disabled +
  // seeded from the injected value, and never editable. Optional/domain-agnostic.
  const lockedSet = lockedFields instanceof Set ? lockedFields : new Set(lockedFields || []);
  // merged-model fields carry the presentation affordances (render mode + per-option
  // swatch/badge) that the IR omits; the preview reflects them so authoring shows.
  const mfById = Object.fromEntries((model.fields || []).map((f) => [f.id, f]));
  let messagesEl;

  const editable = (node, kind, id) => {
    if (!onEdit) return;
    node.classList.add('qc-editable');
    node.addEventListener('click', () => onEdit(kind, id));
  };

  root.innerHTML = '';
  const form = el('form', 'qc');
  form.dataset.model = model.id;
  form.setAttribute('autocomplete', 'off');
  form.addEventListener('submit', (e) => e.preventDefault());

  const formCol = el('div', 'qc-form');
  const sections = [...(model.sections || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const sectionBodies = {};
  const noSection = el('div', 'qc-section__body');
  for (const s of sections) {
    const sec = el('section', 'qc-section'); sec.dataset.section = s.id;
    const h = el('h2', 'qc-section__title'); h.textContent = s.label; editable(h, 'section', s.id); sec.appendChild(h);
    const body = el('div', 'qc-section__body'); sec.appendChild(body);
    sectionBodies[s.id] = body; secEls[s.id] = sec;
    formCol.appendChild(sec);
  }

  for (const f of ir.fields) {
    const wrap = el('div', `qc-field qc-field--${f.type} qc-field--w-${f.width}` + (lockedSet.has(f.id) ? ' qc-field--locked' : ''));
    wrap.dataset.field = f.id; wrap.dataset.type = f.type;
    if (f.control) wrap.dataset.control = f.control;
    wrap.dataset.width = f.width;
    if (mfById[f.id] && mfById[f.id].render) wrap.dataset.render = mfById[f.id].render;
    const lab = el('label', 'qc-field__label'); lab.id = `lbl-${model.id}-${f.id}`; lab.textContent = f.label; wrap.appendChild(lab);
    const controlWrap = el('div', 'qc-field__control');
    const c = makeControl(f, recompute);
    c.root.setAttribute('aria-labelledby', lab.id);
    if (c.root.matches('.qc-checks, .qc-number, .qc-stepper')) c.root.setAttribute('role', 'group');
    c.root.querySelectorAll('.qc-select, .qc-input, .qc-switch input').forEach((inp) => inp.setAttribute('aria-labelledby', lab.id));
    controlWrap.appendChild(c.root);
    wrap.appendChild(controlWrap);
    const err = el('div', 'qc-field__error'); err.hidden = true; wrap.appendChild(err);
    controls[f.id] = c; wraps[f.id] = wrap; errs[f.id] = err;
    editable(wrap, 'field', f.id);
    (sectionBodies[f.section] || noSection).appendChild(wrap);
  }
  if (noSection.childNodes.length) formCol.appendChild(noSection);

  const summary = el('aside', 'qc-summary'); summary.setAttribute('aria-live', 'polite');
  messagesEl = el('div', 'qc-messages'); messagesEl.dataset.role = 'messages';
  summary.appendChild(messagesEl);
  const outputs = el('div', 'qc-outputs');
  const emphasis = new Set((model.outputs || []).filter((o) => o.emphasis).map((o) => o.id));
  for (const o of ir.outputs) {
    const ow = el('div', 'qc-output' + (emphasis.has(o.id) ? ' qc-total' : '') + (o.role ? ' qc-role-' + o.role : ''));
    ow.dataset.output = o.id; ow.dataset.format = o.formatType; if (o.role) ow.dataset.role = o.role;
    const ol = el('span', 'qc-output__label'); ol.textContent = o.label;
    const ov = el('span', 'qc-output__value'); ov.dataset.role = 'value';
    ow.append(ol, ov); outputs.appendChild(ow);
    outEls[o.id] = { wrap: ow, value: ov };
    editable(ow, 'output', o.id);
  }
  summary.appendChild(outputs);
  // optional CTA (journey downstream capture): advance the sale with the current inputs.
  if (onRequest) { const cta = el('button', 'qc-cta'); cta.type = 'button'; cta.textContent = ctaLabel || 'Confirm ▸'; cta.addEventListener('click', () => onRequest(readInputs())); summary.appendChild(cta); }
  form.append(formCol, summary);
  root.appendChild(form);

  // ---- controls ----
  function makeControl(field, onChange) {
    if (field.type === 'choice') {
      if (field.control === 'dropdown') return selectControl(field, onChange);
      if (field.control === 'radio') return radioControl(field, onChange);
      return buttonGroup(field, false, onChange);
    }
    if (field.type === 'multichoice') return field.control === 'checkboxes' ? checkboxControl(field, onChange) : buttonGroup(field, true, onChange);
    if (field.type === 'boolean') return switchControl(field, onChange);
    return numberControl(field, field.control === 'stepper', onChange);
  }
  function buttonGroup(field, multi, onChange) {
    const wrap = el('div', 'qc-buttons' + (multi ? ' qc-buttons--multi' : '')); wrap.setAttribute('role', multi ? 'group' : 'radiogroup');
    const btns = {};
    const mf = mfById[field.id] || {};
    for (const o of field.options) {
      const b = el('button', 'qc-button qc-option'); b.type = 'button'; b.dataset.value = o.id;
      const mo = (mf.options || []).find((x) => x.id === o.id) || {};
      const sw = (mf.render === 'swatch' && Array.isArray(mo.swatch)) ? `<span class="qc-swatch" style="background:linear-gradient(135deg,${mo.swatch.join(',')})"></span>` : '';
      const bdg = (multi && mo.badge) ? '<span class="qc-badge" title="Featured">★</span>' : '';
      b.innerHTML = sw + `<span>${o.label}</span>` + bdg;
      b.setAttribute(multi ? 'aria-pressed' : 'aria-checked', 'false');
      b.addEventListener('click', () => { if (b.disabled) return; if (multi) setPressed(b, b.getAttribute('aria-pressed') !== 'true'); else { for (const x of Object.values(btns)) setChecked(x, false); setChecked(b, true); } onChange(); });
      btns[o.id] = b; wrap.appendChild(b);
    }
    return {
      root: wrap,
      read: () => multi ? field.options.filter((o) => btns[o.id].getAttribute('aria-pressed') === 'true').map((o) => o.id) : (field.options.find((o) => btns[o.id].getAttribute('aria-checked') === 'true') || field.options[0]).id,
      sync: (val) => { if (multi) { const set = new Set(val || []); for (const o of field.options) setPressed(btns[o.id], set.has(o.id)); } else for (const o of field.options) setChecked(btns[o.id], o.id === val); },
      update: (st) => { for (const o of field.options) { const dis = !st.enabled || (st.available ? !st.available[o.id] : false); btns[o.id].disabled = dis; btns[o.id].classList.toggle('is-disabled', dis); } },
    };
  }
  function radioControl(field, onChange) {
    const wrap = el('div', 'qc-radios'); wrap.setAttribute('role', 'radiogroup'); const inputs = {}; const name = `r_${model.id}_${field.id}`;
    for (const o of field.options) { const lab = el('label', 'qc-option'); const inp = el('input'); inp.type = 'radio'; inp.name = name; inp.value = o.id; const span = el('span'); span.textContent = o.label; lab.append(inp, span); wrap.appendChild(lab); inputs[o.id] = inp; inp.addEventListener('change', onChange); }
    return { root: wrap, read: () => (field.options.find((o) => inputs[o.id].checked) || field.options[0]).id, sync: (val) => { for (const o of field.options) inputs[o.id].checked = o.id === val; }, update: (st) => { for (const o of field.options) { const dis = !st.enabled || (st.available ? !st.available[o.id] : false); inputs[o.id].disabled = dis; inputs[o.id].closest('.qc-option').classList.toggle('is-disabled', dis); } } };
  }
  function selectControl(field, onChange) {
    const mf = mfById[field.id] || {};
    const sel = el('select', 'qc-select'); for (const o of field.options) { const opt = el('option'); opt.value = o.id; opt.textContent = o.label; sel.appendChild(opt); } sel.addEventListener('change', onChange);
    const base = { read: () => sel.value || field.options[0].id, update: (st) => { sel.disabled = !st.enabled; for (const opt of sel.options) opt.disabled = st.available ? !st.available[opt.value] : false; } };
    if (mf.render !== 'swatch') return { root: sel, sync: (val) => { sel.value = val; }, ...base };
    // a swatch-render dropdown shows the selected option's swatch beside the select
    const box = el('div', 'qc-swatch-select'); const dot = el('span', 'qc-swatch');
    const paint = () => { const mo = (mf.options || []).find((o) => o.id === sel.value) || {}; dot.style.background = Array.isArray(mo.swatch) ? `linear-gradient(135deg,${mo.swatch.join(',')})` : 'transparent'; };
    sel.addEventListener('change', paint); box.append(dot, sel); paint();
    return { root: box, sync: (val) => { sel.value = val; paint(); }, ...base };
  }
  function checkboxControl(field, onChange) {
    const wrap = el('div', 'qc-checks'); const inputs = {};
    for (const o of field.options) { const lab = el('label', 'qc-option'); const inp = el('input'); inp.type = 'checkbox'; inp.value = o.id; const span = el('span'); span.textContent = o.label; lab.append(inp, span); wrap.appendChild(lab); inputs[o.id] = inp; inp.addEventListener('change', onChange); }
    return { root: wrap, read: () => field.options.filter((o) => inputs[o.id].checked).map((o) => o.id), sync: (val) => { const set = new Set(val || []); for (const o of field.options) inputs[o.id].checked = set.has(o.id); }, update: (st) => { for (const o of field.options) { const dis = !st.enabled || (st.available ? !st.available[o.id] : false); inputs[o.id].disabled = dis; inputs[o.id].closest('.qc-option').classList.toggle('is-disabled', dis); } } };
  }
  function switchControl(field, onChange) {
    const lab = el('label', 'qc-switch'); const inp = el('input'); inp.type = 'checkbox'; const track = el('span', 'qc-switch__track'); lab.append(inp, track); inp.addEventListener('change', onChange);
    return { root: lab, read: () => inp.checked, sync: (val, { forced }) => { if (forced) inp.checked = !!val; }, update: (st) => { inp.disabled = !st.enabled; } };
  }
  function numberControl(field, stepper, onChange) {
    const wrap = el('div', stepper ? 'qc-stepper' : 'qc-number'); const input = el('input', 'qc-input'); input.type = 'number';
    let minus, plus, touched = false, lim = { min: null, max: null, step: null };
    const clamp = (v) => { if (lim.min != null) v = Math.max(lim.min, v); if (lim.max != null) v = Math.min(lim.max, v); return v; };
    if (stepper) {
      minus = el('button', 'qc-stepper__btn'); minus.type = 'button'; minus.textContent = '−'; minus.setAttribute('aria-label', 'decrease');
      plus = el('button', 'qc-stepper__btn'); plus.type = 'button'; plus.textContent = '+'; plus.setAttribute('aria-label', 'increase');
      const bump = (d) => { touched = true; input.value = String(clamp((Number(input.value) || 0) + d * (lim.step || 1))); onChange(); };
      minus.addEventListener('click', () => bump(-1)); plus.addEventListener('click', () => bump(1));
      wrap.append(minus, input, plus);
    } else wrap.appendChild(input);
    if (field.unit) { const u = el('span', 'qc-affix'); u.textContent = field.unit; wrap.appendChild(u); }
    input.addEventListener('input', () => { touched = true; onChange(); });
    return {
      root: wrap, read: () => Number(input.value) || 0,
      sync: (val, { forced }) => { if (forced) { input.value = String(val); touched = true; } },
      update: (st) => {
        lim = st.limits || lim;
        if (lim.min != null) input.min = lim.min; else input.removeAttribute('min');
        if (lim.max != null) input.max = lim.max; else input.removeAttribute('max');
        if (lim.step != null) input.step = lim.step; else input.removeAttribute('step');
        const dis = !st.enabled; input.disabled = dis; if (minus) minus.disabled = dis; if (plus) plus.disabled = dis;
        if (!touched && lim.min != null && (input.value === '' || Number(input.value) < lim.min)) input.value = String(lim.min);
      },
    };
  }

  // ---- reactive loop ----
  function seedDefaults() {
    for (const f of ir.fields) {
      if (f.type === 'choice') controls[f.id].sync(f.defaultRaw ?? f.options[0].id, { forced: true });
      else if (f.type === 'multichoice') controls[f.id].sync(f.defaultRaw ?? [], { forced: true });
      else if (f.type === 'boolean') controls[f.id].sync(!!f.defaultRaw, { forced: true });
      else if (f.defaultRaw != null) controls[f.id].sync(f.defaultRaw, { forced: true });
    }
    // seed any caller-supplied values over the defaults (injected/bound + resumed free inputs)
    if (initialConfig) for (const f of ir.fields) if (Object.prototype.hasOwnProperty.call(initialConfig, f.id) && initialConfig[f.id] != null) controls[f.id].sync(initialConfig[f.id], { forced: true });
  }
  const readInputs = () => { const inp = {}; for (const f of ir.fields) inp[f.id] = controls[f.id].read(); return inp; };
  function recompute() { const inp = readInputs(); paint(engine.evaluate(inp)); if (onConfigChange) onConfigChange(inp); }
  const fmt = formatOutput;   // shared output formatter (ui.mjs)
  function paint(res) {
    for (const f of ir.fields) {
      const wrap = wraps[f.id], c = controls[f.id];
      wrap.classList.toggle('is-hidden', !res.visible[f.id]);
      const enabled = res.enabled[f.id] && !lockedSet.has(f.id);   // locked = authoritative-from-upstream
      wrap.classList.toggle('is-disabled', !enabled);
      const forced = res.forced.includes(f.slot);
      wrap.classList.toggle('is-forced', forced);
      c.sync(decodeValue(f, res.valueById[f.id]), { forced });
      c.update({ enabled, available: res.optionState[f.id] || null, limits: res.limits[f.id] });
      const msg = res.messages.find((m) => m.targetSlot === f.slot && m.severity === 2);
      wrap.classList.toggle('is-invalid', !!msg);
      errs[f.id].textContent = msg ? msg.message : ''; errs[f.id].hidden = !msg;
    }
    for (let i = 0; i < ir.outputs.length; i++) {
      const o = ir.outputs[i], r = res.outputs[i];
      outEls[o.id].wrap.classList.toggle('is-hidden', !r.visible);
      outEls[o.id].value.textContent = fmt(r);
    }
    messagesEl.innerHTML = '';
    const sev = { 2: 'error', 1: 'warn', 0: 'info' };
    for (const m of [...res.messages].sort((a, b) => b.severity - a.severity)) {
      const d = el('div', `qc-message qc-message--${sev[m.severity]}`); d.dataset.severity = sev[m.severity]; d.textContent = m.message; messagesEl.appendChild(d);
    }
    if (res.status !== 0) { const d = el('div', 'qc-message qc-message--error'); d.textContent = `Engine warning (status ${res.status}). The quote may be inaccurate.`; messagesEl.prepend(d); }
  }

  function highlight(kind, id) {
    root.querySelectorAll('.is-editing').forEach((n) => n.classList.remove('is-editing'));
    const map = { field: wraps[id], section: secEls[id], output: outEls[id]?.wrap };
    if (map[kind]) map[kind].classList.add('is-editing');
  }

  seedDefaults();
  recompute();
  return { recompute, highlight };
}
