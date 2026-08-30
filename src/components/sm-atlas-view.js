// ---------------------------------------------------------------------------
// <sm-atlas-view> — the Full Sprite View window's body: the FACE PICKER
// strip across the top (the six cube-view radios, moved here from the
// document window — one app-level picker serving the ACTIVE document, the
// way the options strip serves one tool), over the ATLAS GRID — a formal
// 3×2 vf-grid holding one face tile per cell, in the sheet's own
// arrangement (DEFAULT_ATLAS_LAYOUT), each cell a live canvas of that
// face's slice drawn nearest-neighbor. The grid is a PICKING SURFACE too:
// pressing a tile selects that face — on the POINTERDOWN, the same windoid
// press rule as the picker radios (the desktop's raise re-insert cancels a
// press's click) — and the selected tile is stroked with a red ring
// (--sm-select, the face-picker art's own #ff4f4f) laid over its edge.
//
// The windoid is FIXED-size — no grow box: shell/windows.js pins its width
// to the atlas grid block (SPRITE_WIDTH in shell/layout.js — cols ×
// ATLAS_GRID.cell + interior rules + borders) and derives its height from
// the active TILE's ratio (square tiles ⇒ square cells), so the grid fills
// the body below the strip exactly — no margins; the .atlas-box centering +
// clip is the safety net for degenerate cases (no active document, a
// mid-refit frame).
//
// A CONNECTED component that FOLLOWS THE ACTIVE DOCUMENT (the utility
// windows serve the active document only): followActive re-wires it across
// activation switches onto that context's doc, BOTH channels:
//   - change (structural): a new sheet / tile size — resize the backing
//     stores, re-derive the cell height, repaint;
//   - live (stroke-rate, rAF-coalesced): the canonical sheet was just blitted
//     (blit-then-notify), so tracking a stroke is one sliced putImageData
//     pass per frame — the second live subscriber ever, after the rebuilder,
//     and the same cost class.
// The picker and the ring read the active context's face off the workspace
// store (a StoreController re-renders on any workspace change — a face
// switch, an activation) and a pick — strip or grid — routes through
// workspace.setFace on the ACTIVE key. With no active document the cells
// just keep their last pixels — the windoid is hidden whenever the
// application is inactive, so nothing stale ever shows. Each cell canvas
// keeps a native tile-resolution backing store (CSS scales it crisp to the
// fixed cell).
//
// THE CELLS WEAR A PATTERN: `pattern` (a kit library name — gray-25, dots,
// bricks, … — or sixteen hex digits, the kit's own attribute grammar) paints
// a 1-bit MacPaint pattern as each cell's background, behind the face
// canvas, so a tile's TRANSPARENT texels read as "nothing here" against the
// paper the way they do on a System 7 desktop. It is the kit's own fill —
// `PatternFillController` + the `vfPatternFill` recipe, exactly what
// `vf-container pattern="…"` does — one controller per cell, sized from the
// cell's DECLARED geometry (ATLAS_GRID.cell × the derived cell height, the
// same numbers the vf-grid lays out), so nothing is measured and the raster
// is exact at every density. Unset, the cells stay plain white.
// ---------------------------------------------------------------------------

import { PatternFillController, vfPatternFill } from 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { createRef, ref } from 'lit/directives/ref.js';
import { workspace, followActive } from '../state/workspace.js';
import { StoreController } from '../state/store-controller.js';
import { DEFAULT_ATLAS_LAYOUT } from '../lib/atlas.js';
import { ATLAS_GRID } from '../shell/layout.js';
import './sm-face-picker.js'; // registers <sm-face-picker>
import { baseStyles } from './base-styles.js';
import { parsePatternAttr } from './ui-bits.js';

// The face-picker row order: mirror pairs, so flipping between a pair for
// reference is one step.
const FACES = ['left', 'right', 'front', 'back', 'top', 'bottom'];

// The grid's cells: the sheet's own row-major arrangement, each face with
// its layout cell — the paint offsets into the canonical atlas.
const GRID_CELLS = DEFAULT_ATLAS_LAYOUT.flatMap((row, r) =>
  row.map((face, c) => ({ face, r, c }))
);

export class SmAtlasView extends LitElement {
  static properties = {
    /** The cells' background pattern: a kit library name or 16 hex digits
     *  (docs/PATTERNS.md in vintage-frames). Unset ⇒ plain white cells. */
    pattern: { type: String },
  };

