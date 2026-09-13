// Pure selectors over the doc slice.

import { VIEW_OPPOSITE, MIRROR_AXIS, flip } from 'sprite-machine';
import { edgeHintFrame } from '../lib/edges.js';
import { compositeTiles } from '../lib/layers.js';

// Mirror a tile for display, the way a mirror-derived face renders.
/** @param {{width:number,height:number,data:ArrayLike<number>}} img  @param {'x'|'y'} axis */
export function mirrorImage(img, axis) {
  return flip(img, axis === 'x', axis === 'y');
}

/**
 * The editor's view model for one face of one layer:
 *   - `tile`: the face's own art in the layer by reference, or a fresh
 *     transparent tile. The canvas resets its working buffer only when the
 *     identity changes.
 *   - `wasDerived`: the face has no art of its own. It stays derived until a
 *     pixel changes.
 *   - `onionBehind`: the underlay, one composited tile: the layer's opposite
 *     face mirrored, then each other layer's art on this face in block order,
 *     later over earlier. Null when all of those are empty.
 *   - `edgeHints`: the layer's four neighbouring faces' edge texels, one texel
 *     deep around the tile (lib/edges.js). Other layers never show there.
 * A stroke on this face of this layer changes none of the underlay or hints,
 * so they recompute only on a face or layer switch or a structural change.
 *
 * @param {{layers: Record<string, {width:number,height:number,data:Uint8ClampedArray}|null>[],
 *          tileW: number, tileH: number}} docState
 * @param {string} face
 * @param {number} layer
 */
export function editorViewModel(docState, face, layer) {
  const { layers, tileW, tileH } = docState;
  const views = layers[layer] ?? {};
  const existing = views[face] || null;
  const oppArt = views[VIEW_OPPOSITE[face]];
  return {
    tile: existing || {
      width: tileW,
      height: tileH,
      data: new Uint8ClampedArray(tileW * tileH * 4),
    },
    wasDerived: existing == null,
    onionBehind: compositeTiles([
      oppArt ? mirrorImage(oppArt, MIRROR_AXIS) : null,
      ...layers.map((other, k) => (k === layer ? null : other[face] || null)),
    ]),
    edgeHints: edgeHintFrame(views, tileW, tileH, face),
  };
}
