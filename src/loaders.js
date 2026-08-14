// ---------------------------------------------------------------------------
// Atlas loaders: every way a sheet enters the app (a built-in sample, a picked
// or dropped file, a blank canvas) funnels through here — decode, validate,
// then `doc.loadAtlas` on success or `build.setError` on failure. The doc's
// change notification does the rest (rebuild, editor re-point); nothing here
// touches the scene or the editor.
// ---------------------------------------------------------------------------

import { validateSheet } from './lib/atlas.js';
import { urlToImageData, fileToImageData } from './image-io.js';
import { doc } from './state/doc.js';
import { build } from './state/build.js';

// Validate + load a decoded sheet. The single trunk under the loaders below.
/** @param {ImageData} imageData  @param {Record<string, object>} [transforms] */
export function loadSheet(imageData, transforms = {}) {
  const bad = validateSheet(imageData);
  if (bad) {
    build.setError(bad);
    return;
  }
  doc.loadAtlas(imageData, transforms);
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
}

// Decode a dropped/picked file, surfacing failures instead of swallowing them
// as an unhandled promise rejection (bad/corrupt images just no-op otherwise).
/** @param {File} f */
export async function loadFile(f) {
  try {
    loadSheet(await fileToImageData(f));
  } catch (err) {
    build.setError(`Couldn't read "${f.name}" as an image: ${err.message}`);
  }
}

// A fresh 3x2 sheet of empty (transparent) square 40×40 tiles to draw from
// scratch — every face reads empty until you paint it.
export const loadBlank = () => loadSheet(new ImageData(120, 80));
