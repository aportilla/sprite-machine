// ---------------------------------------------------------------------------
// <sm-face-picker> — six pixel-art cube-view icons (vf-img, see face-icons.js)
// over a vf-radio-group, laid out as mirror pairs by `faces`. The checked
// face's icon takes the "selected" dither overlay (CSS, off vf-radio's
// reflected `checked`). A presentational LEAF: props down (`faces`,
// `selected`), one bubbling `sm-select-face {face}` event up — no store
// imports, no doc knowledge.
//
// LIGHT DOM + `display: contents`, so `.editor-face-picker` keeps its box in
// the settings row.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { LitElement, html } from 'lit';
import { faceIcon } from '../face-icons.js';

export class SmFacePicker extends LitElement {
  static properties = {
    faces: { attribute: false },
    selected: {},
  };

  constructor() {
    super();
    /** @type {string[]|null} */
    this.faces = null;
    this.selected = '';
  }

  createRenderRoot() {
    return this; // light DOM — style.css + `capture.sh dom` keep working
  }

  render() {
    const faces = this.faces || [this.selected];
    return html`
      <vf-radio-group
        class="editor-face-picker"
        label="edit face"
        .value=${this.selected}
        @vf-change=${this.#onPick}
      >
        <div class="editor-face-row">
          ${faces.map(
            (f) => html`
              <div
                class="editor-face-cell"
                title=${f}
                @click=${(e) => this.#onCellClick(e, f)}
              >
                ${faceIcon(f)}
                <vf-radio value=${f} aria-label=${f}></vf-radio>
              </div>
            `
          )}
        </div>
      </vf-radio-group>
    `;
  }

  #onPick = (e) => {
    const f = /** @type {CustomEvent} */ (e).detail.value;
    if (f && f !== this.selected) this.#emit(f);
  };

  // The cube icon is a click target too; the radio's own click already routes
  // through the group's vf-change, so skip it here to avoid a double switch.
  #onCellClick(e, f) {
    if (/** @type {Element} */ (e.target).closest?.('vf-radio')) return;
    if (f !== this.selected) this.#emit(f);
  }

  #emit(face) {
    this.dispatchEvent(
      new CustomEvent('sm-select-face', { detail: { face }, bubbles: true })
    );
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-face-picker'))
  customElements.define('sm-face-picker', SmFacePicker);
