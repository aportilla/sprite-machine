// <sm-stage-controls>: the 3D View window's header controls, one row of two
// checkboxes. rotate is bound live to prefs.autoRotate. single layer is bound
// live to prefs.singleLayer and greyed, keeping its check, while the active
// document has fewer than two layers. The Sprite Editor's windows.html sets the
// header-height to STAGE_STRIP.
//
// The row is 185 px wide, and STAGE_MIN_WIDTH (apps/sprite-editor/layout.js) is
// derived from its labels. Re-measure there if a label or control changes.

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { live } from 'lit/directives/live.js';
import { prefs } from '../state/prefs.js';
import { workspace } from '../state/workspace.js';
import { StoreController, ActiveDocController } from '../state/store-controller.js';
import { baseStyles } from './base-styles.js';

export class SmStageControls extends LitElement {
  static styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
    `,
  ];

  constructor() {
    super();
    new StoreController(this, prefs.store);
    // A document switch or a layer added or removed changes the layer count.
    new ActiveDocController(this, workspace);
  }

  render() {
    const p = prefs.get();
    const count = workspace.active()?.doc.get().layers.length ?? 0;
    return html`
      <vf-stack direction="row" gap="12" pad="0 8" fill-height>
        <vf-checkbox
          id="stage-rotate"
          .checked=${live(p.autoRotate)}
          title="spin the model automatically"
          @vf-change=${(e) => prefs.setAutoRotate(e.detail.checked)}
          >rotate</vf-checkbox
        >
        <vf-checkbox
          id="stage-single-layer"
          .checked=${live(p.singleLayer)}
          ?disabled=${count < 2}
          title="show only the edited layer"
          @vf-change=${(e) => prefs.setSingleLayer(e.detail.checked)}
          >single layer</vf-checkbox
        >
      </vf-stack>
    `;
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-stage-controls'))
  customElements.define('sm-stage-controls', SmStageControls);
