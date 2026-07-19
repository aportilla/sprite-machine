// Node-runnable unit tests for carve.js internals — the index packing, surface
// extraction, dimension reconciliation, view placement, and the per-plane union
// carve — that the pipeline tests only exercise transitively. Pure: no THREE/DOM.
// Run: node --test test/carve.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  voxIndex,
  unvoxIndex,
  reconcileDims,
  carve,
  extractSurface,
} from '../src/lib/carve.js';
import { placeView } from '../src/lib/ingest.js';
import { VIEWS, VIEW_NAMES } from '../src/lib/views.js';

// FACE_KEYS order (px nx py pz-order) drives the 6-bit surface mask: bit i is set
// when FACE_KEYS[i]'s outward neighbor is empty/out-of-bounds. px=0 nx=1 py=2
// ny=3 pz=4 nz=5.
const BIT = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 };
const maskOf = (...faces) => faces.reduce((m, f) => m | (1 << BIT[f]), 0);
const popcount = (m) => {
  let n = 0;
  while (m) (n += m & 1), (m >>= 1);
  return n;
};

// --- 1. index round-trip over NON-cubic dims -------------------------------
// unvoxIndex must invert voxIndex for every idx and never step out of bounds —
// they live side-by-side precisely so the packing can't drift.
test('voxIndex/unvoxIndex round-trip over non-cubic dims, always in bounds', () => {
  const d = { nx: 3, ny: 4, nz: 5 };
  const n = d.nx * d.ny * d.nz; // 60
  for (let idx = 0; idx < n; idx++) {
    const { x, y, z } = unvoxIndex(idx, d);
    assert.ok(x >= 0 && x < d.nx, `x in bounds at idx ${idx}`);
    assert.ok(y >= 0 && y < d.ny, `y in bounds at idx ${idx}`);
    assert.ok(z >= 0 && z < d.nz, `z in bounds at idx ${idx}`);
    assert.equal(voxIndex(x, y, z, d), idx, `round-trip at idx ${idx}`);
  }
  // Spot-check the packing directly: idx = x + nx*(y + ny*z).
  assert.deepEqual(unvoxIndex(0, d), { x: 0, y: 0, z: 0 });
  assert.deepEqual(unvoxIndex(1, d), { x: 1, y: 0, z: 0 }); // +1 in x
  assert.deepEqual(unvoxIndex(3, d), { x: 0, y: 1, z: 0 }); // +nx in y
  assert.deepEqual(unvoxIndex(12, d), { x: 0, y: 0, z: 1 }); // +nx*ny in z
  assert.deepEqual(unvoxIndex(n - 1, d), { x: 2, y: 3, z: 4 }); // last cell
});

// --- 2. extractSurface: 2x2x2 all-solid -> every voxel is a 3-face corner ---
test('extractSurface on a 2x2x2 solid: 8 corners, each exposes exactly 3 faces', () => {
  const d = { nx: 2, ny: 2, nz: 2 };
  const solid = new Uint8Array(8).fill(1);
  const { surfaceMask, count, solidCount } = extractSurface(solid, d);
  assert.equal(solidCount, 8); // all solid
  assert.equal(count, 8); // and all on the surface (no interior in a 2-cube)
  for (let z = 0; z < 2; z++)
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 2; x++) {
        const m = surfaceMask[voxIndex(x, y, z, d)];
        assert.equal(popcount(m), 3, `corner (${x},${y},${z}) exposes 3 faces`);
      }
  // The origin corner (0,0,0) is exposed on its three negative faces: -x,-y,-z.
  // (Its +x,+y,+z neighbors are the other solid voxels, so those bits are 0.)
  assert.equal(surfaceMask[voxIndex(0, 0, 0, d)], maskOf('nx', 'ny', 'nz'));
  assert.equal(surfaceMask[voxIndex(0, 0, 0, d)], 42); // = bits 1|3|5
  // The far corner (1,1,1) is exposed on its three positive faces: +x,+y,+z.
  assert.equal(surfaceMask[voxIndex(1, 1, 1, d)], maskOf('px', 'py', 'pz'));
  assert.equal(surfaceMask[voxIndex(1, 1, 1, d)], 21); // = bits 0|2|4
});

// --- 3. extractSurface: 3x3x3 solid -> the center voxel is fully interior ---
test('extractSurface on a 3x3x3 solid: center (1,1,1) has mask 0 and is not counted', () => {
  const d = { nx: 3, ny: 3, nz: 3 };
  const solid = new Uint8Array(27).fill(1);
  const { surfaceMask, count, solidCount } = extractSurface(solid, d);
  assert.equal(solidCount, 27); // every cell solid
  assert.equal(surfaceMask[voxIndex(1, 1, 1, d)], 0); // all 6 neighbors solid
  // 26 shell voxels are surface; the one interior center is excluded from count.
  assert.equal(count, 26);
});

// --- 4. reconcileDims: an unconstrained axis defaults to 1 and warns --------
test('reconcileDims: an axis no view observes defaults to 1 with an "unconstrained" warning', () => {
  // FRONT observes X (width) and Y (height) only — nothing constrains Z.
  const { dims, warnings } = reconcileDims({ front: { w: 3, h: 4 } });
  assert.deepEqual(dims, { nx: 3, ny: 4, nz: 1 });
  assert.ok(
    warnings.some((w) => /unconstrained/i.test(w)),
    'a warning names the unconstrained axis'
  );
});

