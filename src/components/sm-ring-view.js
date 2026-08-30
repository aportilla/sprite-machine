// ---------------------------------------------------------------------------
// <sm-ring-view> — the 3D Sprite Atlas windoid's body: the CONTROLS STRIP
// across the top (two rows of labeled number fields — views / elev over
// from / scale — each bound live to the ring slice, the same settings File →
// Export Sprite Atlas… edits) over the RING GRID: a one-row frameless
// vf-grid of one ATLAS_GRID.cell cell per view, each a canvas holding that
// view's frame of the rendered sheet — the active document's model seen
// orthographically from that yaw at the strip's elevation, on the kit's
// pattern paper (`pattern`, the Sprite View's grammar) so the frame's
// transparent margin reads as paper.
//
// The windoid is FIXED-size — no grow box: shell/windows.js sets its height
// to RING_HEIGHT and its width to ringWidthFor(views) (shell/layout.js:
// one cell per view + the rules + the borders, floored at the strip's own
// width, RING_MIN_WIDTH), so the grid fills the body edge to edge at the
// default four views and centers in the slack under the floor; the
// .ring-box centering + clip is that slack's home and the safety net for a
// mid-refit frame.
//
// A CONNECTED chrome component. Two things drive the TEMPLATE: the ring
// slice (the cell count, the fields' live() values, the cells' yaw
// captions) and the build slice (nothing directly — the cells' backing size
// comes with the sheet). The PIXELS never go through a store: the renderer's
// follower (scene/ring.js) publishes the rendered sheet canvas on the ring
// slice's SHEET CHANNEL (the doc's onLive shape — hot, imperative, a render
// per rebuild frame during a stroke), and #paint slices it across the cells
// with drawImage — one copy per cell per frame, the Sprite View's cost
// class. connectedCallback subscribes and disconnectedCallback unsubscribes
// (the desktop re-inserts a windoid's node to raise it — the same reconnect
// the Sprite View survives), and every update repaints from the last sheet
// (`ring.sheet()`), so a freshly rendered cell — a views change, a
// reconnect — never sits blank waiting on the next render.
//
// A cell's backing store is the frame's native F × F px; CSS scales it to
// the fixed cell with image-rendering: pixelated — the Sprite View's rule:
// native-resolution backing, crisp CSS scale, never a resample. The cells
// take no cursor claim (nothing to press); the number fields are kit
// controls and claim their own. The pattern paper is one
// PatternFillController per cell over a FIXED POOL of RING_MAX_VIEWS refs:
// the kit's controller paints nothing for a null box, so the unrendered
// cells' controllers simply idle.
// ---------------------------------------------------------------------------

import { PatternFillController, vfPatternFill } from 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { live } from 'lit/directives/live.js';
import { createRef, ref } from 'lit/directives/ref.js';
import { ring, RING_MAX_VIEWS, RING_MAX_SCALE } from '../state/ring.js';
import { StoreController } from '../state/store-controller.js';
import { ringYaws } from '../lib/ring.js';
import { ATLAS_GRID, RING_STRIP } from '../shell/layout.js';
import { baseStyles } from './base-styles.js';
import { parsePatternAttr } from './ui-bits.js';

