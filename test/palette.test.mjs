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
