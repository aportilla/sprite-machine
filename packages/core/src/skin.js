// The skin: the model's color as a texture, so the mesher can merge faces on
// occupancy alone (regions.js). mesh-util.js turns the bytes into a
// DataTexture.
//
// A region with more than one color gets a chart: its bounding box at one
// texel per cell, padded by a one-texel gutter. Texels no piece covers (the
// gutter, holes, the box outside a diagonal edge) take the nearest piece's
// color by a breadth-first flood, so edge fragments and bilinear filtering
// read the region's own colors. A one-color region, and every wedge slope,
// samples a 1×1 swatch at its texel center. There is one swatch per color.
//
// Packing: padded charts sorted by height then width, descending, on
// left-to-right shelves, then the swatches. The width starts at the smallest
// power of two that fits the widest chart (at least 16) and doubles while the
// packed height, rounded up to a power of two, exceeds it.
//
// Orientation: chart texel (i, j) is the cell at tangent (a + i, b + j) of the
// region's box, i along FACE_GEO[face].A and j along .B. A vertex's UV is the
// same affine map of its lattice position (uvOfLattice). Texture row 0 is v = 0.
//
// The RGBA bytes are written directly. Do not use a canvas here: privacy
// browsers perturb getImageData.

import { FACE_GEO } from './faces.js';
import { unpackRGBA } from './ingest.js';
import { AXIS_INDEX } from './views.js';

/**
 * @typedef {{u0:number, v0:number, w:number, h:number}} Chart
 *   a chart's texel rect, excluding the gutter.
 * @typedef {{width:number, height:number, data:Uint8Array,
 *            charts:(Chart|null)[], swatch:Map<number, {u:number, v:number}>}} Skin
 *   charts[i] is regions[i]'s chart, or null for a one-color region. swatch
 *   maps a packed color to its texel.
 */

const GUTTER = 1;
const MIN_WIDTH = 16;

const pow2ceil = (n) => {
  let p = 1;
  while (p < n) p *= 2;
  return p;
};

// Pack `items` ({pw, ph}, padded sizes) left to right on shelves of `width`.
// Every item fits the width. Returns the packed height and each item's origin.
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

// A region's padded box as texel colors. Uncovered texels take the nearest
// piece texel's color by a multi-source breadth-first flood. Seeds go in row
// order and neighbors in a fixed order, so the result is deterministic.
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
 *   every color the faces and regions hold is added too
 * @param {Map<number, number>} faceColor  colorize's per-face colors, keyed idx*6 + f
 * @returns {Skin}
 */
export function bakeSkin(regions, colors, faceColor) {
  // 1. Regions with more than one color get a chart.
  /** @type {{i:number, region:import('./regions.js').Region2D}[]} */
  const bodies = [];
  /** @type {(Chart|null)[]} */
  const charts = new Array(regions.length).fill(null);
  regions.forEach((region, i) => {
    if (region.uniform === null) bodies.push({ i, region });
  });

  // 2. Swatch colors: the palette, then every color in the faces and the
  // regions' pieces. A cap's wedge color appears only in a region.
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

  // 3. Pack padded charts by height then width, descending, ties in region
  // order. The 1×1 unpadded swatches follow.
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

  // 4. Bake. Unused texels stay transparent black.
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
 * The texel coordinates of a point on a charted region's plane: its offset
 * along the face's tangent axes from the region's box origin, added to the
 * chart's origin. Divide by the skin's width and height for the UV.
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
 * The texel center of a color's swatch, in texel coordinates.
 * @param {Skin} skin
 * @param {number} packed  a packed RGBA color the skin holds a swatch for
 * @returns {[number, number]}
 */
export function swatchUV(skin, packed) {
  const at = skin.swatch.get(packed >>> 0);
  if (!at) throw new Error(`skin: no swatch for color 0x${(packed >>> 0).toString(16)}`);
  return [at.u + 0.5, at.v + 0.5];
}
