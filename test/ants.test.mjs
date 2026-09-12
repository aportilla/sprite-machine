import { test } from 'node:test';
import assert from 'node:assert/strict';

import { antsRuns, antsOutlineRuns, ANTS_DASH, ANTS_PERIOD } from '../src/lib/ants.js';
import { brushSpans } from '../src/lib/brush.js';

// The ring's pixels clockwise from the top-left corner, as four segments: top
// row, right column, bottom row, left column. Empty segments are dropped.
function segments({ x, y, w, h }) {
  const top = [];
  const right = [];
  const bottom = [];
  const left = [];
  for (let i = 0; i < w; i++) top.push([x + i, y]);
  for (let j = 1; j < h; j++) right.push([x + w - 1, y + j]);
  if (h > 1) for (let i = w - 2; i >= 0; i--) bottom.push([x + i, y + h - 1]);
  if (w > 1) for (let j = h - 2; j >= 1; j--) left.push([x, y + j]);
  return [top, right, bottom, left].filter((s) => s.length);
}

// Whether walk pixel i is black at `phase`. The dashes advance one px per step.
const blackAt = (i, phase) =>
  (((i - phase) % ANTS_PERIOD) + ANTS_PERIOD) % ANTS_PERIOD < ANTS_DASH;

// Inks every walk pixel, then run-length encodes each segment by ink.
function expectedRuns(f, phase) {
  const runs = [];
  let i = 0;
  for (const seg of segments(f)) {
    let run = null;
    for (const [x, y] of seg) {
      const black = blackAt(i++, phase);
      if (run && run.black === black) {
        run.x0 = Math.min(run.x0, x);
        run.y0 = Math.min(run.y0, y);
        run.x1 = Math.max(run.x1, x);
        run.y1 = Math.max(run.y1, y);
      } else {
        run = { x0: x, y0: y, x1: x, y1: y, black };
        runs.push(run);
      }
    }
  }
  return runs.map(({ x0, y0, x1, y1, black }) => ({
    x: x0,
    y: y0,
    w: x1 - x0 + 1,
    h: y1 - y0 + 1,
    black,
  }));
}

// Expands runs into per-pixel [x, y, black] in walk order. Bottom-row and
// left-column runs expand backward. A 1-tall or 1-wide frame has only its top
// row or right column.
function pixels(runs, f) {
  const out = [];
  for (const r of runs) {
    assert.ok(r.w >= 1 && r.h >= 1, `run has extent ${JSON.stringify(r)}`);
    assert.ok(r.w === 1 || r.h === 1, `run is one px thick ${JSON.stringify(r)}`);
    assert.ok(
      r.w <= ANTS_DASH && r.h <= ANTS_DASH,
      `run within a dash ${JSON.stringify(r)}`
    );
    const n = r.w * r.h;
    const back =
      (r.h === 1 && f.h > 1 && r.y === f.y + f.h - 1) ||
      (r.w === 1 && f.w > 1 && r.x === f.x);
    for (let k = 0; k < n; k++) {
      const t = back ? n - 1 - k : k;
      out.push(r.h === 1 ? [r.x + t, r.y, r.black] : [r.x, r.y + t, r.black]);
    }
  }
  return out;
}

const FRAMES = [
  { x: 0, y: 0, w: 5, h: 5 }, // 16-px ring: two whole cycles, no seam
  { x: 3, y: 2, w: 12, h: 7 }, // 34-px ring: seam two px into a dash
  { x: 0, y: 0, w: 8, h: 8 }, // 28-px ring: seam mid-cycle
  { x: 40, y: 12, w: 9, h: 3 },
  { x: -6, y: -2, w: 10, h: 10 }, // negative coordinates
  { x: 1, y: 1, w: 1, h: 6 }, // single column
  { x: 1, y: 1, w: 6, h: 1 }, // single row
  { x: 4, y: 4, w: 2, h: 2 }, // four corners only
  { x: 0, y: 0, w: 1, h: 1 }, // one pixel
];

// Runs never cross a segment, so a corner's run and the next segment's first
// run may share an ink.
test('the runs ARE the run-length encoding of the inked walk, per segment', () => {
  for (const f of FRAMES) {
    for (let phase = -ANTS_PERIOD; phase <= 2 * ANTS_PERIOD; phase++) {
      assert.deepEqual(
        antsRuns(f, phase),
        expectedRuns(f, phase),
        `frame ${JSON.stringify(f)} phase ${phase}`
      );
    }
  }
});

