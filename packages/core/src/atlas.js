// ---------------------------------------------------------------------------
// Atlas slicing: cut a packed sprite sheet into the six named face tiles.
//
// Pure (operates on {width,height,data}, returns the same shape) so it's
// Node-testable and its output drops straight into buildVoxels(). The tile size
// is derived from the image dimensions and the layout grid unless given
// explicitly: a 3x2 layout on a 120x80 sheet => 40x40 tiles.
// ---------------------------------------------------------------------------

import { VIEW_NAMES, VIEW_IMAGE_AXES } from './views.js';

// Grid of view names (row-major). null = an intentionally empty cell.
export const DEFAULT_ATLAS_LAYOUT = [
  ['left', 'front', 'top'],
  ['right', 'back', 'bottom'],
];

// Allowed tile-dimension range for the in-app resize control (integers). A tile
// maps 1:1 onto a lattice axis, so this is also the voxel grid's per-axis range —
// and the carve/colorize pass is a synchronous O(n³) walk on the main thread. The
// ceiling is 64 (a 64³ = 262 k-voxel grid still rebuilds live per stroke); larger
// tiles (a 256³ = 16.7 M-voxel carve) froze the tab for seconds. clampTile pins
// the app's tile fields into this range.
export const TILE_MIN = 1;
export const TILE_MAX = 64;
export const clampTile = (n) =>
  Math.max(TILE_MIN, Math.min(TILE_MAX, Math.round(Number(n) || 0)));

export function layoutSize(layout) {
  const rows = layout.length;
  const cols = Math.max(...layout.map((r) => r.length));
  return { rows, cols };
}

/**
 * @param {number} width  @param {number} height
 * @param {string[][]} layout
 * @returns {{tileW:number, tileH:number, cols:number, rows:number}}
 */
export function deriveTileSize(width, height, layout = DEFAULT_ATLAS_LAYOUT) {
  const { rows, cols } = layoutSize(layout);
  return { tileW: width / cols, tileH: height / rows, cols, rows };
}

function subTile(img, sx, sy, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((sy + y) * img.width + (sx + x)) * 4;
      const d = (y * w + x) * 4;
      out[d] = img.data[s];
      out[d + 1] = img.data[s + 1];
      out[d + 2] = img.data[s + 2];
      out[d + 3] = img.data[s + 3];
    }
  }
  return { width: w, height: h, data: out };
}

// Is a tile fully transparent? (alpha 0 everywhere — stray RGB under alpha 0 is
// ignored, matching the editor's hard-pixel rule). Exported as the single "is this
// empty?" predicate so main.js's applyTileEdit doesn't roll its own copy.
export const isBlank = (tile) => {
  for (let i = 3; i < tile.data.length; i += 4) if (tile.data[i] !== 0) return false;
  return true;
};

/**
 * The tight bounding box of a tile's non-transparent texels — the same
 * alpha!==0 rule as isBlank, so the two can never disagree about emptiness:
 * contentBounds(t) === null exactly when isBlank(t). The icon generator trims
 * to this box so a sprite fills its icon instead of shipping the tile's
 * transparent margin.
 * @param {{width:number,height:number,data:ArrayLike<number>}} tile
 * @returns {{x:number,y:number,width:number,height:number}|null}
 */
