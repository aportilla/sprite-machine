// PNG encoder from bytes: 8-bit RGBA, non-interlaced, filter 0 on every row.
// pngScanlines is the raw stream, pngFromZlib the file around it once
// compressed, and encodePng their composition over stored deflate blocks. It
// encodes the skin for glb export without a canvas, because privacy browsers
// perturb canvas readback.
//
// zlib framing: the header CMF 0x78, FLG 0x01 (a pair that passes the header
// check), then blocks of up to 65535 bytes, each behind a 5-byte header
// (BFINAL, BTYPE 00, LEN, NLEN = ~LEN), then the Adler-32 of the raw stream,
// big-endian.

import { PNG_SIGNATURE, buildChunk } from './png-chunks.js';

const BLOCK = 65535;

/** Adler-32 checksum, the zlib trailer. @param {Uint8Array} bytes */
export function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** Wrap raw bytes as a zlib stream of stored deflate blocks. @param {Uint8Array} raw */
export function zlibStored(raw) {
  const blocks = Math.max(1, Math.ceil(raw.length / BLOCK));
  const out = new Uint8Array(2 + blocks * 5 + raw.length + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let at = 2;
  for (let i = 0; i < blocks; i++) {
    const start = i * BLOCK;
    const len = Math.min(BLOCK, raw.length - start);
    out[at++] = i === blocks - 1 ? 1 : 0; // BFINAL; BTYPE 00 = stored
    out[at++] = len & 0xff;
    out[at++] = (len >>> 8) & 0xff;
    out[at++] = ~len & 0xff;
    out[at++] = (~len >>> 8) & 0xff;
    out.set(raw.subarray(start, start + len), at);
    at += len;
  }
  new DataView(out.buffer).setUint32(at, adler32(raw)); // big-endian
  return out;
}

/**
 * An RGBA image's scan lines, each led by filter type 0, uncompressed. Row 0
 * is the top row.
 * @param {{width:number, height:number, data:Uint8Array|Uint8ClampedArray}} img
 * @returns {Uint8Array}
 */
export function pngScanlines({ width, height, data }) {
  if (!(width > 0 && height > 0) || !data || data.length < width * height * 4) {
    throw new Error(
      `png-encode: expected {width>0, height>0, data.length>=w*h*4}, got ` +
        `${width}×${height} with ${data ? data.length : 'no'} bytes.`
    );
  }
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return raw;
}

/**
 * A PNG file of 8-bit RGBA rows from their zlib stream: IHDR, one IDAT, IEND.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} zlib  pngScanlines' output, compressed
 * @returns {Uint8Array}
 */
export function pngFromZlib(width, height, zlib) {
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width);
  iv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // compression, filter and interlace stay 0
  const parts = [
    PNG_SIGNATURE,
    buildChunk('IHDR', ihdr),
    buildChunk('IDAT', zlib),
    buildChunk('IEND', new Uint8Array(0)),
  ];
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Encode an RGBA image as a PNG file, its rows in stored deflate blocks. Row 0
 * is the top row.
 * @param {{width:number, height:number, data:Uint8Array|Uint8ClampedArray}} img
 * @returns {Uint8Array}
 */
export function encodePng(img) {
  return pngFromZlib(img.width, img.height, zlibStored(pngScanlines(img)));
}
