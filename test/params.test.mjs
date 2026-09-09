// Node-runnable tests for the boot-param parser (boot/params.js): the boot
// document request, the frozen clock, the sample pick, the flags, and the
// shape of every capture hook. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseBootParams } from '../src/boot/params.js';
import { PALETTE_168 } from '../src/lib/palette.js';
import { RING_DEFAULTS } from '../src/state/ring.js';

test('?file / #fragment: the boot document request', () => {
  assert.equal(parseBootParams('?file=Cube').file, 'Cube');
  assert.equal(parseBootParams('?file=My%20Car').file, 'My Car', 'decoded');
  assert.equal(parseBootParams('', { hash: '#Cube' }).file, 'Cube');
  assert.equal(parseBootParams('', { hash: '#My%20Car' }).file, 'My Car');
  assert.equal(parseBootParams('?file=A', { hash: '#B' }).file, 'A', '?file wins');
  assert.equal(
    parseBootParams('', { hash: '#%E0%A4%A' }).file,
    '%E0%A4%A',
    'a malformed escape reads literally'
  );
  assert.equal(parseBootParams('?file=').file, null, 'empty → null');
  assert.equal(parseBootParams('', { hash: '#' }).file, null);
  assert.equal(parseBootParams('').file, null);
});

test('?now freezes the menu bar clock: ISO date-time or epoch ms, else live', () => {
  const iso = '2026-08-24T19:27';
  assert.equal(parseBootParams(`?now=${iso}`).now, Date.parse(iso));
  assert.equal(parseBootParams('?now=1700000000000').now, 1700000000000);
  assert.equal(parseBootParams('?now=yesterday').now, null, 'unparseable → live');
  assert.equal(parseBootParams('?now=').now, null);
});

test('?sample: a name wins over an index, bad values clamp to a valid one, and its presence is explicit (beats the last-doc boot restore)', () => {
  const names = { sampleNames: ['Car', 'Cube'] };
  assert.equal(parseBootParams('?sample=cube', names).sampleIndex, 1);
  assert.equal(parseBootParams('?sample=1', names).sampleIndex, 1);
  assert.equal(parseBootParams('?sample=99', names).sampleIndex, 1, 'clamped to last');
  assert.equal(parseBootParams('?sample=nope', names).sampleIndex, 0, 'unknown → 0');
  assert.equal(parseBootParams('?sample=cube', names).sampleExplicit, true);
  assert.equal(parseBootParams('', names).sampleExplicit, false);
});

test('the flags: fresh, hide, patterns, about, export, flat, diag, cam', () => {
  const b = parseBootParams(
    '?fresh=1&hide=stage,sprite&patterns=1&about=1&export=1&flat=1&diag=1&cam=fq'
  );
  assert.equal(b.fresh, true);
  assert.deepEqual(b.hide, ['stage', 'sprite']);
  assert.equal(b.patterns, true);
  assert.equal(b.about, true);
  assert.equal(b.exportModel, true);
  assert.equal(b.flat, true);
  assert.equal(b.diag, true);
  assert.equal(b.cam, 'fq');
});

test('the hook shapes: one well-formed and one malformed value each', () => {
  // [query, the fields it lands on]; the ring's defaults fill in from the slice.
  const rows = [
    ['?cursor=5,circle', { cursor: 5, cursorShape: 'circle' }],
    ['?cursor=x', { cursor: null, cursorShape: null }],
    ['?ring=4', { ring: { ...RING_DEFAULTS, views: 4 } }],
    ['?ring=abc', { ring: null }],
    [
      '?rect=3,3,20,14,4,1',
      { rect: { x0: 3, y0: 3, x1: 20, y1: 14, r: 4, square: true } },
    ],
    ['?rect=3,3', { rect: null }],
    ['?fill=5,5,0,1', { fill: { x: 5, y: 5, contiguous: false, allFaces: true } }],
    ['?fill=5', { fill: null }],
    [
      '?select=3,3,20,14,5,-2',
      { select: { x0: 3, y0: 3, x1: 20, y1: 14, dx: 5, dy: -2 } },
    ],
    ['?select=a,b,c,d', { select: null }],
    ['?tile=12x30', { tile: { w: 12, h: 30 } }],
    ['?tile=abc', { tile: null }],
    ['?pick=37', { pick: 37 }],
    [`?pick=${PALETTE_168.length}`, { pick: null }],
    ['?edit=front', { edit: 'front' }],
    ['?edit=sideways', { edit: null }],
  ];
  for (const [query, want] of rows) {
    const b = parseBootParams(query);
    const got = Object.fromEntries(Object.keys(want).map((k) => [k, b[k]]));
    assert.deepEqual(got, want, query);
  }
});
