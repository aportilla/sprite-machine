// ---------------------------------------------------------------------------
// <sm-atlas-view> — the Full Sprite View window's body: the FACE PICKER
// strip across the top (the six cube-view radios, moved here from the
// document window — one app-level picker serving the ACTIVE document, the
// way the options strip serves one tool), over the whole 3×2 atlas drawn
// nearest-neighbor, scaled to fit the box below the strip (fractional scale
// — never an overflow, never a clip). The windoid is FIXED-size — no grow
// box: shell/windows.js pins its width to the picker block (SPRITE_WIDTH in
// shell/layout.js — grow the picker and re-measure, see the note there) and
// derives its height from the active atlas's ratio, so the atlas fills that
// box exactly — no visible margins; the scale-to-fit here is the safety net
// for degenerate cases (no active document, a mid-refit frame).
//
// A CONNECTED component that FOLLOWS THE ACTIVE DOCUMENT (the utility
// windows serve the active document only): followActive re-wires it across
// activation switches onto that context's doc, BOTH channels:
//   - change (structural): a new sheet / tile size — resize the backing
//     store, re-fit, repaint;
//   - live (stroke-rate, rAF-coalesced): the canonical sheet was just blitted
//     (blit-then-notify), so tracking a stroke is one putImageData per frame
//     — the second live subscriber ever, after the rebuilder, and the same
//     cost class.
// The picker reads the active context's face off the workspace store (a
// StoreController re-renders on any workspace change — a face switch, an
// activation) and a pick routes through workspace.setFace on the ACTIVE key.
// With no active document it just keeps its last pixels — the windoid is
// hidden whenever the application is inactive, so nothing stale ever shows.
// The canvas keeps a native atlas-resolution backing store (CSS scales it
// crisp); a ResizeObserver re-fits when the windoid's derived size changes
// (a document switch to a different atlas ratio).
// ---------------------------------------------------------------------------

import { css, LitElement, html } from 'lit';
import { createRef, ref } from 'lit/directives/ref.js';
import { workspace, followActive } from '../state/workspace.js';
import { StoreController } from '../state/store-controller.js';
import './sm-face-picker.js'; // registers <sm-face-picker>
import { baseStyles } from './base-styles.js';

// The face-picker row order: mirror pairs, so flipping between a pair for
// reference is one step.
const FACES = ['left', 'right', 'front', 'back', 'top', 'bottom'];

