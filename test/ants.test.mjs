// Node-runnable tests for the marching ants' raster (pure, no DOM): the
// clockwise ring walk, the dash cycle, the march and the seam — and the
// OUTLINE ring around a row-convex shape (a circle tip's disc), whose walk
// is the rectangle's exact generalization. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { antsRuns, antsOutlineRuns, ANTS_DASH, ANTS_PERIOD } from '../src/lib/ants.js';
import { brushSpans } from '../src/lib/brush.js';

// An independent statement of the walk: the ring's pixels in clockwise order
// from the top-left corner, as its four straight segments — top row →, right
// column ↓, bottom row ←, left column ↑ — each pixel once, degenerate 1-wide
// / 1-tall frames included (an empty segment is dropped).
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
const walk = (f) => segments(f).flat();

// The ink of walk pixel i at `phase`: four black, four white, the dashes
// advancing one px along the walk per phase step.
const blackAt = (i, phase) =>
  (((i - phase) % ANTS_PERIOD) + ANTS_PERIOD) % ANTS_PERIOD < ANTS_DASH;

// The runs the walk implies, built the slow way: ink every pixel, then
// run-length encode each segment by ink — a run's rect spans its pixels.
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

// Flatten runs into per-pixel [x, y, black] in WALK order: a run on the
// bottom row was walked leftward and one on the left column upward, so those
// expand backward (a 1-tall / 1-wide frame has only its top row / right
// column, walked forward).
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
  { x: 0, y: 0, w: 5, h: 5 }, // a 16-px ring: two whole cycles, no seam
  { x: 3, y: 2, w: 12, h: 7 }, // a 34-px ring: a seam two px into a dash
  { x: 0, y: 0, w: 8, h: 8 }, // a 28-px ring: a seam mid-cycle
  { x: 40, y: 12, w: 9, h: 3 },
  { x: -6, y: -2, w: 10, h: 10 }, // hanging off the tile: negative coordinates
  { x: 1, y: 1, w: 1, h: 6 }, // a single column
  { x: 1, y: 1, w: 6, h: 1 }, // a single row
  { x: 4, y: 4, w: 2, h: 2 }, // the whole ring is four corners
  { x: 0, y: 0, w: 1, h: 1 }, // one pixel
];

test('the runs cover the ring exactly once, in clockwise walk order', () => {
  for (const f of FRAMES) {
    const expect = walk(f);
    for (let phase = 0; phase < ANTS_PERIOD; phase++) {
      const got = pixels(antsRuns(f, phase), f);
      assert.equal(got.length, expect.length, `frame ${JSON.stringify(f)} count`);
      assert.deepEqual(
        got.map(([x, y]) => [x, y]),
        expect,
        `frame ${JSON.stringify(f)} phase ${phase} order`
      );
      const keys = new Set(got.map(([x, y]) => `${x},${y}`));
      assert.equal(keys.size, got.length, 'each pixel once');
    }
    // 2(w+h) − 4 for a real ring; a line degenerates to its own length.
    const { w, h } = f;
    const ring = w > 1 && h > 1 ? 2 * (w + h) - 4 : Math.max(w, h);
    assert.equal(walk(f).length, ring);
  }
});

test('pixel i is black when (i − phase) mod 8 < 4: four on, four off', () => {
  for (const f of FRAMES) {
    for (let phase = 0; phase < ANTS_PERIOD; phase++) {
      const got = pixels(antsRuns(f, phase), f);
      got.forEach(([, , black], i) =>
        assert.equal(
          black,
          blackAt(i, phase),
          `frame ${JSON.stringify(f)} phase ${phase} px ${i}`
        )
      );
    }
  }
});

test('a phase step marches the dashes one px FORWARD along the walk (clockwise)', () => {
  const f = { x: 2, y: 3, w: 13, h: 9 };
  for (let phase = 0; phase < ANTS_PERIOD; phase++) {
    const now = pixels(antsRuns(f, phase), f);
    const next = pixels(antsRuns(f, phase + 1), f);
    // Pixel i at the next phase shows what pixel i−1 showed at this one.
    for (let i = 1; i < now.length; i++)
      assert.equal(next[i][2], now[i - 1][2], `px ${i}`);
  }
});

test('the phase is cyclic and any integer reduces', () => {
  const f = { x: 0, y: 0, w: 7, h: 6 };
  for (let phase = 0; phase < ANTS_PERIOD; phase++) {
    const base = antsRuns(f, phase);
    assert.deepEqual(antsRuns(f, phase + ANTS_PERIOD), base, `+period at ${phase}`);
    assert.deepEqual(antsRuns(f, phase - ANTS_PERIOD), base, `−period at ${phase}`);
    assert.deepEqual(
      antsRuns(f, phase + 3 * ANTS_PERIOD),
      base,
      `+3 periods at ${phase}`
    );
  }
});

// The whole contract in one pin: the arithmetic runs equal the run-length
// encoding of the inked walk, segment by segment — so every run is maximal
// within its segment (a corner pixel's run and the column below it may share
// an ink: they are different segments), and nothing is split or merged.
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
  // A 5×5 frame has a 16-px ring — two full cycles, so the last dash meets
  // the first exactly. A 6×6 frame's 20-px ring ends four px into a cycle:
  // at phase 0 its last four px (the left column, bottom to top) are the
  // start of a black dash that the top-left corner cuts off — the seam.
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
  // …and it walks INTO the corner: the seam's black run is the left column's
  // top four px, the corner pixel (0,0) itself belonging to the first run.
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

