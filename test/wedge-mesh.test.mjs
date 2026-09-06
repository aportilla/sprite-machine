// The low-poly wedge mesh (THREE is loaded here, unlike pipeline.test.mjs):
// the welded surface is watertight with and without wedges; the wedge gate is
// STRICT (riser and tread the same material, nothing else consulted) and
// robust to a ±1 canvas farble (the Helium bug: privacy browsers perturb
// getImageData, and strict RGB equality dropped wedges only there); the shared
// finish (finishVoxelMesh) centers X/Z and leaves Y exactly as authored; and
// the vertex-color linearizer maps a packed sRGB color to a [0,1] linear tuple.
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildVoxels } from '../src/lib/pipeline.js';
import { wedgeMesh } from '../src/lib/wedge-mesh.js';
import { makeVertexColorLinearizer } from '../src/lib/mesh-util.js';
import { packRGBA } from '../src/lib/ingest.js';
import { img, fill, oddEdges } from './helpers.mjs';

const wedgeCount = (views) => wedgeMesh(buildVoxels(views)).userData.wedges;
const EPS = 1e-4;

// A coherent 45° ramp: a staircase of one material -> should produce wedges.
const ramp = () => ({
  front: fill(4, 4, 'T'),
  right: img(['...T', '..TT', '.TTT', 'TTTT']),
  top: fill(4, 4, 'T'),
});

// --- watertight welding -----------------------------------------------------
// Guards the greedy base-face merge + T-junction repair: a greedy rect abutting
// a wedge's unit-scale edge would leave boundary edges without the repair.

test('wedge mesh is watertight — solid cube (no wedges)', () => {
  const mesh = wedgeMesh(
    buildVoxels(
      { front: fill(6, 6, 'T'), right: fill(6, 6, 'T'), top: fill(6, 6, 'T') },
      { mirror: { x: true, y: false, z: false } }
    )
  );
  assert.equal(mesh.userData.wedges, 0, 'a solid cube has no notches to wedge');
  assert.equal(oddEdges(mesh), 0, 'base faces must weld watertight');
});

test('wedge mesh is watertight — staircase (base faces + wedges)', () => {
  const mesh = wedgeMesh(buildVoxels(ramp()));
  assert.ok(mesh.userData.wedges > 0, 'the ramp must produce wedges');
  assert.equal(oddEdges(mesh), 0, 'base faces + wedges must weld with no boundary edges');
});

// --- the farble ---------------------------------------------------------------

// Deterministic per-pixel ±1 RGB perturbation on every opaque pixel — the exact
// shape of Helium's farble (measured: max channel delta = 1, ~25% of pixels).
function farble(views) {
  const clamp = (v) => Math.max(0, Math.min(255, v));
  for (const v of Object.values(views)) {
    if (!v) continue;
    const d = v.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const j = i / 4;
      d[i] = clamp(d[i] + ((j % 3) - 1));
      d[i + 1] = clamp(d[i + 1] + (((j + 1) % 3) - 1));
      d[i + 2] = clamp(d[i + 2] + (((j + 2) % 3) - 1));
    }
  }
  return views;
}

test('wedge gate is invariant under ±1 source RGB farble', () => {
  const base = wedgeCount(ramp());
  assert.ok(base > 0, 'a coherent ramp must produce wedges when unperturbed');
  const farbled = wedgeCount(farble(ramp()));
  assert.equal(farbled, base, 'farbled sprite must fire the SAME wedges as clean');
});

test('a real material seam still gates wedges (tolerance is not too loose)', () => {
  // Same ramp, but the facing (front) view carries a red/blue seam mid-height.
  // Distinct materials are ~180 apart, far above the ~12 tolerance, so the seam
  // must gate strictly more wedges than the all-one-material ramp.
  const seam = () => ({
    front: img(['RRRR', 'RRRR', 'BBBB', 'BBBB']),
    right: img(['...T', '..TT', '.TTT', 'TTTT']),
    top: fill(4, 4, 'T'),
  });
  assert.ok(
    wedgeCount(seam()) < wedgeCount(ramp()),
    'a real seam must yield fewer wedges than a coherent ramp'
  );
});

// --- the strict gate ------------------------------------------------------------
// A wedge fires iff the two faces it covers — the riser and the tread — are the
// same material. It consults nothing else (no profile/facing view, no
// elevation). These two staircases prove both directions of that contract,
// which hands the sprite author exact control over which corners round.

// (1) All step faces one material (white), with a stray pink band elsewhere in
// the FRONT elevation. Every step's riser AND tread are white, so all 9 notch
// cells wedge regardless of where the band sits — the projection is irrelevant
// because only the covered faces are read. (An earlier heuristic that sampled the
// facing-view elevation dropped a step at each band edge: white-cap 6/9, band 3/9.)
const WP = { '#': [255, 255, 255], O: [233, 23, 241] }; // white body + pink band
const stair = (frontRows, topRows) => ({
  // Side profile in LEFT (its projection matches the z-order the topRows below
  // were authored against); all-white step profile.
  left: img(['   ###', '  ####', ' #####', '######'], WP),
  front: img(frontRows, WP),
  top: img(topRows, WP),
});

