// ---------------------------------------------------------------------------
// <sm-color-picker> — the "Colors" dialog: a System 7 movable modal (vf-dialog)
// holding the Hilbert-laid 256-color palette as a 16×16 vf-grid of swatch
// cells. CONNECTED CHROME, one per app (it sits in index.html's dialog set):
// the picker serves the app-level session ink (one palette, one ink, System 7
// style), so it reads `session` directly — `pickerOpen` drives the dialog and
// a swatch click funnels through session.pickColor, the same single path every
// color pick takes.
//
// USED-COLOR BADGES: every palette cell whose color appears in the ACTIVE
// document wears a little white corner tag (a black-seamed dog-ear, page CSS —
// this is light DOM). The set is rescanned on every open (the per-face views
// are read by reference, so a pending live stroke is already in them) and the
// ActiveDocController covers the boot race where ?palette=1 opens the dialog
// before the first document lands. There is no "recent colors" row — the
// badges are the document's own palette, which is the recency that matters.
//
// LIGHT DOM ON PURPOSE — the one non-shadow component: the kit's page-drawn
// cursor keeps itself above a modal by re-promoting its top-layer popover when
// it OBSERVES a vf-dialog's `open` attribute flip, and its MutationObserver
// watches the light DOM only. A vf-dialog inside a shadow root opens ABOVE the
// cursor art (the pointer vanishes while picking a color), so this component
// renders into its light DOM (createRenderRoot → this), exactly like the
// desktop skeleton's own dialogs. No styles of its own — the dialog + grid
// carry kit styles, and style.css owns the page's share (the host's
// `display: contents`, the cell wrappers, the used-color tag).
//
// LAZY-BUILD LATCH: 256 cells are expensive and most sessions never open the
// dialog — nothing is rendered until the first open, and from then on the
// dialog persists (built once, ever) with `open` alone driving it
// (`vf-dialog.show()` is verbatim `open = true`). Its native <dialog> is
// top-layer, so where it lives can never clip it.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { LitElement, html, nothing } from 'lit';
import { PALETTE_256 } from '../lib/constants.js';
import { distinctColors, rgbKey } from '../lib/color.js';
import { session } from '../state/session.js';
import { workspace } from '../state/workspace.js';
import { StoreController, ActiveDocController } from '../state/store-controller.js';

export class SmColorPicker extends LitElement {
  #built = false; // the dialog's 256 cells exist once it has been opened
  /** @type {Set<number>} rgbKeys used in the active document (last open's scan) */
  #used = new Set();

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

  #pick(rgb) {
    session.pickColor(rgb);
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
    // Rescan only while open (the modal blocks edits, so per open it settles
    // after at most one boot-race re-render); a closed re-render — any session
    // patch — reuses the last scan instead of walking six tiles.
    if (open) this.#used = this.#usedKeys();
    return html`
      <vf-dialog
        heading="Colors"
        closable
        width="244"
        height="266"
        .open=${open}
        @vf-close=${() => session.closePicker()}
      >
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
                  @click=${() => this.#pick(p.rgb)}
                ></vf-swatch>
                ${this.#used.has(rgbKey(p.rgb))
                  ? html`<i class="picker-used-tag" title="used in this document"></i>`
                  : nothing}
              </span>`
          )}
        </vf-grid>
      </vf-dialog>
    `;
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-color-picker'))
  customElements.define('sm-color-picker', SmColorPicker);
