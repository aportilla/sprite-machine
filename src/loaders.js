// Atlas loaders: validate a sheet, then open it as a new workspace context.
// Validation runs first, so a bad sheet leaves no empty window.

import {
  validateSheet,
  clampTile,
  isPng,
  readTextChunks,
  LAYERS_CHUNK,
  parseLayersChunk,
} from 'sprite-machine';
import { urlToBytes, bytesToImageData } from './image-io.js';
import { workspace } from './state/workspace.js';
import { createDoc } from './state/doc.js';
import { files, missingBuiltins, builtinLinks } from './state/files.js';
import { build } from './state/build.js';
import {
  RING_CHUNK_KEY,
  parseRingChunk,
  createRingSettings,
} from './state/ring-settings.js';
import { sheetLayers } from './lib/sheet-shape.js';

// Returns the new context, or null with the error on the build slice. face and
// ring seed the context at open, so they don't mark the document dirty. The
// layer count comes from the sheet's shape, and names only names the layers.
/** @param {ImageData} imageData
 *  @param {{transforms?: Record<string, object>, name?: string, face?: string,
 *           ring?: Partial<import('./state/ring-settings.js').RingSettings>|null,
 *           names?: string[]|null}} [opts] */
export function openSheet(
  imageData,
  { transforms = {}, name, face, ring = null, names = null } = {}
) {
  const bad = validateSheet(imageData);
  if (bad) {
    build.setError(bad);
    return null;
  }
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
    build.setError(`Couldn't load sample "${sample.name}": ${err.message}`);
    return null;
  }
  const bad = validateSheet(sheet.image);
  if (bad) {
    build.setError(`Sample "${sample.name}" is unusable: ${bad}`);
    return null;
  }
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
 * Read the document chunks from PNG bytes: Title, sprite-machine:transforms,
 * sprite-machine:ring and sprite-machine:layers. Best-effort: a non-PNG or a
 * bad chunk loses only that metadata, never the pixels. Used by loadFile, the
 * samples and the Finder's paste.
 * @param {Uint8Array} bytes
 * @returns {{title: string|null, transforms: Record<string, object>,
 *   ring: Partial<import('./state/ring-settings.js').RingSettings>|null,
 *   names: string[]|null}}
 */
export function readSheetMeta(bytes) {
  /** @type {Record<string, string>} */
  let meta = {};
  if (isPng(bytes)) {
    try {
      meta = readTextChunks(bytes);
    } catch {
      meta = {};
    }
  }
  let transforms = {};
  try {
    if (meta['sprite-machine:transforms']) {
      transforms = JSON.parse(meta['sprite-machine:transforms']);
    }
  } catch {
    transforms = {};
  }
  return {
    title: meta.Title ?? null,
    transforms,
    ring: parseRingChunk(meta[RING_CHUNK_KEY]),
    names: parseLayersChunk(meta[LAYERS_CHUNK]),
  };
}

// Decode and open a dropped file. Returns the context, or null with the error on
// the build slice.
/** @param {File} f */
export async function loadFile(f) {
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const { title, transforms, ring, names } = readSheetMeta(bytes);
    return openSheet(await bytesToImageData(bytes), {
      transforms,
      name: title ?? f.name.replace(/\.[^.]+$/, ''),
      ring,
      names,
    });
  } catch (err) {
    build.setError(`Couldn't read "${f.name}" as an image: ${err.message}`);
    return null;
  }
}

// Open an empty 3x2 sheet of square tiles. Without a name, the workspace picks
// the next untitled name.
/** @param {number} [tile]  @param {string} [name] */
export const loadBlank = (tile = 40, name) => {
  const t = clampTile(tile);
  return openSheet(new ImageData(t * 3, t * 2), { name });
};

/**
 * Save each built-in sample to the library as an ordinary document. Names in
 * existing are skipped, so an interrupted seeding completes without duplicates.
 * Resolves the first seeded document's id, or null.
 * @param {{name:string, atlas:{image?:ImageData, url?:string}, transforms?:object}[]} samples
 * @param {Set<string>} [existing]  document names already stored
 */
export async function seedDefaultDocs(samples, existing = new Set()) {
  let firstId = null;
  for (const sample of samples) {
    if (existing.has(sample.name)) continue;
    try {
      const { image, transforms, ring, names } = await sampleSheet(sample);
      if (validateSheet(image)) continue;
      const doc = createDoc();
      doc.loadAtlas(image, transforms, {
        layers: sheetLayers(image.width, image.height),
        names,
      });
      const res = await files.save(doc, {
        fileId: null,
        name: sample.name,
        ring: ring ? createRingSettings(ring).get() : null,
      });
      if (res && firstId == null) firstId = res.id;
    } catch {
      // A failed seed skips only that document.
    }
    // Distinct createdAt values keep the listing order stable. Ties break on
    // random ids.
    await new Promise((r) => setTimeout(r, 2));
  }
  return firstId;
}

/**
 * Store each built-in text file on the desktop by key, skipping keys already
 * stored.
 * @param {{key: string, name: string}[]} texts
 */
export async function seedDefaultTexts(texts) {
  for (const t of missingBuiltins(files.get(), texts)) {
    try {
      await files.createText({ name: t.name, builtin: t.key });
    } catch {
      // A failed seed skips only that text file.
    }
    await new Promise((r) => setTimeout(r, 2)); // distinct createdAt, as above
  }
}

/**
 * Give the text files an older profile stored in full their built-in's key.
 * @param {{key: string, name: string}[]} texts
 */
export const linkDefaultTexts = (texts) =>
  files.linkTexts(builtinLinks(files.get(), texts));

/**
 * The built-in documents whose names are not in the library, and the built-in
 * text files whose keys are not. Trashed files count as present, so a restore
 * never duplicates one. Pure.
 * @param {import('./state/files.js').FilesState} state
 * @param {{name:string, atlas:{image?:ImageData, url?:string}, transforms?:object}[]} samples
 * @param {{key: string, name: string}[]} texts
 */
export function missingDefaults(state, samples, texts) {
  const docNames = new Set(state.list.map((r) => r.name));
  return {
    docs: samples.filter((s) => !docNames.has(s.name)),
    texts: missingBuiltins(state, texts),
  };
}

/**
 * Special → Restore Default Files: store the built-in files missing from the
 * library. A document that already has a built-in's name is left alone.
 * @param {{name:string, atlas:{image?:ImageData, url?:string}, transforms?:object}[]} samples
 * @param {{key: string, name: string}[]} texts
 */
export async function restoreDefaultFiles(samples, texts) {
  const missing = missingDefaults(files.get(), samples, texts);
  await seedDefaultDocs(missing.docs);
  await seedDefaultTexts(texts);
}
