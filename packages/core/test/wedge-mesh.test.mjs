import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildVoxels, unionVoxels } from '../src/pipeline.js';
import { wedgeMesh } from '../src/wedge-mesh.js';
import { voxIndex } from '../src/carve.js';
import { FACE_KEYS, FACE_NORMAL } from '../src/views.js';
import { img, fill, oddEdges } from './helpers.mjs';

const wedgeCount = (views) => wedgeMesh(buildVoxels(views)).wedges;
const EPS = 1e-4;

/** Whether some vertex normal points along `n` (given unnormalized). */
const hasNormal = ({ normal }, n) => {
  const len = Math.hypot(...n);
  for (let i = 0; i < normal.length; i += 3)
    if (n.every((v, k) => Math.abs(normal[i + k] - v / len) < EPS)) return true;
  return false;
};

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

// Corner fills. Where arms cap into one cell their caps leave a gap, and the
// gap's rim takes one triangle or two on its raised diagonal.

// A 2x2 block on a 4x4 slab. `wall` paints the slab's sides and `corner` the
// four ring texels the hips hide.
const plinth = (wall = 'T', corner = 'T') => ({
  front: img(['.TT.', 'T'.repeat(4).replaceAll('T', wall)]),
  right: img(['.TT.', 'T'.repeat(4).replaceAll('T', wall)]),
  top: img([corner + 'TT' + corner, 'TTTT', 'TTTT', corner + 'TT' + corner]),
});

const pyramid = (side) => ({
  front: img(['..T..', '.TTT.', 'TTTTT']),
  right: img(['..T..', '.TTT.', 'TTTTT'].map((r) => r.replaceAll('T', side))),
  top:
    side === 'T' ? fill(5, 5, 'T') : img(['TTTTT', 'RTTTR', 'RRTRR', 'RTTTR', 'TTTTT']),
});

test('a plinth folds at each corner: four hips, no gap, and a frustum of triangles', () => {
  const built = wedgeMesh(buildVoxels(plinth()));
  assert.equal(built.corners, 4, 'one hip per plan corner');
  assert.equal(built.gaps, 0, 'no end still caps into a corner');
  assert.equal(oddEdges(built.geometry), 0);
  // Top 2, four chamfer sides 8, the slab's walls 8, bottom 2.
  assert.equal(built.triangles, 20);
});

test('a stepped pyramid is four flat sides, one colour or two', () => {
  const one = wedgeMesh(buildVoxels(pyramid('T')));
  assert.equal(one.slopes, 4, 'a side is one traced region across both levels');
  assert.equal(one.corners, 8, 'four hips per level');
  assert.equal(one.gaps, 0);
  assert.equal(one.triangles, 20);
  assert.equal(oddEdges(one.geometry), 0);
  const two = wedgeMesh(buildVoxels(pyramid('R')));
  assert.equal(two.slopes, 4, 'each triangle of a fold reads only its own arm');
  assert.equal(two.corners, 8);
  assert.equal(two.triangles, one.triangles, 'a colour edge costs no triangle');
  assert.equal(oddEdges(two.geometry), 0);
});

test("a hip's shared solid can be a wall", () => {
  // The plinth on its side: a 2x2 block on the +z face of a 4x4 slab.
  const built = wedgeMesh(
    buildVoxels({
      front: fill(4, 4, 'T'),
      right: img(['T.', 'TT', 'TT', 'T.']),
      top: img(['.TT.', 'TTTT']),
    })
  );
  assert.equal(built.corners, 4);
  assert.equal(built.gaps, 0);
  assert.equal(oddEdges(built.geometry), 0);
});

test('a hip reads the floor it hides: a chamfer ring closes only where it is painted', () => {
  // The slab's sides are tan, so the face past the hip's floor edge never
  // matches the chamfer. Only the hidden ring texel can carry its colour.
  const painted = wedgeMesh(buildVoxels(plinth('N', 'T')));
  assert.equal(painted.corners, 4, 'the ring corner carries the chamfer colour');
  assert.equal(painted.gaps, 0);
  assert.equal(oddEdges(painted.geometry), 0);
  const bare = wedgeMesh(buildVoxels(plinth('N', 'N')));
  assert.equal(bare.corners, 0, 'neither rim edge carries it, so the gap stays');
  assert.equal(oddEdges(bare.geometry), 0);
});

