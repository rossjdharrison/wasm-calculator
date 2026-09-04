// =============================================================================
// rule.mjs — map between the condition AST and a friendly "rule" structure the
// visual builder edits, and back. Pure (no DOM), so it is unit-tested.
//
// Rule shapes:
//   { t:'group', op:'and'|'or', kids:[rule...] }
//   { t:'cmp',  field, op:'eq'|'ne'|'lt'|'lte'|'gt'|'gte', value:{vt, v} }
//   { t:'mem',  op:'has'|'notHas', field, option }
//   { t:'expr', ast }                      // fallback for shapes the UI can't model
// value.vt: 'option' (string) | 'number' | 'field' (id) | 'expr' (ast)
//
// astToRule normalizes negations for friendliness: not(eq)->ne, not(has)->notHas,
// etc. This is behavior-preserving (the engine treats ne and not(eq) identically)
// — proven by test/rule.test.mjs running the golden vectors on the rewritten model.
// =============================================================================

const CMP = new Set(['eq', 'ne', 'lt', 'lte', 'gt', 'gte']);
const NEG = { eq: 'ne', ne: 'eq', lt: 'gte', lte: 'gt', gt: 'lte', gte: 'lt' };

function valueOf(b) {
  if (typeof b === 'number') return { vt: 'number', v: b };
  if (typeof b === 'string') return { vt: 'option', v: b };
  if (b && typeof b === 'object' && b.op === 'field') return { vt: 'field', v: b.args[0] };
  return { vt: 'expr', v: b };
}

export function astToRule(ast) {
  if (ast === undefined) return { t: 'group', op: 'and', kids: [] };
  if (typeof ast !== 'object') return { t: 'expr', ast };
  const { op, args } = ast;
  if (op === 'and' || op === 'or') return { t: 'group', op, kids: args.map(astToRule) };
  if (op === 'has' || op === 'notHas') return { t: 'mem', op, field: args[0], option: args[1] };
  if (op === 'not') {
    const c = args[0];
    if (c && typeof c === 'object') {
      if (NEG[c.op]) return astToRule({ op: NEG[c.op], args: c.args });
      if (c.op === 'has') return { t: 'mem', op: 'notHas', field: c.args[0], option: c.args[1] };
      if (c.op === 'notHas') return { t: 'mem', op: 'has', field: c.args[0], option: c.args[1] };
    }
    return { t: 'expr', ast };
  }
  if (CMP.has(op)) {
    const [a, b] = args;
    if (a && typeof a === 'object' && a.op === 'field') return { t: 'cmp', field: a.args[0], op, value: valueOf(b) };
    return { t: 'expr', ast };
  }
  return { t: 'expr', ast };
}

// The top level is always a group so the UI can add multiple conditions.
export function astToRuleTop(ast) {
  const r = astToRule(ast);
  return r.t === 'group' ? r : { t: 'group', op: 'and', kids: [r] };
}

export function ruleToAst(rule) {
  if (!rule) return undefined;
  if (rule.t === 'expr') return rule.ast;
  if (rule.t === 'mem') return { op: rule.op, args: [rule.field, rule.option] };
  if (rule.t === 'cmp') {
    const v = rule.value;
    const right = v.vt === 'number' ? v.v : v.vt === 'option' ? v.v : v.vt === 'field' ? { op: 'field', args: [v.v] } : v.v;
    return { op: rule.op, args: [{ op: 'field', args: [rule.field] }, right] };
  }
  if (rule.t === 'group') {
    const kids = rule.kids.map(ruleToAst).filter((x) => x !== undefined);
    if (kids.length === 0) return undefined;
    if (kids.length === 1) return kids[0];
    return { op: rule.op, args: kids };
  }
  return undefined;
}
