// Mesh assembly tests for voxelMesh() + mesh-util helpers (THREE is loaded
// here, like wedge-mesh.test.mjs). Covers three contracts: the indexed geometry
// welds watertight (every undirected edge used an even number of times), the
// mesh is centered on X/Z but left EXACTLY as authored on Y (no ground-rest),
// and the vertex-color linearizer memoizes by packed key (identity-stable).
// Run: node --test test/mesh.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildVoxels } from '../src/lib/pipeline.js';
import { voxelMesh } from '../src/lib/mesh.js';
import { makeVertexColorLinearizer } from '../src/lib/mesh-util.js';
import { packRGBA } from '../src/lib/ingest.js';

// --- tiny sprite builder (mirrors pipeline.test.mjs) ------------------------
const C = {
  R: [220, 60, 60], // red
  B: [70, 90, 200], // blue
  T: [169, 220, 214], // teal
  M: [199, 125, 214], // magenta
  N: [201, 184, 120], // tan
};
function img(rows, pal = C) {
  const h = rows.length;
  const w = rows[0].length;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch === '.' || ch === ' ') continue;
      const [r, g, b] = pal[ch];
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  return { width: w, height: h, data };
}
const fill = (w, h, ch) => img(Array.from({ length: h }, () => ch.repeat(w)));

// Count undirected edges used an ODD number of times. A closed (watertight)
// welded surface uses every edge an even number of times, so 0 == watertight.
// Copied verbatim from wedge-mesh.test.mjs (the two mesh builders share the
// weld contract, so they share the check).
function oddEdges(mesh) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position.array;
  const idx = geo.index ? geo.index.array : null;
  const tris = idx ? idx.length / 3 : pos.length / 9;
  const key = (i) =>
    `${Math.round(pos[i * 3] * 1e4)},${Math.round(pos[i * 3 + 1] * 1e4)},${Math.round(pos[i * 3 + 2] * 1e4)}`;
  const edges = new Map();
  for (let t = 0; t < tris; t++) {
    const [a, b, c] = idx
      ? [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]]
      : [t * 3, t * 3 + 1, t * 3 + 2];
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const ka = key(p),
        kb = key(q);
      const e = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      edges.set(e, (edges.get(e) || 0) + 1);
    }
  }
  let odd = 0;
  for (const n of edges.values()) if (n % 2 === 1) odd++;
  return odd;
}

const EPS = 1e-4;

// --- watertight welding -----------------------------------------------------

test('voxelMesh welds a solid cube watertight (indexed geometry, 0 odd edges)', () => {
  const mesh = voxelMesh(
    buildVoxels(
      { front: fill(4, 4, 'T'), right: fill(4, 4, 'T'), top: fill(4, 4, 'T') },
      { mirror: { x: true, y: false, z: false } }
    )
  );
  assert.equal(oddEdges(mesh), 0, 'a cube must have no boundary edges');
});

test('voxelMesh welds a non-cube box watertight (3x1x2, greedy on)', () => {
  // A genuinely non-cubic rectangular box: each of the 6 faces greedy-merges to
  // a single rect, and they share edges evenly — still watertight.
  const r = buildVoxels(
    { front: fill(3, 1, 'T'), right: fill(2, 1, 'T'), top: fill(3, 2, 'T') },
    { mirror: { x: true, y: true, z: true } }
  );
  assert.deepEqual(r.dims, { nx: 3, ny: 1, nz: 2 }); // confirm it's not a cube
  assert.equal(oddEdges(voxelMesh(r)), 0, 'a non-cube box must weld watertight');
});

