// Node-runnable tests for the editor's 168-color palette (pure, no THREE/DOM).
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PALETTE_168 } from '../src/lib/constants.js';
import { packRGBA } from '../src/lib/ingest.js';

const COLS = 21;
const ROWS = 8;

test('PALETTE_168 is a full 21×8 grid of well-formed named entries', () => {
  assert.equal(PALETTE_168.length, COLS * ROWS, '21×8 grid');
  for (const { css, packed, name } of PALETTE_168) {
    assert.match(css, /^#[0-9a-f]{6}$/, `valid hex: ${css}`);
    const r = parseInt(css.slice(1, 3), 16);
    const g = parseInt(css.slice(3, 5), 16);
    const b = parseInt(css.slice(5, 7), 16);
    assert.equal(packed, packRGBA(r, g, b, 255), `packed derived from css: ${css}`);
    assert.equal(typeof name, 'string');
    assert.ok(name.trim().length > 0, `named: ${css}`);
  }
});

// Every cell is a DISTINCT color under a DISTINCT name — the hover readout
// shows the name as the color's identity, so a repeated name would be two
// swatches claiming to be the same color (and a repeated hex a wasted cell).
test('PALETTE_168 has 168 distinct colors and 168 distinct names', () => {
  const seenCss = new Map();
  const seenName = new Map();
  PALETTE_168.forEach(({ css, name }, i) => {
    const at = (j) => `index ${j} (r${(j / COLS) | 0}c${j % COLS})`;
    if (seenCss.has(css))
      assert.fail(`duplicate swatch ${css} at ${at(seenCss.get(css))} and ${at(i)}`);
    if (seenName.has(name))
      assert.fail(`duplicate name "${name}" at ${at(seenName.get(name))} and ${at(i)}`);
    seenCss.set(css, i);
    seenName.set(name, i);
  });
  assert.equal(seenCss.size, COLS * ROWS, 'all 168 swatches distinct');
});

// The low-poly wedge gate (wedge-mesh.js sameMat) fuses two faces whose colors are
// within TOL2 = 12*12 squared-L2 on RGB. A handful of the palette's same-hue
// neighbors fall inside that gate, so an author CAN place two on a staircase and
// get an unintended wedge. Pin the EXACT within-tolerance set (recomputed here
// against the real palette + the real gate) so the constants.js/README wedge-safety
// note stays honest — any future palette edit that introduces a new near-duplicate
// must update this list, i.e. be consciously accepted. Notably the grayscale ramp
// steps ~10-13/channel, so unlike the previous xterm-256 palette NO gray pair
// merges: every pair below is a same-hue neighbor in the darkest or palest rows.
const WEDGE_TOL2 = 12 * 12; // must track wedge-mesh.js TOL2
test('PALETTE_168 within-wedge-tolerance pairs match the reviewed set', () => {
  const canon = (a, b) => [a, b].sort().join('|');
  const expected = new Set([
    // darkest/dark rows — same-hue value neighbors
    canon('#625700', '#625f00'), // Dark Olive / Olive
    canon('#006865', '#005e67'), // Deep Teal / Petrol
    canon('#009a96', '#00a39c'), // Teal / Persian Green
    // palest row — near-white pastel neighbors
    canon('#ffc9c9', '#ffd2ca'), // Blush / Peach
    canon('#fff2c5', '#fffbc2'), // Vanilla / Cream
    canon('#bef5f9', '#bdefff'), // Ice Blue / Pale Sky
    canon('#c8fdff', '#cef6ff'), // Celeste / Pale Cyan
    canon('#bce4f7', '#badcf1'), // Frost / Glacier
  ]);
  const actual = new Set();
  for (let i = 0; i < PALETTE_168.length; i++) {
    for (let j = i + 1; j < PALETTE_168.length; j++) {
      const a = PALETTE_168[i].rgb;
      const b = PALETTE_168[j].rgb;
      const dr = a.r - b.r;
      const dg = a.g - b.g;
      const db = a.b - b.b;
      if (dr * dr + dg * dg + db * db <= WEDGE_TOL2) {
        actual.add(canon(PALETTE_168[i].css, PALETTE_168[j].css));
      }
    }
  }
  assert.deepEqual(
    [...actual].sort(),
    [...expected].sort(),
    'within-tolerance palette pairs drifted from the reviewed wedge-safety set'
  );
  // Guard the doc claim directly: no gray-on-gray pair is wedge-mergeable —
  // the grayscale ramp's steps all clear the gate.
  const gray = ({ r, g, b }) => r === g && g === b;
  const byCss = new Map(PALETTE_168.map((p) => [p.css, p.rgb]));
  for (const keyPair of actual) {
    const [ca, cb] = keyPair.split('|');
    assert.ok(
      !(gray(byCss.get(ca)) && gray(byCss.get(cb))),
      `gray pair ${keyPair} is wedge-mergeable — the ramp claim drifted`
    );
  }
});

// Pin the layout corners so a transcription/ordering slip is caught: the
// grayscale ramp is row 1 (White and Black up front), the palest hue row
// closes the grid, and each column reads as roughly one hue down the values.
test('PALETTE_168 keeps the intended layout orientation', () => {
  assert.equal(PALETTE_168[0].css, '#ffffff', 'top-left is White');
  assert.equal(PALETTE_168[0].name, 'White');
  assert.equal(PALETTE_168[1].css, '#000000', 'second cell is Black');
  assert.equal(
    PALETTE_168[COLS * ROWS - 1].name,
    'Baby Pink',
    'bottom-right closes the palest row'
  );
  // Row 1 (indices 0..20) is the grayscale ramp — every cell r==g==b.
  for (let i = 0; i < COLS; i++) {
    const { css } = PALETTE_168[i];
    assert.equal(css.slice(1, 3), css.slice(3, 5), `row1 cell ${i} is gray (r==g)`);
    assert.equal(css.slice(3, 5), css.slice(5, 7), `row1 cell ${i} is gray (g==b)`);
  }
});
