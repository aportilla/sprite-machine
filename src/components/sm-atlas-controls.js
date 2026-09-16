// <sm-atlas-controls>: the Full Sprite View windoid's header strip, holding the
// face picker for the active document.
//
// The picker box declares pattern="white". A bare vf-container paints the
// desktop pattern inherited through the slot.

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { workspace } from '../state/workspace.js';
import { StoreController } from '../state/store-controller.js';
import {
  FACE_ROW,
  SPRITE_PICKER,
  SPRITE_PICKER_AT,
} from '../apps/sprite-editor/layout.js';
import './sm-face-picker.js'; // registers <sm-face-picker>
import { baseStyles } from './base-styles.js';

export class SmAtlasControls extends LitElement {
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
    new StoreController(this, workspace.store);
  }

  render() {
    const active = workspace.active();
    const face = active?.face ?? '';
    return html`
      <vf-container
        class="picker"
        left=${SPRITE_PICKER_AT.left}
        top=${SPRITE_PICKER_AT.top}
        width=${SPRITE_PICKER.width}
        height=${SPRITE_PICKER.height}
        pattern="white"
      >
        <sm-face-picker
          .faces=${FACE_ROW}
          .gap=${SPRITE_PICKER.gap}
          .selected=${face}
          @sm-select-face=${this.#onSelectFace}
        ></sm-face-picker>
      </vf-container>
    `;
  }

  #onSelectFace = (e) => {
    const active = workspace.active();
    const face = e.detail.face;
    if (active && face !== active.face) workspace.setFace(active.key, face);
  };
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-atlas-controls'))
  customElements.define('sm-atlas-controls', SmAtlasControls);
