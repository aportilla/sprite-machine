import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 as zlibCrc32, deflateRawSync } from 'node:zlib';

import { crc32, zipStore, zipEntries, unzip } from '../src/lib/zip.js';

const bytesOf = (s) => new TextEncoder().encode(s);

/** A one-entry archive framed the way another program's zip is: the bytes
 *  deflated, `method` in both headers. */
function deflatedZip(name, bytes, method = 8) {
  const nameBytes = bytesOf(name);
  const data = new Uint8Array(deflateRawSync(bytes));
  const crc = zlibCrc32(bytes) >>> 0;
  const local = new Uint8Array(30 + nameBytes.length + data.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(8, method, true);
  lv.setUint32(14, crc, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, bytes.length, true);
  lv.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  local.set(data, 30 + nameBytes.length);

  const central = new Uint8Array(46 + nameBytes.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(10, method, true);
  cv.setUint32(16, crc, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, bytes.length, true);
  cv.setUint16(28, nameBytes.length, true);
  cv.setUint32(42, 0, true);
  central.set(nameBytes, 46);

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length, true);

  const out = new Uint8Array(local.length + central.length + end.length);
  out.set(local, 0);
  out.set(central, local.length);
  out.set(end, local.length + central.length);
  return out;
}

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
  // Entries are stored uncompressed, so the archive is the headers plus the bytes.
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
  // The date is stored as DOS time and date, at 2-second resolution.
  assert.equal(v.getUint16(10, true), (12 << 11) | (30 << 5) | (10 >> 1));
  assert.equal(v.getUint16(12, true), ((2026 - 1980) << 9) | (9 << 5) | 7);
  // The same entries and date give the same bytes.
  assert.deepEqual(
    zipStore([{ name: 'a', bytes: png }], { date: new Date(2026, 0, 1) }),
    zipStore([{ name: 'a', bytes: png }], { date: new Date(2026, 0, 1) })
  );
  assert.throws(() => zipStore([{ name: 'naïve.png', bytes: png }]), /ASCII/);
});

test('unzip reads stored and deflated entries, and flags a directory entry', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255]);
  const stored = zipStore([
    { name: 'vehicles/', bytes: new Uint8Array(0) },
    { name: 'vehicles/car.png', bytes: png },
  ]);
  const entries = await unzip(stored);
  assert.deepEqual(
    entries.map((e) => [e.name, e.dir]),
    [
      ['vehicles/', true],
      ['vehicles/car.png', false],
    ]
  );
  assert.equal(entries[0].bytes.length, 0);
  assert.deepEqual(entries[1].bytes, png);

  const text = bytesOf('read me '.repeat(64));
  const [entry] = await unzip(deflatedZip('read-me.txt', text));
  assert.deepEqual(entry.bytes, text, 'a deflated entry inflates to its bytes');
  assert.equal(entry.crc, crc32(text));

  await assert.rejects(() => unzip(deflatedZip('a.txt', text, 99)), /method 99/);
});
