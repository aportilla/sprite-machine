// ---------------------------------------------------------------------------
// <sm-atlas-controls> — the Full Sprite View windoid's controls strip,
// slotted into the window's HEADER (`slot="header"` — vintage-frames 0.6.1:
// a white band over a 1px rule between the title bar and the body, across
// the whole window, a positioning anchor for what is placed in it;
// `header-height` authored in index.html = SPRITE_STRIP, the drive pinning
// the two): the FACE
// PICKER — the six cube-view radios (sm-face-picker, a presentational leaf)
// serving the ACTIVE document — in a placed vf-container at the picker
// block's rectangle, SPRITE_PICKER_AT / SPRITE_PICKER in shell/layout.js
// (centered across the fixed-width header's interior, the pad down from its
// top, the block's own 186 × 45). The host is `display: contents`; nothing
// here is styled.
//
// The picker box declares `pattern="white"` — the kit's blank pattern, white
// paper with no ink — because a BARE vf-container paints the desktop's
// pattern: vf-desktop writes its raster as an inline custom property on the
// screen that slots the windows, custom properties inherit through slots
// and shadow roots alike, and every kit pattern box reads that token as its
// background (kit ask #6, docs and the draw canvas's stack — the same
// bridge). Declared, the box has ink and paper of its own: the header's
// white, exactly. Drop the attribute and the desktop dither shows through
// behind the cubes and radios.
//
// A CONNECTED chrome component that follows the ACTIVE document: the picker
// reads the active context's face off the workspace store (a StoreController
// re-renders on any workspace change — a face switch, an activation) and a
// pick routes through workspace.setFace on the ACTIVE key — the same action
// the body's atlas grid (sm-atlas-view) fires from a tile press. A pick is
// an ordinary click on the radio or its icon: no press-driven bridge (see
// sm-tool-strip's header for the kit's task-deferred re-insert).
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { workspace } from '../state/workspace.js';
import { StoreController } from '../state/store-controller.js';
import { SPRITE_PICKER, SPRITE_PICKER_AT } from '../shell/layout.js';
import './sm-face-picker.js'; // registers <sm-face-picker>
import { baseStyles } from './base-styles.js';

// The face-picker row order: mirror pairs, so flipping between a pair for
// reference is one step.
const FACES = ['left', 'right', 'front', 'back', 'top', 'bottom'];

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
          .faces=${FACES}
          .selected=${face}
          @sm-select-face=${this.#onSelectFace}
        ></sm-face-picker>
      </vf-container>
    `;
  }

  // A pick switches the ACTIVE document's edited face (the windoid serves
  // whichever document is active, like every utility window); a pick of
  // the face already selected is a no-op.
  #onSelectFace = (e) => {
    const active = workspace.active();
    const face = e.detail.face;
    if (active && face !== active.face) workspace.setFace(active.key, face);
  };
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-atlas-controls'))
  customElements.define('sm-atlas-controls', SmAtlasControls);
