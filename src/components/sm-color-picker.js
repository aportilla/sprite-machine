// ---------------------------------------------------------------------------
// <sm-color-picker> — the "Colors" dialog: a System 7 movable modal (vf-dialog)
// holding the named 168-color palette (value-banded hue rows) as a 21×8
// vf-grid of swatch cells over a hover readout line and a traditional dialog
// form: a large preview swatch of the PENDING selection, a hex text field
// beside it, and a Cancel / OK button row.
// CONNECTED CHROME, one per app (it sits in index.html's dialog set): the
// picker serves the app-level session ink (one palette, one ink, System 7
// style), so it reads `session` directly — `pickerOpen` drives the dialog.
//
// HOVER READOUT: pointing at (or keyboard-focusing) a palette cell makes the
// readout line under the grid show that color as a chip beside its NAME and
// hex — the reason the palette carries names at all. The cells themselves wear
// no hover treatment (System 7 chrome doesn't hover; the OS crosshair marks
// the position). At rest (nothing hovered) the line shows the pending
// selection instead, resolving its name through the palette (a typed color
// that matches no swatch reads "Custom"), so the row always names what OK
// would commit. Hover re-renders are keystroke-cost-class: the readout is the
// only DOM that changes. The grid itself is the plain palette — no hover
// chrome on the cells, no used-color badging, no "recent colors" row.
//
// PENDING-SELECTION SEMANTICS: opening seeds the pending color from the
// current ink; a swatch click SELECTS (preview + hex field update, the dialog
// stays up), and the hex field takes manual entry (3- or 6-digit, `#`
// optional — any color, not just the 168). Only OK commits, funneling through
// session.pickColor — the same single path every color pick takes — and Enter
// in the field is OK. Cancel, Esc, and the close box discard the pending
// color and leave the ink untouched. While the field's text isn't a valid hex
// code OK is DISABLED (and Enter inert); the preview holds the last valid
// color.
//
// LIGHT DOM ON PURPOSE — the one non-shadow component: the kit's page-drawn
// cursor keeps itself above a modal by re-promoting its top-layer popover when
// it OBSERVES a vf-dialog's `open` attribute flip, and its MutationObserver
// watches the light DOM only. A vf-dialog inside a shadow root opens ABOVE the
// cursor art (the pointer vanishes while picking a color), so this component
// renders into its light DOM (createRenderRoot → this), exactly like the
// desktop skeleton's own dialogs. No styles of its own — the dialog, stack,
// grid, swatches, field and buttons all carry kit styles, and style.css owns
// the page's share (the host's `display: contents`, the readout chip).
//
// LAZY-BUILD LATCH: 168 cells are expensive and most sessions never open the
// dialog — nothing is rendered until the first open, and from then on the
// dialog persists (built once, ever) with `open` alone driving it
// (`vf-dialog.show()` is verbatim `open = true`). Its native <dialog> is
// top-layer, so where it lives can never clip it.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { LitElement, html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import { PALETTE_168 } from '../lib/constants.js';
import { hexToRgb, normalizeHex, rgbKey, rgbToHex } from '../lib/color.js';
import { session } from '../state/session.js';
import { StoreController } from '../state/store-controller.js';

/** Palette name lookup for the readout's resting state (rgbKey → name). */
const NAME_BY_KEY = new Map(PALETTE_168.map((p) => [rgbKey(p.rgb), p.name]));

export class SmColorPicker extends LitElement {
  #built = false; // the dialog's 168 cells exist once it has been opened
  #wasOpen = false; // last render's open flag — the open FLIP seeds the form
  /** @type {{r:number,g:number,b:number}} the pending selection OK commits */
  #pending = { r: 0, g: 0, b: 0 };
  /** the palette entry under the pointer (or keyboard focus), for the readout */
  #hover = null;
  // The hex field's raw text — a controlled value (live()-bound), kept as
  // typed so a mid-edit string isn't rewritten under the caret; #pending
  // tracks it only while it parses.
  #hexText = '#000000';

  constructor() {
    super();
    // pickerOpen drives the dialog (the picker is app-level: it never reads
    // the workspace).
    new StoreController(this, session.store);
  }

  // Light DOM (see header): the vf-dialog's `open` reflection must be visible
  // to the kit cursor's light-DOM observer.
  createRenderRoot() {
    return this;
  }