  static styles = [
    baseStyles,
    vfPatternFill,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
      }
      /* The picker strip: the status strip's grammar upside down (a white
         band over a 1px black rule), like the 3D View's controls strip.
         Every metric rides --vf-scale (the kit's layout contract — and the
         windoid's fixed geometry is system-px arithmetic, so an unscaled
         padding would break the SPRITE_CHROME math at any scale but 1).
         The windoid's fixed width is the atlas grid's, two system px wider
         than the picker block — the centering absorbs that slack. */
      .picker-strip {
        flex: none;
        display: flex;
        justify-content: center;
        padding: calc(var(--vf-scale, 1) * 8px) calc(var(--vf-scale, 1) * 12px);
        border-bottom: calc(var(--vf-scale, 1) * 1px) solid var(--vf-black, #000);
        background: var(--vf-white, #fff);
        overflow: hidden;
      }
      /* The atlas box: what the strip leaves of the column. The windoid's
         derived geometry makes the fixed-size grid fill it exactly; the
         centering + clip only ever matter in the degenerate cases. */
      .atlas-box {
        flex: 1;
        min-height: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }
      /* A grid cell IS its face tile: a bare button filling the well edge to
         edge (the grid's 1px rules are the only lines between tiles — it's
         frameless, the windoid frame its perimeter). background-COLOR, not
         the shorthand: the kit's vfPatternFill paints the pattern as this
         box's background-image (the .vf-pattern-fill rules), and a shorthand
         here would reset it. */
      .atlas-cell {
        place-self: stretch;
        position: relative;
        display: block;
        margin: 0;
        padding: 0;
        border: 0;
        background-color: var(--vf-white, #fff);
        /* Reads the kit's cursor token first: applyCursor's blanket can't
           pierce this shadow root, and a bare \`cursor: pointer\` would put
           the native hand back alongside the kit's drawn arrow. */
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
      /* The selection ring: the edited face's square stroked in the
         face-picker art's red, laid over the tile's own edge. Always in the
         DOM — selection flips a class (visibility, not display), the same
         no-remount discipline as the picker's dither overlay. */
      .atlas-ring {
        position: absolute;
        inset: 0;
        border: calc(var(--vf-scale, 1) * 2px) solid var(--sm-select, #ff4f4f);
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
  #cellH = ATLAS_GRID.cell; // square until a live tile says otherwise
  /** `pattern`, resolved through the kit's grammar; null paints nothing. */
  #pattern = null;
  #patternWarn = { warned: false };

  constructor() {
    super();
    /** @type {string|null} the `pattern` attribute, verbatim (see willUpdate) */
    this.pattern = null;
    // The picker's and the ring's share: re-render on any workspace change (a
    // face switch, an activation) — the pixels themselves ride the doc
    // channels below.
    new StoreController(this, workspace.store);
    // One kit pattern fill per cell, on the cell's own box (the button), at
    // the cell's DECLARED size — the grid lays the cells out from these same
    // numbers, so the raster is exact and nothing is measured. The controller
    // re-applies after every update, which is how a cell-height change
    // (#syncGeometry's requestUpdate) re-sizes the raster.
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
    // Follow the active document: each activation re-wires both doc channels
    // onto the new context and adopts its sheet immediately — which also
    // covers a RECONNECT (raising any window makes vf-desktop re-order the
    // slotted windows in the light DOM, disconnecting + reconnecting this
    // element), since re-following replays the current context through
    // #syncGeometry.
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
    // The cell canvases exist only now — adopt the sheet they missed.
    this.#syncGeometry();
  }

  render() {
    const active = workspace.active();
    const face = active?.face ?? '';
    return html`
      <div class="picker-strip">
        <sm-face-picker
          .faces=${FACES}
          .selected=${face}
          @sm-select-face=${this.#onSelectFace}
        ></sm-face-picker>
      </div>
      <div class="atlas-box">
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
      </div>
    `;
  }

  // A pick — from the picker strip or an atlas tile — switches the ACTIVE
  // document's edited face (the windoid serves whichever document is active,
  // like every utility window).
  #onSelectFace = (e) => {
    this.#pick(e.detail.face);
  };

  // A tile pick fires on the PRESS, not the click — the same rule as the
  // picker radios above (see sm-face-picker: the desktop's raise re-insert
  // cancels a windoid press's click). The button's @click stays as the
  // keyboard path (Enter/Space) and is a no-op right after a press — every
  // path guards on the face actually changing.
  #onCellPress(e, f) {
    if (e.button !== 0) return;
    this.#pick(f);
  }

  #pick(face) {
    const active = workspace.active();
    if (active && face !== active.face) workspace.setFace(active.key, face);
  }

  // A structural doc change (or an activation): adopt the tile geometry —
  // resize each cell's backing store when the tile actually changed (an
  // identical size skips the reset; the paint covers every pixel anyway),
  // re-derive the cell height through the tile's own ratio — then repaint.
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

  // One pass over the canonical sheet, sliced across the six cell canvases:
  // putImageData's dirty rect reads each face's tile region straight out of
  // the sheet — no per-face copies. The live channel fires AFTER the sheet
  // blit (blit-then-notify), so the atlas is always current here.
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
