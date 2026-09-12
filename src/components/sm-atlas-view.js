// <sm-atlas-view>: the Full Sprite View window's body. A 3×2 vf-grid with one
// canvas per face of the active document, each at tile resolution and scaled
// nearest-neighbor. The cell height follows the tile's aspect ratio. A tile
// picks its face on pointerdown, like the Tools palette.
//
// With no active document the cells keep their last pixels. The windoid is
// hidden then.

import { PatternFillController, vfPatternFill } from 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { createRef, ref } from 'lit/directives/ref.js';
import { workspace, followActive } from '../state/workspace.js';
import { StoreController } from '../state/store-controller.js';
import { DEFAULT_ATLAS_LAYOUT } from 'sprite-machine';
import { ATLAS_GRID } from '../apps/sprite-editor/layout.js';
import { baseStyles } from './base-styles.js';
import { parsePatternAttr } from './ui-bits.js';

// Each face with its row and column in the sheet, row-major.
const GRID_CELLS = DEFAULT_ATLAS_LAYOUT.flatMap((row, r) =>
  row.map((face, c) => ({ face, r, c }))
);

export class SmAtlasView extends LitElement {
  static properties = {
    /** Cell background pattern: a kit library name or 16 hex digits. Unset
     *  leaves the cells white. */
    pattern: { type: String },
  };

  static styles = [
    baseStyles,
    vfPatternFill,
    css`
      :host {
        display: contents;
      }
      /* background-color, not the shorthand: vfPatternFill sets this box's
         background-image. */
      .atlas-cell {
        place-self: stretch;
        position: relative;
        display: block;
        margin: 0;
        padding: 0;
        border: 0;
        background-color: var(--vf-white, #fff);
        /* The kit's cursor token first: applyCursor can't reach into this
           shadow root, and a bare pointer shows the native hand. */
        cursor: var(--vf-cursor, pointer);
      }
      .atlas-cell:focus-visible {
        outline: 1px dotted var(--vf-black, #000);
        outline-offset: -3px;
      }
      canvas {
        display: block;
        width: 100%;
        height: 100%;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
      }
      .atlas-ring {
        position: absolute;
        inset: 0;
        border: calc(var(--vf-scale, 1) * 2px) solid var(--vf-black, #000);
        pointer-events: none;
        visibility: hidden;
      }
      .atlas-ring.on {
        visibility: visible;
      }
    `,
  ];

  /** @type {Map<string, import('lit/directives/ref.js').Ref<HTMLCanvasElement>>} */
  #cellCanvas = new Map(GRID_CELLS.map(({ face }) => [face, createRef()]));
  /** @type {Map<string, import('lit/directives/ref.js').Ref<HTMLButtonElement>>} */
  #cellBox = new Map(GRID_CELLS.map(({ face }) => [face, createRef()]));
  #stopFollow = null;
  #tileW = 0;
  #tileH = 0;
  #cellH = ATLAS_GRID.cell; // square until a tile sets the ratio
  /** Parsed `pattern`. Null paints nothing. */
  #pattern = null;
  #patternWarn = { warned: false };

