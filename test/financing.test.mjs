// The financing model computes THREE payment modes from the bound price + term/deposit:
// mode 0 = cash (nothing financed), mode 1 = finance (amortised loan), mode 2 = lease
// (residual method: depreciation + rent on the money factor). Bound `mode` comes from the
// vehicle's paymentMode. Also checks VM==reference parity for a lease config.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assemble, mergeModel, loadEngine, referenceEvaluate } from '../web/assembler.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const readJson = (p) => readFile(join(root, '..', p), 'utf8').then(JSON.parse);
const wasm = await readFile(join(root, '..', 'build', 'quote.wasm'));
const model = mergeModel(await readJson('web/models/financing/data-model.json'), await readJson('web/models/financing/presentation-model.json'));
const asm = assemble(model);
const engine = await loadEngine(wasm, asm);
const near = (a, b, eps = 0.5) => Math.abs(a - b) <= eps;
const ev = (mode) => referenceEvaluate(asm.ir, { price: 50000, deposit: 0, termMonths: 36, mode }).valueById;

test('cash (mode 0): nothing financed', () => {
  const r = ev(0);
  assert.equal(r.monthly, 0);
  assert.equal(r.financeCharge, 0);
});

test('finance (mode 1): amortised loan', () => {
  const r = ev(1);
  // €50,000 over 36 months at 7.9% APR ≈ €1,565/mo
  assert.ok(near(r.monthly, 1565, 2), `loan monthly ${r.monthly}`);
  // cost of financing = total interest + €495 arrangement fee
  assert.ok(near(r.financeCharge, r.totalPayable - 50000 + 495, 1), `financeCharge ${r.financeCharge}`);
});

test('lease (mode 2): residual method — depreciation + rent, cheaper monthly than a loan', () => {
  const r = ev(2);
  // residual % at 36mo = 0.80 - 36*0.00625 = 0.575 → €28,750 on a €50,000 car
  assert.ok(near(r.residualValue, 28750, 1), `residualValue ${r.residualValue}`);
  // depreciation = (50000 - 28750)/36 ≈ 590.3 ; rent = (50000+28750)*(0.079/24) ≈ 259.2
  assert.ok(near(r.leaseDeprec, 590.28, 1), `leaseDeprec ${r.leaseDeprec}`);
  assert.ok(near(r.leaseRent, 259.22, 1), `leaseRent ${r.leaseRent}`);
  assert.ok(near(r.monthly, r.leaseDeprec + r.leaseRent, 0.5), `lease monthly = deprec + rent (${r.monthly})`);
  assert.ok(r.monthly < ev(1).monthly, 'a lease payment is lower than the equivalent loan payment');
  // you never pay the full price on a lease — total outlay is depreciation + rent (+ deposit)
  assert.ok(r.totalPayable < 50000, `lease total payable ${r.totalPayable} < price`);
});

test('a bigger deposit lowers the lease payment (adjusted cap cost)', () => {
  const base = ev(2).monthly;
  const withDeposit = referenceEvaluate(asm.ir, { price: 50000, deposit: 10000, termMonths: 36, mode: 2 }).valueById.monthly;
  assert.ok(withDeposit < base, `deposit lowers lease monthly (${withDeposit} < ${base})`);
});

test('a longer term lowers the residual % (and monthly depreciation)', () => {
  const r36 = referenceEvaluate(asm.ir, { price: 50000, deposit: 0, termMonths: 36, mode: 2 }).valueById;
  const r60 = referenceEvaluate(asm.ir, { price: 50000, deposit: 0, termMonths: 60, mode: 2 }).valueById;
  assert.ok(r60.residualValue < r36.residualValue, 'residual value falls with a longer term');
});

test('parity: a lease config evaluates identically in the WASM VM and the JS oracle', () => {
  const cfg = { price: 74000, deposit: 8000, termMonths: 48, mode: 2 };
  const R = referenceEvaluate(asm.ir, cfg), W = engine.evaluate(cfg);
  for (const [id] of asm.ir.slotOf) assert.ok(near(R.valueById[id], W.valueById[id], 1e-4), `${id}: ref=${R.valueById[id]} wasm=${W.valueById[id]}`);
});
