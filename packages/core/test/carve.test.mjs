// Node-runnable unit tests for carve.js internals — the index packing, surface
// extraction, dimension reconciliation and view placement — that the pipeline
// tests only exercise transitively. Pure: no THREE/DOM.
// Run: node --test test/carve.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { voxIndex, unvoxIndex, reconcileDims, extractSurface } from '../src/carve.js';
import { placeView } from '../src/ingest.js';

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

// --- 2. extractSurface: a 2x2x2 solid is all corners; a 3x3x3 hides its center
test('extractSurface: a 2x2x2 solid exposes 3 faces per corner; a 3x3x3 solid’s center is interior and not counted', () => {
  const d2 = { nx: 2, ny: 2, nz: 2 };
  const two = extractSurface(new Uint8Array(8).fill(1), d2);
  assert.equal(two.solidCount, 8); // all solid
  assert.equal(two.count, 8); // and all on the surface (no interior in a 2-cube)
  for (let z = 0; z < 2; z++)
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 2; x++) {
        const m = two.surfaceMask[voxIndex(x, y, z, d2)];
        assert.equal(popcount(m), 3, `corner (${x},${y},${z}) exposes 3 faces`);
      }
  // The origin corner (0,0,0) is exposed on its three negative faces: -x,-y,-z.
  // (Its +x,+y,+z neighbors are the other solid voxels, so those bits are 0.)
  assert.equal(two.surfaceMask[voxIndex(0, 0, 0, d2)], maskOf('nx', 'ny', 'nz'));
  // The far corner (1,1,1) is exposed on its three positive faces: +x,+y,+z.
  assert.equal(two.surfaceMask[voxIndex(1, 1, 1, d2)], maskOf('px', 'py', 'pz'));

  const d3 = { nx: 3, ny: 3, nz: 3 };
  const three = extractSurface(new Uint8Array(27).fill(1), d3);
  assert.equal(three.solidCount, 27); // every cell solid
  assert.equal(three.surfaceMask[voxIndex(1, 1, 1, d3)], 0); // all 6 neighbors solid
  // 26 shell voxels are surface; the one interior center is excluded from count.
  assert.equal(three.count, 26);
});

// --- 3. reconcileDims: an unconstrained axis defaults to 1 and warns --------
test('reconcileDims: an axis no view observes defaults to 1 with a warning', () => {
  // FRONT observes X (width) and Y (height) only — nothing constrains Z.
  const { dims, warnings } = reconcileDims({ front: { w: 3, h: 4 } });
  assert.deepEqual(dims, { nx: 3, ny: 4, nz: 1 });
  assert.ok(warnings.length > 0, 'a warning is raised for the unconstrained axis');
});

// --- 4. placeView: pad or clip a source into a target, never resample -------
// Strict registration keeps the source at native scale; placeView only pads
// (positive offset) or clips (negative offset).
test('placeView pads a smaller source at a positive offset and clips one pushed off-grid by a negative offset', () => {
  // A distinct rgb per source texel so we can see exactly where each lands.
  const view = {
    w: 2,
    h: 2,
    occ: new Uint8Array([1, 1, 1, 1]),
    rgb: new Uint32Array([11, 12, 13, 14]),
  };
  const filledOf = (occ) => {
    let filled = 0;
    for (let i = 0; i < occ.length; i++) if (occ[i]) filled++;
    return filled;
  };

  const pad = placeView(view, 4, 4, 1, 1); // 2x2 into 4x4 at (1,1)
  assert.equal(pad.occ.length, 16);
  // Source (sx,sy) lands at target (sx+1, sy+1) => di = (sy+1)*4 + (sx+1).
  const at = (sx, sy) => (sy + 1) * 4 + (sx + 1);
  assert.equal(pad.occ[at(0, 0)], 1);
  assert.equal(pad.rgb[at(0, 0)], 11);
  assert.equal(pad.rgb[at(1, 0)], 12);
  assert.equal(pad.rgb[at(0, 1)], 13);
  assert.equal(pad.rgb[at(1, 1)], 14);
  // Everything outside the 2x2 block stays empty padding.
  assert.equal(filledOf(pad.occ), 4);

  // Offset (-1,-1): only source (1,1) lands in-grid, at target (0,0). The three
  // texels whose target coord goes negative are clipped away by the bounds guard.
  const clip = placeView(view, 3, 3, -1, -1);
  assert.equal(clip.occ.length, 9);
  assert.equal(clip.occ[0], 1); // target (0,0) = source (1,1)
  assert.equal(clip.rgb[0], 14);
  assert.equal(filledOf(clip.occ), 1); // the other three source texels were clipped
});
