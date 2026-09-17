import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildVoxels, unionVoxels } from '../src/pipeline.js';
import { wedgeMesh } from '../src/wedge-mesh.js';
import { img, fill, oddEdges } from './helpers.mjs';

const wedgeCount = (views) => wedgeMesh(buildVoxels(views)).wedges;
const EPS = 1e-4;

// A 45° ramp of one material.
const ramp = () => ({
  front: fill(4, 4, 'T'),
  right: img(['...T', '..TT', '.TTT', 'TTTT']),
  top: fill(4, 4, 'T'),
});

test('wedge mesh is watertight — solid cube (no wedges)', () => {
  const built = wedgeMesh(
    buildVoxels(
      { front: fill(6, 6, 'T'), right: fill(6, 6, 'T'), top: fill(6, 6, 'T') },
      { mirror: { x: true, y: false, z: false } }
    )
  );
  assert.equal(built.wedges, 0, 'a solid cube has no notches to wedge');
  assert.equal(oddEdges(built.geometry), 0, 'base faces must weld watertight');
});

test('wedge mesh is watertight — staircase (base faces + wedges)', () => {
  const built = wedgeMesh(buildVoxels(ramp()));
  assert.ok(built.wedges > 0, 'the ramp must produce wedges');
  assert.equal(
    oddEdges(built.geometry),
    0,
    'base faces + wedges must weld with no boundary edges'
  );
});

test('a slope is one quad: a ramp costs the same triangles 1 wide and 4 wide; a ridge colour seam still welds', () => {
  const tris = (m) => m.triangles;
  const wide = wedgeMesh(buildVoxels(ramp()));
  const narrow = wedgeMesh(
    buildVoxels({
      front: fill(1, 4, 'T'),
      right: img(['...T', '..TT', '.TTT', 'TTTT']),
      top: fill(1, 4, 'T'),
    })
  );
  assert.equal(wide.wedges, 4 * narrow.wedges, 'four times the cells');
  assert.equal(wide.slopes, 1, 'the three steps are one block');
  assert.equal(narrow.slopes, 1);
  assert.equal(
    tris(wide),
    tris(narrow),
    'the same triangles: the cells merged into one slope'
  );
  // Floor, back, toe riser, top tread and slope are quads. The two sides are
  // pentagons with the diagonal as one edge.
  assert.equal(tris(wide), 2 + 2 + 2 + 2 + 2 + 3 + 3);
  assert.equal(oddEdges(wide.geometry), 0);

  const seam = wedgeMesh(
    buildVoxels({
      front: img(['TTRR', 'TTRR', 'TTRR', 'TTRR']),
      right: img(['...T', '..TT', '.TTT', 'TTTT']),
      top: img(['RRTT', 'RRTT', 'RRTT', 'RRTT']),
    })
  );
  assert.equal(seam.wedges, wide.wedges, 'every cell still wedges');
  assert.equal(seam.slopes, 2, 'the seam halves the block');
  assert.equal(
    oddEdges(seam.geometry),
    0,
    'two colours of slope abut with no boundary edges'
  );
});

test("a wedge run whose ends meet another layer's solid welds watertight", () => {
  // A staircase along z between a front-only and a back-only slab layer.
  const stairs = buildVoxels({
    front: img(['...T', '..TT', '.TTT', 'TTTT']),
    right: fill(4, 4, 'T'),
    top: fill(4, 4, 'T'),
  });
  const front = buildVoxels({ front: fill(4, 4, 'T') });
  const back = buildVoxels({ back: fill(4, 4, 'R') });
  const one = wedgeMesh(unionVoxels([stairs, front]));
  assert.equal(one.wedges, 9, 'the slab fills the front row of notches');
  assert.equal(oddEdges(one.geometry), 0);
  const both = wedgeMesh(unionVoxels([stairs, front, back]));
  assert.equal(both.wedges, 6, 'the slabs fill the front and back rows');
  assert.equal(oddEdges(both.geometry), 0);
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
  assert.equal(bay.wedges, 0, 'the corner notch must stay a step for the pinch to exist');
  assert.equal(oddEdges(bay.geometry), 0);
  const holes = wedgeMesh(
    buildVoxels({
      front: img(['MMMM', 'M.MM', 'MM.M', 'MMMM']),
      right: fill(1, 4, 'N'),
      top: fill(4, 1, 'T'),
    })
  );
  assert.equal(holes.wedges, 0);
  assert.equal(oddEdges(holes.geometry), 0);
});