export class SmAtlasView extends LitElement {
  static styles = [
    baseStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--sm-artwork);
      }
      /* The picker strip: the status strip's grammar upside down (a white
         band over a 1px black rule), like the 3D View's controls strip.
         Every metric rides --vf-scale (the kit's layout contract — and the
         windoid's fixed geometry is system-px arithmetic, so an unscaled
         padding would break the SPRITE_CHROME math at any scale but 1).
         The windoid's fixed width hugs the picker block exactly, so the
         centering has zero slack — it only absorbs rounding. */
      .picker-strip {
        flex: none;
        display: flex;
        justify-content: center;
        padding: calc(var(--vf-scale, 1) * 8px) calc(var(--vf-scale, 1) * 12px);
        border-bottom: calc(var(--vf-scale, 1) * 1px) solid var(--vf-black, #000);
        background: var(--vf-white, #fff);
        overflow: hidden;
      }
      /* The atlas box: what the strip leaves of the column. The windoid's
         derived geometry makes the fitted canvas fill it exactly; the
         centering only ever absorbs the sub-pixel slack. */
      .atlas-box {
        flex: 1;
        min-height: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }
      canvas {
        image-rendering: pixelated;
        image-rendering: crisp-edges;
        /* The same light transparency checker as the draw canvas, so empty
           texels read as "no color". */
        background-color: #a8a8a8;
        background-image: linear-gradient(
            45deg,
            #d0d0d0 25%,
            transparent 25%,
            transparent 75%,
            #d0d0d0 75%
          ),
          linear-gradient(
            45deg,
            #d0d0d0 25%,
            transparent 25%,
            transparent 75%,
            #d0d0d0 75%
          );
        background-size: 16px 16px;
        background-position:
          0 0,
          8px 8px;
      }
    `,
  ];

  /** @type {import('lit/directives/ref.js').Ref<HTMLCanvasElement>} */
  #canvas = createRef();
  /** @type {import('lit/directives/ref.js').Ref<HTMLElement>} */
  #box = createRef();
  #ctx = null;
  #resizeObs = null;
  #stopFollow = null;
  #atlasW = 0;
  #atlasH = 0;

  constructor() {
    super();
    // The picker's share: re-render on any workspace change (a face switch,
    // an activation) — the pixels themselves ride the doc channels below.
    new StoreController(this, workspace.store);
  }

  connectedCallback() {
    super.connectedCallback();
    // Follow the active document: each activation re-wires both doc channels
    // onto the new context and adopts its sheet immediately.
    this.#stopFollow = followActive(workspace, (ctx) => {
      if (!ctx) return;
      const unsubs = [
        ctx.doc.subscribe(() => this.#syncGeometry()),
        ctx.doc.onLive(() => this.#paint()),
      ];
      if (this.#ctx) this.#syncGeometry();
      return () => unsubs.forEach((u) => u());
    });
    // Setup mirrors disconnectedCallback's teardown: raising any window makes
    // vf-desktop re-order the slotted windows in the light DOM, which
    // disconnects + reconnects this element — everything torn down there must
    // come back here, not in the once-ever firstUpdated. Observing the host
    // needs no refs (the strip is fixed-height, so any box resize is a host
    // resize); #layout() no-ops until the canvas exists.
    if (typeof ResizeObserver !== 'undefined') {
      this.#resizeObs = new ResizeObserver(() => this.#layout());
      this.#resizeObs.observe(this);
    }
    // A reconnect may have missed structural doc changes while unsubscribed.
    if (this.#ctx) this.#syncGeometry();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#stopFollow?.();
    this.#stopFollow = null;
    this.#resizeObs?.disconnect();
    this.#resizeObs = null;
  }

  firstUpdated() {
    this.#ctx = this.#canvas.value.getContext('2d');
    this.#syncGeometry();
  }

  render() {
    const active = workspace.active();
    return html`
      <div class="picker-strip">
        <sm-face-picker
          .faces=${FACES}
          .selected=${active?.face ?? ''}
          @sm-select-face=${this.#onSelectFace}
        ></sm-face-picker>
      </div>
      <div class="atlas-box" ${ref(this.#box)}>
        <canvas ${ref(this.#canvas)}></canvas>
      </div>
    `;
  }

  // A pick switches the ACTIVE document's edited face (the windoid serves
  // whichever document is active, like every utility window).
  #onSelectFace = (e) => {
    const active = workspace.active();
    if (active) workspace.setFace(active.key, e.detail.face);
  };

  // A structural doc change: adopt the sheet's dimensions (an identical size
  // skips the backing-store reset — putImageData covers every pixel anyway),
  // then re-fit and repaint.
  #syncGeometry() {
    const canvas = this.#canvas.value;
    const img = workspace.active()?.doc.get().atlasImage;
    if (!canvas || !img) return;
    if (img.width !== this.#atlasW || img.height !== this.#atlasH) {
      this.#atlasW = canvas.width = img.width;
      this.#atlasH = canvas.height = img.height;
    }
    this.#layout();
    this.#paint();
  }

  // Scale-to-fit the atlas box: the largest (fractional) scale that keeps
  // the whole atlas visible at its own aspect ratio — never an overflow.
  // The windoid's derived geometry makes this an exact fill in the steady
  // state, up to its integer rounding: a sub-pixel residue in either axis
  // stretches away (invisible at <1px, and it keeps the transparency
  // checker from peeking through as an edge hairline).
  #layout() {
    const canvas = this.#canvas.value;
    const box = this.#box.value;
    if (!canvas || !box || !this.#atlasW) return;
    const availW = Math.max(1, box.clientWidth);
    const availH = Math.max(1, box.clientHeight);
    const s = Math.min(availW / this.#atlasW, availH / this.#atlasH);
    const w = this.#atlasW * s;
    const h = this.#atlasH * s;
    const cssW = `${availW - w < 1 ? availW : w}px`;
    const cssH = `${availH - h < 1 ? availH : h}px`;
    if (canvas.style.width === cssW && canvas.style.height === cssH) return;
    canvas.style.width = cssW;
    canvas.style.height = cssH;
  }

  // One blit of the canonical sheet. The live channel fires AFTER the sheet
  // blit (blit-then-notify), so the atlas is always current here.
  #paint() {
    const img = workspace.active()?.doc.get().atlasImage;
    if (!this.#ctx || !img || !this.#atlasW) return;
    const id =
      img instanceof ImageData
        ? img
        : new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
    this.#ctx.putImageData(id, 0, 0);
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-atlas-view'))
  customElements.define('sm-atlas-view', SmAtlasView);
