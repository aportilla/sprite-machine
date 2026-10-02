import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createClipboard, pixelPasteSource } from '../src/state/clipboard.js';

const EMPTY = { pixels: null, written: false };

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

test('a pixel copy keeps a copy of the texels and their place, off the tile too; clear empties it', () => {
  const c = createClipboard();
  assert.deepEqual(c.get(), EMPTY);
  const data = new Uint8ClampedArray([10, 20, 30, 255, 0, 0, 0, 0]);
  c.setPixels({ width: 2, height: 1, data, opaque: 1 }, -3, 5);
  const { pixels } = c.get();
  assert.equal(pixels.x, -3, 'a place off the tile is kept');
  assert.equal(pixels.y, 5);
  assert.equal(pixels.float.width, 2);
  assert.equal(pixels.float.height, 1);
  assert.equal(pixels.float.opaque, 1);
  assert.deepEqual([...pixels.float.data], [10, 20, 30, 255, 0, 0, 0, 0]);
  data[0] = 99;
  assert.equal(pixels.float.data[0], 10, 'the slice holds a copy of the texels');
  c.clear();
  assert.deepEqual(c.get(), EMPTY);
});

test('markWritten applies only to the pixels it names', () => {
  const c = createClipboard();
  c.setPixels(art(), 0, 0);
  const first = c.get().pixels;
  c.setPixels(art(), 1, 1);
  c.markWritten(first);
  assert.equal(c.get().written, false, 'a newer copy is not marked by an older write');
  c.markWritten(c.get().pixels);
  assert.equal(c.get().written, true);
});

test('pixelPasteSource: an unreadable system falls back to the pixels, or nothing', () => {
  assert.equal(pixelPasteSource(heldPixels(true), null), 'pixels');
  assert.equal(pixelPasteSource(EMPTY, null), 'none');
});

test('pixelPasteSource: an image that is the pixels picks the pixels; any other image picks the image', () => {
  assert.equal(pixelPasteSource(heldPixels(true), { image: art() }), 'pixels');
  const other = art();
  other.data[1] = 1;
  assert.equal(pixelPasteSource(heldPixels(true), { image: other }), 'image');
  assert.equal(pixelPasteSource(EMPTY, { image: art() }), 'image', 'with nothing held');
});

test('pixelPasteSource: no image is nothing, unless the pixels’ write failed', () => {
  assert.equal(pixelPasteSource(heldPixels(true), { image: null }), 'none');
  assert.equal(pixelPasteSource(heldPixels(false), { image: null }), 'pixels');
  assert.equal(pixelPasteSource(EMPTY, { image: null }), 'none');
});
