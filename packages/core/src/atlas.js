// Atlas slicing and resizing on ImageData-like {width, height, data} sheets.
// Unless given, the tile size derives from the sheet and the layout: a 3x2 layout
// on a 120x80 sheet gives 40x40 tiles. A layered sheet stacks blocks of the
// layout one under another, every block at the same tile size.

import { VIEW_NAMES, VIEW_IMAGE_AXES } from './views.js';

// View names by row. null marks an empty cell.
export const DEFAULT_ATLAS_LAYOUT = [
  ['left', 'front', 'top'],
  ['right', 'back', 'bottom'],
];

// Tile side range, in px. A tile side is also a voxel grid axis, and the carve is
// a synchronous O(n³) pass. At 64 a rebuild per stroke stays fast.
export const TILE_MIN = 1;
export const TILE_MAX = 64;
export const clampTile = (n) =>
  Math.max(TILE_MIN, Math.min(TILE_MAX, Math.round(Number(n) || 0)));

// The most layers a document stacks. Every layer is carved on its own, so a
// full rebuild is up to this many carves.
export const LAYER_MAX = 8;

// A `layers` option as a whole count of at least 1.
const layerOption = (n) => Math.max(1, Math.floor(Number(n) || 1));

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

// True when every texel has alpha 0.
export const isBlank = (tile) => {
  for (let i = 3; i < tile.data.length; i += 4) if (tile.data[i] !== 0) return false;
  return true;
};

/**
 * The tight bounding box of a tile's texels with alpha !== 0. Null exactly when
 * isBlank(tile).
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
 * Validate an ImageData-like sheet: finite positive dimensions and at least
 * width*height*4 bytes of data. Returns a user-facing error, or null when usable.
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

/** @typedef {Record<string, {width:number,height:number,data:Uint8ClampedArray}|null>} Views */

// Slice `count` stacked blocks of the layout at tileW × tileH. Block k's cell
// (r, c) starts at column c·tileW and row (rows·k + r)·tileH. A cell past the
// sheet's edge is left out, and a blank tile slices to null.
function sliceBlocks(img, layout, count, tileW, tileH) {
  const { cols, rows } = layoutSize(layout);
  const gridRows = rows * count;
  const warnings = [];
  /** @type {Views[]} */
  const blocks = Array.from({ length: count }, () => ({}));

  if (!(img.width > 0 && img.height > 0) || tileW < 1 || tileH < 1) {
    warnings.push(
      `Atlas is unusable: a ${img.width}×${img.height}px sheet split into ` +
        `${cols}×${gridRows} gives ${tileW}×${tileH}px tiles. Check the image and tile size.`
    );
    return { blocks, cols, rows, warnings };
  }

  if (cols * tileW !== img.width || gridRows * tileH !== img.height) {
    warnings.push(
      `Layout ${cols}x${gridRows} at ${tileW}x${tileH} tiles = ` +
        `${cols * tileW}x${gridRows * tileH}px, but image is ${img.width}x${img.height}px. ` +
        `Tiles are read from the top-left; check tile size / layout.`
    );
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < (layout[r] || []).length; c++) {
      const name = layout[r][c];
      if (name && !VIEW_NAMES.includes(name)) {
        warnings.push(`Unknown view "${name}" in layout; ignored.`);
      }
    }
  }

  blocks.forEach((views, k) => {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < (layout[r] || []).length; c++) {
        const name = layout[r][c];
        if (!name || !VIEW_NAMES.includes(name)) continue;
        const sx = c * tileW;
        const sy = (rows * k + r) * tileH;
        if (sx + tileW > img.width || sy + tileH > img.height) continue;
        const tile = subTile(img, sx, sy, tileW, tileH);
        views[name] = isBlank(tile) ? null : tile;
      }
    }
  });
  return { blocks, cols, rows, warnings };
}

/**
 * @param {{width:number,height:number,data:ArrayLike<number>}} img
 * @param {{layout?:string[][], tileW?:number, tileH?:number}} [opts]
 * @returns {{views:Views, tileW:number, tileH:number, cols:number, rows:number,
 *            warnings:string[]}}
 */
export function sliceAtlas(img, opts = {}) {
  const layout = opts.layout || DEFAULT_ATLAS_LAYOUT;
  const auto = deriveTileSize(img.width, img.height, layout);
  const tileW = Math.round(opts.tileW || auto.tileW);
  const tileH = Math.round(opts.tileH || auto.tileH);
  const { blocks, cols, rows, warnings } = sliceBlocks(img, layout, 1, tileW, tileH);
  return { views: blocks[0], tileW, tileH, cols, rows, warnings };
}

/**
 * Slice a layered sheet into one views record per block. The tile is the width
 * over the layout's columns and the height over its rows times `layers`. With
 * one layer this is sliceAtlas.
 * @param {{width:number,height:number,data:ArrayLike<number>}} img
 * @param {{layers?:number, layout?:string[][]}} [opts]
 * @returns {{layers:Views[], tileW:number, tileH:number, cols:number, rows:number,
 *            warnings:string[]}}  rows is the layout's, not the sheet's
 */
