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
      /* Kit-scaled metrics: the windoid's declared box is system px, so the
       padding must ride the same --vf-scale or the panel misfits at any
       display scale other than 1. */
      :host {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: calc(var(--vf-scale, 1) * 8px) calc(var(--vf-scale, 1) * 6px);
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
