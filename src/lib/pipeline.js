// ---------------------------------------------------------------------------
// The pure sprite -> voxel pipeline. No THREE, no DOM: fully testable in Node.
// Input: a map of view name -> ImageData-like { width, height, data(RGBA) }.
// Output: the voxel grid, surface, and per-face colors, ready for meshing.
// ---------------------------------------------------------------------------

import { ingestSprite, applyTransform } from './ingest.js';
import { reconcileDims, gridViews, carve, extractSurface } from './carve.js';
import { colorize } from './colorize.js';
import { VIEW_NAMES } from './views.js';

/**
 * @param {Record<string, {width:number,height:number,data:ArrayLike<number>}|null>} rawViews
 * @param {{alphaThreshold?:number, anyAlpha?:boolean,
 *          transforms?:Record<string,{rot?:number,flipX?:boolean,flipY?:boolean}>,
 *          mirror?:{x?:boolean,y?:boolean,z?:boolean}}} [opts]
 */
export function buildVoxels(rawViews, opts = {}) {
  const transforms = opts.transforms || {};
  /** @type {Record<string, any>} */
  const cropped = {};
  for (const name of VIEW_NAMES) {
    let img = rawViews[name];
    if (!img) continue;
    if (transforms[name]) img = applyTransform(img, transforms[name]);
    const v = ingestSprite(img, opts);
    if (v) cropped[name] = v;
  }

  const { dims, warnings } = reconcileDims(cropped);
  if (Object.keys(cropped).length === 0) {
    warnings.unshift('No usable views: every provided sprite was empty or missing.');
  }
  const gviews = gridViews(cropped, dims);
  const solid = carve(gviews, dims);
  const { surfaceMask, count } = extractSurface(solid, dims);
  const { faceColor, palette } = colorize(solid, surfaceMask, gviews, dims, opts);
  if (palette.length === 0 && Object.keys(cropped).length > 0) {
    warnings.push('No opaque pixels found — try lowering the alpha threshold.');
  }

  let solidCount = 0;
  for (let i = 0; i < solid.length; i++) solidCount += solid[i];

  return {
    dims,
    solid,
    surfaceMask,
    surfaceCount: count,
    solidCount,
    faceColor,
    palette,
    warnings,
    gviews,
    cropped,
    providedViews: Object.keys(cropped),
  };
}
