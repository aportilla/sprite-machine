// ---------------------------------------------------------------------------
// <sm-tool-options> — the draw box's per-tool options bar: the pencil's
// tip-size slider (with a live readout), the eraser's OWN tip-size slider (an
// independent setting and a deliberately separate branch — not a DRY slip; the
// two tools' options may diverge), the rect's corner-radius field, or the
// fill's two checkboxes. A presentational LEAF: props down (`tool`, values +
// clamp BOUNDS — the clamping itself lives in the session actions the
// container calls), bubbling `sm-set-pencil-size {n}` / `sm-set-eraser-size
// {n}` / `sm-set-corner-radius {n}` / `sm-set-fill-opts {contiguous?|allFaces?}`
// events up. `live()` bindings throughout, so a re-render can't skip a re-sync
// after typing.
//
// This element IS the options area (`:host` carries the box — it fills the
// desktop's options strip beside the tool-name caption); its shadow root
// holds the bare controls, exactly the surface drive.mjs probes.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { css, LitElement, html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import { baseStyles } from './base-styles.js';

export class SmToolOptions extends LitElement {
  // The one sm-* host with a REAL box (no `display: contents`): this element
  // IS the options area, so `:host` carries its flex-row layout. The strip
  // around it (sm-options-bar) paints the white band; this host stays
  // chromeless and just lays its controls out.
  static styles = [
    baseStyles,
    css`
      /* Kit-scaled metrics: the strip band is drawn in system px (the kit's
       vfPanel recipe), so the lengths in it ride the same --vf-scale. */
      :host {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: calc(var(--vf-scale, 1) * 12px);
      }
      .editor-size-slider {
        flex: 1;
        max-width: calc(var(--vf-scale, 1) * 260px);
      }
    `,
  ];

  static properties = {
    tool: {},
    pencilSize: { type: Number },
    eraserSize: { type: Number },
    brushMax: { type: Number },
    cornerRadius: { type: Number },
    radiusMax: { type: Number },
    fillContiguous: { type: Boolean },
    fillAllFaces: { type: Boolean },
  };

  constructor() {
    super();
    this.tool = 'pencil';
    this.pencilSize = 1;
    this.eraserSize = 1;
    this.brushMax = 1;
    this.cornerRadius = 0;
    this.radiusMax = 0;
    this.fillContiguous = true;
    this.fillAllFaces = false;
  }

  render() {
    if (this.tool === 'pencil') {
      // vf-input fires on every drag move / key change, so the hover footprint
      // tracks the slider in real time.
      return html`
        <vf-slider
          class="editor-size-slider"
          min="1"
          max=${this.brushMax}
          step="1"
          .value=${live(this.pencilSize)}
          label="pencil size (1–${this.brushMax})"
          @vf-input=${(e) => this.#emit('sm-set-pencil-size', { n: e.detail.value })}
        ></vf-slider>
        <vf-label dim>${this.pencilSize} px</vf-label>
      `;
    }
    if (this.tool === 'eraser') {
      // Mirrors the pencil's slider but binds the eraser's own size — kept as
      // its own branch on purpose (see the header note).
      return html`
        <vf-slider
          class="editor-size-slider"
          min="1"
          max=${this.brushMax}
          step="1"
          .value=${live(this.eraserSize)}
          label="eraser size (1–${this.brushMax})"
          @vf-input=${(e) => this.#emit('sm-set-eraser-size', { n: e.detail.value })}
        ></vf-slider>
        <vf-label dim>${this.eraserSize} px</vf-label>
      `;
    }
    if (this.tool === 'rect') {
      return html`
        <vf-label dim>radius</vf-label>
        <vf-number-field
          min="0"
          max=${this.radiusMax}
          step="1"
          .value=${live(String(this.cornerRadius))}
          label="corner radius (0–${this.radiusMax})"
          @vf-change=${(e) =>
            this.#emit('sm-set-corner-radius', { n: e.detail.valueAsNumber })}
        ></vf-number-field>
      `;
    }
    if (this.tool === 'fill') {
      // "contiguous" (the default) keeps the click a 4-connected flood; off, it
      // recolors every matching texel on the face — and "on all faces" (only
      // meaningful with contiguous off) extends that recolor across the atlas.
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
    return nothing;
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-tool-options'))
  customElements.define('sm-tool-options', SmToolOptions);