test('the seam: the walk starts a fresh cycle at the top-left corner', () => {
  // A 5×5 frame's 16-px ring is two whole cycles. A 6×6 frame's 20-px ring
  // ends four px into a cycle, so at phase 0 the left column's last four px
  // start a black dash that the top-left corner cuts off.
  const five = { x: 0, y: 0, w: 5, h: 5 };
  const even = pixels(antsRuns(five, 0), five);
  assert.deepEqual(
    even.map(([, , b]) => (b ? 1 : 0)),
    [1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0]
  );
  const six = { x: 0, y: 0, w: 6, h: 6 };
  const seam = pixels(antsRuns(six, 0), six);
  assert.deepEqual(
    seam.map(([, , b]) => (b ? 1 : 0)),
    [1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1]
  );
  // The seam's black run is the left column's top four px. The corner (0,0)
  // belongs to the first run.
  assert.deepEqual(
    seam.slice(16).map(([x, y]) => [x, y]),
    [
      [0, 4],
      [0, 3],
      [0, 2],
      [0, 1],
    ]
  );
});

test('5×5 at phase 0: the concrete runs; a frame under 1×1 emits nothing', () => {
  assert.deepEqual(antsRuns({ x: 0, y: 0, w: 5, h: 5 }, 0), [
    { x: 0, y: 0, w: 4, h: 1, black: true }, // top row
    { x: 4, y: 0, w: 1, h: 1, black: false }, // top-right corner
    { x: 4, y: 1, w: 1, h: 3, black: false }, // right column
    { x: 4, y: 4, w: 1, h: 1, black: true }, // bottom-right corner
    { x: 1, y: 4, w: 3, h: 1, black: true }, // bottom row, walked leftward
    { x: 0, y: 4, w: 1, h: 1, black: false }, // bottom-left corner
    { x: 0, y: 1, w: 1, h: 3, black: false }, // left column, walked upward
  ]);
  // Phase 1: a white px leads, and the corner (4,0) ends the black dash.
  assert.deepEqual(antsRuns({ x: 0, y: 0, w: 5, h: 5 }, 1).slice(0, 3), [
    { x: 0, y: 0, w: 1, h: 1, black: false },
    { x: 1, y: 0, w: 4, h: 1, black: true },
    { x: 4, y: 1, w: 1, h: 4, black: false },
  ]);
  assert.deepEqual(antsRuns({ x: 0, y: 0, w: 0, h: 5 }, 0), []);
  assert.deepEqual(antsRuns({ x: 0, y: 0, w: 5, h: 0 }, 3), []);
});

// Outline ring

// A box as spans.
const boxSpans = ({ x, y, w, h }) =>
  Array.from({ length: h }, (_, r) => ({ y: y + r, x0: x, x1: x + w - 1 }));

test('antsOutlineRuns: a box’s spans give antsRuns’ runs exactly, run for run, at every phase', () => {
  for (const f of FRAMES) {
    for (let phase = -ANTS_PERIOD; phase <= 2 * ANTS_PERIOD; phase++) {
      assert.deepEqual(
        antsOutlineRuns(boxSpans(f), phase),
        antsRuns(f, phase),
        `frame ${JSON.stringify(f)} phase ${phase}`
      );
    }
  }
  assert.deepEqual(antsOutlineRuns([], 0), [], 'no spans, no ring');
});

// The shape's thin boundary as sorted keys: every px with a 4-neighbour outside.
const key = (x, y) => `${x},${y}`;
function thinBoundary(spans) {
  const shape = new Set();
  for (const { y, x0, x1 } of spans) for (let x = x0; x <= x1; x++) shape.add(key(x, y));
  const out = [];
  for (const { y, x0, x1 } of spans) {
    for (let x = x0; x <= x1; x++) {
      if (
        !shape.has(key(x - 1, y)) ||
        !shape.has(key(x + 1, y)) ||
        !shape.has(key(x, y - 1)) ||
        !shape.has(key(x, y + 1))
      )
        out.push(key(x, y));
    }
  }
  return out.sort();
}
const cheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

// Expands outline runs into per-pixel [x, y, black] in walk order. A run of two
// or more px starts at the end that touches the previous pixel. The first run
// is the top row, walked left to right.
function outlineWalk(runs) {
  const out = [];
  let prev = null;
  for (const r of runs) {
    assert.ok(r.w >= 1 && r.h >= 1, `run has extent ${JSON.stringify(r)}`);
    assert.ok(r.w === 1 || r.h === 1, `run is one px thick ${JSON.stringify(r)}`);
    assert.ok(
      r.w <= ANTS_DASH && r.h <= ANTS_DASH,
      `run within a dash ${JSON.stringify(r)}`
    );
    const n = r.w * r.h;
    const fwd = [];
    for (let k = 0; k < n; k++) fwd.push(r.h === 1 ? [r.x + k, r.y] : [r.x, r.y + k]);
    let order = fwd;
    if (prev && n > 1) {
      const headAdj = cheb(fwd[0], prev) <= 1;
      const tailAdj = cheb(fwd[n - 1], prev) <= 1;
      assert.ok(
        headAdj !== tailAdj,
        `run ${JSON.stringify(r)} joins the walk at one end`
      );
      if (tailAdj) order = [...fwd].reverse();
    }
    for (const [x, y] of order) out.push([x, y, r.black]);
    prev = out[out.length - 1];
  }
  return out;
}

