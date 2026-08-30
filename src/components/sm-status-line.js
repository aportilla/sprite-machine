// ---------------------------------------------------------------------------
// <sm-status-line kind="tile|build|ring"> — the one-line readouts the
// windows' `status` slots carry (kit chrome: the classic bottom strip; the
// Full Sprite View carries none — its status slot stays empty). A
// CONNECTED chrome component; `kind` picks what it reads:
//   - tile:  a document window's edited face ("Front Face") — PER-WINDOW: the
//            reconciler assigns this instance's `ctx` (its window's
//            DocContext) before the append, and the readout follows that
//            window's own face selection
//   - build: the 3D View's fixed name, "3D Model View" — a static label, no
//            build error or warning ever takes the line; the build stats
//            (grid / voxels / tris, from the build slice) ride the label's
//            `title`, a hover tooltip — and the probe surface drive.mjs reads.
//   - ring:  the 3D Sprite Atlas's frame — "4 × 69 px" (views × the frame's
//            square, derived through lib/ring.js from the build's dims and
//            the ring slice's settings; "4 views" with no model); the full
//            readout — frame, sheet, elevation, first angle, scale — rides
//            the `title` tooltip, the probe surface again.
// `:host { display: contents }` so the slotted element the window's slot
// gate sees is this host, while the kit's status-bar styles lay out the
// label inside.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { css, LitElement, html, nothing } from 'lit';
import { build } from '../state/build.js';
import { ring } from '../state/ring.js';
import { workspace } from '../state/workspace.js';
import { StoreController, ActiveDocController } from '../state/store-controller.js';
import { ringFrame, ringSheet } from '../lib/ring.js';

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
    new StoreController(this, ring.store);
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
    if (this.kind === 'ring') {
      const st = ring.get();
      const dims = build.get().dims;
      if (!dims) return `${st.views} views`;
      return `${st.views} × ${ringFrame(dims, st.elevation, st.scale).px} px`;
    }
    // kind === 'build': the fixed name, whatever the build slice holds.
    return '3D Model View';
  }

  // The build stats line the readout used to show, kept as the label's
  // tooltip (and the shadow-piercing probe surface drive.mjs parses).
  #buildStats() {
    const b = build.get();
    if (!b.dims) return '';
    const { nx, ny, nz } = b.dims;
    const grid = nx === ny && ny === nz ? `${nx}px` : `${nx}×${ny}×${nz}`;
    return `grid ${grid} · voxels ${b.voxels} · tris ${b.triangles}`;
  }

  // The ring's full readout, the same way: the frame and sheet the settings
  // produce for the current model, then the settings themselves.
  #ringStats() {
    const st = ring.get();
    const dims = build.get().dims;
    if (!dims) return '';
    const { px } = ringFrame(dims, st.elevation, st.scale);
    const sheet = ringSheet(st.views, px);
    return (
      `frame ${px}×${px} px · sheet ${sheet.width}×${sheet.height} px · ` +
      `${st.elevation}° · from ${st.offset}° · ${st.scale}×`
    );
  }

  render() {
    const stats =
      this.kind === 'build'
        ? this.#buildStats()
        : this.kind === 'ring'
          ? this.#ringStats()
          : '';
    return html`<vf-label title=${stats || nothing}>${this.#text()}</vf-label>`;
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-status-line'))
  customElements.define('sm-status-line', SmStatusLine);
