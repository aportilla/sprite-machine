import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  brushBounds,
  brushRows,
  brushSpans,
  writeTexel,
  stampBrush,
  strokeLine,
} from '../src/lib/brush.js';

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

// A tip's row widths, top to bottom, and their total.
const widths = (size, shape) => {
  const out = [];
  brushRows(10, 10, size, shape, (y, xl, xr) => out.push(xr - xl + 1));
  return out;
};
const covered = (size, shape) => widths(size, shape).reduce((a, b) => a + b, 0);

test('brushRows: a square tip covers its whole box on every row, at the footprint bounds', () => {
  assert.deepEqual(widths(1, 'square'), [1]);
  assert.deepEqual(widths(4, 'square'), [4, 4, 4, 4]);
  const b = brushBounds(10, 10, 4);
  const ys = [];
  brushRows(10, 10, 4, 'square', (y, xl, xr) => {
    ys.push(y);
    assert.equal(xl, b.x0);
    assert.equal(xr, b.x1);
  });
  assert.deepEqual(ys, [b.y0, b.y0 + 1, b.y0 + 2, b.y1]);
  // An unknown shape is a square.
  assert.deepEqual(widths(3, 'blob'), [3, 3, 3]);
});

test('brushRows: the circle is the classic pixel disc — one texel, a 2×2, the plus at 3, then rounded boxes', () => {
  assert.deepEqual(widths(1, 'circle'), [1]);
  assert.deepEqual(widths(2, 'circle'), [2, 2]);
  assert.deepEqual(widths(3, 'circle'), [1, 3, 1], 'a plus, not a box');
  assert.deepEqual(widths(4, 'circle'), [2, 4, 4, 2], 'a 4×4 less its corners');
  assert.deepEqual(widths(5, 'circle'), [3, 5, 5, 5, 3]);
  assert.deepEqual(widths(6, 'circle'), [4, 6, 6, 6, 6, 4]);
  assert.deepEqual(
    widths(7, 'circle'),
    [3, 5, 7, 7, 7, 5, 3],
    "the midpoint circle's rows"
  );
  assert.deepEqual(widths(8, 'circle'), [4, 6, 8, 8, 8, 8, 6, 4]);
  assert.deepEqual(widths(9, 'circle'), [3, 7, 7, 9, 9, 9, 7, 7, 3]);
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => covered(n, 'circle')),
    [1, 4, 5, 12, 21, 32, 37, 52, 61]
  );
});

test('brushRows: every circle row is centered in its box, symmetric, inside the square, never empty — up to the 64 tile cap', () => {
  for (let n = 1; n <= 64; n++) {
    const b = brushBounds(7, 7, n);
    const spans = [];
    let expectY = b.y0;
    brushRows(7, 7, n, 'circle', (y, xl, xr) => {
      assert.equal(y, expectY++, `size ${n}: rows in order, one per box row`);
      assert.ok(xl <= xr, `size ${n}: row ${y} is empty`);
      assert.ok(xl >= b.x0 && xr <= b.x1, `size ${n}: row ${y} leaves the box`);
      assert.equal(xl - b.x0, b.x1 - xr, `size ${n}: row ${y} is off-center`);
      spans.push(xr - xl + 1);
    });
    assert.equal(spans.length, n, `size ${n}: one span per row`);
    assert.deepEqual(spans, [...spans].reverse(), `size ${n}: top/bottom symmetric`);
    assert.equal(Math.max(...spans), n, `size ${n}: the equator spans the box`);
    const total = spans.reduce((a, c) => a + c, 0);
    if (n <= 2) assert.equal(total, n * n, `size ${n}: the disc IS the box`);
    else assert.ok(total < n * n, `size ${n}: a real disc spares the corners`);
    // A disc's area is about π/4 of its box.
    if (n >= 8) {
      const fill = total / (n * n);
      assert.ok(
        Math.abs(fill - Math.PI / 4) < 0.05,
        `size ${n}: fill ${fill.toFixed(3)}`
      );
    }
  }
});

test('brushSpans: the tip’s rows as clipped system-px spans, scaled', () => {
  // The square at 1 px per texel is its box.
  assert.deepEqual(brushSpans(5, 5, 3, 'square', 10, 10), [
    { y: 4, x0: 4, x1: 6 },
    { y: 5, x0: 4, x1: 6 },
    { y: 6, x0: 4, x1: 6 },
  ]);
  // The plus at 1 and 2 px per texel. At 2, each texel row appears twice and
  // x1 reaches the texel's far edge.
  assert.deepEqual(brushSpans(5, 5, 3, 'circle', 10, 10), [
    { y: 4, x0: 5, x1: 5 },
    { y: 5, x0: 4, x1: 6 },
    { y: 6, x0: 5, x1: 5 },
  ]);
  assert.deepEqual(brushSpans(5, 5, 3, 'circle', 10, 10, 2), [
    { y: 8, x0: 10, x1: 11 },
    { y: 9, x0: 10, x1: 11 },
    { y: 10, x0: 8, x1: 13 },
    { y: 11, x0: 8, x1: 13 },
    { y: 12, x0: 10, x1: 11 },
    { y: 13, x0: 10, x1: 11 },
  ]);
  // A 5 px disc on the tile's corner keeps its in-tile rows, cut at the edge.
  // A tip wholly off the tile has no spans.
  assert.deepEqual(brushSpans(0, 0, 5, 'circle', 10, 10), [
    { y: 0, x0: 0, x1: 2 },
    { y: 1, x0: 0, x1: 2 },
    { y: 2, x0: 0, x1: 1 },
  ]);
  assert.deepEqual(brushSpans(12, 12, 5, 'circle', 10, 10), []);
  // At scale k, each texel row gives k spans, each a multiple of k px wide.
  const s = brushSpans(20, 20, 7, 'circle', 40, 40, 3);
  assert.equal(s.length, 7 * 3);
  assert.ok(s.every((r) => (r.x1 - r.x0 + 1) % 3 === 0));
});

