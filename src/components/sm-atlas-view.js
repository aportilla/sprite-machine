// ---------------------------------------------------------------------------
// <sm-atlas-view> — the Full Sprite View window's body: the whole 3×2 atlas
// drawn nearest-neighbor, scaled to fit the window as large as its aspect
// ratio allows (fractional scale — never an overflow, never a clip).
// A CONNECTED leaf that FOLLOWS THE ACTIVE DOCUMENT (the utility windows
// serve the active document only): followActive re-wires it across
// activation switches onto that context's doc, BOTH channels:
//   - change (structural): a new sheet / tile size — resize the backing
//     store, re-fit, repaint;
//   - live (stroke-rate, rAF-coalesced): the canonical sheet was just blitted
//     (blit-then-notify), so tracking a stroke is one putImageData per frame
//     — the second live subscriber ever, after the rebuilder, and the same
//     cost class.
// With no active document it just keeps its last pixels — the windoid is
// hidden whenever the application is inactive, so nothing stale ever shows.
// The canvas keeps a native atlas-resolution backing store (CSS scales it
// crisp); a ResizeObserver re-fits on any window resize, so the grow box
// works for free.
// ---------------------------------------------------------------------------

import { css, LitElement, html } from 'lit';
import { createRef, ref } from 'lit/directives/ref.js';
import { workspace, followActive } from '../state/workspace.js';
import { baseStyles } from './base-styles.js';

export class SmAtlasView extends LitElement {
  static styles = [
    baseStyles,
    css`
      :host {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        padding: 10px;
        overflow: hidden;
        background: var(--sm-artwork);
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
  #ctx = null;
  #resizeObs = null;
  #stopFollow = null;
  #atlasW = 0;
  #atlasH = 0;
  #scale = 0;

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
    // needs no refs; #layout() no-ops until the canvas exists.
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
    return html`<canvas ${ref(this.#canvas)}></canvas>`;
  }

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
      this.#scale = 0; // force #layout to re-fit for the new aspect
    }
    this.#layout();
    this.#paint();
  }

  // Scale-to-fit the host's content box: the largest (fractional) scale that
  // keeps the whole atlas visible at its own aspect ratio — never an overflow.
  #layout() {
    const canvas = this.#canvas.value;
    if (!canvas || !this.#atlasW) return;
    const cs = getComputedStyle(this);
    const availW = Math.max(
      1,
      this.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    );
    const availH = Math.max(
      1,
      this.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
    );
    const s = Math.min(availW / this.#atlasW, availH / this.#atlasH);
    if (s === this.#scale) return;
    this.#scale = s;
    canvas.style.width = `${this.#atlasW * s}px`;
    canvas.style.height = `${this.#atlasH * s}px`;
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