test('a box vertex with three chamfers closes with one facet on the diagonal', () => {
  // A 6-cube with the three edges at its (+x, +y, +z) vertex chamfered 1:1.
  const rows = (hole) =>
    Array.from({ length: 6 }, (_, v) =>
      Array.from({ length: 6 }, (_, u) => (u === hole && v === 0 ? '.' : 'T')).join('')
    );
  const built = wedgeMesh(
    buildVoxels({ front: img(rows(5)), right: img(rows(5)), top: img(rows(0)) })
  );
  assert.equal(built.corners, 1, 'one corner tetrahedron');
  assert.equal(built.gaps, 0);
  assert.ok(hasNormal(built.geometry, [1, 1, 1]), 'the facet faces the cell corner');
  assert.equal(oddEdges(built.geometry), 0);
});

test('a pitch change along one ridge fills with a facet', () => {
  // A 1:1 chamfer on the top +z edge and a 1:2 one on the vertical +x/+z edge.
  // The 1:2 arm cannot reach the last cell, so a 1:1 stands there and the two
  // cap into each other.
  const n = 6;
  const full = fill(n, n, 'T');
  const built = wedgeMesh(
    buildVoxels({
      front: full,
      right: img(
        Array.from({ length: n }, (_, v) =>
          Array.from({ length: n }, (_, u) => (v === 0 && u === n - 1 ? '.' : 'T')).join(
            ''
          )
        )
      ),
      top: img(
        Array.from({ length: n }, (_, v) =>
          Array.from({ length: n }, (_, u) => (u === 0 && v < 2 ? '.' : 'T')).join('')
        )
      ),
    })
  );
  assert.equal(built.corners, 1);
  assert.equal(built.gaps, 0, 'the 1:1 is absorbed and neither end caps');
  assert.equal(oddEdges(built.geometry), 0);
});

// Inside corners come only from a layer union: one view that empties a cell
// empties its whole line, and that line holds one of the three neighbours.

const floorLayer = (h, w = 6) => ({
  front: img([...Array(h - 1).fill('.'.repeat(w)), 'T'.repeat(w)]),
  right: img([...Array(h - 1).fill('.'.repeat(w)), 'T'.repeat(w)]),
  top: fill(w, w, 'T'),
});
const lSlab = (h, w = 6, front = 'T'.repeat(w)) => ({
  front: img([...Array(h - 1).fill(front), '.'.repeat(w)]),
  right: img([...Array(h - 1).fill('T'.repeat(w)), '.'.repeat(w)]),
  top: img([...Array(3).fill('TTTTTT'), ...Array(3).fill('TTT...')]),
});

test('a one-colour inside corner is a cut cube, chamfer above or not', () => {
  for (const high of [1, 3]) {
    const built = wedgeMesh(
      unionVoxels([buildVoxels(floorLayer(high + 1)), buildVoxels(lSlab(high + 1))])
    );
    assert.equal(built.corners, 1, `${high} high: the inner corner cell`);
    assert.equal(built.gaps, 0, `${high} high`);
    assert.ok(
      hasNormal(built.geometry, [-1, 1, -1]),
      `${high} high: the cut faces the cell's open corner`
    );
    assert.equal(oddEdges(built.geometry), 0, `${high} high`);
  }
});

test('an inside corner whose walls differ in colour is a valley', () => {
  // The −z wall and the floor under the x arm are red, the rest teal, so the
  // three faces the cut cube would need do not agree.
  const built = wedgeMesh(
    unionVoxels([
      buildVoxels({
        front: img(['......', 'TTTTTT']),
        right: img(['......', 'TTTTTT']),
        top: img(['TTTTTT', 'TTTTTT', 'TTTTTT', 'TTTTRR', 'TTTTTT', 'TTTTTT']),
      }),
      buildVoxels(lSlab(2, 6, 'RRRRRR')),
    ])
  );
  assert.equal(built.corners, 1);
  assert.equal(built.gaps, 0);
  assert.ok(!hasNormal(built.geometry, [-1, 1, -1]), 'a valley, not a cut cube');
  assert.equal(oddEdges(built.geometry), 0);
});

