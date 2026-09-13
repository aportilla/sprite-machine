// The document shape rule: a 3t × 2tN sheet, N stacked 3×2 atlases of square
// t px tiles, with t from TILE_MIN to TILE_MAX and N from 1 to LAYER_MAX.
// Stricter than the engine's validateSheet. A paste must pass it, and a sheet
// that passes opens as N layers.

import { TILE_MIN, TILE_MAX, LAYER_MAX } from 'sprite-machine';

/**
 * The tile and layer count a `width × height` picture would slice into, or why
 * it can't.
 * @param {number} width @param {number} height
 * @returns {{tile: number, layers: number, reason?: undefined}
 *   | {tile?: undefined, layers?: undefined, reason: string}}
 */
export function sheetShape(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
    return { reason: 'no whole positive dimensions' };
  }
  const tile = w / 3;
  if (!Number.isInteger(tile) || h % (2 * tile) !== 0) {
    return { reason: 'not a 3 × 2 atlas of square tiles' };
  }
  if (tile < TILE_MIN || tile > TILE_MAX) {
    return { reason: `a ${tile}px tile is outside ${TILE_MIN}–${TILE_MAX}` };
  }
  const layers = h / (2 * tile);
  if (layers > LAYER_MAX) {
    return { reason: `${layers} layers is more than ${LAYER_MAX}` };
  }
  return { tile, layers };
}

/** The layer count a sheet opens with: its shape's, or 1 when the shape fails.
 *  @param {number} width @param {number} height */
export const sheetLayers = (width, height) => sheetShape(width, height).layers ?? 1;
