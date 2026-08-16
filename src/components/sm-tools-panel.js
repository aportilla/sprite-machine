// ---------------------------------------------------------------------------
// <sm-tools-panel> — the floating Tools palette's body: the tool strip over
// the color wells, the same two leaves the editor rail used to hold, now in a
// `vf-window variant="utility"`. A CONNECTED chrome component: session drives
// the leaves' props, and their events become session actions — the exact
// wiring the old <sm-editor> rail carried, relocated with it.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { session, RECENT_SLOTS } from '../state/session.js';
import { StoreController } from '../state/store-controller.js';
import { baseStyles } from './base-styles.js';
import './sm-tool-strip.js'; // registers <sm-tool-strip>
import './sm-color-wells.js'; // registers <sm-color-wells>

export class SmToolsPanel extends LitElement {
  static styles = [
    baseStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        padding: 8px 6px;
      }
    `,
  ];

  constructor() {
    super();
    new StoreController(this, session.store);
  }

  render() {
    const s = session.get();
    return html`
      <sm-tool-strip
        .tool=${s.tool}
        @sm-pick-tool=${(e) => session.setTool(e.detail.tool)}
      ></sm-tool-strip>
      <sm-color-wells
        .ink=${s.ink}
        .recent=${s.recent.slice(1, RECENT_SLOTS + 1)}
        @sm-pick-color=${(e) => session.pickColor(e.detail.rgb)}
        @sm-open-picker=${() => session.openPicker()}
      ></sm-color-wells>
    `;
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-tools-panel'))
  customElements.define('sm-tools-panel', SmToolsPanel);
