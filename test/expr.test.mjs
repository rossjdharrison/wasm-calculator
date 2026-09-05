// A2: the editor's expression language must round-trip every expression in the
// real model: canonicalize(parse(format(e))) deep-equals canonicalize(e).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mergeModel } from '../web/assembler.mjs';
import { parseExpr, formatExpr, canonicalize } from '../web/expr.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const web = (f) => readFile(join(here, '..', 'web', f), 'utf8').then(JSON.parse);
const model = mergeModel(await web('models/vehicles/data-model.json'), await web('models/vehicles/presentation-model.json'));

// collect every AST-valued expression slot in the model
const isAst = (v) => v && typeof v === 'object' && typeof v.op === 'string';
const exprs = [];
const add = (v) => { if (isAst(v)) exprs.push(v); };
for (const f of model.fields) {
  [f.min, f.max, f.step, f.visibleWhen, f.enabledWhen, f.formula].forEach(add);
  for (const o of f.options || []) add(o.availableWhen);
}
for (const c of model.computed || []) add(c.formula);
for (const v of model.validations || []) add(v.when);
for (const e of model.effects || []) { add(e.when); add(e.toValue); }
for (const o of model.outputs || []) add(o.visibleWhen);

test(`round-trips all ${exprs.length} model expressions`, () => {
  assert.ok(exprs.length >= 20, `expected many expressions, found ${exprs.length}`);
  for (const e of exprs) {
    const round = parseExpr(formatExpr(e));
    assert.deepStrictEqual(canonicalize(round), canonicalize(e),
      `round-trip failed for: ${formatExpr(e)}\n  ast: ${JSON.stringify(e)}`);
  }
});

test('spot checks — the hard cases', () => {
  const rt = (s) => formatExpr(parseExpr(s));
  assert.equal(rt("engine == 'electric'"), "engine == 'electric'");
  assert.equal(rt("has(packages, 'tech')"), "has(packages, 'tech')");
  assert.equal(rt("notHas(packages, 'towing')"), "notHas(packages, 'towing')");
  assert.equal(rt("lookup(modelTrimPrice, model, trim)"), "lookup(modelTrimPrice, model, trim)");
  assert.equal(rt("otr * 0.1"), "otr * 0.1");
  assert.equal(rt("!(trim == 'offRoad')"), "!(trim == 'offRoad')");
  // precedence + nesting preserved semantically
  const a = "if(financing == 'finance', (otr - deposit) * (0.079 / 12), 0)";
  assert.deepStrictEqual(canonicalize(parseExpr(rt(a))), canonicalize(parseExpr(a)));
  // annuity pow term
  const b = "pow(1 + 0.079 / 12, -1 * lookup(termMonths, term))";
  assert.deepStrictEqual(canonicalize(parseExpr(rt(b))), canonicalize(parseExpr(b)));
});
