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
import { urlToImageData, bytesToImageData } from './image-io.js';
import { workspace } from './state/workspace.js';
import { createDoc } from './state/doc.js';
import { files } from './state/files.js';
import { build } from './state/build.js';
import { RING_CHUNK_KEY, parseRingChunk } from './state/ring-settings.js';
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
  let image;
  try {
    image = sample.atlas.image ?? (await urlToImageData(sample.atlas.url));
  } catch (err) {
    build.setError(`Couldn't load sample "${sample.name}": ${err.message}`);
    return null;
  }
  const bad = validateSheet(image);
  if (bad) {
    build.setError(`Sample "${sample.name}" is unusable: ${bad}`);
    return null;
  }
  return openSheet(image, {
    transforms: { ...(sample.transforms || {}) },
    name,
    face,
  });
}

/**
 * Read the document chunks from PNG bytes: Title, sprite-machine:transforms,
 * sprite-machine:ring and sprite-machine:layers. Best-effort: a non-PNG or a
 * bad chunk loses only that metadata, never the pixels. Used by loadFile and
 * the Finder's paste.
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
      const image = sample.atlas.image ?? (await urlToImageData(sample.atlas.url));
      if (validateSheet(image)) continue;
      const doc = createDoc();
      doc.loadAtlas(image, { ...(sample.transforms || {}) });
      const res = await files.save(doc, { fileId: null, name: sample.name });
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
 * Store each built-in text file on the desktop, skipping names in existing.
 * @param {{name: string, text: string}[]} texts
 * @param {Set<string>} [existing]  text file names already stored
 */
export async function seedDefaultTexts(texts, existing = new Set()) {
  for (const t of texts) {
    if (existing.has(t.name)) continue;
    try {
      await files.createText({ name: t.name, text: t.text });
    } catch {
      // A failed seed skips only that text file.
    }
    await new Promise((r) => setTimeout(r, 2)); // distinct createdAt, as above
  }
}

/**
 * The built-in documents and text files whose names are not in the library.
 * Trashed files count as present, so a restore never duplicates a name. Pure.
 * @param {import('./state/files.js').FilesState} state
 * @param {{name:string, atlas:{image?:ImageData, url?:string}, transforms?:object}[]} samples
 * @param {{name: string, text: string}[]} texts
 */
export function missingDefaults(state, samples, texts) {
  const docNames = new Set(state.list.map((r) => r.name));
  const textNames = new Set(state.texts.map((t) => t.name));
  return {
    docs: samples.filter((s) => !docNames.has(s.name)),
    texts: texts.filter((t) => !textNames.has(t.name)),
  };
}

/**
 * Special → Restore Default Files: store the built-in files missing from the
 * library. A file that already has a built-in's name is left alone.
 * @param {{name:string, atlas:{image?:ImageData, url?:string}, transforms?:object}[]} samples
 * @param {{name: string, text: string}[]} texts
 */
export async function restoreDefaultFiles(samples, texts) {
  const missing = missingDefaults(files.get(), samples, texts);
  await seedDefaultDocs(missing.docs);
  await seedDefaultTexts(missing.texts);
}
