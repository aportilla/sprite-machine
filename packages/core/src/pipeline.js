// The sprite-to-voxel pipeline. No THREE or DOM.
// Input: view name -> ImageData-like { width, height, data (RGBA) }.
// Output: the voxel grid, surface and per-face colors for meshing.

import { ingestSprite, applyTransform } from './ingest.js';
import { reconcileDims, gridViews, carve, extractSurface } from './carve.js';
import { colorize } from './colorize.js';
import { VIEW_NAMES } from './views.js';

/**
 * @param {Record<string, {width:number,height:number,data:ArrayLike<number>}|null>} rawViews
 * @param {{transforms?:Record<string,{rot?:number,flipX?:boolean,flipY?:boolean}>,
 *          mirror?:{x?:boolean,y?:boolean,z?:boolean}}} [opts]
 */
export function buildVoxels(rawViews, opts = {}) {
  const transforms = opts.transforms || {};
  /** @type {Record<string, any>} */
  const ingested = {};
  for (const name of VIEW_NAMES) {
    let img = rawViews[name];
    if (!img) continue;
    if (transforms[name]) img = applyTransform(img, transforms[name]);
    const v = ingestSprite(img);
    if (v) ingested[name] = v;
  }

  const { dims, warnings } = reconcileDims(ingested);
  if (Object.keys(ingested).length === 0) {
    warnings.unshift('No usable views: every provided sprite was empty or missing.');
  }
  const gviews = gridViews(ingested, dims);
  const solid = carve(gviews, dims);
  const { surfaceMask, count, solidCount } = extractSurface(solid, dims);
  const { faceColor, palette } = colorize(solid, surfaceMask, gviews, dims, opts);
  if (palette.length === 0 && Object.keys(ingested).length > 0) {
    warnings.push('No opaque pixels found — every provided sprite is fully transparent.');
  }

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
    ingested,
    providedViews: Object.keys(ingested),
  };
}
