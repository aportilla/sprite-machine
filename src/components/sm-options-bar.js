// ---------------------------------------------------------------------------
// <sm-options-bar> — the settings strip under the menu bar: the active tool's
// name, the current-ink swatch (every tool but the eraser — clicking it opens
// the Colors dialog), and the per-tool options (<sm-tool-options>:
// pencil/eraser tip sliders, rect radius stepper, fill checkboxes). A fixed
// strip, not a window — blank-ish when a tool has no options (the standing
// preference for persistent, in-flow controls over popups), and — like the
// utility windoids — on screen only while the application is active: a
// desktop click hides the whole band, and it returns with the app.
//
// THE BAND IS A KIT PANEL: the strip composes the kit's exported `vfPanel`
// recipe (`.vf-panel` — white surface, a `calc(--vf-scale × 1px)` black
// border, the shared hard shadow), so its edge is drawn at the kit's own
// width and every metric here rides --vf-scale with it. One system px of
// negative margin merges the panel's top border with the menu bar's bottom
// rule and tucks the side borders past the raster's edges (the kit's flush
// composition idiom), leaving the bottom rule + shadow as the strip's edge.
//
// A CONNECTED chrome component: session (tool + ink + option values) and doc
// (the clamp bounds derive from the live tile geometry) drive it; every leaf
// event becomes a session action. `:host` IS the strip — the desktop lays it
// out in flow right under the menu bar (shell/windows.js's TOP_RESERVE keeps
// the window tier clear of the band).
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { vfPanel } from 'vintage-frames';
import { css, LitElement, html, nothing } from 'lit';
import { maxCornerRadius } from '../lib/rect.js';
import { rgbToHex } from '../lib/color.js';
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
    vfPanel,
    css`
      :host {
        display: block;
      }
      /* The band (see header): 37 system px tall, its top border riding the
       menu bar's rule, so its box bottoms out exactly at TOP_RESERVE. */
      .strip {
        display: flex;
        align-items: center;
        gap: calc(var(--vf-scale, 1) * 24px);
        height: calc(var(--vf-scale, 1) * 37px);
        width: calc(100% + var(--vf-scale, 1) * 2px);
        margin: calc(var(--vf-scale, 1) * -1px) 0 0 calc(var(--vf-scale, 1) * -1px);
        padding: 0 calc(var(--vf-scale, 1) * 14px);
      }
      .tool-name {
        flex: none;
        min-width: calc(var(--vf-scale, 1) * 120px);
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
    // Desktop focused: the strip belongs to the application, so — like the
    // utility windoids — the whole band hides (the desktop dither runs right
    // up to the menu bar, the Finder look), returning with the app. The
    // window clamp still reserves its space (TOP_RESERVE), so windows never
    // shuffle when it comes back.
    if (!shell.get().appActive) return nothing;
    return html`<div class="strip vf-panel">${this.#content()}</div>`;
  }

  #content() {
    const s = session.get();
    return html`
      <vf-label class="tool-name">${TOOL_NAME[s.tool] ?? ''}</vf-label>
      ${this.#inkSwatch(s)}
      <sm-tool-options
        .tool=${s.tool}
        .pencilSize=${s.pencilSize}
        .eraserSize=${s.eraserSize}
        .brushMax=${this.#brushMax}
        .cornerRadius=${s.cornerRadius}
        .radiusMax=${this.#radiusMax}
        .fillContiguous=${s.fillContiguous}
        .fillAllFaces=${s.fillAllFaces}
        @sm-set-pencil-size=${(e) => session.setPencilSize(e.detail.n, this.#brushMax)}
        @sm-set-eraser-size=${(e) => session.setEraserSize(e.detail.n, this.#brushMax)}
        @sm-set-corner-radius=${(e) =>
          session.setCornerRadius(e.detail.n, this.#radiusMax)}
        @sm-set-fill-opts=${this.#onFillOpts}
      ></sm-tool-options>
    `;
  }

  // The current-ink swatch: shown for every tool but the eraser (which paints
  // no color), a lone well standing in for the current color — the case the
  // kit says wants the hard `shadow`. Clicking it opens the Colors dialog.
  #inkSwatch(s) {
    if (s.tool === 'eraser') return nothing;
    return html`
      <vf-swatch
        class="editor-selected"
        width="36"
        height="20"
        shadow
        color=${rgbToHex(s.ink)}
        label="selected color — open the color picker"
        title="selected color — open the color picker"
        @click=${() => session.openPicker()}
      ></vf-swatch>
    `;
  }

  #onFillOpts = (e) => {
    const { contiguous, allFaces } = e.detail;
    if (contiguous !== undefined) session.setFillContiguous(contiguous);
    if (allFaces !== undefined) session.setFillAllFaces(allFaces);
  };
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-options-bar'))
  customElements.define('sm-options-bar', SmOptionsBar);