export function contentBounds(tile) {
  const { width: w, height: h, data } = tile;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * Validate an ImageData-like sheet at an ingestion boundary: finite positive
 * dimensions and a data buffer long enough for width*height RGBA texels. Returns
 * an error string (surfaced to the user), or null when the sheet is usable — so
 * sliceAtlas/resizeAtlas downstream can trust their input's shape.
 * @param {{width:number,height:number,data:ArrayLike<number>}|null|undefined} img
 * @returns {string|null}
 */
export function validateSheet(img) {
  if (!img || !Number.isFinite(img.width) || !Number.isFinite(img.height)) {
    return 'Sprite sheet has no valid dimensions.';
  }
  if (!(img.width > 0) || !(img.height > 0)) {
    return `Sprite sheet is empty (${img.width}×${img.height}px).`;
  }
  const need = img.width * img.height * 4;
  if (!img.data || img.data.length < need) {
    return (
      `Sprite sheet data is too short: got ${img.data ? img.data.length : 0} bytes, ` +
      `need ${need} for a ${img.width}×${img.height}px sheet.`
    );
  }
  return null;
}

/**
 * @param {{width:number,height:number,data:ArrayLike<number>}} img
 * @param {{layout?:string[][], tileW?:number, tileH?:number}} [opts]
 * @returns {{views:Record<string,{width,height,data}|null>,
 *            tileW:number, tileH:number, cols:number, rows:number,
 *            warnings:string[]}}
 */
export function sliceAtlas(img, opts = {}) {
  const layout = opts.layout || DEFAULT_ATLAS_LAYOUT;
  const {
    cols,
    rows,
    tileW: autoW,
    tileH: autoH,
  } = deriveTileSize(img.width, img.height, layout);
  const warnings = [];

  // Fill each dimension independently so a lone tileW/tileH override survives.
  const tileW = Math.round(opts.tileW || autoW);
  const tileH = Math.round(opts.tileH || autoH);

  /** @type {Record<string, {width:number,height:number,data:ArrayLike<number>}|null>} */
  const views = {};

  // Bail on a fundamentally unusable sheet rather than emitting garbage tiles.
  if (!(img.width > 0 && img.height > 0) || tileW < 1 || tileH < 1) {
    warnings.push(
      `Atlas is unusable: a ${img.width}×${img.height}px sheet split into ` +
        `${cols}×${rows} gives ${tileW}×${tileH}px tiles. Check the image and tile size.`
    );
    return { views, tileW, tileH, cols, rows, warnings };
  }

  if (cols * tileW !== img.width || rows * tileH !== img.height) {
    warnings.push(
      `Layout ${cols}x${rows} at ${tileW}x${tileH} tiles = ` +
        `${cols * tileW}x${rows * tileH}px, but image is ${img.width}x${img.height}px. ` +
        `Tiles are read from the top-left; check tile size / layout.`
    );
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < (layout[r] || []).length; c++) {
      const name = layout[r][c];
      if (!name) continue;
      if (!VIEW_NAMES.includes(name)) {
        warnings.push(`Unknown view "${name}" in layout; ignored.`);
        continue;
      }
      const sx = c * tileW;
      const sy = r * tileH;
      if (sx + tileW > img.width || sy + tileH > img.height) continue;
      const tile = subTile(img, sx, sy, tileW, tileH);
      views[name] = isBlank(tile) ? null : tile;
    }
  }
  return { views, tileW, tileH, cols, rows, warnings };
}

/**
 * Inverse of subTile: copy a tile's pixels into a sheet at (sx, sy), in place.
 * Mutates `sheet.data` (does NOT change the ImageData identity, so a canonical
 * `state.atlasImage` reference stays valid). Writes only within the tile's rect
 * and clips to the sheet bounds, so remainder pixels of a non-divisible sheet
 * are left untouched.
 * @param {{width:number,height:number,data:Uint8ClampedArray|number[]}} sheet
 * @param {{width:number,height:number,data:ArrayLike<number>}} tile
 * @param {number} sx @param {number} sy
 * @returns {{width:number,height:number,data:Uint8ClampedArray|number[]}}
 */
export function blitTile(sheet, tile, sx, sy) {
  const { width: W, height: H } = sheet;
  const { width: w, height: h, data: td } = tile;
  for (let y = 0; y < h; y++) {
    const dy = sy + y;
    if (dy < 0 || dy >= H) continue;
    for (let x = 0; x < w; x++) {
      const dx = sx + x;
      if (dx < 0 || dx >= W) continue;
      const s = (y * w + x) * 4;
      const d = (dy * W + dx) * 4;
      sheet.data[d] = td[s];
      sheet.data[d + 1] = td[s + 1];
      sheet.data[d + 2] = td[s + 2];
      sheet.data[d + 3] = td[s + 3];
    }
  }
  return sheet;
}

