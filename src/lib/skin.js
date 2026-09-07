// ---------------------------------------------------------------------------
// The skin: the model's color as a TEXTURE, so the mesher can merge on
// occupancy alone (regions.js). Pure — no THREE, no canvas — and Node-tested;
// mesh-util.js turns the bytes into the DataTexture the material samples.
//
// What is in it. A region whose pieces are NOT all one color becomes a
// CHART: the region's bounding box as texels, one per cell, holding its
// pieces' colors verbatim — a face's, or a gable cap's wedge color — padded
// by one texel on every side (the gutter) and with every texel the pieces do
// not cover (the gutter, a hole, the box outside a diagonal edge) filled
// from the NEAREST piece texel, a breadth-first flood from the pieces
// outward: a fragment on the region's edge that rounds to the neighbouring
// texel still reads its own color, and an importer with bilinear filtering
// on gets no bleed. A region of one color — every one-color wall, every
// solid cube's face — gets no chart: its triangles point at the SWATCH
// STRIP, one 1×1 chart per distinct color (the palette, plus anything the
// faces actually hold), sampled at the texel's center — one texel read at
// its middle needs no gutter. A wedge's slope is one material by the gate,
// so it points at a swatch too. The skin is therefore only the regions that
// cross a color, plus the strip — a fraction of "every exposed face" — and
// its size is bounded by the multi-color regions' boxes, never by the grid.
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
// Orientation is stated ONCE: a chart's texel (i, j) is the cell at tangent
// (a + i, b + j) of the region's box — i along FACE_GEO[face].A, j along .B —
// and a vertex's UV is the same affine read of its lattice position
// (uvOfLattice). There is no per-face flip table, so nothing can drift; if a
// face ever renders mirrored the bug is in the corner-to-UV read, not the
// bake. The texture's row 0 is v = 0 (DataTexture's flipY is false) — leave
// it there.
//
// Built from bytes: the packed colors are written straight into the RGBA
// array. No 2D canvas, no getImageData, so a privacy browser's canvas farble
// (the Helium bug, wedge-mesh.test.mjs) cannot touch it. Keep it that way:
// no canvas in this file, ever.
// ---------------------------------------------------------------------------

import { FACE_GEO } from './faces.js';
import { unpackRGBA } from './ingest.js';
import { AXIS_INDEX } from './views.js';

/**
 * @typedef {{u0:number, v0:number, w:number, h:number}} Chart
 *   a charted region's texels, in texel coords, the gutter excluded.
 * @typedef {{width:number, height:number, data:Uint8Array,
 *            charts:(Chart|null)[], swatch:Map<number, {u:number, v:number}>}} Skin
 *   charts[i] is regions[i]'s chart — null where the region is one color (a
 *   swatch); swatch maps a packed color to its 1×1 chart's texel.
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

// The padded box of a region as texel colors: the pieces' own, and every
// other texel — gutter, hole, the box beyond a diagonal — the color of the
// nearest piece texel, a multi-source breadth-first flood (deterministic:
// the pieces seed in row order, the four neighbours in a fixed order).
function floodBox(region) {
  const { w, h, texels, present } = region;
  const W = w + 2 * GUTTER;
  const H = h + 2 * GUTTER;
  const fill = new Uint32Array(W * H);
  const done = new Uint8Array(W * H);
  const queue = [];
  for (let j = 0; j < h; j++)
    for (let k = 0; k < w; k++)
      if (present[j * w + k]) {
        const n = (j + GUTTER) * W + k + GUTTER;
        fill[n] = texels[j * w + k];
        done[n] = 1;
        queue.push(n);
      }
  const STEPS = [1, -1, W, -W];
  for (let qi = 0; qi < queue.length; qi++) {
    const n = queue[qi];
    const x = n % W;
    for (const d of STEPS) {
      if ((d === 1 && x === W - 1) || (d === -1 && x === 0)) continue;
      const m = n + d;
      if (m < 0 || m >= W * H || done[m]) continue;
      fill[m] = fill[n];
      done[m] = 1;
      queue.push(m);
    }
  }
  return { W, H, fill };
}

/**
 * Bake the skin for a mesh: a chart per multi-color region, a swatch per color.
 * @param {import('./regions.js').Region2D[]} regions  the base regions, in emit order
 * @param {number[]} colors  colors to give a swatch (the build's palette);
 *   every value the faces and the regions hold is unioned in, the guard for
 *   a relaxed or dominant color the palette snap left off it
 * @param {Map<number, number>} faceColor  colorize's per-face colors, keyed idx*6 + f
 * @returns {Skin}
 */
export function bakeSkin(regions, colors, faceColor) {
  // 1. The regions that chart: the ones not of one color.
  /** @type {{i:number, region:import('./regions.js').Region2D}[]} */
  const bodies = [];
  /** @type {(Chart|null)[]} */
  const charts = new Array(regions.length).fill(null);
  regions.forEach((region, i) => {
    if (region.uniform === null) bodies.push({ i, region });
  });

  // 2. The swatch colors: the given palette, then anything the faces and the
  // regions' pieces hold (a cap's wedge color rides a region, never a face).
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
  for (const region of regions)
    for (let i = 0; i < region.present.length; i++)
      if (region.present[i]) addColor(region.texels[i]);

  // 3. Pack: padded charts by height then width, descending (the region's own
  // order the tiebreak, so the pack is a pure function of the input); the
  // swatches, 1×1 and unpadded, after them.
  /** @type {{pw:number, ph:number, body?:{i:number, region:import('./regions.js').Region2D}, color?:number}[]} */
  const items = bodies.map((body) => ({
    body,
    pw: body.region.w + 2 * GUTTER,
    ph: body.region.h + 2 * GUTTER,
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
      const { i, region } = it.body;
      const { W, H, fill } = floodBox(region);
      for (let j = 0; j < H; j++)
        for (let k = 0; k < W; k++) put(x + k, y + j, fill[j * W + k]);
      charts[i] = { u0: x + GUTTER, v0: y + GUTTER, w: region.w, h: region.h };
    } else {
      put(x, y, it.color);
      swatch.set(it.color, { u: x, v: y });
    }
  });

  return { width, height, data, charts, swatch };
}

/**
 * The texel coordinates of a point on a charted region's plane: an affine
 * read of its position along the face's tangent axes from the region's box
 * origin, so a box corner lands on the chart's corner exactly, and a vertex
 * the T-junction repair inserted along an edge lands on the texel line
 * between two cells. Divide by the skin's width and height for the UV.
 * @param {Chart} chart
 * @param {{face:string, a:number, b:number}} region
 * @param {number[]} p  a point [x, y, z] on the region's plane, in voxel units
 * @returns {[number, number]}
 */
export function uvOfLattice(chart, region, p) {
  const g = FACE_GEO[region.face];
  return [
    chart.u0 + (p[AXIS_INDEX[g.A]] - region.a),
    chart.v0 + (p[AXIS_INDEX[g.B]] - region.b),
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