// The concrete runs of the 5×5 case at phase 0, in emission order — a pin a
// reader can check against the header's walk by hand. Every run lies on
// whole pixels: there is nothing here a rasterizer could anti-alias.
test('5×5 at phase 0: the concrete runs', () => {
  assert.deepEqual(antsRuns({ x: 0, y: 0, w: 5, h: 5 }, 0), [
    { x: 0, y: 0, w: 4, h: 1, black: true }, // top row: the first dash
    { x: 4, y: 0, w: 1, h: 1, black: false }, // the top-right corner
    { x: 4, y: 1, w: 1, h: 3, black: false }, // right column, down
    { x: 4, y: 4, w: 1, h: 1, black: true }, // the bottom-right corner
    { x: 1, y: 4, w: 3, h: 1, black: true }, // bottom row, walked leftward
    { x: 0, y: 4, w: 1, h: 1, black: false }, // the bottom-left corner
    { x: 0, y: 1, w: 1, h: 3, black: false }, // left column, walked upward
  ]);
  // Phase 1: everything one px on. The corner pixel (4,0) is now the black
  // dash's tail; the first run is one px shorter, a white px leads.
  assert.deepEqual(antsRuns({ x: 0, y: 0, w: 5, h: 5 }, 1).slice(0, 3), [
    { x: 0, y: 0, w: 1, h: 1, black: false },
    { x: 1, y: 0, w: 4, h: 1, black: true },
    { x: 4, y: 1, w: 1, h: 4, black: false },
  ]);
});

test('a frame under 1×1 emits nothing', () => {
  assert.deepEqual(antsRuns({ x: 0, y: 0, w: 0, h: 5 }, 0), []);
  assert.deepEqual(antsRuns({ x: 0, y: 0, w: 5, h: 0 }, 3), []);
});

// --- the outline ring ---------------------------------------------------------

// A box as spans — the outline walk's special case.
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

// The independent statement of the outline: the shape's THIN boundary — every
// px of it with a 4-neighbour outside — as a set of keys.
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

// Expand outline runs into per-pixel [x, y, black] in WALK order. A run
// carries no direction, but the walk is a chain: a run of two or more px
// joins the pixel before it at exactly one of its ends, and that end comes
// first (the first run is the top row, walked left → right).
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

// The whole outline contract on one shape: the walk is exactly the thin
// boundary, each px once, 8-connected and closed, clockwise from the top
// row's left end, inked by the dash cycle at every phase.
function checkOutline(spans, label) {
  const boundary = thinBoundary(spans);
  for (let phase = 0; phase < ANTS_PERIOD; phase++) {
    const walk = outlineWalk(antsOutlineRuns(spans, phase));
    const keys = walk.map(([x, y]) => key(x, y));
    assert.equal(new Set(keys).size, keys.length, `${label}: each px once`);
    assert.deepEqual([...keys].sort(), boundary, `${label}: exactly the thin boundary`);
    for (let i = 1; i < walk.length; i++)
      assert.ok(cheb(walk[i], walk[i - 1]) <= 1, `${label}: 8-connected at px ${i}`);
    // A ring closes; a shape one px wide or tall degenerates to a line walked
    // once, the box's own rule (its last px is the line's far end).
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
  // Every tip size the editor allows at 1 system px per texel, and the
  // small sizes at 2 and 3 (a texel several px wide makes every step a run).
  for (let n = 1; n <= 64; n++)
    checkOutline(brushSpans(70, 70, n, 'circle', 200, 200), `disc ${n}`);
  for (let n = 1; n <= 9; n++) {
    checkOutline(brushSpans(20, 20, n, 'circle', 50, 50, 2), `disc ${n} ×2`);
    checkOutline(brushSpans(20, 20, n, 'circle', 50, 50, 3), `disc ${n} ×3`);
  }
});

test('antsOutlineRuns: the plus is a four-px diamond; a box’s ring is the frame’s', () => {
  // The 3 px disc at 1 px per texel is the plus: its center has every
  // neighbour inside, so the ring is its four arm tips — one seam, a diamond.
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
  // The 4 px disc at 2 px per texel: a 6×6 box less its 2×2 corners — a
  // 24-px ring where the box's would be 28.
  assert.equal(checkOutline(brushSpans(5, 5, 4, 'circle', 12, 12, 2), 'disc 4 ×2'), 24);
  assert.equal(checkOutline(brushSpans(5, 5, 4, 'square', 12, 12, 2), 'box 4 ×2'), 28);
});

test('antsOutlineRuns: a disc clipped at the tile’s edge rings the clipped shape, closing along the edge', () => {
  // A 7 px disc on the tile's top-left corner: rows above and columns left of
  // the tile are gone, and the ring runs along the tile edge.
  const clipped = brushSpans(0, 0, 7, 'circle', 10, 10, 2);
  assert.ok(clipped.length < 14, 'rows off the tile are dropped');
  assert.ok(clipped.every((s) => s.x0 >= 0 && s.y >= 0));
  checkOutline(clipped, 'corner-clipped disc');
  // A disc clipped to a single column at the right edge — the degenerate
  // 1-wide shape a box handles as its own column.
  const column = brushSpans(11, 5, 5, 'circle', 10, 10);
  assert.ok(column.length > 0 && column.every((s) => s.x0 === 9 && s.x1 === 9));
  assert.equal(checkOutline(column, 'one-column disc'), column.length);
  // Wholly off the tile: nothing.
  assert.deepEqual(antsOutlineRuns(brushSpans(30, 30, 5, 'circle', 10, 10), 0), []);
});
