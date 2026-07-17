// Node-runnable correctness tests for the pure voxel pipeline (no THREE/DOM).
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildVoxels } from '../src/lib/pipeline.js';
import { packRGBA, applyTransform, ingestSprite } from '../src/lib/ingest.js';
import { voxIndex } from '../src/lib/carve.js';
import { culledQuads, greedyQuads } from '../src/lib/faces.js';
import { sliceAtlas, deriveTileSize, DEFAULT_ATLAS_LAYOUT } from '../src/lib/atlas.js';
import { buildPalette, makeSnapper } from '../src/lib/colorize.js';
import {
  VIEWS,
  VIEW_AXES,
  VIEW_FRONT_EDGE,
  VIEW_DISPLAY_ORDER,
} from '../src/lib/views.js';
import { eliminateTJunctions } from '../src/lib/t-junction.js';

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

// --- atlas slicing ----------------------------------------------------------
// Build a mock 3x2 atlas of 2x2 tiles (6x4 px); one cell left blank.
function mockAtlas() {
  const W = 6,
    H = 4;
  const data = new Uint8ClampedArray(W * H * 4);
  const cellColor = {
    // [col,row] -> [r,g,b] ; row1col0 (right) left transparent
    '0,0': [10, 0, 0],
    '1,0': [20, 0, 0],
    '2,0': [30, 0, 0],
    '1,1': [40, 0, 0],
    '2,1': [50, 0, 0],
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
  // layout: left front top / right back bottom
  assert.equal(views.left.data[0], 10);
  assert.equal(views.front.data[0], 20);
  assert.equal(views.top.data[0], 30);
  assert.equal(views.back.data[0], 40);
  assert.equal(views.bottom.data[0], 50);
  assert.equal(views.right, null); // blank cell -> null
});

test('applyTransform rot:1 rotates 90deg CW (left column -> top row)', () => {
  const img = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([
      200, 0, 0, 255, /* left = red */ 0, 0, 200, 255 /* right = blue */,
    ]),
  };
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
    for (let f = 0; f < 6; f++) if (m & (1 << f)) assert.ok(r.faceColor.has(idx * 6 + f));
  }
});

// --- 8. Projection conventions pinned (docs/code can't silently drift) -------
test('TOP/BOTTOM view: object front pins to the TOP image row of both', () => {
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
});

test('LEFT view: object front pins to the left image column', () => {
  const d = { nx: 4, ny: 3, nz: 5 };
  assert.equal(VIEWS.left.project(0, 0, d.nz - 1, d).u, 0); // front -> left col
  assert.equal(VIEWS.left.project(0, 0, 0, d).u, d.nz - 1); // back  -> right col
});

// The UI marks the object's front edge on each face thumbnail. Pin that marker
// to the actual projections so it can't drift from the coordinate conventions.
test('VIEW_FRONT_EDGE agrees with where the object front (+z) projects', () => {
  const d = { nx: 4, ny: 3, nz: 5 };
  const frontZ = d.nz - 1;
  for (const name of Object.keys(VIEWS)) {
    const spec = VIEWS[name];
    const [wAxis, hAxis] = VIEW_AXES[name];
    const p = spec.project(0, 0, frontZ, d); // a voxel on the front plane
    let edge = null; // front/back look along z -> no in-plane front edge
    if (wAxis === 'nz') edge = p.u === 0 ? 'left' : 'right';
    else if (hAxis === 'nz') edge = p.v === 0 ? 'top' : 'bottom';
    assert.equal(VIEW_FRONT_EDGE[name], edge, `front edge of ${name}`);
  }
});

// The faces preview grid must read in the same order as the atlas sheet.
test('faces preview order matches the atlas layout', () => {
  assert.deepEqual(VIEW_DISPLAY_ORDER, DEFAULT_ATLAS_LAYOUT.flat());
});

