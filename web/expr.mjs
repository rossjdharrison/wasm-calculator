// =============================================================================
// expr.mjs — a small, friendly expression language for the model editor.
//
//   parseExpr("lookup(engineDelta, engine) + 300")  -> model AST ({op, args})
//   formatExpr(ast)                                  -> readable infix string
//
// It maps to the SAME AST the engine already understands (see assembler.mjs):
//   bare identifier            -> { op: "field", args: [name] }
//   number / 'string'          -> bare number / bare string literal
//   a == b, a && b, a + b, …   -> { op: "eq"|"and"|"add"|…, args:[a,b] }
//   -x, !x                     -> { op:"neg"|"not", args:[x] }
//   if(c,a,b), min, max, pow, abs, floor, ceil, round, clamp, countbits
//   has(field,'opt'), notHas(field,'opt'), lookup(table, key[, key2])
//
// parseExpr always emits binary nodes; the model may use variadic add/mul/etc.
// `canonicalize()` folds variadic → binary so the two compare equal (used by the
// round-trip test). Op names match the model: `lte`/`gte` for <= / >=.
// =============================================================================

const BINOP = {
  '||': 'or', '&&': 'and',
  '==': 'eq', '!=': 'ne', '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte',
  '+': 'add', '-': 'sub', '*': 'mul', '/': 'div',
};
// operator -> [left binding power, right binding power] (left-assoc: right = lbp+1)
const BP = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6 };
const OP_BP = { or: 1, and: 2, eq: 3, ne: 3, lt: 4, lte: 4, gt: 4, gte: 4, add: 5, sub: 5, mul: 6, div: 6 };
const FUNCS = new Set(['if', 'min', 'max', 'pow', 'abs', 'floor', 'ceil', 'round', 'clamp', 'countbits', 'lookup', 'has', 'notHas', 'neg', 'not']);
const NAME_ARG_FUNCS = { has: 'both', notHas: 'both', lookup: 'first' }; // which args are bare names, not exprs

// ---- tokenizer --------------------------------------------------------------
function tokenize(src) {
  const toks = [];
  const re = /\s+|(<=|>=|==|!=|&&|\|\||[-+*/(),<>!])|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|(\d+\.?\d*|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)/g;
  let m, last = 0;
  while ((m = re.exec(src)) !== null) {
    if (m.index !== last) throw new Error(`unexpected character at ${last}: "${src.slice(last, m.index)}"`);
    last = re.lastIndex;
    if (m[0].trim() === '') continue;
    if (m[1]) toks.push({ t: 'op', v: m[1] });
    else if (m[2]) toks.push({ t: 'str', v: m[2].slice(1, -1).replace(/\\(.)/g, '$1') });
    else if (m[3]) toks.push({ t: 'num', v: Number(m[3]) });
    else if (m[4]) toks.push({ t: 'name', v: m[4] });
  }
  if (last !== src.length) throw new Error(`unexpected character at ${last}: "${src.slice(last)}"`);
  return toks;
}

