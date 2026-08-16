// ---------------------------------------------------------------------------
// Atlas loaders: every way a sheet enters the app (a built-in sample, a picked
// or dropped file, a blank canvas) funnels through here — decode, validate,
// then `doc.loadAtlas` on success or `build.setError` on failure. The doc's
// change notification does the rest (rebuild, editor re-point) and resets the
// files identity to a clean untitled; the loaders then hand that untitled doc
// its display name via `files.adoptUntitled`.
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
import { doc } from './state/doc.js';
import { build } from './state/build.js';
import { files } from './state/files.js';

// Validate + load a decoded sheet. The single trunk under the loaders below.
/** @param {ImageData} imageData  @param {Record<string, object>} [transforms] */
export function loadSheet(imageData, transforms = {}) {
  const bad = validateSheet(imageData);
  if (bad) {
    build.setError(bad);
    return false;
  }
  doc.loadAtlas(imageData, transforms);
  return true;
}

/** @param {{name:string, atlas:{image?:ImageData, url?:string}, transforms?:object}} sample */
export async function loadSample(sample) {
  let image;
  try {
    image = sample.atlas.image ?? (await urlToImageData(sample.atlas.url));
  } catch (err) {
    build.setError(`Couldn't load sample "${sample.name}": ${err.message}`);
    return;
  }
  const bad = validateSheet(image);
  if (bad) {
    build.setError(`Sample "${sample.name}" is unusable: ${bad}`);
    return;
  }
  doc.loadAtlas(image, { ...(sample.transforms || {}) });
  // A sample opens as a fresh untitled copy wearing the sample's name.
  files.adoptUntitled(sample.name);
}

// Decode a dropped/picked file, surfacing failures instead of swallowing them
// as an unhandled promise rejection (bad/corrupt images just no-op otherwise).
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
    if (loadSheet(await bytesToImageData(bytes), transforms)) {
      files.adoptUntitled(title ?? f.name.replace(/\.[^.]+$/, ''));
    }
  } catch (err) {
    build.setError(`Couldn't read "${f.name}" as an image: ${err.message}`);
  }
}

// A fresh 3x2 sheet of empty (transparent) square 40×40 tiles to draw from
// scratch — every face reads empty until you paint it. (The sheet bump makes
// it a clean untitled by itself.)
export const loadBlank = () => loadSheet(new ImageData(120, 80));
