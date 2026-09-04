// ---------------------------------------------------------------------------
// <sm-tool-strip> — the rail's tool strip: selection / pencil / rect / fill /
// eraser / eyedropper as a 1-column vf-grid of cells (the selected cell
// inverts, CSS off `.active`). A presentational LEAF: props down (`tool`),
// bubbling `sm-pick-tool {tool}` events up. All six cells are sibling sticky
// modes — the eraser, eyedropper and selection select like any other tool.
// The selection leads, as MacPaint's palette did.
//
// THE ICONS are the app's own art: six 22×19 1-bit PNGs in src/assets/tools/,
// black ink on transparency and nothing else (the Adobe Spectrum workflow
// glyphs that used to draw them — and the dependency with them — are gone).
// A CELL IS ITS ICON: the vf-grid's cell is stated at the art's size
// (TOOL_CELL in shell/layout.js, which derives the windoid's box from it),
// and the art fills it edge to edge through the kit's `vf-img` — one image
// pixel one system px, magnified nearest-neighbor on whole device pixels, so
// the glyph is crisp at any display scale — no margin, no icon-size token,
// nothing measured. The selected cell inverts as before, the glyph with it:
// the art being pure black, `filter: invert(1)` on the image is an EXACT
// white-on-black of the same file (a transparent texel stays transparent, a
// black one turns white — no gray fringe, no second asset). The focus ring
// sits on the cell's outermost pixel row (outline-offset −1), which every
// icon leaves clear.
//
// A cell picks on the PRESS, not the click — System 7's tool palettes act
// on mouse-down: the cell inverts the instant the button goes down, and
// the tool is live before it comes back up. That is FEEL — shared by the
// Sprite View's face tiles (sm-atlas-view) — not a bridge. The bridge
// history: the desktop raises a pressed windoid by re-inserting its node
// (DOM order tracks z-order), and through vintage-frames 0.5.3 it did so
// at pointerup, between a press's release and its click — Chrome drops a
// click whose mousedown node left the tree — so the first click in a
// windoid behind another windoid was swallowed and every windoid control
// carried a pointerdown pick to dodge it. 0.5.4 runs the re-insert in a
// task AFTER the click lands, and those bridges are retired (sm-face-picker,
// sm-stage-controls, sm-desktop-patterns: plain clicks). Here — and on the
// face tiles — the press stays for its own sake; the click that follows it always
// lands now and is a no-op on the tool already current (#pickTool guards
// on the tool changing), and it is also the keyboard path (Enter/Space).
//
// Shadow DOM; `:host { display: contents }`, so the strip sits in the rail
// directly.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { TOOL_CELL } from '../shell/layout.js';
import { baseStyles } from './base-styles.js';
import selectUrl from '../assets/tools/select.png';
import pencilUrl from '../assets/tools/pencil.png';
import rectUrl from '../assets/tools/rect.png';
import fillUrl from '../assets/tools/fill.png';
import eraserUrl from '../assets/tools/eraser.png';
import eyedropperUrl from '../assets/tools/eyedropper.png';

// tool key -> its glyph. Swapping the artwork means editing this map alone
// (and TOOL_CELL, should the art's size change — the cell IS the icon).
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
      /* Tool cells inside the vf-grid strip: plain buttons that fill their cell
       (the grid draws the internal lattice; it's frameless — the windoid's
       own frame is the strip's outer border, the body running to it with
       no inset of its own); the selected tool inverts. */
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
      }
      .editor-toolstrip .editor-tool:active,
      .editor-toolstrip .editor-tool.active {
        background: var(--sm-black);
        color: var(--sm-white);
      }
      /* The inverted cell's glyph: the same 1-bit file, inverted — exact,
         because the art is pure black on transparency (see the header). */
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
  };

  constructor() {
    super();
    this.tool = 'pencil';
  }

  render() {
    // One template for every cell: a re-render diffs to attribute updates
    // only (an unchanged src is a no-op), so the images never re-mount.
    const cell = (name, tool, title) => {
      const active = this.tool === tool;
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
        columns="1"
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

  // The press path (see the header): the primary button only — a right
  // button is no pick, and the kit's windoid drag never starts from a cell.
  #onCellPress(e, tool) {
    if (e.button !== 0) return;
    this.#pickTool(tool);
  }

  // Idempotent: the click that follows a press, and a click on the current
  // cell, dispatch nothing; the keyboard's click is the one that lands live.
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
