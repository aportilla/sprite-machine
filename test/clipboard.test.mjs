// Node-runnable tests for the clipboard slice — the in-app half of Copy /
// Paste, and the one selector that decides what a paste pastes off a read
// of the system clipboard.
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createClipboard, pasteSource } from '../src/state/clipboard.js';

const held = () => {
  const c = createClipboard();
  c.set(
    [
      { kind: 'folder', id: 'f1' },
      { kind: 'doc', id: 'd1' },
    ],
    'Vehicles\nCar'
  );
  return c.get();
};

test('the slice records references and the text written for them; clear empties it', () => {
  const c = createClipboard();
  assert.deepEqual(c.get(), { items: [], text: '' });
  c.set([{ kind: 'doc', id: 'd1', extra: 1 }], 'Car');
  assert.deepEqual(c.get().items, [{ kind: 'doc', id: 'd1' }], 'references alone');
  assert.equal(c.get().text, 'Car');
  c.clear();
  assert.deepEqual(c.get(), { items: [], text: '' });
});

test('pasteSource: the slice’s items win when the system’s text is the text it wrote', () => {
  const slice = held();
  assert.equal(pasteSource(slice, { text: 'Vehicles\nCar', image: null }), 'items');
  assert.equal(
    pasteSource(slice, { text: 'Vehicles\r\nCar\r\n', image: {} }),
    'items',
    'line endings and a trailing newline the trip rewrote still match, over an image'
  );
});

test('pasteSource: a foreign image wins over stale items; foreign text or an empty read is nothing', () => {
  const slice = held();
  assert.equal(pasteSource(slice, { text: 'elsewhere', image: {} }), 'image');
  assert.equal(pasteSource(slice, { text: null, image: {} }), 'image');
  assert.equal(pasteSource(slice, { text: 'elsewhere', image: null }), 'none');
  assert.equal(pasteSource(slice, { text: null, image: null }), 'none');
});

test('pasteSource: an unreadable system falls back to the items as they stand', () => {
  assert.equal(pasteSource(held(), null), 'items');
  assert.equal(pasteSource({ items: [], text: '' }, null), 'none');
  assert.equal(
    pasteSource({ items: [], text: '' }, { text: '', image: null }),
    'none',
    'an empty slice never matches an empty read'
  );
});
