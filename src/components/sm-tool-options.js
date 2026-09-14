// <sm-tool-options>: the per-tool controls in the options strip. Props carry
// the clamp bounds, and the session actions do the clamping. Emits
// sm-set-pencil-size {n}, sm-set-pencil-shape {shape}, sm-set-eraser-size {n},
// sm-set-eraser-shape {shape}, sm-set-corner-radius {n},
// sm-set-fill-opts {contiguous?, allFaces?} and sm-flip-selection {axis}.
//
// live() bindings re-sync the controls after typing or a rejected pick.
// A vertical separator goes only between different things, such as the rect's
// radius field and its readout.

import 'vintage-frames';
import { css, LitElement, html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import { PENCIL_SHAPES } from '../lib/brush.js';
import { baseStyles } from './base-styles.js';

export class SmToolOptions extends LitElement {
  static styles = [
    baseStyles,
    css`
      :host {
        flex: 1;
        min-width: 0;
        /* The parent row centers its children. Stretch so a vertical
           separator in here spans the band's full height. */
        align-self: stretch;
        display: flex;
        align-items: center;
        gap: calc(var(--vf-scale, 1) * 12px);
      }
      /* flex: 1 under the cap lets the slider shrink on a small raster. */
      .editor-size-slider {
        flex: 1;
        max-width: calc(var(--vf-scale, 1) * 130px);
      }
      /* Room for "64 × 64" in the display face (8 px digits, 15 px for " × "),
         so the flip buttons hold still. A wider size pushes them right. */
      .editor-select-size {
        flex: none;
        min-width: calc(var(--vf-scale, 1) * 47px);
      }
    `,
  ];

  static properties = {
    tool: {},
    pencilSize: { type: Number },
    /** The pencil's tip shape: one of lib/brush.js PENCIL_SHAPES. */
    pencilShape: {},
    eraserSize: { type: Number },
    /** The eraser's tip shape, also one of PENCIL_SHAPES. */
    eraserShape: {},
    brushMax: { type: Number },
    cornerRadius: { type: Number },
    radiusMax: { type: Number },
    fillContiguous: { type: Boolean },
    fillAllFaces: { type: Boolean },
    /** The active window's marquee {x0,y0,x1,y1} in texels, or null. It may
     *  extend past the tile. */
    selection: { attribute: false },
    /** The active window's rect drag {x0,y0,x1,y1} in texels, with the Shift
     *  square-lock applied, or null between drags. */
    rectDrag: { attribute: false },
  };

  constructor() {
    super();
    this.tool = 'pencil';
    this.pencilSize = 1;
    this.pencilShape = 'circle';
    this.eraserSize = 1;
    this.eraserShape = 'circle';
    this.brushMax = 1;
    this.cornerRadius = 0;
    this.radiusMax = 0;
    this.fillContiguous = true;
    this.fillAllFaces = false;
    this.selection = null;
    this.rectDrag = null;
  }

  /** A box's size as `width × height` in texels (inclusive bounds), or
   *  `0 × 0` for null. */
  static size(b) {
    return b ? `${b.x1 - b.x0 + 1} × ${b.y1 - b.y0 + 1}` : '0 × 0';
  }

  /** Whether the tool shows any options. Only the eyedropper has none. */
  static hasOptions(tool) {
    return tool !== 'eyedropper';
  }

  // The tip-shape popup for the pencil and the eraser.
  #shapePopup(value, label, event) {
    return html`
      <vf-select
        class="editor-tip-shape"
        .value=${live(value)}
        label=${label}
        @vf-change=${(e) => this.#emit(event, { shape: e.detail.value })}
      >
        ${PENCIL_SHAPES.map((s) => html`<vf-option value=${s}>${s}</vf-option>`)}
      </vf-select>
    `;
  }

  render() {
    if (this.tool === 'pencil') {
      // vf-input fires on every drag move, so the hover footprint tracks the
      // slider.
      return html`
        ${this.#shapePopup(this.pencilShape, 'pencil tip shape', 'sm-set-pencil-shape')}
        <vf-slider
          class="editor-size-slider"
          min="1"
          max=${this.brushMax}
          step="1"
          .value=${live(this.pencilSize)}
          label="pencil size (1–${this.brushMax})"
          @vf-input=${(e) => this.#emit('sm-set-pencil-size', { n: e.detail.value })}
        ></vf-slider>
        <vf-label>${this.pencilSize} px</vf-label>
      `;
    }
    if (this.tool === 'eraser') {
      // The pencil's controls, bound to the eraser's own settings.
      return html`
        ${this.#shapePopup(this.eraserShape, 'eraser tip shape', 'sm-set-eraser-shape')}
        <vf-slider
          class="editor-size-slider"
          min="1"
          max=${this.brushMax}
          step="1"
          .value=${live(this.eraserSize)}
          label="eraser size (1–${this.brushMax})"
          @vf-input=${(e) => this.#emit('sm-set-eraser-size', { n: e.detail.value })}
        ></vf-slider>
        <vf-label>${this.eraserSize} px</vf-label>
      `;
    }
    if (this.tool === 'rect') {
      // The readout always renders, so nothing shifts when a drag begins.
      return html`
        <vf-label>radius</vf-label>
        <vf-number-field
          min="0"
          max=${this.radiusMax}
          step="1"
          .value=${live(String(this.cornerRadius))}
          label="corner radius (0–${this.radiusMax})"
          @vf-change=${(e) =>
            this.#emit('sm-set-corner-radius', { n: e.detail.valueAsNumber })}
        ></vf-number-field>
        <vf-separator vertical></vf-separator>
        <vf-label title="rectangle: width × height (texels)"
          >${SmToolOptions.size(this.rectDrag)}</vf-label
        >
      `;
    }
    if (this.tool === 'fill') {
      return html`
        <vf-checkbox
          .checked=${live(this.fillContiguous)}
          title="fill only the connected region sharing the clicked color; off recolors every matching texel on the face"
          @vf-change=${(e) =>
            this.#emit('sm-set-fill-opts', { contiguous: !!e.detail.checked })}
          >contiguous</vf-checkbox
        >
        <vf-checkbox
          .checked=${live(this.fillAllFaces)}
          ?disabled=${this.fillContiguous}
          title="recolor the clicked color across every face in the atlas"
          @vf-change=${(e) =>
            this.#emit('sm-set-fill-opts', { allFaces: !!e.detail.checked })}
          >on all faces</vf-checkbox
        >
      `;
    }
    if (this.tool === 'select') {
      // The full marquee size, including any part moved off the tile.
      return html`
        <vf-label class="editor-select-size" title="selection: width × height (texels)"
          >${SmToolOptions.size(this.selection)}</vf-label
        >
        <vf-separator vertical></vf-separator>
        <vf-button
          ?disabled=${!this.selection}
          @click=${() => this.#emit('sm-flip-selection', { axis: 'horizontal' })}
          >Flip Horizontal</vf-button
        >
        <vf-button
          ?disabled=${!this.selection}
          @click=${() => this.#emit('sm-flip-selection', { axis: 'vertical' })}
          >Flip Vertical</vf-button
        >
      `;
    }
    return nothing;
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-tool-options'))
  customElements.define('sm-tool-options', SmToolOptions);
