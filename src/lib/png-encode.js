// ---------------------------------------------------------------------------
// A PNG ENCODER from bytes — 8-bit RGBA, non-interlaced, every row filter 0,
// the pixel stream in a zlib container of STORED deflate blocks (no
// compression) — so an image the app already holds as bytes becomes a file
// without a canvas. File → Export 3D Model… embeds the skin texture this
// way: a privacy browser's canvas farble (the readback perturbation that
// once tripped the wedge gate) never sees it, and the file's texels are the
// skin's, verbatim. Pure, zero deps, Node-tested against node:zlib's own
// inflate. (The document PNGs still go through the canvas codec in
// image-io.js — a document is the canvas's pixels; this is for bytes.)
//
// Stored blocks cost nothing but size: a skin is a few kilobytes (64 × 64 ×
// 4 is sixteen), and the glb it lands in is not a network asset. The zlib
// framing: the two-byte header (CMF 0x78, FLG 0x01 — deflate, a 32K window,
// no dictionary, "fastest" flagged; the pair's check passes), then up to
// 65535 bytes per block behind a five-byte block header (BFINAL on the
// last, BTYPE 00, LEN, then NLEN its one's complement), then the Adler-32
// of the raw stream, big-endian.
// ---------------------------------------------------------------------------

import { PNG_SIGNATURE, buildChunk } from './png-chunks.js';

const BLOCK = 65535;

/** Adler-32 of a byte string — the zlib trailer. @param {Uint8Array} bytes */
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
 * Encode an RGBA image as a PNG file: row 0 the top row, four bytes a texel.
 * @param {{width:number, height:number, data:Uint8Array|Uint8ClampedArray}} img
 * @returns {Uint8Array}
 */
export function encodePng({ width, height, data }) {
  if (!(width > 0 && height > 0) || !data || data.length < width * height * 4) {
    throw new Error(
      `encodePng: expected {width>0, height>0, data.length>=w*h*4}, got ` +
        `${width}×${height} with ${data ? data.length : 'no'} bytes.`
    );
  }
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // the row's filter: none
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width);
  iv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // compression 0, filter 0, interlace 0 — the zeros the array was born with
  const parts = [
    PNG_SIGNATURE,
    buildChunk('IHDR', ihdr),
    buildChunk('IDAT', zlibStored(raw)),
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
