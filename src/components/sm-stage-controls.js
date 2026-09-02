// ---------------------------------------------------------------------------
// <sm-stage-controls> — the 3D View windoid's controls strip: the two render
// toggles as checkboxes — 'rotate' (the loop's auto-spin) and 'smooth' (the
// low-poly wedge pass) — in a band across the top of the view, under the
// windoid's dot bar. Settings… used to hold these; keeping them on the
// window they change is the standing preference for persistent in-flow
// controls over popups (the menu item stays, parked disabled).
//
// A toggle flips on the PRESS, not the click — the windoid rule (the same
// one sm-tool-strip, sm-face-picker and the atlas tiles state): the desktop
// raises a pressed windoid by re-inserting its node at the end of the press,
// which cancels that press's click, so a click-driven checkbox needed a
// SECOND click whenever another windoid had been raised over the 3D View
// (the Tools palette boots topmost, so the very first click after boot was
// the swallowed one — the box showed its pressed look and never flipped).
// System 7's checkboxes acted on the release, and a kit fix (deferring the
// re-insert past the click) would give that back; until then the press is
// the reliable half of the gesture. The click that FOLLOWS a press — when
// the desktop lets it live, the windoid already frontmost — is cancelled
// here (`preventDefault`, which the kit's deferred activation honors), so
// the kit can't flip the box straight back; a keyboard click (detail 0: the
// kit's own Space, an assistive click) is left alone and still toggles
// through vf-change, the kit's path.
//
// A CONNECTED chrome component: prefs drives it (live() bindings, so a
// re-render can't skip a re-sync) and each toggle is a prefs action. `:host`
// IS the strip — a real box at the top of the windoid body's flex column
// (index.html's .stage-body): the status strip's grammar upside down (a
// white band over a 1px black rule), every metric riding --vf-scale, with
// the THREE canvas flexing below it (the stage's ResizeObserver watches the
// canvas box, so the render buffer re-fits around the strip for free). The
// windoid's STAGE_MIN_WIDTH in shell/windows.js is pinned to this strip's
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
        flex: none;
        display: flex;
        align-items: center;
        gap: calc(var(--vf-scale, 1) * 14px);
        height: calc(var(--vf-scale, 1) * 24px);
        border-bottom: calc(var(--vf-scale, 1) * 1px) solid var(--vf-black, #000);
        background: var(--vf-white, #fff);
        padding-inline: calc(var(--vf-scale, 1) * 8px);
        white-space: nowrap;
        overflow: hidden;
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
      <vf-checkbox
        id="stage-rotate"
        .checked=${live(p.autoRotate)}
        title="spin the model automatically"
        @pointerdown=${(e) =>
          this.#onPress(e, () => prefs.setAutoRotate(!prefs.get().autoRotate))}
        @click=${this.#onClick}
        @vf-change=${(e) => prefs.setAutoRotate(e.detail.checked)}
        >rotate</vf-checkbox
      >
      <vf-checkbox
        id="stage-smooth"
        .checked=${live(p.lowpoly)}
        title="smooth slopes: additive 45° wedges over same-color staircases"
        @pointerdown=${(e) =>
          this.#onPress(e, () => prefs.setLowpoly(!prefs.get().lowpoly))}
        @click=${this.#onClick}
        @vf-change=${(e) => prefs.setLowpoly(e.detail.checked)}
        >smooth</vf-checkbox
      >
    `;
  }

  // The press path (see the header): the primary button on an enabled box
  // flips its pref at once — the box follows through its live() binding.
  /** @param {PointerEvent} e @param {() => void} flip */
  #onPress(e, flip) {
    const box = /** @type {HTMLElement & { disabled?: boolean }} */ (e.currentTarget);
    if (e.button !== 0 || box.disabled) return;
    flip();
  }

  // The click after a pointer press carries a click count (detail ≥ 1) and
  // has been acted on already: cancel it, so the kit's activation — run at
  // the end of the click's path, and skipped when the click is
  // defaultPrevented — can't flip the box back. A keyboard click (detail 0)
  // is the kit's to activate.
  /** @param {MouseEvent} e */
  #onClick(e) {
    if (e.detail > 0) e.preventDefault();
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-stage-controls'))
  customElements.define('sm-stage-controls', SmStageControls);
