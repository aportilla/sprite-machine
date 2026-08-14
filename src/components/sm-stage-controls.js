// ---------------------------------------------------------------------------
// <sm-stage-controls> — the render toggles floating over the 3D stage: System 7
// checkboxes on a small white panel. A CONNECTED chrome component over the
// prefs slice: CONTROLLED bindings down from the store, its actions back up on
// vf-change. `live()` diffs against the checkbox's own current state, not the
// last rendered value, so a re-render can never skip a needed re-sync.
//
// LIGHT DOM + `display: contents`, so `.stage-controls` keeps its box.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { LitElement, html } from 'lit';
import { live } from 'lit/directives/live.js';
import { prefs } from '../state/prefs.js';
import { StoreController } from '../state/store-controller.js';

export class SmStageControls extends LitElement {
  constructor() {
    super();
    new StoreController(this, prefs.store);
  }

  createRenderRoot() {
    return this; // light DOM — style.css + `capture.sh dom` keep working
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
