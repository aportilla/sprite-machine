// ---------------------------------------------------------------------------
// Cube-view icons for the editor's face picker — one small isometric cube per
// atlas face, drawn as 21×26 pixel art (the real artwork; the placeholder inline
// SVGs it replaced are gone).
//
// The cube is seen from a top-front corner, so three quads are visible and their
// three opposites hide behind it. A face with a visible quad (`front`, `left`,
// `top`) fills that quad SOLID red; a hidden one (`back`, `right`, `bottom`)
// draws a thin red SLIVER peeking out along the silhouette edge it hides behind
// — "the far side of this one".
//
// Left/right in this art is the OBJECT's own handedness (stage-left), not the
// viewer's: `left` is the cube's lower-RIGHT quad and `right` the sliver on the
// far left, the way a car facing you shows you its left flank on your right.
// That's deliberate — don't "fix" it to match the world axes (+x right, so the
// `left` face's normal is −x); the mapping below is the whole of it.
//
// The art is raster, so it goes through `vf-img`: one image pixel is one system
// px, magnified nearest-neighbor on whole device pixels, with the kit's own grid
// snapping. `width`/`height` are stated up front so the cell reserves its box
// before the file lands and the settings row can't reflow.
//
// SELECTED is a 50% red dither in the cube's silhouette, laid OVER the art of
// whichever face is checked (`vf-img`'s own `top`/`left` absolute positioning,
// in the same system-px units as the art). It's always in the DOM; CSS shows it
// only under a checked `vf-radio`, so it follows the group's own state rather
// than needing a re-mount to appear.
//
// These are lit TEMPLATES, not built elements: <sm-editor> re-renders on every
// state change, and a fresh DOM node per render would make lit swap all seven
// images each time. A TemplateResult diffs to a no-op instead.
// ---------------------------------------------------------------------------

import { html } from 'lit';
import backUrl from './assets/faces/back.png';
import bottomUrl from './assets/faces/bottom.png';
import frontUrl from './assets/faces/front.png';
import leftUrl from './assets/faces/left.png';
import rightUrl from './assets/faces/right.png';
import topUrl from './assets/faces/top.png';
import selectedUrl from './assets/faces/selected.png';

// face key -> its cube art. Swapping the artwork means editing this map alone.
const FACE_ART = {
  left: leftUrl,
  right: rightUrl,
  front: frontUrl,
  back: backUrl,
  top: topUrl,
  bottom: bottomUrl,
};

// Native size of every tile above, in system px (all seven share one box).
const ICON_W = 21;
const ICON_H = 26;

/**
 * The cube icon for one atlas face: the face's art with the "selected" dither
 * stacked over it (shown by CSS only while this cell's radio is checked). The
 * dither is placed with vf-img's own top/left — whole system px from the
 * (relative) wrapper, so it lands exactly on the art's pixel grid at every
 * --vf-scale.
 * @param {string} face one of the six atlas face keys
 */
export const faceIcon = (face) => html`
  <div class="editor-face-art">
    <vf-img class="editor-face-cube" width=${ICON_W} height=${ICON_H}>
      <img src=${FACE_ART[face] || FACE_ART.front} alt="" />
    </vf-img>
    <vf-img
      class="editor-face-selected"
      width=${ICON_W}
      height=${ICON_H}
      top="0"
      left="0"
    >
      <img src=${selectedUrl} alt="" />
    </vf-img>
  </div>
`;
