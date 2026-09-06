// The swap-test, mechanized: the flagship renderer must carry NO domain
// vocabulary. Any shipped field/option/computed id appearing as a quoted string
// literal in showroom-view.mjs is a leak — the view should render by L0 category
// and presentation affordances (render/swatch/badge), never by field/option id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const web = (f) => readFile(join(here, '..', 'web', f), 'utf8');
const loadModel = async (id) => Promise.all([
  readFile(join(here, '..', 'web', 'models', id, 'data-model.json'), 'utf8').then(JSON.parse),
  readFile(join(here, '..', 'web', 'models', id, 'presentation-model.json'), 'utf8').then(JSON.parse),
]);

const src = await web('showroom-view.mjs');
const quoted = new Set([...src.matchAll(/'([^'\\\n]+)'|"([^"\\\n]+)"/g)].map((m) => m[1] ?? m[2]));

// the leak surface is FIELD + OPTION ids (what the view used to branch on); computed
// ids are referenced only through outputs (by dynamic id), so they are not included —
// and they collide with generic CSS class names (e.g. an "otr" total class).
const ids = new Set();
for (const id of ['vehicles', 'antiques']) {
  const [d] = await loadModel(id);
  for (const f of d.fields || []) { ids.add(f.id); for (const o of f.options || []) ids.add(o.id); }
}
// tokens that are generic code / CSS / measure words, not a domain leak even if an id coincides
const GENERIC = new Set(['id', 'type', 'number', 'choice', 'boolean', 'multichoice', 'label', 'value', 'width', 'height', 'weight', 'none']);

test('showroom-view.mjs contains no quoted domain field/option id', () => {
  const leaks = [...quoted].filter((q) => ids.has(q) && !GENERIC.has(q));
  assert.deepEqual(leaks.sort(), [], `domain vocabulary leaked into showroom-view.mjs: ${leaks.join(', ')}`);
});

test('the de-leaked visual affordances now live in presentation DATA', async () => {
  const [, vp] = await loadModel('vehicles');
  const colour = vp.fields.find((f) => f.id === 'colour');
  assert.equal(colour.render, 'swatch');
  assert.ok((colour.options || []).every((o) => Array.isArray(o.swatch)), 'every colour option declares a swatch gradient');
  assert.equal(vp.fields.find((f) => f.id === 'wheels').render, 'glyph');
  assert.equal(vp.fields.find((f) => f.id === 'deposit').render, 'track');
  assert.ok((vp.fields.find((f) => f.id === 'packages').options || []).some((o) => o.badge), 'a package option is flagged badge:true');
});
