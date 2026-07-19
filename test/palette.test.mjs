// Node-runnable tests for the editor's 256-color palette (pure, no THREE/DOM).
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PALETTE_256 } from '../src/lib/constants.js';
import { packRGBA } from '../src/lib/ingest.js';

test('PALETTE_256 is a full 16×16 grid of well-formed entries', () => {
  assert.equal(PALETTE_256.length, 256, '16×16 grid');
  for (const { css, packed } of PALETTE_256) {
    assert.match(css, /^#[0-9a-f]{6}$/, `valid hex: ${css}`);
    const r = parseInt(css.slice(1, 3), 16);
    const g = parseInt(css.slice(3, 5), 16);
    const b = parseInt(css.slice(5, 7), 16);
    assert.equal(packed, packRGBA(r, g, b, 255), `packed derived from css: ${css}`);
  }
});

// All 256 cells are DISTINCT. xterm-256 names 256 indexed slots but only 247
// distinct colors (its system/cube/grayscale ranges overlap on 9 values); the 9
// redundant cells carry Hilbert-neighbor-interpolated fillers so no swatch is
// ever wasted on a repeat. If a future edit reintroduces a duplicate (or a filler
// collides), this fails.
test('PALETTE_256 has 256 distinct colors (no duplicate swatches)', () => {
  const seen = new Map();
  PALETTE_256.forEach(({ css }, i) => {
    if (seen.has(css)) {
      const j = seen.get(css);
      assert.fail(
        `duplicate swatch ${css} at index ${j} (r${(j / 16) | 0}c${j % 16}) and ${i} (r${(i / 16) | 0}c${i % 16})`
      );
    }
    seen.set(css, i);
  });
  assert.equal(seen.size, 256, 'all 256 swatches distinct');
});

// Pin the exact Hilbert layout corners so a transcription/ordering slip is caught:
// grayscale in the top-left, the light-cyan corner at the bottom-right.
test('PALETTE_256 keeps the intended layout orientation', () => {
  assert.equal(PALETTE_256[0].css, '#000000', 'top-left is black (grayscale cluster)');
  assert.equal(PALETTE_256[255].css, '#d7ffff', 'bottom-right is pale cyan');
  // Row 0 (indices 0..15) should be neutrals ramping into warm hues — its first
  // eight cells are all grays (r==g==b).
  for (let i = 0; i < 8; i++) {
    const { css } = PALETTE_256[i];
    assert.equal(css.slice(1, 3), css.slice(3, 5), `row0 cell ${i} is gray (r==g)`);
    assert.equal(css.slice(3, 5), css.slice(5, 7), `row0 cell ${i} is gray (g==b)`);
  }
});
