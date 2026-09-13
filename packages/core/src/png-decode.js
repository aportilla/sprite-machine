// PNG decoder from bytes: the chunk list, then the zlib stream's scan lines
// unfiltered and expanded to 8-bit RGBA, row 0 on top. Every color type and bit
// depth the spec defines, and Adam7. The inflate is the caller's, so
// zlib.inflateSync and DecompressionStream share one decoder. CRCs are not
// checked.
//
// The expansion matches pngjs: a sample of another depth scales to
// floor(v · 255 / max + 0.5), and a pixel matching the tRNS color key is
// 0, 0, 0, 0.

import { readChunks } from './png-chunks.js';

/** Samples per pixel by color type. */
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
/** The bit depths the spec allows per color type. */
const DEPTHS = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};
/** Adam7 passes: the first column and row, then the column and row steps. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

/**
 * @typedef {{
 *   width: number, height: number, bitDepth: number, colorType: number,
 *   interlace: number, palette: Uint8Array|null, trns: Uint8Array|null,
 *   idat: Uint8Array,
 * }} PngHeader  the IHDR fields, the PLTE and tRNS data, and the IDAT chunks
 *   joined into one zlib stream
 */

/**
 * Read a PNG's header, palette and transparency, and join its IDAT chunks.
 * Throws on a bad signature, a missing IHDR or IDAT, an indexed image with no
 * PLTE, or a header value the spec does not define.
 * @param {Uint8Array} bytes
 * @returns {PngHeader}
 */
export function parsePng(bytes) {
  const chunks = readChunks(bytes);
  const ihdr = chunks[0]?.type === 'IHDR' ? chunks[0].data : null;
  if (!ihdr || ihdr.length < 13) throw new Error('png-decode: no IHDR');
  const dv = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength);
  const width = dv.getUint32(0);
  const height = dv.getUint32(4);
  const [bitDepth, colorType, compression, filter, interlace] = ihdr.subarray(8, 13);
  if (!(width > 0 && height > 0)) {
    throw new Error(`png-decode: ${width}×${height} is not an image size`);
  }
  if (!DEPTHS[colorType]?.includes(bitDepth)) {
    throw new Error(
      `png-decode: color type ${colorType} at bit depth ${bitDepth} is not defined`
    );
  }
  if (compression !== 0) {
    throw new Error(`png-decode: compression method ${compression} is not defined`);
  }
  if (filter !== 0) throw new Error(`png-decode: filter method ${filter} is not defined`);
  if (interlace > 1) {
    throw new Error(`png-decode: interlace method ${interlace} is not defined`);
  }
  const data = (type) => chunks.find((c) => c.type === type)?.data ?? null;
  const palette = data('PLTE');
  if (colorType === 3 && !palette) throw new Error('png-decode: no PLTE');
  const parts = chunks.filter((c) => c.type === 'IDAT').map((c) => c.data);
  if (!parts.length) throw new Error('png-decode: no IDAT');
  let idat = parts[0];
  if (parts.length > 1) {
    idat = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      idat.set(p, at);
      at += p.length;
    }
  }
  return {
    width,
    height,
    bitDepth,
    colorType,
    interlace,
    palette,
    trns: data('tRNS'),
    idat,
  };
}

/**
 * Unfilter a PNG's inflated scan lines and expand them to 8-bit RGBA, row 0 on
 * top. Throws on a stream shorter than its scan lines, an undefined filter
 * type or a palette index past the palette.
 * @param {PngHeader} header
 * @param {Uint8Array} raw  the inflated IDAT stream
 * @returns {{width: number, height: number, data: Uint8ClampedArray}}
 */
export function unfilterPng(header, raw) {
  const { width, height, bitDepth, colorType, interlace } = header;
  const bits = CHANNELS[colorType] * bitDepth;
  // The filters reach back one whole pixel, or one byte below 8 bits.
  const back = Math.max(1, bits >> 3);
  const passes = [];
  let need = 0;
  for (const [x0, y0, dx, dy] of interlace ? ADAM7 : [[0, 0, 1, 1]]) {
    const w = Math.ceil((width - x0) / dx);
    const h = Math.ceil((height - y0) / dy);
    if (w <= 0 || h <= 0) continue; // a pass with no pixels has no scan lines
    const stride = Math.ceil((w * bits) / 8);
    passes.push({ x0, y0, dx, dy, w, h, stride });
    need += (stride + 1) * h;
  }
  if (raw.length < need) {
    throw new Error(`png-decode: ${raw.length} bytes of image data, ${need} needed`);
  }
  const data = new Uint8ClampedArray(width * height * 4);
  const writePixel = pixelWriter(header, data);
  let at = 0;
  for (const { x0, y0, dx, dy, w, h, stride } of passes) {
    let prev = new Uint8Array(stride); // zeros above a pass's first line
    let line = new Uint8Array(stride);
    for (let y = 0; y < h; y++) {
      unfilterLine(raw[at], raw.subarray(at + 1, at + 1 + stride), prev, line, back);
      at += stride + 1;
      const row = (y0 + y * dy) * width;
      for (let x = 0; x < w; x++) writePixel(line, x, (row + x0 + x * dx) * 4);
      const done = prev;
      prev = line;
      line = done;
    }
  }
  return { width, height, data };
}

