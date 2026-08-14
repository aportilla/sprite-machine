// Node-runnable tests for the boot-param parser (boot/params.js) — the whole
// dev-hook surface, typed. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseBootParams } from '../src/boot/params.js';
import { PALETTE_256 } from '../src/lib/constants.js';

test('defaults: everything off / null on an empty query', () => {
  const b = parseBootParams('');
  assert.deepEqual(
    {
      flat: b.flat,
      diag: b.diag,
      cam: b.cam,
      lowpoly: b.lowpoly,
      rotate: b.rotate,
      edit: b.edit,
      tile: b.tile,
      palette: b.palette,
      pick: b.pick,
      cursor: b.cursor,
      rect: b.rect,
      fill: b.fill,
      sampleIndex: b.sampleIndex,
    },
    {
      flat: false,
      diag: false,
      cam: null,
      lowpoly: null,
      rotate: null,
      edit: null,
      tile: null,
      palette: false,
      pick: null,
      cursor: null,
      rect: null,
      fill: null,
      sampleIndex: 0,
    }
  );
});

test('scene flags: lowpoly tri-state, rotate=0, flat/diag/cam', () => {
  assert.equal(parseBootParams('?lowpoly=0').lowpoly, false);
  assert.equal(parseBootParams('?lowpoly=1').lowpoly, true);
  assert.equal(parseBootParams('?rotate=0').rotate, false);
  assert.equal(parseBootParams('?rotate=1').rotate, null, 'only rotate=0 is a value');
  const b = parseBootParams('?flat=1&diag=1&cam=fq');
  assert.deepEqual([b.flat, b.diag, b.cam], [true, true, 'fq']);
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
  assert.equal(parseBootParams(`?pick=${PALETTE_256.length}`).pick, null);
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

test('?fill: point + replace/all flags', () => {
  assert.deepEqual(parseBootParams('?fill=5,5').fill, {
    x: 5,
    y: 5,
    replace: false,
    all: false,
  });
  assert.deepEqual(parseBootParams('?fill=5,5,1,1').fill, {
    x: 5,
    y: 5,
    replace: true,
    all: true,
  });
});

test('?sample: name wins over index; bad values clamp to a valid index', () => {
  const names = { sampleNames: ['Car', 'Cube'] };
  assert.equal(parseBootParams('?sample=cube', names).sampleIndex, 1);
  assert.equal(parseBootParams('?sample=1', names).sampleIndex, 1);
  assert.equal(parseBootParams('?sample=99', names).sampleIndex, 1, 'clamped to last');
  assert.equal(parseBootParams('?sample=nope', names).sampleIndex, 0, 'unknown → 0');
});
