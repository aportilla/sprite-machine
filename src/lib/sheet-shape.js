// The document shape rule: a 3×2 atlas of square tiles between TILE_MIN and
// TILE_MAX px. Stricter than the engine's validateSheet; a paste must pass it.

import { TILE_MIN, TILE_MAX } from 'sprite-machine';

/**
 * The tile a `width × height` picture would slice into, or why it can't.
 * @param {number} width @param {number} height
 * @returns {{tile: number, reason?: undefined} | {tile?: undefined, reason: string}}
 */
export function sheetShape(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
    return { reason: 'no whole positive dimensions' };
  }
  if (w % 3 !== 0 || h % 2 !== 0 || w / 3 !== h / 2) {
    return { reason: 'not a 3 × 2 atlas of square tiles' };
  }
  const tile = w / 3;
  if (tile < TILE_MIN || tile > TILE_MAX) {
    return { reason: `a ${tile}px tile is outside ${TILE_MIN}–${TILE_MAX}` };
  }
  return { tile };
}
