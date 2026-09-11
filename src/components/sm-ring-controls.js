// ---------------------------------------------------------------------------
// <sm-ring-controls> — the 3D Sprite Atlas windoid's controls strip, slotted
// into the window's HEADER (`slot="header"` — vintage-frames 0.6.1: a band
// between the title bar and the body across the whole window, a white
// interior over a 1px rule, the Finder window's header line; outside the
// scroll area, so the controls never scroll with the row beneath them, and
// a positioning anchor, so a placed child measures from the header's own
// corner). A DITL: the four captions (vf-label, a declared column width
// each, right-aligned so a caption hugs its field) and the four number
// fields — views / elev over from / size, bound live to the ring slice, the
// same settings File → Export Sprite Atlas… edits — each at the top/left
// apps/sprite-editor/layout.js's RING_FIELDS states, in whole system px the kit writes
// as live calc(): two rows 4 in and 4 apart, a caption dropped 4 below its
// row where its baseline meets the field's, an 8 inset, 40 and 36 caption
// columns, 6 gaps, the kit's 74 × 25 number field. Nothing is measured and
// no layout is styled: the header's height is RING_STRIP (the DITL's 62
// over the rule), authored on the window in its markup (the Sprite Editor's
// windows.html) as `header-height` — the kit's grammar — at the same number
// as layout.js's; and that same
// arithmetic is the windoid's width floor (RING_MIN_WIDTH — the
// controls' 258 plus the borders; a window can't be dragged narrower, so
// the header never clips a field).
//
// The slice's fifth setting, the body's PAPER (state/ring.js's `paper` —
// white / black / gray), has NO control here: a third column of radios for
// it was built and retired the same day (2026-09-03, the user's call —
// white is the one paper for now, and the choice is meant to be made for
// the user one day from the sheet's own content, whether it has a lot of
// white or black in it, rather than asked). The plumbing stays for that:
// the slice holds the value and the body paints it.
//
// The host is `display: contents`: the items sit directly in the header,
// their (0,0) its corner. The one stylesheet line beyond the captions'
// alignment is the number field's width — the kit's own token, in the
// field's own em (3.5em of the 16px display face: 56, plus the 3px gap and
// the 15px stepper, the 74 RING_FIELDS states).
//
// A CONNECTED chrome component: the ring slice drives the fields' live()
// values (a StoreController re-renders on any settings change); a change
// in a field is the slice's setter. The body — the row of tiles — is
// <sm-ring-view>, the window's default slot.
// ---------------------------------------------------------------------------

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
      /* No box of its own: the items are placed against the header's corner
         (see the header comment). The number field's width is the kit's
         token, in the field's own em (three digits: "359", "255"). */
      :host {
        display: contents;
        --vf-number-field-width: 3.5em;
      }
      /* A caption hugs its field: right-aligned in its declared column. */
      vf-label {
        text-align: right;
      }
    `,
  ];

  constructor() {
    super();
    // Re-render on any settings change: the fields' values.
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
    `;
  }

  // One DITL item — a caption over its column and a number field — at row
  // `r`, column `c` of RING_FIELDS: the caption's top is its row's plus the
  // shared drop that meets the field's baseline.
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
