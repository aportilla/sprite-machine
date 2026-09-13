import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LAYER_MAX } from 'sprite-machine';
import { sheetShape, sheetLayers } from '../src/lib/sheet-shape.js';

test('a 3t × 2tN sheet of square tiles within the tile range reads its tile and layer count', () => {
  assert.deepEqual(sheetShape(120, 80), { tile: 40, layers: 1 });
  assert.deepEqual(sheetShape(6, 4), { tile: 2, layers: 1 });
  assert.deepEqual(sheetShape(192, 128), { tile: 64, layers: 1 });
  assert.deepEqual(sheetShape(3, 2), { tile: 1, layers: 1 }, 'the smallest tile');
  assert.deepEqual(sheetShape(6, 8), { tile: 2, layers: 2 });
  assert.deepEqual(sheetShape(192, 128 * LAYER_MAX), { tile: 64, layers: LAYER_MAX });
});

test('anything else is refused with a reason and no tile, and opens as one layer', () => {
  const refused = (w, h) => {
    const r = sheetShape(w, h);
    assert.equal(r.tile, undefined, `${w}×${h} has no tile`);
    assert.ok(typeof r.reason === 'string' && r.reason.length, `${w}×${h} says why`);
    assert.equal(sheetLayers(w, h), 1);
  };
  refused(195, 130); // square 65 px tiles, above TILE_MAX
  refused(120, 81); // not 3:2
  refused(6, 5); // 3t × (2t + 1)
  refused(6, 4 * (LAYER_MAX + 1)); // a layer past the cap
  refused(121, 80); // not divisible
  refused(640, 480); // a photo
  refused(0, 0);
  refused(-6, -4);
  refused(6.5, 4.5);
  refused(NaN, 4);
  assert.equal(sheetLayers(6, 12), 3);
});
