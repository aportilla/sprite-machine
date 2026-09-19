// <sm-palette-view>: the Color Palette windoid's body. The active document's
// colors (lib/palette.js documentColors) as a grid of square swatches sized to
// the window (layout.js paletteGrid): as many columns as the width fits, and
// empty cells in the rows the swatches leave. The ink's swatch is ringed. A
// swatch picks its color on the press, like a Tools palette cell, or on the
// release under a finger (press-pick.js).
//
// The sheet is scanned on each doc notification, and the component re-renders
// only when the list or the window's size changes. A change in the number of
// swatches fires sm-palette-count.

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { session } from '../state/session.js';
import { workspace, followActive } from '../state/workspace.js';
import { StoreController } from '../state/store-controller.js';
import { documentColors, paletteName } from '../lib/palette.js';
import { rgbKey, rgbToHex } from '../lib/color.js';
import { PALETTE_CELL, paletteGrid } from '../apps/sprite-editor/layout.js';
import { baseStyles } from './base-styles.js';
import { pressPick } from './press-pick.js';

export class SmPaletteView extends LitElement {
  static styles = [
    baseStyles,
    css`
      /* The scrolled plane: as wide as the viewport, never the grid, and
         paletteGrid's height, set in willUpdate. The lines around the grid land
         one pixel outside it, on the window frame, the rail's divider and the
         status strip's rule when they reach them, and the clip keeps those
         pixels out of the scroll range. Positioned, so the placed grid anchors
         to it and the clip reaches it. */
      :host {
        display: block;
        position: relative;
        contain: inline-size;
        overflow: clip;
      }
      /* The closing lines of the empty cells, which a frameless grid leaves
         out. */
      vf-grid::part(grid) {
        outline: calc(var(--vf-scale, 1) * 1px) solid var(--vf-black, #000);
      }
      /* The ink's swatch: black over the white inset, then 1px of white inside
         it, Desktop Patterns' ring. */
      vf-swatch.ink::part(button) {
        background: var(--vf-black, #000);
      }
      vf-swatch.ink::part(fill) {
        outline: calc(var(--vf-scale, 1) * 1px) solid var(--vf-white, #fff);
        outline-offset: calc(var(--vf-scale, 1) * -1px);
      }
    `,
  ];

  /** @type {{r:number,g:number,b:number}[]} in documentColors' order */
  #colors = [];
  /** The window's size, whole system px. */
  #size = { width: 0, height: 0 };
  /** @type {ReturnType<typeof paletteGrid>} */
  #grid = paletteGrid(0, 0, 0);
  #stop = null;

  constructor() {
    super();
    // The ink's ring.
    new StoreController(this, session.store);
  }

  /** The number of swatches listed. */
  get count() {
    return this.#colors.length;
  }

  connectedCallback() {
    super.connectedCallback();
    // vf-desktop reconnects a window when it re-orders them on a raise, so the
    // doc channels are wired on every connect.
    const stopFollow = followActive(workspace, (ctx) => {
      if (!ctx) return;
      const unsubs = [
        ctx.doc.subscribe(() => this.#scan()),
        ctx.doc.onLive(() => this.#scan()),
      ];
      this.#scan();
      return () => unsubs.forEach((u) => u());
    });
    // Arrange and a browser resize write the window's size without a vf-resize,
    // so the window's box is observed.
    const win = this.closest('vf-window');
    const fit = () => {
      const width = win?.width ?? 0;
      const height = win?.height ?? 0;
      if (width === this.#size.width && height === this.#size.height) return;
      this.#size = { width, height };
      this.requestUpdate();
    };
    const observer =
      win && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    observer?.observe(win);
    fit();
    this.#stop = () => {
      stopFollow();
      observer?.disconnect();
    };
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#stop?.();
    this.#stop = null;
  }

  #scan() {
    const sheet = workspace.active()?.doc.get().atlasImage;
    if (!sheet) return;
    const next = documentColors(sheet);
    const prev = this.#colors;
    if (
      next.length === prev.length &&
      next.every((c, i) => rgbKey(c) === rgbKey(prev[i]))
    ) {
      return;
    }
    this.#colors = next;
    this.requestUpdate();
    if (next.length !== prev.length) {
      this.dispatchEvent(new CustomEvent('sm-palette-count', { bubbles: true }));
    }
  }

  willUpdate() {
    const { width, height } = this.#size;
    this.#grid = paletteGrid(width, height, this.#colors.length);
    this.style.height = `calc(var(--vf-scale, 1) * ${this.#grid.height}px)`;
  }

  render() {
    const ink = rgbKey(session.get().ink);
    const grid = this.#grid;
    return html`
      <vf-grid
        top="0"
        left="0"
        columns=${grid.columns}
        rows=${grid.rows}
        cell-width=${PALETTE_CELL}
        cell-height=${PALETTE_CELL}
        frameless
        collapse
        role="group"
        aria-label="palette"
      >
        ${this.#colors.map((c) => {
          const hex = rgbToHex(c);
          const name = paletteName(c);
          return html`<vf-swatch
            class=${classMap({ ink: rgbKey(c) === ink })}
            width=${PALETTE_CELL + 2}
            height=${PALETTE_CELL + 2}
            color=${hex}
            label=${name ?? hex}
            title=${name ? `${name} ${hex}` : hex}
            @pointerdown=${(e) => this.#onPress(e, c)}
            @click=${() => this.#pick(c)}
          ></vf-swatch>`;
        })}
      </vf-grid>
    `;
  }

  #onPress(e, color) {
    pressPick(e, () => this.#pick(color));
  }

  // A no-op when the color is the ink and the eraser is not the tool, so the
  // click after a press does nothing. Keyboard activation picks through the
  // click.
  #pick(color) {
    const { ink, tool } = session.get();
    if (tool !== 'eraser' && rgbKey(ink) === rgbKey(color)) return;
    session.pickColor(color);
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-palette-view'))
  customElements.define('sm-palette-view', SmPaletteView);
