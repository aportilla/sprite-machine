// ---------------------------------------------------------------------------
// <sm-status-line kind="tile|atlas|build"> — the one-line readouts the
// windows' `status` slots carry (kit chrome: the classic bottom strip). A
// CONNECTED chrome component; `kind` picks what it reads:
//   - tile:  the document window's "40px x 40px" (doc tile geometry)
//   - atlas: the Full Sprite View's "120px x 80px" (doc sheet dimensions)
//   - build: the 3D View's build readout (build slice) — grid / voxels /
//            tris on one line; an error or the first warning replaces it,
//            ⚠-prefixed (the strip truncates with the kit's own overflow).
// `:host { display: contents }` so the slotted element the window's slot
// gate sees is this host, while the kit's status-bar styles lay out the
// label inside.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { doc } from '../state/doc.js';
import { build } from '../state/build.js';
import { StoreController } from '../state/store-controller.js';

export class SmStatusLine extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }
  `;

  static properties = {
    kind: {},
  };

  constructor() {
    super();
    this.kind = 'tile';
    new StoreController(this, doc.store);
    new StoreController(this, build.store);
  }

  #text() {
    if (this.kind === 'tile') {
      const d = doc.get();
      return d.tileW ? `${d.tileW}px x ${d.tileH}px` : '';
    }
    if (this.kind === 'atlas') {
      const img = doc.get().atlasImage;
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
