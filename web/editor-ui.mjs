// =============================================================================
// editor-ui.mjs — shared editor widgets: form rows, the expression input, and
// the visual rule-builder. Model-agnostic: the rule-builder gets its field list
// via a `getFields()` accessor, so both the Data and Presentation pages reuse it.
// (Correctness of the AST<->rule transform lives in rule.mjs, which is tested.)
// =============================================================================
import { parseExpr, formatExpr } from './expr.mjs';
import { astToRuleTop, ruleToAst } from './rule.mjs';
import { el } from './ui.mjs';

// el() lives in the shared ui.mjs atom layer now; re-exported so the editor
// widgets (and pages importing from editor-ui) keep a single source of truth.
export { el };
export function row(label, control) { const r = el('label', 'de-row'); const l = el('span', 'de-row__label'); l.textContent = label; r.append(l, control); return r; }
export function textRow(label, val, onChange) { const i = el('input', 'qc-input'); i.value = val; i.addEventListener('input', () => onChange(i.value)); return row(label, i); }
export function numRow(label, val, onChange) { const i = el('input', 'qc-input'); i.type = 'number'; i.value = val ?? ''; i.addEventListener('input', () => onChange(i.value === '' ? undefined : Number(i.value))); return row(label, i); }
export function checkRow(label, val, onChange) { const i = el('input'); i.type = 'checkbox'; i.checked = !!val; i.setAttribute('aria-label', label); i.addEventListener('change', () => onChange(i.checked)); return row(label, i); }
export function selectRow(label, opts, val, onChange) {
  const s = el('select', 'qc-select');
  for (const o of opts) { const op = el('option'); op.value = o; op.textContent = o; if (o === val) op.selected = true; s.appendChild(op); }
  s.addEventListener('change', () => onChange(s.value));
  return row(label, s);
}
export function hint(t) { const d = el('div', 'de-hint'); d.textContent = t; return d; }
export function mini(pairs, cur, onChange, ariaLabel) {
  const s = el('select', 'rb-mini');
  if (ariaLabel) s.setAttribute('aria-label', ariaLabel);
  for (const [v, t] of pairs) { const o = el('option'); o.value = v; o.textContent = t; if (String(v) === String(cur)) o.selected = true; s.appendChild(o); }
  s.addEventListener('change', () => onChange(s.value));
  return s;
}
export function addBtn(t, onClick) { const b = el('button', 'qc-btn-link rb-add'); b.type = 'button'; b.textContent = t; b.addEventListener('click', onClick); return b; }
export function iconBtn(t, onClick, label = 'Remove') { const b = el('button', 'rb-x'); b.type = 'button'; b.textContent = t; b.setAttribute('aria-label', label); b.addEventListener('click', onClick); return b; }

// ---- master-detail molecules (shared by editor-engine and presentation-editor)
// One outline group (a titled list with an optional "+ add" and an active item)
// and one detail header (title + optional sub-line + optional Remove). Both
// pages built these by hand with the same de-* markup; now there is one source.
export function outlineGroup({ title, items, activeIndex = -1, onPick, onAdd }) {
  const sec = el('div', 'de-group');
  const head = el('div', 'de-group__head');
  head.appendChild(el('span', null, { text: title }));
  if (onAdd) head.appendChild(addBtn('+ add', onAdd));
  sec.appendChild(head);
  (items || []).forEach((label, i) => {
    sec.appendChild(el('button', 'de-item' + (i === activeIndex ? ' is-active' : ''), { type: 'button', text: label, on: { click: () => onPick(i) } }));
  });
  return sec;
}
export function detailTitle(title, { sub, onRemove } = {}) {
  const h = el('div', 'de-title');
  const left = el('div');
  left.appendChild(el('h3', null, { text: title }));
  if (sub) left.appendChild(el('div', 'de-title__sub', { text: sub }));
  h.appendChild(left);
  if (onRemove) h.appendChild(el('button', 'qc-btn-link', { type: 'button', text: 'Remove', on: { click: onRemove } }));
  return h;
}

