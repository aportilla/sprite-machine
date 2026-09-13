// Browser adapter (sprite-machine/browser): PNG decode and encode over the
// platform's DecompressionStream and CompressionStream, and readSheet over them.
// Nothing here reads a canvas, whose readback privacy browsers perturb. Every
// export is async.

import { isPng } from './png-chunks.js';
import { decodePng as decodeWith } from './png-decode.js';
import { pngScanlines, pngFromZlib } from './png-encode.js';
import { sheetMeta } from './sheet.js';

/**
 * Run bytes through a compression stream and collect its output.
 * @param {CompressionStream | DecompressionStream} stream
 * @param {Uint8Array} bytes
 */
async function through(stream, bytes) {
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  /** @type {Uint8Array[]} */
  const parts = [];
  // The write settles only as the output is read, so both run at once.
  await Promise.all([
    writer.write(bytes).then(() => writer.close()),
    (async () => {
      for (let r = await reader.read(); !r.done; r = await reader.read()) {
        parts.push(r.value);
      }
    })(),
  ]);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Inflate a zlib stream.
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
export const inflate = (bytes) => through(new DecompressionStream('deflate'), bytes);

/**
 * Deflate bytes into a zlib stream.
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
export const deflate = (bytes) => through(new CompressionStream('deflate'), bytes);

/**
 * Decode a PNG to 8-bit RGBA, row 0 on top (the root entry's decodePng over
 * inflate).
 * @param {Uint8Array} bytes
 * @returns {Promise<{width: number, height: number, data: Uint8ClampedArray}>}
 */
export const decodePng = (bytes) => decodeWith(bytes, inflate);

/**
 * Encode an RGBA image as a PNG file, its rows deflated. Row 0 is the top row.
 * @param {{width:number, height:number, data:Uint8Array|Uint8ClampedArray}} img
 * @returns {Promise<Uint8Array>}
 */
export async function encodePng(img) {
  const rows = pngScanlines(img);
  return pngFromZlib(img.width, img.height, await deflate(rows));
}

/**
 * Decode a document PNG, as the Node entry's readSheet does.
 * @param {Uint8Array} bytes
 * @returns {Promise<import('./sheet.js').Sheet>}
 * @throws when the bytes are not a PNG, or do not decode
 */
export async function readSheet(bytes) {
  if (!isPng(bytes)) throw new Error('readSheet: not a PNG.');
  return { image: await decodePng(bytes), ...sheetMeta(bytes) };
}
