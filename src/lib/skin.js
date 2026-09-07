// ---------------------------------------------------------------------------
// The skin: the model's color as a TEXTURE, so the mesher can merge on
// occupancy alone (faces.js). Pure — no THREE, no canvas — and Node-tested;
// mesh-util.js turns the bytes into the DataTexture the material samples.
//
// What is in it. A greedy rectangle whose faces are NOT all one color becomes
// a CHART: a w × h block of texels holding those faces' colors verbatim, one
// texel per voxel face, padded by one replicated texel on every side (the
// gutter — a fragment on the rect's edge that rounds to the neighbouring
// texel still reads its own color, and an importer with bilinear filtering
// on gets no bleed). A rectangle whose faces ARE one color — every 1×1, and
// every rect the old color-aware merge already produced whole — gets no
// chart: its triangles point at the SWATCH STRIP, one 1×1 chart per distinct
// color (the palette, plus anything the faces actually hold), sampled at the
// texel's center — one texel read at its middle needs no gutter. A wedge's
// slope and caps are one material by the gate, so they point at a swatch
// too. The skin is therefore only the rectangles the old mesher had to
// split, plus the strip — a fraction of "every exposed face" — and its size
// is bounded by the multi-color rectangles' faces, never by the grid.
//
// Packing is a shelf packer, deterministic (the goldens depend on it): the
// padded charts sorted by height then width, descending, laid left to right
// on shelves, the swatches after them. The width starts at the smallest
// power of two holding the widest padded chart (16 at least) and doubles
// while the packed height, rounded up to a power of two, would exceed it —
// no ceiling (a skin past a device's texture limit is a sprite the carve
// could not have rebuilt live either). Power-of-two sides are not required
// by three or by WebGL2; exporters and older engines are happier with them,
// and it costs nothing here.
//
// Orientation is stated ONCE: a chart's texel (i, j) is the face at tangent
// (a + i, b + j) — i along FACE_GEO[face].A, j along .B, the axes quad()
// spans — and a vertex's UV is the same affine read of its lattice position
// (uvOfLattice). There is no per-face flip table, so nothing can drift; if a
// face ever renders mirrored the bug is in the corner-to-UV read, not the
// bake. The texture's row 0 is v = 0 (DataTexture's flipY is false) — leave
// it there.
//
// Built from bytes: the packed faceColor values are written straight into
// the RGBA array. No 2D canvas, no getImageData, so a privacy browser's
// canvas farble (the Helium bug, wedge-mesh.test.mjs) cannot touch it. Keep
// it that way: no canvas in this file, ever.
// ---------------------------------------------------------------------------

import { FACE_GEO, idxFor } from './faces.js';
import { unpackRGBA } from './ingest.js';
import { AXIS_INDEX, FACE_INDEX } from './views.js';

/**
 * @typedef {{face:string, s:number, a:number, b:number, w:number, h:number,
 *            normal:number[], corners:number[][]}} Rect
 *   faces.js's rectangle: `w × h` voxel faces from tangent (a, b) on slice s.
 * @typedef {{u0:number, v0:number, w:number, h:number}} Chart
 *   a charted rect's texels, in texel coords, the gutter excluded.
 * @typedef {{width:number, height:number, data:Uint8Array,
 *            charts:(Chart|null)[], swatch:Map<number, {u:number, v:number}>}} Skin
 *   charts[i] is rects[i]'s chart — null where the rect is uniform (a swatch);
 *   swatch maps a packed color to its 1×1 chart's texel.
 */

const GUTTER = 1;
const MIN_WIDTH = 16;

const pow2ceil = (n) => {
  let p = 1;
  while (p < n) p *= 2;
  return p;
};

// Lay `items` (each {pw, ph}, padded sizes) on shelves of `width`, left to
// right, a new shelf when the row is full. Every item is narrower than the
// width by construction. Returns the packed height and each item's origin.
function shelfPack(items, width) {
  const at = new Array(items.length);
  let x = 0,
    y = 0,
    shelf = 0;
  items.forEach((it, i) => {
    if (x + it.pw > width) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    at[i] = { x, y };
    x += it.pw;
    if (it.ph > shelf) shelf = it.ph;
  });
  return { height: y + shelf, at };
}

/**
 * Bake the skin for a mesh: a chart per multi-color rect, a swatch per color.
 * @param {Rect[]} rects  the base rectangles (faces.js), in emit order
 * @param {number[]} colors  colors to give a swatch (the build's palette);
 *   every value the faces hold is unioned in, the guard for a relaxed or
 *   dominant color the palette snap left off it
 * @param {Map<number, number>} faceColor  colorize's per-face colors, keyed idx*6 + f
 * @param {{nx:number, ny:number, nz:number}} dims
 * @returns {Skin}
 */
