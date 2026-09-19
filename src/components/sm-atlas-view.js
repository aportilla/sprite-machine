// <sm-atlas-view>: the Full Sprite View window's body. A one-row vf-grid with
// one canvas per face of the active document, in the face picker's order, each
// at tile resolution and scaled nearest-neighbor. A cell shows the edited
// layer's tile alone. The cell height follows the tile's aspect ratio. A tile
// picks its face on the press, like the Tools palette, or on the release
// under a finger (press-pick.js).
//
// While the selection tool's `on all faces` is on and a marquee is up, every
// other cell carries the marquee's rectangle projected onto its face
// (lib/select-faces.js), in still ants on a second canvas at system-px
// resolution. A cell is 35 system px for a 40 px tile, so the ring lands within
// a pixel of the texels, not on them.
//
// With no active document the cells keep their last pixels. The windoid is
// hidden then.

import { PatternFillController, vfPatternFill } from 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { createRef, ref } from 'lit/directives/ref.js';
import { session } from '../state/session.js';
import { workspace, followActive } from '../state/workspace.js';
import { StoreController } from '../state/store-controller.js';
import { DEFAULT_ATLAS_LAYOUT } from 'sprite-machine';
import { projectBounds } from '../lib/select-faces.js';
import { ATLAS_GRID, FACE_ROW } from '../apps/sprite-editor/layout.js';
import { baseStyles } from './base-styles.js';
import { drawStillAnts } from './draw-overlays.js';
import { pressPick } from './press-pick.js';
import { parsePatternAttr } from './ui-bits.js';

// Each face in row order, with its row and column in the sheet.
const GRID_CELLS = FACE_ROW.map((face) => {
  const r = DEFAULT_ATLAS_LAYOUT.findIndex((row) => row.includes(face));
  return { face, r, c: DEFAULT_ATLAS_LAYOUT[r].indexOf(face) };
});

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
      /* The projected marquee, over the tile. */
      .atlas-ants {
        position: absolute;
        inset: 0;
        pointer-events: none;
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
  /** @type {Map<string, import('lit/directives/ref.js').Ref<HTMLCanvasElement>>} */
  #cellAnts = new Map(GRID_CELLS.map(({ face }) => [face, createRef()]));
  /** @type {Map<string, import('lit/directives/ref.js').Ref<HTMLButtonElement>>} */
  #cellBox = new Map(GRID_CELLS.map(({ face }) => [face, createRef()]));
  #stopFollow = null;
  #stopSession = null;
  #tileW = 0;
  #tileH = 0;
  #cellH = ATLAS_GRID.cell; // square until a tile sets the ratio
  /** The sheet, copied in once per paint for drawImage. */
  #scratch = document.createElement('canvas');
  #paintedLayer = -1; // the layer the cells last showed
  /** Parsed `pattern`. Null paints nothing. */
  #pattern = null;
  #patternWarn = { warned: false };

  constructor() {
    super();
    /** @type {string|null} the `pattern` attribute, verbatim */
    this.pattern = null;
    // Re-renders the ring on a face switch or activation, and repaints on a
    // layer switch (updated). Other pixel changes come from the doc channels.
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
        // The marquee changes at pointer-move rate and never re-renders here.
        ctx.selection.subscribe(() => this.#paintOutlines()),
      ];
      this.#syncGeometry();
      return () => unsubs.forEach((u) => u());
    });
    this.#stopSession = session.subscribe(() => this.#paintOutlines());
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#stopFollow?.();
    this.#stopFollow = null;
    this.#stopSession?.();
    this.#stopSession = null;
  }

  firstUpdated() {
    // The cell canvases exist only after the first render.
    this.#syncGeometry();
  }

  // A layer switch changes the workspace store only, which re-renders here. A
  // face switch moves which cell is left out of the outlines.
  updated() {
    const active = workspace.active();
    if (active && active.layer !== this.#paintedLayer) this.#paint();
    this.#paintOutlines();
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
              <canvas class="atlas-ants" ${ref(this.#cellAnts.get(f))}></canvas>
              <span class=${classMap({ 'atlas-ring': true, on: f === face })}></span>
            </button>
          `
        )}
      </vf-grid>
    `;
  }

  #onCellPress(e, f) {
    pressPick(e, () => this.#pick(f));
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
    this.#paintOutlines();
  }

  // The marquee's rectangle on every cell but the edited face's, while the
  // option is on and a selection is up. Bounds off the tile project off it, and
  // the canvas clips them.
  #paintOutlines() {
    const active = workspace.active();
    const bounds = active?.selection.get().bounds ?? null;
    const on = !!bounds && session.get().selectAllFaces && this.#tileW === this.#tileH;
    for (const { face } of GRID_CELLS) {
      const c = this.#cellAnts.get(face).value;
      if (!c || !(this.#tileW > 0)) continue;
      if (c.width !== ATLAS_GRID.cell || c.height !== this.#cellH) {
        c.width = ATLAS_GRID.cell; // resizing clears the canvas
        c.height = this.#cellH;
      }
      const g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      if (!on || face === active.face) continue;
      const b = projectBounds(active.face, bounds, face, this.#tileW);
      const sx = (x) => Math.round((x * ATLAS_GRID.cell) / this.#tileW);
      const sy = (y) => Math.round((y * this.#cellH) / this.#tileH);
      drawStillAnts(g, {
        x: sx(b.x0),
        y: sy(b.y0),
        w: sx(b.x1 + 1) - sx(b.x0),
        h: sy(b.y1 + 1) - sy(b.y0),
      });
    }
  }

  // Each cell draws the edited layer's tile for its face. The live channel
  // fires after the sheet blit, so the atlas is current here.
  #paint() {
    const active = workspace.active();
    const s = active?.doc.get();
    const img = s?.atlasImage;
    if (!img || !(this.#tileW > 0)) return;
    this.#paintedLayer = active.layer;
    const scratch = this.#scratch;
    if (scratch.width !== img.width || scratch.height !== img.height) {
      scratch.width = img.width;
      scratch.height = img.height;
    }
    const id =
      img instanceof ImageData
        ? img
        : new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
    scratch.getContext('2d').putImageData(id, 0, 0);
    const w = this.#tileW;
    const h = this.#tileH;
    const layer = Math.min(active.layer, s.layers.length - 1);
    for (const { face, r, c } of GRID_CELLS) {
      const g = this.#cellCanvas.get(face).value?.getContext('2d');
      if (!g) continue;
      g.clearRect(0, 0, w, h);
      g.drawImage(scratch, c * w, (s.rows * layer + r) * h, w, h, 0, 0, w, h);
    }
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-atlas-view'))
  customElements.define('sm-atlas-view', SmAtlasView);
