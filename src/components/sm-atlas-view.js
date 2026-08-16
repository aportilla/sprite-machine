// ---------------------------------------------------------------------------
// <sm-atlas-view> — the Full Sprite View window's body: the whole 3×2 atlas
// drawn nearest-neighbor at the largest integer scale that fits the window.
// A CONNECTED leaf over the doc alone — it subscribes to BOTH channels:
//   - change (structural): a new sheet / tile size — resize the backing
//     store, re-fit, repaint;
//   - live (stroke-rate, rAF-coalesced): the canonical sheet was just blitted
//     (blit-then-notify), so tracking a stroke is one putImageData per frame
//     — the second live subscriber ever, after the rebuilder, and the same
//     cost class.
// The canvas keeps a native atlas-resolution backing store (CSS upscales it
// crisp); a ResizeObserver re-fits on any window resize, so the grow box
// works for free.
// ---------------------------------------------------------------------------

import { css, LitElement, html } from 'lit';
import { createRef, ref } from 'lit/directives/ref.js';
import { doc } from '../state/doc.js';
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
  #unsubs = [];
  #atlasW = 0;
  #atlasH = 0;
  #scale = 0;

  connectedCallback() {
    super.connectedCallback();
    this.#unsubs = [
      doc.subscribe(() => this.#syncGeometry()),
      doc.onLive(() => this.#paint()),
    ];
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    for (const u of this.#unsubs) u();
    this.#unsubs = [];
    this.#resizeObs?.disconnect();
    this.#resizeObs = null;
  }

  firstUpdated() {
    this.#ctx = this.#canvas.value.getContext('2d');
    if (typeof ResizeObserver !== 'undefined') {
      this.#resizeObs = new ResizeObserver(() => this.#layout());
      this.#resizeObs.observe(this);
    }
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
    const img = doc.get().atlasImage;
    if (!canvas || !img) return;
    if (img.width !== this.#atlasW || img.height !== this.#atlasH) {
      this.#atlasW = canvas.width = img.width;
      this.#atlasH = canvas.height = img.height;
      this.#scale = 0; // force #layout to re-fit for the new aspect
    }
    this.#layout();
    this.#paint();
  }

  // The largest integer scale that fits the host's content box (min 1; the
  // host clips an overflow on a tiny window).
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
    const s = Math.max(
      1,
      Math.floor(Math.min(availW / this.#atlasW, availH / this.#atlasH)) || 1
    );
    if (s === this.#scale) return;
    this.#scale = s;
    canvas.style.width = `${this.#atlasW * s}px`;
    canvas.style.height = `${this.#atlasH * s}px`;
  }

  // One blit of the canonical sheet. The live channel fires AFTER the sheet
  // blit (blit-then-notify), so the atlas is always current here.
  #paint() {
    const img = doc.get().atlasImage;
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
