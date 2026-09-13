// <sm-status-line kind="tile|build">: a one-line readout for a window's status
// slot.
//   - tile: the window's edited face ("Front Face"), led by the edited layer's
//     name when the document has more than one ("Layer 2, Front Face"), read
//     from ctx, which the reconciler assigns before the append.
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

  // A face or layer change updates the workspace store, and a rename is a
  // structural change on the active document, so ActiveDocController
  // re-renders on both.

  #text() {
    if (this.kind === 'tile') {
      const f = this.ctx?.face;
      if (!f) return '';
      const face = `${f[0].toUpperCase()}${f.slice(1)} Face`;
      const { names } = this.ctx.doc.get();
      return names.length > 1 ? `${names[this.ctx.layer] ?? ''}, ${face}` : face;
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
