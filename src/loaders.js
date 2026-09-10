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
// metadata text chunks — the engine's png-chunks.js), so `loadFile` reads the bytes
// first: a `Title` chunk restores the document's name, a
// `sprite-machine:transforms` chunk its per-view reorientation, and a
// `sprite-machine:ring` chunk its 3D Sprite Atlas settings — the lossless
// round-trip that makes Download ↔ drop a real save path. Non-PNG images
// (and PNGs with no chunks) fall back to the file's own name and the
// defaults.
//
// One loader writes instead of opening: `seedDefaultDocs` saves the built-in
// samples into the library as ordinary stored documents — a truly-virgin-boot
// one-shot (see its doc comment).
// ---------------------------------------------------------------------------

import { validateSheet, clampTile, isPng, readTextChunks } from 'sprite-machine';
import { urlToImageData, bytesToImageData } from './image-io.js';
import { workspace } from './state/workspace.js';
import { createDoc } from './state/doc.js';
import { files } from './state/files.js';
import { build } from './state/build.js';
import { RING_CHUNK_KEY, parseRingChunk } from './state/ring-settings.js';

// Validate + open a decoded sheet as a fresh context. The single trunk under
// the loaders below. Returns the new context, or null (with the error
// recorded on the build slice) on a malformed sheet. `face` seeds the context's starting face AT
// open (the ?edit boot hook): a post-open setFace would race the one-shot
// mount hooks — the canvas's mount fill commits its working buffer against
// ctx.face, so a face switched between the editor's first render and that
// commit would file the OLD face's buffer under the NEW face.
// `ring` seeds the context's 3D Sprite Atlas settings the same way (a
// document's own chunk, or the ?ring boot hook's): at open, before any
// tracker or follower, so the seed is the document's birth state, not a
// change that dirties it.
/** @param {ImageData} imageData
 *  @param {{transforms?: Record<string, object>, name?: string, face?: string,
 *           hooks?: object|null,
 *           ring?: Partial<import('./state/ring-settings.js').RingSettings>|null}} [opts] */
export function openSheet(
  imageData,
  { transforms = {}, name, face, hooks = null, ring = null } = {}
) {
  const bad = validateSheet(imageData);
  if (bad) {
    build.setError(bad);
    return null;
  }
  const ctx = workspace.open({ name, face, hooks, ring });
  ctx.doc.loadAtlas(imageData, transforms);
  return ctx;
}

/** @param {{name:string, atlas:{image?:ImageData, url?:string}, transforms?:object}} sample
 *  @param {{name?: string, face?: string, hooks?: object|null,
 *           ring?: Partial<import('./state/ring-settings.js').RingSettings>|null}} [opts]
 *    the copy's name (the New dialog's; the sample's own by default),
 *    boot-only editor dev hooks, and the ?ring hook's settings seed */
export async function loadSample(
  sample,
  { name = sample.name, face, hooks = null, ring = null } = {}
) {
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
  // A sample opens as a fresh unsaved copy wearing the sample's name, or
  // the one the New dialog gave it.
  return openSheet(image, {
    transforms: { ...(sample.transforms || {}) },
    name,
    face,
    hooks,
    ring,
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
    let ring = null;
    if (isPng(bytes)) {
      // Chunk metadata is best-effort: a torn chunk list only costs the name.
      try {
        const meta = readTextChunks(bytes);
        title = meta.Title ?? null;
        if (meta['sprite-machine:transforms']) {
          transforms = JSON.parse(meta['sprite-machine:transforms']);
        }
        ring = parseRingChunk(meta[RING_CHUNK_KEY]);
      } catch {
        transforms = {};
      }
    }
    return openSheet(await bytesToImageData(bytes), {
      transforms,
      name: title ?? f.name.replace(/\.[^.]+$/, ''),
      ring,
    });
  } catch (err) {
    build.setError(`Couldn't read "${f.name}" as an image: ${err.message}`);
    return null;
  }
}

// A fresh 3x2 sheet of empty (transparent) square tiles to draw from
// scratch — every face reads empty until you paint it. `tile` is the
// square tile size the New… dialog chose (clamped to the stepper's range)
// and `name` the name it captured; with none, the name counts up over the
// open untitleds ("untitled", "untitled 2", …).
/** @param {number} [tile]  @param {string} [name] */
export const loadBlank = (tile = 40, name) => {
  const t = clampTile(tile);
  return openSheet(new ImageData(t * 3, t * 2), { name });
};

/**
 * Seed the document library with the built-in defaults — one ORDINARY stored
 * document per sample, through the same files.save path a user's ⌘S takes
 * (real PNG bytes, metadata chunks, generated icon). Run only while the
 * profile has no record of having seeded (main.js, the desktop state's
 * `seeded` flag — shell/desktop-state.js header), so the seeds are created
 * exactly once and live as normal mutable documents from then on — edited,
 * renamed or deleted, they never come back. A first boot interrupted
 * mid-seeding (a reload) runs this again on the next boot: `existing` — the
 * names already in the library — skips the built-ins that did land, so
 * nothing doubles. Resolves the first seeded doc's id (the boot document),
 * or null when nothing could be seeded.
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
      // A failed seed costs only that default document.
    }
    // createdAt is the listing's sort key; a same-millisecond pair would
    // tie-break on random ids and shuffle the icon order between machines.
    await new Promise((r) => setTimeout(r, 2));
  }
  return firstId;
}