/**
 * Core tile-pixel placement: copy `tile` into a fresh (newW×newH) buffer with its
 * top-left corner at (offX, offY), padding the uncovered cells transparent and
 * clipping anything outside (so a NEGATIVE offset crops that edge). Pure — returns a
 * fresh tile. The general primitive under both corner-anchored `resizeTile` and the
 * centered whole-atlas resize.
 * @param {{width:number,height:number,data:ArrayLike<number>}} tile
 * @param {number} newW @param {number} newH
 * @param {number} offX @param {number} offY
 * @returns {{width:number,height:number,data:Uint8ClampedArray}}
 */
export function resizeTileTo(tile, newW, newH, offX, offY) {
  const { width: w, height: h, data: sd } = tile;
  const out = new Uint8ClampedArray(newW * newH * 4);
  for (let sy = 0; sy < h; sy++) {
    const dy = sy + offY;
    if (dy < 0 || dy >= newH) continue; // clipped when shrinking / negative offset
    for (let sx = 0; sx < w; sx++) {
      const dx = sx + offX;
      if (dx < 0 || dx >= newW) continue;
      const s = (sy * w + sx) * 4;
      const d = (dy * newW + dx) * 4;
      out[d] = sd[s];
      out[d + 1] = sd[s + 1];
      out[d + 2] = sd[s + 2];
      out[d + 3] = sd[s + 3];
    }
  }
  return { width: newW, height: newH, data: out };
}

/**
 * Resize ONE tile's pixels to (newW,newH), anchoring the existing art at a chosen
 * corner and padding the opposite edges with transparency (or cropping them when
 * shrinking). Pure — returns a fresh tile.
 *
 * The anchor is what keeps a resize alignment-safe: a tile is a literal lattice
 * slice, so to hold a texel's world position we must add/remove lattice lines at
 * the FAR end of each axis and leave the anchored end fixed. `anchorRight`/
 * `anchorBottom` pick which image edge stays put (the rest pad/crop). A thin wrapper
 * over resizeTileTo — a corner is just the offset that puts all pad/crop on one end.
 * @param {{width:number,height:number,data:ArrayLike<number>}} tile
 * @param {number} newW @param {number} newH
 * @param {boolean} anchorRight @param {boolean} anchorBottom
 * @returns {{width:number,height:number,data:Uint8ClampedArray}}
 */
export function resizeTile(tile, newW, newH, anchorRight, anchorBottom) {
  const offX = anchorRight ? newW - tile.width : 0; // all pad/crop lands on the far end
  const offY = anchorBottom ? newH - tile.height : 0;
  return resizeTileTo(tile, newW, newH, offX, offY);
}

/**
 * How many lattice lines to add (+) or remove (−) at the world-LOW (origin) end of
 * an axis to keep the art CENTERED as a tile resizes; the rest of the change lands
 * at the far end. The odd leftover of an odd-sized change is biased by the parity of
 * the NEW size, so consecutive ±1 steps alternate which end moves and the art can't
 * drift into a corner over repeated clicks (an even change always splits evenly, and
 * a typed jump divides the difference as evenly as it can).
 *   splitLow(4,5)=1  splitLow(5,6)=0   grow: alternate the extra line
 *   splitLow(4,6)=1                    even grow: one line each end
 *   splitLow(5,4)=0  splitLow(4,3)=−1  shrink: alternate the cropped line
 * @param {number} oldSize @param {number} newSize
 * @returns {number}
 */
export function splitLow(oldSize, newSize) {
  const delta = newSize - oldSize;
  const half = Math.trunc(delta / 2); // even split, toward zero
  const rem = delta - 2 * half; // 0 (even delta) or ±1 (odd delta)
  return half + (rem && newSize % 2 === 1 ? rem : 0);
}

