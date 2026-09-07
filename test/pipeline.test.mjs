// Node-runnable correctness tests for the pure voxel pipeline (no THREE/DOM):
// the visual-hull carve and its strict-registration rules, depth-aware
// coloring, greedy meshing's area conservation, and the projection conventions.
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildVoxels } from '../src/lib/pipeline.js';
import { packRGBA } from '../src/lib/ingest.js';
import { voxIndex } from '../src/lib/carve.js';
import { culledQuads, greedyQuads } from '../src/lib/faces.js';
import { VIEWS } from '../src/lib/views.js';
import { C, img, fill } from './helpers.mjs';

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
  assert.equal(colorOf(r, 2, 1, 1, 'px'), pk('N')); // +x face tan (mirror of right)
  assert.equal(colorOf(r, 1, 1, 2, 'pz'), pk('M')); // +z face magenta
  assert.equal(colorOf(r, 0, 1, 1, 'nx'), pk('N')); // -x face tan (from the right tile)
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

// --- 3b. Opposite-view registration slip must not erode a protrusion --------
// A car's side mirror sticks out on the outer column (x=0,2). The TOP sprite
// draws it one row back from where the BOTTOM sprite does (a 1-texel hand-draw
// slip). Both views constrain the X-Z plane; a naive AND of the pair leaves an
// empty intersection on the outer columns and deletes the mirror. Carving must
// UNION opposite views per plane, keeping the protrusion the artist drew.
test('opposite views: 1-texel top/bottom slip does not erase a protrusion', () => {
  const r = buildVoxels(
    {
      front: fill(3, 1, 'M'), // nx=3, ny=1 — every column allowed by front/right
      right: fill(3, 1, 'N'), // nz=3
      // top & bottom both map v->z as z=2,1,0 (bottom also mirrors x, but these
      // tiles are x-symmetric): top's full row is at z=2, bottom's at z=1.
      top: img(['TTT', '.T.', '.T.']), // outer cols (x=0,2) protrude at z=2
      bottom: img(['.T.', 'TTT', '.T.']), // ...but bottom puts them at z=1
    },
    { mirror: { x: false, y: false, z: false } }
  );
  assert.deepEqual(r.dims, { nx: 3, ny: 1, nz: 3 });
  // Union per plane keeps BOTH the top-drawn (z=2) and bottom-drawn (z=1) outer
  // voxels; the old AND-every-view carve would have deleted both.
  assert.equal(r.solid[voxIndex(0, 0, 2, r.dims)], 1); // top's protrusion row
  assert.equal(r.solid[voxIndex(2, 0, 2, r.dims)], 1);
  assert.equal(r.solid[voxIndex(0, 0, 1, r.dims)], 1); // bottom's protrusion row
  assert.equal(r.solid[voxIndex(2, 0, 1, r.dims)], 1);
  // Union is not a free-for-all: where NEITHER opposite view covers the outer
  // column (z=0) it stays carved out.
  assert.equal(r.solid[voxIndex(0, 0, 0, r.dims)], 0);
  assert.equal(r.solid[voxIndex(2, 0, 0, r.dims)], 0);
  // The body column (x=1) is solid the full depth.
  for (let z = 0; z < 3; z++) assert.equal(r.solid[voxIndex(1, 0, z, r.dims)], 1);
});

// --- 4. Asymmetric sides, mirror OFF: each side keeps its own art -----------
test('asymmetric sides are not fabricated when mirror is off', () => {
  const r = buildVoxels(
    { front: fill(1, 1, 'R'), right: fill(1, 1, 'N'), left: fill(1, 1, 'M') },
    { mirror: { x: false, y: false, z: false } }
  );
  assert.equal(colorOf(r, 0, 0, 0, 'px'), pk('M')); // +x from left (reads as left profile)
  assert.equal(colorOf(r, 0, 0, 0, 'nx'), pk('N')); // -x from right (its own art)
});

// --- 5. Every surface face is colored: a phantom block and a chunky truck ----
// A diagonal-cross top over-approximates into phantom blocks (the convex hull's
// trap); the truck is a coherent 3-face silhouette. Either way every exposed
// face must carry a color.
function assertSurfaceColored(r) {
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
}

