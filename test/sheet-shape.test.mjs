import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sheetShape } from '../src/lib/sheet-shape.js';

test('a 3×2 atlas of square tiles within the tile range reads its tile', () => {
  assert.deepEqual(sheetShape(120, 80), { tile: 40 });
  assert.deepEqual(sheetShape(6, 4), { tile: 2 });
  assert.deepEqual(sheetShape(192, 128), { tile: 64 });
  assert.deepEqual(sheetShape(3, 2), { tile: 1 }, 'the smallest tile');
});

test('anything else is refused with a reason and no tile', () => {
  const refused = (w, h) => {
    const r = sheetShape(w, h);
    assert.equal(r.tile, undefined, `${w}×${h} has no tile`);
    assert.ok(typeof r.reason === 'string' && r.reason.length, `${w}×${h} says why`);
  };
  refused(195, 130); // square 65 px tiles, above TILE_MAX
  refused(120, 81); // not 3:2
  refused(121, 80); // not divisible
  refused(640, 480); // a photo
  refused(0, 0);
  refused(-6, -4);
  refused(6.5, 4.5);
  refused(NaN, 4);
});