export function sliceLayers(img, opts = {}) {
  const layout = opts.layout || DEFAULT_ATLAS_LAYOUT;
  const count = layerOption(opts.layers);
  const { cols, rows } = layoutSize(layout);
  const tileW = Math.round(img.width / cols);
  const tileH = Math.round(img.height / (rows * count));
  const { blocks, warnings } = sliceBlocks(img, layout, count, tileW, tileH);
  return { layers: blocks, tileW, tileH, cols, rows, warnings };
}

/**
 * Copy a tile's pixels into sheet.data at (sx, sy), clipped to the sheet. Mutates
 * sheet.data in place and returns the same sheet object.
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
 * Copy a tile into a new newW × newH tile with its top-left at (offX, offY).
 * Uncovered texels are transparent and texels outside are clipped, so a negative
 * offset crops that edge.
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
    if (dy < 0 || dy >= newH) continue;
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
 * Resize a tile to newW × newH with the art held at one corner, picked by
 * anchorRight and anchorBottom. The opposite edges pad transparent or crop.
 * @param {{width:number,height:number,data:ArrayLike<number>}} tile
 * @param {number} newW @param {number} newH
 * @param {boolean} anchorRight @param {boolean} anchorBottom
 * @returns {{width:number,height:number,data:Uint8ClampedArray}}
 */
export function resizeTile(tile, newW, newH, anchorRight, anchorBottom) {
  const offX = anchorRight ? newW - tile.width : 0;
  const offY = anchorBottom ? newH - tile.height : 0;
  return resizeTileTo(tile, newW, newH, offX, offY);
}

/**
 * Lattice lines to add (+) or remove (−) at the low (origin) end of an axis to keep
 * the art centered as a tile resizes. The rest of the change goes to the far end.
 * The extra line of an odd change follows the parity of the new size, so repeated
 * ±1 steps alternate ends and the art does not drift.
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
 * Resize a sheet to new tile dimensions. Each tile's offset follows its view's
 * image-axis flips (VIEW_IMAGE_AXES), so faces that share a world axis shift
 * together.
 *
 * opts.anchor sets where the change goes on each axis:
 *   'origin' (default): the origin line stays fixed and the far edge moves, so y=0
 *     stays put.
 *   'center': the change splits around the art (splitLow). The model translates,
 *     so a sprite resting on y=0 lifts off it as the tile grows.
 *
 * A square resize keeps registration with either anchor. When newTileW !== newTileH
 * the depth axis nz gets two sizes (the side tile's width and the top tile's
 * height), so the carve drops voxels and warns.
 *
 * opts.layers reads the sheet as that many stacked blocks and resizes each one
 * the same way. Without it the sheet is one block.
 * @param {{width:number,height:number,data:ArrayLike<number>}} img
 * @param {number} newTileW @param {number} newTileH
 * @param {{layout?:string[][], anchor?:'origin'|'center', layers?:number}} [opts]
 * @returns {{width:number,height:number,data:Uint8ClampedArray}}
 */
export function resizeAtlas(img, newTileW, newTileH, opts = {}) {
  const layout = opts.layout || DEFAULT_ATLAS_LAYOUT;
  const center = opts.anchor === 'center';
  const count = layerOption(opts.layers);
  const { cols, rows } = layoutSize(layout);
  const oldW = Math.round(img.width / cols);
  const oldH = Math.round(img.height / (rows * count));
  const dW = newTileW - oldW;
  const dH = newTileH - oldH;
  // Lattice lines to add or crop at each world axis's low end.
  const padLowCol = center ? splitLow(oldW, newTileW) : 0;
  const padLowRow = center ? splitLow(oldH, newTileH) : 0;
  const W = cols * newTileW;
  const H = rows * count * newTileH;
  const sheet = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  for (let k = 0; k < count; k++) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < (layout[r] || []).length; c++) {
        const name = layout[r][c];
        if (!name || !VIEW_NAMES.includes(name)) continue;
        const sx = c * oldW;
        const sy = (rows * k + r) * oldH;
        if (sx + oldW > img.width || sy + oldH > img.height) continue; // ragged sheet
        const src = subTile(img, sx, sy, oldW, oldH);
        const { colFlip, rowFlip } = VIEW_IMAGE_AXES[name];
        // A flipped image axis has its low pixel at the world-high end, so it
        // takes the far pad.
        const offX = colFlip ? dW - padLowCol : padLowCol;
        const offY = rowFlip ? dH - padLowRow : padLowRow;
        const resized = resizeTileTo(src, newTileW, newTileH, offX, offY);
        blitTile(sheet, resized, c * newTileW, (rows * k + r) * newTileH);
      }
    }
  }
  return sheet;
}

/**
 * A view's cell in the layout, or null.
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
