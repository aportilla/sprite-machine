// ---------------------------------------------------------------------------
// <sm-stats-readout> — the compact live-stats / warnings readout in the stage
// corner. A CONNECTED chrome component over the build slice: an error (a failed
// decode / unusable sample) REPLACES the readout until the next successful
// build clears it; otherwise the measured lines over any build warnings.
//
// Shadow DOM; `:host { display: contents }`, so `.stage-stats` positions
// against #stage directly (and the `:empty` rule still collapses the no-views
// case — lit's comment markers don't count as content).
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { build } from '../state/build.js';
import { StoreController } from '../state/store-controller.js';
import { label, warnRow, warnStyles } from './ui-bits.js';
import { baseStyles } from './base-styles.js';

const statLine = (k, v) => html`
  <div class="stat">
    ${label(k, { face: 'body', dim: true, cls: 'k' })}
    ${label(String(v), { face: 'body', cls: 'v' })}
  </div>
`;

export class SmStatsReadout extends LitElement {
  // The `.warn` row's styles live with its template (warnStyles, ui-bits.js).
  static styles = [
    baseStyles,
    warnStyles,
    css`
      :host {
        display: contents;
      }
      /* A floating stage panel: white face, 1px black border, hard offset shadow —
         the kit's raised-surface recipe, hand-rolled for this page overlay. */
      .stage-stats {
        position: absolute;
        left: 16px;
        top: 16px;
        max-width: min(60%, 340px);
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 8px 10px;
        background: var(--sm-white);
        border: 1px solid var(--sm-black);
        box-shadow: 2px 2px 0 0 var(--sm-black);
      }
      .stage-stats:empty {
        display: none;
      }
      .stat {
        display: flex;
        justify-content: space-between;
        gap: 14px;
      }
    `,
  ];

  constructor() {
    super();
    new StoreController(this, build.store);
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
