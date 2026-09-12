// <sm-status-line kind="tile|build">: a one-line readout for a window's status
// slot.
//   - tile: the window's edited face ("Front Face"), read from ctx, which the
//     reconciler assigns before the append.
//   - build: the 3D View's triangle count, empty until a build exists.
// display: contents, so the slot sees this host and the kit's status bar
// styles lay out the label.

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { build } from '../state/build.js';
import { workspace } from '../state/workspace.js';
import { StoreController, ActiveDocController } from '../state/store-controller.js';

export class SmStatusLine extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }
  `;

  static properties = {
    kind: {},
    /** kind="tile" only: the window's DocContext, assigned pre-append. */
    ctx: { attribute: false },
  };

  constructor() {
    super();
    this.kind = 'tile';
    /** @type {import('../state/workspace.js').DocContext|null} */
    this.ctx = null;
    new StoreController(this, build.store);
    new ActiveDocController(this, workspace);
  }

  // A face change updates the workspace store, so ActiveDocController
  // re-renders on it.

  #text() {
    if (this.kind === 'tile') {
      const f = this.ctx?.face;
      return f ? `${f[0].toUpperCase()}${f.slice(1)} Face` : '';
    }
    // No dims means no build yet. en-US keeps the digit grouping fixed.
    const b = build.get();
    return b.dims ? `${b.triangles.toLocaleString('en-US')} triangles` : '';
  }

  render() {
    return html`<vf-label>${this.#text()}</vf-label>`;
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-status-line'))
  customElements.define('sm-status-line', SmStatusLine);
