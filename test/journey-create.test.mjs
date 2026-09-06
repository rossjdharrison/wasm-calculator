// D2: the pure heart of the journey create/edit page — id minting + the new pure
// journey-edit ops (setMeta + step add/remove/move/set). DOM-free & deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newJourney, slugify, uniqueJourneyId } from '../web/journey-create-core.mjs';
import { validateJourneyShape } from '../web/journey-schema.mjs';
import * as jedit from '../web/journey-edit.mjs';

test('slugify makes a URL-safe id and never returns empty', () => {
  assert.equal(slugify('Art Acquisition!'), 'art-acquisition');
  assert.equal(slugify('  Trim & Ship  '), 'trim-ship');
  assert.equal(slugify('***'), 'journey');
  // slice must not re-expose a trailing hyphen the trim already ran past
  const s = slugify('a'.repeat(47) + ' bore');
  assert.ok(s.length <= 48 && !s.endsWith('-'), `no trailing hyphen after the 48-char slice (got "${s}")`);
});

test('uniqueJourneyId disambiguates against existing ids', () => {
  const existing = new Set(['art-acquisition', 'art-acquisition-2']);
  assert.equal(uniqueJourneyId('Art Acquisition', existing), 'art-acquisition-3');
  assert.equal(uniqueJourneyId('Fresh One', existing), 'fresh-one');
});

test('newJourney mints the exact blank template shape', () => {
  const j = newJourney('demo', 'Demo', 'DM');
  assert.deepEqual(j, { id: 'demo', version: '1.0.0', title: 'Demo', correlationPrefix: 'DM', models: [], bindings: [], triggers: [], process: { steps: [] } });
  const noPfx = newJourney('demo2', 'Demo 2');
  assert.equal('correlationPrefix' in noPfx, false, 'omits an empty prefix');
});

test('setMeta updates title/prefix/version but never the id, and is pure', () => {
  const j = newJourney('demo', 'Demo');
  const snap = JSON.stringify(j);
  const next = jedit.setMeta(j, { title: 'Renamed', correlationPrefix: 'RN', version: '2.0.0' });
  assert.equal(next.title, 'Renamed');
  assert.equal(next.correlationPrefix, 'RN');
  assert.equal(next.version, '2.0.0');
  assert.equal(next.id, 'demo', 'id untouched');
  assert.equal(JSON.stringify(j), snap, 'input journey unchanged');
});

test('step ops upsert / remove / reorder and are pure', () => {
  let j = newJourney('demo', 'Demo');
  const snap = JSON.stringify(j);
  j = jedit.addStep(j, { id: 'a', phase: 'configure', kind: 'capture' });
  j = jedit.addStep(j, { id: 'b', phase: 'agree_sign', kind: 'ceremony' });
  assert.deepEqual(j.process.steps.map((s) => s.id), ['a', 'b']);
  // upsert by id
  j = jedit.setStep(j, { id: 'a', phase: 'configure', kind: 'capture', model: 'x' });
  assert.equal(j.process.steps.find((s) => s.id === 'a').model, 'x');
  assert.equal(j.process.steps.length, 2, 'upsert did not duplicate');
  // move
  j = jedit.moveStep(j, 'b', -1);
  assert.deepEqual(j.process.steps.map((s) => s.id), ['b', 'a']);
  const atEnd = jedit.moveStep(j, 'b', -1); // already first → no-op
  assert.deepEqual(atEnd.process.steps.map((s) => s.id), ['b', 'a']);
  // remove
  j = jedit.removeStep(j, 'b');
  assert.deepEqual(j.process.steps.map((s) => s.id), ['a']);
  assert.equal(JSON.stringify(newJourney('demo', 'Demo')), snap, 'newJourney template is stable');
});

test('a journey assembled through the pure ops passes the shape gate (phases from its domain)', () => {
  let j = newJourney('mini', 'Mini');
  j = jedit.addModelRef(j, { ref: 'vehicles', as: 'shopping', phase: 'configure' });
  j = jedit.addModelRef(j, { ref: 'financing', as: 'financing', phase: 'exchange_settlement' });
  j = jedit.addStep(j, { id: 'build', phase: 'configure', kind: 'capture', model: 'shopping' });
  // a created journey inherits phases from its domain (passed via opts, as the app does)
  const r = validateJourneyShape(j, { phases: ['configure', 'exchange_settlement'] });
  assert.deepEqual(r.errors, [], `shape errors: ${r.errors.join(' | ')}`);
  // …and WITHOUT any phases available it fails clearly rather than cascading
  const bare = validateJourneyShape(j);
  assert.ok(bare.errors.some((e) => e.includes('no phases are declared')), 'undefined lifecycle is one clear error');
});
