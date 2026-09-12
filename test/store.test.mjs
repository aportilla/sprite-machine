import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from '../src/state/store.js';

test('get returns the current snapshot; patch replaces it', () => {
  const s = createStore({ a: 1, b: 'x' });
  assert.deepEqual(s.get(), { a: 1, b: 'x' });
  const before = s.get();
  s.patch({ a: 2 });
  assert.deepEqual(s.get(), { a: 2, b: 'x' });
  assert.notEqual(s.get(), before, 'a patch produces a NEW snapshot object');
  assert.deepEqual(before, { a: 1, b: 'x' }, 'the old snapshot is untouched');
});

test('an Object.is-equal patch is a silent no-op (no new object, no notify)', () => {
  const buf = new Uint8ClampedArray(4);
  const s = createStore({ n: 1, buf });
  const snap = s.get();
  let calls = 0;
  s.subscribe(() => calls++);
  s.patch({ n: 1 });
  s.patch({ buf }); // same reference
  assert.equal(calls, 0);
  assert.equal(s.get(), snap, 'snapshot identity unchanged');
});