// expression control bound to an AST slot; `apply(ast|undefined)` owns the update
export function exprInput(getAst, apply, { placeholder, multiline, required } = {}) {
  const wrap = el('div', 'de-expr');
  const inp = el(multiline ? 'textarea' : 'input', multiline ? 'qc-code de-expr__ta' : 'qc-input');
  inp.placeholder = placeholder || 'expression';
  inp.setAttribute('aria-label', placeholder || 'expression');
  const cur = getAst();
  inp.value = cur === undefined ? '' : formatExpr(cur);
  const err = el('div', 'de-expr__err'); err.hidden = true;
  inp.addEventListener('input', () => {
    const t = inp.value.trim();
    if (t === '') { if (required) { err.textContent = 'required'; err.hidden = false; } else { apply(undefined); err.hidden = true; } return; }
    try { apply(parseExpr(t)); err.hidden = true; } catch (e) { err.textContent = e.message; err.hidden = false; }
  });
  wrap.append(inp, err);
  return wrap;
}
export function exprRow(label, getAst, apply, opts) { return row(label, exprInput(getAst, apply, opts)); }

// ---- visual rule-builder (parameterized by getFields()) --------------------
// getFields(): () => [{ id, type, options:[{id}] }]
export function makeRuleUI(getFields) {
  const fieldIds = () => getFields().map((f) => f.id);
  const fType = (id) => (getFields().find((f) => f.id === id) || {}).type;
  const fOpts = (id) => (getFields().find((f) => f.id === id) || {}).options || [];
  const fieldSelectEl = (cur, onChange) => mini(fieldIds().map((id) => [id, id]), cur, onChange, 'field');
  const optionSelectEl = (fieldId, cur, onChange) => mini(fOpts(fieldId).map((o) => [o.id, o.id]), cur, onChange, 'value');

  function ruleBlock(getAst, apply) {
    const wrap = el('div', 'rb');
    const top = astToRuleTop(getAst());
    const commit = () => apply(ruleToAst(top));
    const rerender = () => { wrap.innerHTML = ''; renderGroup(wrap, top, null, commit, rerender); };
    rerender();
    return wrap;
  }
  function ruleRow(label, getAst, apply) { return row(label, ruleBlock(getAst, apply)); }

  function renderGroup(container, group, parent, commit, rerender) {
    const box = el('div', 'rb-group');
    const head = el('div', 'rb-group__head');
    const lab = el('span', 'rb-lab'); lab.textContent = 'Match';
    head.append(lab, mini([['and', 'ALL of'], ['or', 'ANY of']], group.op, (v) => { group.op = v; commit(); }, 'match all or any'));
    if (parent) head.appendChild(iconBtn('✕', () => { parent.kids.splice(parent.kids.indexOf(group), 1); commit(); rerender(); }, 'Remove group'));
    box.appendChild(head);
    const kids = el('div', 'rb-kids');
    group.kids.forEach((k) => renderNode(kids, k, group, commit, rerender));
    box.appendChild(kids);
    const foot = el('div', 'rb-foot');
    foot.appendChild(addBtn('+ condition', () => { group.kids.push(defaultLeaf()); commit(); rerender(); }));
    foot.appendChild(addBtn('+ group', () => { group.kids.push({ t: 'group', op: 'and', kids: [] }); commit(); rerender(); }));
    foot.appendChild(addBtn('+ expression', () => { group.kids.push({ t: 'expr', ast: 0 }); commit(); rerender(); }));
    box.appendChild(foot);
    container.appendChild(box);
  }
  function renderNode(container, node, parent, commit, rerender) {
    if (node.t === 'group') return renderGroup(container, node, parent, commit, rerender);
    renderLeaf(container, node, parent, commit, rerender);
  }
  function renderLeaf(container, leaf, parent, commit, rerender) {
    const r = el('div', 'rb-leaf');
    if (leaf.t === 'expr') {
      r.appendChild(exprInput(() => leaf.ast, (a) => { leaf.ast = a; commit(); }, { placeholder: 'expression' }));
    } else {
      r.appendChild(fieldSelectEl(leaf.field, (fid) => { convertLeaf(leaf, fid); commit(); rerender(); }));
      const ft = fType(leaf.field);
      if (leaf.t === 'mem') {
        r.appendChild(mini([['has', 'includes'], ['notHas', 'excludes']], leaf.op, (v) => { leaf.op = v; commit(); }, 'operator'));
        r.appendChild(optionSelectEl(leaf.field, leaf.option, (v) => { leaf.option = v; commit(); }));
      } else if (ft === 'choice') {
        r.appendChild(mini([['eq', 'is'], ['ne', 'is not']], leaf.op, (v) => { leaf.op = v; commit(); }, 'operator'));
        r.appendChild(optionSelectEl(leaf.field, leaf.value.v, (v) => { leaf.value = { vt: 'option', v }; commit(); }));
      } else if (ft === 'boolean') {
        r.appendChild(mini([['eq', 'is']], leaf.op, (v) => { leaf.op = v; commit(); }, 'operator'));
        r.appendChild(mini([['1', 'true'], ['0', 'false']], String(leaf.value.v ?? 1), (v) => { leaf.value = { vt: 'number', v: Number(v) }; commit(); }, 'value'));
      } else {
        r.appendChild(mini([['eq', '='], ['ne', '≠'], ['lt', '<'], ['lte', '≤'], ['gt', '>'], ['gte', '≥']], leaf.op, (v) => { leaf.op = v; commit(); }, 'operator'));
        r.appendChild(numValueEl(leaf, commit));
      }
    }
    r.appendChild(iconBtn('✕', () => { parent.kids.splice(parent.kids.indexOf(leaf), 1); commit(); rerender(); }, 'Remove condition'));
    container.appendChild(r);
  }
  function numValueEl(leaf, commit) {
    const wrap = el('span', 'rb-val');
    const render = () => {
      wrap.innerHTML = '';
      const vt = leaf.value.vt;
      wrap.appendChild(mini([['number', 'value'], ['field', 'field'], ['expr', 'ƒx']], vt, (nv) => {
        leaf.value = nv === 'number' ? { vt: 'number', v: 0 } : nv === 'field' ? { vt: 'field', v: fieldIds()[0] } : { vt: 'expr', v: 0 };
        commit(); render();
      }, 'value type'));
      if (vt === 'number') { const i = el('input', 'qc-input rb-num'); i.type = 'number'; i.value = leaf.value.v; i.setAttribute('aria-label', 'value'); i.addEventListener('input', () => { leaf.value.v = Number(i.value); commit(); }); wrap.appendChild(i); }
      else if (vt === 'field') { wrap.appendChild(fieldSelectEl(leaf.value.v, (id) => { leaf.value.v = id; commit(); })); }
      else { wrap.appendChild(exprInput(() => leaf.value.v, (a) => { leaf.value.v = a; commit(); }, { placeholder: 'expression' })); }
    };
    render();
    return wrap;
  }
  function defaultLeaf() {
    const c = getFields().find((f) => f.type === 'choice');
    if (c) return { t: 'cmp', field: c.id, op: 'eq', value: { vt: 'option', v: c.options[0]?.id } };
    const m = getFields().find((f) => f.type === 'multichoice');
    if (m) return { t: 'mem', op: 'has', field: m.id, option: m.options[0]?.id };
    const n = getFields()[0];
    return { t: 'cmp', field: n.id, op: 'eq', value: { vt: 'number', v: 0 } };
  }
  function convertLeaf(leaf, fid) {
    const t = fType(fid);
    for (const k of Object.keys(leaf)) delete leaf[k];
    if (t === 'multichoice') Object.assign(leaf, { t: 'mem', op: 'has', field: fid, option: fOpts(fid)[0]?.id });
    else if (t === 'choice') Object.assign(leaf, { t: 'cmp', field: fid, op: 'eq', value: { vt: 'option', v: fOpts(fid)[0]?.id } });
    else if (t === 'boolean') Object.assign(leaf, { t: 'cmp', field: fid, op: 'eq', value: { vt: 'number', v: 1 } });
    else Object.assign(leaf, { t: 'cmp', field: fid, op: 'eq', value: { vt: 'number', v: 0 } });
  }

  return { ruleBlock, ruleRow };
}
