import { test } from 'node:test';
import assert from 'node:assert/strict';

import { roundedRectRows, maxCornerRadius, squareEnd } from '../src/lib/rect.js';

// A rect's row runs [{ y, xl, xr }] and its texels as "x,y" keys.
function raster(x0, y0, x1, y1, r) {
  const rows = [];
  const cells = new Set();
  roundedRectRows(x0, y0, x1, y1, r, (y, xl, xr) => {
    if (xr < xl) {
      rows.push({ y, xl, xr }); // empty runs are recorded too
      return;
    }
    rows.push({ y, xl, xr });
    for (let x = xl; x <= xr; x++) cells.add(`${x},${y}`);
  });
  return { rows, cells };
}

test('squareEnd: Shift-lock constrains to a square using the shorter extent', () => {
  const s = { px: 4, py: 5 };
  // Wider than tall: side = |dy|.
  assert.deepEqual(squareEnd(s, { px: 20, py: 12 }), { px: 11, py: 12 });
  // Taller than wide: side = |dx|.
  assert.deepEqual(squareEnd(s, { px: 9, py: 30 }), { px: 9, py: 10 });
  // An up-left drag keeps each axis's direction.
  assert.deepEqual(squareEnd(s, { px: 0, py: 2 }), { px: 1, py: 2 });
  // A square is unchanged. A zero extent collapses to the start.
  assert.deepEqual(squareEnd(s, { px: 10, py: 11 }), { px: 10, py: 11 });
  assert.deepEqual(squareEnd(s, { px: 4, py: 15 }), { px: 4, py: 5 });
});

test('r=0 is a full rectangle; inverted / degenerate bounds emit no rows', () => {
  const { rows } = raster(2, 3, 6, 8, 0);
  assert.equal(rows.length, 6); // y = 3..8
  for (const { xl, xr } of rows) {
    assert.equal(xl, 2);
    assert.equal(xr, 6);
  }
  const calls = [];
  roundedRectRows(6, 3, 2, 8, 0, (y, xl, xr) => calls.push([y, xl, xr]));
  roundedRectRows(2, 8, 6, 3, 0, (y, xl, xr) => calls.push([y, xl, xr]));
  assert.deepEqual(calls, []);
});

test('r=1 clips exactly the single corner texel on each of the four corners', () => {
  // 10×10, radius 1: only the top and bottom rows lose a column at each end.
  const { rows, cells } = raster(0, 0, 9, 9, 1);
  const byY = Object.fromEntries(rows.map((r) => [r.y, r]));
  assert.deepEqual([byY[0].xl, byY[0].xr], [1, 8]); // top row inset 1 each side
  assert.deepEqual([byY[9].xl, byY[9].xr], [1, 8]); // bottom row too
  for (let y = 1; y <= 8; y++) assert.deepEqual([byY[y].xl, byY[y].xr], [0, 9]);
  // The corner texels are gone. Their neighbors stay.
  for (const c of ['0,0', '9,0', '0,9', '9,9']) assert.ok(!cells.has(c), c);
  for (const c of ['1,0', '8,0', '0,1', '1,1']) assert.ok(cells.has(c), c);
});

test('r=2 rounds a 10x10 corner to a 3-texel quarter bite', () => {
  const { cells } = raster(0, 0, 9, 9, 2);
  // Top-left: (0,0), (1,0) and (0,1) are removed, the diagonal (1,1) kept.
  for (const c of ['0,0', '1,0', '0,1']) assert.ok(!cells.has(c), `removed ${c}`);
  assert.ok(cells.has('1,1'), 'kept 1,1');
  assert.ok(cells.has('2,0'), 'kept 2,0'); // outside the r×r corner block
  assert.ok(cells.has('0,2'), 'kept 0,2');
});

// Convex and concave corners first differ at r >= 3.
test('corners round OUTWARD (convex), never scoop inward (concave)', () => {
  const { cells } = raster(0, 0, 19, 19, 5); // 20x20, radius 5
  assert.ok(!cells.has('0,0'), 'outer corner texel is clipped');
  // Near-diagonal texels a concave corner would remove.
  for (const c of ['2,2', '3,3', '4,4', '3,1', '1,3'])
    assert.ok(cells.has(c), `kept ${c}`);
  // The left inset does not increase from the top row down, and the top row is
  // inset more than the middle.
  const xl = [];
  roundedRectRows(0, 0, 19, 19, 5, (y, l) => xl.push(l));
  for (let y = 1; y <= 5; y++)
    assert.ok(xl[y] <= xl[y - 1], `inset non-increasing at row ${y}`);
  assert.ok(xl[0] > xl[5], 'top edge inset more than the straight middle');
});

test('radius is clamped to half the shorter side (maxCornerRadius, never negative)', () => {
  assert.equal(maxCornerRadius(10, 10), 5);
  assert.equal(maxCornerRadius(4, 10), 2);
  assert.equal(maxCornerRadius(1, 1), 0);
  assert.equal(maxCornerRadius(0, 8), 0);
  assert.equal(maxCornerRadius(7, 7), 3);
  // r=99 on a 4×8 rect rasterizes the same as the clamped radius.
  const big = raster(0, 0, 3, 7, 99);
  const clamped = raster(0, 0, 3, 7, maxCornerRadius(4, 8));
  assert.deepEqual([...big.cells].sort(), [...clamped.cells].sort());
});

test('rows are contiguous, symmetric, and within the bounding box', () => {
  const x0 = 1;
  const y0 = 2;
  const x1 = 12;
  const y1 = 20;
  const r = 4;
  const { rows } = raster(x0, y0, x1, y1, r);
  const byY = Object.fromEntries(rows.map((rw) => [rw.y, rw]));
  for (const { xl, xr } of rows) {
    assert.ok(xl >= x0 && xr <= x1, 'run within bounds');
    assert.ok(xl <= xr + 1, 'run non-crossing');
    // Left and right clipping are symmetric.
    assert.equal(xl - x0, x1 - xr);
  }
  // Row k from the top matches row k from the bottom.
  for (let k = 0; k < (y1 - y0 + 1) >> 1; k++) {
    const top = byY[y0 + k];
    const bot = byY[y1 - k];
    assert.deepEqual([top.xl, top.xr], [bot.xl, bot.xr], `row ${k} symmetry`);
  }
  // The clip does not increase toward the vertical middle.
  let prev = Infinity;
  for (let y = y0; y <= y0 + r; y++) {
    const clip = byY[y].xl - x0;
    assert.ok(clip <= prev, 'clip non-increasing toward the middle');
    prev = clip;
  }
});

// Exact runs at a non-zero origin. The corner clip is relative to (x0, y0).
test('non-zero origin: corner clip is rect-relative, straight rows span full width', () => {
  // 10×10 at (5,7)..(14,16), radius 3.
  const { rows } = raster(5, 7, 14, 16, 3);
  const byY = Object.fromEntries(rows.map((r) => [r.y, r]));

  // The top row (y0 = 7) has the maximum clip, 3 per side.
  assert.deepEqual([byY[7].xl, byY[7].xr], [8, 11], 'top corner row runs');
  // Row y=8 clips one column from each end.
  assert.deepEqual([byY[8].xl, byY[8].xr], [6, 13], 'second-from-top row runs');

  // Rows 10..13 are past the corner band and span x0..x1.
  for (let y = 10; y <= 13; y++)
    assert.deepEqual([byY[y].xl, byY[y].xr], [5, 14], `middle row ${y} full span`);

  // The bottom row (y1 = 16) mirrors the top.
  assert.deepEqual([byY[16].xl, byY[16].xr], [8, 11], 'bottom corner row runs');
});
