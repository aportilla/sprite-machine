// Node-runnable test for the boot-param parser (boot/params.js): the boot
// document request, the one user-facing param. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseBootParams } from '../src/boot/params.js';

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
