// Node-runnable unit tests for src/lib/color.js — the shared color helpers behind
// the editor palette (constants.js), the editor's live "in sprite" palette, and
// main.js's cross-face used-color scan (pure, no THREE/DOM). Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hexToRgb, rgbKey, distinctColors } from '../src/lib/color.js';

test('hexToRgb parses #rrggbb into byte channels', () => {
  assert.deepEqual(hexToRgb('#000000'), { r: 0, g: 0, b: 0 });
  assert.deepEqual(hexToRgb('#ffffff'), { r: 255, g: 255, b: 255 });
  assert.deepEqual(hexToRgb('#0a141e'), { r: 10, g: 20, b: 30 });
});

test('rgbKey packs {r,g,b} into a 24-bit BIG-endian 0xRRGGBB key', () => {
  assert.equal(rgbKey({ r: 0x12, g: 0x34, b: 0x56 }), 0x123456);
  assert.equal(rgbKey({ r: 255, g: 0, b: 0 }), 0xff0000);
  assert.equal(rgbKey({ r: 0, g: 255, b: 0 }), 0x00ff00);
  assert.equal(rgbKey({ r: 0, g: 0, b: 255 }), 0x0000ff);
  // Deliberately DISTINCT byte order from ingest.js's little-endian packRGBA (which
  // also carries alpha in the high byte). Each channel occupies its own byte, so no
  // two distinct opaque colors collide.
  assert.notEqual(rgbKey({ r: 1, g: 0, b: 0 }), rgbKey({ r: 0, g: 1, b: 0 }));
  assert.notEqual(rgbKey({ r: 0, g: 1, b: 0 }), rgbKey({ r: 0, g: 0, b: 1 }));
});

test('distinctColors dedups by 24-bit key in first-seen order', () => {
  // red, red (dup), green, red again → [red, green] in first-seen order.
  const px = [255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 255, 0, 0, 255];
  assert.deepEqual(distinctColors(px), [
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 255, b: 0 },
  ]);
});

test('distinctColors skips ONLY fully transparent (alpha === 0) texels', () => {
  // The scan's threshold is `alpha === 0`, whereas ingestSprite requires
  // `alpha >= 128` to voxelize — so a 1–127-alpha texel enters this palette but
  // would NEVER become a voxel. Both call sites run on hard-pixel (0/255) buffers
  // today so it can't fire, but lock the asymmetry as a deliberate, documented
  // decision: this helper is a color scan, not the ingest gate. Three RGBA texels:
  //   (10,20,30) a=0   → skipped (stray RGB under a clear texel never leaks in)
  //   (40,50,60) a=127 → KEPT here, even though ingest's >=128 would drop it
  //   (70,80,90) a=255 → kept (opaque)
  const px = [10, 20, 30, 0, 40, 50, 60, 127, 70, 80, 90, 255];
  assert.deepEqual(distinctColors(px), [
    { r: 40, g: 50, b: 60 },
    { r: 70, g: 80, b: 90 },
  ]);
});

test('distinctColors on an all-transparent buffer is empty', () => {
  assert.deepEqual(distinctColors([9, 9, 9, 0, 1, 2, 3, 0]), []);
});
