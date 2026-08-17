// ---------------------------------------------------------------------------
// Atlas loaders: every way a sheet enters the app (a built-in sample, a picked
// or dropped file, a blank canvas) funnels through here — decode, validate,
// then OPEN A CONTEXT (state/workspace.js) and load the sheet into its doc,
// or `build.setError` on failure. One document = one window: a load never
// replaces an open document — the window layer reconciles a fresh document
// window into existence from the workspace change, and the caller activates
// it. Validation runs BEFORE the context opens, so a malformed sheet never
// leaves an empty window behind.
//
// A dropped PNG may BE an exported document (the format is one .png with
// metadata text chunks — lib/png-chunks.js), so `loadFile` reads the bytes
// first: a `Title` chunk restores the document's name and a
// `sprite-machine:transforms` chunk its per-view reorientation — the lossless
// round-trip that makes Export ↔ drop a real save path. Non-PNG images (and
// PNGs with no chunks) fall back to the file's own name.
// ---------------------------------------------------------------------------

import { validateSheet } from './lib/atlas.js';
import { isPng, readTextChunks } from './lib/png-chunks.js';
import { urlToImageData, bytesToImageData } from './image-io.js';
import { workspace } from './state/workspace.js';
import { build } from './state/build.js';

// Validate + open a decoded sheet as a fresh context. The single trunk under
// the loaders below. Returns the new context, or null (with the error
// surfaced) on a malformed sheet. `face` seeds the context's starting face AT
// open (the ?edit boot hook): a post-open setFace would race the one-shot
// mount hooks — the canvas's mount fill commits its working buffer against
// ctx.face, so a face switched between the editor's first render and that
// commit would file the OLD face's buffer under the NEW face.
/** @param {ImageData} imageData
 *  @param {{transforms?: Record<string, object>, name?: string, face?: string,
 *           hooks?: object|null}} [opts] */
export function openSheet(imageData, { transforms = {}, name, face, hooks = null } = {}) {
  const bad = validateSheet(imageData);
  if (bad) {
    build.setError(bad);
    return null;
  }
  const ctx = workspace.open({ name, face, hooks });
  ctx.doc.loadAtlas(imageData, transforms);
  return ctx;
}

/** @param {{name:string, atlas:{image?:ImageData, url?:string}, transforms?:object}} sample
 *  @param {{face?: string, hooks?: object|null}} [opts]  boot-only editor dev hooks */
export async function loadSample(sample, { face, hooks = null } = {}) {
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
  // A sample opens as a fresh untitled copy wearing the sample's name.
  return openSheet(image, {
    transforms: { ...(sample.transforms || {}) },
    name: sample.name,
    face,
    hooks,
  });
}

// Decode a dropped/picked file, surfacing failures instead of swallowing them
// as an unhandled promise rejection (bad/corrupt images just no-op otherwise).
// Returns the opened context (null on failure), so the drop target can
// surface the new document window on success only.
/** @param {File} f */
export async function loadFile(f) {
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    let title = null;
    let transforms = {};
    if (isPng(bytes)) {
      // Chunk metadata is best-effort: a torn chunk list only costs the name.
      try {
        const meta = readTextChunks(bytes);
        title = meta.Title ?? null;
        if (meta['sprite-machine:transforms']) {
          transforms = JSON.parse(meta['sprite-machine:transforms']);
        }
      } catch {
        transforms = {};
      }
    }
    return openSheet(await bytesToImageData(bytes), {
      transforms,
      name: title ?? f.name.replace(/\.[^.]+$/, ''),
    });
  } catch (err) {
    build.setError(`Couldn't read "${f.name}" as an image: ${err.message}`);
    return null;
  }
}

// A fresh 3x2 sheet of empty (transparent) square 40×40 tiles to draw from
// scratch — every face reads empty until you paint it. The name counts up
// over the open untitleds ("untitled", "untitled 2", …).
export const loadBlank = () => openSheet(new ImageData(120, 80));