  constructor() {
    super();
    /** @type {string|null} the `pattern` attribute, verbatim */
    this.pattern = null;
    // Re-renders the ring on a face switch or activation. Pixels come from
    // the doc channels.
    new StoreController(this, workspace.store);
    // One pattern fill per cell button at its declared size. The controller
    // re-applies after every update, so a cell-height change resizes the
    // raster.
    for (const { face } of GRID_CELLS) {
      new PatternFillController(this, {
        getBox: () => this.#cellBox.get(face).value,
        getPattern: () => this.#pattern,
        getSize: () => ({ width: ATLAS_GRID.cell, height: this.#cellH }),
      });
    }
  }

  willUpdate(changed) {
    if (!changed.has('pattern')) return;
    this.#pattern = parsePatternAttr('sm-atlas-view', this.pattern, this.#patternWarn);
  }

  connectedCallback() {
    super.connectedCallback();
    // Each activation re-wires both doc channels and syncs at once. This also
    // covers a reconnect, since vf-desktop disconnects and reconnects windows
    // when it re-orders them on a raise.
    this.#stopFollow = followActive(workspace, (ctx) => {
      if (!ctx) return;
      const unsubs = [
        ctx.doc.subscribe(() => this.#syncGeometry()),
        ctx.doc.onLive(() => this.#paint()),
      ];
      this.#syncGeometry();
      return () => unsubs.forEach((u) => u());
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#stopFollow?.();
    this.#stopFollow = null;
  }

  firstUpdated() {
    // The cell canvases exist only after the first render.
    this.#syncGeometry();
  }

  render() {
    const active = workspace.active();
    const face = active?.face ?? '';
    return html`
      <vf-grid
        class="atlas-grid"
        columns=${ATLAS_GRID.cols}
        rows=${ATLAS_GRID.rows}
        cell-width=${ATLAS_GRID.cell}
        cell-height=${this.#cellH}
        frameless
        role="group"
        aria-label="sprite atlas"
      >
        ${GRID_CELLS.map(
          ({ face: f }) => html`
            <button
              ${ref(this.#cellBox.get(f))}
              type="button"
              class=${classMap({
                'atlas-cell': true,
                'vf-pattern-fill': true,
                'vf-patterned': !!this.#pattern,
              })}
              data-face=${f}
              title=${f}
              aria-label=${`${f} face`}
              aria-pressed=${f === face ? 'true' : 'false'}
              @pointerdown=${(e) => this.#onCellPress(e, f)}
              @click=${() => this.#pick(f)}
            >
              <canvas ${ref(this.#cellCanvas.get(f))}></canvas>
              <span class=${classMap({ 'atlas-ring': true, on: f === face })}></span>
            </button>
          `
        )}
      </vf-grid>
    `;
  }

  #onCellPress(e, f) {
    if (e.button !== 0) return;
    this.#pick(f);
  }

  // A no-op for the selected face, so the click after a pointerdown pick does
  // nothing. Keyboard activation (Enter/Space) picks through the click.
  #pick(face) {
    const active = workspace.active();
    if (active && face !== active.face) workspace.setFace(active.key, face);
  }

  #syncGeometry() {
    const s = workspace.active()?.doc.get();
    if (!s || !(s.tileW > 0) || !(s.tileH > 0)) return;
    this.#tileW = s.tileW;
    this.#tileH = s.tileH;
    for (const { face } of GRID_CELLS) {
      const canvas = this.#cellCanvas.get(face).value;
      if (canvas && (canvas.width !== s.tileW || canvas.height !== s.tileH)) {
        canvas.width = s.tileW;
        canvas.height = s.tileH;
      }
    }
    const cellH = Math.max(1, Math.round((ATLAS_GRID.cell * s.tileH) / s.tileW));
    if (cellH !== this.#cellH) {
      this.#cellH = cellH;
      this.requestUpdate();
    }
    this.#paint();
  }

  // putImageData's dirty rect copies each face's region from the sheet with
  // no per-face copy. The live channel fires after the sheet blit, so the
  // atlas is current here.
  #paint() {
    const img = workspace.active()?.doc.get().atlasImage;
    if (!img || !(this.#tileW > 0)) return;
    const id =
      img instanceof ImageData
        ? img
        : new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
    for (const { face, r, c } of GRID_CELLS) {
      const ctx = this.#cellCanvas.get(face).value?.getContext('2d');
      if (!ctx) continue;
      const sx = c * this.#tileW;
      const sy = r * this.#tileH;
      ctx.putImageData(id, -sx, -sy, sx, sy, this.#tileW, this.#tileH);
    }
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-atlas-view'))
  customElements.define('sm-atlas-view', SmAtlasView);
