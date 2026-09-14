import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildVoxels, unionVoxels, buildLayeredVoxels } from '../src/pipeline.js';
import { packRGBA } from '../src/ingest.js';
import { voxIndex } from '../src/carve.js';
import { faceRegions } from '../src/regions.js';
import { VIEWS } from '../src/views.js';
import { C, img, fill } from './helpers.mjs';

const pk = (name) => packRGBA(...C[name], 255);
const F = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 };
const colorOf = (r, x, y, z, face) =>
  r.faceColor.get(voxIndex(x, y, z, r.dims) * 6 + F[face]);

test('solid cube: top=teal, +x=tan, +z=magenta, mirrored -x=tan', () => {
  const r = buildVoxels(
    { front: fill(3, 3, 'M'), right: fill(3, 3, 'N'), top: fill(3, 3, 'T') },
    { mirror: { x: true, y: false, z: false } }
  );
  assert.deepEqual(r.dims, { nx: 3, ny: 3, nz: 3 });
  assert.equal(r.solidCount, 27);
  assert.equal(colorOf(r, 1, 2, 1, 'py'), pk('T'));
  assert.equal(colorOf(r, 2, 1, 1, 'px'), pk('N')); // mirrored from right
  assert.equal(colorOf(r, 1, 1, 2, 'pz'), pk('M'));
  assert.equal(colorOf(r, 0, 1, 1, 'nx'), pk('N')); // from right
});

// Depth comes from the side view's width.
test('2x1x1 slab: independent axis resolutions', () => {
  const r = buildVoxels({ front: fill(2, 1, 'M'), right: fill(1, 1, 'N') });
  assert.deepEqual(r.dims, { nx: 2, ny: 1, nz: 1 });
  assert.equal(r.solidCount, 2);
});

// A gap in z makes two blocks share one front column. Only the front-most block
// takes the front color.
test('L-step: occluded +z face is not smeared with the front color', () => {
  const r = buildVoxels(
    {
      front: fill(1, 1, 'R'), // nx=1, ny=1
      right: fill(3, 1, 'B'), // nz=3
      // Top rows map to z=2,1,0.
      top: img(['G', '.', 'T']), // solid at z=2 and z=0, gap at z=1
    },
    { mirror: { x: true, y: false, z: false } }
  );
  assert.deepEqual(r.dims, { nx: 1, ny: 1, nz: 3 });
  assert.equal(r.solid[voxIndex(0, 0, 1, r.dims)], 0);
  assert.equal(r.solid[voxIndex(0, 0, 0, r.dims)], 1);
  assert.equal(r.solid[voxIndex(0, 0, 2, r.dims)], 1);
  assert.equal(colorOf(r, 0, 0, 2, 'pz'), pk('R'));
  assert.notEqual(colorOf(r, 0, 0, 0, 'pz'), pk('R'));
  assert.equal(colorOf(r, 0, 0, 2, 'py'), pk('G')); // top of front block
});

// Top and bottom draw an outer-column protrusion one row apart. Carving unions
// opposite views per plane, so both rows stay solid.
test('opposite views: 1-texel top/bottom slip does not erase a protrusion', () => {
  const r = buildVoxels(
    {
      front: fill(3, 1, 'M'), // nx=3, ny=1
      right: fill(3, 1, 'N'), // nz=3
      // Both map rows to z=2,1,0. Bottom mirrors x, but these tiles are x-symmetric.
      top: img(['TTT', '.T.', '.T.']), // outer cols (x=0,2) protrude at z=2
      bottom: img(['.T.', 'TTT', '.T.']), // outer cols protrude at z=1
    },
    { mirror: { x: false, y: false, z: false } }
  );
  assert.deepEqual(r.dims, { nx: 3, ny: 1, nz: 3 });
  assert.equal(r.solid[voxIndex(0, 0, 2, r.dims)], 1); // top's protrusion row
  assert.equal(r.solid[voxIndex(2, 0, 2, r.dims)], 1);
  assert.equal(r.solid[voxIndex(0, 0, 1, r.dims)], 1); // bottom's protrusion row
  assert.equal(r.solid[voxIndex(2, 0, 1, r.dims)], 1);
  // Neither view covers the outer columns at z=0.
  assert.equal(r.solid[voxIndex(0, 0, 0, r.dims)], 0);
  assert.equal(r.solid[voxIndex(2, 0, 0, r.dims)], 0);
  for (let z = 0; z < 3; z++) assert.equal(r.solid[voxIndex(1, 0, z, r.dims)], 1);
});

