// ---------------------------------------------------------------------------
// <sm-tool-strip> — the rail's tool strip: pencil / rect / fill / eyedropper as
// a 1-column vf-grid of square cells (the selected cell inverts, CSS off
// `.active`). A presentational LEAF: props down (`tool`, `picking`), bubbling
// `sm-pick-tool {tool}` / `sm-arm-eyedropper` events up.
//
// LIGHT DOM + `display: contents`, so `.editor-toolstrip` keeps its box.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { LitElement, html } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import '../icons.js'; // registers the <sp-icon-*> tool glyphs used below

// The four tool glyphs, as module-constant templates: a TemplateResult diffs to
// a no-op, where a freshly built element would make lit swap the icon on every
// re-render.
const ICON_DRAW = html`<sp-icon-draw></sp-icon-draw>`;
const ICON_RECT = html`<sp-icon-rectangle></sp-icon-rectangle>`;
const ICON_FILL = html`<sp-icon-color-fill></sp-icon-color-fill>`;
const ICON_SAMPLER = html`<sp-icon-sampler></sp-icon-sampler>`;

export class SmToolStrip extends LitElement {
  static properties = {
    tool: {},
    picking: { type: Boolean },
  };

  constructor() {
    super();
    this.tool = 'pencil';
    this.picking = false;
  }

  createRenderRoot() {
    return this; // light DOM — style.css + `capture.sh dom` keep working
  }

  render() {
    const cell = (name, glyph, title, active, onClick) => html`
      <button
        type="button"
        class=${classMap({ 'editor-tool': true, active })}
        title=${title}
        aria-label=${name}
        @click=${onClick}
      >
        ${glyph}
      </button>
    `;
    return html`
      <vf-grid
        class="editor-toolstrip"
        columns="1"
        cell-width="28"
        cell-height="28"
        role="group"
        aria-label="tools"
      >
        ${cell('pencil', ICON_DRAW, 'pencil — draw (B)', this.tool === 'pencil', () =>
          this.#pickTool('pencil')
        )}
        ${cell(
          'rectangle',
          ICON_RECT,
          'rectangle — drag a box (R)',
          this.tool === 'rect',
          () => this.#pickTool('rect')
        )}
        ${cell(
          'fill',
          ICON_FILL,
          'fill — flood a region, or replace a color (G)',
          this.tool === 'fill',
          () => this.#pickTool('fill')
        )}
        ${cell(
          'eyedropper',
          ICON_SAMPLER,
          'eyedropper — click the sprite to sample (I, or hold Alt while drawing)',
          this.picking,
          () =>
            this.dispatchEvent(new CustomEvent('sm-arm-eyedropper', { bubbles: true }))
        )}
      </vf-grid>
    `;
  }

  #pickTool(tool) {
    this.dispatchEvent(
      new CustomEvent('sm-pick-tool', { detail: { tool }, bubbles: true })
    );
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-tool-strip'))
  customElements.define('sm-tool-strip', SmToolStrip);
