// ---------------------------------------------------------------------------
// <sm-color-wells> — the rail's color group: the current-ink vf-swatch (a click
// asks to open the 256-color picker) and the "last used colors" row under it.
// Purely COLOR — erasing is the eraser tool in the strip, so the ink here is
// always a solid color. A presentational LEAF: props down (`ink`, `recent` —
// the already-sliced last-used row), bubbling `sm-pick-color {rgb}` /
// `sm-open-picker` events up.
//
// Shadow DOM; `:host { display: contents }`, so the wells sit in the rail
// directly.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { repeat } from 'lit/directives/repeat.js';
import { rgbKey } from '../lib/color.js';
import { baseStyles } from './base-styles.js';

const toHex2 = (n) => n.toString(16).padStart(2, '0');
const rgbHex = ({ r, g, b }) => `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;

export class SmColorWells extends LitElement {
  static styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
      /* Color wells: current ink over the last-used row. */
      .editor-colors {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
      }
      .editor-recent {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
    `,
  ];

  static properties = {
    ink: { attribute: false },
    recent: { attribute: false },
  };

  constructor() {
    super();
    /** @type {{r:number,g:number,b:number}|null} */
    this.ink = null;
    /** @type {{r:number,g:number,b:number}[]} the last-used row (slot 0 excluded) */
    this.recent = [];
  }

  // The current-ink swatch doubles as the picker opener (a click drops the
  // 256-color dialog).
  render() {
    const inkHex = this.ink ? rgbHex(this.ink) : undefined;
    return html`
      <div class="editor-colors">
        <vf-swatch
          class="editor-selected"
          width="40"
          height="28"
          color=${ifDefined(inkHex)}
          label="selected color — open the color picker"
          title="selected color — open the color picker"
          @click=${() => this.#emit('sm-open-picker')}
        ></vf-swatch>
        <div class="editor-recent">${this.#recentRow()}</div>
      </div>
    `;
  }

  // The "last used colors" under the current swatch. Keyed by color, so a
  // promotion moves a swatch instead of rebuilding the row.
  #recentRow() {
    return repeat(this.recent, rgbKey, (c) => {
      const hex = rgbHex(c);
      return html`<vf-swatch
        width="16"
        height="16"
        color=${hex}
        label=${hex}
        title=${hex}
        @click=${() => this.#emit('sm-pick-color', { rgb: c })}
      ></vf-swatch>`;
    });
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-color-wells'))
  customElements.define('sm-color-wells', SmColorWells);
