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
