// ---------------------------------------------------------------------------
// <sm-color-picker> — the "Colors" dialog: a System 7 movable modal (vf-dialog)
// holding the Hilbert-laid 256-color palette as a 16×16 vf-grid of swatch
// cells over a traditional dialog form: a large preview swatch of the PENDING
// selection, a hex text field beside it, and a Cancel / OK button row.
// CONNECTED CHROME, one per app (it sits in index.html's dialog set): the
// picker serves the app-level session ink (one palette, one ink, System 7
// style), so it reads `session` directly — `pickerOpen` drives the dialog.
//
// PENDING-SELECTION SEMANTICS: opening seeds the pending color from the
// current ink; a swatch click SELECTS (preview + hex field update, the dialog
// stays up), and the hex field takes manual entry (3- or 6-digit, `#`
// optional — any color, not just the 256). Only OK commits, funneling through
// session.pickColor — the same single path every color pick takes — and Enter
// in the field is OK. Cancel, Esc, and the close box discard the pending
// color and leave the ink untouched. While the field's text isn't a valid hex
// code OK is DISABLED (and Enter inert); the preview holds the last valid
// color.
//
// USED-COLOR BADGES: every palette cell whose color appears in the ACTIVE
// document wears a little white corner tag (a black-seamed dog-ear, page CSS —
// this is light DOM). The set is rescanned on each OPEN (the per-face views
// are read by reference, so a pending live stroke is already in them) and
// whenever the active context changes under an open dialog — that second key
// is what covers the boot race where ?palette=1 opens the dialog before the
// first document lands (the ActiveDocController re-render delivers it). The
// scan is NOT per-render: typing in the hex field re-renders at keystroke
// rate, and the modal blocks edits, so mid-open the set can't change. There
// is no "recent colors" row — the badges are the document's own palette,
// which is the recency that matters.
//
// LIGHT DOM ON PURPOSE — the one non-shadow component: the kit's page-drawn
// cursor keeps itself above a modal by re-promoting its top-layer popover when
// it OBSERVES a vf-dialog's `open` attribute flip, and its MutationObserver
// watches the light DOM only. A vf-dialog inside a shadow root opens ABOVE the
// cursor art (the pointer vanishes while picking a color), so this component
// renders into its light DOM (createRenderRoot → this), exactly like the
// desktop skeleton's own dialogs. No styles of its own — the dialog, stack,
// grid, swatches, field and buttons all carry kit styles, and style.css owns
// the page's share (the host's `display: contents`, the cell wrappers, the
// used-color tag).
//
// LAZY-BUILD LATCH: 256 cells are expensive and most sessions never open the
// dialog — nothing is rendered until the first open, and from then on the
// dialog persists (built once, ever) with `open` alone driving it
// (`vf-dialog.show()` is verbatim `open = true`). Its native <dialog> is
// top-layer, so where it lives can never clip it.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { LitElement, html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import { PALETTE_256 } from '../lib/constants.js';
import {
  distinctColors,
  hexToRgb,
  normalizeHex,
  rgbKey,
  rgbToHex,
} from '../lib/color.js';
import { session } from '../state/session.js';
import { workspace } from '../state/workspace.js';
import { StoreController, ActiveDocController } from '../state/store-controller.js';

export class SmColorPicker extends LitElement {
  #built = false; // the dialog's 256 cells exist once it has been opened
  #wasOpen = false; // last render's open flag — the open FLIP seeds the form
  /** @type {Set<number>} rgbKeys used in the active document (last scan) */
  #used = new Set();
  /** the workspace context the last badge scan read (rescan on a change) */
  #scanCtx = null;
  /** @type {{r:number,g:number,b:number}} the pending selection OK commits */
  #pending = { r: 0, g: 0, b: 0 };
  // The hex field's raw text — a controlled value (live()-bound), kept as
  // typed so a mid-edit string isn't rewritten under the caret; #pending
  // tracks it only while it parses.
  #hexText = '#000000';

  constructor() {
    super();
    // pickerOpen drives the dialog; the badges read the active document.
    new StoreController(this, session.store);
    new ActiveDocController(this, workspace);
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

  // Distinct colors painted in the ACTIVE document, as rgbKeys. The per-face
  // views are scanned rather than the atlas: `views[face]` holds the editor's
  // working buffer BY REFERENCE, so a stroke the rAF blit hasn't drained yet
  // is still counted honestly.
  #usedKeys() {
    const views = workspace.active()?.doc.get().views ?? {};
    const used = new Set();
    for (const tile of Object.values(views)) {
      if (tile) for (const c of distinctColors(tile.data)) used.add(rgbKey(c));
    }
    return used;
  }

  render() {
    const open = session.get().pickerOpen;
    if (!this.#built && !open) return nothing;
    this.#built = true;
    if (open) {
      // The open flip seeds the form from the current ink (the dialog shows
      // what you have until you choose otherwise)…
      if (!this.#wasOpen) {
        this.#pending = { ...session.get().ink };
        this.#hexText = rgbToHex(this.#pending);
      }
      // …and keys the badge rescan, with the active-context identity as the
      // second key (the ?palette=1 boot race — see header). Keystroke
      // re-renders reuse the scan.
      const ctx = workspace.active() ?? null;
      if (!this.#wasOpen || ctx !== this.#scanCtx) {
        this.#used = this.#usedKeys();
        this.#scanCtx = ctx;
      }
    }
    this.#wasOpen = open;
    const valid = normalizeHex(this.#hexText) !== null;
    return html`
      <vf-dialog
        heading="Colors"
        closable
        width="244"
        height="346"
        .open=${open}
        @vf-close=${() => session.closePicker()}
      >
        <!-- The stated width (the grid's own box: 16 collapsed 13px cells + the
             closing border) is what lets the form row's fill-width field
             resolve — unstated, the stack sizes to content and overflows the
             dialog's clipped content region, shearing off the field's right
             border. The bottom pad keeps the preview swatch's hard shadow and
             the field's focus rule (both painted OUTSIDE their boxes) inside
             that same clip — the row is the region's last line. -->
        <vf-stack width="209" gap="10" pad="0 0 4">
          <vf-grid
            class="editor-picker-grid"
            columns="16"
            cell-width="12"
            cell-height="12"
            collapse
            role="group"
            aria-label="color palette"
          >
            ${PALETTE_256.map(
              (p) =>
                html`<span class="picker-cell">
                  <vf-swatch
                    width="14"
                    height="14"
                    color=${p.css}
                    label=${p.css}
                    title=${p.css}
                    @click=${() => this.#select(p.rgb)}
                  ></vf-swatch>
                  ${this.#used.has(rgbKey(p.rgb))
                    ? html`<i class="picker-used-tag" title="used in this document"></i>`
                    : nothing}
                </span>`
            )}
          </vf-grid>
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
                if (e.key === 'Enter' && valid) this.#commit();
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
