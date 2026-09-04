// Node-runnable tests for the boot-param parser (boot/params.js) — the whole
// dev-hook surface, typed. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseBootParams } from '../src/boot/params.js';
import { PALETTE_168 } from '../src/lib/constants.js';

test('defaults: everything off / null on an empty query', () => {
  const b = parseBootParams('');
  assert.deepEqual(
    {
      flat: b.flat,
      diag: b.diag,
      cam: b.cam,
      edit: b.edit,
      tile: b.tile,
      palette: b.palette,
      pick: b.pick,
      cursor: b.cursor,
      rect: b.rect,
      fill: b.fill,
      select: b.select,
      sampleIndex: b.sampleIndex,
      sampleExplicit: b.sampleExplicit,
      file: b.file,
      fresh: b.fresh,
      hide: b.hide,
      now: b.now,
      patterns: b.patterns,
      about: b.about,
      ring: b.ring,
    },
    {
      flat: false,
      diag: false,
      cam: null,
      edit: null,
      tile: null,
      palette: false,
      pick: null,
      cursor: null,
      rect: null,
      fill: null,
      select: null,
      sampleIndex: 0,
      sampleExplicit: false,
      file: null,
      fresh: false,
      hide: [],
      now: null,
      patterns: false,
      about: false,
      ring: null,
    }
  );
});

test('?ring: the view count, then optional elevation / offset / size / paper (defaults fill in)', () => {
  assert.deepEqual(parseBootParams('?ring=4').ring, {
    views: 4,
    elevation: 45,
    offset: 0,
    size: 64,
    paper: 'white',
  });
  assert.deepEqual(parseBootParams('?ring=8,30,45,128,gray').ring, {
    views: 8,
    elevation: 30,
    offset: 45,
    size: 128,
    paper: 'gray',
  });
  assert.equal(parseBootParams('?ring=8,30,45,128,black').ring.paper, 'black');
  assert.equal(
    parseBootParams('?ring=8,x').ring.elevation,
    45,
    'a bad field keeps its default'
  );
  assert.equal(parseBootParams('?ring=8,x,90').ring.offset, 90);
  assert.equal(
    parseBootParams('?ring=8,30,45,128,dots').ring.paper,
    'white',
    'the paper is a choice name, not a pattern — an unknown one keeps the default'
  );
  assert.equal(parseBootParams('?ring=8,,,,gray').ring.paper, 'gray', 'the paper alone');
  assert.equal(parseBootParams('?ring=8,,,,gray').ring.size, 64);
  assert.equal(parseBootParams('?ring=0').ring, null, 'fewer than one view is no ring');
  assert.equal(parseBootParams('?ring=').ring, null);
  assert.equal(parseBootParams('?ring=abc').ring, null);
});

test('?patterns=1 opens the Desktop Patterns panel after the boot document', () => {
  assert.equal(parseBootParams('?patterns=1').patterns, true);
  assert.equal(parseBootParams('?patterns=0').patterns, false);
  assert.equal(parseBootParams('?patterns=yes').patterns, false, 'only the documented 1');
});

test('?about=1 opens the About box after the boot document', () => {
  assert.equal(parseBootParams('?about=1').about, true);
  assert.equal(parseBootParams('?about=0').about, false);
  assert.equal(parseBootParams('?about=yes').about, false, 'only the documented 1');
});

test('?now freezes the menu bar clock: ISO date-time or epoch ms, else live', () => {
  const iso = '2026-08-24T19:27';
  assert.equal(parseBootParams(`?now=${iso}`).now, Date.parse(iso));
  assert.equal(parseBootParams('?now=1700000000000').now, 1700000000000);
  assert.equal(parseBootParams('?now=yesterday').now, null, 'unparseable → live');
  assert.equal(parseBootParams('?now=').now, null);
});

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

test('?fresh and ?hide (the desktop-shell capture hooks)', () => {
  assert.equal(parseBootParams('?fresh=1').fresh, true);
  assert.equal(parseBootParams('?fresh=0').fresh, false);
  assert.deepEqual(parseBootParams('?hide=stage').hide, ['stage']);
  assert.deepEqual(parseBootParams('?hide=stage,sprite').hide, ['stage', 'sprite']);
  assert.deepEqual(parseBootParams('?hide=').hide, []);
});

