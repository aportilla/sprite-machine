// ---------------------------------------------------------------------------
// <sm-desktop-patterns> — the Desktop Patterns control panel's body (the
// window is index.html's #tpl-patterns-window, opened by shell/patterns.js
// from Sprite Machine → Desktop Patterns): System 7.5's Desktop Patterns
// composition — the PREVIEW WELL across the top, the chooser under it, Set
// Desktop Pattern along the bottom — with the classic scrollbar (one
// pattern at a time, "67/74") replaced by a GRID of every pattern the kit
// ships: the 38 standard MacPaint fills (PATTERN_NAMES, palette order) as a
// 13×3 vf-grid of 16px cells — a cell IS two repeats of its 8×8 pattern,
// the way MacPaint's own pattern bar showed them — the last well empty (38
// tiles no rectangle; the kit's palette source kept spare wells too).
//
// PENDING-SELECTION SEMANTICS, the Colors dialog's: opening seeds the
// pending pattern from the desktop's current one; pressing a cell SELECTS
// (the well previews it, the ring marks the cell — the desktop is
// untouched), and only Set Desktop Pattern commits, through the shell
// slice's one setter (shell/patterns.js writes it onto the desktop and
// desktop-state.js persists it). Closing the window discards a selection
// never set. A cell picks on the PRESS — the app's windoid rule: the
// desktop raises a pressed background window by re-inserting its node at
// gesture end, which cancels that press's click, and this panel sits in
// the document tier where a press on it from behind a document window (or
// from the Finder) is exactly such a raise; the button's @click stays as
// the keyboard path (Enter/Space), a no-op right after a press.
//
// Every fill is the kit's own: the well and each cell are `vf-container
// pattern="…"` boxes at DECLARED sizes, so the rasters are exact — 1-bit
// at every density — and nothing is measured; the well wears the kit's
// rule on all four edges (FrameRect: 1px inside the declared box). The
// selection ring is the one thing drawn here: a 1px black line over the
// cell's edge with a 1px white line inside it, so it reads on `black` (the
// white) and on `white` (the black) alike — the swatch well's own anatomy.
// A CONNECTED component in the slice sense (it calls shell's setter), but
// it renders nothing FROM the store: the pending pattern is its own.
// ---------------------------------------------------------------------------

import { PATTERN_NAMES } from 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { shell } from '../state/shell.js';
import { baseStyles } from './base-styles.js';

/** The preview well's declared box, system px (the rule inside it). */
export const PATTERN_WELL = { width: 222, height: 160 };
/** The chooser: 13×3 cells of 16px — 13×16 + 12 rules + 2 frame = 222 wide,
 *  the well's width; 3×16 + 2 + 2 = 52 tall. index.html's template states
 *  the window size from these numbers. */
export const PATTERN_GRID = { cols: 13, rows: 3, cell: 16 };

export class SmDesktopPatterns extends LitElement {
  static styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      /* A grid cell IS its pattern: a bare button exactly the cell's size,
         the kit container inside it painting the fill. Reads the kit's
         cursor token first (applyCursor's blanket can't pierce this shadow
         root — the atlas view's note). */
      .cell {
        position: relative;
        display: block;
        width: calc(var(--vf-scale, 1) * ${PATTERN_GRID.cell}px);
        height: calc(var(--vf-scale, 1) * ${PATTERN_GRID.cell}px);
        margin: 0;
        padding: 0;
        border: 0;
        background: none;
        cursor: var(--vf-cursor, pointer);
      }
      .cell:focus-visible {
        outline: 1px dotted var(--vf-black, #000);
        outline-offset: -3px;
      }
      /* The selection ring: black over the cell's edge, white inside it.
         Always in the DOM — selection flips a class (visibility, not
         display), the no-remount discipline of the picker's overlays. */
      .ring {
        position: absolute;
        inset: 0;
        border: calc(var(--vf-scale, 1) * 1px) solid var(--vf-black, #000);
        box-shadow: inset 0 0 0 calc(var(--vf-scale, 1) * 1px) var(--vf-white, #fff);
        pointer-events: none;
        visibility: hidden;
      }
      .ring.on {
        visibility: visible;
      }
    `,
  ];

  /** The pending pattern — what the well previews and Set would commit.
   *  Seeded from the desktop's current pattern at creation (the panel is
   *  created per open, so this IS the open-time seed). */
  #pending = shell.get().desktopPattern;

  render() {
    const pending = this.#pending;
    return html`
      <vf-stack gap="10" place="center">
        <vf-container
          class="well"
          width=${PATTERN_WELL.width}
          height=${PATTERN_WELL.height}
          rule="top right bottom left"
          pattern=${pending}
          role="img"
          aria-label=${`preview: ${pending}`}
        ></vf-container>
        <vf-grid
          columns=${PATTERN_GRID.cols}
          rows=${PATTERN_GRID.rows}
          cell-width=${PATTERN_GRID.cell}
          cell-height=${PATTERN_GRID.cell}
          role="group"
          aria-label="desktop patterns"
        >
          ${PATTERN_NAMES.map(
            (name) => html`
              <button
                type="button"
                class="cell"
                title=${name}
                aria-label=${`${name} pattern`}
                aria-pressed=${name === pending ? 'true' : 'false'}
                @pointerdown=${(e) => this.#onCellPress(e, name)}
                @click=${() => this.#pick(name)}
              >
                <vf-container
                  width=${PATTERN_GRID.cell}
                  height=${PATTERN_GRID.cell}
                  pattern=${name}
                ></vf-container>
                <span class=${classMap({ ring: true, on: name === pending })}></span>
              </button>
            `
          )}
        </vf-grid>
        <vf-button class="set" variant="default" @click=${this.#set}>
          Set Desktop Pattern
        </vf-button>
      </vf-stack>
    `;
  }

  // Primary button only — a right-press is no pick, the atlas view's rule.
  #onCellPress(e, name) {
    if (e.button !== 0) return;
    this.#pick(name);
  }

  #pick(name) {
    if (name === this.#pending) return;
    this.#pending = name;
    this.requestUpdate();
  }

  // The one commit path: the shell slice's setter — shell/patterns.js
  // paints it onto the desktop, desktop-state.js persists it.
  #set = () => {
    shell.setDesktopPattern(this.#pending);
  };
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-desktop-patterns'))
  customElements.define('sm-desktop-patterns', SmDesktopPatterns);
