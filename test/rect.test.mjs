// Node-runnable tests for the editor's rounded-rect rasterization (pure, no DOM):
// the Shift-lock square, the radius clamp, the convex corner bite and the
// rect-relative clip at a non-zero origin. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { roundedRectRows, maxCornerRadius, squareEnd } from '../src/lib/rect.js';

// Collect a rect into per-row runs [{ y, xl, xr }] (skipping empty rows), and into
// a set of "x,y" texel keys for shape assertions.
function raster(x0, y0, x1, y1, r) {
  const rows = [];
  const cells = new Set();
  roundedRectRows(x0, y0, x1, y1, r, (y, xl, xr) => {
    if (xr < xl) {
      rows.push({ y, xl, xr }); // record empties too so tests can see them
      return;
    }
    rows.push({ y, xl, xr });
    for (let x = xl; x <= xr; x++) cells.add(`${x},${y}`);
  });
  return { rows, cells };
}

test('squareEnd: Shift-lock constrains to a square using the shorter extent', () => {
  const s = { px: 4, py: 5 };
  // Wider than tall → side = |dy|, anchored at start, growing down-right.
  assert.deepEqual(squareEnd(s, { px: 20, py: 12 }), { px: 11, py: 12 });
  // Taller than wide → side = |dx|.
  assert.deepEqual(squareEnd(s, { px: 9, py: 30 }), { px: 9, py: 10 });
  // Up-left drag keeps each axis's direction.
  assert.deepEqual(squareEnd(s, { px: 0, py: 2 }), { px: 1, py: 2 });
  // Already square is unchanged; a zero extent collapses to the anchor.
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
  // 10x10 block, radius 1. Only the top & bottom rows lose 1 col from each end.
  const { rows, cells } = raster(0, 0, 9, 9, 1);
  const byY = Object.fromEntries(rows.map((r) => [r.y, r]));
  assert.deepEqual([byY[0].xl, byY[0].xr], [1, 8]); // top row inset 1 each side
  assert.deepEqual([byY[9].xl, byY[9].xr], [1, 8]); // bottom row too
  for (let y = 1; y <= 8; y++) assert.deepEqual([byY[y].xl, byY[y].xr], [0, 9]);
  // The four corner texels are gone; the cells one step in are kept.
  for (const c of ['0,0', '9,0', '0,9', '9,9']) assert.ok(!cells.has(c), c);
  for (const c of ['1,0', '8,0', '0,1', '1,1']) assert.ok(cells.has(c), c);
});

test('r=2 rounds a 10x10 corner to a 3-texel quarter bite', () => {
  const { cells } = raster(0, 0, 9, 9, 2);
  // top-left corner removes (0,0),(1,0),(0,1); keeps the diagonal (1,1).
  for (const c of ['0,0', '1,0', '0,1']) assert.ok(!cells.has(c), `removed ${c}`);
  assert.ok(cells.has('1,1'), 'kept 1,1');
  assert.ok(cells.has('2,0'), 'kept 2,0'); // outside the r×r corner block
  assert.ok(cells.has('0,2'), 'kept 0,2');
});

// The distinguishing test: at r>=3 a convex round and a concave scoop diverge (they
// coincide at r=1,2). A rounded rectangle bulges OUTWARD — it bites only the outer
// corner and keeps the near-diagonal interior; a concave scoop would remove them.
test('corners round OUTWARD (convex), never scoop inward (concave)', () => {
  const { cells } = raster(0, 0, 19, 19, 5); // 20x20, radius 5
  assert.ok(!cells.has('0,0'), 'outer corner texel is clipped');
  // Interior-diagonal texels a concave scoop (the earlier bug) would wrongly remove:
  for (const c of ['2,2', '3,3', '4,4', '3,1', '1,3'])
    assert.ok(cells.has(c), `kept ${c}`);
  // Left inset is non-increasing top→middle and the top row is inset more than the
  // straight middle — the signature of a real round (a scoop stays inset near the top).
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
  // Ask for r=99 on a 4-wide, 8-tall rect → the raster is the one at the clamp.
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
    // Left/right corner clipping is symmetric about the rect center.
    assert.equal(xl - x0, x1 - xr);
  }
  // Top row matches bottom row; second-from-top matches second-from-bottom, etc.
  for (let k = 0; k < (y1 - y0 + 1) >> 1; k++) {
    const top = byY[y0 + k];
    const bot = byY[y1 - k];
    assert.deepEqual([top.xl, top.xr], [bot.xl, bot.xr], `row ${k} symmetry`);
  }
  // Clipping shrinks monotonically toward the vertical middle (convex corner).
  let prev = Infinity;
  for (let y = y0; y <= y0 + r; y++) {
    const clip = byY[y].xl - x0;
    assert.ok(clip <= prev, 'clip non-increasing toward the middle');
    prev = clip;
  }
});

// The corner clip must be computed relative to the rect's own top-left origin
// (offsets `y - y0` and `x0 + clip`), not the absolute grid coordinates. A rect at
// a non-zero origin is where an origin-translation off-by-one in the corner clip
// would surface: pin the CONCRETE runs so a shift in either axis is caught.
test('non-zero origin: corner clip is rect-relative, straight rows span full width', () => {
  // 10x10 rect anchored at (5,7)..(14,16), radius 3.
  const { rows } = raster(5, 7, 14, 16, 3);
  const byY = Object.fromEntries(rows.map((r) => [r.y, r]));

  // Top corner row (y=7 == y0, the nearest edge → maximum clip of 3 per side).
  // These absolute xl/xr only line up if the clip is measured from the rect, not 0.
  assert.deepEqual([byY[7].xl, byY[7].xr], [8, 11], 'top corner row runs');
  // Row one in from the top (y=8) clips exactly 1 column from each end.
  assert.deepEqual([byY[8].xl, byY[8].xr], [6, 13], 'second-from-top row runs');

  // Middle straight rows (y=10..13, past the r=3 corner band) span the full
  // x0..x1 with zero clip — no corner arc reaches the vertical middle.
  for (let y = 10; y <= 13; y++)
    assert.deepEqual([byY[y].xl, byY[y].xr], [5, 14], `middle row ${y} full span`);

  // The bottom corner mirrors the top (y=16 == y1, maximum clip again).
  assert.deepEqual([byY[16].xl, byY[16].xr], [8, 11], 'bottom corner row runs');
});
