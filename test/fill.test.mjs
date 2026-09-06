// Node-runnable tests for the editor's fill-tool primitives (pure, no DOM):
// the 4-connected flood, the global recolor, and the rect-scoped recolor.
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { floodFill, replaceColor, replaceColorInRect } from '../src/lib/fill.js';

// Build a w×h RGBA buffer from a grid of single-char color codes. ' ' or '.' is
// transparent; any other char maps to a distinct opaque color via CODES.
const CODES = {
  r: [255, 0, 0],
  g: [0, 255, 0],
  b: [0, 0, 255],
  y: [255, 255, 0],
  k: [0, 0, 0],
};
function grid(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      const i = (y * w + x) * 4;
      if (ch === ' ' || ch === '.') continue; // transparent (alpha 0)
      const [r, g, b] = CODES[ch];
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { w, h, data };
}
// Serialize back to char rows so a whole-buffer shape can be asserted at a glance.
function show({ w, h, data }) {
  const rev = Object.entries(CODES); // [char,[r,g,b]]
  const out = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] === 0) {
        row += '.';
        continue;
      }
      const hit = rev.find(
        ([, c]) => c[0] === data[i] && c[1] === data[i + 1] && c[2] === data[i + 2]
      );
      row += hit ? hit[0] : '?';
    }
    out.push(row);
  }
  return out;
}
const RED = { r: 255, g: 0, b: 0 };
const GREEN = { r: 0, g: 255, b: 0 };
const CLEAR = { transparent: true };

test('floodFill: fills only the contiguous region touching the seed; an out-of-bounds seed changes nothing', () => {
  // Two separate red blobs split by a green wall; seeding the left one leaves the right.
  const im = grid(['rrgrr', 'rrgrr', 'rrgrr']);
  const n = floodFill(im.data, im.w, im.h, 0, 0, GREEN);
  assert.equal(n, 6); // only the left 2×3 block
  assert.deepEqual(show(im), ['gggrr', 'gggrr', 'gggrr']);
  // A seed off the tile on either side touches nothing.
  assert.equal(floodFill(im.data, im.w, im.h, -1, 0, GREEN), 0);
  assert.equal(floodFill(im.data, im.w, im.h, 5, 3, GREEN), 0);
  assert.deepEqual(show(im), ['gggrr', 'gggrr', 'gggrr'], 'the buffer is untouched');
});

test('floodFill: 4-connected — diagonal-only neighbors are NOT reached', () => {
  // A red checker: the top-left red touches no other red orthogonally.
  const im = grid(['rg', 'gr']);
  const n = floodFill(im.data, im.w, im.h, 0, 0, GREEN);
  assert.equal(n, 1);
  assert.deepEqual(show(im), ['gg', 'gr']);
});

test('floodFill: flows around a concave barrier (not a naive rectangle)', () => {
  // A U-shaped green wall open at the top; a red seed inside must not leak out the
  // sealed sides/bottom but fills the whole interior + the open top row.
  const im = grid(['rrrrr', 'rgggr', 'rgrgr', 'rgggr', 'rrrrr']);
  // Seed the outer red ring — it wraps the U but can't enter the sealed pocket (2,2).
  const n = floodFill(im.data, im.w, im.h, 0, 0, RED); // already red → no-op guard
  assert.equal(n, 0);
  // Recolor the outer ring to yellow; the inner red pocket at (2,2) stays red.
  const y = floodFill(im.data, im.w, im.h, 0, 0, { r: 255, g: 255, b: 0 });
  assert.equal(y, 16); // the 16 outer-ring texels
  assert.deepEqual(show(im), ['yyyyy', 'ygggy', 'ygrgy', 'ygggy', 'yyyyy']);
});

test('floodFill: transparent seed fills the empty region (RGB under alpha ignored)', () => {
  const im = grid(['r..', 'r..', 'rrr']);
  const n = floodFill(im.data, im.w, im.h, 2, 0, RED);
  assert.equal(n, 4); // the four transparent texels
  assert.deepEqual(show(im), ['rrr', 'rrr', 'rrr']);
});

test('floodFill: erasing to transparent clears the region', () => {
  const im = grid(['rrr', 'rrr']);
  const n = floodFill(im.data, im.w, im.h, 1, 1, CLEAR);
  assert.equal(n, 6);
  assert.deepEqual(show(im), ['...', '...']);
});

test('replaceColor: recolors EVERY matching texel, contiguous or not', () => {
  const im = grid(['rgr', 'grg', 'rgr']); // red at the 4 corners + center, non-contiguous
  const n = replaceColor(im.data, RED, { r: 255, g: 255, b: 0 });
  assert.equal(n, 5);
  assert.deepEqual(show(im), ['ygy', 'gyg', 'ygy']);
});

test('replaceColor: transparent target floods every empty texel with the ink', () => {
  const im = grid(['r.r', '...', 'r.r']);
  const n = replaceColor(im.data, CLEAR, GREEN);
  assert.equal(n, 5); // the 5 transparent cells
  assert.deepEqual(show(im), ['rgr', 'ggg', 'rgr']);
});

test('replaceColor: opaque → transparent erases every instance of that color', () => {
  const im = grid(['rgr', 'rgr']);
  const n = replaceColor(im.data, RED, CLEAR);
  assert.equal(n, 4);
  assert.deepEqual(show(im), ['.g.', '.g.']);
});

test('replaceColor: target === fill is a no-op', () => {
  const im = grid(['rg', 'gr']);
  assert.equal(replaceColor(im.data, RED, { r: 255, g: 0, b: 0 }), 0);
  assert.equal(replaceColor(im.data, CLEAR, { transparent: true }), 0);
});

test('replaceColorInRect: recolors only within the rect, leaving remainder pixels', () => {
  // A 4×3 sheet whose tile grid is the top-left 3×2 block; the right column + bottom
  // row are "remainder" a non-divisible atlas would leave outside every tile.
  const im = grid(['rrrr', 'rrrr', 'rrrr']);
  const n = replaceColorInRect(im.data, im.w, im.h, 0, 0, 3, 2, RED, GREEN);
  assert.equal(n, 6); // only the 3×2 tiled block
  assert.deepEqual(show(im), ['gggr', 'gggr', 'rrrr']); // remainder column + row stay red
});

test('replaceColorInRect: clips an oversized rect to the buffer (no row overrun)', () => {
  // A rect wider/taller than the buffer must not read past a row into the next.
  const im = grid(['rg', 'gr']);
  const n = replaceColorInRect(im.data, im.w, im.h, 0, 0, 99, 99, RED, GREEN);
  assert.equal(n, 2); // both reds, nothing out of bounds
  assert.deepEqual(show(im), ['gg', 'gg']);
});

test('floodFill scales past the recursion limit (no stack overflow on a big tile)', () => {
  const w = 256;
  const h = 256;
  const data = new Uint8ClampedArray(w * h * 4); // all transparent
  const n = floodFill(data, w, h, 0, 0, RED);
  assert.equal(n, w * h); // the whole tile is one connected region
});
