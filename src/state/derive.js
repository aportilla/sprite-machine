// ---------------------------------------------------------------------------
// Pure selectors over the doc slice — derivations components need but nobody
// stores. Chiefly `editorViewModel`: everything the editor needs to show one
// face (the old `showFace()` derivation, now Node-testable).
// ---------------------------------------------------------------------------

import { VIEW_OPPOSITE, MIRROR_AXIS } from '../lib/views.js';
import { flip } from '../lib/ingest.js';
import { edgeHintFrame } from '../lib/edges.js';

// Mirror a tile for display (an axis-flip in image space), so a mirror-derived
// face shows the way we actually render it. A thin wrapper over the pipeline's
// `flip` blit so there is one mirror implementation. (In practice MIRROR_AXIS
// is always 'x'.)
/** @param {{width:number,height:number,data:ArrayLike<number>}} img  @param {'x'|'y'} axis */
export function mirrorImage(img, axis) {
  return flip(img, axis === 'x', axis === 'y');
}

/**
 * The editor's per-face view model:
 *   - `tile`: the face's own art BY REFERENCE (identity tells the canvas not to
 *     reset its working buffer), or a fresh transparent tile when the face has
 *     none of its own.
 *   - `wasDerived`: the face had no independent art — it opens with an empty
 *     canvas and stays derived unless the user actually changes a pixel.
 *   - `mirrorBehind`: the opposite face's OWN art, mirrored, for the faded
 *     onion-skin — null when the opposite has no independent art (a derived
 *     opposite is just this face's own mirror; it would overlay identically).
 *   - `edgeHints`: the EDGE HINT frame (lib/edges.js) — the four neighbouring
 *     faces' seam lines, one texel deep around the tile, which the canvas
 *     draws just outside its own edges. A stroke on this face can never move
 *     one: its four neighbours are the four faces other than it and its
 *     opposite, and that set is closed under VIEW_OPPOSITE — so this rides the
 *     same memo as the onion-skin and recomputes only on a structural change.
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
