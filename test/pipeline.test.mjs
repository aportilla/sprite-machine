// Node-runnable correctness tests for the pure voxel pipeline (no THREE/DOM).
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildVoxels } from '../src/lib/pipeline.js';
import { packRGBA, applyTransform } from '../src/lib/ingest.js';
import { voxIndex } from '../src/lib/carve.js';
import { culledQuads, greedyQuads } from '../src/lib/faces.js';
import { sliceAtlas, deriveTileSize } from '../src/lib/atlas.js';

// --- tiny sprite builder: rows of chars -> ImageData-like -------------------
const C = {
  R: [220, 60, 60], // red
  B: [70, 90, 200], // blue
  G: [80, 190, 90], // green
  T: [169, 220, 214], // teal
  M: [199, 125, 214], // magenta
  N: [201, 184, 120], // tan
};
function img(rows, pal = C) {
  const h = rows.length;
  const w = rows[0].length;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      const i = (y * w + x) * 4;
      if (ch === '.' || ch === ' ') continue; // transparent
      const [r, g, b] = pal[ch];
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}
const fill = (w, h, ch) => img(Array.from({ length: h }, () => ch.repeat(w)));
const pk = (name) => packRGBA(...C[name], 255);
// face index: px0 nx1 py2 ny3 pz4 nz5
const F = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 };
const colorOf = (r, x, y, z, face) =>
  r.faceColor.get(voxIndex(x, y, z, r.dims) * 6 + F[face]);

// --- 1. Solid cube (the reference demo) -------------------------------------
test('solid cube: top=teal, +x=tan, +z=magenta, mirrored -x=tan', () => {
  const r = buildVoxels(
    { front: fill(3, 3, 'M'), right: fill(3, 3, 'N'), top: fill(3, 3, 'T') },
    { mirror: { x: true, y: false, z: false } }
  );
  assert.deepEqual(r.dims, { nx: 3, ny: 3, nz: 3 });
  assert.equal(r.solidCount, 27);
  assert.equal(colorOf(r, 1, 2, 1, 'py'), pk('T')); // top face teal
  assert.equal(colorOf(r, 2, 1, 1, 'px'), pk('N')); // +x face tan
  assert.equal(colorOf(r, 1, 1, 2, 'pz'), pk('M')); // +z face magenta
  assert.equal(colorOf(r, 0, 1, 1, 'nx'), pk('N')); // -x mirrored from right
});

// --- 2. Non-cube slab: depth comes from the SIDE width ----------------------
test('2x1x1 slab: independent axis resolutions', () => {
  const r = buildVoxels({ front: fill(2, 1, 'M'), right: fill(1, 1, 'N') });
  assert.deepEqual(r.dims, { nx: 2, ny: 1, nz: 1 });
  assert.equal(r.solidCount, 2);
});

// --- 3. Depth-smear regression (the critical one) ---------------------------
// A gap in Z (via the top view) makes two blocks share one front column.
// The naive rule paints BOTH with the front pixel; the depth-aware rule paints
// only the front-most, and the occluded one must NOT be front's color.
test('L-step: occluded +z face is not smeared with the front color', () => {
  const r = buildVoxels(
    {
      front: fill(1, 1, 'R'), // nx=1, ny=1, front-most colored RED
      right: fill(3, 1, 'B'), // nz=3
      // top image is nx(1) x nz(3); rows top->bottom map to z=2,1,0.
      top: img(['G', '.', 'T']), // solid z=2 (green) & z=0 (teal), gap z=1
    },
    { mirror: { x: true, y: false, z: false } }
  );
  assert.deepEqual(r.dims, { nx: 1, ny: 1, nz: 3 });
  // gap carved out at z=1:
  assert.equal(r.solid[voxIndex(0, 0, 1, r.dims)], 0);
  assert.equal(r.solid[voxIndex(0, 0, 0, r.dims)], 1);
  assert.equal(r.solid[voxIndex(0, 0, 2, r.dims)], 1);
  // front-most block gets front color; occluded block must NOT.
  assert.equal(colorOf(r, 0, 0, 2, 'pz'), pk('R'));
  assert.notEqual(colorOf(r, 0, 0, 0, 'pz'), pk('R'));
  assert.equal(colorOf(r, 0, 0, 2, 'py'), pk('G')); // top of front block
});

// --- 4. Asymmetric sides, mirror OFF: each side keeps its own art -----------
test('asymmetric sides are not fabricated when mirror is off', () => {
  const r = buildVoxels(
    { front: fill(1, 1, 'R'), right: fill(1, 1, 'N'), left: fill(1, 1, 'M') },
    { mirror: { x: false, y: false, z: false } }
  );
  assert.equal(colorOf(r, 0, 0, 0, 'px'), pk('N')); // +x from right
  assert.equal(colorOf(r, 0, 0, 0, 'nx'), pk('M')); // -x from left (its own art)
});

// --- 5. Phantom-block trap: convex over-approx, still fully colored ----------
test('phantom block: over-approximated but every surface face is colored', () => {
  const r = buildVoxels({
    front: fill(3, 3, 'M'),
    right: fill(3, 3, 'N'),
    top: img(['T.T', '.T.', 'T.T']), // diagonal cross
  });
  assert.ok(r.solidCount > 0);
  for (let idx = 0; idx < r.surfaceMask.length; idx++) {
    const m = r.surfaceMask[idx];
    if (!m) continue;
    for (let f = 0; f < 6; f++)
      if (m & (1 << f))
        assert.ok(
          r.faceColor.has(idx * 6 + f),
          `surface face ${idx}:${f} left uncolored`
        );
  }
});

