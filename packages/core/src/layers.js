// The sprite-machine:layers chunk: a document PNG's layer names in block order.
// Its length is the layer count.

import { DEFAULT_ATLAS_LAYOUT, LAYER_MAX, layoutSize } from './atlas.js';

/** PNG text chunk keyword. */
export const LAYERS_CHUNK = 'sprite-machine:layers';

/**
 * The chunk's text, `{"layers":[{"name":"Layer 1"}]}` for one layer.
 * @param {string[]} names  one per block, in block order
 * @returns {string}
 */
export function layersChunk(names) {
  return JSON.stringify({ layers: names.map((name) => ({ name })) });
}

/**
 * The names in a chunk's text. Null for a missing or malformed chunk, or one
 * naming no layers or more than LAYER_MAX.
 * @param {string|null|undefined} text
 * @returns {string[]|null}
 */
export function parseLayersChunk(text) {
  if (!text) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const list = parsed?.layers;
  if (!Array.isArray(list) || list.length < 1 || list.length > LAYER_MAX) return null;
  const names = [];
  for (const entry of list) {
    if (typeof entry?.name !== 'string') return null;
    names.push(entry.name);
  }
  return names;
}

/**
 * The layer count of a sheet `height` px tall whose chunk holds `names`: their
 * count when it divides the height into whole blocks, else null.
 * @param {number} height
 * @param {string[]|null|undefined} names
 * @returns {number|null}
 */
export function layerCount(height, names) {
  const n = names?.length ?? 0;
  const { rows } = layoutSize(DEFAULT_ATLAS_LAYOUT);
  return n > 0 && Number.isInteger(height) && height > 0 && height % (rows * n) === 0
    ? n
    : null;
}
