// Node adapter (sprite-machine/node): decodes a document PNG to RGBA pixels
// and its metadata, or straight to a glb. The decoder is the root entry's, over
// zlib.

import { inflateSync } from 'node:zlib';
import { isPng } from './png-chunks.js';
import { parsePng, unfilterPng } from './png-decode.js';
import { sheetMeta } from './sheet.js';
import { layerCount } from './layers.js';
import { buildModel, modelToGlb } from './model.js';

/**
 * Decode a document PNG.
 * @param {Uint8Array} bytes
 * @returns {import('./sheet.js').Sheet}
 * @throws when the bytes are not a PNG, or do not decode
 */
export function readSheet(bytes) {
  if (!isPng(bytes)) throw new Error('readSheet: not a PNG.');
  const header = parsePng(bytes);
  return { image: unfilterPng(header, inflateSync(header.idat)), ...sheetMeta(bytes) };
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