/**
 * Decode a PNG to 8-bit RGBA, row 0 on top: parsePng, `inflate` over the IDAT
 * stream, then unfilterPng.
 * @param {Uint8Array} bytes
 * @param {(zlib: Uint8Array) => Uint8Array | Promise<Uint8Array>} inflate
 * @returns {Promise<{width: number, height: number, data: Uint8ClampedArray}>}
 */
export async function decodePng(bytes, inflate) {
  const header = parsePng(bytes);
  return unfilterPng(header, await inflate(header.idat));
}

/** Undo one scan line's filter from `src` into `line`. `prev` is the line above. */
function unfilterLine(type, src, prev, line, back) {
  const n = src.length;
  switch (type) {
    case 0:
      line.set(src);
      break;
    case 1:
      for (let i = 0; i < n; i++) line[i] = src[i] + (i >= back ? line[i - back] : 0);
      break;
    case 2:
      for (let i = 0; i < n; i++) line[i] = src[i] + prev[i];
      break;
    case 3:
      for (let i = 0; i < n; i++) {
        line[i] = src[i] + (((i >= back ? line[i - back] : 0) + prev[i]) >> 1);
      }
      break;
    case 4:
      for (let i = 0; i < n; i++) {
        const a = i >= back ? line[i - back] : 0;
        const b = prev[i];
        const c = i >= back ? prev[i - back] : 0;
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        line[i] = src[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      break;
    default:
      throw new Error(`png-decode: filter type ${type} is not defined`);
  }
}

/** A function writing pass column `x` of an unfiltered line as RGBA at `o`. */
function pixelWriter({ bitDepth, colorType, palette, trns }, data) {
  const max = 2 ** bitDepth - 1;
  /** @type {(line: Uint8Array, i: number) => number} sample i of a line */
  const sample =
    bitDepth === 8
      ? (line, i) => line[i]
      : bitDepth === 16
        ? (line, i) => (line[2 * i] << 8) | line[2 * i + 1]
        : (line, i) => {
            const bit = i * bitDepth;
            return (line[bit >> 3] >> (8 - bitDepth - (bit & 7))) & max;
          };
  const scale = bitDepth === 8 ? (v) => v : (v) => Math.floor((v * 255) / max + 0.5);

  if (colorType === 3) {
    const alpha = trns ?? new Uint8Array(0);
    return (line, x, o) => {
      const k = sample(line, x);
      if (3 * k + 2 >= palette.length) {
        throw new Error(`png-decode: palette index ${k} is past the palette`);
      }
      data[o] = palette[3 * k];
      data[o + 1] = palette[3 * k + 1];
      data[o + 2] = palette[3 * k + 2];
      data[o + 3] = k < alpha.length ? alpha[k] : 255;
    };
  }

  // tRNS for gray is one 16-bit sample and for RGB three. A keyed pixel is left
  // at the array's zeros.
  const key = (i) => (trns[2 * i] << 8) | trns[2 * i + 1];
  if (colorType === 0 || colorType === 4) {
    const gray = colorType === 0 && trns?.length >= 2 ? key(0) : -1;
    return (line, x, o) => {
      const i = x * (colorType === 4 ? 2 : 1);
      const v = sample(line, i);
      if (v === gray) return;
      data[o] = data[o + 1] = data[o + 2] = scale(v);
      data[o + 3] = colorType === 4 ? scale(sample(line, i + 1)) : 255;
    };
  }
  const rgb = colorType === 2 && trns?.length >= 6 ? [key(0), key(1), key(2)] : null;
  return (line, x, o) => {
    const i = x * (colorType === 6 ? 4 : 3);
    const r = sample(line, i);
    const g = sample(line, i + 1);
    const b = sample(line, i + 2);
    if (rgb && r === rgb[0] && g === rgb[1] && b === rgb[2]) return;
    data[o] = scale(r);
    data[o + 1] = scale(g);
    data[o + 2] = scale(b);
    data[o + 3] = colorType === 6 ? scale(sample(line, i + 3)) : 255;
  };
}
