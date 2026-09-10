// ---------------------------------------------------------------------------
// The document format's SHAPE rule, as a pure reading of a picture's
// dimensions: a sprite sheet is a 3×2 atlas of SQUARE tiles — `W = 3·t`,
// `H = 2·t`, `t` a whole number from TILE_MIN to TILE_MAX — the shape every
// editor-authored document has (README §Tile size: tiles are locked square,
// the only registering shape) and the one the catalog takes at a paste
// (docs/clipboard-plan.md §2.5). Deliberately STRICTER than the drop's
// validateSheet (the engine's atlas.js), which checks only that a buffer is
// well-formed and lets deriveTileSize divide whatever it gets: a drop is
// "open this" and the pipeline warns; a paste is "file this", and a file in
// the catalog is a document. Pure, Node-tested; the alert's copy is the
// wire's, never this module's — a `reason` is for the code.
// ---------------------------------------------------------------------------

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