// --- 6. Misregistration recovered by auto-crop ------------------------------
test('padding/offset is normalized by auto-crop to bbox', () => {
  const base = buildVoxels({ front: fill(2, 2, 'M'), right: fill(2, 2, 'N') });
  const paddedRight = img(['....', '.NN.', '.NN.', '....']);
  const shifted = buildVoxels({ front: fill(2, 2, 'M'), right: paddedRight });
  assert.deepEqual(shifted.dims, base.dims);
  assert.deepEqual([...shifted.solid], [...base.solid]);
});

// --- atlas slicing ----------------------------------------------------------
// Build a mock 3x2 atlas of 2x2 tiles (6x4 px); one cell left blank.
function mockAtlas() {
  const W = 6, H = 4;
  const data = new Uint8ClampedArray(W * H * 4);
  const cellColor = {
    // [col,row] -> [r,g,b] ; row1col0 (left) left transparent
    '0,0': [10, 0, 0], '1,0': [20, 0, 0], '2,0': [30, 0, 0],
    '1,1': [40, 0, 0], '2,1': [50, 0, 0],
  };
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 3; c++) {
      const col = cellColor[`${c},${r}`];
      if (!col) continue;
      for (let y = 0; y < 2; y++)
        for (let x = 0; x < 2; x++) {
          const i = ((r * 2 + y) * W + (c * 2 + x)) * 4;
          data[i] = col[0];
          data[i + 3] = 255;
        }
    }
  return { width: W, height: H, data };
}

test('atlas: tile size auto-derived and cells mapped to named views', () => {
  const { tileW, tileH } = deriveTileSize(120, 80); // default 3x2 layout
  assert.equal(tileW, 40);
  assert.equal(tileH, 40);

  const { views, warnings } = sliceAtlas(mockAtlas());
  assert.equal(warnings.length, 0);
  // layout: right front top / left back bottom
  assert.equal(views.right.data[0], 10);
  assert.equal(views.front.data[0], 20);
  assert.equal(views.top.data[0], 30);
  assert.equal(views.back.data[0], 40);
  assert.equal(views.bottom.data[0], 50);
  assert.equal(views.left, null); // blank cell -> null
});

test('applyTransform rot:1 rotates 90deg CW (left column -> top row)', () => {
  const img = { width: 2, height: 1, data: new Uint8ClampedArray([
    200, 0, 0, 255, /* left = red */ 0, 0, 200, 255, /* right = blue */ ]) };
  const out = applyTransform(img, { rot: 1 });
  assert.equal(out.width, 1);
  assert.equal(out.height, 2);
  assert.equal(out.data[0], 200); // top pixel R = came from the left (red)
  assert.equal(out.data[4], 0); // bottom pixel R = 0 (it's blue)
  assert.equal(out.data[6], 200); // bottom pixel B = came from the right (blue)
});

// --- greedy meshing: conservation (no holes/overlaps) + reduction -----------
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const quadArea = (c) => Math.round(dist(c[0], c[1]) * dist(c[1], c[2]));
const sumArea = (quads) => quads.reduce((n, q) => n + quadArea(q.corners), 0);
function exposedFaceCount(r) {
  let n = 0;
  for (let i = 0; i < r.surfaceMask.length; i++) {
    let m = r.surfaceMask[i];
    while (m) {
      n += m & 1;
      m >>= 1;
    }
  }
  return n;
}

test('greedy meshing conserves surface area (no holes or overlaps)', () => {
  for (const r of [
    buildVoxels({ front: fill(3, 3, 'M'), right: fill(3, 3, 'N'), top: fill(3, 3, 'T') }),
    buildVoxels({
      front: img(['.MM.', 'MMMM', 'MNNM']),
      right: img(['..BB..', 'BBBBBB', 'BBBBBB']),
      top: fill(4, 6, 'N'),
    }),
  ]) {
    const exposed = exposedFaceCount(r);
    const culled = culledQuads(r.dims, r.surfaceMask, r.faceColor);
    const greedy = greedyQuads(r.dims, r.surfaceMask, r.faceColor);
    assert.equal(culled.length, exposed); // one quad per exposed face
    assert.equal(sumArea(culled), exposed); // sanity
    assert.equal(sumArea(greedy), exposed); // greedy covers exactly the same area
    assert.ok(greedy.length <= culled.length);
  }
});

test('greedy collapses a solid cube to 6 faces (12 tris)', () => {
  const r = buildVoxels(
    { front: fill(8, 8, 'M'), right: fill(8, 8, 'N'), top: fill(8, 8, 'T') },
    { mirror: { x: true, y: false, z: false } }
  );
  const greedy = greedyQuads(r.dims, r.surfaceMask, r.faceColor);
  // 6 outer faces; each is a single flat color -> one merged rect each.
  assert.equal(greedy.length, 6);
});

// --- 7. Minimal 3-face "truck" sanity ---------------------------------------
test('3-face chunky object builds and fully colors', () => {
  const r = buildVoxels({
    front: img(['.MM.', 'MMMM', 'MNNM']), // cab-ish silhouette
    right: img(['..BB..', 'BBBBBB', 'BBBBBB']),
    top: img(['NNNN', 'NNNN', 'NNNN', 'NNNN', 'NNNN', 'NNNN']),
  });
  assert.ok(r.surfaceCount > 0);
  assert.equal(r.warnings.length, 0);
  for (let idx = 0; idx < r.surfaceMask.length; idx++) {
    const m = r.surfaceMask[idx];
    for (let f = 0; f < 6; f++)
      if (m & (1 << f)) assert.ok(r.faceColor.has(idx * 6 + f));
  }
});