test('?sample marks itself explicit (beats the last-doc boot restore)', () => {
  const names = { sampleNames: ['Car', 'Cube'] };
  assert.equal(parseBootParams('?sample=cube', names).sampleExplicit, true);
  assert.equal(parseBootParams('', names).sampleExplicit, false);
});

test('scene flags: flat/diag/cam (no lowpoly, no rotate — gone with their toggles)', () => {
  const b = parseBootParams('?flat=1&diag=1&cam=fq&lowpoly=0&rotate=0');
  assert.deepEqual([b.flat, b.diag, b.cam], [true, true, 'fq']);
  assert.equal('lowpoly' in b, false);
  assert.equal('rotate' in b, false);
});

test('?edit validates against the face vocabulary', () => {
  assert.equal(parseBootParams('?edit=front').edit, 'front');
  assert.equal(parseBootParams('?edit=sideways').edit, null);
});

test('?tile: square, WxH, and clamping to the tile bounds', () => {
  assert.deepEqual(parseBootParams('?tile=24').tile, { w: 24, h: 24 });
  assert.deepEqual(parseBootParams('?tile=12x30').tile, { w: 12, h: 30 });
  assert.deepEqual(parseBootParams('?tile=999').tile, { w: 64, h: 64 });
  assert.equal(parseBootParams('?tile=abc').tile, null);
});

test('?pick bounds-checks the palette index', () => {
  assert.equal(parseBootParams('?pick=37').pick, 37);
  assert.equal(parseBootParams(`?pick=${PALETTE_168.length}`).pick, null);
  assert.equal(parseBootParams('?pick=-1').pick, null);
});

test('?rect: box + optional radius + square-lock flag', () => {
  assert.deepEqual(parseBootParams('?rect=3,3,20,14').rect, {
    x0: 3,
    y0: 3,
    x1: 20,
    y1: 14,
    r: 0,
    square: false,
  });
  assert.deepEqual(parseBootParams('?rect=3,3,20,14,4,1').rect, {
    x0: 3,
    y0: 3,
    x1: 20,
    y1: 14,
    r: 4,
    square: true,
  });
  assert.equal(parseBootParams('?rect=3,3').rect, null);
});

test('?fill: point + contiguous/all-faces flags (contiguous defaults ON)', () => {
  assert.deepEqual(parseBootParams('?fill=5,5').fill, {
    x: 5,
    y: 5,
    contiguous: true,
    allFaces: false,
  });
  assert.deepEqual(parseBootParams('?fill=5,5,0,1').fill, {
    x: 5,
    y: 5,
    contiguous: false,
    allFaces: true,
  });
});

test('?select: box + optional float offset (defaults 0,0); fewer than four ints → null', () => {
  assert.deepEqual(parseBootParams('?select=3,3,20,14').select, {
    x0: 3,
    y0: 3,
    x1: 20,
    y1: 14,
    dx: 0,
    dy: 0,
  });
  assert.deepEqual(parseBootParams('?select=3,3,20,14,5,-2').select, {
    x0: 3,
    y0: 3,
    x1: 20,
    y1: 14,
    dx: 5,
    dy: -2,
  });
  assert.equal(parseBootParams('?select=3,3,20,14,6').select.dx, 6, 'dx alone');
  assert.equal(parseBootParams('?select=3,3,20,14,6').select.dy, 0);
  assert.equal(parseBootParams('?select=3,3').select, null);
  assert.equal(parseBootParams('?select=a,b,c,d').select, null);
});

test('?sample: name wins over index; bad values clamp to a valid index', () => {
  const names = { sampleNames: ['Car', 'Cube'] };
  assert.equal(parseBootParams('?sample=cube', names).sampleIndex, 1);
  assert.equal(parseBootParams('?sample=1', names).sampleIndex, 1);
  assert.equal(parseBootParams('?sample=99', names).sampleIndex, 1, 'clamped to last');
  assert.equal(parseBootParams('?sample=nope', names).sampleIndex, 0, 'unknown → 0');
});
