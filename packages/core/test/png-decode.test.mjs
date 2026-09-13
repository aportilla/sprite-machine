import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { PNG } from 'pngjs';

import { parsePng, unfilterPng, decodePng } from '../src/png-decode.js';
import { encodePng } from '../src/png-encode.js';
import { PNG_SIGNATURE, buildChunk, readChunks } from '../src/png-chunks.js';
import { pngFile } from './helpers.mjs';

/** An RGBA image of gradients over noise, so every filter type has work to do. */
function rgba(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i++) {
    const x = (i >> 2) % width;
    const y = Math.floor((i >> 2) / width);
    data[i] = (x * 29 + y * 13 + (i % 4) * 71 + ((i * 2654435761) >>> 27)) & 0xff;
  }
  return { width, height, data };
}

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const decode = (bytes) => decodePng(bytes, inflateSync);
const pngjsRead = (bytes) =>
  new Uint8ClampedArray(PNG.sync.read(Buffer.from(bytes)).data);

test('decodePng inverts encodePng byte for byte, into a Uint8ClampedArray', async () => {
  const img = rgba(7, 5);
  const back = await decode(encodePng(img));
  assert.equal(back.width, 7);
  assert.equal(back.height, 5);
  assert.ok(back.data instanceof Uint8ClampedArray);
  assert.deepEqual(back.data, img.data);
});

test('a pngjs file decodes to what pngjs reads under each filter type, and an IDAT split across chunks reads as one stream', async () => {
  const img = rgba(33, 21);
  for (const filterType of [0, 1, 2, 3, 4, -1]) {
    const bytes = new Uint8Array(
      PNG.sync.write({ ...img, data: Buffer.from(img.data) }, { filterType })
    );
    const back = await decode(bytes);
    assert.deepEqual(back.data, pngjsRead(bytes), `filterType ${filterType}`);
    assert.deepEqual(back.data, img.data, `filterType ${filterType} is lossless`);
  }
  const whole = new Uint8Array(PNG.sync.write({ ...img, data: Buffer.from(img.data) }));
  const [ihdr, idat, iend] = readChunks(whole);
  const third = Math.ceil(idat.data.length / 3);
  const split = concat(
    PNG_SIGNATURE,
    whole.subarray(ihdr.offset, ihdr.end),
    ...[0, 1, 2].map((k) =>
      buildChunk('IDAT', idat.data.subarray(k * third, (k + 1) * third))
    ),
    whole.subarray(iend.offset, iend.end)
  );
  assert.deepEqual((await decode(split)).data, img.data);
});

test('every color type at every bit depth, with palette alpha and the tRNS color key, plain and Adam7, decodes as pngjs reads it', async () => {
  const of = (d, v) => v % 2 ** d;
  const formats = [
    ...[1, 2, 4, 8, 16].map((d) => ({
      colorType: 0,
      bitDepth: d,
      pixel: (x, y) => [of(d, x * 5 + y * 3 + x * y * 977)],
    })),
    ...[8, 16].map((d) => ({
      colorType: 4,
      bitDepth: d,
      pixel: (x, y) => [of(d, x * 7919 + y), of(d, y * 104729 + x * 31)],
    })),
    ...[8, 16].map((d) => ({
      colorType: 2,
      bitDepth: d,
      pixel: (x, y) => [of(d, x * 251), of(d, y * 509 + x), of(d, x * y * 1021)],
    })),
    ...[8, 16].map((d) => ({
      colorType: 6,
      bitDepth: d,
      pixel: (x, y) => [
        of(d, x * 37),
        of(d, y * 41),
        of(d, x + y * 997),
        of(d, x * y * 7),
      ],
    })),
    ...[1, 2, 4, 8].map((d) => ({
      colorType: 3,
      bitDepth: d,
      palette: Array.from({ length: 3 * 2 ** d }, (_, i) => (i * 37) & 0xff),
      // Alpha for the first half of the entries only.
      trns: Array.from({ length: Math.max(1, 2 ** d / 2) }, (_, i) => (i * 97) & 0xff),
      pixel: (x, y) => [of(d, x + 2 * y + x * y)],
    })),
    {
      colorType: 0,
      bitDepth: 2,
      trns: [0, 1],
      pixel: (x, y) => [of(2, x + y)],
    },
    {
      colorType: 0,
      bitDepth: 16,
      trns: [0x12, 0x34],
      pixel: (x, y) => [(x + y) % 3 ? 0x1234 : of(16, x * 977 + y * 31)],
    },
    {
      colorType: 2,
      bitDepth: 8,
      trns: [0, 10, 0, 20, 0, 30],
      pixel: (x, y) => ((x * y) % 4 ? [10, 20, 30] : [10, 20, of(8, x + y)]),
    },
    {
      colorType: 2,
      bitDepth: 16,
      trns: [1, 0, 2, 0, 3, 0],
      pixel: (x, y) => ((x + y) % 2 ? [0x100, 0x200, 0x300] : [0x100, 0x200, of(16, x)]),
    },
  ];
  const sizes = [
    { width: 13, height: 11, interlace: 0 },
    { width: 13, height: 11, interlace: 1 },
    // Adam7 passes with no pixels have no scan lines.
    { width: 1, height: 1, interlace: 1 },
    { width: 3, height: 2, interlace: 1 },
    { width: 2, height: 5, interlace: 1 },
  ];
  for (const format of formats) {
    for (const size of sizes) {
      const bytes = pngFile({ ...format, ...size });
      const tag = `type ${format.colorType} at ${format.bitDepth} bits, ${JSON.stringify(size)}`;
      assert.deepEqual((await decode(bytes)).data, pngjsRead(bytes), tag);
    }
  }
});