test('phantom block and 3-face chunky object: every surface face is colored', () => {
  const phantom = buildVoxels({
    front: fill(3, 3, 'M'),
    right: fill(3, 3, 'N'),
    top: img(['T.T', '.T.', 'T.T']), // diagonal cross
  });
  assert.ok(phantom.solidCount > 0);
  assertSurfaceColored(phantom);

  const truck = buildVoxels({
    front: img(['.MM.', 'MMMM', 'MNNM']), // cab-ish silhouette
    right: img(['..BB..', 'BBBBBB', 'BBBBBB']),
    top: fill(4, 6, 'N'),
  });
  assert.ok(truck.surfaceCount > 0);
  assert.equal(truck.warnings.length, 0);
  assertSurfaceColored(truck);
});

// --- 6. Strict registration: tile padding is significant (no auto-crop) ------
// A pixel's position inside its tile IS its position in the object, so a padded
// view is NOT normalized away — the padding changes the geometry.
test('strict registration: tile padding is preserved (not auto-cropped)', () => {
  const base = buildVoxels({ front: fill(2, 2, 'M'), right: fill(2, 2, 'N') });
  assert.deepEqual(base.dims, { nx: 2, ny: 2, nz: 2 });
  // A 4x4 right with its 2x2 of pixels in the middle is a 4-wide, 4-tall view.
  const paddedRight = img(['....', '.NN.', '.NN.', '....']);
  const padded = buildVoxels({ front: fill(2, 2, 'M'), right: paddedRight });
  // No crop: the padding grows the depth (nz) and height (ny) axes...
  assert.deepEqual(padded.dims, { nx: 2, ny: 4, nz: 4 });
  // ...and the resulting size mismatch on Y (front 2 vs right 4) is surfaced.
  assert.ok(padded.warnings.some((w) => /disagree on Y/i.test(w)));
});

// --- 6b. Strict registration: identity placement, no auto ground-rest --------
// The old pipeline bottom-anchored every view so content rested on y=0. Strict
// registration keeps a pixel at the row the artist drew it: paint high in the
// tile and the solid sits high (it floats — ground contact is the artist's job).
test('strict registration: mid-tile Y is preserved (no bottom-anchor)', () => {
  const r = buildVoxels(
    {
      front: img(['MM', '..', '..']), // content only in the TOP row -> world y=2
      right: fill(1, 3, 'N'), // full-height side, same 3 rows -> Y agrees
    },
    { mirror: { x: false, y: false, z: false } }
  );
  assert.deepEqual(r.dims, { nx: 2, ny: 3, nz: 1 });
  assert.equal(r.warnings.length, 0); // uniform Y (both 3 tall): no disagreement
  // Top image row is world y = ny-1 = 2; that is where the solid lands...
  assert.equal(r.solid[voxIndex(0, 2, 0, r.dims)], 1);
  assert.equal(r.solid[voxIndex(1, 2, 0, r.dims)], 1);
  // ...NOT dropped to the ground (y=0,1 empty — the old bottom-anchor put it here).
  assert.equal(r.solid[voxIndex(0, 0, 0, r.dims)], 0);
  assert.equal(r.solid[voxIndex(0, 1, 0, r.dims)], 0);
  assert.equal(r.solidCount, 2);
});

// --- 6c. Strict registration: a narrower view anchors at the origin ----------
// A wider TOP and a narrower FRONT disagree on X. The front is placed from the
// origin (left), NOT centered, so it constrains the leftmost columns and warns.
test('strict registration: a narrower view anchors at the origin (not centered)', () => {
  const r = buildVoxels({ front: fill(2, 1, 'M'), top: fill(4, 1, 'N') });
  assert.deepEqual(r.dims, { nx: 4, ny: 1, nz: 1 });
  assert.ok(r.warnings.some((w) => /disagree on X/i.test(w)));
  // front (width 2) sits at x=0,1 (origin) -> those columns solid, x=2,3 carved.
  assert.equal(r.solid[voxIndex(0, 0, 0, r.dims)], 1);
  assert.equal(r.solid[voxIndex(1, 0, 0, r.dims)], 1);
  assert.equal(r.solid[voxIndex(2, 0, 0, r.dims)], 0);
  assert.equal(r.solid[voxIndex(3, 0, 0, r.dims)], 0);
  assert.equal(r.solidCount, 2);
});

