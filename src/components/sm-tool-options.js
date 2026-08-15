// ---------------------------------------------------------------------------
// <sm-tool-options> — the draw box's per-tool options bar: the pencil's
// tip-size slider (with a live readout), the rect's corner-radius field, or the
// fill's two checkboxes. A presentational LEAF: props down (`tool`, values +
// clamp BOUNDS — the clamping itself lives in the session actions the
// container calls), bubbling `sm-set-pencil-size {n}` / `sm-set-corner-radius
// {n}` / `sm-set-fill-opts {replace?|allTiles?}` events up. `live()` bindings
// throughout, so a re-render can't skip a re-sync after typing.
//
// This element IS the options bar (`:host` carries the box); its shadow root
// holds the bare controls, exactly the surface drive.mjs probes.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { css, LitElement, html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import { baseStyles } from './base-styles.js';

export class SmToolOptions extends LitElement {
  // The one sm-* host with a REAL box (no `display: contents`): this element
  // IS the options bar, so `:host` carries its flex-row layout.
  static styles = [
    baseStyles,
    css`
      :host {
        flex: none;
        min-height: 38px;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 6px 12px;
        background: var(--sm-white);
        border-bottom: 1px solid var(--sm-black);
      }
      .editor-size-slider {
        flex: 1;
        max-width: 260px;
      }
    `,
  ];

  static properties = {
    tool: {},
    pencilSize: { type: Number },
    brushMax: { type: Number },
    cornerRadius: { type: Number },
    radiusMax: { type: Number },
    fillReplace: { type: Boolean },
    fillAllTiles: { type: Boolean },
  };

  constructor() {
    super();
    this.tool = 'pencil';
    this.pencilSize = 1;
    this.brushMax = 1;
    this.cornerRadius = 0;
    this.radiusMax = 0;
    this.fillReplace = false;
    this.fillAllTiles = false;
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
      // "replace" upgrades the flood to a whole-tile recolor of every matching
      // texel; "all tiles" (only meaningful with replace on) extends that across
      // the atlas.
      return html`
        <vf-checkbox
          .checked=${live(this.fillReplace)}
          title="recolor every matching texel on this tile (not just the contiguous region)"
          @vf-change=${(e) =>
            this.#emit('sm-set-fill-opts', { replace: !!e.detail.checked })}
          >replace</vf-checkbox
        >
        <vf-checkbox
          .checked=${live(this.fillAllTiles)}
          ?disabled=${!this.fillReplace}
          title="replace the clicked color across every tile in the atlas"
          @vf-change=${(e) =>
            this.#emit('sm-set-fill-opts', { allTiles: !!e.detail.checked })}
          >all tiles</vf-checkbox
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
