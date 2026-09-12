import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PNG_SIGNATURE,
  isPng,
  crc32,
  readChunks,
  readTextChunks,
  setTextChunks,
} from '../src/png-chunks.js';

// Fixture: a tiny PNG assembled by hand, independent of setTextChunks.

function chunk(type, data) {
  const out = new Uint8Array(8 + data.length + 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function concat(...arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const a of arrays) {
    out.set(a, at);
    at += a.length;
  }
  return out;
}

// 1×1, 8-bit RGBA.
const IHDR = chunk('IHDR', Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0));
const IDAT = chunk('IDAT', Uint8Array.of(1, 2, 3, 4, 5));
const IEND = chunk('IEND', new Uint8Array(0));
// An unknown ancillary chunk between IHDR and IDAT.
const PRIV = chunk('prVt', Uint8Array.of(9, 9, 9));

const BASE = concat(PNG_SIGNATURE, IHDR, PRIV, IDAT, IEND);

const types = (bytes) => readChunks(bytes).map((c) => c.type);

test('crc32 matches the published IEND reference value', () => {
  assert.equal(crc32(new TextEncoder().encode('IEND')), 0xae426082);
});

test('isPng accepts the signature and rejects near-misses', () => {
  assert.equal(isPng(BASE), true);
  assert.equal(isPng(BASE.subarray(1)), false);
  assert.equal(isPng(new Uint8Array(4)), false);
});

test('readChunks walks the list with verbatim offsets', () => {
  const chunks = readChunks(BASE);
  assert.deepEqual(
    chunks.map((c) => c.type),
    ['IHDR', 'prVt', 'IDAT', 'IEND']
  );
  // offset..end spans the whole chunk, so reassembling reproduces the file.
  const rebuilt = concat(
    PNG_SIGNATURE,
    ...chunks.map((c) => BASE.subarray(c.offset, c.end))
  );
  assert.deepEqual(rebuilt, BASE);
  assert.deepEqual(Array.from(chunks[1].data), [9, 9, 9]);
});

test('readChunks throws on a bad signature and on truncation', () => {
  assert.throws(() => readChunks(Uint8Array.of(1, 2, 3)), /signature/);
  assert.throws(() => readChunks(BASE.subarray(0, BASE.length - 2)), /truncated/);
});

test('text chunks round-trip (ASCII → tEXt) and land after IHDR', () => {
  const out = setTextChunks(BASE, {
    Title: 'Cargo Ship',
    Software: 'sprite-machine 0.1.0',
  });
  assert.deepEqual(readTextChunks(out), {
    Title: 'Cargo Ship',
    Software: 'sprite-machine 0.1.0',
  });
  // Text chunks go directly after IHDR, in entry order.
  assert.deepEqual(types(out), ['IHDR', 'tEXt', 'tEXt', 'prVt', 'IDAT', 'IEND']);
});

test('non-Latin-1 text goes to iTXt and still round-trips', () => {
  const title = 'Cargo Ship 🚢 — naïve';
  const out = setTextChunks(BASE, { Title: title });
  assert.deepEqual(readTextChunks(out), { Title: title });
  assert.deepEqual(types(out), ['IHDR', 'iTXt', 'prVt', 'IDAT', 'IEND']);
});

test('setTextChunks replaces an existing keyword instead of duplicating it, switching encodings as the value needs', () => {
  const once = setTextChunks(BASE, { Title: 'First', Software: 'sm' });
  const twice = setTextChunks(once, { Title: 'Second' });
  assert.deepEqual(readTextChunks(twice), { Title: 'Second', Software: 'sm' });
  // One Title chunk, and Software is kept.
  assert.deepEqual(types(twice), ['IHDR', 'tEXt', 'tEXt', 'prVt', 'IDAT', 'IEND']);
  // A replace can switch encodings (tEXt → iTXt and back).
  const a = setTextChunks(BASE, { Title: 'plain' });
  const b = setTextChunks(a, { Title: 'ünïcode ✓' });
  assert.deepEqual(types(b), ['IHDR', 'iTXt', 'prVt', 'IDAT', 'IEND']);
  const c = setTextChunks(b, { Title: 'plain again' });
  assert.deepEqual(readTextChunks(c), { Title: 'plain again' });
  assert.deepEqual(types(c), ['IHDR', 'tEXt', 'prVt', 'IDAT', 'IEND']);
});

test('a null value removes the keyword', () => {
  const withMeta = setTextChunks(BASE, { Title: 'Cargo Ship', Software: 'sm' });
  const out = setTextChunks(withMeta, { Title: null });
  assert.deepEqual(readTextChunks(out), { Software: 'sm' });
});

test('unknown and critical chunks pass through byte-for-byte', () => {
  const out = setTextChunks(BASE, { Title: 'x' });
  const before = readChunks(BASE);
  const after = readChunks(out);
  for (const type of ['IHDR', 'prVt', 'IDAT', 'IEND']) {
    const a = before.find((c) => c.type === type);
    const b = after.find((c) => c.type === type);
    assert.deepEqual(
      BASE.subarray(a.offset, a.end),
      out.subarray(b.offset, b.end),
      `${type} unchanged`
    );
  }
});

test('every written chunk carries a valid CRC', () => {
  const out = setTextChunks(BASE, {
    Title: 'Cargo Ship',
    'sprite-machine:transforms': '{}',
  });
  for (const c of readChunks(out)) {
    const stored = new DataView(out.buffer, out.byteOffset + c.end - 4).getUint32(0);
    assert.equal(stored, crc32(out.subarray(c.offset + 4, c.end - 4)), `${c.type} CRC`);
  }
});

test('setTextChunks throws on an out-of-bounds keyword and on a file with no IHDR to splice after', () => {
  assert.throws(() => setTextChunks(BASE, { '': 'x' }), /keyword/, 'an empty keyword');
  assert.throws(
    () => setTextChunks(BASE, { ['k'.repeat(80)]: 'x' }),
    /keyword/,
    'a keyword past 79'
  );
  const headless = concat(PNG_SIGNATURE, IDAT, IEND);
  assert.throws(() => setTextChunks(headless, { Title: 'x' }), /IHDR/, 'no IHDR');
});
