// Shared stubs for the Node suites — the pieces several files used to carry a
// copy of. Not a test: `node --test test/*.test.mjs` matches *.test.mjs alone,
// so this module is only ever imported.
import { crc32 } from '../src/lib/png-chunks.js';

/** A hand-cranked frame scheduler standing in for requestAnimationFrame: `frame()` runs every pending callback once, `size` counts them. */
export function fakeScheduler() {
  let next = 1;
  const pending = new Map();
  return {
    schedule: (fn) => {
      const id = next++;
      pending.set(id, fn);
      return id;
    },
    cancel: (id) => pending.delete(id),
    frame() {
      const fns = [...pending.values()];
      pending.clear();
      for (const fn of fns) fn();
    },
    get size() {
      return pending.size;
    },
  };
}

/** An in-memory stand-in for storage/db.js — the same async surface over a Map, exposed as `map` for the assertions. */
export function memStorage() {
  const map = new Map();
  return {
    map,
    list: async () => [...map.values()],
    get: async (id) => map.get(id),
    put: async (r) => map.set(r.id, r),
    remove: async (id) => map.delete(id),
  };
}

/** The PNG signature bytes. */
export const SIG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/** One PNG chunk — length, type, data, CRC — as bytes. */
export function chunk(type, data) {
  const out = new Uint8Array(8 + data.length + 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** The codec stub's encoder: wraps an atlas as a minimal synthetic PNG whose IDAT carries the raw pixels + dims, so the slices' real chunk-splicing runs against real chunk structure. */
export async function encodeAtlas(img) {
  const payload = new Uint8Array(8 + img.data.length);
  new DataView(payload.buffer).setUint32(0, img.width);
  new DataView(payload.buffer).setUint32(4, img.height);
  payload.set(img.data, 8);
  const parts = [
    SIG,
    chunk('IHDR', new Uint8Array(13)),
    chunk('IDAT', payload),
    chunk('IEND', new Uint8Array(0)),
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

/** The codec stub's decoder — the exact inverse of encodeAtlas, walking the chunk list for IDAT (its offset moves once text chunks are in). */
export async function decodeAtlas(bytes) {
  let i = SIG.length;
  while (i < bytes.length) {
    const len = new DataView(bytes.buffer, bytes.byteOffset + i).getUint32(0);
    const type = String.fromCharCode(
      bytes[i + 4],
      bytes[i + 5],
      bytes[i + 6],
      bytes[i + 7]
    );
    if (type === 'IDAT') {
      const d = bytes.subarray(i + 8, i + 8 + len);
      const dv = new DataView(d.buffer, d.byteOffset);
      const w = dv.getUint32(0);
      const h = dv.getUint32(4);
      return { width: w, height: h, data: new Uint8ClampedArray(d.subarray(8)) };
    }
    i += 8 + len + 4;
  }
  throw new Error('no IDAT');
}

/** The sprite builders' palette: one letter per color; '.' or ' ' in a row is transparent. */
export const C = {
  R: [220, 60, 60], // red
  B: [70, 90, 200], // blue
  G: [80, 190, 90], // green
  T: [169, 220, 214], // teal
  M: [199, 125, 214], // magenta
  N: [201, 184, 120], // tan
};

/** Rows of palette letters -> an ImageData-like {width, height, data}, every painted texel opaque. */
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

/** Count a THREE mesh's undirected edges used an ODD number of times — a closed (watertight) welded surface uses every edge an even number of times, so 0 means watertight. */
export function oddEdges(mesh) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position.array;
  const idx = geo.index ? geo.index.array : null;
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

/** Whether any vertex of `tris` lies strictly interior to some triangle's edge — a T-junction. */
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
