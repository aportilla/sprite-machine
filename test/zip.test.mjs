// Node-runnable tests for the stored-zip primitive (lib/zip.js): the CRC
// against zlib's own, and a write → read round trip that also checks the
// archive's framing. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 as zlibCrc32 } from 'node:zlib';

import { crc32, zipStore, zipEntries } from '../src/lib/zip.js';

const bytesOf = (s) => new TextEncoder().encode(s);

test('crc32 agrees with zlib on the empty string, a short one and a kilobyte of noise', () => {
  const noise = new Uint8Array(1024);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
  for (const b of [
    new Uint8Array(0),
    bytesOf('abc'),
    bytesOf('The quick brown fox'),
    noise,
  ]) {
    assert.equal(crc32(b), zlibCrc32(b) >>> 0);
  }
  assert.equal(crc32(bytesOf('123456789')), 0xcbf43926, 'the check value');
});

test('zipStore → zipEntries round-trips names, bytes and CRCs in order, framed as one stored archive', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255]);
  const json = bytesOf('{"frames":{}}\n');
  const zip = zipStore(
    [
      { name: 'car-atlas.png', bytes: png },
      { name: 'car-atlas.json', bytes: json },
    ],
    { date: new Date(2026, 8, 7, 12, 30, 10) }
  );
  const v = new DataView(zip.buffer);
  assert.equal(v.getUint32(0, true), 0x04034b50, 'a local file header leads');
  assert.equal(
    v.getUint32(zip.length - 22, true),
    0x06054b50,
    'the end record closes, no comment'
  );
  assert.equal(v.getUint16(zip.length - 12, true), 2, 'two entries');
  // stored: every entry's compressed size is its size, and the archive is
  // exactly the headers plus the bytes.
  const overhead = (name) => 30 + name.length + 46 + name.length;
  assert.equal(
    zip.length,
    overhead('car-atlas.png') + overhead('car-atlas.json') + png.length + json.length + 22
  );
  const entries = zipEntries(zip);
  assert.deepEqual(
    entries.map((e) => e.name),
    ['car-atlas.png', 'car-atlas.json']
  );
  assert.deepEqual(entries[0].bytes, png);
  assert.deepEqual(entries[1].bytes, json);
  for (const e of entries) assert.equal(e.crc, crc32(e.bytes));
  // The stamp lands as DOS time/date (2-second resolution).
  assert.equal(v.getUint16(10, true), (12 << 11) | (30 << 5) | (10 >> 1));
  assert.equal(v.getUint16(12, true), ((2026 - 1980) << 9) | (9 << 5) | 7);
  // The same input at the same stamp is the same bytes (a reproducible export).
  assert.deepEqual(
    zipStore([{ name: 'a', bytes: png }], { date: new Date(2026, 0, 1) }),
    zipStore([{ name: 'a', bytes: png }], { date: new Date(2026, 0, 1) })
  );
  assert.throws(() => zipStore([{ name: 'naïve.png', bytes: png }]), /ASCII/);
});
