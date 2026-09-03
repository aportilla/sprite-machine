// ---------------------------------------------------------------------------
// <sm-ring-view> — the 3D Sprite Atlas windoid's body: the CONTROLS STRIP
// across the top (two rows of labeled number fields — views / elev over
// from / size — each bound live to the ring slice, the same settings File →
// Export Sprite Atlas… edits) over the RING ROW: a one-row frameless
// vf-grid of one cell per view, each `size` system px square — the tile at
// 1:1, one image px per system px — holding a canvas with that view's frame
// of the rendered sheet: the active document's model seen orthographically
// from that yaw at the strip's elevation, on the kit's pattern paper
// (`pattern`, the Sprite View's grammar) so the frame's transparent margin
// reads as paper.
//
// THE BODY SCROLLS. The windoid is a `vf-window scrollbars="horizontal"
// flush resizable`: the kit renders this whole element inside its built-in
// scroll area (the rail on the frame's bottom edge, the grow box in the
// corner cell, the viewport flush to the frame — vintage-frames 0.5.5), so
// a row wider than the window scrolls under the rail, and the user sizes
// the window's WIDTH with the grow box (shell/windows.js declares the kit's
// size rect: min-width at the strip, min-height = max-height =
// ringHeightFor(size) — the chrome over one row of cells — so the window
// resizes on the horizontal axis alone). Two
// consequences for the layout here: the host is as wide as the row
// (`width: max-content`, never narrower than the viewport), so the strip's
// paper and rule span the whole scrollable band; and the strip's FIELD
// GROUP is `position: sticky; left: 0`, so the controls hold at the
// viewport's left while the row scrolls under them (nothing between the
// group and the kit's viewport may clip — an `overflow: hidden` ancestor
// would become the sticky's scroll container and pin it to nothing). The
// row sits top-left; the viewport's white fills what a wider window leaves
// to its right.
//
// A CONNECTED chrome component. Two things drive the TEMPLATE: the ring
// slice (the cell count and size, the fields' live() values, the cells' yaw
// captions) and the build slice (nothing directly — the cells' backing size
// comes with the sheet). The PIXELS never go through a store: the renderer's
// follower (scene/ring.js) publishes the rendered sheet canvas on the ring
// slice's SHEET CHANNEL (the doc's onLive shape — hot, imperative, a render
// per rebuild frame during a stroke), and #paint slices it across the cells
// with drawImage — one copy per cell per frame, the Sprite View's cost
// class. connectedCallback subscribes and disconnectedCallback unsubscribes
// (the desktop re-inserts a windoid's node to raise it — the same reconnect
// the Sprite View survives), and every update repaints from the last sheet
// (`ring.sheet()`), so a freshly rendered cell — a views or size change, a
// reconnect — never sits blank waiting on the next render.
//
// A cell's backing store is the frame's native F × F px, and F IS the cell
// (the sheet is rendered at the tile size), so the canvas draws 1:1; the
// image-rendering: pixelated stays as the belt under a mid-refit frame (a
// size change reaches the cells a frame before the sheet re-renders). The
// cells take no cursor claim (nothing to press); the number fields are kit
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
import { ring, RING_MAX_VIEWS, RING_MIN_SIZE, RING_MAX_SIZE } from '../state/ring.js';
import { StoreController } from '../state/store-controller.js';
import { ringYaws } from '../lib/ring.js';
import { RING_STRIP } from '../shell/layout.js';
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
      /* The scroll area's content: as wide as the row, never narrower than
         the viewport (see the header). */
      :host {
        display: flex;
        flex-direction: column;
        width: max-content;
        min-width: 100%;
      }
      /* The controls strip: the 3D View's controls band doubled — white
         paper over a 1px rule, every metric riding --vf-scale (the windoid's
         derived height is system-px arithmetic: RING_STRIP in
         shell/layout.js states this box — 4 pad + 25 field + 4 + 25 + 4 pad
         over the rule = 63). The band spans the whole scrollable width; the
         field group inside it sticks to the viewport's left. No overflow
         clip here (it would capture the sticky). */
      .controls {
        flex: none;
        height: calc(var(--vf-scale, 1) * ${RING_STRIP}px);
        border-bottom: calc(var(--vf-scale, 1) * 1px) solid var(--vf-black, #000);
        background: var(--vf-white, #fff);
        white-space: nowrap;
      }
      /* A four-column grid: caption, field, caption, field — two rows, the
         fields aligned in their columns. Sticky: the row scrolls under it.
         Its padded box is the strip's content width — the windoid's width
         floor (RING_MIN_WIDTH), which drive.mjs pins against this element. */
      .fields {
        position: sticky;
        left: 0;
        width: max-content;
        display: grid;
        grid-template-columns: max-content max-content max-content max-content;
        align-items: center;
        column-gap: calc(var(--vf-scale, 1) * 6px);
        row-gap: calc(var(--vf-scale, 1) * 4px);
        padding: calc(var(--vf-scale, 1) * 4px) calc(var(--vf-scale, 1) * 8px);
        /* Three digits ("359", "255") in the kit's field; the token is an
           em of the field's own text. */
        --vf-number-field-width: 3.5em;
      }
      .fields vf-label {
        text-align: right;
      }
      .fields vf-label + vf-number-field + vf-label {
        margin-inline-start: calc(var(--vf-scale, 1) * 8px);
      }
      /* The row: top-left at its natural width (the host follows it), the
         grid's 1px rules the only lines between the cells (frameless — the
         windoid frame and the rail are its perimeter). */
      .ring-grid {
        flex: none;
        align-self: flex-start;
      }
      /* A grid cell IS its tile. background-COLOR, not the shorthand: the
         kit's vfPatternFill paints the pattern as this box's
         background-image. */
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
    // count and size, the fields' values, the yaw captions) — the pixels
    // ride the sheet channel below.
    new StoreController(this, ring.store);
    // One kit pattern fill per cell, on the cell's own box, at the cell's
    // DECLARED size — the tile size, the same number the grid lays the cells
    // out from, so the raster is exact and nothing is measured. A fixed
    // pool: a cell beyond the current view count has no box (a null ref),
    // and the kit's controller paints nothing for a null box.
    for (let i = 0; i < RING_MAX_VIEWS; i++) {
      new PatternFillController(this, {
        getBox: () => this.#cellBox[i].value ?? null,
        getPattern: () => this.#pattern,
        getSize: () => {
          const { size } = ring.get();
          return { width: size, height: size };
        },
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
    // The cells exist only now (a first render, a views or size change, a
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
        <div class="fields">
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
          <vf-label dim>size</vf-label>
          <vf-number-field
            class="ring-size"
            min=${RING_MIN_SIZE}
            max=${RING_MAX_SIZE}
            step="1"
            .value=${live(String(st.size))}
            label="size (${RING_MIN_SIZE}–${RING_MAX_SIZE}): the tile's edge in px"
            @vf-change=${(e) => ring.setSize(num(e))}
          ></vf-number-field>
        </div>
      </div>
      <vf-grid
        class="ring-grid"
        columns=${n}
        rows="1"
        cell-width=${st.size}
        cell-height=${st.size}
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
