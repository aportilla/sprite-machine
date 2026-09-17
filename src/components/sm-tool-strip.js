// <sm-tool-strip>: the Tools palette's cells, a TOOL_GRID vf-grid filled row by
// row. Emits sm-pick-tool {tool}.
//
// Each cell is its icon, a 22×19 1-bit PNG in src/assets/tools/ drawn at
// TOOL_CELL (apps/sprite-editor/layout.js). The art must stay pure black on
// transparency so invert(1) gives an exact selected cell, and must leave the
// outermost pixel row clear for the focus ring.
//
// A cell picks on pointerdown, like a classic Mac tool palette. The click
// that follows is a no-op, and click stays the keyboard path.
//
// `tool` is the chosen tool and `shown` the inverted one, which differ while
// Option is held (lib/tools.js springTool). A pick compares against `tool`.

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { TOOL_CELL, TOOL_GRID } from '../apps/sprite-editor/layout.js';
import { baseStyles } from './base-styles.js';
import selectUrl from '../assets/tools/select.png';
import pencilUrl from '../assets/tools/pencil.png';
import rectUrl from '../assets/tools/rect.png';
import fillUrl from '../assets/tools/fill.png';
import eraserUrl from '../assets/tools/eraser.png';
import eyedropperUrl from '../assets/tools/eyedropper.png';

// Tool key to glyph. TOOL_CELL must match the art's size.
const TOOL_ART = {
  select: selectUrl,
  pencil: pencilUrl,
  rect: rectUrl,
  fill: fillUrl,
  eraser: eraserUrl,
  eyedropper: eyedropperUrl,
};

export class SmToolStrip extends LitElement {
  static styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
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
        /* applyCursor can't reach this shadow root. A bare pointer would show
           the native hand beside the kit's drawn cursor. */
        cursor: var(--vf-cursor, pointer);
      }
      .editor-toolstrip .editor-tool:active,
      .editor-toolstrip .editor-tool.active {
        background: var(--sm-black);
        color: var(--sm-white);
      }
      .editor-toolstrip .editor-tool:active img,
      .editor-toolstrip .editor-tool.active img {
        filter: invert(1);
      }
      .editor-toolstrip .editor-tool:focus-visible {
        outline: 1px dotted currentColor;
        outline-offset: -1px;
      }
    `,
  ];

  static properties = {
    tool: {},
    /** The inverted cell's tool, or null for `tool`. */
    shown: {},
  };

  constructor() {
    super();
    this.tool = 'pencil';
    this.shown = null;
  }

  render() {
    const shown = this.shown ?? this.tool;
    const cell = (name, tool, title) => {
      const active = shown === tool;
      return html`
        <button
          type="button"
          class=${classMap({ 'editor-tool': true, active })}
          title=${title}
          aria-label=${name}
          aria-pressed=${active ? 'true' : 'false'}
          @pointerdown=${(e) => this.#onCellPress(e, tool)}
          @click=${() => this.#pickTool(tool)}
        >
          <vf-img width=${TOOL_CELL.width} height=${TOOL_CELL.height}>
            <img src=${TOOL_ART[tool]} alt="" />
          </vf-img>
        </button>
      `;
    };
    return html`
      <vf-grid
        class="editor-toolstrip"
        columns=${TOOL_GRID.cols}
        cell-width=${TOOL_CELL.width}
        cell-height=${TOOL_CELL.height}
        frameless
        role="group"
        aria-label="tools"
      >
        ${cell(
          'selection',
          'select',
          'selection — drag a box, then drag inside it to move (S)'
        )}
        ${cell('pencil', 'pencil', 'pencil — draw (B)')}
        ${cell('rectangle', 'rect', 'rectangle — drag a box (R)')}
        ${cell('fill', 'fill', 'fill — flood a region, or replace a color (G)')}
        ${cell(
          'eraser',
          'eraser',
          'eraser — draw transparency (E; right-click erases with any tool)'
        )}
        ${cell(
          'eyedropper',
          'eyedropper',
          'eyedropper — click the sprite to sample (I, or hold Alt while drawing)'
        )}
      </vf-grid>
    `;
  }

  #onCellPress(e, tool) {
    if (e.button !== 0) return;
    this.#pickTool(tool);
  }

  // No-op for the current tool, so the click after a press dispatches nothing.
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
