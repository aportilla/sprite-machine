// ---------------------------------------------------------------------------
// <sm-status-line kind="tile|build"> — the one-line readouts the windows'
// `status` slots carry (kit chrome: the classic bottom strip; the Full
// Sprite View carries none — its status slot stays empty — and neither does
// the 3D Sprite Atlas, whose bottom edge is the kit's horizontal scroll
// rail). A CONNECTED chrome component; `kind` picks what it reads:
//   - tile:  a document window's edited face ("Front Face") — PER-WINDOW: the
//            reconciler assigns this instance's `ctx` (its window's
//            DocContext) before the append, and the readout follows that
//            window's own face selection
//   - build: the 3D View's triangle count ("1,784 triangles", from the build
//            slice — the Finder's "N items" idiom), empty until a build has
//            landed; the count alone — no grid, no voxel count, no tooltip,
//            and no build error or warning ever takes the line.
// `:host { display: contents }` so the slotted element the window's slot
// gate sees is this host, while the kit's status-bar styles lay out the
// label inside.
// ---------------------------------------------------------------------------

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

  // No per-window doc subscription: the face readout reads ctx.face, and a
  // face swap touches the workspace store — which the ActiveDocController
  // already re-renders on.

  #text() {
    if (this.kind === 'tile') {
      const f = this.ctx?.face;
      return f ? `${f[0].toUpperCase()}${f.slice(1)} Face` : '';
    }
    // kind === 'build': the last build's triangle count; nothing before a
    // model exists (no dims = no build). A fixed locale, so the grouping
    // never moves with the machine.
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
