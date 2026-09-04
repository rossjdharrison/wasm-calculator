// =============================================================================
// coverage.mjs — the model COVERAGE / ORPHAN analyzer (Area 1).
//
// A non-dev who adds one option silently takes on a web of obligations: a
// presentation label, a row in every table the field indexes, membership in the
// pricing formula. They lose track (cyclic complexity). This module makes those
// obligations EXPLICIT by reading the dependency graph:
//
//   • which tables a field indexes is INFERRED from lookup(table, field) ASTs,
//     so "add a model option" → "modelTrimPrice needs a row" is known, not guessed;
//   • every option is checked for a presentation label;
//   • options referenced nowhere (dead) and input fields wired to nothing
//     (orphans) are surfaced against the output graph.
//
// Pure + DOM-free. analyzeCoverage() returns structured findings, each carrying a
// machine-applicable `fix` so the editor can offer one-click "connect this".
// applyFix() performs that remediation on the (data, pres) pair.
// =============================================================================

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const humanize = (id) => String(id).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function walk(node, cb) {
  if (!node || typeof node !== 'object') return;
  cb(node);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((x) => walk(x, cb));
    else if (v && typeof v === 'object') walk(v, cb);
  }
}

// All expression roots in the model (data + presentation rules).
function exprRoots(data, pres) {
  const roots = [];
  for (const c of data.computed || []) roots.push(c.formula);
  for (const f of data.fields || []) for (const k of ['min', 'max', 'step']) if (isObj(f[k])) roots.push(f[k]);
  for (const f of data.fields || []) for (const o of f.options || []) if (o.availableWhen) roots.push(o.availableWhen);
  for (const v of data.validations || []) if (v.when) roots.push(v.when);
  for (const e of data.effects || []) { if (e.when) roots.push(e.when); if (isObj(e.toValue)) roots.push(e.toValue); }
  for (const pf of pres.fields || []) for (const k of ['visibleWhen', 'enabledWhen']) if (pf[k]) roots.push(pf[k]);
  for (const po of (pres.fields || []).flatMap((pf) => pf.options || [])) if (po.availableWhen) roots.push(po.availableWhen);
  for (const o of pres.outputs || []) if (o.visibleWhen) roots.push(o.visibleWhen);
  return roots.filter(Boolean);
}

// table -> [indexing field ids], inferred from lookup(table, keyExpr[, colExpr]).
export function inferIndexing(data, pres = {}) {
  const idx = {};
  for (const root of exprRoots(data, pres)) {
    walk(root, (n) => {
      if (n.op !== 'lookup' || !Array.isArray(n.args)) return;
      const [table, ...keys] = n.args;
      if (typeof table !== 'string') return;
      idx[table] = keys.map((k) => (isObj(k) && k.op === 'field' ? k.args[0] : null));
    });
  }
  return idx;
}

// Every value id (field OR computed) referenced anywhere, and per-field option
// literals referenced via eq/ne/has/notHas.
function collectRefs(data, pres) {
  const refIds = new Set();
  const optRefs = new Map(); // fieldId -> Set(optionId)
  const addOpt = (fid, oid) => { if (!optRefs.has(fid)) optRefs.set(fid, new Set()); optRefs.get(fid).add(oid); };
  for (const root of exprRoots(data, pres)) {
    walk(root, (n) => {
      if (n.op === 'field' && typeof n.args?.[0] === 'string') refIds.add(n.args[0]);
      if (n.op === 'lookup' && Array.isArray(n.args)) for (const k of n.args.slice(1)) if (isObj(k) && k.op === 'field') refIds.add(k.args[0]);
      if ((n.op === 'has' || n.op === 'notHas') && typeof n.args?.[0] === 'string' && typeof n.args?.[1] === 'string') { refIds.add(n.args[0]); addOpt(n.args[0], n.args[1]); }
      if ((n.op === 'eq' || n.op === 'ne') && Array.isArray(n.args)) {
        const fref = n.args.find((a) => isObj(a) && a.op === 'field');
        const lit = n.args.find((a) => typeof a === 'string');
        if (fref && lit) { refIds.add(fref.args[0]); addOpt(fref.args[0], lit); }
      }
    });
  }
  // effects also reference their target field
  for (const e of data.effects || []) if (typeof e.setField === 'string') refIds.add(e.setField);
  for (const v of data.validations || []) if (typeof v.field === 'string') refIds.add(v.field);
  return { refIds, optRefs };
}

