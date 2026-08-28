// ---------------------------------------------------------------------------
// <sm-tool-strip> — the rail's tool strip: selection / pencil / rect / fill /
// eraser / eyedropper as a 1-column vf-grid of square cells (the selected
// cell inverts, CSS off `.active`). A presentational LEAF: props down
// (`tool`), bubbling `sm-pick-tool {tool}` events up. All six cells are
// sibling sticky modes — the eraser, eyedropper and selection select like any
// other tool. The selection leads, as MacPaint's palette did.
//
// A cell picks on the PRESS, not the click — System 7's tool palettes act on
// mouse-down (the cell inverts the instant the button goes down, and the
// tool is live before it comes back up), and the windoid rule demands it:
// the desktop raises a pressed windoid by re-inserting its node at the end
// of the press, which cancels that press's click, so a click-driven pick
// would swallow the first pick whenever another windoid had been raised
// over the palette. The button's @click stays as the keyboard path
// (Enter/Space) and is a no-op right after a press — every path guards on
// the tool actually changing. The same rule as sm-face-picker / the atlas
// tiles in sm-atlas-view.
//
// Shadow DOM; `:host { display: contents }`, so the strip sits in the rail
// directly.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import '../icons.js'; // registers the <sp-icon-*> tool glyphs used below
import { baseStyles } from './base-styles.js';

// The six tool glyphs, as module-constant templates: a TemplateResult diffs to
// a no-op, where a freshly built element would make lit swap the icon on every
// re-render.
const ICON_SELECT = html`<sp-icon-rect-select></sp-icon-rect-select>`;
const ICON_DRAW = html`<sp-icon-draw></sp-icon-draw>`;
const ICON_RECT = html`<sp-icon-rectangle></sp-icon-rectangle>`;
const ICON_FILL = html`<sp-icon-color-fill></sp-icon-color-fill>`;
const ICON_ERASE = html`<sp-icon-erase></sp-icon-erase>`;
const ICON_SAMPLER = html`<sp-icon-sampler></sp-icon-sampler>`;

export class SmToolStrip extends LitElement {
  static styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
      /* Tool cells inside the vf-grid strip: plain buttons that fill their cell
       (the grid draws the internal lattice; it's frameless — the flush
       windoid's own frame is the strip's outer border); the selected tool
       inverts. */
      .editor-toolstrip .editor-tool {
        place-self: stretch;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0;
        padding: 0;
        border: 0;
        background: var(--sm-white);
        color: var(--sm-black);
        /* Reads the kit's cursor token first: applyCursor's blanket can't pierce
         this shadow root, and a bare \`cursor: pointer\` would put the native hand
         back alongside the kit's drawn arrow. */
        cursor: var(--vf-cursor, pointer);
        --mod-icon-size: 18px;
      }
      .editor-toolstrip .editor-tool:active,
      .editor-toolstrip .editor-tool.active {
        background: var(--sm-black);
        color: var(--sm-white);
      }
      .editor-toolstrip .editor-tool:focus-visible {
        outline: 1px dotted currentColor;
        outline-offset: -4px;
      }
    `,
  ];

  static properties = {
    tool: {},
  };

  constructor() {
    super();
    this.tool = 'pencil';
  }

  render() {
    const cell = (name, glyph, title, active, tool) => html`
      <button
        type="button"
        class=${classMap({ 'editor-tool': true, active })}
        title=${title}
        aria-label=${name}
        aria-pressed=${active ? 'true' : 'false'}
        @pointerdown=${(e) => this.#onCellPress(e, tool)}
        @click=${() => this.#pickTool(tool)}
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
        frameless
        role="group"
        aria-label="tools"
      >
        ${cell(
          'selection',
          ICON_SELECT,
          'selection — drag a box, then drag inside it to move (S)',
          this.tool === 'select',
          'select'
        )}
        ${cell(
          'pencil',
          ICON_DRAW,
          'pencil — draw (B)',
          this.tool === 'pencil',
          'pencil'
        )}
        ${cell(
          'rectangle',
          ICON_RECT,
          'rectangle — drag a box (R)',
          this.tool === 'rect',
          'rect'
        )}
        ${cell(
          'fill',
          ICON_FILL,
          'fill — flood a region, or replace a color (G)',
          this.tool === 'fill',
          'fill'
        )}
        ${cell(
          'eraser',
          ICON_ERASE,
          'eraser — draw transparency (E; right-click erases with any tool)',
          this.tool === 'eraser',
          'eraser'
        )}
        ${cell(
          'eyedropper',
          ICON_SAMPLER,
          'eyedropper — click the sprite to sample (I, or hold Alt while drawing)',
          this.tool === 'eyedropper',
          'eyedropper'
        )}
      </vf-grid>
    `;
  }

  // The press path (see the header): the primary button only — a right
  // button is no pick, and the kit's windoid drag never starts from a cell.
  #onCellPress(e, tool) {
    if (e.button !== 0) return;
    this.#pickTool(tool);
  }

  // Idempotent, so the click that follows a press (when the desktop doesn't
  // cancel it — the palette already frontmost) is a no-op rather than a
  // second dispatch; the keyboard's click is the one that lands here live.
  #pickTool(tool) {
    if (tool === this.tool) return;
    this.dispatchEvent(
      new CustomEvent('sm-pick-tool', { detail: { tool }, bubbles: true })
    );
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-tool-strip'))
  customElements.define('sm-tool-strip', SmToolStrip);
