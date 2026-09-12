// <sm-desktop-patterns>: the Desktop Patterns window's body. A preview well, a
// grid of the kit's PATTERN_NAMES and a Set Desktop Pattern button. A cell
// click previews its pattern. Only Set Desktop Pattern commits it.

import { PATTERN_NAMES } from 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { shell } from '../state/shell.js';
import { baseStyles } from './base-styles.js';

/** The preview well's box in system px, its frame rule inside. */
export const PATTERN_WELL = { width: 222, height: 160 };
/** The chooser grid: 13×16 + 12 rules + 2 frame = 222 wide, the well's width.
 *  3×16 + 2 + 2 = 52 tall. apps/desktop-patterns/windows.html sizes the
 *  window from these numbers. */
export const PATTERN_GRID = { cols: 13, rows: 3, cell: 16 };

export class SmDesktopPatterns extends LitElement {
  static styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      /* The kit's cursor token first: applyCursor can't reach into this
         shadow root. */
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
      /* Black over the cell's edge with white inside, so the ring shows on
         black and white patterns. */
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

  /** The pending pattern. The panel is created on each open, so this seeds
   *  it from the desktop's current pattern. */
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

  #pick(name) {
    if (name === this.#pending) return;
    this.#pending = name;
    this.requestUpdate();
  }

  #set = () => {
    shell.setDesktopPattern(this.#pending);
  };
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-desktop-patterns'))
  customElements.define('sm-desktop-patterns', SmDesktopPatterns);
