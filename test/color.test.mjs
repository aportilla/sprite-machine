// Node-runnable unit tests for src/lib/color.js — the shared color helpers behind
// the editor palette (constants.js) and the Colors dialog's form + name lookup
// (pure, no THREE/DOM). Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hexToRgb, rgbToHex, normalizeHex, rgbKey } from '../src/lib/color.js';

test('hexToRgb parses #rrggbb into byte channels', () => {
  assert.deepEqual(hexToRgb('#000000'), { r: 0, g: 0, b: 0 });
  assert.deepEqual(hexToRgb('#ffffff'), { r: 255, g: 255, b: 255 });
  assert.deepEqual(hexToRgb('#0a141e'), { r: 10, g: 20, b: 30 });
});

test('rgbToHex is hexToRgb’s inverse, zero-padded and lowercase', () => {
  assert.equal(rgbToHex({ r: 0, g: 0, b: 0 }), '#000000');
  assert.equal(rgbToHex({ r: 255, g: 255, b: 255 }), '#ffffff');
  assert.equal(rgbToHex({ r: 10, g: 20, b: 30 }), '#0a141e');
  // Round-trip both ways across a channel-asymmetric color.
  assert.equal(rgbToHex(hexToRgb('#12af03')), '#12af03');
  assert.deepEqual(hexToRgb(rgbToHex({ r: 1, g: 2, b: 3 })), { r: 1, g: 2, b: 3 });
});

test('normalizeHex canonicalizes the accepted hand-typed forms to #rrggbb', () => {
  assert.equal(normalizeHex('#0a141e'), '#0a141e'); // already canonical
  assert.equal(normalizeHex('0A141E'), '#0a141e'); // bare + uppercase
  assert.equal(normalizeHex('#FFF'), '#ffffff'); // 3-digit shorthand expands
  assert.equal(normalizeHex('a1b'), '#aa11bb'); // …per-digit doubling
  assert.equal(normalizeHex('  #123456  '), '#123456'); // surrounding whitespace
});

test('normalizeHex rejects everything that isn’t a hex color (→ null)', () => {
  for (const bad of [
    '', // empty
    '#', // a bare hash
    '#12', // wrong lengths
    '#1234',
    '#12345',
    '#1234567',
    '#12g456', // a non-hex digit
    '# 12345', // interior whitespace
    'red', // CSS named colors are not hex codes
    '##123456', // a doubled hash
  ])
    assert.equal(normalizeHex(bad), null, JSON.stringify(bad));
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
