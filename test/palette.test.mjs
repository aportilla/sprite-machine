import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PALETTE_168 } from '../src/lib/palette.js';

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