  // A palette-swatch click: select, don't commit — the form's OK does that.
  #select(rgb) {
    this.#pending = { r: rgb.r, g: rgb.g, b: rgb.b };
    this.#hexText = rgbToHex(this.#pending);
    this.requestUpdate();
  }

  // Pointer (or focus) over a palette cell drives the readout; null clears it
  // back to the pending selection. Same-entry sets are dropped so a pointer
  // wandering inside one cell schedules nothing.
  #setHover(entry) {
    if (this.#hover === entry) return;
    this.#hover = entry;
    this.requestUpdate();
  }

  #onHexInput(e) {
    this.#hexText = e.detail.value;
    const hex = normalizeHex(this.#hexText);
    if (hex) this.#pending = hexToRgb(hex);
    this.requestUpdate();
  }

  #commit() {
    session.pickColor(this.#pending);
    session.closePicker();
  }

  render() {
    const open = session.get().pickerOpen;
    if (!this.#built && !open) return nothing;
    this.#built = true;
    // The open flip seeds the form from the current ink (the dialog shows
    // what you have until you choose otherwise).
    if (open && !this.#wasOpen) {
      this.#pending = { ...session.get().ink };
      this.#hexText = rgbToHex(this.#pending);
    }
    this.#wasOpen = open;
    const valid = normalizeHex(this.#hexText) !== null;
    // The readout line: the hovered cell, or at rest the pending selection —
    // named through the palette, "Custom" for a typed color no swatch holds.
    const readout = this.#hover ?? {
      css: rgbToHex(this.#pending),
      name: NAME_BY_KEY.get(rgbKey(this.#pending)) ?? 'Custom',
    };
    return html`
      <vf-dialog
        heading="Colors"
        closable
        width="317"
        height="273"
        .open=${open}
        @vf-close=${() => session.closePicker()}
      >
        <!-- The stated width (the grid's own box: 21 collapsed 13px cells + the
             closing border) is what lets the form row's fill-width field
             resolve — unstated, the stack sizes to content and overflows the
             dialog's clipped content region, shearing off the field's right
             border. The dialog's box is sized to hold it: the kit's modal
             frame (vintage-frames ≥ 0.5.0, the dBoxProc double frame) takes
             5px per side and the title bar 20px from the top, and the body
             pads 16px — so content width = width − 42, and 317 leaves the
             274px stack its 1px of slack (309 fit the 0.4.0 1px frame; under
             the double frame it clipped the grid and raised the kit's scroll
             rail). The bottom pad keeps the preview swatch's hard shadow and
             the field's focus rule (both painted OUTSIDE their boxes) inside
             that same clip — the row is the region's last line. -->
        <vf-stack width="274" gap="10" pad="0 0 4">
          <vf-grid
            class="editor-picker-grid"
            columns="21"
            cell-width="12"
            cell-height="12"
            collapse
            role="group"
            aria-label="color palette"
            @mouseleave=${() => this.#setHover(null)}
            @focusout=${() => this.#setHover(null)}
          >
            ${PALETTE_168.map(
              (p) =>
                html`<vf-swatch
                  width="14"
                  height="14"
                  color=${p.css}
                  label=${p.name}
                  @mouseenter=${() => this.#setHover(p)}
                  @focusin=${() => this.#setHover(p)}
                  @click=${() => this.#select(p.rgb)}
                ></vf-swatch>`
            )}
          </vf-grid>
          <vf-stack
            class="picker-readout"
            fill-width
            direction="row"
            gap="8"
            aria-live="polite"
          >
            <span class="picker-readout-chip" style="background:${readout.css}"></span>
            <vf-label class="picker-readout-name">${readout.name}</vf-label>
            <vf-label class="picker-readout-hex" face="body" dim>${readout.css}</vf-label>
          </vf-stack>
          <vf-stack fill-width direction="row" gap="10">
            <vf-swatch
              class="picker-preview"
              width="56"
              height="26"
              shadow
              color=${rgbToHex(this.#pending)}
              label="selected color"
              title=${rgbToHex(this.#pending)}
            ></vf-swatch>
            <vf-text-field
              class="picker-hex"
              fill-width
              maxlength="7"
              spellcheck="false"
              autocapitalize="off"
              label="hex color code"
              .value=${live(this.#hexText)}
              @vf-input=${(e) => this.#onHexInput(e)}
              @keydown=${(e) => {
                if (e.key !== 'Enter' || !valid) return;
                // Cancel the key: the commit closes the dialog during this
                // keydown and focus returns to the opener (the ink swatch,
                // a button) — an uncancelled Enter's keypress would click
                // it and reopen the dialog (shell/menus.js, the name
                // prompt's Enter, has the same note).
                e.preventDefault();
                this.#commit();
              }}
            ></vf-text-field>
          </vf-stack>
        </vf-stack>
        <vf-button
          class="picker-cancel"
          slot="buttons"
          @click=${() => session.closePicker()}
          >Cancel</vf-button
        >
        <vf-button
          class="picker-ok"
          slot="buttons"
          variant="default"
          ?disabled=${!valid}
          @click=${() => this.#commit()}
          >OK</vf-button
        >
      </vf-dialog>
    `;
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-color-picker'))
  customElements.define('sm-color-picker', SmColorPicker);
