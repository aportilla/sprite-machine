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
// maps 1:1 onto a lattice axis, so this is also the voxel grid's per-axis range.
export const TILE_MIN = 1;
export const TILE_MAX = 256;
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

const isBlank = (tile) => {
  for (let i = 3; i < tile.data.length; i += 4) if (tile.data[i] !== 0) return false;
  return true;
};

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
 * Resize ONE tile's pixels to (newW,newH), anchoring the existing art at a chosen
 * corner and padding the opposite edges with transparency (or cropping them when
 * shrinking). Pure — returns a fresh tile.
 *
 * The anchor is what keeps a resize alignment-safe: a tile is a literal lattice
 * slice, so to hold a texel's world position we must add/remove lattice lines at
 * the FAR end of each axis and leave the anchored end fixed. `anchorRight`/
 * `anchorBottom` pick which image edge stays put (the rest pad/crop).
 * @param {{width:number,height:number,data:ArrayLike<number>}} tile
 * @param {number} newW @param {number} newH
 * @param {boolean} anchorRight @param {boolean} anchorBottom
 * @returns {{width:number,height:number,data:Uint8ClampedArray}}
 */
export function resizeTile(tile, newW, newH, anchorRight, anchorBottom) {
  const { width: w, height: h, data: sd } = tile;
  const out = new Uint8ClampedArray(newW * newH * 4);
  const offX = anchorRight ? newW - w : 0; // shift source so the anchored edge lines up
  const offY = anchorBottom ? newH - h : 0;
  for (let sy = 0; sy < h; sy++) {
    const dy = sy + offY;
    if (dy < 0 || dy >= newH) continue; // clipped when shrinking
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
 * Resize the whole 3x2 sheet to new per-tile dimensions. Each cell's tile is
 * resized with an anchor derived from its view's image-axis flips
 * (VIEW_IMAGE_AXES): every axis keeps its origin line fixed and grows/shrinks only
 * at the far edge (padding transparent on grow, cropping on shrink), so the object
 * stays ground-rested (y=0 pinned).
 *
 * A PROPORTIONAL (square, newTileW===newTileH) resize is fully registration-safe:
 * a voxel keeps its (x,y,z) and opposite faces never shear. An ASYMMETRIC resize
 * (newTileW!==newTileH) intentionally falls OUT of registration — a uniform 3x2
 * atlas has only two tile dimensions but three lattice axes, and the depth axis nz
 * is the side tile's WIDTH and the top tile's HEIGHT at once, so W!=H gives
 * reconcileDims two disagreeing nz candidates: the carve shears the shared depth
 * axis (dropping voxels) and warns. That trade-off is accepted — the editor lets
 * W and H move independently. Pure — returns a fresh sheet.
 * @param {{width:number,height:number,data:ArrayLike<number>}} img
 * @param {number} newTileW @param {number} newTileH
 * @param {{layout?:string[][]}} [opts]
 * @returns {{width:number,height:number,data:Uint8ClampedArray}}
 */
export function resizeAtlas(img, newTileW, newTileH, opts = {}) {
  const layout = opts.layout || DEFAULT_ATLAS_LAYOUT;
  const {
    cols,
    rows,
    tileW: ow,
    tileH: oh,
  } = deriveTileSize(img.width, img.height, layout);
  const oldW = Math.round(ow);
  const oldH = Math.round(oh);
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
      const resized = resizeTile(src, newTileW, newTileH, colFlip, rowFlip);
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