test('writeTexel: a hard-pixel write reports change; erasing an already-transparent texel is a true no-op', () => {
  const d = tile(4, 4);
  assert.equal(writeTexel(d, 4, 1, 1, PAINT), true);
  assert.deepEqual([...d.subarray(20, 24)], [10, 20, 30, 255]);
  assert.equal(writeTexel(d, 4, 1, 1, PAINT), false, 'same bytes → no change');
  assert.equal(writeTexel(d, 4, 1, 1, ERASE), true);
  assert.equal(alphaAt(d, 4, 1, 1), 0);
  // Stray RGB under alpha 0 does not count as a change.
  d[0] = 99;
  d[1] = 99;
  d[2] = 99;
  assert.equal(writeTexel(d, 4, 0, 0, ERASE), false);
  assert.equal(d[0], 99, 'stray RGB is left alone, not zeroed');
});

test('stampBrush: the square box and the circle disc land clipped at the tile edge; a restamp changes nothing', () => {
  // A 3×3 square centered on the corner paints only its in-bounds 2×2.
  const d = tile(5, 5);
  assert.equal(stampBrush(d, 5, 5, 0, 0, 3, PAINT, 'square'), true);
  assert.deepEqual(painted(d, 5, 5), [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]);
  assert.equal(
    stampBrush(d, 5, 5, 0, 0, 3, PAINT, 'square'),
    false,
    'repaint → no change'
  );
  // The circle at 3 is the plus.
  const c = tile(5, 5);
  assert.equal(stampBrush(c, 5, 5, 2, 2, 3, PAINT, 'circle'), true);
  assert.deepEqual(painted(c, 5, 5), [
    [2, 1],
    [1, 2],
    [2, 2],
    [3, 2],
    [2, 3],
  ]);
  assert.equal(
    stampBrush(c, 5, 5, 2, 2, 3, PAINT, 'circle'),
    false,
    'restamp → no change'
  );
  // The plus on the corner paints only its in-bounds texels.
  const e = tile(5, 5);
  assert.equal(stampBrush(e, 5, 5, 0, 0, 3, PAINT, 'circle'), true);
  assert.deepEqual(painted(e, 5, 5), [
    [0, 0],
    [1, 0],
    [0, 1],
  ]);
  // A disc wholly off-tile changes nothing.
  assert.equal(stampBrush(tile(5, 5), 5, 5, 9, 9, 3, PAINT, 'circle'), false);
});

test('strokeLine: a steep drag paints a gap-free run, a single point stamps once, and an erase reports change honestly', () => {
  const d = tile(16, 16);
  assert.equal(strokeLine(d, 16, 16, 1, 1, 6, 13, 1, PAINT), true);
  const pts = painted(d, 16, 16);
  assert.ok(pts.some(([x, y]) => x === 1 && y === 1));
  assert.ok(pts.some(([x, y]) => x === 6 && y === 13));
  // Every painted texel has an 8-connected painted neighbor.
  for (const [x, y] of pts) {
    if (x === 1 && y === 1) continue;
    const hasPrev = pts.some(
      ([px, py]) =>
        Math.abs(px - x) <= 1 && Math.abs(py - y) <= 1 && (px !== x || py !== y)
    );
    assert.ok(hasPrev, `texel ${x},${y} is isolated`);
  }
  // A zero-length stroke is one stamp of the tip.
  const p = tile(8, 8);
  assert.equal(strokeLine(p, 8, 8, 3, 3, 3, 3, 2, PAINT), true);
  assert.deepEqual(painted(p, 8, 8), [
    [3, 3],
    [4, 3],
    [3, 4],
    [4, 4],
  ]);
  assert.equal(
    strokeLine(p, 8, 8, 6, 6, 7, 7, 1, ERASE),
    false,
    'erasing empty texels changes nothing'
  );
  assert.equal(strokeLine(p, 8, 8, 3, 3, 4, 4, 1, ERASE), true);
  assert.equal(alphaAt(p, 8, 3, 3), 0);
});

test('strokeLine: the tip shape rides the whole run — a round-ended stroke', () => {
  const d = tile(12, 12);
  assert.equal(strokeLine(d, 12, 12, 2, 5, 9, 5, 3, PAINT, 'circle'), true);
  const pts = painted(d, 12, 12);
  const row = (y) => pts.filter(([, py]) => py === y).map(([x]) => x);
  // A horizontal run of pluses. The center row reaches one past each end. The
  // rows above and below stop at the endpoints.
  assert.deepEqual(row(5), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(row(4), [2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(row(6), [2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(row(3).length + row(7).length, 0, 'a 3 px disc is three rows tall');
  // The square tip fills the 3-row band from x 1 to 10.
  const e = tile(12, 12);
  strokeLine(e, 12, 12, 2, 5, 9, 5, 3, PAINT, 'square');
  assert.equal(painted(e, 12, 12).length, 3 * 10);
});