test('asymmetric sides are not fabricated when mirror is off', () => {
  const r = buildVoxels(
    { front: fill(1, 1, 'R'), right: fill(1, 1, 'N'), left: fill(1, 1, 'M') },
    { mirror: { x: false, y: false, z: false } }
  );
  assert.equal(colorOf(r, 0, 0, 0, 'px'), pk('M')); // +x from left
  assert.equal(colorOf(r, 0, 0, 0, 'nx'), pk('N')); // -x from right
});

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
    top: img(['T.T', '.T.', 'T.T']), // diagonal cross: yields phantom blocks
  });
  assert.ok(phantom.solidCount > 0);
  assertSurfaceColored(phantom);

  const truck = buildVoxels({
    front: img(['.MM.', 'MMMM', 'MNNM']),
    right: img(['..BB..', 'BBBBBB', 'BBBBBB']),
    top: fill(4, 6, 'N'),
  });
  assert.ok(truck.surfaceCount > 0);
  assert.equal(truck.warnings.length, 0);
  assertSurfaceColored(truck);
});

// A pixel's position in its tile is its position in the object.
test('strict registration: tile padding is preserved (not auto-cropped)', () => {
  const base = buildVoxels({ front: fill(2, 2, 'M'), right: fill(2, 2, 'N') });
  assert.deepEqual(base.dims, { nx: 2, ny: 2, nz: 2 });
  const paddedRight = img(['....', '.NN.', '.NN.', '....']);
  const padded = buildVoxels({ front: fill(2, 2, 'M'), right: paddedRight });
  // The padding grows nz and ny.
  assert.deepEqual(padded.dims, { nx: 2, ny: 4, nz: 4 });
  // Front (2) and right (4) disagree on Y.
  assert.ok(padded.warnings.some((w) => /disagree on Y/i.test(w)));
});

test('strict registration: mid-tile Y is preserved (no bottom-anchor)', () => {
  const r = buildVoxels(
    {
      front: img(['MM', '..', '..']), // top row only -> world y=2
      right: fill(1, 3, 'N'), // full height, so Y agrees
    },
    { mirror: { x: false, y: false, z: false } }
  );
  assert.deepEqual(r.dims, { nx: 2, ny: 3, nz: 1 });
  assert.equal(r.warnings.length, 0);
  // The top image row is world y = ny-1 = 2.
  assert.equal(r.solid[voxIndex(0, 2, 0, r.dims)], 1);
  assert.equal(r.solid[voxIndex(1, 2, 0, r.dims)], 1);
  assert.equal(r.solid[voxIndex(0, 0, 0, r.dims)], 0);
  assert.equal(r.solid[voxIndex(0, 1, 0, r.dims)], 0);
  assert.equal(r.solidCount, 2);
});

test('strict registration: a narrower view anchors at the origin (not centered)', () => {
  const r = buildVoxels({ front: fill(2, 1, 'M'), top: fill(4, 1, 'N') });
  assert.deepEqual(r.dims, { nx: 4, ny: 1, nz: 1 });
  assert.ok(r.warnings.some((w) => /disagree on X/i.test(w)));
  // front (width 2) covers x=0,1
  assert.equal(r.solid[voxIndex(0, 0, 0, r.dims)], 1);
  assert.equal(r.solid[voxIndex(1, 0, 0, r.dims)], 1);
  assert.equal(r.solid[voxIndex(2, 0, 0, r.dims)], 0);
  assert.equal(r.solid[voxIndex(3, 0, 0, r.dims)], 0);
  assert.equal(r.solidCount, 2);
});

// A front pixel at (cx, ry) survives only where the top covers column cx and the
// side covers row ry.
test('strict registration: unmatched front pixels carve away', () => {
  const r = buildVoxels(
    {
      // front paints (x=2, y=2) and (x=0, y=0)
      front: img(['..M', '...', 'M..']),
      top: img(['T..', 'T..', 'T..']), // column x=0 only
      right: img(['...', '...', 'NNN']), // row y=0 only
    },
    { mirror: { x: false, y: false, z: false } }
  );
  assert.deepEqual(r.dims, { nx: 3, ny: 3, nz: 3 });
  // (x=0, y=0) is covered by both views, so it survives at some z.
  let survive = 0;
  for (let z = 0; z < 3; z++) survive += r.solid[voxIndex(0, 0, z, r.dims)];
  assert.ok(survive > 0, 'aligned pixel (x=0,y=0) should survive');
  // (x=2, y=2): the top has no column 2.
  for (let z = 0; z < 3; z++) assert.equal(r.solid[voxIndex(2, 2, z, r.dims)], 0);
});

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

