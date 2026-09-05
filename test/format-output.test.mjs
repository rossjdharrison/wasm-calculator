// formatOutput() — the shared output formatter with unit/currency conversion.
// The engine value is always canonical; conversion happens here. Tests pin a
// locale for determinism and cover the default (identity) + conversion paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatOutput } from '../web/ui.mjs';

const units = {
  speed: { canonical: 'mph', members: { mph: { factor: 1, system: 'imperial' }, kph: { factor: 1.609344, system: 'metric' } } },
  mass: { canonical: 'kg', members: { kg: { factor: 1, system: 'metric' }, lb: { factor: 2.2046226, system: 'imperial' } } },
};
const rates = { base: 'GBP', GBP: 1, EUR: 1.2, USD: 1.25 };
const L = 'en-GB';

test('no conversion opts → canonical value, unchanged unit/currency', () => {
  assert.equal(formatOutput({ value: 174, format: 'unit', unit: 'mph', decimals: 0, canonicalUnit: 'mph' }, { locale: L }), '174 mph');
  assert.equal(formatOutput({ value: 1910, format: 'unit', unit: 'kg', decimals: 0, canonicalUnit: 'kg' }, { locale: L }), '1,910 kg');
  assert.equal(formatOutput({ value: 100, format: 'currency', currencyCode: 'GBP', decimals: 0, baseCurrency: 'GBP' }, { locale: L }), '£100');
});

test('metric toggle: speed mph→kph, mass kg stays kg', () => {
  assert.equal(formatOutput({ value: 100, format: 'unit', unit: 'mph', decimals: 0, canonicalUnit: 'mph' }, { units, unitSystem: 'metric', locale: L }), '161 kph');
  assert.equal(formatOutput({ value: 1910, format: 'unit', unit: 'kg', decimals: 0, canonicalUnit: 'kg' }, { units, unitSystem: 'metric', locale: L }), '1,910 kg');
});

test('imperial toggle: mass kg→lb, speed mph stays mph', () => {
  assert.equal(formatOutput({ value: 100, format: 'unit', unit: 'kg', decimals: 0, canonicalUnit: 'kg' }, { units, unitSystem: 'imperial', locale: L }), '220 lb');
  assert.equal(formatOutput({ value: 174, format: 'unit', unit: 'mph', decimals: 0, canonicalUnit: 'mph' }, { units, unitSystem: 'imperial', locale: L }), '174 mph');
});

test('currency converts via rates (GBP→EUR) and defaults to base', () => {
  assert.equal(formatOutput({ value: 100, format: 'currency', currencyCode: 'GBP', decimals: 0, baseCurrency: 'GBP' }, { rates, currency: 'EUR', locale: L }), '€120');
  assert.equal(formatOutput({ value: 100, format: 'currency', currencyCode: 'GBP', decimals: 0, baseCurrency: 'GBP' }, { rates, currency: 'GBP', locale: L }), '£100');
});

test('a unit with no canonicalUnit is never converted (e.g. hp, seconds)', () => {
  assert.equal(formatOutput({ value: 120, format: 'unit', unit: 'hp', decimals: 0 }, { units, unitSystem: 'metric', locale: L }), '120 hp');
  assert.equal(formatOutput({ value: 4.032, format: 'unit', unit: 's', decimals: 1 }, { units, unitSystem: 'metric', locale: L }), '4.0 s');
});
