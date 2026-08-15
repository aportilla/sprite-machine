// ---------------------------------------------------------------------------
// <sm-face-picker> — six pixel-art cube-view icons over a vf-radio-group, laid
// out as mirror pairs by `faces` (nested vf-stacks: a row of column cells).
// The selected face's icon takes the "selected" dither overlay, driven by the
// `selected` prop right in the template — a classMap flip, no CSS peeking at
// the kit's radio internals. A presentational LEAF: props down (`faces`,
// `selected`), one bubbling `sm-select-face {face}` event up — no store
// imports, no doc knowledge.
//
// THE CUBE ICONS (formerly face-icons.js, folded in — only this component
// renders or styles them): one small isometric cube per atlas face, drawn as
// 21×26 pixel art. The cube is seen from a top-front corner, so three quads
// are visible and their three opposites hide behind it. A face with a visible
// quad (`front`, `left`, `top`) fills that quad SOLID red; a hidden one
// (`back`, `right`, `bottom`) draws a thin red SLIVER peeking out along the
// silhouette edge it hides behind — "the far side of this one".
//
// Left/right in this art is the OBJECT's own handedness (stage-left), not the
// viewer's: `left` is the cube's lower-RIGHT quad and `right` the sliver on
// the far left, the way a car facing you shows you its left flank on your
// right. That's deliberate — don't "fix" it to match the world axes (+x
// right, so the `left` face's normal is −x); FACE_ART is the whole mapping.
//
// The art is raster, so it goes through `vf-img`: one image pixel is one
// system px, magnified nearest-neighbor on whole device pixels. width/height
// are stated up front so the cell reserves its box before the file lands.
// SELECTED is a 50% red dither in the cube's silhouette, laid OVER the art
// via vf-img's own top/left (system px, from the position:relative wrapper —
// vf-img writes that placement as INLINE style, so the overlay's state rides
// on `class`, which lit owns, never on a bound `style` attribute that would
// clobber it). The overlay is ALWAYS in the DOM — selection flips a class, so
// it never re-mounts (no image flash); visibility, not display, so its box
// rules are left alone.
//
// Shadow DOM; `:host { display: contents }`, so the radio group sits in the
// settings row directly.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { baseStyles } from './base-styles.js';
import backUrl from '../assets/faces/back.png';
import bottomUrl from '../assets/faces/bottom.png';
import frontUrl from '../assets/faces/front.png';
import leftUrl from '../assets/faces/left.png';
import rightUrl from '../assets/faces/right.png';
import topUrl from '../assets/faces/top.png';
import selectedUrl from '../assets/faces/selected.png';

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

export class SmFacePicker extends LitElement {
  static styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
      /* The cube art and the "selected" dither stack in one box: the art is in
         flow (it sizes the wrapper), the dither rides over it via vf-img's own
         top/left. */
      .editor-face-art {
        position: relative;
        display: block;
      }
      /* The dither overlay: hidden until render() flips \`.on\` for the selected
         face. Visibility, not display, so the overlay's box rules are left
         alone. */
      .editor-face-selected {
        visibility: hidden;
      }
      .editor-face-selected.on {
        visibility: visible;
      }
    `,
  ];

  static properties = {
    faces: { attribute: false },
    selected: {},
  };

  constructor() {
    super();
    /** @type {string[]|null} */
    this.faces = null;
    this.selected = '';
  }

  // The cube icon for one atlas face, dither overlay included. A fresh
  // TemplateResult per render diffs to attribute updates only — the seven
  // images are never re-mounted or swapped.
  #icon(face) {
    return html`
      <div class="editor-face-art">
        <vf-img class="editor-face-cube" width=${ICON_W} height=${ICON_H}>
          <img src=${FACE_ART[face] || FACE_ART.front} alt="" />
        </vf-img>
        <vf-img
          class=${classMap({
            'editor-face-selected': true,
            on: face === this.selected,
          })}
          width=${ICON_W}
          height=${ICON_H}
          top="0"
          left="0"
        >
          <img src=${selectedUrl} alt="" />
        </vf-img>
      </div>
    `;
  }

  render() {
    const faces = this.faces || [this.selected];
    return html`
      <vf-radio-group
        class="editor-face-picker"
        label="edit face"
        .value=${this.selected}
        @vf-change=${this.#onPick}
      >
        <vf-stack direction="row" gap="12">
          ${faces.map(
            (f) => html`
              <vf-stack
                class="editor-face-cell"
                direction="column"
                gap="0"
                place="center"
                title=${f}
                @click=${(e) => this.#onCellClick(e, f)}
              >
                ${this.#icon(f)}
                <vf-radio value=${f} aria-label=${f}></vf-radio>
              </vf-stack>
            `
          )}
        </vf-stack>
      </vf-radio-group>
    `;
  }

  #onPick = (e) => {
    const f = /** @type {CustomEvent} */ (e).detail.value;
    if (f && f !== this.selected) this.#emit(f);
  };

  // The cube icon is a click target too; the radio's own click already routes
  // through the group's vf-change, so skip it here to avoid a double switch.
  #onCellClick(e, f) {
    if (/** @type {Element} */ (e.target).closest?.('vf-radio')) return;
    if (f !== this.selected) this.#emit(f);
  }

  #emit(face) {
    this.dispatchEvent(
      new CustomEvent('sm-select-face', { detail: { face }, bubbles: true })
    );
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-face-picker'))
  customElements.define('sm-face-picker', SmFacePicker);
