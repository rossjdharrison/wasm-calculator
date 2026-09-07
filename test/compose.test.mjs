// Phase 2: the composition spine. A journey sequences per-model WASM evaluations,
// injects one model's output individual into the next's input, and accumulates the
// order — with no upstream re-run and no cross-model cycle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assemble, mergeModel } from '../web/assembler.mjs';
import { EngineHost, evaluateJourney, orderModels, boundTargetsOf, blockingOf } from '../web/compose.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const wasm = await readFile(join(here, '..', 'build', 'quote.wasm'));
const readJson = (p) => readFile(join(here, '..', p), 'utf8').then(JSON.parse);
const loadModel = async (id) => {
  const merged = mergeModel(await readJson(`web/models/${id}/data-model.json`), await readJson(`web/models/${id}/presentation-model.json`));
  return { merged, assembled: assemble(merged) };
};
const near = (a, b) => Math.abs(a - b) <= 1e-6 + Math.abs(b) * 1e-9;

const journey = await readJson('web/journeys/vehicle-sale.json');
const models = { shopping: await loadModel('vehicles'), shipping: await loadModel('shipping'), insurance: await loadModel('insurance'), financing: await loadModel('financing') };
const shopCfg = { model: 'hotHatch', trim: 'standard', engine: 'electric', drivetrain: 'fwd', wheels: 'w17', colour: 'solid', packages: [], financing: 'finance' };

test('evaluateJourney sequences, injects the seam values, and accumulates the order', async () => {
  const host = new EngineHost(wasm);
  const r = await evaluateJourney(journey, models, host, { shopping: shopCfg, shipping: {}, insurance: {}, financing: {} });

  assert.equal(r.order[0], 'shopping'); // topo: product first, its downstreams after
  const otr = r.byAlias.shopping.valueById.otr;
  assert.ok(otr > 0);

  // the three seams inject the vehicle's figures downstream (no hardcoding)
  assert.equal(r.byAlias.shipping.config.vehicleWeight, r.byAlias.shopping.valueById.weight, 'weight → shipping');
  assert.equal(r.byAlias.insurance.config.vehicleValue, otr, 'otr → insurance value');
  assert.equal(r.byAlias.financing.config.price, otr, 'otr → financing price');

  // one order line per model + a currency total that does NOT double-count the vehicle
  assert.equal(r.lines.length, 4);
  const total = otr + r.byAlias.shipping.valueById.shippingCost + r.byAlias.insurance.valueById.totalPremium + r.byAlias.financing.valueById.financeCharge;
  assert.ok(near(r.totalsByCurrency.EUR, total), 'total = vehicle + shipping + insurance + cost-of-financing');
});

test('D5: recurring outputs (monthly) are surfaced apart from the one-off order total', async () => {
  const host = new EngineHost(wasm);
  const r = await evaluateJourney(journey, models, host, { shopping: shopCfg, financing: { deposit: 5000, termMonths: 48 } });
  const fin = r.recurring.find((x) => x.alias === 'financing' && x.localId === 'monthly');
  assert.ok(fin, 'financing monthly is surfaced as recurring');
  assert.ok(fin.amount > 0 && fin.currency === 'EUR');
  assert.ok(!r.lines.some((l) => l.localId === 'monthly'), 'monthly is not a one-off order line');
});

test('the typed seam payload flows: shopping produces a Purchase Price individual (otr)', async () => {
  const host = new EngineHost(wasm);
  const r = await evaluateJourney(journey, models, host, { shopping: shopCfg });
  const price = r.byAlias.shopping.individuals.price;
  assert.equal(price.category, 'PurchasePrice');
  assert.equal(price.ref, 'vehicle-configurator#otr');
  assert.equal(price.amount, r.byAlias.shopping.valueById.otr);
});

test('D4: boundTargetsOf derives the upstream-authoritative fields of each downstream model', () => {
  assert.deepEqual([...boundTargetsOf(journey, 'financing')], ['price']);
  assert.deepEqual([...boundTargetsOf(journey, 'shipping')], ['vehicleWeight']);
  assert.deepEqual([...boundTargetsOf(journey, 'insurance')], ['vehicleValue']);
  assert.deepEqual([...boundTargetsOf(journey, 'shopping')], [], 'no inbound binding → no bound fields');
});

test('D4/review: evaluateJourney reports the injected map; a GATED binding injects nothing', async () => {
  const host = new EngineHost(wasm);
  const r = await evaluateJourney(journey, models, host, { shopping: shopCfg });
  assert.ok(r.injected && r.injected.financing && 'price' in r.injected.financing, 'unconditional binding injects price');

  // gate the price→financing binding with an always-false condition → nothing injected,
  // so a downstream capture would NOT lock `price` (it becomes a free field).
  const gated = JSON.parse(JSON.stringify(journey));
  gated.bindings.find((b) => b.id === 'price-to-financing').condition = { op: 'lt', args: [{ op: 'field', args: ['otr'] }, 0] };
  const r2 = await evaluateJourney(gated, models, host, { shopping: shopCfg });
  assert.ok(!r2.injected.financing || !('price' in r2.injected.financing), 'gated binding injects no price');
});

test('D4: the bound field stays authoritative while the user configures free inputs (single-authority)', async () => {
  const host = new EngineHost(wasm);
  // the user "tries" to set price (bound) AND sets its own free deposit/termMonths
  const r = await evaluateJourney(journey, models, host, { shopping: shopCfg, financing: { price: 1, deposit: 5000, termMonths: 36 } });
  const otr = r.byAlias.shopping.valueById.otr;
  assert.equal(r.byAlias.financing.config.price, otr, 'injected otr wins over the user value');
});

test('a conditional step: runStepGuard skips the financing step for a cash buyer', async () => {
  const host = new EngineHost(wasm);
  const cash = await evaluateJourney(journey, models, host, { shopping: { ...shopCfg, financing: 'cash' } });
  const financed = await evaluateJourney(journey, models, host, { shopping: { ...shopCfg, financing: 'finance' } });
  assert.equal(cash.stepGuards.finance, false, 'cash → financing step guarded out');
  assert.equal(financed.stepGuards.finance, true, 'finance → financing step available');
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

test('blockingOf reports only severity-2 messages on visible, non-locked FIELDS', () => {
  const ir = { fields: [{ id: 'a', slot: 0 }, { id: 'b', slot: 1 }, { id: 'c', slot: 2 }] };
  const res = {
    visible: { a: true, b: true, c: false },
    messages: [
      { severity: 2, targetSlot: 0, message: 'A bad' },   // visible field → blocks
      { severity: 1, targetSlot: 1, message: 'B warn' },   // severity 1 (warning) → ignored
      { severity: 2, targetSlot: 2, message: 'C hidden' }, // hidden field → ignored (fail-open)
      { severity: 2, targetSlot: 9, message: 'computed' }, // non-field slot → ignored (fail-open)
    ],
  };
  assert.deepEqual(blockingOf(ir, res), [{ field: 'a', message: 'A bad' }]);
  assert.deepEqual(blockingOf(ir, res, new Set(['a'])), [], 'a locked (upstream-authoritative) field is never blocking');
});

test('evaluateJourney surfaces a per-alias blocking list (empty for the valid defaults)', async () => {
  const host = new EngineHost(wasm);
  const r = await evaluateJourney(journey, models, host, { shopping: shopCfg, financing: { deposit: 8000, termMonths: 36 } });
  assert.ok(Array.isArray(r.byAlias.shopping.blocking), 'blocking is present per alias');
  assert.equal(r.byAlias.shopping.blocking.length, 0, 'a valid config has no blocking errors');
});
