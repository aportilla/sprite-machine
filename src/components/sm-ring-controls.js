// <sm-ring-controls>: the 3D Sprite Atlas window's header controls. Four
// captioned number fields (views, elev, from, size) bound live to the ring
// slice, and an Export button that fires sm-export-atlas, placed at RING_FIELDS
// (apps/sprite-editor/layout.js) in system px.
// The header-height in the Sprite Editor's windows.html must match RING_STRIP.

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { live } from 'lit/directives/live.js';
import { ring, RING_MAX_VIEWS, RING_MIN_SIZE, RING_MAX_SIZE } from '../state/ring.js';
import { StoreController } from '../state/store-controller.js';
import { RING_FIELDS } from '../apps/sprite-editor/layout.js';
import { baseStyles } from './base-styles.js';

export class SmRingControls extends LitElement {
  static styles = [
    baseStyles,
    css`
      /* Items are placed against the header's corner. 3.5em fits three
         digits and gives the 74 px field RING_FIELDS assumes. */
      :host {
        display: contents;
        --vf-number-field-width: 3.5em;
      }
      vf-label {
        text-align: right;
      }
    `,
  ];

  constructor() {
    super();
    new StoreController(this, ring.store);
  }

  render() {
    const st = ring.get();
    return html`
      ${this.#item(0, 0, 'ring-views', 'views', {
        min: 1,
        max: RING_MAX_VIEWS,
        value: st.views,
        label: `views (1–${RING_MAX_VIEWS}): the ring's angle count, a 360/n step`,
        set: (v) => ring.setViews(v),
      })}
      ${this.#item(0, 1, 'ring-elev', 'elev', {
        min: 0,
        max: 90,
        value: st.elevation,
        label: 'elevation (0–90): degrees above the horizon',
        set: (v) => ring.setElevation(v),
      })}
      ${this.#item(1, 0, 'ring-offset', 'from', {
        min: 0,
        max: 359,
        value: st.offset,
        label: 'first angle (0–359): degrees from the front',
        set: (v) => ring.setOffset(v),
      })}
      ${this.#item(1, 1, 'ring-size', 'size', {
        min: RING_MIN_SIZE,
        max: RING_MAX_SIZE,
        value: st.size,
        label: `size (${RING_MIN_SIZE}–${RING_MAX_SIZE}): the tile's edge in px`,
        set: (v) => ring.setSize(v),
      })}
      <vf-button
        class="ring-export"
        left=${RING_FIELDS.button.left}
        top=${RING_FIELDS.button.top}
        @click=${() =>
          this.dispatchEvent(new CustomEvent('sm-export-atlas', { bubbles: true }))}
        >Export…</vf-button
      >
    `;
  }

  // A caption and number field at row r, column c of RING_FIELDS. The caption
  // drops captionDy to share the field's baseline.
  #item(r, c, cls, caption, { min, max, value, label, set }) {
    const { rows, cols, captionDy } = RING_FIELDS;
    const col = cols[c];
    return html`
      <vf-label dim left=${col.caption} top=${rows[r] + captionDy} width=${col.width}
        >${caption}</vf-label
      >
      <vf-number-field
        class=${cls}
        left=${col.field}
        top=${rows[r]}
        min=${min}
        max=${max}
        step="1"
        .value=${live(String(value))}
        label=${label}
        @vf-change=${(e) => set(e.detail.valueAsNumber)}
      ></vf-number-field>
    `;
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-ring-controls'))
  customElements.define('sm-ring-controls', SmRingControls);
