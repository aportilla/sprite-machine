import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildVoxels } from '../src/pipeline.js';
import { wedgeMesh } from '../src/wedge-mesh.js';
import { img, fill, oddEdges } from './helpers.mjs';

const wedgeCount = (views) => wedgeMesh(buildVoxels(views)).userData.wedges;
const EPS = 1e-4;

// A 45° ramp of one material.
const ramp = () => ({
  front: fill(4, 4, 'T'),
  right: img(['...T', '..TT', '.TTT', 'TTTT']),
  top: fill(4, 4, 'T'),
});

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

test('a slope is one quad: a ramp costs the same triangles 1 wide and 4 wide; a ridge colour seam still welds', () => {
  const tris = (m) => m.userData.triangles;
  const wide = wedgeMesh(buildVoxels(ramp()));
  const narrow = wedgeMesh(
    buildVoxels({
      front: fill(1, 4, 'T'),
      right: img(['...T', '..TT', '.TTT', 'TTTT']),
      top: fill(1, 4, 'T'),
    })
  );
  assert.equal(wide.userData.wedges, 4 * narrow.userData.wedges, 'four times the cells');
  assert.equal(wide.userData.slopes, 1, 'the three steps are one block');
  assert.equal(narrow.userData.slopes, 1);
  assert.equal(
    tris(wide),
    tris(narrow),
    'the same triangles: the cells merged into one slope'
  );
  // Floor, back, toe riser, top tread and slope are quads. The two sides are
  // pentagons with the diagonal as one edge.
  assert.equal(tris(wide), 2 + 2 + 2 + 2 + 2 + 3 + 3);
  assert.equal(oddEdges(wide), 0);

  const seam = wedgeMesh(
    buildVoxels({
      front: img(['TTRR', 'TTRR', 'TTRR', 'TTRR']),
      right: img(['...T', '..TT', '.TTT', 'TTTT']),
      top: img(['TTRR', 'TTRR', 'TTRR', 'TTRR']),
    })
  );
  assert.equal(seam.userData.wedges, wide.userData.wedges, 'every cell still wedges');
  assert.equal(seam.userData.slopes, 2, 'the seam halves the block');
  assert.equal(oddEdges(seam), 0, 'two colours of slope abut with no boundary edges');
});

test('a self-touching boundary triangulates whole and welds: a bay open at a corner, two holes meeting at one', () => {
  // A one-deep slab. The corner notch's riser (N) and tread (T) differ, so no
  // wedge fills it.
  const bay = wedgeMesh(
    buildVoxels({
      front: img(['MMM', 'M.M', '.MM']),
      right: fill(1, 3, 'N'),
      top: fill(3, 1, 'T'),
    })
  );
  assert.equal(
    bay.userData.wedges,
    0,
    'the corner notch must stay a step for the pinch to exist'
  );
  assert.equal(oddEdges(bay), 0);
  const holes = wedgeMesh(
    buildVoxels({
      front: img(['MMMM', 'M.MM', 'MM.M', 'MMMM']),
      right: fill(1, 4, 'N'),
      top: fill(4, 1, 'T'),
    })
  );
  assert.equal(holes.userData.wedges, 0);
  assert.equal(oddEdges(holes), 0);
});

// A deterministic ±1 RGB perturbation of opaque pixels, like the canvas
// farbling privacy browsers such as Helium apply to getImageData.
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
  // The ramp with a red/blue seam on the front view. The two colors are ~180
  // apart, far above the ~12 tolerance.
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

// A wedge fires iff the riser and tread it covers are the same material. The gate
// reads nothing else.

// Every riser and tread is white. A pink band elsewhere on the front does not
// change the count.
const WP = { '#': [255, 255, 255], O: [233, 23, 241] }; // white body + pink band
const stair = (frontRows, topRows) => ({
  // The profile is the left view, whose projection matches the z order of topRows.
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
  // The ramp's geometry with treads and risers in different colors.
  const twoColour = () => ({
    front: fill(4, 4, 'T'), // risers -> teal
    right: img(['...T', '..TT', '.TTT', 'TTTT']),
    top: fill(4, 4, 'R'), // treads -> red
  });
  assert.ok(wedgeCount(ramp()) > 0, 'the one-colour ramp must wedge');
  assert.equal(
    wedgeCount(twoColour()),
    0,
    'riser!=tread must never wedge, even on a perfect ramp'
  );
});

// finishVoxelMesh (mesh-util.js) centers X and Z and leaves Y as authored.

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
  // A cube can't tell nx from nz, so check a 3x1x2 box too.
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
  const mesh = wedgeMesh(
    buildVoxels(
      {
        front: img(['MM', '..', '..']), // content only in the top row
        right: fill(1, 3, 'N'), // full height, so Y agrees
      },
      { mirror: { x: false, y: false, z: false } }
    )
  );
  const bb = mesh.geometry.boundingBox;
  // The solid is at grid y=2 of 3 with s = 2.5/3. Base at 2s = 5/3, top at 2.5.
  assert.ok(bb.min.y > 1.5, `floating base must stay above y=0 (got ${bb.min.y})`);
  assert.ok(Math.abs(bb.min.y - 5 / 3) < EPS, 'base sits at world y = 2 * (2.5/3)');
  assert.ok(Math.abs(bb.max.y - 2.5) < EPS, 'top reaches the full world height');
});

// Color comes from the skin texture (skin.js).

test('the mesh carries its skin: uvs in [0,1]; one material samples one texel, a two-color wall a chart', () => {
  // Each triangle's three uv pairs from the indexed geometry.
  const triUVs = (geo) => {
    const uv = geo.attributes.uv;
    const idx = geo.index.array;
    const out = [];
    for (let t = 0; t < idx.length; t += 3)
      out.push([0, 1, 2].map((k) => [uv.getX(idx[t + k]), uv.getY(idx[t + k])]));
    return out;
  };
  const oneTexel = (tri) => tri.every(([u, v]) => u === tri[0][0] && v === tri[0][1]);

  // The ramp is one material, so every triangle samples one texel.
  const mesh = wedgeMesh(buildVoxels(ramp()));
  const geo = mesh.geometry;
  assert.equal(geo.attributes.uv.count, geo.attributes.position.count, 'a uv per vertex');
  for (const v of geo.attributes.uv.array)
    assert.ok(v >= 0 && v <= 1, `uv ${v} outside [0,1]`);
  assert.ok(triUVs(geo).every(oneTexel), 'a one-material triangle samples one texel');
  assert.ok(mesh.material.map, 'the material samples the skin');
  assert.deepEqual(
    [mesh.material.map.image.width, mesh.material.map.image.height],
    [mesh.userData.skin.width, mesh.userData.skin.height]
  );

  // A two-color wall merges to one charted +z rect.
  const wall = wedgeMesh(
    buildVoxels({
      front: img(['RRRR', 'RRRR', 'BBBB', 'BBBB']),
      right: fill(4, 4, 'T'),
      top: fill(4, 4, 'T'),
    })
  );
  assert.ok(wall.userData.skin.charts > 0, 'the wall charts at least one rect');
  assert.ok(
    triUVs(wall.geometry).some((t) => !oneTexel(t)),
    'a charted triangle spans texels'
  );
  assert.equal(oddEdges(wall), 0, 'a chart seam splits vertices, never the surface');
});
