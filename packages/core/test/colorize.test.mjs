// Node-runnable value tests for colorize(): the palette build + snap, then the
// FALLBACK TIERS for a face with no facing view of its own —
//   (2) mirror-fill from the OPPOSITE view, on each of the three axes, gated
//       by mirror.{x,y,z},
//   (3) relaxation = neighbor-averaging when neither facing nor opposite exists,
//   (4) the dominant-body fallback for an isolated face with no colored neighbor.
// Each expected color below was PROBED from a temporary run and then pinned.
// Run: node --test test/colorize.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { colorize, buildPalette, makeSnapper } from '../src/colorize.js';
import { packRGBA } from '../src/ingest.js';
import { extractSurface, voxIndex } from '../src/carve.js';
import { C } from './helpers.mjs';

const pk = (name) => packRGBA(...C[name], 255);

// face index: px0 nx1 py2 ny3 pz4 nz5
const F = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 };

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
// (1) PALETTE + SNAP — the unit colorize's tiers all land on.
// ===========================================================================

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

// ===========================================================================
// (2) MIRROR-FILL — the OPPOSITE view paints a face that has no facing view of
//     its own, one axis at a time.
// ===========================================================================

// z axis, with the gate observable: 'back' colors the nz face; the pz face
// (facing view 'front' is ABSENT) takes back's blue only when mirror.z is on. A
// SECOND color (top=T) makes the OFF path relax to a DIFFERENT value, proving
// the mirror-fill tier is genuinely what colored pz.
test('mirror-fill z is gated by mirror.z (off -> relaxes to a different color)', () => {
  const gviews = { ...gv1('back', pk('B')), ...gv1('top', pk('T')) };
  const on = colorize(UNIT_SOLID, UNIT_MASK, gviews, UNIT, {
    mirror: { x: false, y: false, z: true },
  });
  const off = colorize(UNIT_SOLID, UNIT_MASK, gviews, UNIT, {
    mirror: { x: false, y: false, z: false },
  });
  assert.equal(faceC(on, 'nz'), pk('B')); // the facing view paints its own face
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