// --- 5. placeView: pad+clip a smaller source into a larger target ----------
// Strict registration keeps the source at native scale; placeView only pads
// (positive offset) or clips (negative offset) — it never resamples.
test('placeView pads a smaller source at a positive, non-zero offset', () => {
  // A distinct rgb per source texel so we can see exactly where each lands.
  const view = {
    w: 2,
    h: 2,
    occ: new Uint8Array([1, 1, 1, 1]),
    rgb: new Uint32Array([11, 12, 13, 14]),
  };
  const { occ, rgb } = placeView(view, 4, 4, 1, 1); // 2x2 into 4x4 at (1,1)
  assert.equal(occ.length, 16);
  // Source (sx,sy) lands at target (sx+1, sy+1) => di = (sy+1)*4 + (sx+1).
  const at = (sx, sy) => (sy + 1) * 4 + (sx + 1);
  assert.equal(occ[at(0, 0)], 1);
  assert.equal(rgb[at(0, 0)], 11);
  assert.equal(rgb[at(1, 0)], 12);
  assert.equal(rgb[at(0, 1)], 13);
  assert.equal(rgb[at(1, 1)], 14);
  // Everything outside the 2x2 block stays empty padding.
  let filled = 0;
  for (let i = 0; i < occ.length; i++) if (occ[i]) filled++;
  assert.equal(filled, 4);
});

test('placeView clips a source pushed off-grid by a negative offset', () => {
  const view = {
    w: 2,
    h: 2,
    occ: new Uint8Array([1, 1, 1, 1]),
    rgb: new Uint32Array([11, 12, 13, 14]),
  };
  // Offset (-1,-1): only source (1,1) lands in-grid, at target (0,0). The three
  // texels whose target coord goes negative are clipped away by the bounds guard.
  const { occ, rgb } = placeView(view, 3, 3, -1, -1);
  assert.equal(occ.length, 9);
  assert.equal(occ[0], 1); // target (0,0) = source (1,1)
  assert.equal(rgb[0], 14);
  let filled = 0;
  for (let i = 0; i < occ.length; i++) if (occ[i]) filled++;
  assert.equal(filled, 1); // the other three source texels were clipped
});

// --- 6. carve: opposite views on ONE plane are UNIONed, not intersected ----
// TOP and BOTTOM both constrain the X-Z plane. Here each covers a texel the
// other does not; a voxel is solid if EITHER sees it (the union that keeps a
// 1-texel registration slip between hand-drawn opposite sprites from eroding a
// protrusion). FRONT and RIGHT are fully solid so only the X-Z plane carves.
test('carve UNIONs the two views on one plane (either-covers keeps a voxel)', () => {
  const d = { nx: 2, ny: 1, nz: 2 };
  const solidPlane = (w) => ({
    occ: new Uint8Array(w).fill(1),
    rgb: new Uint32Array(w),
    imgW: w / 1, // ny is 1, so imgW == the plane's full length
  });
  // TOP/BOTTOM images are nx wide (2) by nz tall (2). TOP covers only image cell
  // (u=0,v=0); BOTTOM covers only (u=1,v=1) — deliberately disjoint texels.
  const topOcc = new Uint8Array(4);
  topOcc[0 * 2 + 0] = 1; // v=0,u=0
  const botOcc = new Uint8Array(4);
  botOcc[1 * 2 + 1] = 1; // v=1,u=1
  const gviews = {
    front: solidPlane(d.nx * d.ny), // constrains X-Y fully
    right: solidPlane(d.nz * d.ny), // constrains Z-Y fully
    top: { occ: topOcc, rgb: new Uint32Array(4), imgW: 2 },
    bottom: { occ: botOcc, rgb: new Uint32Array(4), imgW: 2 },
  };
  const solid = carve(gviews, d);

  // Confirm the projections behind the union (drives which voxel each cell hits):
  //   TOP's (u=0,v=0) is voxel (0,0,1); BOTTOM's (u=1,v=1) is voxel (0,0,0).
  assert.deepEqual(VIEWS.top.project(0, 0, 1, d), { u: 0, v: 0 });
  assert.deepEqual(VIEWS.bottom.project(0, 0, 0, d), { u: 1, v: 1 });

  // Voxel seen ONLY by TOP survives; voxel seen ONLY by BOTTOM survives.
  assert.equal(solid[voxIndex(0, 0, 1, d)], 1, 'kept by TOP alone');
  assert.equal(solid[voxIndex(0, 0, 0, d)], 1, 'kept by BOTTOM alone');
  // Voxels neither view covers on the X-Z plane are carved away.
  assert.equal(solid[voxIndex(1, 0, 0, d)], 0, 'covered by neither');
  assert.equal(solid[voxIndex(1, 0, 1, d)], 0, 'covered by neither');
  assert.deepEqual(Array.from(solid), [1, 0, 1, 0]);
});

// --- 7. projectInto === project for ALL six views (shared-scratch drift guard)
// project() delegates to projectInto() into a reused scratch object; a bug in
// the shared-buffer refactor could make them disagree. Cross-check every view
// over a spread of voxels and non-cubic dims.
test('projectInto agrees with project for every view over several voxels/dims', () => {
  const dimsList = [
    { nx: 2, ny: 2, nz: 2 },
    { nx: 3, ny: 4, nz: 5 },
    { nx: 5, ny: 1, nz: 3 },
  ];
  for (const name of VIEW_NAMES) {
    const spec = VIEWS[name];
    for (const d of dimsList) {
      for (let z = 0; z < d.nz; z++)
        for (let y = 0; y < d.ny; y++)
          for (let x = 0; x < d.nx; x++) {
            const viaProject = spec.project(x, y, z, d);
            const out = { u: -1, v: -1 };
            const ret = spec.projectInto(x, y, z, d, out);
            assert.equal(ret, out, `${name}: projectInto returns its out arg`);
            assert.deepEqual(
              { u: out.u, v: out.v },
              viaProject,
              `${name} @ (${x},${y},${z}) in ${d.nx}x${d.ny}x${d.nz}`
            );
          }
    }
  }
});
