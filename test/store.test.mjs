// Node-runnable tests for the observable store the state slices build on.
// Run: node --test
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

test('subscribers are notified synchronously with the new state', () => {
  const s = createStore({ n: 0 });
  const seen = [];
  s.subscribe((st) => seen.push(st.n));
  s.patch({ n: 1 });
  s.patch({ n: 2 });
  assert.deepEqual(seen, [1, 2]);
});

test('an Object.is-equal patch is a silent no-op (no new object, no notify)', () => {
  const buf = new Uint8ClampedArray(4);
  const s = createStore({ n: 1, buf });
  const snap = s.get();
  let calls = 0;
  s.subscribe(() => calls++);
  s.patch({ n: 1 });
  s.patch({ buf }); // same reference — identity, not deep equality
  assert.equal(calls, 0);
  assert.equal(s.get(), snap, 'snapshot identity unchanged');
});

test('values are held by reference, never cloned', () => {
  const buf = new Uint8ClampedArray([1, 2, 3, 4]);
  const s = createStore({ buf: null });
  s.patch({ buf });
  assert.equal(s.get().buf, buf);
});

test('unsubscribe stops notifications', () => {
  const s = createStore({ n: 0 });
  let calls = 0;
  const unsub = s.subscribe(() => calls++);
  s.patch({ n: 1 });
  unsub();
  s.patch({ n: 2 });
  assert.equal(calls, 1);
});

test('a patch with one changed key among equal ones still notifies once', () => {
  const s = createStore({ a: 1, b: 2 });
  let calls = 0;
  s.subscribe(() => calls++);
  s.patch({ a: 1, b: 3 });
  assert.equal(calls, 1);
  assert.deepEqual(s.get(), { a: 1, b: 3 });
});
