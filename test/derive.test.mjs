// Node-runnable tests for the pure selectors — chiefly editorViewModel, the old
// showFace() derivation. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { editorViewModel, mirrorImage } from '../src/state/derive.js';

const tile = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });

function setPx(img, x, y, [r, g, b, a = 255]) {
  const i = (y * img.width + x) * 4;
  img.data[i] = r;
  img.data[i + 1] = g;
  img.data[i + 2] = b;
  img.data[i + 3] = a;
}

const alphaAt = (img, x, y) => img.data[(y * img.width + x) * 4 + 3];

test('a face with its own art: tile by IDENTITY, not derived', () => {
  const front = tile(2, 2);
  setPx(front, 0, 0, [255, 0, 0]);
  const vm = editorViewModel({ views: { front }, tileW: 2, tileH: 2 }, 'front');
  assert.equal(vm.tile, front, 'the exact same reference — the identity contract');
  assert.equal(vm.wasDerived, false);
});

test('a face with no art: fresh blank tile, derived', () => {
  const vm = editorViewModel({ views: {}, tileW: 3, tileH: 3 }, 'left');
  assert.equal(vm.wasDerived, true);
  assert.equal(vm.tile.width, 3);
  assert.equal(vm.tile.height, 3);
  assert.ok(
    vm.tile.data.every((b) => b === 0),
    'fully transparent'
  );
});

test('mirrorBehind is the OPPOSITE face, mirrored — null when it has no own art', () => {
  const back = tile(2, 2);
  setPx(back, 1, 1, [0, 255, 0]);
  const vm = editorViewModel({ views: { back }, tileW: 2, tileH: 2 }, 'front');
  // MIRROR_AXIS is 'x': back's (1,1) shows at (0,1) behind the front canvas.
  assert.equal(alphaAt(vm.mirrorBehind, 0, 1), 255);
  assert.equal(alphaAt(vm.mirrorBehind, 1, 1), 0);
  const vm2 = editorViewModel({ views: { back }, tileW: 2, tileH: 2 }, 'top');
  assert.equal(vm2.mirrorBehind, null, 'bottom has no art of its own');
});

test('the view model carries the alignment guides for the face', () => {
  const top = tile(3, 3);
  setPx(top, 1, 0, [9, 9, 9]);
  setPx(top, 1, 2, [9, 9, 9]);
  const vm = editorViewModel({ views: { top }, tileW: 3, tileH: 3 }, 'front');
  // Editing FRONT, the TOP view's occupied column (x=1) bounds the u extent.
  assert.deepEqual(
    { uMin: vm.guides.extent.uMin, uMax: vm.guides.extent.uMax },
    { uMin: 1, uMax: 1 }
  );
});

test('mirrorImage flips in image space along the given axis', () => {
  const t = tile(3, 1);
  setPx(t, 0, 0, [1, 2, 3]);
  const m = mirrorImage(t, 'x');
  assert.equal(alphaAt(m, 2, 0), 255);
  assert.equal(alphaAt(m, 0, 0), 0);
});
