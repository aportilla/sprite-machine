// <sm-tools-panel>: the Tools palette's body. It binds <sm-tool-strip> to the
// session. While Option is held the strip inverts the eyedropper.

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { session } from '../state/session.js';
import { springTool } from '../lib/tools.js';
import { StoreController } from '../state/store-controller.js';
import { baseStyles } from './base-styles.js';
import './sm-tool-strip.js'; // registers <sm-tool-strip>

export class SmToolsPanel extends LitElement {
  static styles = [
    baseStyles,
    css`
      /* No padding: the frameless grid runs to the window's frame. */
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
    const s = session.get();
    return html`
      <sm-tool-strip
        .tool=${s.tool}
        .shown=${springTool(s.tool, s.option, s.gesture)}
        @sm-pick-tool=${(e) => session.setTool(e.detail.tool)}
      ></sm-tool-strip>
    `;
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-tools-panel'))
  customElements.define('sm-tools-panel', SmToolsPanel);
