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
import { shell } from '../state/shell.js';
import { workspace } from '../state/workspace.js';
import { StoreController, ActiveDocController } from '../state/store-controller.js';
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
    new StoreController(this, shell.store);
    // The clamp bounds derive from the ACTIVE document's tile geometry — the
    // strip's controls apply to whichever window is being edited.
    new ActiveDocController(this, workspace);
  }

  // The same geometric bounds the editor derives: tips capped at the tile
  // edge, the radius at half the shorter side (the clamping itself lives in
  // the session actions).
  get #activeDoc() {
    return workspace.active()?.doc.get() ?? null;
  }
  get #brushMax() {
    const d = this.#activeDoc;
    return Math.max(1, Math.min(d?.tileW || 1, d?.tileH || 1));
  }
  get #radiusMax() {
    const d = this.#activeDoc;
    return maxCornerRadius(d?.tileW || 1, d?.tileH || 1);
  }

  render() {
    // Desktop focused: the strip belongs to the application, so its content
    // clears — the band itself stays (it's structural chrome the window
    // clamp reserves space under), an empty white run like an app with no
    // tool showing.
    if (!shell.get().appActive) return html``;
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
