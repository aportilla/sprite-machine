import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  appendBlock,
  removeBlock,
  moveBlock,
  defaultLayerName,
  nextLayerName,
  fitLayerNames,
  compositeTiles,
} from '../src/lib/layers.js';

// A 1-px-wide sheet whose row y is filled with the value y + 1.
const striped = (height) => {
  const data = new Uint8ClampedArray(height * 4);
  for (let y = 0; y < height; y++) data.fill(y + 1, y * 4, (y + 1) * 4);
  return { width: 1, height, data };
};
const rowValues = (img) => Array.from({ length: img.height }, (_, y) => img.data[y * 4]);

test('appendBlock adds a transparent block at the bottom; removeBlock cuts one block’s rows out', () => {
  const two = striped(4); // two blocks of 2 rows
  const three = appendBlock(two, 2);
  assert.deepEqual([three.width, three.height], [1, 6]);
  assert.deepEqual(rowValues(three), [1, 2, 3, 4, 0, 0]);
  assert.deepEqual(rowValues(removeBlock(three, 0, 2)), [3, 4, 0, 0]);
  assert.deepEqual(rowValues(removeBlock(three, 1, 2)), [1, 2, 0, 0]);
  assert.deepEqual(rowValues(removeBlock(three, 2, 2)), [1, 2, 3, 4]);
  assert.deepEqual(rowValues(two), [1, 2, 3, 4], 'the source is untouched');
});

test('moveBlock puts one block at a new index and shifts the ones between; rows past the last block stay', () => {
  const three = striped(7); // three blocks of 2 rows and a remainder row
  assert.deepEqual(rowValues(moveBlock(three, 0, 1, 2)), [3, 4, 1, 2, 5, 6, 7]);
  assert.deepEqual(rowValues(moveBlock(three, 2, 1, 2)), [1, 2, 5, 6, 3, 4, 7]);
  assert.deepEqual(rowValues(moveBlock(three, 0, 2, 2)), [3, 4, 5, 6, 1, 2, 7]);
  assert.deepEqual(rowValues(moveBlock(three, 2, 0, 2)), [5, 6, 1, 2, 3, 4, 7]);
  assert.deepEqual(rowValues(moveBlock(three, 1, 1, 2)), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(rowValues(three), [1, 2, 3, 4, 5, 6, 7], 'the source is untouched');
});

test('layer names: the default is numbered from 1; New Layer counts up from its own number past names in use; a chunk’s names are fitted to the count', () => {
  assert.equal(defaultLayerName(0), 'Layer 1');
  assert.equal(nextLayerName(['Layer 1']), 'Layer 2');
  assert.equal(nextLayerName(['Body']), 'Layer 2');
  assert.equal(nextLayerName(['Layer 1', 'Layer 3']), 'Layer 4');
  assert.equal(nextLayerName(['Layer 2']), 'Layer 3');
  assert.deepEqual(fitLayerNames(['Body', '', 'Extra'], 2), ['Body', 'Layer 2']);
  assert.deepEqual(fitLayerNames(null, 2), ['Layer 1', 'Layer 2']);
});

test('compositeTiles lays each tile over the ones before it and skips nulls; null when there is nothing to lay', () => {
  const px = (rgba) => ({ width: 1, height: 1, data: Uint8ClampedArray.from(rgba) });
  const red = px([255, 0, 0, 255]);
  const blue = px([0, 0, 255, 255]);
  const clear = px([0, 0, 0, 0]);
  assert.deepEqual([...compositeTiles([red, null, blue]).data], [0, 0, 255, 255]);
  assert.deepEqual([...compositeTiles([blue, clear, red]).data], [255, 0, 0, 255]);
  assert.deepEqual([...compositeTiles([red, clear]).data], [255, 0, 0, 255]);
  const half = compositeTiles([red, px([0, 0, 255, 51])]).data;
  assert.deepEqual([...half], [204, 0, 51, 255], 'a partial alpha blends');
  assert.equal(compositeTiles([null, null]), null);
  assert.equal(compositeTiles([]), null);
  assert.notEqual(compositeTiles([red]).data, red.data, 'always a new tile');
});
