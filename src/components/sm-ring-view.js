// <sm-ring-view>: the 3D Sprite Atlas window's body. A one-row vf-grid with
// one cell per view, each size × size system px, the frame drawn at 1:1.
//
// - One vf-container spans the body as its paper, so the pattern stays in
//   phase across cell edges. vf-window has no body pattern of its own.
// - Cells are vf-stacks and the paper always declares a pattern, because a
//   bare vf-container paints the desktop's ink.
// - The window scrolls horizontally. The grid's width sets the scroll range.
// - Pixels don't go through the store. scene/ring.js publishes each rendered
//   sheet on ring.onSheet, and #paint copies one frame per cell.
// - The canvas refs are a fixed pool of RING_MAX_VIEWS. Unused refs are null.

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { createRef, ref } from 'lit/directives/ref.js';
import { ring, RING_MAX_VIEWS, RING_PAPERS } from '../state/ring.js';
import { StoreController } from '../state/store-controller.js';
import { ringYaws } from '../lib/ring.js';
import { baseStyles } from './base-styles.js';

export class SmRingView extends LitElement {
  static styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
      /* Lets the paper show through between and under the tiles. */
      .ring-grid {
        --vf-surface: transparent;
      }
      /* pixelated covers the frame between a size change and the sheet's
         re-render, when the canvas is scaled. */
      canvas {
        display: block;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
      }
    `,
  ];

  /** @type {import('lit/directives/ref.js').Ref<HTMLCanvasElement>[]} */
  #cellCanvas = Array.from({ length: RING_MAX_VIEWS }, () => createRef());
  #offSheet = null;

  constructor() {
    super();
    new StoreController(this, ring.store);
  }

  connectedCallback() {
    super.connectedCallback();
    // Raising the window re-inserts the node, so subscribe on each connect.
    this.#offSheet = ring.onSheet((sheet) => this.#paint(sheet));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#offSheet?.();
    this.#offSheet = null;
  }

  updated() {
    // Paint new cells from the last sheet so they aren't blank until the
    // next render.
    this.#paint(ring.sheet());
  }

  render() {
    const st = ring.get();
    const n = st.views;
    const yaws = ringYaws(n, st.offset);
    // The slice only holds RING_PAPERS keys, so this always resolves.
    const paper = RING_PAPERS[st.paper];
    return html`
      <vf-container class="ring-paper" fill-width height=${st.size} pattern=${paper}>
        <vf-grid
          class="ring-grid"
          columns=${n}
          rows="1"
          cell-width=${st.size}
          cell-height=${st.size}
          rules="none"
          role="group"
          aria-label="3D sprite atlas"
        >
          ${yaws.map(
            (yaw, i) => html`
              <vf-stack
                class="ring-cell"
                width=${st.size}
                height=${st.size}
                role="img"
                title=${`${yaw}°`}
                aria-label=${`view ${i + 1} of ${n}: ${yaw}° yaw`}
              >
                <canvas fill-width fill-height ${ref(this.#cellCanvas[i])}></canvas>
              </vf-stack>
            `
          )}
        </vf-grid>
      </vf-container>
    `;
  }

  // Copies each view's frame into its cell. The canvas is resized only on a
  // change, since a size write clears it. A null sheet clears every cell, and
  // so does a cell past sheet.views while a views change awaits its render.
  #paint(sheet) {
    const n = ring.get().views;
    for (let i = 0; i < n; i++) {
      const canvas = this.#cellCanvas[i].value;
      if (!canvas) continue;
      const g = canvas.getContext('2d');
      if (!sheet) {
        g.clearRect(0, 0, canvas.width, canvas.height);
        continue;
      }
      const F = sheet.frame;
      if (canvas.width !== F || canvas.height !== F) {
        canvas.width = F;
        canvas.height = F;
      }
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, F, F);
      if (i < sheet.views) g.drawImage(sheet.canvas, i * F, 0, F, F, 0, 0, F, F);
    }
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-ring-view'))
  customElements.define('sm-ring-view', SmRingView);