/**
 * Resize the whole 3x2 sheet to new per-tile dimensions. Each cell's tile is placed
 * with an offset derived from its view's image-axis flips (VIEW_IMAGE_AXES) so every
 * face sharing a world axis shifts IDENTICALLY (registration held) — the padding just
 * lands at a different image edge per face.
 *
 * `opts.anchor` picks how the size change is distributed on each axis:
 *   'origin' (default) — keep the origin line fixed, grow/shrink only at the far edge.
 *     A square resize is fully registration-safe AND keeps the object ground-rested
 *     (y=0 pinned) at its exact lattice coords. Used by the pipeline; the primitive's
 *     stable default.
 *   'center' — split the change around the art on ALL axes (see splitLow) so it stays
 *     centered as the tile grows/shrinks. Still registration-safe for a square resize
 *     (the whole solid just TRANSLATES by the per-axis pad), but it no longer pins y=0,
 *     so a ground-rested sprite floats up as the tile grows. This is what the editor's
 *     tile stepper uses (the author asked for centered artwork).
 *
 * A PROPORTIONAL (square, newTileW===newTileH) resize keeps registration for either
 * anchor. An ASYMMETRIC resize (newTileW!==newTileH) intentionally falls OUT of
 * registration — a uniform 3x2 atlas has only two tile dimensions but three lattice
 * axes, and the depth axis nz is the side tile's WIDTH and the top tile's HEIGHT at
 * once, so W!=H gives reconcileDims two disagreeing nz candidates: the carve shears
 * the shared depth axis (dropping voxels) and warns. That trade-off is accepted — the
 * editor lets W and H move independently. Pure — returns a fresh sheet.
 * @param {{width:number,height:number,data:ArrayLike<number>}} img
 * @param {number} newTileW @param {number} newTileH
 * @param {{layout?:string[][], anchor?:'origin'|'center'}} [opts]
 * @returns {{width:number,height:number,data:Uint8ClampedArray}}
 */
export function resizeAtlas(img, newTileW, newTileH, opts = {}) {
  const layout = opts.layout || DEFAULT_ATLAS_LAYOUT;
  const center = opts.anchor === 'center';
  const {
    cols,
    rows,
    tileW: ow,
    tileH: oh,
  } = deriveTileSize(img.width, img.height, layout);
  const oldW = Math.round(ow);
  const oldH = Math.round(oh);
  const dW = newTileW - oldW;
  const dH = newTileH - oldH;
  // Per world axis: how many lattice lines to add/crop at the LOW (origin) end.
  // 'origin' leaves it 0 (all change at the far end); 'center' splits around the art.
  const padLowCol = center ? splitLow(oldW, newTileW) : 0;
  const padLowRow = center ? splitLow(oldH, newTileH) : 0;
  const W = cols * newTileW;
  const H = rows * newTileH;
  const sheet = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < (layout[r] || []).length; c++) {
      const name = layout[r][c];
      if (!name || !VIEW_NAMES.includes(name)) continue;
      const sx = c * oldW;
      const sy = r * oldH;
      if (sx + oldW > img.width || sy + oldH > img.height) continue; // guard a ragged sheet
      const src = subTile(img, sx, sy, oldW, oldH);
      const { colFlip, rowFlip } = VIEW_IMAGE_AXES[name];
      // Map the world-low pad to this face's image corner: a flipped image axis has its
      // low pixel at the world-HIGH end, so it takes the complementary (far) pad. This
      // keeps every face on a shared axis moving together. With 'origin' (padLow=0)
      // this is exactly the old resizeTile(colFlip, rowFlip) corner anchor.
      const offX = colFlip ? dW - padLowCol : padLowCol;
      const offY = rowFlip ? dH - padLowRow : padLowRow;
      const resized = resizeTileTo(src, newTileW, newTileH, offX, offY);
      blitTile(sheet, resized, c * newTileW, r * newTileH);
    }
  }
  return sheet;
}

/**
 * Locate a view's grid cell in the layout without duplicating the layout scan.
 * @param {string} name
 * @param {string[][]} [layout]
 * @returns {{r:number, c:number} | null}
 */
export function cellOf(name, layout = DEFAULT_ATLAS_LAYOUT) {
  for (let r = 0; r < layout.length; r++) {
    for (let c = 0; c < layout[r].length; c++) {
      if (layout[r][c] === name) return { r, c };
    }
  }
  return null;
}
