// <sm-stage-controls>: the 3D View window's header controls, a rotate checkbox
// bound live to prefs.autoRotate. The Sprite Editor's windows.html sets the
// header-height to STAGE_STRIP.
//
// The row is 77 px wide, inside STAGE_MIN_WIDTH (apps/sprite-editor/layout.js).
// Re-check that floor if controls are added.

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
    `,
  ];

  constructor() {
    super();
    new StoreController(this, prefs.store);
  }

  render() {
    const p = prefs.get();
    return html`
      <vf-stack direction="row" pad="0 8" fill-height>
        <vf-checkbox
          id="stage-rotate"
          .checked=${live(p.autoRotate)}
          title="spin the model automatically"
          @vf-change=${(e) => prefs.setAutoRotate(e.detail.checked)}
          >rotate</vf-checkbox
        >
      </vf-stack>
    `;
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-stage-controls'))
  customElements.define('sm-stage-controls', SmStageControls);
