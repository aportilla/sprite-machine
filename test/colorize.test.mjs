// Node-runnable value tests for colorize()'s FALLBACK TIERS. buildPalette and
// makeSnapper are already unit-tested in pipeline.test.mjs; the interesting,
// previously value-untested branches are:
//   (2) mirror-fill from the OPPOSITE view — on all three axes x, y AND z,
//   (3) relaxation = neighbor-averaging when neither facing nor opposite exists,
//   (4) the dominant-body fallback for an isolated face with no colored neighbor.
// Each expected color below was PROBED from a temporary run and then pinned.
// Run: node --test test/colorize.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { colorize } from '../src/lib/colorize.js';
import { buildVoxels } from '../src/lib/pipeline.js';
import { packRGBA } from '../src/lib/ingest.js';
import { extractSurface, voxIndex } from '../src/lib/carve.js';

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

// A single 1x1x1 solid voxel: every one of its 6 faces is exposed AND is the
// first solid hit from its own normal, so the mirror-fill depth gate is always
// satisfied — the cleanest fixture for isolating one fallback branch at a time.
const UNIT = { nx: 1, ny: 1, nz: 1 };
const UNIT_SOLID = new Uint8Array([1]);
const UNIT_MASK = extractSurface(UNIT_SOLID, UNIT).surfaceMask;
// A one-pixel grid-view of a single named face's color.
const gv1 = (name, packed) => ({
  [name]: { occ: new Uint8Array([1]), rgb: new Uint32Array([packed]), imgW: 1, imgH: 1 },
});
const faceC = (r, face) => r.faceColor.get(F[face]); // idx 0 on the unit grid

// ===========================================================================
// (2) MIRROR-FILL — the OPPOSITE view paints a face that has no facing view of
//     its own. Exercised independently on each of the three axes; the existing
//     suite only ever sets mirror.x, so the y and z branches never ran before.
// ===========================================================================

// z axis: 'back' colors the nz face; the pz face (facing view 'front' is
// ABSENT) is mirror-filled from back when mirror.z is on.
test('mirror-fill z: absent front -> pz takes the back view color', () => {
  const r = colorize(UNIT_SOLID, UNIT_MASK, gv1('back', pk('B')), UNIT, {
    mirror: { x: false, y: false, z: true },
  });
  assert.equal(faceC(r, 'nz'), pk('B')); // facing view paints its own face
  assert.equal(faceC(r, 'pz'), pk('B')); // mirror.z fills the opposite face
});

// z axis, mirror gate observable: give a SECOND color (top=T) so the OFF path
// relaxes to a DIFFERENT value than the mirror source. pz then reads back's blue
// only when mirror.z is on, and the top's teal (relaxation) when it is off —
// proving the mirror-fill tier is genuinely what colored pz above.
test('mirror-fill z is gated by mirror.z (off -> relaxes to a different color)', () => {
  const gviews = { ...gv1('back', pk('B')), ...gv1('top', pk('T')) };
  const on = colorize(UNIT_SOLID, UNIT_MASK, gviews, UNIT, {
    mirror: { x: false, y: false, z: true },
  });
  const off = colorize(UNIT_SOLID, UNIT_MASK, gviews, UNIT, {
    mirror: { x: false, y: false, z: false },
  });
  assert.equal(faceC(on, 'pz'), pk('B')); // mirror.z on: opposite (back) blue
  assert.equal(faceC(off, 'pz'), pk('T')); // mirror.z off: relaxed to top's teal
  assert.notEqual(faceC(off, 'pz'), faceC(on, 'pz'));
});

// y axis: 'bottom' colors the ny face; the py face (facing view 'top' ABSENT)
// is mirror-filled from bottom when mirror.y is on.
test('mirror-fill y: absent top -> py takes the bottom view color', () => {
  const r = colorize(UNIT_SOLID, UNIT_MASK, gv1('bottom', pk('G')), UNIT, {
    mirror: { x: false, y: true, z: false },
  });
  assert.equal(faceC(r, 'ny'), pk('G')); // facing (bottom) paints ny
  assert.equal(faceC(r, 'py'), pk('G')); // mirror.y fills py from bottom
});

