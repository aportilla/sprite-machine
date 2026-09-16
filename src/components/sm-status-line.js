// <sm-status-line kind="tile|build">: a one-line readout for a window's status
// slot.
//   - tile: the window's edited face ("Front Face"), led by a small popup of
//     the document's layers, in block order and set to the edited one, when
//     there is more than one. Read from ctx, which the reconciler assigns
//     before the append. A pick switches that window's layer.
//   - build: the 3D View's triangle count, empty until a build exists.
// display: contents, so the slot sees this host and the kit's status bar
// styles lay out the controls.

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { live } from 'lit/directives/live.js';
import { build } from '../state/build.js';
import { workspace } from '../state/workspace.js';
import { StoreController, ActiveDocController } from '../state/store-controller.js';

export class SmStatusLine extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }
    .face {
      margin-inline-start: calc(var(--vf-scale, 1) * 8px);
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

  // A face or layer change updates the workspace store, and a layer add, delete,
  // move or rename is a structural change on the active document, so
  // ActiveDocController re-renders on each.

  #tile() {
    const ctx = this.ctx;
    const f = ctx?.face;
    if (!f) return html`<vf-label></vf-label>`;
    const { names } = ctx.doc.get();
    const face = `${f[0].toUpperCase()}${f.slice(1)} Face`;
    if (names.length < 2) return html`<vf-label>${face}</vf-label>`;
    return html`
      <vf-select
        size="small"
        no-shadow
        label="edited layer"
        .value=${live(String(ctx.layer))}
        @vf-change=${(e) => workspace.setLayer(ctx.key, Number(e.detail.value))}
      >
        ${names.map((name, i) => html`<vf-option value=${i}>${name}</vf-option>`)}
      </vf-select>
      <vf-label class="face">${face}</vf-label>
    `;
  }

  render() {
    if (this.kind === 'tile') return this.#tile();
    // No dims means no build yet. en-US keeps the digit grouping fixed.
    const b = build.get();
    return html`<vf-label
      >${b.dims ? `${b.triangles.toLocaleString('en-US')} triangles` : ''}</vf-label
    >`;
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-status-line'))
  customElements.define('sm-status-line', SmStatusLine);
