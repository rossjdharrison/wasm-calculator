// offer.mjs — "is a saved offer still valid against the CURRENT models?" A journey
// seals an opaque offer snapshot on the StepDone of a `sealsOffer` step; checkOffer
// grades it: version match = valid (no recompute), version drift = re-run the committed
// inputs and expire only on a MATERIAL change (structural break or price move > tolerance).
// Grandfathers legacy/unsealed orders as 'draft' (never expired).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assemble, mergeModel } from '../web/assembler.mjs';
import { EngineHost, evaluateJourney } from '../web/compose.mjs';
import * as order from '../web/order.mjs';
import { sealedOffer, checkOffer } from '../web/offer.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const wasm = await readFile(join(here, '..', 'build', 'quote.wasm'));
const readJson = (p) => readFile(join(here, '..', p), 'utf8').then(JSON.parse);
const loadModel = async (id) => {
  const merged = mergeModel(await readJson(`web/models/${id}/data-model.json`), await readJson(`web/models/${id}/presentation-model.json`));
  return { merged, assembled: assemble(merged) };
};

const journey = await readJson('web/journeys/vehicle-sale.json');
const models = { shopping: await loadModel('vehicles'), shipping: await loadModel('shipping'), insurance: await loadModel('insurance'), financing: await loadModel('financing') };
const shopCfg = { model: 'hotHatch', trim: 'standard', engine: 'electric', drivetrain: 'fwd', wheels: 'w17', colour: 'solid', packages: [], financing: 'finance' };
const versions = Object.fromEntries(Object.entries(models).map(([a, m]) => [a, (m.merged && m.merged.version) || null]));
const host = new EngineHost(wasm);

// a real committed order + its real offer figures (the seal baseline).
const real = await evaluateJourney(journey, models, host, { shopping: shopCfg });
const realLines = real.lines.filter((l) => l.amount != null).map((l) => ({ alias: l.alias, amount: l.amount, currency: l.currency }));

// build a committed vehicle-sale log; optionally seal an offer on the `sign` StepDone.
function log(offer, { stamp = true } = {}) {
  let events = stamp ? order.startOrder('T-1', journey.id, journey.version, versions) : order.startOrder('T-1', journey.id, journey.version);
  for (const [f, v] of Object.entries(shopCfg)) events = order.apply(events, { type: 'set', alias: 'shopping', field: f, value: v }).events;
  events = order.apply(events, { type: 'commit', alias: 'shopping', hash: 'h' }).events;
  if (offer) events = order.apply(events, { type: 'complete', step: 'sign', payload: { by: 'Tester', offer } }).events;
  return events;
}
const seal = (over = {}) => ({ totalsByCurrency: { ...real.totalsByCurrency }, lines: realLines, modelVersions: versions, journeyVersion: journey.version, ...over });

test('startOrder stamps modelVersions and fold carries it (omitted -> null)', () => {
  assert.deepEqual(order.fold(order.startOrder('o', 'j', '1.0.0', { a: '1.0.0' })).modelVersions, { a: '1.0.0' });
  assert.equal(order.fold(order.startOrder('o', 'j', '1.0.0')).modelVersions, null);
});

test('sealedOffer returns the last sealed snapshot (or null)', () => {
  assert.equal(sealedOffer(log(null)), null);
  const s = sealedOffer(log(seal()));
  assert.ok(s && s.totalsByCurrency && s.journeyVersion === journey.version);
});

test('versions unchanged -> valid via the cheap gate (no recompute)', async () => {
  const v = await checkOffer(log(seal()), journey, models, host);
  assert.equal(v.status, 'valid');
  assert.equal(v.current, null, 'short-circuited: no recompute happened');
});

test('version drift but no material change -> valid (recomputed)', async () => {
  const v = await checkOffer(log(seal({ journeyVersion: `${journey.version}-old` })), journey, models, host);
  assert.equal(v.status, 'valid');
  assert.ok(v.current, 'a recompute was performed');
});

test('price moved beyond tolerance -> expired', async () => {
  const inflated = { EUR: real.totalsByCurrency.EUR * 1.5 };
  const v = await checkOffer(log(seal({ totalsByCurrency: inflated, journeyVersion: `${journey.version}-old` })), journey, models, host);
  assert.equal(v.status, 'expired');
  assert.match(v.reason, /price changed/);
});

test('a sealed currency the current models no longer produce -> expired', async () => {
  const withGhost = { ...real.totalsByCurrency, GBP: 1000 };
  const v = await checkOffer(log(seal({ totalsByCurrency: withGhost, journeyVersion: `${journey.version}-old` })), journey, models, host);
  assert.equal(v.status, 'expired');
  assert.match(v.reason, /GBP/);
});

test('a new currency total that appears now -> expired', async () => {
  const v = await checkOffer(log(seal({ totalsByCurrency: {}, journeyVersion: `${journey.version}-old` })), journey, models, host);
  assert.equal(v.status, 'expired');
  assert.match(v.reason, /new .* total/);
});

test('never sealed -> draft (resume live)', async () => {
  const v = await checkOffer(log(null), journey, models, host);
  assert.equal(v.status, 'draft');
});

test('legacy order (no version stamp, no seal) -> draft, never expired', async () => {
  const v = await checkOffer(log(null, { stamp: false }), journey, models, host);
  assert.equal(v.status, 'draft');
});