// A shallow 1:2 staircase, two-cell treads on one-cell risers, 4 deep.
const shallow = (top = fill(6, 4, 'T')) => ({
  front: img(['....TT', '..TTTT', 'TTTTTT']),
  right: fill(4, 3, 'T'),
  top,
});

test('a 1:2 staircase is one slope, shallow, steep or in plan, and costs the same triangles 1 wide and 4 wide', () => {
  const cases = {
    shallow: shallow(),
    steep: {
      right: img(['..T', '..T', '.TT', '.TT', 'TTT', 'TTT']),
      front: fill(4, 6, 'T'),
      top: fill(4, 3, 'T'),
    },
    plan: {
      top: img(['....TT', '..TTTT', 'TTTTTT']),
      front: fill(6, 4, 'T'),
      right: fill(3, 4, 'T'),
    },
  };
  for (const [name, views] of Object.entries(cases)) {
    const built = wedgeMesh(buildVoxels(views));
    assert.equal(built.wedges, 2 * 2 * 4, `${name}: two 1:2 steps of two cells, 4 deep`);
    assert.equal(built.slopes, 1, name);
    assert.equal(oddEdges(built.geometry), 0, name);
  }
  const wide = wedgeMesh(buildVoxels(shallow()));
  const narrow = wedgeMesh(
    buildVoxels({
      front: img(['....TT', '..TTTT', 'TTTTTT']),
      right: fill(1, 3, 'T'),
      top: fill(6, 1, 'T'),
    })
  );
  assert.equal(wide.wedges, 4 * narrow.wedges);
  assert.equal(wide.triangles, narrow.triangles);
});

test('a 1:2 end step fires beside a strict step and not alone; a lone ledge on a floor stays 1:1', () => {
  const cells = (rows) =>
    wedgeCount({
      front: img(rows),
      right: fill(1, rows.length, 'T'),
      top: fill(rows[0].length, 1, 'T'),
    });
  assert.equal(
    cells(['...T', '...T', '..TT', '..TT', 'TTTT', 'TTTT']),
    4,
    'a steep step, and its foot on a floor that runs on'
  );
  assert.equal(cells(['..T', '..T', 'TTT', 'TTT']), 1, 'the foot alone');
  assert.equal(cells(['...TTT', 'TTTTTT']), 1, 'a one-high ledge on a floor');
  assert.equal(cells(['..TTTT', 'TTTTTT']), 2, 'a ledge on a floor two cells long');
});

test('a 1:2 over a second cell of another colour is a 1:1, and a 1:1 run beside a 1:2 run along the ridge welds', () => {
  // The top view's column 3 is x = 2, the tread under the upper step's p.
  const red = (rows) => img([...rows, ...Array(4 - rows.length).fill('TTTTTT')]);
  assert.equal(wedgeCount(shallow()), 4 * (2 + 2));
  assert.equal(
    wedgeCount(shallow(red(['TTTRTT', 'TTTRTT', 'TTTRTT', 'TTTRTT']))),
    4 * (1 + 2),
    'the upper step is a 1:1 on every row'
  );
  const beside = wedgeMesh(buildVoxels(shallow(red(['TTTRTT', 'TTTRTT']))));
  assert.equal(beside.wedges, 2 * (1 + 2) + 2 * (2 + 2));
  assert.equal(oddEdges(beside.geometry), 0);
});

test('a 1:2 whose two cells differ at a ridge end is a 1:1', () => {
  // A one-voxel layer on the front plane closes the upper step's notch cell
  // but not the cell beside it.
  const dot = buildVoxels({ front: img(['...T..', '......', '......']) });
  const built = wedgeMesh(unionVoxels([buildVoxels(shallow()), dot]));
  // Rows 0 and 1 keep both 1:2s. Row 2's upper step and the notch beside the
  // dot on row 3 are 1:1s.
  assert.equal(built.wedges, 2 * (2 + 2) + 2 * (1 + 2));
  assert.equal(oddEdges(built.geometry), 0);
});

