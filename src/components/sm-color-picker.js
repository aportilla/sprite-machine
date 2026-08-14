// ---------------------------------------------------------------------------
// <sm-color-picker> — the "Colors" dialog: a System 7 movable modal (vf-dialog)
// holding the Hilbert-laid 256-color palette as a 16×16 vf-grid of swatch
// cells. A presentational LEAF: props down (`palette`, `open`), bubbling
// `sm-pick-color {rgb}` / `sm-close` events up.
//
// LAZY-BUILD LATCH: 256 cells are expensive and most sessions never open the
// dialog — nothing is rendered until the first `open`, and from then on the
// dialog persists (built once, ever) with `open` alone driving it
// (`vf-dialog.show()` is verbatim `open = true`). Its native <dialog> is
// top-layer, so living inside the editor's template can never clip it.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { LitElement, html, nothing } from 'lit';

export class SmColorPicker extends LitElement {
  static properties = {
    palette: { attribute: false },
    open: { type: Boolean },
  };

  #built = false; // the dialog's 256 cells exist once it has been opened

  constructor() {
    super();
    /** @type {{css:string, rgb:{r:number,g:number,b:number}}[]} */
    this.palette = [];
    this.open = false;
  }

  createRenderRoot() {
    return this; // light DOM — style.css + `capture.sh dom` keep working
  }

  render() {
    if (!this.#built && !this.open) return nothing;
    this.#built = true;
    return html`
      <vf-dialog
        heading="Colors"
        closable
        width="244"
        height="266"
        .open=${this.open}
        @vf-close=${() =>
          this.dispatchEvent(new CustomEvent('sm-close', { bubbles: true }))}
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
          ${this.palette.map(
            (p) =>
              html`<vf-swatch
                width="14"
                height="14"
                color=${p.css}
                label=${p.css}
                title=${p.css}
                @click=${() =>
                  this.dispatchEvent(
                    new CustomEvent('sm-pick-color', {
                      detail: { rgb: p.rgb },
                      bubbles: true,
                    })
                  )}
              ></vf-swatch>`
          )}
        </vf-grid>
      </vf-dialog>
    `;
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-color-picker'))
  customElements.define('sm-color-picker', SmColorPicker);
