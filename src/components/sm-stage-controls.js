// ---------------------------------------------------------------------------
// <sm-stage-controls> — the render toggles floating over the 3D stage: System 7
// checkboxes on a small white panel. A CONNECTED chrome component over the
// prefs slice: CONTROLLED bindings down from the store, its actions back up on
// vf-change. `live()` diffs against the checkbox's own current state, not the
// last rendered value, so a re-render can never skip a needed re-sync.
//
// Shadow DOM; `:host { display: contents }`, so `.stage-controls` positions
// against #stage directly.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { live } from 'lit/directives/live.js';
import { prefs } from '../state/prefs.js';
import { StoreController } from '../state/store-controller.js';
import { baseStyles } from './base-styles.js';

export class SmStageControls extends LitElement {
  static styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
      /* A floating stage panel: white face, 1px black border, hard offset shadow —
         the kit's raised-surface recipe, hand-rolled for this page overlay. */
      .stage-controls {
        position: absolute;
        right: 16px;
        bottom: 16px;
        display: flex;
        align-items: center;
        gap: 18px;
        padding: 8px 12px;
        background: var(--sm-white);
        border: 1px solid var(--sm-black);
        box-shadow: 2px 2px 0 0 var(--sm-black);
      }
    `,
  ];

  constructor() {
    super();
    new StoreController(this, prefs.store);
  }

  render() {
    return html`
      <div class="stage-controls">
        <vf-checkbox
          .checked=${live(!!prefs.get().lowpoly)}
          @vf-change=${(e) => prefs.setLowpoly(e.detail.checked)}
          >smooth slopes</vf-checkbox
        >
        <vf-checkbox
          .checked=${live(!!prefs.get().autoRotate)}
          @vf-change=${(e) => prefs.setAutoRotate(e.detail.checked)}
          >auto rotate</vf-checkbox
        >
      </div>
    `;
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-stage-controls'))
  customElements.define('sm-stage-controls', SmStageControls);
