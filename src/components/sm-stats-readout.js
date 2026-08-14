// ---------------------------------------------------------------------------
// <sm-stats-readout> — the compact live-stats / warnings readout in the stage
// corner. A CONNECTED chrome component over the build slice: an error (a failed
// decode / unusable sample) REPLACES the readout until the next successful
// build clears it; otherwise the measured lines over any build warnings.
//
// LIGHT DOM + `display: contents`, so `.stage-stats` keeps its box (and the
// `:empty` rule still collapses the no-views case — lit's comment markers
// don't count as content).
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { LitElement, html } from 'lit';
import { build } from '../state/build.js';
import { StoreController } from '../state/store-controller.js';
import { label, warnRow } from './ui-bits.js';

const statLine = (k, v) => html`
  <div class="stat">
    ${label(k, { face: 'body', dim: true, cls: 'k' })}
    ${label(String(v), { face: 'body', cls: 'v' })}
  </div>
`;

export class SmStatsReadout extends LitElement {
  constructor() {
    super();
    new StoreController(this, build.store);
  }

  createRenderRoot() {
    return this; // light DOM — style.css + `capture.sh dom` keep working
  }

  render() {
    return html`<div class="stage-stats">${this.#rows()}</div>`;
  }

  #rows() {
    const b = build.get();
    if (b.error) return warnRow(b.error);
    const rows = [];
    // Tiles are locked square, so a well-formed sheet carves to an N³ grid — show the
    // single edge in px. A non-square (warned) load still reports its full nx×ny×nz.
    if (b.dims) {
      const { nx, ny, nz } = b.dims;
      rows.push(
        statLine('grid', nx === ny && ny === nz ? `${nx}px` : `${nx}×${ny}×${nz}`)
      );
    }
    if (b.voxels) rows.push(statLine('voxels', b.voxels));
    if (b.triangles) rows.push(statLine('tris', b.triangles));
    for (const w of b.warnings || []) rows.push(warnRow(w));
    return rows;
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-stats-readout'))
  customElements.define('sm-stats-readout', SmStatsReadout);