test('voxelMesh welds a non-cube staircase watertight (per-face, no T-junctions)', () => {
  // An L-shaped staircase is a closed solid but a concave, distinctly non-cubic
  // silhouette. With greedy OFF (one unit quad per exposed face) every shared
  // edge is used exactly twice, so the weld is watertight. (Greedy meshing this
  // shape introduces T-junctions along the step risers — a rendering-safe
  // artifact voxelMesh does not repair — so those edges read odd; the culled
  // path is the manifold-clean one this asserts.)
  const mesh = voxelMesh(
    buildVoxels({
      front: fill(4, 4, 'T'),
      right: img(['...T', '..TT', '.TTT', 'TTTT']),
      top: fill(4, 4, 'T'),
    }),
    { greedy: false }
  );
  assert.equal(oddEdges(mesh), 0, 'per-face staircase must weld watertight');
});

// --- X/Z centering, Y as authored ------------------------------------------

test('voxelMesh centers the geometry on X and Z (bbox center ~0)', () => {
  const mesh = voxelMesh(
    buildVoxels(
      { front: fill(4, 4, 'T'), right: fill(4, 4, 'T'), top: fill(4, 4, 'T') },
      { mirror: { x: true, y: false, z: false } }
    )
  );
  const bb = mesh.geometry.boundingBox; // computed by finishVoxelMesh
  assert.ok(Math.abs((bb.min.x + bb.max.x) / 2) < EPS, 'X center must be ~0');
  assert.ok(Math.abs((bb.min.z + bb.max.z) / 2) < EPS, 'Z center must be ~0');
  // A 4x4x4 cube at worldSize 2.5 spans [-1.25, 1.25] on the centered axes.
  assert.ok(Math.abs(bb.min.x - -1.25) < EPS);
  assert.ok(Math.abs(bb.max.x - 1.25) < EPS);
});

test('voxelMesh centering holds on a non-cube box (asymmetric nx vs nz)', () => {
  const mesh = voxelMesh(
    buildVoxels(
      { front: fill(3, 1, 'T'), right: fill(2, 1, 'T'), top: fill(3, 2, 'T') },
      { mirror: { x: true, y: true, z: true } }
    )
  );
  const bb = mesh.geometry.boundingBox;
  assert.ok(Math.abs((bb.min.x + bb.max.x) / 2) < EPS, 'X center ~0 even at nx=3');
  assert.ok(Math.abs((bb.min.z + bb.max.z) / 2) < EPS, 'Z center ~0 even at nz=2');
});

test('voxelMesh leaves Y as authored — a floating object does not rest on y=0', () => {
  // Paint only the TOP image row so the solid sits high in the tile and floats.
  // finishVoxelMesh translates Y by a hard 0, so the base must stay above y=0.
  const mesh = voxelMesh(
    buildVoxels(
      {
        front: img(['MM', '..', '..']), // content only in the top row
        right: fill(1, 3, 'N'), // full-height side so Y agrees (3 tall)
      },
      { mirror: { x: false, y: false, z: false } }
    )
  );
  const bb = mesh.geometry.boundingBox;
  // The object occupies world y=2 in a 3-tall grid (s = 2.5/3); its base is well
  // above the ground plane. Probed actual min.y ~= 1.6667.
  assert.ok(bb.min.y > 1.5, `floating base must stay above y=0 (got ${bb.min.y})`);
  assert.ok(Math.abs(bb.min.y - 5 / 3) < EPS, 'base sits at world y = 2 * (2.5/3)');
  assert.ok(Math.abs(bb.max.y - 2.5) < EPS, 'top reaches the full world height');
});

// --- makeVertexColorLinearizer: [0,1] tuple + memo identity ------------------

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

test('makeVertexColorLinearizer memoizes: same key === same array, different keys differ', () => {
  const lin = makeVertexColorLinearizer();
  const red = packRGBA(220, 60, 60, 255);
  const blue = packRGBA(70, 90, 200, 255);
  const a1 = lin(red);
  const a2 = lin(red);
  assert.equal(a1, a2, 'a repeated key must return the SAME array reference (cache)');
  const b1 = lin(blue);
  assert.notEqual(a1, b1, 'a different key must return a different array');
  assert.notDeepEqual(a1, b1, 'different colors linearize to different tuples');
});