test('a slab with a bevelled plan corner closes over its floor', () => {
  const built = wedgeMesh(
    unionVoxels([
      buildVoxels({
        front: img(['.....', 'TTTTT']),
        right: img(['.....', 'TTTTT']),
        top: fill(5, 5, 'T'),
      }),
      buildVoxels({
        front: img(['.TTT.', '.....']),
        right: img(['.TTT.', '.....']),
        top: img(['.....', '.TTT.', '.TTT.', '.TT..', '.....']),
      }),
    ])
  );
  assert.equal(built.gaps, 0, 'the cut cube presents ends the hips take');
  assert.equal(oddEdges(built.geometry), 0);
});

test('the corner gates hold under the ±1 source RGB farble', () => {
  assert.equal(wedgeMesh(buildVoxels(farble(plinth()))).corners, 4);
  assert.equal(wedgeMesh(buildVoxels(farble(pyramid('R')))).corners, 8);
});

// A 10-cell box whose (+x, +y, +z) vertex is rounded independently in the
// front, side and top views, each in one of nine staircase styles.
const STYLES = [
  [],
  [1],
  [2, 1],
  [3, 2, 1],
  [2],
  [4, 2],
  [1, 1],
  [2, 2, 1, 1],
  [4, 2, 1, 1],
];
const N = 12;

function sweepHull(front, side, top) {
  const dims = { nx: N, ny: N, nz: N };
  const cuts = (style, u, v, vMax) => u > 10 - (style[vMax - v] ?? 0);
  const solid = new Uint8Array(N * N * N);
  for (let z = 1; z <= 10; z++)
    for (let y = 0; y <= 9; y++)
      for (let x = 1; x <= 10; x++)
        if (!cuts(front, x, y, 9) && !cuts(side, z, y, 9) && !cuts(top, x, z, 10))
          solid[voxIndex(x, y, z, dims)] = 1;
  const surfaceMask = new Uint8Array(N * N * N);
  for (let z = 0; z < N; z++)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = voxIndex(x, y, z, dims);
        if (!solid[i]) continue;
        FACE_KEYS.forEach((face, f) => {
          const [a, b, c] = FACE_NORMAL[face].map((d, k) => [x, y, z][k] + d);
          const out = [a, b, c].some((v) => v < 0 || v >= N);
          if (out || !solid[voxIndex(a, b, c, dims)]) surfaceMask[i] |= 1 << f;
        });
      }
  return { dims, solid, surfaceMask, faceColor: new Map(), palette: [] };
}

test('every rounding of a box vertex welds watertight, in all 729 style mixes', () => {
  let corners = 0;
  for (const front of STYLES)
    for (const side of STYLES)
      for (const top of STYLES) {
        const built = wedgeMesh(sweepHull(front, side, top), { flat: true });
        corners += built.corners;
        if (oddEdges(built.geometry))
          assert.fail(`boundary edges at ${front}/${side}/${top}`);
      }
  assert.ok(corners > 1000, 'the sweep exercises the corner pass');
});

test('three arms over a wall face close from the gap rim', () => {
  // Two legs of an L, one 2 cells long and one 1, with the corner bevelled in
  // plan and both tops chamfered. The three arms have no shared vertex and the
  // box floor is another arm's cell, so only the rim itself settles it.
  const built = wedgeMesh(
    buildVoxels({
      front: img(['.....', '.....', '.RR..', '.RRR.', '.....']),
      right: img(['.....', '.....', '.R...', '.RR..', '.....']),
      top: img(['.....', '.....', '...R.', '.RRR.', '.....']),
    })
  );
  assert.equal(built.corners, 1, 'one fill, from the caps and the wall between');
  assert.equal(built.gaps, 0);
  assert.equal(oddEdges(built.geometry), 0);
});
