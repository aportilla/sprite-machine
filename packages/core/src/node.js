// ---------------------------------------------------------------------------
// The Node adapter (`sprite-machine/node`): a document PNG's bytes in, the
// pixels and the metadata the app would read from it out — and, in one
// call, the glb. The engine itself takes pixels and never decodes a file
// (index.js is environment-free); this is the one place a decoder lives,
// `pngjs`, which reads every PNG a sprite editor exports — indexed, 16-bit,
// interlaced — as 8-bit RGBA, the ImageData shape the pipeline consumes.
// The chunks are read best-effort, as the app's loader reads them: a torn
// chunk list costs the name and the transforms, never the pixels.
// ---------------------------------------------------------------------------

import { PNG } from 'pngjs';
import { isPng, readTextChunks } from './png-chunks.js';
import { buildModel, modelToGlb } from './model.js';

const TRANSFORMS_CHUNK = 'sprite-machine:transforms';

/**
 * Decode a document PNG.
 * @param {Uint8Array} bytes
 * @returns {{
 *   image: {width:number, height:number, data:Uint8ClampedArray},
 *   name: string|null,
 *   transforms: Record<string, {rot?:number, flipX?:boolean, flipY?:boolean}>,
 *   chunks: Record<string, string>,
 * }}  the pixels; the Title chunk's name; the transforms chunk, parsed; and
 *   every text chunk verbatim (the ring settings ride here, unparsed — a
 *   viewing choice, the app's business)
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
  return { image, name: chunks.Title ?? null, transforms, chunks };
}

/**
 * A document PNG's bytes → its glb: `readSheet`, `buildModel`, `modelToGlb`.
 * @param {Uint8Array} bytes
 * @param {{name?: string, voxelsPerMeter?: number, unlit?: boolean, generator?: string}} [opts]
 *   `name` overrides the Title chunk's; with neither, the model is 'sprite'
 * @returns {Uint8Array}  the .glb file
 */
export function sheetToGlb(bytes, { name, voxelsPerMeter, unlit, generator } = {}) {
  const sheet = readSheet(bytes);
  const model = buildModel(sheet.image, { transforms: sheet.transforms });
  return modelToGlb(model, {
    name: name ?? sheet.name ?? 'sprite',
    voxelsPerMeter,
    unlit,
    generator,
  });
}
