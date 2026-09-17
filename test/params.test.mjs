import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseBootParams } from '../src/boot/params.js';

test('?file: the document to open over the restored desktop', () => {
  assert.equal(parseBootParams('?file=Cube').file, 'Cube');
  assert.equal(parseBootParams('?file=My%20Car').file, 'My Car', 'decoded');
  assert.equal(parseBootParams('?file=').file, null, 'empty → null');
  assert.equal(parseBootParams('').file, null);
});