// x axis: 'right' colors the nx face; the px face (facing view 'left' ABSENT)
// is mirror-filled from right when mirror.x is on.
test('mirror-fill x: absent left -> px takes the right view color', () => {
  const r = colorize(UNIT_SOLID, UNIT_MASK, gv1('right', pk('N')), UNIT, {
    mirror: { x: true, y: false, z: false },
  });
  assert.equal(faceC(r, 'nx'), pk('N')); // facing (right) paints nx
  assert.equal(faceC(r, 'px'), pk('N')); // mirror.x fills px from right
});

// ===========================================================================
// (3) RELAXATION — mirror OFF, a face with neither a facing nor an opposite
//     view AVERAGES its already-colored neighbors, then snaps to palette.
// ===========================================================================

// Seed three distinct facing colors on one voxel so relaxation has something to
// average: front->pz=R(240,0,0), top->py=Bl(0,0,240), left->px=P(120,0,120).
// The un-seeded faces (nx, ny, nz) average their neighbors to (120,0,120), which
// snaps to the THIRD palette color P — proving a genuine average, not a copy of
// any single neighbor's color.
test('relaxation: an un-viewed face averages its colored neighbors (mirror off)', () => {
  const R = packRGBA(240, 0, 0, 255);
  const Bl = packRGBA(0, 0, 240, 255);
  const P = packRGBA(120, 0, 120, 255);
  const gviews = { ...gv1('front', R), ...gv1('top', Bl), ...gv1('left', P) };
  const r = colorize(UNIT_SOLID, UNIT_MASK, gviews, UNIT, {
    mirror: { x: false, y: false, z: false },
  });
  // facing faces keep their own view colors:
  assert.equal(faceC(r, 'pz'), R);
  assert.equal(faceC(r, 'py'), Bl);
  assert.equal(faceC(r, 'px'), P);
  // relaxed faces land on the averaged-then-snapped color P, distinct from any
  // single neighbor (it is neither R nor Bl):
  assert.equal(faceC(r, 'nx'), P);
  assert.equal(faceC(r, 'ny'), P);
  assert.equal(faceC(r, 'nz'), P);
  assert.notEqual(faceC(r, 'nx'), R);
  assert.notEqual(faceC(r, 'nx'), Bl);
});

// ===========================================================================
// (4) DOMINANT BODY — a surface face reachable by NO colored neighbor (across
//     all relaxation passes) falls to the object's dominant (majority) color.
//     Forced with a voxel isolated from the colored body by an empty gap.
// ===========================================================================

// Grid 1x1x5: a connected block at z=0..2 is painted (mostly Maj/green, one
// Min/red face), z=3 is empty, and z=4 is a lone voxel cut off from the body.
// z=4's faces have no colored neighbor at any pass, so all six fall to the
// dominant color = the MAJORITY of already-colored faces (Maj), NOT the
// minority color that also lives in the palette.
test('dominant fallback: an isolated face takes the majority body color', () => {
  const d = { nx: 1, ny: 1, nz: 5 };
  const sol = new Uint8Array([1, 1, 1, 0, 1]); // z=3 empty isolates z=4
  const sm = extractSurface(sol, d).surfaceMask;
  const Maj = packRGBA(10, 200, 10, 255); // green — majority
  const Min = packRGBA(200, 10, 10, 255); // red — minority
  const gviews = {
    // right colors the nx face and projects u=z: paint the body (z=0,1,2) Maj.
    right: {
      occ: new Uint8Array([1, 1, 1, 0, 0]),
      rgb: new Uint32Array([Maj, Maj, Maj, 0, 0]),
      imgW: 5,
      imgH: 1,
    },
    // left colors the px face and projects u=nz-1-z: a single Min pixel at
    // u=4 -> z=0, so Min is present in the palette but rare.
    left: {
      occ: new Uint8Array([0, 0, 0, 0, 1]),
      rgb: new Uint32Array([0, 0, 0, 0, Min]),
      imgW: 5,
      imgH: 1,
    },
  };
  const r = colorize(sol, sm, gviews, d, { mirror: { x: false, y: false, z: false } });
  const co = (z, f) => r.faceColor.get(voxIndex(0, 0, z, d) * 6 + F[f]);
  // both colors are in the palette (so this is a genuine majority choice)...
  assert.deepEqual([...r.palette].map((c) => c >>> 0).sort(), [Maj, Min].sort());
  // the lone Min face and the Maj body faces are seeded as expected:
  assert.equal(co(0, 'px'), Min); // the single minority face
  assert.equal(co(0, 'nx'), Maj);
  // ...and every face of the isolated z=4 voxel falls to the majority (Maj):
  for (const f of ['px', 'nx', 'py', 'ny', 'pz', 'nz']) assert.equal(co(4, f), Maj);
  assert.notEqual(co(4, 'px'), Min); // not the minority, not palette-order
});

