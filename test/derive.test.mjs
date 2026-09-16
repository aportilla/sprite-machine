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

const px = (img, x, y) => [
  ...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4),
];
const alphaAt = (img, x, y) => img.data[(y * img.width + x) * 4 + 3];

const RED = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];
const BLUE = [0, 0, 255, 255];

test('editorViewModel: own art by IDENTITY; no art a fresh blank tile, derived; the underlay is the OPPOSITE face mirrored, or null', () => {
  const front = tile(2, 2);
  setPx(front, 0, 0, RED);
  const own = editorViewModel({ layers: [{ front }], tileW: 2, tileH: 2 }, 'front', 0);
  assert.equal(own.tile, front, 'the exact same reference — the identity contract');
  assert.equal(own.wasDerived, false);

  const blank = editorViewModel({ layers: [{}], tileW: 3, tileH: 3 }, 'left', 0);
  assert.equal(blank.wasDerived, true);
  assert.deepEqual([blank.tile.width, blank.tile.height], [3, 3]);
  assert.ok(
    blank.tile.data.every((b) => b === 0),
    'fully transparent'
  );

  const back = tile(2, 2);
  setPx(back, 1, 1, GREEN);
  const vm = editorViewModel({ layers: [{ back }], tileW: 2, tileH: 2 }, 'front', 0);
  // MIRROR_AXIS is 'x', so back's (1,1) shows at (0,1).
  assert.equal(alphaAt(vm.onionBehind, 0, 1), 255);
  assert.equal(alphaAt(vm.onionBehind, 1, 1), 0);
  const vm2 = editorViewModel({ layers: [{ back }], tileW: 2, tileH: 2 }, 'top', 0);
  assert.equal(vm2.onionBehind, null, 'bottom has no art of its own');
});

test('editorViewModel on a layer: its tile and edge hints are the layer’s own; the underlay is its mirrored opposite, then each other layer’s same face over that layer’s mirrored opposite', () => {
  const front0 = tile(2, 2);
  setPx(front0, 0, 0, RED);
  const back0 = tile(2, 2);
  setPx(back0, 1, 1, GREEN); // mirrors to (0,1)
  const right0 = tile(2, 2);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) setPx(right0, x, y, GREEN);
  const front1 = tile(2, 2);
  setPx(front1, 0, 1, BLUE);
  setPx(front1, 1, 0, BLUE);
  const back1 = tile(2, 2);
  setPx(back1, 0, 0, RED); // mirrors to (1,0), under front1
  const doc = {
    layers: [
      { front: front0, back: back0, right: right0 },
      { front: front1, back: back1 },
    ],
    tileW: 2,
    tileH: 2,
  };

  const on0 = editorViewModel(doc, 'front', 0);
  assert.equal(on0.tile, front0);
  assert.deepEqual(px(on0.onionBehind, 0, 1), BLUE, 'layer 1 over the mirrored back');
  assert.deepEqual(
    px(on0.onionBehind, 1, 0),
    BLUE,
    'layer 1’s front over its mirrored back'
  );
  assert.equal(alphaAt(on0.onionBehind, 0, 0), 0, 'never the layer’s own art');

  const on1 = editorViewModel(doc, 'front', 1);
  assert.equal(on1.tile, front1);
  assert.deepEqual(px(on1.onionBehind, 0, 0), RED, 'layer 0’s front');
  assert.deepEqual(px(on1.onionBehind, 0, 1), GREEN, 'layer 0’s back, mirrored');
  assert.deepEqual(px(on1.onionBehind, 1, 0), RED, 'layer 1’s own back, mirrored');

  const painted = (frame) => frame.data.some((v, i) => i % 4 === 3 && v !== 0);
  assert.equal(painted(on0.edgeHints), true, 'layer 0’s side runs along its front');
  assert.equal(painted(on1.edgeHints), false, 'layer 1 has no neighbours of its own');
});
