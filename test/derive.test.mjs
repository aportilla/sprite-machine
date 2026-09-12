import { test } from 'node:test';
import assert from 'node:assert/strict';

import { editorViewModel } from '../src/state/derive.js';

const tile = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });

function setPx(img, x, y, [r, g, b, a = 255]) {
  const i = (y * img.width + x) * 4;
  img.data[i] = r;
  img.data[i + 1] = g;
  img.data[i + 2] = b;
  img.data[i + 3] = a;
}

const alphaAt = (img, x, y) => img.data[(y * img.width + x) * 4 + 3];

test('editorViewModel: own art by IDENTITY; no art a fresh blank tile, derived; mirrorBehind the OPPOSITE face mirrored, or null', () => {
  const front = tile(2, 2);
  setPx(front, 0, 0, [255, 0, 0]);
  const own = editorViewModel({ views: { front }, tileW: 2, tileH: 2 }, 'front');
  assert.equal(own.tile, front, 'the exact same reference — the identity contract');
  assert.equal(own.wasDerived, false);

  const blank = editorViewModel({ views: {}, tileW: 3, tileH: 3 }, 'left');
  assert.equal(blank.wasDerived, true);
  assert.deepEqual([blank.tile.width, blank.tile.height], [3, 3]);
  assert.ok(
    blank.tile.data.every((b) => b === 0),
    'fully transparent'
  );

  const back = tile(2, 2);
  setPx(back, 1, 1, [0, 255, 0]);
  const vm = editorViewModel({ views: { back }, tileW: 2, tileH: 2 }, 'front');
  // MIRROR_AXIS is 'x', so back's (1,1) shows at (0,1).
  assert.equal(alphaAt(vm.mirrorBehind, 0, 1), 255);
  assert.equal(alphaAt(vm.mirrorBehind, 1, 1), 0);
  const vm2 = editorViewModel({ views: { back }, tileW: 2, tileH: 2 }, 'top');
  assert.equal(vm2.mirrorBehind, null, 'bottom has no art of its own');
});
