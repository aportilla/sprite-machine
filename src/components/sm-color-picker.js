// <sm-color-picker>: the Colors dialog, opened by session `pickerOpen`. A swatch
// click or a valid hex entry sets a pending color. OK or Enter in the field
// commits it through session.pickColor.
//
// Renders into light DOM: the kit cursor stays above a modal by observing a
// vf-dialog's `open` attribute, and its MutationObserver sees light DOM only.
// Styles live in style.css.
//
// The 168 cells are not built until the first open.

import 'vintage-frames';
import { LitElement, html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import { PALETTE_168, paletteName } from '../lib/palette.js';
import { hexToRgb, normalizeHex, rgbToHex } from '../lib/color.js';
import { session } from '../state/session.js';
import { StoreController } from '../state/store-controller.js';

export class SmColorPicker extends LitElement {
  #built = false; // true once the dialog has been opened
  #wasOpen = false; // previous render's open flag
  /** @type {{r:number,g:number,b:number}} the pending color OK commits */
  #pending = { r: 0, g: 0, b: 0 };
  /** Palette entry under the pointer or keyboard focus, for the readout. */
  #hover = null;
  // The hex field's text as typed, bound with live() so a mid-edit value is
  // not rewritten under the caret. #pending follows it only while it parses.
  #hexText = '#000000';

  constructor() {
    super();
    new StoreController(this, session.store);
  }

  // Light DOM (see the header).
  createRenderRoot() {
    return this;
  }

  #select(rgb) {
    this.#pending = { r: rgb.r, g: rgb.g, b: rgb.b };
    this.#hexText = rgbToHex(this.#pending);
    this.requestUpdate();
  }

  // null shows the pending color in the readout.
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
    // Opening seeds the form from the current ink.
    if (open && !this.#wasOpen) {
      this.#pending = { ...session.get().ink };
      this.#hexText = rgbToHex(this.#pending);
    }
    this.#wasOpen = open;
    const valid = normalizeHex(this.#hexText) !== null;
    const readout = this.#hover ?? {
      css: rgbToHex(this.#pending),
      name: paletteName(this.#pending) ?? 'Custom',
    };
    return html`
      <vf-dialog
        heading="Colors"
        width="317"
        height="273"
        .open=${open}
        @vf-close=${() => session.closePicker()}
      >
        <!-- The stack's width is the grid's: 21 collapsed 13px cells plus the
             closing border. Without it the fill-width field overflows the
             clipped body. The body is 307 × 248 (the frame takes 5px per side,
             the title bar 20px), so the buttons' corner 16 in from it is at
             291, 232. The bottom pad keeps the preview's shadow and the
             field's focus rule inside the clip. -->
        <vf-stack width="274" gap="10" pad="0 0 4" left="16" top="16">
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
                // The commit closes the dialog and focus returns to the ink
                // swatch button. An uncancelled Enter would click it and
                // reopen the dialog.
                e.preventDefault();
                this.#commit();
              }}
            ></vf-text-field>
          </vf-stack>
        </vf-stack>
        <vf-button-group origin="bottom right" left="291" top="232">
          <vf-button class="picker-cancel" @click=${() => session.closePicker()}
            >Cancel</vf-button
          >
          <vf-button
            class="picker-ok"
            variant="default"
            ?disabled=${!valid}
            @click=${() => this.#commit()}
            >OK</vf-button
          >
        </vf-button-group>
      </vf-dialog>
    `;
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-color-picker'))
  customElements.define('sm-color-picker', SmColorPicker);
