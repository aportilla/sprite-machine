// Low-poly wedge gate robustness (THREE is loaded here, unlike pipeline.test.mjs).
// Regression for the Helium bug: privacy browsers "farble" canvas getImageData,
// perturbing source pixels by ~±1/channel. The wedge gate used strict RGB
// equality, so same-material pixels stopped comparing equal and wedges silently
// dropped — only in the farbling browser. The gate now snaps to the palette and
// compares with a small tolerance, so it must be invariant under ±1 noise while
// still gating genuine material seams.
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildVoxels } from '../src/lib/pipeline.js';
import { wedgeMesh } from '../src/lib/wedge-mesh.js';

// --- tiny sprite builder (mirrors pipeline.test.mjs) ------------------------
const C = {
  R: [220, 60, 60], // red
  B: [70, 90, 200], // blue
  T: [169, 220, 214], // teal
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
const wedgeCount = (views) => wedgeMesh(buildVoxels(views)).userData.wedges;

// A coherent 45° ramp: a staircase of one material -> should produce wedges.
const ramp = () => ({
  front: fill(4, 4, 'T'),
  right: img(['...T', '..TT', '.TTT', 'TTTT']),
  top: fill(4, 4, 'T'),
});

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

// The gate is STRICT: a wedge fires iff the two faces it covers — the riser and
// the tread — are the same material. It consults nothing else (no profile/facing
// view, no elevation). These two staircases prove both directions of that
// contract, which hands the sprite author exact control over which corners round.

// (1) All step faces one material (white), with a stray pink band elsewhere in
// the FRONT elevation. Every step's riser AND tread are white, so all 9 notch
// cells wedge regardless of where the band sits — the projection is irrelevant
// because only the covered faces are read. (An earlier heuristic that sampled the
// facing-view elevation dropped a step at each band edge: white-cap 6/9, band 3/9.)
const WP = { '#': [255, 255, 255], O: [233, 23, 241] }; // white body + pink band
const stair = (frontRows, topRows) => ({
  right: img(['   ###', '  ####', ' #####', '######'], WP), // all-white step profile
  front: img(frontRows, WP),
  top: img(topRows, WP),
});

test('monochrome staircase wedges every step regardless of an elevation colour band', () => {
  const whiteCap = stair(['###', 'OOO', 'OOO', 'OOO'], ['OOO', 'OOO', '###', '###', '###', '###']);
  const pinkBand = stair(['###', '###', 'OOO', '###'], ['OOO', '###', '###', '###', '###', '###']);
  assert.equal(wedgeCount(whiteCap), 9, 'white-cap staircase must wedge every step (3 steps x 3 wide)');
  assert.equal(wedgeCount(pinkBand), 9, 'pink-band staircase must wedge every step (3 steps x 3 wide)');
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
  assert.equal(wedgeCount(twoColour()), 0, 'riser!=tread must never wedge, even on a perfect ramp');
});
