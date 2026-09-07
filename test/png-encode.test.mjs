// The PNG encoder from bytes (lib/png-encode.js): a file node:zlib inflates
// back to the rows it was given, framed as IHDR / IDAT / IEND with valid
// CRCs; the stored zlib stream spans blocks past 65535 bytes with zlib's own
// Adler-32 after the last. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

import { encodePng, zlibStored, adler32 } from '../src/lib/png-encode.js';
import { readChunks, crc32, isPng } from '../src/lib/png-chunks.js';

const noise = (n) => {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 2654435761) >>> 24;
  return out;
};

test('encodePng: the file inflates back to its rows, framed IHDR / IDAT / IEND with valid CRCs', () => {
  const width = 5;
  const height = 3;
  const data = noise(width * height * 4);
  const png = encodePng({ width, height, data });
  assert.ok(isPng(png));
  const chunks = readChunks(png);
  assert.deepEqual(
    chunks.map((c) => c.type),
    ['IHDR', 'IDAT', 'IEND']
  );
  for (const c of chunks) {
    const stored = new DataView(png.buffer, png.byteOffset + c.end - 4).getUint32(0);
    assert.equal(stored, crc32(png.subarray(c.offset + 4, c.end - 4)), `${c.type} CRC`);
  }
  const ihdr = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset);
  assert.deepEqual(
    [ihdr.getUint32(0), ihdr.getUint32(4), ...chunks[0].data.subarray(8)],
    [width, height, 8, 6, 0, 0, 0],
    '8-bit RGBA, no interlace'
  );
  const raw = new Uint8Array(inflateSync(chunks[1].data));
  const stride = width * 4;
  assert.equal(raw.length, (stride + 1) * height);
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (stride + 1)], 0, `row ${y} filter`);
    assert.deepEqual(
      raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
      data.subarray(y * stride, (y + 1) * stride)
    );
  }
  assert.throws(
    () => encodePng({ width: 2, height: 2, data: new Uint8Array(3) }),
    /expected/
  );
});

test('zlibStored: a stream past one block spans several, the last flagged final, with zlib’s Adler-32', () => {
  const raw = noise(70000);
  const z = zlibStored(raw);
  assert.deepEqual(new Uint8Array(inflateSync(z)), raw, 'zlib inflates it');
  assert.equal(z[2], 0, 'the first block is not final');
  assert.equal(z[2 + 5 + 65535], 1, 'the second, last block is final');
  // The check value: Adler-32 of "Wikipedia".
  assert.equal(adler32(new TextEncoder().encode('Wikipedia')), 0x11e60398);
});