export function bakeSkin(rects, colors, faceColor, dims) {
  // 1. Read every rect's faces once. A rect is uniform when every face's
  // color equals the first; only the others are baked.
  /** @type {{i:number, w:number, h:number, texels:Uint32Array}[]} */
  const bodies = [];
  /** @type {(Chart|null)[]} */
  const charts = new Array(rects.length).fill(null);
  rects.forEach((r, i) => {
    const f = FACE_INDEX[r.face];
    const texels = new Uint32Array(r.w * r.h);
    let uniform = true;
    for (let j = 0; j < r.h; j++)
      for (let k = 0; k < r.w; k++) {
        const c =
          faceColor.get(idxFor(r.face, r.a + k, r.b + j, r.s, dims) * 6 + f) >>> 0;
        texels[j * r.w + k] = c;
        if (c !== texels[0]) uniform = false;
      }
    if (!uniform) bodies.push({ i, w: r.w, h: r.h, texels });
  });

  // 2. The swatch colors: the given palette, then anything the faces hold.
  const seen = new Set();
  /** @type {number[]} */
  const swatchColors = [];
  const addColor = (c) => {
    const k = c >>> 0;
    if (seen.has(k)) return;
    seen.add(k);
    swatchColors.push(k);
  };
  for (const c of colors) addColor(c);
  for (const c of faceColor.values()) addColor(c);

  // 3. Pack: padded charts by height then width, descending (the rect's own
  // order the tiebreak, so the pack is a pure function of the input); the
  // swatches, 1×1 and unpadded, after them.
  /** @type {{pw:number, ph:number, body?:{i:number, w:number, h:number, texels:Uint32Array}, color?:number}[]} */
  const items = bodies.map((body) => ({
    body,
    pw: body.w + 2 * GUTTER,
    ph: body.h + 2 * GUTTER,
  }));
  items.sort((p, q) => q.ph - p.ph || q.pw - p.pw || p.body.i - q.body.i);
  for (const color of swatchColors) items.push({ color, pw: 1, ph: 1 });

  let widest = 1;
  for (const it of items) if (it.pw > widest) widest = it.pw;
  let width = Math.max(MIN_WIDTH, pow2ceil(widest));
  let packed = shelfPack(items, width);
  let height = pow2ceil(packed.height);
  while (height > width) {
    width *= 2;
    packed = shelfPack(items, width);
    height = pow2ceil(packed.height);
  }

  // 4. Bake. Unused texels stay transparent black — nothing samples them.
  const data = new Uint8Array(width * height * 4);
  const put = (x, y, c) => {
    const o = (y * width + x) * 4;
    const { r, g, b } = unpackRGBA(c);
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = 255;
  };
  /** @type {Map<number, {u:number, v:number}>} */
  const swatch = new Map();
  items.forEach((it, n) => {
    const { x, y } = packed.at[n];
    if (it.body) {
      const { i, w, h, texels } = it.body;
      const u0 = x + GUTTER;
      const v0 = y + GUTTER;
      // The body and its gutter in one pass: every texel of the padded box
      // reads the body texel nearest it — an edge texel copies outward, a
      // corner of the gutter fills from the corner texel.
      for (let j = -GUTTER; j < h + GUTTER; j++)
        for (let k = -GUTTER; k < w + GUTTER; k++) {
          const cj = Math.min(h - 1, Math.max(0, j));
          const ck = Math.min(w - 1, Math.max(0, k));
          put(u0 + k, v0 + j, texels[cj * w + ck]);
        }
      charts[i] = { u0, v0, w, h };
    } else {
      put(x, y, it.color);
      swatch.set(it.color, { u: x, v: y });
    }
  });

  return { width, height, data, charts, swatch };
}

/**
 * The texel coordinates of a point on a charted rect's plane: an affine read
 * of its position along the rect's tangent axes, so the rect's corners land
 * on the chart's corners exactly, and a vertex the T-junction repair inserted
 * along an edge lands on the texel line between two faces (the gutter's
 * case). Divide by the skin's width and height for the UV.
 * @param {Chart} chart
 * @param {Rect} rect
 * @param {number[]} p  a point [x, y, z] on the rect's plane, in voxel units
 * @returns {[number, number]}
 */
export function uvOfLattice(chart, rect, p) {
  const g = FACE_GEO[rect.face];
  return [
    chart.u0 + (p[AXIS_INDEX[g.A]] - rect.a),
    chart.v0 + (p[AXIS_INDEX[g.B]] - rect.b),
  ];
}

/**
 * The texel CENTER of a color's swatch, in texel coordinates.
 * @param {Skin} skin
 * @param {number} packed  a packed RGBA color the skin holds a swatch for
 * @returns {[number, number]}
 */
export function swatchUV(skin, packed) {
  const at = skin.swatch.get(packed >>> 0);
  if (!at) throw new Error(`skin: no swatch for color 0x${(packed >>> 0).toString(16)}`);
  return [at.u + 0.5, at.v + 0.5];
}
