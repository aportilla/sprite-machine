// Pure selectors over the doc slice.

import { VIEW_OPPOSITE, MIRROR_AXIS, flip } from 'sprite-machine';
import { edgeHintFrame } from '../lib/edges.js';

// Mirror a tile for display, the way a mirror-derived face renders.
/** @param {{width:number,height:number,data:ArrayLike<number>}} img  @param {'x'|'y'} axis */
export function mirrorImage(img, axis) {
  return flip(img, axis === 'x', axis === 'y');
}

/**
 * The editor's view model for one face:
 *   - `tile`: the face's own art by reference, or a fresh transparent tile.
 *     The canvas resets its working buffer only when the identity changes.
 *   - `wasDerived`: the face has no art of its own. It stays derived until a
 *     pixel changes.
 *   - `mirrorBehind`: the opposite face's own art, mirrored, for the onion
 *     skin. Null when the opposite face has none.
 *   - `edgeHints`: the four neighbouring faces' edge texels, one texel deep
 *     around the tile (lib/edges.js). A stroke on this face cannot change
 *     them, so they recompute only on a structural change.
 *
 * @param {{views: Record<string, {width:number,height:number,data:Uint8ClampedArray}|null>,
 *          tileW: number, tileH: number}} docState
 * @param {string} face
 */
export function editorViewModel(docState, face) {
  const { views, tileW, tileH } = docState;
  const existing = views[face] || null;
  const oppArt = views[VIEW_OPPOSITE[face]];
  return {
    tile: existing || {
      width: tileW,
      height: tileH,
      data: new Uint8ClampedArray(tileW * tileH * 4),
    },
    wasDerived: existing == null,
    mirrorBehind: oppArt ? mirrorImage(oppArt, MIRROR_AXIS) : null,
    edgeHints: edgeHintFrame(views, tileW, tileH, face),
  };
}
