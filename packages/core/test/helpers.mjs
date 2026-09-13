// Sprite builders, mesh probes and PNG fixtures shared by the engine's tests.
import { deflateSync } from 'node:zlib';
import { blitTile, DEFAULT_ATLAS_LAYOUT } from '../src/atlas.js';
import { PNG_SIGNATURE, buildChunk } from '../src/png-chunks.js';

/** Palette letters for the sprite builders. '.' or ' ' in a row is transparent. */
export const C = {
  R: [220, 60, 60], // red
  B: [70, 90, 200], // blue
  G: [80, 190, 90], // green
  T: [169, 220, 214], // teal
  M: [199, 125, 214], // magenta
  N: [201, 184, 120], // tan
};

/** An ImageData-like image from rows of palette letters. Painted texels are opaque. */
export function img(rows, pal = C) {
  const h = rows.length;
  const w = rows[0].length;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch === '.' || ch === ' ') continue; // transparent
      const [r, g, b] = pal[ch];
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** A w×h sprite of one palette letter. */
export const fill = (w, h, ch) => img(Array.from({ length: h }, () => ch.repeat(w)));

/** A 3×2 sheet of t×t tiles with the named views. Missing views are transparent. */
export function sheet(t, tiles) {
  return layeredSheet(t, [tiles]);
}

/** A 3t × 2tN sheet: one 3×2 block of t×t tiles per entry, the first on top. */
export function layeredSheet(t, blocks) {
  const out = {
    width: 3 * t,
    height: 2 * t * blocks.length,
    data: new Uint8ClampedArray(3 * t * 2 * t * blocks.length * 4),
  };
  blocks.forEach((tiles, k) =>
    DEFAULT_ATLAS_LAYOUT.forEach((row, r) =>
      row.forEach((name, c) => {
        if (tiles[name]) blitTile(out, tiles[name], c * t, (2 * k + r) * t);
      })
    )
  );
  return out;
}

/** Counts a geometry's undirected edges used an odd number of times. 0 means watertight. */
export function oddEdges(geometry) {
  const pos = geometry.position;
  const idx = geometry.index ?? null;
  const tris = idx ? idx.length / 3 : pos.length / 9;
  const key = (i) =>
    `${Math.round(pos[i * 3] * 1e4)},${Math.round(pos[i * 3 + 1] * 1e4)},${Math.round(pos[i * 3 + 2] * 1e4)}`;
  const edges = new Map();
  for (let t = 0; t < tris; t++) {
    const [a, b, c] = idx
      ? [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]]
      : [t * 3, t * 3 + 1, t * 3 + 2];
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const ka = key(p),
        kb = key(q);
      const e = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      edges.set(e, (edges.get(e) || 0) + 1);
    }
  }
  let odd = 0;
  for (const n of edges.values()) if (n % 2 === 1) odd++;
  return odd;
}

/** Whether any vertex of tris lies strictly inside a triangle edge (a T-junction). */
export function hasTJunction(tris) {
  const seen = new Set(),
    verts = [];
  for (const t of tris)
    for (const v of [t.a, t.b, t.c]) {
      const k = v.join(',');
      if (!seen.has(k)) seen.add(k), verts.push(v);
    }
  const interior = (p, q, v) => {
    const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const e = [v[0] - p[0], v[1] - p[1], v[2] - p[2]];
    const cx = d[1] * e[2] - d[2] * e[1];
    const cy = d[2] * e[0] - d[0] * e[2];
    const cz = d[0] * e[1] - d[1] * e[0];
    if (cx || cy || cz) return false; // not collinear
    const dot = d[0] * e[0] + d[1] * e[1] + d[2] * e[2];
    const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    return dot > 0 && dot < len2; // strictly between the endpoints
  };
  for (const t of tris)
    for (const [p, q] of [
      [t.a, t.b],
      [t.b, t.c],
      [t.c, t.a],
    ])
      for (const v of verts) if (interior(p, q, v)) return true;
  return false;
}

const SAMPLES_PER_PIXEL = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const ADAM7_PASSES = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

/** The PNG spec's Paeth predictor, as written there. */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * A PNG file written sample by sample, independent of the engine's encoder.
 * `pixel(x, y)` gives a pixel's samples at the bit depth, packed into scan
 * lines per Adam7 pass when `interlace` is 1. Line k of pass p takes filter
 * type `filter(k, p)`; the default varies the type of each pass's first line.
 * `palette` is the PLTE bytes, `trns` the tRNS bytes, and the scan lines are
 * zlib-deflated into one IDAT.
 * @param {{width: number, height: number, bitDepth: number, colorType: number,
 *   interlace?: number, pixel: (x: number, y: number) => number[],
 *   filter?: (k: number, p: number) => number, palette?: number[],
 *   trns?: number[]}} opts
 */
export function pngFile({
  width,
  height,
  bitDepth,
  colorType,
  interlace = 0,
  pixel,
  filter = (k, p) => (k + p + 2) % 5,
  palette,
  trns,
}) {
  const bits = SAMPLES_PER_PIXEL[colorType] * bitDepth;
  const back = Math.max(1, bits >> 3);
  const lines = [];
  const passes = interlace ? ADAM7_PASSES : [[0, 0, 1, 1]];
  for (const [p, [x0, y0, dx, dy]] of passes.entries()) {
    const xs = [];
    for (let x = x0; x < width; x += dx) xs.push(x);
    let prev = null;
    for (let y = y0, k = 0; y < height && xs.length; y += dy, k++) {
      const samples = xs.flatMap((x) => pixel(x, y));
      const line = new Uint8Array(Math.ceil((xs.length * bits) / 8));
      samples.forEach((v, i) => {
        if (bitDepth === 16) {
          line[2 * i] = v >> 8;
          line[2 * i + 1] = v & 0xff;
        } else {
          const at = i * bitDepth;
          line[at >> 3] |= v << (8 - bitDepth - (at & 7));
        }
      });
      const up = prev ?? new Uint8Array(line.length);
      const type = filter(k, p);
      lines.push(type);
      for (let i = 0; i < line.length; i++) {
        const a = i >= back ? line[i - back] : 0;
        const c = i >= back ? up[i - back] : 0;
        const predicted = [0, a, up[i], (a + up[i]) >> 1, paeth(a, up[i], c)][type];
        lines.push((line[i] - predicted) & 0xff);
      }
      prev = line;
    }
  }
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr.set([bitDepth, colorType, 0, 0, interlace], 8);
  const parts = [
    PNG_SIGNATURE,
    buildChunk('IHDR', ihdr),
    ...(palette ? [buildChunk('PLTE', Uint8Array.from(palette))] : []),
    ...(trns ? [buildChunk('tRNS', Uint8Array.from(trns))] : []),
    buildChunk('IDAT', deflateSync(Uint8Array.from(lines))),
    buildChunk('IEND', new Uint8Array(0)),
  ];
  const file = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    file.set(p, at);
    at += p.length;
  }
  return file;
}