test('samples expand to 8 bits: a low depth scales up, 16 bits round, a keyed pixel is 0, 0, 0, 0 and a palette entry past tRNS is opaque', async () => {
  const pixels = async (opts) => [...(await decode(pngFile(opts))).data];
  assert.deepEqual(
    await pixels({ width: 4, height: 1, bitDepth: 2, colorType: 0, pixel: (x) => [x] }),
    [0, 0, 0, 255, 85, 85, 85, 255, 170, 170, 170, 255, 255, 255, 255, 255]
  );
  // 0x01c0 · 255 / 65535 is 1.74, which rounds to 2; its high byte is 1.
  assert.deepEqual(
    await pixels({
      width: 1,
      height: 1,
      bitDepth: 16,
      colorType: 0,
      pixel: () => [0x01c0],
    }),
    [2, 2, 2, 255]
  );
  assert.deepEqual(
    await pixels({
      width: 2,
      height: 1,
      bitDepth: 8,
      colorType: 2,
      trns: [0, 10, 0, 20, 0, 30],
      pixel: (x) => (x ? [10, 20, 30] : [10, 20, 31]),
    }),
    [10, 20, 31, 255, 0, 0, 0, 0]
  );
  assert.deepEqual(
    await pixels({
      width: 2,
      height: 1,
      bitDepth: 1,
      colorType: 3,
      palette: [1, 2, 3, 4, 5, 6],
      trns: [0x80],
      pixel: (x) => [x],
    }),
    [1, 2, 3, 0x80, 4, 5, 6, 255]
  );
});

test('decoding throws on a non-PNG, an undefined header value, a missing chunk, a short stream, an undefined filter type and a palette index past the palette', async () => {
  const ok = pngFile({
    width: 2,
    height: 2,
    bitDepth: 8,
    colorType: 6,
    pixel: () => [1, 2, 3, 4],
  });
  assert.throws(() => parsePng(Uint8Array.of(1, 2, 3)), /not a PNG/);
  // IHDR's data starts at byte 16. Bit depth, color type, compression, filter
  // and interlace methods are bytes 24 to 28.
  const patched = (at, v) => {
    const b = ok.slice();
    b[at] = v;
    return b;
  };
  assert.throws(() => parsePng(patched(24, 3)), /color type 6 at bit depth 3/);
  assert.throws(() => parsePng(patched(25, 5)), /color type 5/);
  assert.throws(() => parsePng(patched(26, 1)), /compression method 1/);
  assert.throws(() => parsePng(patched(27, 1)), /filter method 1/);
  assert.throws(() => parsePng(patched(28, 2)), /interlace method 2/);

  const [ihdr, , iend] = readChunks(ok);
  const bare = concat(
    PNG_SIGNATURE,
    ok.subarray(ihdr.offset, ihdr.end),
    ok.subarray(iend.offset, iend.end)
  );
  assert.throws(() => parsePng(bare), /no IDAT/);
  assert.throws(
    () => parsePng(concat(PNG_SIGNATURE, ok.subarray(iend.offset))),
    /no IHDR/
  );
  assert.throws(
    () =>
      parsePng(
        pngFile({ width: 1, height: 1, bitDepth: 8, colorType: 3, pixel: () => [0] })
      ),
    /no PLTE/
  );

  const header = parsePng(ok);
  const raw = inflateSync(header.idat);
  assert.throws(() => unfilterPng(header, raw.subarray(0, raw.length - 1)), /needed/);
  await assert.rejects(
    decodePng(ok, (z) => inflateSync(z).subarray(0, 3)),
    /needed/
  );
  assert.throws(
    () => unfilterPng(header, Uint8Array.of(5, ...new Uint8Array(17))),
    /filter type 5/
  );
  await assert.rejects(
    decode(
      pngFile({
        width: 1,
        height: 1,
        bitDepth: 8,
        colorType: 3,
        palette: [0, 0, 0],
        pixel: () => [1],
      })
    ),
    /palette index 1/
  );
});
