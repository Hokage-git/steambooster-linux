import test from 'node:test';
import assert from 'node:assert/strict';

import { extractEvaluationValue, normalizeProbe, pickMainTarget } from '../probe.mjs';

test('pickMainTarget selects the exact Steam page', () => {
  const targets = [
    { type: 'page', title: 'Steam Root Menu', id: 'menu' },
    { type: 'page', title: 'Steam', id: 'main' },
    { type: 'page', title: 'Shopping Cart', id: 'cart' },
  ];
  assert.equal(pickMainTarget(targets)?.id, 'main');
});

test('pickMainTarget ignores non-page Steam targets', () => {
  const targets = [{ type: 'worker', title: 'Steam', id: 'worker' }];
  assert.equal(pickMainTarget(targets), undefined);
});

test('pickMainTarget safely rejects non-array target data', () => {
  assert.equal(pickMainTarget({ broken: true }), undefined);
});

test('normalizeProbe keeps a stable boolean JSON contract', () => {
  assert.deepEqual(normalizeProbe({ steam: 1, main: 0, button: 'yes' }), {
    steam_available: true,
    cdp_available: false,
    main_available: false,
    button_present: true,
    generation: null,
  });
});

test('extractEvaluationValue parses the matching CDP reply', () => {
  assert.equal(extractEvaluationValue(JSON.stringify({
    id: 1,
    result: { result: { value: true } },
  })), true);
});

test('extractEvaluationValue rejects malformed websocket JSON', () => {
  assert.throws(() => extractEvaluationValue('{broken'));
});
