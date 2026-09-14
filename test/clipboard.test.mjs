import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createClipboard,
  pasteSource,
  pixelPasteSource,
} from '../src/state/clipboard.js';

const EMPTY = { items: [], text: '', pixels: null, written: false };

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

// A 2×1 float: one red texel, one clear.
const art = () => ({
  width: 2,
  height: 1,
  data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]),
  opaque: 1,
});

/** A slice holding art(), its system clipboard write succeeded or failed. */
const heldPixels = (written) => {
  const c = createClipboard();
  c.setPixels(art(), 4, 5);
  if (written) c.markWritten(c.get().pixels);
  return c.get();
};

test('the slice records references and the text written for them; clear empties it', () => {
  const c = createClipboard();
  assert.deepEqual(c.get(), EMPTY);
  c.set([{ kind: 'doc', id: 'd1', extra: 1 }], 'Car');
  assert.deepEqual(c.get().items, [{ kind: 'doc', id: 'd1' }], 'references alone');
  assert.equal(c.get().text, 'Car');
  c.clear();
  assert.deepEqual(c.get(), EMPTY);
});

test('one clipboard: a pixel copy empties the items and the text, and an item copy empties the pixels', () => {
  const c = createClipboard();
  c.set([{ kind: 'doc', id: 'd1' }], 'Car');
  const data = new Uint8ClampedArray([10, 20, 30, 255, 0, 0, 0, 0]);
  c.setPixels({ width: 2, height: 1, data, opaque: 1 }, -3, 5);
  const { items, text, pixels } = c.get();
  assert.deepEqual(items, []);
  assert.equal(text, '');
  assert.equal(pixels.x, -3, 'a place off the tile is kept');
  assert.equal(pixels.y, 5);
  assert.equal(pixels.float.width, 2);
  assert.equal(pixels.float.height, 1);
  assert.equal(pixels.float.opaque, 1);
  assert.deepEqual([...pixels.float.data], [10, 20, 30, 255, 0, 0, 0, 0]);
  data[0] = 99;
  assert.equal(pixels.float.data[0], 10, 'the slice holds a copy of the texels');

  c.set([{ kind: 'folder', id: 'f1' }], 'Vehicles');
  assert.equal(c.get().pixels, null);
  assert.deepEqual(c.get().items, [{ kind: 'folder', id: 'f1' }]);
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

test('pixelPasteSource: an unreadable system falls back to the pixels, or nothing', () => {
  assert.equal(pixelPasteSource(heldPixels(true), null), 'pixels');
  assert.equal(pixelPasteSource(EMPTY, null), 'none');
  assert.equal(pixelPasteSource(held(), null), 'none', 'items are not pixels');
});

test('pixelPasteSource: an image that is the pixels picks the pixels; any other image picks the image', () => {
  assert.equal(pixelPasteSource(heldPixels(true), { image: art() }), 'pixels');
  const other = art();
  other.data[1] = 1;
  assert.equal(pixelPasteSource(heldPixels(true), { image: other }), 'image');
  assert.equal(pixelPasteSource(held(), { image: art() }), 'image', 'with items held');
  assert.equal(pixelPasteSource(EMPTY, { image: art() }), 'image', 'with nothing held');
});

test('pixelPasteSource: no image is nothing, unless the pixels’ write failed', () => {
  assert.equal(pixelPasteSource(heldPixels(true), { image: null }), 'none');
  assert.equal(pixelPasteSource(heldPixels(false), { image: null }), 'pixels');
  assert.equal(pixelPasteSource(held(), { image: null }), 'none');
});
