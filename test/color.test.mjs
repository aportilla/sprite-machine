import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hexToRgb, rgbToHex, normalizeHex } from '../src/lib/color.js';

test('rgbToHex is hexToRgb’s inverse, zero-padded and lowercase', () => {
  assert.equal(rgbToHex({ r: 0, g: 0, b: 0 }), '#000000');
  assert.equal(rgbToHex({ r: 255, g: 255, b: 255 }), '#ffffff');
  assert.equal(rgbToHex({ r: 10, g: 20, b: 30 }), '#0a141e');
  // Round-trip in both directions.
  assert.equal(rgbToHex(hexToRgb('#12af03')), '#12af03');
  assert.deepEqual(hexToRgb(rgbToHex({ r: 1, g: 2, b: 3 })), { r: 1, g: 2, b: 3 });
});

test('normalizeHex canonicalizes the accepted hand-typed forms to #rrggbb and rejects the rest (→ null)', () => {
  assert.equal(normalizeHex('#0a141e'), '#0a141e'); // already canonical
  assert.equal(normalizeHex('0A141E'), '#0a141e'); // no hash, uppercase
  assert.equal(normalizeHex('#FFF'), '#ffffff'); // 3-digit shorthand
  assert.equal(normalizeHex('a1b'), '#aa11bb'); // per-digit doubling
  assert.equal(normalizeHex('  #123456  '), '#123456'); // surrounding whitespace
  for (const bad of [
    '', // empty
    '#', // bare hash
    '#12', // wrong lengths
    '#1234',
    '#12345',
    '#1234567',
    '#12g456', // non-hex digit
    '# 12345', // interior whitespace
    'red', // CSS named color
    '##123456', // doubled hash
  ])
    assert.equal(normalizeHex(bad), null, JSON.stringify(bad));
});
