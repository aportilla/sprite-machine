import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PALETTE_168, documentColors } from '../src/lib/palette.js';

const COLS = 21;
const ROWS = 8;

// The hover readout identifies a swatch by name, so names must be unique too.
test('PALETTE_168 is a full 21×8 grid of well-formed named entries, every color and every name distinct', () => {
  assert.equal(PALETTE_168.length, COLS * ROWS, '21×8 grid');
  const seenCss = new Map();
  const seenName = new Map();
  const at = (j) => `index ${j} (r${(j / COLS) | 0}c${j % COLS})`;
  PALETTE_168.forEach(({ css, name }, i) => {
    assert.match(css, /^#[0-9a-f]{6}$/, `valid hex: ${css}`);
    assert.equal(typeof name, 'string');
    assert.ok(name.trim().length > 0, `named: ${css}`);
    if (seenCss.has(css))
      assert.fail(`duplicate swatch ${css} at ${at(seenCss.get(css))} and ${at(i)}`);
    if (seenName.has(name))
      assert.fail(`duplicate name "${name}" at ${at(seenName.get(name))} and ${at(i)}`);
    seenCss.set(css, i);
    seenName.set(name, i);
  });
  assert.equal(seenCss.size, COLS * ROWS, 'all 168 swatches distinct');
  assert.equal(seenName.size, COLS * ROWS, 'all 168 names distinct');
});

/** A one-row RGBA sheet of [r, g, b, a] texels. */
const sheetOf = (texels) => ({
  width: texels.length,
  height: 1,
  data: Uint8ClampedArray.from(texels.flat()),
});
const rgbOf = ({ r, g, b }) => [r, g, b];

test('documentColors: each color with alpha above 0 once, grays first by lightness, then by hue with lightness inside a hue', () => {
  const [black, gray, white] = [
    [0, 0, 0],
    [128, 128, 128],
    [255, 255, 255],
  ];
  const [darkRed, red, orange, blue] = [
    [120, 0, 0],
    [255, 0, 0],
    [255, 128, 0],
    [0, 0, 255],
  ];
  const opaque = (c) => [...c, 255];
  const colors = documentColors(
    sheetOf([
      opaque(red),
      [9, 9, 9, 0],
      opaque(white),
      opaque(blue),
      opaque(red),
      opaque(black),
      [0, 0, 0, 0],
      opaque(orange),
      opaque(gray),
      opaque(darkRed),
      [255, 0, 0, 1],
    ])
  );
  assert.deepEqual(colors.map(rgbOf), [black, gray, white, darkRed, red, orange, blue]);
});

test('documentColors: the order depends on the set alone, and max keeps the front of it', () => {
  const texels = Array.from({ length: 40 }, (_, i) => [
    (i * 67) & 255,
    (i * 131) & 255,
    (i * 29) & 255,
    255,
  ]);
  const colors = documentColors(sheetOf(texels));
  assert.equal(colors.length, texels.length);
  const shuffled = [...texels].reverse().concat(texels.slice(0, 7));
  assert.deepEqual(documentColors(sheetOf(shuffled)), colors);
  assert.deepEqual(documentColors(sheetOf(texels), 5), colors.slice(0, 5));
});
