// ---------------------------------------------------------------------------
// <sm-options-bar> — the full-width white band under the menu bar: the active
// tool's name plus the per-tool options (<sm-tool-options>: pencil/eraser tip
// sliders, rect radius stepper, fill checkboxes). A fixed strip, not a window
// — always present, blank-ish when a tool has no options (the standing
// preference for persistent, in-flow controls over popups).
//
// A CONNECTED chrome component: session (tool + option values) and doc (the
// clamp bounds derive from the live tile geometry) drive it; every leaf event
// becomes a session action. `:host` IS the strip — the desktop lays it out in
// flow right under the menu bar.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { maxCornerRadius } from '../lib/rect.js';
import { session } from '../state/session.js';
import { doc } from '../state/doc.js';
import { StoreController } from '../state/store-controller.js';
import { baseStyles } from './base-styles.js';
import './sm-tool-options.js'; // registers <sm-tool-options>

const TOOL_NAME = {
  pencil: 'Pencil Tool',
  rect: 'Rectangle Tool',
  fill: 'Fill Tool',
  eraser: 'Eraser Tool',
  eyedropper: 'Eyedropper Tool',
};

export class SmOptionsBar extends LitElement {
  static styles = [
    baseStyles,
    css`
      :host {
        display: flex;
        align-items: center;
        gap: 24px;
        height: 28px;
        padding: 0 14px;
        background: var(--sm-white);
        border-bottom: 1px solid var(--sm-black);
      }
      .tool-name {
        flex: none;
        min-width: 120px;
      }
    `,
  ];

  constructor() {
    super();
    new StoreController(this, session.store);
    new StoreController(this, doc.store);
  }

  // The same geometric bounds the old editor derived: tips capped at the tile
  // edge, the radius at half the shorter side (the clamping itself lives in
  // the session actions).
  get #brushMax() {
    const d = doc.get();
    return Math.max(1, Math.min(d.tileW || 1, d.tileH || 1));
  }
  get #radiusMax() {
    const d = doc.get();
    return maxCornerRadius(d.tileW || 1, d.tileH || 1);
  }

  render() {
    const s = session.get();
    return html`
      <vf-label class="tool-name">${TOOL_NAME[s.tool] ?? ''}</vf-label>
      <sm-tool-options
        .tool=${s.tool}
        .pencilSize=${s.pencilSize}
        .eraserSize=${s.eraserSize}
        .brushMax=${this.#brushMax}
        .cornerRadius=${s.cornerRadius}
        .radiusMax=${this.#radiusMax}
        .fillReplace=${s.fillReplace}
        .fillAllTiles=${s.fillAllTiles}
        @sm-set-pencil-size=${(e) => session.setPencilSize(e.detail.n, this.#brushMax)}
        @sm-set-eraser-size=${(e) => session.setEraserSize(e.detail.n, this.#brushMax)}
        @sm-set-corner-radius=${(e) =>
          session.setCornerRadius(e.detail.n, this.#radiusMax)}
        @sm-set-fill-opts=${this.#onFillOpts}
      ></sm-tool-options>
    `;
  }

  #onFillOpts = (e) => {
    const { replace, allTiles } = e.detail;
    if (replace !== undefined) session.setFillReplace(replace);
    if (allTiles !== undefined) session.setFillAllTiles(allTiles);
  };
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-options-bar'))
  customElements.define('sm-options-bar', SmOptionsBar);
