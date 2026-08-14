// Node-runnable tests for the pure pencil primitives (lib/brush.js): footprint
// anchoring, the transparent-idempotence rule, clipping, and Bresenham
// continuity. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { brushBounds, writeTexel, stampBrush, strokeLine } from '../src/lib/brush.js';

const PAINT = { r: 10, g: 20, b: 30, a: 255 };
const ERASE = { r: 0, g: 0, b: 0, a: 0 };

const tile = (w, h) => new Uint8ClampedArray(w * h * 4);
const alphaAt = (data, w, x, y) => data[(y * w + x) * 4 + 3];
const painted = (data, w, h) => {
  const out = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (alphaAt(data, w, x, y)) out.push([x, y]);
  return out;
};

test('brushBounds: odd sizes center exactly, even sizes bias up-left', () => {
  assert.deepEqual(brushBounds(5, 5, 1), { x0: 5, y0: 5, x1: 5, y1: 5 });
  assert.deepEqual(brushBounds(5, 5, 3), { x0: 4, y0: 4, x1: 6, y1: 6 });
  assert.deepEqual(brushBounds(5, 5, 2), { x0: 5, y0: 5, x1: 6, y1: 6 });
  assert.deepEqual(brushBounds(5, 5, 4), { x0: 4, y0: 4, x1: 7, y1: 7 });
});

test('writeTexel: hard-pixel write, change-flag semantics', () => {
  const d = tile(4, 4);
  assert.equal(writeTexel(d, 4, 1, 1, PAINT), true);
  assert.deepEqual([...d.subarray(20, 24)], [10, 20, 30, 255]);
  assert.equal(writeTexel(d, 4, 1, 1, PAINT), false, 'same bytes → no change');
  assert.equal(writeTexel(d, 4, 1, 1, ERASE), true);
  assert.equal(alphaAt(d, 4, 1, 1), 0);
});

test('writeTexel: erasing an already-transparent texel is a true no-op', () => {
  const d = tile(4, 4);
  // Stray RGB under alpha 0 (e.g. left by a decoder) must not count as change.
  d[0] = 99;
  d[1] = 99;
  d[2] = 99;
  assert.equal(writeTexel(d, 4, 0, 0, ERASE), false);
  assert.equal(d[0], 99, 'stray RGB is left alone, not zeroed');
});

test('stampBrush: full footprint, clipped at the tile edge', () => {
  const d = tile(5, 5);
  assert.equal(stampBrush(d, 5, 5, 0, 0, 3, PAINT), true);
  // 3×3 centered on the corner → only the 2×2 in-bounds quadrant lands.
  assert.deepEqual(painted(d, 5, 5), [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]);
  assert.equal(stampBrush(d, 5, 5, 0, 0, 3, PAINT), false, 'repaint → no change');
});

test('strokeLine: a steep drag paints a continuous (gap-free) run', () => {
  const d = tile(16, 16);
  assert.equal(strokeLine(d, 16, 16, 1, 1, 6, 13, 1, PAINT), true);
  const pts = painted(d, 16, 16);
  // Endpoints land…
  assert.ok(pts.some(([x, y]) => x === 1 && y === 1));
  assert.ok(pts.some(([x, y]) => x === 6 && y === 13));
  // …and every painted texel has an 8-connected painted neighbor toward the
  // rest of the line (no isolated dots): walk row-adjacency.
  for (const [x, y] of pts) {
    if (x === 1 && y === 1) continue;
    const hasPrev = pts.some(
      ([px, py]) =>
        Math.abs(px - x) <= 1 && Math.abs(py - y) <= 1 && (px !== x || py !== y)
    );
    assert.ok(hasPrev, `texel ${x},${y} is isolated`);
  }
});

test('strokeLine: a single point stamps once; erase strokes report change honestly', () => {
  const d = tile(8, 8);
  assert.equal(strokeLine(d, 8, 8, 3, 3, 3, 3, 2, PAINT), true);
  assert.deepEqual(painted(d, 8, 8), [
    [3, 3],
    [4, 3],
    [3, 4],
    [4, 4],
  ]);
  assert.equal(
    strokeLine(d, 8, 8, 6, 6, 7, 7, 1, ERASE),
    false,
    'erasing empty texels changes nothing'
  );
  assert.equal(strokeLine(d, 8, 8, 3, 3, 4, 4, 1, ERASE), true);
  assert.equal(alphaAt(d, 8, 3, 3), 0);
});
