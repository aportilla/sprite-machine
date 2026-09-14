// <sm-options-bar>: the settings strip under the menu bar. It holds the
// current-ink swatch and <sm-tool-options>, with a dotted vertical separator
// between them when both are shown. It dispatches sm-flip-selection {axis} again
// from its host, where the Sprite Editor flips the active window's selection.
//
// The band is a 36 system px vf-container with a bottom rule inside that
// height, so it ends at TOP_RESERVE (shell/layout.js).

import 'vintage-frames';
import { css, LitElement, html, nothing } from 'lit';
import { maxCornerRadius } from '../lib/rect.js';
import { rgbToHex } from '../lib/color.js';
import { session } from '../state/session.js';
import { shell } from '../state/shell.js';
import { workspace } from '../state/workspace.js';
import { StoreController, ActiveDocController } from '../state/store-controller.js';
import { baseStyles } from './base-styles.js';
import { SmToolOptions } from './sm-tool-options.js'; // registers <sm-tool-options>

export class SmOptionsBar extends LitElement {
  static styles = [
    baseStyles,
    css`
      :host {
        display: block;
        /* Above windows and icons, below the menu tier. */
        position: relative;
        z-index: 1500000;
      }
      /* The row inside the band. Lengths are system px scaled by --vf-scale. */
      .strip {
        display: flex;
        align-items: center;
        gap: calc(var(--vf-scale, 1) * 12px);
        padding: 0 calc(var(--vf-scale, 1) * 14px);
        /* A custom property, so it also reaches the separator inside
           sm-tool-options' shadow root. The band's 35 rows are an odd count,
           so the 1×1 dotted run has a dot at each end. */
        --vf-separator-style: dotted;
      }
    `,
  ];

  constructor() {
    super();
    new StoreController(this, session.store);
    new StoreController(this, shell.store);
    // Clamp bounds and readouts follow the active document. Only this host
    // opts into selection updates, which re-render on every pointer move.
    new ActiveDocController(this, workspace, { selection: true });
  }

  /** The active window's selection bounds, or null. */
  get #activeSelection() {
    return workspace.active()?.selection.get().bounds ?? null;
  }
  /** The active window's rect drag in flight, or null. */
  get #activeRectDrag() {
    return workspace.active()?.selection.get().rect ?? null;
  }

  // Clamp bounds from the tile size. The session actions do the clamping.
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
    // Hidden while the desktop is focused. TOP_RESERVE still keeps its space,
    // so windows don't move when it returns.
    if (!shell.get().appActive) return nothing;
    return html`<vf-container fill-width height="36" pattern="white" rule="bottom">
      <div class="strip" fill-height>${this.#content()}</div>
    </vf-container>`;
  }

  #content() {
    const s = session.get();
    return html`
      ${this.#inkSwatch(s)}${this.#wall(s)}
      <sm-tool-options
        .tool=${s.tool}
        .pencilSize=${s.pencilSize}
        .pencilShape=${s.pencilShape}
        .eraserSize=${s.eraserSize}
        .eraserShape=${s.eraserShape}
        .brushMax=${this.#brushMax}
        .cornerRadius=${s.cornerRadius}
        .radiusMax=${this.#radiusMax}
        .fillContiguous=${s.fillContiguous}
        .fillAllFaces=${s.fillAllFaces}
        .selection=${this.#activeSelection}
        .rectDrag=${this.#activeRectDrag}
        @sm-set-pencil-size=${(e) => session.setPencilSize(e.detail.n, this.#brushMax)}
        @sm-set-pencil-shape=${(e) => session.setPencilShape(e.detail.shape)}
        @sm-set-eraser-size=${(e) => session.setEraserSize(e.detail.n, this.#brushMax)}
        @sm-set-eraser-shape=${(e) => session.setEraserShape(e.detail.shape)}
        @sm-set-corner-radius=${(e) =>
          session.setCornerRadius(e.detail.n, this.#radiusMax)}
        @sm-set-fill-opts=${this.#onFillOpts}
        @sm-flip-selection=${this.#onFlip}
      ></sm-tool-options>
    `;
  }

  // The eraser and the selection tool don't lay down ink.
  static showsSwatch(tool) {
    return tool !== 'eraser' && tool !== 'select';
  }

  #wall(s) {
    if (!SmOptionsBar.showsSwatch(s.tool) || !SmToolOptions.hasOptions(s.tool))
      return nothing;
    return html`<vf-separator vertical></vf-separator>`;
  }

  #inkSwatch(s) {
    if (!SmOptionsBar.showsSwatch(s.tool)) return nothing;
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

  // The event stops at this shadow root, so the host sends it on.
  #onFlip = (e) => {
    this.dispatchEvent(
      new CustomEvent('sm-flip-selection', { detail: e.detail, bubbles: true })
    );
  };
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-options-bar'))
  customElements.define('sm-options-bar', SmOptionsBar);