// Sprites are hard pixel art: solid at alpha >= 128, transparent below.
test('ingest treats alpha >= 128 as solid, < 128 as transparent', () => {
  const px = (a) => ({
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([200, 0, 0, a]),
  });
  assert.notEqual(ingestSprite(px(255)), null);
  assert.notEqual(ingestSprite(px(128)), null);
  assert.equal(ingestSprite(px(127)), null); // dropped -> fully transparent
  assert.equal(ingestSprite(px(0)), null);
});

// --- 9. Palette build + snap (colorize's "most likely to look wrong" unit) ---
test('buildPalette collects unique solid pixel colors, skipping transparent', () => {
  const gv = {
    front: {
      occ: new Uint8Array([1, 1, 0, 1]),
      rgb: new Uint32Array([pk('M'), pk('M'), 0, pk('T')]),
    },
  };
  const pal = buildPalette(gv)
    .map((c) => c >>> 0)
    .sort();
  assert.deepEqual(pal, [pk('M'), pk('T')].sort());
});

test('makeSnapper maps a near-palette color to its nearest entry', () => {
  const snap = makeSnapper([pk('T'), pk('M')]);
  assert.equal(snap(pk('T')) >>> 0, pk('T')); // exact hit returns itself
  const [r, g, b] = C.T;
  // a ±1/channel perturbation snaps back to teal, not magenta.
  assert.equal(snap(packRGBA(r + 1, g - 1, b + 1)) >>> 0, pk('T'));
});

// --- 10. Zero-view edge case: a single solid voxel, with a clear warning -----
test('buildVoxels with no views yields one voxel and warns', () => {
  const r = buildVoxels({});
  assert.deepEqual(r.dims, { nx: 1, ny: 1, nz: 1 });
  assert.equal(r.solidCount, 1);
  assert.ok(r.warnings.some((w) => /no usable views/i.test(w)));
});

// --- 11. T-junction elimination (used by low-poly greedy base faces) ---------
// A vertex is a T-junction if it lies strictly interior to some triangle edge.
function hasTJunction(tris) {
  const seen = new Set(),
    verts = [];
  for (const t of tris)
    for (const v of [t.a, t.b, t.c]) {
      const k = v.join(',');
      if (!seen.has(k)) seen.add(k), verts.push(v);
    }
  const interior = (p, q, v) => {
    const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const e = [v[0] - p[0], v[1] - p[1], v[2] - p[2]];
    const cx = d[1] * e[2] - d[2] * e[1];
    const cy = d[2] * e[0] - d[0] * e[2];
    const cz = d[0] * e[1] - d[1] * e[0];
    if (cx || cy || cz) return false; // not collinear
    const dot = d[0] * e[0] + d[1] * e[1] + d[2] * e[2];
    const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    return dot > 0 && dot < len2; // strictly between the endpoints
  };
  for (const t of tris)
    for (const [p, q] of [
      [t.a, t.b],
      [t.b, t.c],
      [t.c, t.a],
    ])
      for (const v of verts) if (interior(p, q, v)) return true;
  return false;
}

test('eliminateTJunctions splits edges at interior lattice vertices', () => {
  const N = [0, 0, 1];
  const tris = [
    // a merged rect (two tris) spanning x=0..4 along its bottom edge
    { a: [0, 0, 0], b: [4, 0, 0], c: [4, 2, 0], normal: N, color: 1 },
    { a: [0, 0, 0], b: [4, 2, 0], c: [0, 2, 0], normal: N, color: 1 },
    // a neighbor introducing a vertex at (2,0,0) mid the rect's bottom edge
    { a: [2, 0, 0], b: [2, -2, 0], c: [0, -2, 0], normal: N, color: 1 },
  ];
  assert.ok(hasTJunction(tris), 'setup must contain a T-junction at (2,0,0)');
  const out = eliminateTJunctions(tris);
  assert.ok(!hasTJunction(out), 'repaired mesh has no interior-edge vertices');
  assert.ok(out.length > tris.length, 'the offending triangle was subdivided');
});