// A degenerate dominant case: with NO views at all the palette is empty and
// there is nothing to tally, so the fallback color is the hard-coded neutral
// gray (200,200,200) applied to every exposed face.
test('dominant fallback: no views -> neutral gray on every face', () => {
  const r = colorize(UNIT_SOLID, UNIT_MASK, {}, UNIT, {
    mirror: { x: false, y: false, z: false },
  });
  assert.equal(r.palette.length, 0);
  const gray = packRGBA(200, 200, 200, 255);
  for (const f of ['px', 'nx', 'py', 'ny', 'pz', 'nz']) assert.equal(faceC(r, f), gray);
});

// ===========================================================================
// (d) End-to-end through buildVoxels: toggling mirror.y and mirror.z on vs off
//     changes the colored result (the whole-pipeline view of tiers 2 vs 3).
// ===========================================================================

test('buildVoxels: mirror.y on vs off changes the top (py) face color', () => {
  // front + right + bottom, but NO top view. The top (py) face is therefore
  // either mirror-filled from bottom (mirror.y on) or relaxed (mirror.y off).
  const views = {
    front: fill(2, 2, 'M'),
    right: fill(2, 2, 'N'),
    bottom: fill(2, 2, 'G'),
  };
  const on = buildVoxels(views, { mirror: { x: false, y: true, z: false } });
  const off = buildVoxels(views, { mirror: { x: false, y: false, z: false } });
  assert.deepEqual(on.dims, { nx: 2, ny: 2, nz: 2 });
  // mirror.y on: the un-drawn top takes bottom's green (mirror-fill).
  assert.equal(colorOf(on, 0, 1, 0, 'py'), pk('G'));
  // mirror.y off: it falls to relaxation and lands on a DIFFERENT color.
  assert.notEqual(colorOf(off, 0, 1, 0, 'py'), pk('G'));
  assert.equal(colorOf(off, 0, 1, 0, 'py'), pk('N'));
});

test('buildVoxels: mirror.z on vs off changes the back (nz) face color', () => {
  // front + right only, no back. The back (nz) face is either mirror-filled from
  // front (mirror.z on) or relaxed (mirror.z off).
  const views = { front: fill(2, 2, 'M'), right: fill(2, 2, 'N') };
  const on = buildVoxels(views, { mirror: { x: false, y: false, z: true } });
  const off = buildVoxels(views, { mirror: { x: false, y: false, z: false } });
  // mirror.z on: back takes front's magenta (mirror-fill).
  assert.equal(colorOf(on, 0, 0, 0, 'nz'), pk('M'));
  // mirror.z off: back relaxes to the side color instead.
  assert.notEqual(colorOf(off, 0, 0, 0, 'nz'), pk('M'));
  assert.equal(colorOf(off, 0, 0, 0, 'nz'), pk('N'));
});
