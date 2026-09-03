// ---------------------------------------------------------------------------
// <sm-stage-controls> — the 3D View windoid's controls strip, slotted into
// the window's HEADER (`slot="header"` — vintage-frames 0.6.1: a white band
// over a 1px rule between the title bar and the body, across the whole
// window; `header-height` authored in index.html = STAGE_STRIP, the drive
// pinning the two): the
// two render toggles as checkboxes — 'rotate' (the loop's auto-spin) and
// 'smooth' (the low-poly wedge pass) — in a kit row stack, 8px in from the
// header's sides with 14 between, centered on the header's 23 rows by the
// stack's own whole-pixel centering (`fill-height`, a row's default cross
// alignment). Settings… used to hold these; keeping them on the window they
// change is the standing preference for persistent in-flow controls over
// popups (the menu item stays, parked disabled). The host is `display:
// contents`; nothing here is styled — the header is the kit's band, the
// row the kit's stack.
//
// The toggles act on the CLICK — the kit's own checkbox activation, on the
// release like System 7's. A windoid control needs no press-driven bridge:
// raising a windoid re-inserts its node (DOM order tracks z-order), and
// vintage-frames 0.5.4 does that in a task AFTER the press's click has
// landed — Chrome drops a click whose mousedown node left the tree, which
// is what once cost a background windoid's checkbox its first click (see
// sm-tool-strip's header).
//
// A CONNECTED chrome component: prefs drives it (live() bindings, so a
// re-render can't skip a re-sync) and each toggle is a prefs action. The
// windoid's STAGE_MIN_WIDTH in shell/windows.js is pinned to this row's
// content width — grow it and re-measure (see the note there).
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
    `,
  ];

  constructor() {
    super();
    new StoreController(this, prefs.store);
  }

  render() {
    const p = prefs.get();
    return html`
      <vf-stack direction="row" gap="14" pad="0 8" fill-height>
        <vf-checkbox
          id="stage-rotate"
          .checked=${live(p.autoRotate)}
          title="spin the model automatically"
          @vf-change=${(e) => prefs.setAutoRotate(e.detail.checked)}
          >rotate</vf-checkbox
        >
        <vf-checkbox
          id="stage-smooth"
          .checked=${live(p.lowpoly)}
          title="smooth slopes: additive 45° wedges over same-color staircases"
          @vf-change=${(e) => prefs.setLowpoly(e.detail.checked)}
          >smooth</vf-checkbox
        >
      </vf-stack>
    `;
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-stage-controls'))
  customElements.define('sm-stage-controls', SmStageControls);
