// Tests for the WASM quote engine. Run with: npm test
// (the `pretest` script builds build/quote.wasm first).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, '..', 'build', 'quote.wasm');

const bytes = await readFile(wasmPath);
const { instance } = await WebAssembly.instantiate(bytes, {
  env: { abort() {}, trace() {}, seed: () => 0 },
});
const q = instance.exports;

// Flag bits — mirror of assembly/quote.ts.
const FLAG = { SCREEN: 1, DTG: 2, EMB: 4, COLORS: 8, RUSH: 16, MEMBER: 32 };

function quote(i) {
  q.compute(i.quantity, i.tier, i.method, i.locations, i.colors, i.rush, i.member);
  return {
    unitPrice: q.getUnitPrice(),
    subtotal: q.getSubtotal(),
    discountRate: q.getDiscountRate(),
    discountAmount: q.getDiscountAmount(),
    rushFee: q.getRushFee(),
    tax: q.getTax(),
    total: q.getTotal(),
    flags: q.getFlags(),
    maxColors: q.getMaxColors(),
    maxLocations: q.getMaxLocations(),
    validation: q.getValidation(),
  };
}
const near = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps;

test('100 standard screen-print, 1 location, 2 colours', () => {
  const o = quote({ quantity: 100, tier: 0, method: 0, locations: 1, colors: 2, rush: 0, member: 0 });
  assert.ok(near(o.unitPrice, 7.9), `unitPrice=${o.unitPrice}`);
  assert.ok(near(o.subtotal, 790), `subtotal=${o.subtotal}`);
  assert.ok(near(o.discountRate, 0.12), `discountRate=${o.discountRate}`);
  assert.ok(near(o.discountAmount, 94.8), `discountAmount=${o.discountAmount}`);
  assert.ok(near(o.rushFee, 0));
  assert.ok(near(o.tax, 55.616), `tax=${o.tax}`);
  assert.ok(near(o.total, 750.816), `total=${o.total}`);
  assert.equal(o.flags, FLAG.SCREEN | FLAG.DTG | FLAG.EMB | FLAG.COLORS | FLAG.RUSH);
  assert.equal(o.maxColors, 6);
  assert.equal(o.maxLocations, 4);
  assert.equal(o.validation, 0);
});

test('10 premium DTG, 2 locations, rush + member', () => {
  const o = quote({ quantity: 10, tier: 1, method: 1, locations: 2, colors: 0, rush: 1, member: 1 });
  assert.ok(near(o.unitPrice, 18.5), `unitPrice=${o.unitPrice}`);
  assert.ok(near(o.subtotal, 185), `subtotal=${o.subtotal}`);
  assert.ok(near(o.discountRate, 0.1), `discountRate=${o.discountRate}`);
  assert.ok(near(o.discountAmount, 18.5), `discountAmount=${o.discountAmount}`);
  assert.ok(near(o.rushFee, 33.3), `rushFee=${o.rushFee}`);
  assert.ok(near(o.tax, 15.984), `tax=${o.tax}`);
  assert.ok(near(o.total, 215.784), `total=${o.total}`);
  assert.equal(o.flags, FLAG.DTG | FLAG.EMB | FLAG.RUSH | FLAG.MEMBER);
  assert.equal(o.maxColors, 0);
  assert.equal(o.maxLocations, 4);
  assert.equal(o.validation, 0);
});

test('screen print below the minimum quantity is not available', () => {
  const o = quote({ quantity: 8, tier: 0, method: 0, locations: 1, colors: 2, rush: 0, member: 0 });
  assert.equal(o.flags & FLAG.SCREEN, 0, 'screen flag should be off below min qty');
  assert.equal(o.validation, 1, 'should report below-min-qty');
});

test('embroidery caps locations at 2 and disables rush', () => {
  const o = quote({ quantity: 50, tier: 2, method: 2, locations: 4, colors: 3, rush: 1, member: 0 });
  assert.equal(o.maxLocations, 2, 'embroidery max locations');
  assert.equal(o.flags & FLAG.RUSH, 0, 'rush unavailable for embroidery');
  assert.equal(o.flags & FLAG.COLORS, 0, 'colours not applicable to embroidery');
  assert.equal(o.validation, 3, 'too many locations for embroidery');
});

test('stacked discounts are capped at 50%', () => {
  // 500+ units => 25% volume, +10% member = 35% (under the cap, sanity check).
  const o = quote({ quantity: 500, tier: 0, method: 1, locations: 1, colors: 0, rush: 0, member: 1 });
  assert.ok(o.discountRate <= 0.5 + 1e-9, `discountRate=${o.discountRate}`);
  assert.ok(near(o.discountRate, 0.35), `discountRate=${o.discountRate}`);
});
