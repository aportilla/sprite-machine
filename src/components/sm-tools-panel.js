// ---------------------------------------------------------------------------
// <sm-tools-panel> — the floating Tools palette's body: the tool strip alone
// (the current-ink swatch lives in the options strip now, and the "last used"
// recency row is gone — the Colors dialog is the one color surface). A
// CONNECTED chrome component: session drives the strip's props, and its
// events become session actions.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { session } from '../state/session.js';
import { StoreController } from '../state/store-controller.js';
import { baseStyles } from './base-styles.js';
import './sm-tool-strip.js'; // registers <sm-tool-strip>

export class SmToolsPanel extends LitElement {
  static styles = [
    baseStyles,
    css`
      /* No inner padding: the tool cells run flush to the windoid's frame —
       the strip's frameless grid shares the window's own black line (the
       kit's desk-accessory composition: vf-grid[frameless] inside
       vf-window[flush]). */
      :host {
        display: flex;
        flex-direction: column;
        align-items: center;
      }
    `,
  ];

  constructor() {
    super();
    new StoreController(this, session.store);
  }

  render() {
    return html`
      <sm-tool-strip
        .tool=${session.get().tool}
        @sm-pick-tool=${(e) => session.setTool(e.detail.tool)}
      ></sm-tool-strip>
    `;
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-tools-panel'))
  customElements.define('sm-tools-panel', SmToolsPanel);