// ---- parser (Pratt) ---------------------------------------------------------
export function parseExpr(src) {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];
  const eat = (v) => { const t = next(); if (!t || t.v !== v) throw new Error(`expected "${v}"`); };

  function parse(rbp) {
    let left = nud();
    while (peek() && peek().t === 'op' && BP[peek().v] !== undefined && BP[peek().v] > rbp) {
      const op = next().v;
      const right = parse(BP[op]); // left-assoc
      left = { op: BINOP[op], args: [left, right] };
    }
    return left;
  }

  function nud() {
    const t = next();
    if (!t) throw new Error('unexpected end of expression');
    if (t.t === 'num') return t.v;
    if (t.t === 'str') return t.v;
    if (t.t === 'op') {
      if (t.v === '(') { const e = parse(0); eat(')'); return e; }
      if (t.v === '-') return { op: 'neg', args: [parse(7)] };
      if (t.v === '!') return { op: 'not', args: [parse(7)] };
      throw new Error(`unexpected "${t.v}"`);
    }
    // name: function call or field reference
    if (peek() && peek().t === 'op' && peek().v === '(') {
      if (!FUNCS.has(t.v)) throw new Error(`unknown function "${t.v}"`);
      return parseCall(t.v);
    }
    return { op: 'field', args: [t.v] };
  }

  function parseName() { const t = next(); if (!t || t.t !== 'name') throw new Error('expected a name'); return t.v; }
  function parseNameOrStr() { const t = next(); if (!t || (t.t !== 'name' && t.t !== 'str')) throw new Error('expected a name or string'); return t.v; }

  function parseCall(name) {
    eat('(');
    const args = [];
    const mode = NAME_ARG_FUNCS[name];
    if (mode === 'both') { args.push(parseName()); eat(','); args.push(parseNameOrStr()); }
    else if (mode === 'first') { args.push(parseName()); while (peek() && peek().v === ',') { eat(','); args.push(parse(0)); } }
    else if (peek() && peek().v !== ')') { args.push(parse(0)); while (peek() && peek().v === ',') { eat(','); args.push(parse(0)); } }
    eat(')');
    return { op: name, args };
  }

  const ast = parse(0);
  if (i !== toks.length) throw new Error('unexpected trailing input');
  return ast;
}

// ---- formatter (AST -> infix) ----------------------------------------------
const REV = Object.fromEntries(Object.entries(BINOP).map(([sym, op]) => [op, sym]));

export function formatExpr(ast, parentBp = 0) {
  if (ast === null || ast === undefined) return '';
  if (typeof ast === 'number') return String(ast);
  if (typeof ast === 'boolean') return ast ? '1' : '0';
  if (typeof ast === 'string') return `'${ast.replace(/'/g, "\\'")}'`;
  const op = ast.op;
  if (op === 'field') return ast.args[0];
  if (op === 'const') return String(ast.args[0]);
  if (op === 'neg') return `-${formatExpr(ast.args[0], 7)}`;
  if (op === 'not') return `!${wrapAtom(ast.args[0])}`;
  if (op in OP_BP) { // binary / variadic chain
    const bp = OP_BP[op], sym = REV[op];
    const parts = ast.args.map((a, idx) => formatExpr(a, idx === 0 ? bp : bp + 1));
    const s = parts.join(` ${sym} `);
    return bp < parentBp ? `(${s})` : s;
  }
  if (op === 'has') return `has(${ast.args[0]}, '${ast.args[1]}')`;
  if (op === 'notHas') return `notHas(${ast.args[0]}, '${ast.args[1]}')`;
  if (op === 'lookup') return `lookup(${ast.args[0]}, ${ast.args.slice(1).map((a) => formatExpr(a, 0)).join(', ')})`;
  // generic function
  return `${op}(${ast.args.map((a) => formatExpr(a, 0)).join(', ')})`;
}
// wrap a non-atom operand of `!` in parens
function wrapAtom(a) {
  const s = formatExpr(a, 0);
  const atomic = typeof a !== 'object' || a.op === 'field' || a.op === 'const' || FUNCS.has(a.op) && !['neg', 'not'].includes(a.op);
  return atomic ? s : `(${s})`;
}

// ---- canonicalize: fold variadic add/mul/… into left-assoc binary ----------
const VARIADIC = new Set(['add', 'sub', 'mul', 'min', 'max', 'and', 'or']);
export function canonicalize(ast) {
  if (ast === null || typeof ast !== 'object') return ast;
  const args = ast.args.map(canonicalize);
  if (ast.op === 'neg' && typeof args[0] === 'number') return -args[0]; // -1 literal == neg(1)
  if (VARIADIC.has(ast.op) && args.length > 2) {
    return args.reduce((acc, cur) => ({ op: ast.op, args: [acc, cur] }));
  }
  return { op: ast.op, args };
}
