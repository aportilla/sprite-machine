import { test } from 'node:test';
import assert from 'node:assert/strict';

import { colorize, buildPalette, makeSnapper } from '../src/colorize.js';
import { packRGBA } from '../src/ingest.js';
import { extractSurface, voxIndex } from '../src/carve.js';
import { C } from './helpers.mjs';

const pk = (name) => packRGBA(...C[name], 255);

const F = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 };

// A single solid voxel. Every face is exposed and is the first hit from its own
// normal, so the mirror-fill depth gate always passes.
const UNIT = { nx: 1, ny: 1, nz: 1 };
const UNIT_SOLID = new Uint8Array([1]);
const UNIT_MASK = extractSurface(UNIT_SOLID, UNIT).surfaceMask;
// A 1×1 grid view of one color, keyed by view name.
const gv1 = (name, packed) => ({
  [name]: { occ: new Uint8Array([1]), rgb: new Uint32Array([packed]), imgW: 1, imgH: 1 },
});
const faceC = (r, face) => r.faceColor.get(F[face]); // idx 0 on the unit grid

// Palette and snap

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
  // A ±1 per channel perturbation snaps back to teal.
  assert.equal(snap(packRGBA(r + 1, g - 1, b + 1)) >>> 0, pk('T'));
});

// Mirror fill: the opposite view paints a face that has no facing view.

// z axis: back colors nz. With front absent, pz takes back's blue only when
// mirror.z is on. Top's teal gives the off path a different color to relax to.
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

test('mirror-fill y: absent top -> py takes the bottom view color', () => {
  const r = colorize(UNIT_SOLID, UNIT_MASK, gv1('bottom', pk('G')), UNIT, {
    mirror: { x: false, y: true, z: false },
  });
  assert.equal(faceC(r, 'ny'), pk('G')); // facing (bottom) paints ny
  assert.equal(faceC(r, 'py'), pk('G')); // mirror.y fills py from bottom
});

test('mirror-fill x: absent left -> px takes the right view color', () => {
  const r = colorize(UNIT_SOLID, UNIT_MASK, gv1('right', pk('N')), UNIT, {
    mirror: { x: true, y: false, z: false },
  });
  assert.equal(faceC(r, 'nx'), pk('N')); // facing (right) paints nx
  assert.equal(faceC(r, 'px'), pk('N')); // mirror.x fills px from right
});

// Relaxation: with mirror off, a face with no facing or opposite view averages
// its colored neighbors, then snaps to the palette.

// front paints pz R, top paints py Bl, left paints px P. The unseeded faces
// average their neighbors to (120,0,120), which snaps to P.
test('relaxation: an un-viewed face averages its colored neighbors (mirror off)', () => {
  const R = packRGBA(240, 0, 0, 255);
  const Bl = packRGBA(0, 0, 240, 255);
  const P = packRGBA(120, 0, 120, 255);
  const gviews = { ...gv1('front', R), ...gv1('top', Bl), ...gv1('left', P) };
  const r = colorize(UNIT_SOLID, UNIT_MASK, gviews, UNIT, {
    mirror: { x: false, y: false, z: false },
  });
  // Facing faces keep their view colors.
  assert.equal(faceC(r, 'pz'), R);
  assert.equal(faceC(r, 'py'), Bl);
  assert.equal(faceC(r, 'px'), P);
  // Relaxed faces get the averaged, snapped color P.
  assert.equal(faceC(r, 'nx'), P);
  assert.equal(faceC(r, 'ny'), P);
  assert.equal(faceC(r, 'nz'), P);
  assert.notEqual(faceC(r, 'nx'), R);
  assert.notEqual(faceC(r, 'nx'), Bl);
});

// Dominant color: a face that no colored neighbor reaches takes the majority color.

// Grid 1x1x5: z=0..2 is painted, mostly Maj with one Min face. z=3 is empty, so
// the lone voxel at z=4 has no colored neighbor and takes Maj.
test('dominant fallback: an isolated face takes the majority body color', () => {
  const d = { nx: 1, ny: 1, nz: 5 };
  const sol = new Uint8Array([1, 1, 1, 0, 1]); // z=3 empty isolates z=4
  const sm = extractSurface(sol, d).surfaceMask;
  const Maj = packRGBA(10, 200, 10, 255); // green, majority
  const Min = packRGBA(200, 10, 10, 255); // red, minority
  const gviews = {
    // right colors nx with u = z. The body (z=0..2) is Maj.
    right: {
      occ: new Uint8Array([1, 1, 1, 0, 0]),
      rgb: new Uint32Array([Maj, Maj, Maj, 0, 0]),
      imgW: 5,
      imgH: 1,
    },
    // left colors px with u = nz-1-z. One Min pixel at u=4 lands at z=0.
    left: {
      occ: new Uint8Array([0, 0, 0, 0, 1]),
      rgb: new Uint32Array([0, 0, 0, 0, Min]),
      imgW: 5,
      imgH: 1,
    },
  };
  const r = colorize(sol, sm, gviews, d, { mirror: { x: false, y: false, z: false } });
  const co = (z, f) => r.faceColor.get(voxIndex(0, 0, z, d) * 6 + F[f]);
  assert.deepEqual([...r.palette].map((c) => c >>> 0).sort(), [Maj, Min].sort());
  assert.equal(co(0, 'px'), Min);
  assert.equal(co(0, 'nx'), Maj);
  // Every face of the isolated voxel takes Maj.
  for (const f of ['px', 'nx', 'py', 'ny', 'pz', 'nz']) assert.equal(co(4, f), Maj);
  assert.notEqual(co(4, 'px'), Min);
});

test('dominant fallback: no views -> neutral gray on every face', () => {
  const r = colorize(UNIT_SOLID, UNIT_MASK, {}, UNIT, {
    mirror: { x: false, y: false, z: false },
  });
  assert.equal(r.palette.length, 0);
  const gray = packRGBA(200, 200, 200, 255);
  for (const f of ['px', 'nx', 'py', 'ny', 'pz', 'nz']) assert.equal(faceC(r, f), gray);
});
