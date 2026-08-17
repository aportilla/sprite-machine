// ---------------------------------------------------------------------------
// <sm-status-line kind="tile|atlas|build"> — the one-line readouts the
// windows' `status` slots carry (kit chrome: the classic bottom strip). A
// CONNECTED chrome component; `kind` picks what it reads:
//   - tile:  a document window's "40px x 40px" — PER-WINDOW: the reconciler
//            assigns this instance's `ctx` (its window's DocContext) before
//            the append, and the readout follows that document alone
//   - atlas: the Full Sprite View's "120px x 80px" — the ACTIVE document's
//            sheet dimensions (the utility windows serve the active document)
//   - build: the 3D View's build readout (build slice) — grid / voxels /
//            tris on one line; an error or the first warning replaces it,
//            ⚠-prefixed (the strip truncates with the kit's own overflow).
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

  // The per-window doc (kind="tile"): wired by hand like sm-editor's — the
  // context isn't known at construction, and the desktop's DOM re-orders
  // disconnect/reconnect this element.
  #unsubDoc = null;
  connectedCallback() {
    super.connectedCallback();
    if (this.ctx) {
      this.#unsubDoc = this.ctx.doc.subscribe(() => this.requestUpdate());
      this.requestUpdate();
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.#unsubDoc?.();
    this.#unsubDoc = null;
  }

  #text() {
    if (this.kind === 'tile') {
      const d = this.ctx?.doc.get();
      return d?.tileW ? `${d.tileW}px x ${d.tileH}px` : '';
    }
    if (this.kind === 'atlas') {
      const img = workspace.active()?.doc.get().atlasImage;
      return img ? `${img.width}px x ${img.height}px` : '';
    }
    // kind === 'build'
    const b = build.get();
    if (b.error) return `⚠ ${b.error}`;
    if (b.warnings?.length) return `⚠ ${b.warnings[0]}`;
    if (!b.dims) return '';
    const { nx, ny, nz } = b.dims;
    const grid = nx === ny && ny === nz ? `${nx}px` : `${nx}×${ny}×${nz}`;
    return `grid ${grid} · voxels ${b.voxels} · tris ${b.triangles}`;
  }

  render() {
    return html`<vf-label>${this.#text()}</vf-label>`;
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-status-line'))
  customElements.define('sm-status-line', SmStatusLine);