test('a curve of 1:2 and 1:1 steps welds watertight', () => {
  const curve = wedgeMesh(
    buildVoxels({
      front: img(['.....T', '...TTT', '..TTTT', 'TTTTTT']),
      right: fill(4, 4, 'T'),
      top: fill(6, 4, 'T'),
    })
  );
  assert.equal(curve.wedges, 4 * (2 + 1 + 2), 'a 1:2, a 1:1 and a 1:2 step');
  assert.equal(oddEdges(curve.geometry), 0);
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

// The mesher centers X and Z and leaves Y as authored.

test('the mesh centers on X and Z (bbox center ~0)', () => {
  // A 4x4x4 cube at worldSize 2.5 spans [-1.25, 1.25] on the centered axes.
  const cube = wedgeMesh(
    buildVoxels(
      { front: fill(4, 4, 'T'), right: fill(4, 4, 'T'), top: fill(4, 4, 'T') },
      { mirror: { x: true, y: false, z: false } }
    )
  );
  const bb = cube.geometry.bounds;
  assert.ok(Math.abs((bb.min[0] + bb.max[0]) / 2) < EPS, 'X center must be ~0');
  assert.ok(Math.abs((bb.min[2] + bb.max[2]) / 2) < EPS, 'Z center must be ~0');
  assert.ok(Math.abs(bb.min[0] - -1.25) < EPS);
  assert.ok(Math.abs(bb.max[0] - 1.25) < EPS);
  // A cube can't tell nx from nz, so check a 3x1x2 box too.
  const box = buildVoxels(
    { front: fill(3, 1, 'T'), right: fill(2, 1, 'T'), top: fill(3, 2, 'T') },
    { mirror: { x: true, y: true, z: true } }
  );
  assert.deepEqual(box.dims, { nx: 3, ny: 1, nz: 2 });
  const bbox = wedgeMesh(box).geometry.bounds;
  assert.ok(Math.abs((bbox.min[0] + bbox.max[0]) / 2) < EPS, 'X center ~0 even at nx=3');
  assert.ok(Math.abs((bbox.min[2] + bbox.max[2]) / 2) < EPS, 'Z center ~0 even at nz=2');
});

test('the mesh leaves Y as authored — a floating object does not rest on y=0', () => {
  const built = wedgeMesh(
    buildVoxels(
      {
        front: img(['MM', '..', '..']), // content only in the top row
        right: fill(1, 3, 'N'), // full height, so Y agrees
      },
      { mirror: { x: false, y: false, z: false } }
    )
  );
  const bb = built.geometry.bounds;
  // The solid is at grid y=2 of 3 with s = 2.5/3. Base at 2s = 5/3, top at 2.5.
  assert.ok(bb.min[1] > 1.5, `floating base must stay above y=0 (got ${bb.min[1]})`);
  assert.ok(Math.abs(bb.min[1] - 5 / 3) < EPS, 'base sits at world y = 2 * (2.5/3)');
  assert.ok(Math.abs(bb.max[1] - 2.5) < EPS, 'top reaches the full world height');
});

// Color comes from the skin texture (skin.js).

test('the mesh carries its skin: uvs in [0,1]; one material samples one texel, a two-color wall a chart', () => {
  // Each triangle's three uv pairs from the indexed geometry.
  const triUVs = ({ uv, index }) => {
    const out = [];
    for (let t = 0; t < index.length; t += 3)
      out.push([0, 1, 2].map((k) => [uv[index[t + k] * 2], uv[index[t + k] * 2 + 1]]));
    return out;
  };
  const oneTexel = (tri) => tri.every(([u, v]) => u === tri[0][0] && v === tri[0][1]);

  // The ramp is one material, so every triangle samples one texel.
  const built = wedgeMesh(buildVoxels(ramp()));
  const geo = built.geometry;
  assert.equal(geo.uv.length / 2, geo.position.length / 3, 'a uv per vertex');
  for (const v of geo.uv) assert.ok(v >= 0 && v <= 1, `uv ${v} outside [0,1]`);
  assert.ok(triUVs(geo).every(oneTexel), 'a one-material triangle samples one texel');
  assert.ok(built.skin, 'the record carries the skin');
  assert.equal(built.color, null, 'and no flat color');

  // A two-color wall merges to one charted +z rect.
  const wall = wedgeMesh(
    buildVoxels({
      front: img(['RRRR', 'RRRR', 'BBBB', 'BBBB']),
      right: fill(4, 4, 'T'),
      top: fill(4, 4, 'T'),
    })
  );
  assert.ok(wall.charts > 0, 'the wall charts at least one rect');
  assert.ok(
    triUVs(wall.geometry).some((t) => !oneTexel(t)),
    'a charted triangle spans texels'
  );
  assert.equal(
    oddEdges(wall.geometry),
    0,
    'a chart seam splits vertices, never the surface'
  );
});
