// The framework CONTRACT, enforced as tests (the same checks scripts/check-neutral.mjs
// runs in the build): neutrality (no domain vocab in the neutral machinery, on a
// lower-only ratchet), vocab-drift (schemas mirror hqdm-core; registries resolve),
// and coverage (every shipped model round-trips split→merge losslessly).
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkNeutrality, checkDrift, checkCoverage } from '../scripts/check-neutral.mjs';

test('NEUTRALITY: the neutral machinery carries no domain vocab beyond the ratchet', async () => {
  const r = await checkNeutrality();
  assert.deepEqual(r.errors, [], r.errors.join(' | '));
});

test('DRIFT: schemas mirror hqdm-core; every registry symbol resolves', async () => {
  const r = await checkDrift();
  assert.deepEqual(r.errors, [], r.errors.join(' | '));
});

test('COVERAGE: every shipped model round-trips split→merge with no key loss', async () => {
  const r = await checkCoverage();
  assert.deepEqual(r.errors, [], r.errors.join(' | '));
});