// --- 6d. Strict registration: the core contract — pixels must align ----------
// A FRONT pixel at (col cx, row ry) only becomes a voxel where the TOP covers
// column cx AND the SIDE covers row ry. Aligned pixels survive; misaligned carve.
test('strict registration: unmatched front pixels carve away', () => {
  const r = buildVoxels(
    {
      // 3x3x3. front paints (x=2 at v=0 -> y=2) and (x=0 at v=2 -> y=0).
      front: img(['..M', '...', 'M..']),
      top: img(['T..', 'T..', 'T..']), // covers only column x=0 (all z)
      right: img(['...', '...', 'NNN']), // covers only row y=0 (bottom image row)
    },
    { mirror: { x: false, y: false, z: false } }
  );
  assert.deepEqual(r.dims, { nx: 3, ny: 3, nz: 3 });
  // (x=0,y=0): top covers col 0 AND side covers row y=0 -> survives at some z.
  let survive = 0;
  for (let z = 0; z < 3; z++) survive += r.solid[voxIndex(0, 0, z, r.dims)];
  assert.ok(survive > 0, 'aligned pixel (x=0,y=0) should survive');
  // (x=2,y=2): top has no column 2 -> fully carved regardless of the side.
  for (let z = 0; z < 3; z++) assert.equal(r.solid[voxIndex(2, 2, z, r.dims)], 0);
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
    const culled = culledQuads(r.dims, r.surfaceMask);
    const greedy = greedyQuads(r.dims, r.surfaceMask);
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
  const greedy = greedyQuads(r.dims, r.surfaceMask);
  // 6 outer faces -> one merged rect each.
  assert.equal(greedy.length, 6);
});

test('greedy merges on occupancy alone: a two-color wall is one rect', () => {
  // A 4×4 front painted in two colors over a full side and top. The color-
  // aware merge gave two +z rects (one per band); on occupancy the wall is
  // one 4×4 rect — the paint is the skin's business (skin.test.mjs).
  const r = buildVoxels({
    front: img(['RRRR', 'RRRR', 'BBBB', 'BBBB']),
    right: fill(4, 4, 'T'),
    top: fill(4, 4, 'T'),
  });
  const pz = greedyQuads(r.dims, r.surfaceMask).filter((q) => q.face === 'pz');
  assert.equal(pz.length, 1);
  assert.deepEqual([pz[0].w, pz[0].h], [4, 4]);
});

// --- 7. Projection conventions pinned (docs/code can't silently drift) -------
test('projection conventions: the object front pins to TOP/BOTTOM’s top row and LEFT’s left column', () => {
  const d = { nx: 4, ny: 3, nz: 5 };
  // front is +z (z = nz-1). TOP and BOTTOM both put it on the top row (v=0) —
  // BOTTOM is the sideways (left/right) flip of TOP, not end-over-end.
  assert.equal(VIEWS.top.project(0, 0, d.nz - 1, d).v, 0);
  assert.equal(VIEWS.top.project(0, 0, 0, d).v, d.nz - 1);
  assert.equal(VIEWS.bottom.project(0, 0, d.nz - 1, d).v, 0); // front -> top row too
  assert.equal(VIEWS.bottom.project(0, 0, 0, d).v, d.nz - 1);
  // ...and BOTTOM mirrors X vs TOP (sideways flip): x=0 -> right column.
  assert.equal(VIEWS.top.project(0, 0, 0, d).u, 0);
  assert.equal(VIEWS.bottom.project(0, 0, 0, d).u, d.nx - 1);
  // LEFT: the object front is the left image column, the back the right one.
  assert.equal(VIEWS.left.project(0, 0, d.nz - 1, d).u, 0);
  assert.equal(VIEWS.left.project(0, 0, 0, d).u, d.nz - 1);
});

// --- 8. Zero-view edge case: a single solid voxel, with a clear warning ------
test('buildVoxels with no views yields one voxel and warns', () => {
  const r = buildVoxels({});
  assert.deepEqual(r.dims, { nx: 1, ny: 1, nz: 1 });
  assert.equal(r.solidCount, 1);
  assert.ok(r.warnings.some((w) => /no usable views/i.test(w)));
});