test('the regions cover the surface exactly: every exposed face in one region, none twice', () => {
  for (const r of [
    buildVoxels({ front: fill(3, 3, 'M'), right: fill(3, 3, 'N'), top: fill(3, 3, 'T') }),
    buildVoxels({
      front: img(['.MM.', 'MMMM', 'MNNM']),
      right: img(['..BB..', 'BBBBBB', 'BBBBBB']),
      top: fill(4, 6, 'N'),
    }),
  ]) {
    const exposed = exposedFaceCount(r);
    const regions = faceRegions(r.dims, r.surfaceMask, r.faceColor);
    let covered = 0;
    for (const g of regions) for (const p of g.present) covered += p;
    assert.equal(covered, exposed);
    assert.ok(regions.length <= exposed);
  }
});

test('a solid cube is six regions, a quad each (12 tris)', () => {
  const r = buildVoxels(
    { front: fill(8, 8, 'M'), right: fill(8, 8, 'N'), top: fill(8, 8, 'T') },
    { mirror: { x: true, y: false, z: false } }
  );
  const regions = faceRegions(r.dims, r.surfaceMask, r.faceColor);
  assert.equal(regions.length, 6);
  for (const g of regions) assert.deepEqual([g.outer.length, g.holes.length], [4, 0]);
});

test('the regions form on occupancy alone: a two-color wall is one region', () => {
  const r = buildVoxels({
    front: img(['RRRR', 'RRRR', 'BBBB', 'BBBB']),
    right: fill(4, 4, 'T'),
    top: fill(4, 4, 'T'),
  });
  const pz = faceRegions(r.dims, r.surfaceMask, r.faceColor).filter(
    (g) => g.face === 'pz'
  );
  assert.equal(pz.length, 1);
  assert.deepEqual(
    [pz[0].w, pz[0].h, pz[0].outer.length, pz[0].uniform],
    [4, 4, 4, null]
  );
});

test('projection conventions: the object front pins to TOP/BOTTOM’s top row and LEFT’s left column', () => {
  const d = { nx: 4, ny: 3, nz: 5 };
  // The front is +z (z = nz-1). Top and bottom both put it on row v=0.
  assert.equal(VIEWS.top.project(0, 0, d.nz - 1, d).v, 0);
  assert.equal(VIEWS.top.project(0, 0, 0, d).v, d.nz - 1);
  assert.equal(VIEWS.bottom.project(0, 0, d.nz - 1, d).v, 0);
  assert.equal(VIEWS.bottom.project(0, 0, 0, d).v, d.nz - 1);
  // Bottom mirrors x: x=0 is its right column.
  assert.equal(VIEWS.top.project(0, 0, 0, d).u, 0);
  assert.equal(VIEWS.bottom.project(0, 0, 0, d).u, d.nx - 1);
  // Left: the front is the left image column.
  assert.equal(VIEWS.left.project(0, 0, d.nz - 1, d).u, 0);
  assert.equal(VIEWS.left.project(0, 0, 0, d).u, d.nz - 1);
});

test('buildVoxels with no views yields one voxel and warns', () => {
  const r = buildVoxels({});
  assert.deepEqual(r.dims, { nx: 1, ny: 1, nz: 1 });
  assert.equal(r.solidCount, 1);
  assert.ok(r.warnings.some((w) => /no usable views/i.test(w)));
});

// Layers

const rows4 = (row) => img([row, row, row, row]);
// A box over the columns `row` paints, the full height and depth of a 4³ lattice.
const box = (row, ch) => ({ front: rows4(row), left: fill(4, 4, ch), top: rows4(row) });
const LEFT_RED = box('RR..', 'R'); // x 0..1
const RIGHT_BLUE = box('..BB', 'B'); // x 2..3
const CUBE_BLUE = box('BBBB', 'B');

test('unionVoxels: two disjoint layers hold the sum of their voxels', () => {
  const a = buildVoxels(LEFT_RED);
  const b = buildVoxels(RIGHT_BLUE);
  const u = unionVoxels([a, b]);
  assert.deepEqual(u.dims, { nx: 4, ny: 4, nz: 4 });
  assert.equal(u.solidCount, a.solidCount + b.solidCount);
  assert.deepEqual(
    u.solid,
    a.solid.map((v, i) => v | b.solid[i])
  );
  assertSurfaceColored(u);
});

test('unionVoxels: an exposed face of a voxel two layers hold takes the later layer’s color', () => {
  const cube = buildVoxels(CUBE_BLUE);
  const half = buildVoxels(LEFT_RED);
  const over = unionVoxels([cube, half]);
  assert.equal(over.solidCount, 64);
  assert.equal(colorOf(over, 0, 3, 0, 'py'), pk('R'), 'both hold it: the later red');
  assert.equal(colorOf(over, 0, 1, 2, 'nx'), pk('R'));
  assert.equal(colorOf(over, 3, 3, 0, 'py'), pk('B'), 'the cube alone holds it');
  assert.equal(colorOf(over, 1, 3, 0, 'px'), undefined, 'buried in the union');
  assertSurfaceColored(over);

  const under = unionVoxels([half, cube]);
  assert.equal(colorOf(under, 0, 3, 0, 'py'), pk('B'));
});