export function analyzeCoverage(data, pres, opts = {}) {
  const findings = [];
  const add = (f) => findings.push(f);
  const fields = data.fields || [];
  const fieldById = Object.fromEntries(fields.map((f) => [f.id, f]));
  const computedIds = new Set((data.computed || []).map((c) => c.id));
  const tables = data.tables || {};
  const presFieldById = Object.fromEntries((pres.fields || []).map((f) => [f.id, f]));
  const idx = inferIndexing(data, pres);
  const { refIds, optRefs } = collectRefs(data, pres);
  const optIds = (fid) => (fieldById[fid]?.options || []).map((o) => o.id);

  // 1) table-key coverage — every option of an indexing field must be present
  for (const [tname, dims] of Object.entries(idx)) {
    const t = tables[tname];
    if (!t) {
      add({ id: `undef:${tname}`, kind: 'undefined-table', severity: 'error', table: tname, message: `Table "${tname}" is used in a formula but not defined.`, fix: null });
      continue;
    }
    if (t.kind === '1d' && dims[0]) {
      const have = new Set(Object.keys(t.map || {}));
      for (const k of optIds(dims[0])) if (!have.has(k)) add({
        id: `key:${tname}:${k}`, kind: 'missing-table-key', severity: 'error', table: tname, field: dims[0], option: k,
        message: `${tname} has no value for ${dims[0]} = "${k}".`, fix: { type: 'add-table-key', table: tname, key: k },
      });
    } else if (t.kind === '2d' && dims[0] && dims[1]) {
      const rows = t.rows || {};
      const cols = optIds(dims[1]);
      for (const r of optIds(dims[0])) {
        if (!rows[r]) { add({ id: `row:${tname}:${r}`, kind: 'missing-table-key', severity: 'error', table: tname, field: dims[0], option: r, row: r, message: `${tname} has no row for ${dims[0]} = "${r}".`, fix: { type: 'add-table-key', table: tname, row: r } }); continue; }
        for (const c of cols) if (!(c in rows[r])) add({
          id: `cell:${tname}:${r}:${c}`, kind: 'missing-table-key', severity: 'error', table: tname, field: dims[1], option: c, row: r,
          message: `${tname}[${r}] has no value for ${dims[1]} = "${c}".`, fix: { type: 'add-table-key', table: tname, row: r, col: c },
        });
      }
    }
  }

  // 2) presentation-label coverage — every option should have a label
  for (const f of fields) {
    for (const o of f.options || []) {
      const po = (presFieldById[f.id]?.options || []).find((x) => x.id === o.id);
      if (!po || !po.label) add({
        id: `label:${f.id}:${o.id}`, kind: 'missing-label', severity: 'warn', field: f.id, option: o.id,
        message: `Option ${f.id}.${o.id} has no display label — customers would see "${o.id}".`,
        fix: { type: 'add-label', field: f.id, option: o.id, label: humanize(o.id) },
      });
    }
    // a field itself with no presentation label
    if ((f.options || f.type === 'number') && !presFieldById[f.id]?.label) add({
      id: `label:${f.id}`, kind: 'missing-label', severity: 'info', field: f.id,
      message: `Field "${f.id}" has no display label.`, fix: { type: 'add-label', field: f.id, label: humanize(f.id) },
    });
  }

  // 3) dead options — multi-select options no formula/rule ever reads. (Only
  // multichoice: a choice field always has one unreferenced "baseline" option,
  // and its options are covered by table-key + orphan-field checks instead.)
  for (const f of fields) {
    if (f.type !== 'multichoice') continue;
    const referenced = optRefs.get(f.id) || new Set();
    for (const o of f.options || []) {
      if (!referenced.has(o.id)) add({
        id: `dead:${f.id}:${o.id}`, kind: 'dead-option', severity: 'info', field: f.id, option: o.id,
        message: `Option ${f.id}.${o.id} is never referenced by any price or rule — selecting it changes nothing.`, fix: null,
      });
    }
  }

  // 4) orphan fields — input fields wired to nothing in the graph
  for (const f of fields) {
    if (!refIds.has(f.id)) add({
      id: `orphan:${f.id}`, kind: 'orphan-field', severity: 'warn', field: f.id,
      message: `Field "${f.id}" is not used by any price, rule, table or output — it is disconnected.`, fix: null,
    });
  }

  const order = { error: 0, warn: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const counts = { error: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return { indexing: idx, findings, counts, referencedFieldIds: [...refIds] };
}

// Apply a finding's `fix` to the (data, pres) pair in place. Returns true if it
// changed anything. Used by the editor's one-click "connect" action.
export function applyFix(data, pres, fix) {
  if (!fix) return false;
  if (fix.type === 'add-label') {
    pres.fields = pres.fields || [];
    let pf = pres.fields.find((f) => f.id === fix.field);
    if (!pf) { pf = { id: fix.field }; pres.fields.push(pf); }
    if (fix.option === undefined) { if (pf.label) return false; pf.label = fix.label; return true; }
    pf.options = pf.options || [];
    let po = pf.options.find((o) => o.id === fix.option);
    if (!po) { po = { id: fix.option }; pf.options.push(po); }
    if (po.label) return false;
    po.label = fix.label; return true;
  }
  if (fix.type === 'add-table-key') {
    const t = (data.tables = data.tables || {})[fix.table];
    if (!t) return false;
    if (t.kind === '1d') { if (fix.key in (t.map || {})) return false; (t.map = t.map || {})[fix.key] = 0; return true; }
    if (t.kind === '2d') {
      t.rows = t.rows || {};
      if (fix.row !== undefined && fix.col === undefined) {
        if (t.rows[fix.row]) return false;
        const template = t.rows[Object.keys(t.rows)[0]] || {};
        t.rows[fix.row] = Object.fromEntries(Object.keys(template).map((c) => [c, 0]));
        return true;
      }
      if (fix.row !== undefined && fix.col !== undefined) {
        t.rows[fix.row] = t.rows[fix.row] || {};
        if (fix.col in t.rows[fix.row]) return false;
        t.rows[fix.row][fix.col] = 0; return true;
      }
    }
  }
  return false;
}
