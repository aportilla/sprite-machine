// A document PNG's metadata, as the app reads it: the Title chunk, the
// transforms chunk and the layer names. Shared by the Node and browser entries.

import { readTextChunks } from './png-chunks.js';
import { LAYERS_CHUNK, parseLayersChunk } from './layers.js';

const TRANSFORMS_CHUNK = 'sprite-machine:transforms';

/**
 * @typedef {{
 *   image: {width:number, height:number, data:Uint8ClampedArray},
 *   name: string|null,
 *   transforms: Record<string, {rot?:number, flipX?:boolean, flipY?:boolean}>,
 *   layers: string[]|null,
 *   chunks: Record<string, string>,
 * }} Sheet  the pixels, the Title chunk, the parsed transforms chunk, the layer
 *   names from the sprite-machine:layers chunk, and every text chunk verbatim
 */

/**
 * Every field of a Sheet but the image. A malformed transforms or layers chunk
 * reads as none. Throws when the chunk list does not parse.
 * @param {Uint8Array} bytes
 * @returns {Omit<Sheet, 'image'>}
 */
export function sheetMeta(bytes) {
  const chunks = readTextChunks(bytes);
  /** @type {Sheet['transforms']} */
  let transforms = {};
  if (chunks[TRANSFORMS_CHUNK]) {
    try {
      transforms = JSON.parse(chunks[TRANSFORMS_CHUNK]);
    } catch {
      transforms = {};
    }
  }
  return {
    name: chunks.Title ?? null,
    transforms,
    layers: parseLayersChunk(chunks[LAYERS_CHUNK]),
    chunks,
  };
}