test('unionVoxels: a blank layer adds nothing and its warnings are dropped; one layer is buildVoxels', () => {
  const a = buildVoxels(LEFT_RED);
  const faint = fill(4, 4, 'R');
  for (let i = 3; i < faint.data.length; i += 4) faint.data[i] = 100; // below the ingest threshold
  for (const blank of [buildVoxels({}), buildVoxels({ front: faint })]) {
    const u = unionVoxels([blank, a]);
    assert.deepEqual(
      [u.dims, u.solid, u.surfaceMask, u.faceColor, u.palette],
      [a.dims, a.solid, a.surfaceMask, a.faceColor, a.palette]
    );
    assert.deepEqual(u.warnings, []);
    assert.deepEqual(u.layers, [null, a]);
  }
  assert.equal(unionVoxels([a]), a);
  assert.deepEqual(buildLayeredVoxels([LEFT_RED]), buildVoxels(LEFT_RED));
  assert.deepEqual(unionVoxels([]).providedViews, [], 'no layers: one empty layer');
});

test('unionVoxels: a layer with views on one plane is a slab on the lattice face they look at', () => {
  const body = buildVoxels(LEFT_RED);
  const at = (u, x, y, z) => u.solid[voxIndex(x, y, z, u.dims)];
  const art = ['..GG', '..GG', '....', '....'];

  const front = unionVoxels([body, buildVoxels({ front: img(art) })]);
  assert.deepEqual(front.dims, { nx: 4, ny: 4, nz: 4 });
  assert.equal(front.solidCount, 32 + 4);
  assert.deepEqual([at(front, 3, 3, 3), at(front, 3, 3, 0)], [1, 0], 'front-only: z = 3');
  assert.ok(front.warnings.length > 0);
  assert.ok(front.warnings.every((w) => w.startsWith('Layer 2: ')));
  assertSurfaceColored(front);

  const back = unionVoxels([
    body,
    buildVoxels({ back: img(['GG..', 'GG..', '....', '....']) }),
  ]);
  assert.deepEqual([at(back, 3, 3, 0), at(back, 3, 3, 3)], [1, 0], 'back-only: z = 0');

  const top = unionVoxels([body, buildVoxels({ top: rows4('..GG') })]);
  assert.deepEqual([at(top, 3, 3, 1), at(top, 3, 0, 1)], [1, 0], 'top-only: y = 3');
  assertSurfaceColored(top);
});

test('unionVoxels only: a one-plane layer keeps the union’s lattice and its place in it', () => {
  const body = buildVoxels(LEFT_RED);
  const mark = buildVoxels({ front: img(['..GG', '..GG', '....', '....']) });
  const u = unionVoxels([body, mark], { only: 1 });
  const at = (x, y, z) => u.solid[voxIndex(x, y, z, u.dims)];
  assert.deepEqual(u.dims, { nx: 4, ny: 4, nz: 4 });
  assert.equal(u.solidCount, 4, 'none of the body');
  assert.deepEqual([at(2, 2, 3), at(3, 2, 3), at(2, 3, 3), at(3, 3, 3)], [1, 1, 1, 1]);
  assert.deepEqual(
    [u.palette, u.providedViews, u.warnings],
    [mark.palette, ['front'], mark.warnings.map((w) => `Layer 2: ${w}`)]
  );
  assertSurfaceColored(u);
});

test('unionVoxels only: the layer colors its own faces, including faces the union buries', () => {
  const cube = buildVoxels(CUBE_BLUE);
  const half = buildVoxels(LEFT_RED);
  const under = unionVoxels([cube, half], { only: 0 });
  assert.equal(colorOf(under, 0, 3, 0, 'py'), pk('B'), 'the union colors it red');
  assertSurfaceColored(under);

  const over = unionVoxels([cube, half], { only: 1 });
  assert.equal(colorOf(over, 1, 3, 0, 'px'), pk('R'), 'buried in the union');
  assert.deepEqual(
    [over.solid, over.surfaceMask, over.faceColor],
    [half.solid, half.surfaceMask, half.faceColor],
    'a layer observing every axis is its own result'
  );
});

test('unionVoxels only: a blank layer is its own result, and an index past the results throws', () => {
  const blank = buildVoxels({});
  const a = buildVoxels(LEFT_RED);
  const u = unionVoxels([blank, a], { only: 0 });
  assert.equal(u, blank);
  assert.deepEqual(u.providedViews, []);
  assert.throws(() => unionVoxels([blank, a], { only: 2 }), RangeError);
});