// Checks the outline walk at every phase. Returns its length.
function checkOutline(spans, label) {
  const boundary = thinBoundary(spans);
  for (let phase = 0; phase < ANTS_PERIOD; phase++) {
    const walk = outlineWalk(antsOutlineRuns(spans, phase));
    const keys = walk.map(([x, y]) => key(x, y));
    assert.equal(new Set(keys).size, keys.length, `${label}: each px once`);
    assert.deepEqual([...keys].sort(), boundary, `${label}: exactly the thin boundary`);
    for (let i = 1; i < walk.length; i++)
      assert.ok(cheb(walk[i], walk[i - 1]) <= 1, `${label}: 8-connected at px ${i}`);
    // A shape one px wide or tall is a line walked once, so it does not close.
    const line = spans.length === 1 || spans.every((s) => s.x0 === s.x1);
    if (walk.length > 1 && !line)
      assert.ok(cheb(walk[0], walk[walk.length - 1]) <= 1, `${label}: closed`);
    assert.deepEqual(
      walk[0].slice(0, 2),
      [spans[0].x0, spans[0].y],
      `${label}: starts at the top row's left end`
    );
    if (spans[0].x1 > spans[0].x0)
      assert.deepEqual(
        walk[1].slice(0, 2),
        [spans[0].x0 + 1, spans[0].y],
        `${label}: clockwise`
      );
    walk.forEach(([, , black], i) =>
      assert.equal(black, blackAt(i, phase), `${label}: ink at px ${i}, phase ${phase}`)
    );
  }
  return outlineWalk(antsOutlineRuns(spans, 0)).length;
}

test('antsOutlineRuns: a circle tip’s disc — the thin boundary, once, 8-connected, closed, clockwise, inked', () => {
  // Every tip size at 1 px per texel, and the small sizes at 2 and 3.
  for (let n = 1; n <= 64; n++)
    checkOutline(brushSpans(70, 70, n, 'circle', 200, 200), `disc ${n}`);
  for (let n = 1; n <= 9; n++) {
    checkOutline(brushSpans(20, 20, n, 'circle', 50, 50, 2), `disc ${n} ×2`);
    checkOutline(brushSpans(20, 20, n, 'circle', 50, 50, 3), `disc ${n} ×3`);
  }
});

test('antsOutlineRuns: the plus is a four-px diamond; a box’s ring is the frame’s', () => {
  // The 3 px disc at 1 px per texel is a plus. Its ring is the four arm tips.
  const plus = brushSpans(5, 5, 3, 'circle', 10, 10);
  assert.deepEqual(
    outlineWalk(antsOutlineRuns(plus, 0)).map(([x, y]) => [x, y]),
    [
      [5, 4],
      [6, 5],
      [5, 6],
      [4, 5],
    ]
  );
  // At 2 px per texel, the 4 px disc's ring is 24 px and the square's is 28.
  assert.equal(checkOutline(brushSpans(5, 5, 4, 'circle', 12, 12, 2), 'disc 4 ×2'), 24);
  assert.equal(checkOutline(brushSpans(5, 5, 4, 'square', 12, 12, 2), 'box 4 ×2'), 28);
});

test('antsOutlineRuns: a disc clipped at the tile’s edge rings the clipped shape, closing along the edge', () => {
  // A 7 px disc clipped at the tile's top-left corner. The ring runs along the
  // tile edge.
  const clipped = brushSpans(0, 0, 7, 'circle', 10, 10, 2);
  assert.ok(clipped.length < 14, 'rows off the tile are dropped');
  assert.ok(clipped.every((s) => s.x0 >= 0 && s.y >= 0));
  checkOutline(clipped, 'corner-clipped disc');
  // A disc clipped to a single column at the right edge.
  const column = brushSpans(11, 5, 5, 'circle', 10, 10);
  assert.ok(column.length > 0 && column.every((s) => s.x0 === 9 && s.x1 === 9));
  assert.equal(checkOutline(column, 'one-column disc'), column.length);
  // Wholly off the tile.
  assert.deepEqual(antsOutlineRuns(brushSpans(30, 30, 5, 'circle', 10, 10), 0), []);
});
