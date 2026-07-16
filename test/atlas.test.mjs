// Node-runnable tests for the atlas write-back inverse (blitTile) and cell
// lookup (cellOf), plus the empty-tile → null re-slice semantics the editor
// relies on. Pure (no THREE/DOM). Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sliceAtlas, blitTile, cellOf } from '../src/lib/atlas.js';
import { VIEW_DISPLAY_ORDER } from '../src/lib/views.js';

// A divisible sheet where every one of the six cells has fully-opaque content,
// so sliceAtlas returns a non-null tile for each (no blank→null) and the blit
// round-trip is exact byte-for-byte.
function makeSheet(tileW, tileH, cols, rows) {
  const W = tileW * cols;
  const H = tileH * rows;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      data[i] = (x * 7) & 255;
      data[i + 1] = (y * 5) & 255;
      data[i + 2] = ((x + y) * 3) & 255;
      data[i + 3] = 255; // fully opaque everywhere → no cell slices to null
    }
  }
  return { width: W, height: H, data };
}

test('round-trip: slice then blit every view reproduces the sheet byte-for-byte', () => {
  const sheet = makeSheet(4, 3, 3, 2);
  const { views, tileW, tileH } = sliceAtlas(sheet);
  const rebuilt = {
    width: sheet.width,
    height: sheet.height,
    data: new Uint8ClampedArray(sheet.data.length),
  };
  for (const name of VIEW_DISPLAY_ORDER) {
    const t = views[name];
    assert.ok(t, `expected a non-null tile for ${name}`);
    const { r, c } = cellOf(name);
    blitTile(rebuilt, t, c * tileW, r * tileH);
  }
  assert.deepEqual(rebuilt.data, sheet.data);
});

test('empty tile blitted in re-slices back to null via isBlank', () => {
  const sheet = makeSheet(4, 3, 3, 2);
  const { tileW, tileH } = sliceAtlas(sheet);
  // Erase the FRONT cell by blitting a fully-transparent (all-zero) tile.
  const blank = {
    width: tileW,
    height: tileH,
    data: new Uint8ClampedArray(tileW * tileH * 4),
  };
  const { r, c } = cellOf('front');
  blitTile(sheet, blank, c * tileW, r * tileH);
  const re = sliceAtlas(sheet);
  assert.equal(re.views.front, null, 'erased cell should slice to null');
  assert.ok(re.views.back, 'untouched cells stay non-null');
});

test('blitTile only touches its rect (a non-divisible remainder is left alone)', () => {
  // 3x2 layout on a 7x5 sheet → 2x2 tiles, cols*tileW=6 (< 7), rows*tileH=4 (< 5):
  // the last column/row are remainder pixels no tile covers.
  const W = 7;
  const H = 5;
  const sheet = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  const mark = (x, y, v) => {
    const i = (y * W + x) * 4;
    sheet.data[i] = sheet.data[i + 1] = sheet.data[i + 2] = sheet.data[i + 3] = v;
  };
  mark(6, 4, 200); // a remainder pixel
  const opaque = { width: 2, height: 2, data: new Uint8ClampedArray(2 * 2 * 4).fill(255) };
  blitTile(sheet, opaque, 0, 0); // fills [0,2)x[0,2)
  const at = (x, y) => sheet.data[(y * W + x) * 4];
  assert.equal(at(0, 0), 255, 'blitted rect written');
  assert.equal(at(1, 1), 255, 'blitted rect written');
  assert.equal(at(2, 0), 0, 'outside the rect untouched');
  assert.equal(at(6, 4), 200, 'remainder pixel preserved');
});

test('cellOf returns the correct {r,c} for all six views', () => {
  const expected = {
    left: { r: 0, c: 0 },
    front: { r: 0, c: 1 },
    top: { r: 0, c: 2 },
    right: { r: 1, c: 0 },
    back: { r: 1, c: 1 },
    bottom: { r: 1, c: 2 },
  };
  for (const [name, rc] of Object.entries(expected)) {
    assert.deepEqual(cellOf(name), rc, `cell for ${name}`);
  }
  assert.equal(cellOf('nope'), null, 'unknown view → null');
});
