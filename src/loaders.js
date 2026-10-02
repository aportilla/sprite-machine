// Atlas loaders: validate a sheet, then open it as a new workspace context, or
// store a sample as a document. Validation runs first, so a bad sheet leaves
// no empty window. Each throws an Error whose message says what went wrong.

import { validateSheet, clampTile } from 'sprite-machine';
import { urlToBytes, bytesToImageData } from './image-io.js';
import { workspace } from './state/workspace.js';
import { createDoc } from './state/doc.js';
import { sheets, readSheetMeta } from './state/sheets.js';
import { createRingSettings } from './state/ring-settings.js';
import { sheetLayers } from './lib/sheet-shape.js';

// Returns the new context. face and ring seed the context at open, so they
// don't mark the document dirty. The layer count comes from the sheet's shape,
// and names only names the layers.
/** @param {ImageData} imageData
 *  @param {{transforms?: Record<string, object>, name?: string, face?: string,
 *           ring?: Partial<import('./state/ring-settings.js').RingSettings>|null,
 *           names?: string[]|null}} [opts] */
export function openSheet(
  imageData,
  { transforms = {}, name, face, ring = null, names = null } = {}
) {
  const bad = validateSheet(imageData);
  if (bad) throw new Error(bad);
  const ctx = workspace.open({ name, face, ring });
  ctx.doc.loadAtlas(imageData, transforms, {
    layers: sheetLayers(imageData.width, imageData.height),
    names,
  });
  return ctx;
}

/** @param {{name:string, atlas:{image?:ImageData, url?:string}, transforms?:object}} sample
 *  @param {{name?: string, face?: string}} [opts]
 *    the copy's name (default: the sample's) and starting face */
export async function loadSample(sample, { name = sample.name, face } = {}) {
  let sheet;
  try {
    sheet = await sampleSheet(sample);
  } catch (err) {
    throw new Error(`The template “${sample.name}” couldn’t be read: ${err.message}`);
  }
  const bad = validateSheet(sheet.image);
  if (bad) throw new Error(`The template “${sample.name}” is unusable: ${bad}`);
  const { image, transforms, ring, names } = sheet;
  return openSheet(image, { transforms, name, face, ring, names });
}

/**
 * A sample's pixels and document metadata. A URL sample is a document PNG, so
 * its chunks give the transforms, ring settings and layer names, as a dropped
 * file's do. The sample's own transforms win.
 * @param {{name:string, atlas:{image?:ImageData, url?:string}, transforms?:object}} sample
 */
async function sampleSheet(sample) {
  const { image, url } = sample.atlas;
  if (image) {
    return { image, transforms: { ...sample.transforms }, ring: null, names: null };
  }
  const bytes = await urlToBytes(/** @type {string} */ (url));
  const meta = readSheetMeta(bytes);
  return {
    image: await bytesToImageData(bytes),
    transforms: { ...meta.transforms, ...sample.transforms },
    ring: meta.ring,
    names: meta.names,
  };
}

/**
 * Store a sample as a document on the desktop, made at `at`. Rejects when
 * the sample can't be read or isn't a sheet.
 * @param {{name:string, atlas:{image?:ImageData, url?:string}, transforms?:object}} sample
 * @param {number} at
 */
export async function storeSample(sample, at) {
  const { image, transforms, ring, names } = await sampleSheet(sample);
  const bad = validateSheet(image);
  if (bad) throw new Error(bad);
  const doc = createDoc();
  doc.loadAtlas(image, transforms, {
    layers: sheetLayers(image.width, image.height),
    names,
  });
  await sheets.save(doc, {
    name: sample.name,
    ring: ring ? createRingSettings(ring).get() : null,
    at,
  });
}

// Open an empty 3x2 sheet of square tiles. Without a name, the workspace picks
// the next untitled name.
/** @param {number} [tile]  @param {string} [name] */
export const loadBlank = (tile = 40, name) => {
  const t = clampTile(tile);
  return openSheet(new ImageData(t * 3, t * 2), { name });
};