test('monochrome staircase wedges every step regardless of an elevation colour band', () => {
  const whiteCap = stair(
    ['###', 'OOO', 'OOO', 'OOO'],
    ['OOO', 'OOO', '###', '###', '###', '###']
  );
  const pinkBand = stair(
    ['###', '###', 'OOO', '###'],
    ['OOO', '###', '###', '###', '###', '###']
  );
  assert.equal(
    wedgeCount(whiteCap),
    9,
    'white-cap staircase must wedge every step (3 steps x 3 wide)'
  );
  assert.equal(
    wedgeCount(pinkBand),
    9,
    'pink-band staircase must wedge every step (3 steps x 3 wide)'
  );
});

test('strict gate: a corner whose riser and tread differ never wedges (author control)', () => {
  // (2) A geometrically perfect ramp, but the TOP view paints the treads a
  // different colour than the FRONT view paints the risers. The artist has said
  // "these two faces are different materials", so every corner stays a crisp step
  // — zero wedges — even though the identical geometry in one colour wedges freely.
  const twoColour = () => ({
    front: fill(4, 4, 'T'), // risers -> teal
    right: img(['...T', '..TT', '.TTT', 'TTTT']),
    top: fill(4, 4, 'R'), // treads -> red  =>  riser != tread at every step
  });
  assert.ok(wedgeCount(ramp()) > 0, 'the one-colour ramp must wedge');
  assert.equal(
    wedgeCount(twoColour()),
    0,
    'riser!=tread must never wedge, even on a perfect ramp'
  );
});

// --- the shared finish: X/Z centered, Y as authored ------------------------------
// finishVoxelMesh (mesh-util.js) translates X and Z to center the grid and Y by
// a hard 0 — where the object sits vertically is wherever the artist painted it.

test('the mesh centers on X and Z (bbox center ~0)', () => {
  // A 4x4x4 cube at worldSize 2.5 spans [-1.25, 1.25] on the centered axes.
  const cube = wedgeMesh(
    buildVoxels(
      { front: fill(4, 4, 'T'), right: fill(4, 4, 'T'), top: fill(4, 4, 'T') },
      { mirror: { x: true, y: false, z: false } }
    )
  );
  const bb = cube.geometry.boundingBox; // computed by finishVoxelMesh
  assert.ok(Math.abs((bb.min.x + bb.max.x) / 2) < EPS, 'X center must be ~0');
  assert.ok(Math.abs((bb.min.z + bb.max.z) / 2) < EPS, 'Z center must be ~0');
  assert.ok(Math.abs(bb.min.x - -1.25) < EPS);
  assert.ok(Math.abs(bb.max.x - 1.25) < EPS);
  // A cube cannot tell nx from nz; a 3x1x2 box holds the center on both axes.
  const box = buildVoxels(
    { front: fill(3, 1, 'T'), right: fill(2, 1, 'T'), top: fill(3, 2, 'T') },
    { mirror: { x: true, y: true, z: true } }
  );
  assert.deepEqual(box.dims, { nx: 3, ny: 1, nz: 2 });
  const bbox = wedgeMesh(box).geometry.boundingBox;
  assert.ok(Math.abs((bbox.min.x + bbox.max.x) / 2) < EPS, 'X center ~0 even at nx=3');
  assert.ok(Math.abs((bbox.min.z + bbox.max.z) / 2) < EPS, 'Z center ~0 even at nz=2');
});

test('the mesh leaves Y as authored — a floating object does not rest on y=0', () => {
  // Paint only the TOP image row so the solid sits high in the tile and floats.
  const mesh = wedgeMesh(
    buildVoxels(
      {
        front: img(['MM', '..', '..']), // content only in the top row
        right: fill(1, 3, 'N'), // full-height side so Y agrees (3 tall)
      },
      { mirror: { x: false, y: false, z: false } }
    )
  );
  const bb = mesh.geometry.boundingBox;
  // The object occupies world y=2 in a 3-tall grid (s = 2.5/3): its base sits
  // at 2s = 5/3, well above the ground plane, and its top at the full 2.5.
  assert.ok(bb.min.y > 1.5, `floating base must stay above y=0 (got ${bb.min.y})`);
  assert.ok(Math.abs(bb.min.y - 5 / 3) < EPS, 'base sits at world y = 2 * (2.5/3)');
  assert.ok(Math.abs(bb.max.y - 2.5) < EPS, 'top reaches the full world height');
});

// --- the vertex-color linearizer ----------------------------------------------------

test('makeVertexColorLinearizer returns a [0,1] linear tuple for a packed color', () => {
  const lin = makeVertexColorLinearizer();
  const c = lin(packRGBA(220, 60, 60, 255));
  assert.equal(c.length, 3);
  for (const v of c) {
    assert.equal(typeof v, 'number');
    assert.ok(v >= 0 && v <= 1, `channel ${v} must be in [0,1]`);
  }
  // sRGB->linear is monotonic: the bright red channel outranks the dim ones,
  // and the two equal input channels linearize to the same value.
  assert.ok(c[0] > c[1]);
  assert.equal(c[1], c[2]);
  // Endpoints map exactly.
  assert.deepEqual(lin(packRGBA(255, 255, 255, 255)), [1, 1, 1]);
  assert.deepEqual(lin(packRGBA(0, 0, 0, 255)), [0, 0, 0]);
});
