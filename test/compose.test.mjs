// Phase 2: the composition spine. A journey sequences per-model WASM evaluations,
// injects one model's output individual into the next's input, and accumulates the
// order — with no upstream re-run and no cross-model cycle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assemble, mergeModel } from '../web/assembler.mjs';
import { EngineHost, evaluateJourney, orderModels, boundTargetsOf } from '../web/compose.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const wasm = await readFile(join(here, '..', 'build', 'quote.wasm'));
const readJson = (p) => readFile(join(here, '..', p), 'utf8').then(JSON.parse);
const loadModel = async (id) => {
  const merged = mergeModel(await readJson(`web/models/${id}/data-model.json`), await readJson(`web/models/${id}/presentation-model.json`));
  return { merged, assembled: assemble(merged) };
};
const near = (a, b) => Math.abs(a - b) <= 1e-6 + Math.abs(b) * 1e-9;

const journey = await readJson('web/journeys/vehicle-sale.json');
const models = { shopping: await loadModel('vehicles'), financing: await loadModel('financing') };
const shopCfg = { model: 'hotHatch', trim: 'standard', engine: 'electric', drivetrain: 'fwd', wheels: 'w17', colour: 'solid', packages: [], financing: 'cash' };

test('evaluateJourney sequences, injects the seam value, and accumulates the order', async () => {
  const host = new EngineHost(wasm);
  const r = await evaluateJourney(journey, models, host, { shopping: shopCfg, financing: { deposit: 8000, termMonths: 36 } });

  assert.deepEqual(r.order, ['shopping', 'financing']); // topo: product before finance
  const grand = r.byAlias.shopping.valueById.grandTotal;
  assert.ok(grand > 0);

  // the seam injected shopping.grandTotal into financing.price (no hardcoding)
  assert.equal(r.byAlias.financing.config.price, grand);
  // financing computed FROM the injected price (totalPayable = price + 495 fee)
  assert.ok(near(r.byAlias.financing.valueById.totalPayable, grand + 495), 'financing evaluated from the injected price');

  // the accumulated order carries both Purchase Prices + a currency total
  assert.equal(r.lines.length, 2);
  assert.equal(r.lines[0].ref, 'vehicle-configurator#grandTotal');
  assert.equal(r.lines[1].ref, 'financing-configurator#totalPayable');
  assert.ok(near(r.totalsByCurrency.EUR, grand + r.byAlias.financing.valueById.totalPayable));
});

test('D5: recurring outputs are surfaced apart from the one-off order total', async () => {
  const host = new EngineHost(wasm);
  const r = await evaluateJourney(journey, models, host, { shopping: shopCfg, financing: { deposit: 8000, termMonths: 36 } });
  // financing.monthly is tagged role:recurring → it appears in `recurring`, not lines
  const fin = r.recurring.find((x) => x.alias === 'financing' && x.localId === 'monthly');
  assert.ok(fin, 'financing monthly is surfaced as recurring');
  assert.ok(fin.amount > 0 && fin.currency === 'EUR');
  // the one-off total is only the two Purchase Prices — the recurring figure is NOT added in
  assert.ok(near(r.totalsByCurrency.EUR, r.byAlias.shopping.valueById.grandTotal + r.byAlias.financing.valueById.totalPayable));
  assert.ok(!r.lines.some((l) => l.localId === 'monthly'), 'monthly is not a one-off order line');
});

test('the typed seam payload flows: shopping produces a Purchase Price individual', async () => {
  const host = new EngineHost(wasm);
  const r = await evaluateJourney(journey, models, host, { shopping: shopCfg, financing: {} });
  const price = r.byAlias.shopping.individuals.price;
  assert.equal(price.category, 'PurchasePrice');
  assert.equal(price.ref, 'vehicle-configurator#grandTotal');
  assert.equal(price.amount, r.byAlias.shopping.valueById.grandTotal);
});

test('D4: boundTargetsOf derives the upstream-authoritative fields of a downstream model', () => {
  assert.deepEqual([...boundTargetsOf(journey, 'financing')], ['price']);
  assert.deepEqual([...boundTargetsOf(journey, 'shopping')], [], 'no inbound binding → no bound fields');
});

test('D4/review: evaluateJourney reports the injected map; a GATED binding injects nothing', async () => {
  const host = new EngineHost(wasm);
  const r = await evaluateJourney(journey, models, host, { shopping: shopCfg, financing: {} });
  assert.ok(r.injected && r.injected.financing && 'price' in r.injected.financing, 'unconditional binding injects price');

  // clone with a condition that is always false → the seam is gated → nothing injected,
  // so a downstream capture would NOT lock `price` (it becomes a free field).
  const gated = JSON.parse(JSON.stringify(journey));
  gated.bindings[0].condition = { op: 'lt', args: [{ op: 'field', args: ['grandTotal'] }, 0] };
  const r2 = await evaluateJourney(gated, models, host, { shopping: shopCfg, financing: {} });
  assert.ok(!r2.injected.financing || !('price' in r2.injected.financing), 'gated binding injects no price');
});

test('D4: the bound field stays authoritative while the user configures free inputs (single-authority)', async () => {
  const host = new EngineHost(wasm);
  // the user "tries" to set price (bound) AND sets its own free deposit/termMonths
  const r = await evaluateJourney(journey, models, host, { shopping: shopCfg, financing: { price: 1, deposit: 8000, termMonths: 36 } });
  const grand = r.byAlias.shopping.valueById.grandTotal;
  assert.equal(r.byAlias.financing.config.price, grand, 'injected price wins over the user value');
  assert.ok(near(r.byAlias.financing.valueById.totalPayable, grand + 495), 'free deposit/term honoured, price authoritative');
});

test('swap-test: a MONEY-FREE model composes — line rendered by its category, no total', async () => {
  // a domain with no price (e.g. an admissions application): the emphasised output is
  // a non-money quantity. The identical machinery must produce a line + no money total.
  const appModel = {
    id: 'application', version: '1', currency: null,
    types: { AssessmentScore: { specializes: ['physical_quantity'] } },
    fields: [{ id: 'score', type: 'number', default: 7, category: 'AssessmentScore' }],
    computed: [],
    outputs: [{ id: 'score', label: 'Assessment score', emphasis: true, format: { type: 'number' } }],
  };
  const models2 = { app: { merged: appModel, assembled: assemble(appModel) } };
  const journey2 = { id: 'admissions', version: '1', phases: [{ id: 'configure', label: 'Apply', order: 1 }], models: [{ ref: 'application', as: 'app', phase: 'configure' }], bindings: [], process: { steps: [{ id: 's', phase: 'configure', kind: 'capture', model: 'app' }] } };
  const host = new EngineHost(wasm);
  const r = await evaluateJourney(journey2, models2, host, { app: { score: 7 } });
  assert.equal(r.lines.length, 1, 'the money-free model still surfaces a line');
  assert.equal(r.lines[0].category, 'AssessmentScore');
  assert.equal(r.lines[0].nonMoney, true);
  assert.equal(r.lines[0].value, 7);
  assert.equal(Object.keys(r.totalsByCurrency).length, 0, 'no money → no order total');
});

test('orderModels rejects a cross-model cycle', () => {
  const cyc = { models: [{ as: 'a' }, { as: 'b' }], bindings: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }] };
  assert.throws(() => orderModels(cyc), /cycle/i);
});