export class SmRingView extends LitElement {
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
      /* The controls strip: the 3D View's controls band doubled — white
         paper over a 1px rule, every metric riding --vf-scale (the windoid's
         fixed geometry is system-px arithmetic: RING_STRIP in
         shell/layout.js states this box — 4 pad + 25 field + 4 + 25 + 4 pad
         over the rule = 63). A four-column grid: caption, field, caption,
         field — two rows, the fields aligned in their columns. */
      .controls {
        flex: none;
        display: grid;
        grid-template-columns: max-content max-content max-content max-content;
        align-items: center;
        column-gap: calc(var(--vf-scale, 1) * 6px);
        row-gap: calc(var(--vf-scale, 1) * 4px);
        height: calc(var(--vf-scale, 1) * ${RING_STRIP}px);
        padding: calc(var(--vf-scale, 1) * 4px) calc(var(--vf-scale, 1) * 8px);
        border-bottom: calc(var(--vf-scale, 1) * 1px) solid var(--vf-black, #000);
        background: var(--vf-white, #fff);
        white-space: nowrap;
        overflow: hidden;
        /* Three digits ("359", "137") in the kit's field; the token is an
           em of the field's own text. */
        --vf-number-field-width: 3.5em;
      }
      .controls vf-label {
        text-align: right;
      }
      .controls vf-label + vf-number-field + vf-label {
        margin-inline-start: calc(var(--vf-scale, 1) * 8px);
      }
      /* The ring box: what the strip leaves of the column. The windoid's
         derived geometry makes the grid fill it exactly at four views and
         up; under the strip's floor the grid centers in the slack. */
      .ring-box {
        flex: 1;
        min-height: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }
      /* A grid cell IS its frame: filling the well edge to edge (the grid's
         1px rules are the only lines between — frameless, the windoid frame
         its perimeter). background-COLOR, not the shorthand: the kit's
         vfPatternFill paints the pattern as this box's background-image. */
      .ring-cell {
        place-self: stretch;
        position: relative;
        display: block;
        margin: 0;
        padding: 0;
        background-color: var(--vf-white, #fff);
      }
      canvas {
        display: block;
        width: 100%;
        height: 100%;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
      }
    `,
  ];

  /** @type {import('lit/directives/ref.js').Ref<HTMLCanvasElement>[]} */
  #cellCanvas = Array.from({ length: RING_MAX_VIEWS }, () => createRef());
  /** @type {import('lit/directives/ref.js').Ref<HTMLElement>[]} */
  #cellBox = Array.from({ length: RING_MAX_VIEWS }, () => createRef());
  #offSheet = null;
  /** `pattern`, resolved through the kit's grammar; null paints nothing. */
  #pattern = null;
  #patternWarn = { warned: false };

  constructor() {
    super();
    /** @type {string|null} the `pattern` attribute, verbatim (see willUpdate) */
    this.pattern = null;
    // The template's share: re-render on any settings change (the cell
    // count, the fields' values, the yaw captions) — the pixels ride the
    // sheet channel below.
    new StoreController(this, ring.store);
    // One kit pattern fill per cell, on the cell's own box, at the cell's
    // DECLARED size — the grid lays the cells out from the same number, so
    // the raster is exact and nothing is measured. A fixed pool: a cell
    // beyond the current view count has no box (a null ref), and the kit's
    // controller paints nothing for a null box.
    for (let i = 0; i < RING_MAX_VIEWS; i++) {
      new PatternFillController(this, {
        getBox: () => this.#cellBox[i].value ?? null,
        getPattern: () => this.#pattern,
        getSize: () => ({ width: ATLAS_GRID.cell, height: ATLAS_GRID.cell }),
      });
    }
  }

  willUpdate(changed) {
    if (!changed.has('pattern')) return;
    this.#pattern = parsePatternAttr('sm-ring-view', this.pattern, this.#patternWarn);
  }

  connectedCallback() {
    super.connectedCallback();
    // The sheet channel: the follower's every render lands here (a reconnect
    // — the desktop's raise re-insert — re-subscribes; the sheet it missed
    // is painted by the next update).
    this.#offSheet = ring.onSheet((sheet) => this.#paint(sheet));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#offSheet?.();
    this.#offSheet = null;
  }

  updated() {
    // The cells exist only now (a first render, a views change, a
    // reconnect): adopt the last sheet so no cell sits blank.
    this.#paint(ring.sheet());
  }

  render() {
    const st = ring.get();
    const n = st.views;
    const yaws = ringYaws(n, st.offset);
    const num = (e) => e.detail.valueAsNumber;
    return html`
      <div class="controls">
        <vf-label dim>views</vf-label>
        <vf-number-field
          class="ring-views"
          min="1"
          max=${RING_MAX_VIEWS}
          step="1"
          .value=${live(String(st.views))}
          label="views (1–${RING_MAX_VIEWS}): the ring's angle count, a 360/n step"
          @vf-change=${(e) => ring.setViews(num(e))}
        ></vf-number-field>
        <vf-label dim>elev</vf-label>
        <vf-number-field
          class="ring-elev"
          min="0"
          max="90"
          step="1"
          .value=${live(String(st.elevation))}
          label="elevation (0–90): degrees above the horizon"
          @vf-change=${(e) => ring.setElevation(num(e))}
        ></vf-number-field>
        <vf-label dim>from</vf-label>
        <vf-number-field
          class="ring-offset"
          min="0"
          max="359"
          step="1"
          .value=${live(String(st.offset))}
          label="first angle (0–359): degrees from the front"
          @vf-change=${(e) => ring.setOffset(num(e))}
        ></vf-number-field>
        <vf-label dim>scale</vf-label>
        <vf-number-field
          class="ring-scale"
          min="1"
          max=${RING_MAX_SCALE}
          step="1"
          .value=${live(String(st.scale))}
          label="scale (1–${RING_MAX_SCALE}): px per voxel"
          @vf-change=${(e) => ring.setScale(num(e))}
        ></vf-number-field>
      </div>
      <div class="ring-box">
        <vf-grid
          class="ring-grid"
          columns=${n}
          rows="1"
          cell-width=${ATLAS_GRID.cell}
          cell-height=${ATLAS_GRID.cell}
          frameless
          role="group"
          aria-label="3D sprite atlas"
        >
          ${yaws.map(
            (yaw, i) => html`
              <div
                ${ref(this.#cellBox[i])}
                class=${classMap({
                  'ring-cell': true,
                  'vf-pattern-fill': true,
                  'vf-patterned': !!this.#pattern,
                })}
                role="img"
                title=${`${yaw}°`}
                aria-label=${`view ${i + 1} of ${n}: ${yaw}° yaw`}
              >
                <canvas ${ref(this.#cellCanvas[i])}></canvas>
              </div>
            `
          )}
        </vf-grid>
      </div>
    `;
  }

  // The sheet sliced across the cells: each cell's backing store sized to
  // the frame (only when it changed — a size write clears a canvas), the
  // frame copied in nearest-neighbor. A null sheet (no model) clears every
  // cell to paper; a cell past the sheet's own view count (a views change
  // ahead of its render) clears too.
  #paint(sheet) {
    const n = ring.get().views;
    for (let i = 0; i < n; i++) {
      const canvas = this.#cellCanvas[i].value;
      if (!canvas) continue;
      const g = canvas.getContext('2d');
      if (!sheet) {
        g.clearRect(0, 0, canvas.width, canvas.height);
        continue;
      }
      const F = sheet.frame;
      if (canvas.width !== F || canvas.height !== F) {
        canvas.width = F;
        canvas.height = F;
      }
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, F, F);
      if (i < sheet.views) g.drawImage(sheet.canvas, i * F, 0, F, F, 0, 0, F, F);
    }
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-ring-view'))
  customElements.define('sm-ring-view', SmRingView);
