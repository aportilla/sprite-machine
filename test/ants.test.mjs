// Node-runnable tests for the marching ants' raster (pure, no DOM): the
// clockwise ring walk, the dash cycle, the march and the seam.
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { antsRuns, ANTS_DASH, ANTS_PERIOD } from '../src/lib/ants.js';

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
