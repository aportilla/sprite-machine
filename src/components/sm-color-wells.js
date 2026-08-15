// ---------------------------------------------------------------------------
// <sm-color-wells> — the rail's color group: the current-ink vf-swatch (a click
// asks to open the 256-color picker), the "last used colors" row under it, and
// the transparent checker swatch (the empty / clear "color", not an eraser
// tool). A presentational LEAF: props down (`ink`, `erase`, `recent` — the
// already-sliced last-used row), bubbling `sm-pick-color {rgb}` /
// `sm-pick-transparent` / `sm-open-picker` events up.
//
// LIGHT DOM + `display: contents`, so `.editor-colors` keeps its box.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { LitElement, html } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { repeat } from 'lit/directives/repeat.js';
import { rgbKey } from '../lib/color.js';

const toHex2 = (n) => n.toString(16).padStart(2, '0');
const rgbHex = ({ r, g, b }) => `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;

export class SmColorWells extends LitElement {
  static properties = {
    ink: { attribute: false },
    erase: { type: Boolean },
    recent: { attribute: false },
  };

  constructor() {
    super();
    /** @type {{r:number,g:number,b:number}|null} */
    this.ink = null;
    this.erase = false;
    /** @type {{r:number,g:number,b:number}[]} the last-used row (slot 0 excluded) */
    this.recent = [];
  }

  createRenderRoot() {
    return this; // light DOM — style.css + `capture.sh dom` keep working
  }

  // The current-ink swatch doubles as the picker opener (a click drops the
  // 256-color dialog). While the transparent ink is active it shows the kit's
  // no-color checker — the same "empty color" the canvas shows through unpainted
  // texels — which is just the `color` attribute going away.
  render() {
    const clear = this.erase;
    const inkHex = clear || !this.ink ? undefined : rgbHex(this.ink);
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
        <vf-swatch
          class=${classMap({ 'editor-transparent': true, active: clear })}
          width="16"
          height="16"
          label="transparent (clear) color"
          title="transparent — paint the empty / clear color (E, or right-click)"
          @click=${() => this.#emit('sm-pick-transparent')}
        ></vf-swatch>
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
