// Sprite builders and mesh probes shared by the engine's tests.
import { blitTile, DEFAULT_ATLAS_LAYOUT } from '../src/atlas.js';

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
  const out = {
    width: 3 * t,
    height: 2 * t,
    data: new Uint8ClampedArray(3 * t * 2 * t * 4),
  };
  DEFAULT_ATLAS_LAYOUT.forEach((row, r) =>
    row.forEach((name, c) => {
      if (tiles[name]) blitTile(out, tiles[name], c * t, r * t);
    })
  );
  return out;
}

/** Counts a mesh's undirected edges used an odd number of times. 0 means watertight. */
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
