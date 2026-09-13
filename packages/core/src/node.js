// Node adapter (sprite-machine/node): decodes a document PNG to RGBA pixels
// and its metadata, or straight to a glb. The only PNG decoder in the engine
// (pngjs). Text chunks are read best-effort: a malformed chunk list loses the
// name, transforms and layer names but not the pixels.

import { PNG } from 'pngjs';
import { isPng, readTextChunks } from './png-chunks.js';
import { LAYERS_CHUNK, parseLayersChunk, layerCount } from './layers.js';
import { buildModel, modelToGlb } from './model.js';

const TRANSFORMS_CHUNK = 'sprite-machine:transforms';

/**
 * Decode a document PNG.
 * @param {Uint8Array} bytes
 * @returns {{
 *   image: {width:number, height:number, data:Uint8ClampedArray},
 *   name: string|null,
 *   transforms: Record<string, {rot?:number, flipX?:boolean, flipY?:boolean}>,
 *   layers: string[]|null,
 *   chunks: Record<string, string>,
 * }}  the pixels, the Title chunk, the parsed transforms chunk, the layer
 *   names from the sprite-machine:layers chunk, and every text chunk verbatim
 * @throws when the bytes are not a PNG, or pngjs cannot decode them
 */
export function readSheet(bytes) {
  if (!isPng(bytes)) throw new Error('readSheet: not a PNG.');
  const png = PNG.sync.read(
    Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  );
  const image = {
    width: png.width,
    height: png.height,
    data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length),
  };
  /** @type {Record<string, string>} */
  let chunks = {};
  try {
    chunks = readTextChunks(bytes);
  } catch {
    chunks = {};
  }
  /** @type {Record<string, {rot?:number, flipX?:boolean, flipY?:boolean}>} */
  let transforms = {};
  if (chunks[TRANSFORMS_CHUNK]) {
    try {
      transforms = JSON.parse(chunks[TRANSFORMS_CHUNK]);
    } catch {
      transforms = {};
    }
  }
  return {
    image,
    name: chunks.Title ?? null,
    transforms,
    layers: parseLayersChunk(chunks[LAYERS_CHUNK]),
    chunks,
  };
}

/**
 * Convert a document PNG to a glb: readSheet, buildModel, then modelToGlb. The
 * sheet builds the layers chunk's count when it divides the height into whole
 * blocks, else one layer.
 * @param {Uint8Array} bytes
 * @param {{name?: string, voxelsPerMeter?: number, unlit?: boolean, generator?: string}} [opts]
 *   `name` overrides the Title chunk; with neither, the name is 'sprite'
 * @returns {Uint8Array}  the .glb file
 */
export function sheetToGlb(bytes, { name, voxelsPerMeter, unlit, generator } = {}) {
  const sheet = readSheet(bytes);
  const model = buildModel(sheet.image, {
    transforms: sheet.transforms,
    layers: layerCount(sheet.image.height, sheet.layers) ?? 1,
  });
  return modelToGlb(model, {
    name: name ?? sheet.name ?? 'sprite',
    voxelsPerMeter,
    unlit,
    generator,
  });
}
