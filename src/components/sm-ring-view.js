// ---------------------------------------------------------------------------
// <sm-ring-view> — the 3D Sprite Atlas windoid's body: the RING ROW alone, a
// one-row vf-grid of one cell per view, each `size` system px square — the
// tile at 1:1, one image px per system px — with NO rules (`rules="none"`:
// the tiles butt, so the row is exactly n × size wide; the windoid frame
// and the kit's rail are its perimeter). The whole BODY is ONE SHEET OF
// PAPER: a `vf-container pattern` FILLING the body's width (`fill-width`,
// the kit's own fill — the one width a page can always express; as wide as
// the kit's scroll plane, so the paper runs past the last tile to the
// frame and under a scrolled row alike) and the tile tall (`pattern` on
// the host — the Sprite View's grammar and the Desktop Patterns panel's
// element: the kit paints its 1-bit paper at the declared height and
// MEASURES the filled axis for the raster, its own contract for an
// undeclared axis, re-rastering as the grow box moves), the grid inside it
// with its surface token cleared so the paper shows through, and each cell
// a `vf-stack` at the tile's declared size — the kit's layout box, which
// paints nothing by contract — holding a canvas that fills it with that
// view's frame of the rendered sheet: the active document's model seen
// orthographically from that yaw at the controls' elevation. A frame's
// transparent margin thus reads as the unbroken paper under the whole
// body — no seam where one tile ends and the next begins (a pattern per
// cell restarts its phase at every cell edge at any tile size that is not
// a multiple of 8), and no edge where the row ends.
//
// The paper container is the app-side bridge for KIT ASK #11 — a window
// body's paper as a kit pattern, the way vf-desktop's `pattern` is the
// screen's (docs/kit-asks-body-pattern.md); the day it ships, the attribute
// moves onto the window and the container goes (the surface-token line
// stays: it is the grid's own knob, not a bridge). A cell is a stack
// rather than a bare vf-container because a bare container paints the
// desktop's ink (kit ask #6, docs/kit-asks-pattern-paper.md) and a cell
// here must paint NOTHING; and when the host names no pattern the paper
// declares `white` — the same ask's bridge — so the body is plain white
// paper rather than the desktop's dither showing through. The controls
// themselves are <sm-ring-controls>, in the window's HEADER (vintage-frames
// 0.6.1) — the band over the body, outside the scroll area — so the body
// is the document and nothing else.
//
// THE BODY SCROLLS. The windoid is a `vf-window scrollbars="horizontal"
// resizable`: the kit renders this element inside its built-in scroll area
// (the rail on the frame's bottom edge, the grow box in the corner cell;
// the viewport runs to the frame's edge — a body or a viewport carries no
// inset of its own since 0.6.0), so a row wider than the window scrolls
// under the rail, and the user sizes the window's WIDTH with the grow box
// (shell/windows.js declares the kit's size rect: min-width at the
// controls, min-height = max-height = ringHeightFor(size), so the window
// resizes on the horizontal axis alone). The paper is the body's one
// in-flow box, at the plane's origin by flow, and as wide as the plane:
// the kit sizes its scrolled plane to in-flow content that cannot wrap
// (0.6.0), and a filled box contributes its content's width — the grid's
// — so the row IS the scroll range, ringRowWidth(views, size) wide (or the
// viewport, whichever is wider), the paper covering all of it; the
// viewport's height is exactly the tile (the derived window height leaves
// the body the tile's own height under the header, so nothing overflows
// down). The host is `display: contents`; the component styles nothing
// about layout — the grid's surface token (the kit's own knob for what is
// behind the cells) and the canvas's block display and nearest-neighbor
// scaling are the whole stylesheet. The rail is wholly the kit's: it
// survives the desktop's raise re-insert, tracks the row as cells come and
// go, and never rubber-bands (0.6.0 — docs/kit-asks-scroll-rail.md; no
// bridge here).
//
// A CONNECTED chrome component. The ring slice drives the TEMPLATE (the
// cell count and size, the cells' yaw captions). The PIXELS never go through
// a store: the renderer's follower (scene/ring.js) publishes the rendered
// sheet canvas on the ring slice's SHEET CHANNEL (the doc's onLive shape —
// hot, imperative, a render per rebuild frame during a stroke), and #paint
// slices it across the cells with drawImage — one copy per cell per frame,
// the Sprite View's cost class. connectedCallback subscribes and
// disconnectedCallback unsubscribes (the desktop re-inserts a windoid's node
// to raise it — the same reconnect the Sprite View survives), and every
// update repaints from the last sheet (`ring.sheet()`), so a freshly
// rendered cell — a views or size change, a reconnect — never sits blank
// waiting on the next render.
//
// A cell's backing store is the frame's native F × F px, and F IS the cell
// (the sheet is rendered at the tile size), so the canvas draws 1:1; the
// image-rendering: pixelated stays as the belt under a mid-refit frame (a
// size change reaches the cells a frame before the sheet re-renders). The
// cells take no cursor claim (nothing to press). The canvas refs are a
// FIXED POOL of RING_MAX_VIEWS: a cell beyond the current view count has no
// canvas (a null ref), and #paint skips it.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { createRef, ref } from 'lit/directives/ref.js';
import { ring, RING_MAX_VIEWS } from '../state/ring.js';
import { StoreController } from '../state/store-controller.js';
import { ringYaws } from '../lib/ring.js';
import { baseStyles } from './base-styles.js';
import { parsePatternAttr } from './ui-bits.js';

export class SmRingView extends LitElement {
  static properties = {
    /** The body's paper: a kit library name or 16 hex digits
     *  (docs/PATTERNS.md in vintage-frames). Unset ⇒ plain white paper. */
    pattern: { type: String },
  };

  static styles = [
    baseStyles,
    css`
      /* No box of its own: the paper sits on the kit's scrolled plane. */
      :host {
        display: contents;
      }
      /* The surface behind the cells is the grid's own token (vf-grid:
         --vf-surface, white by default — a window states it for its
         content). Cleared, so the paper the grid sits on shows through
         between and under the tiles. Not a bridge: the grid keeps no
         surface of its own on a patterned body either way. */
      .ring-grid {
        --vf-surface: transparent;
      }
      /* The frame fills its cell (the kit compiles the canvas's fill-width /
         fill-height to the stack's declared box); a canvas is inline by
         default, and the kit's pattern recipe hands image-rendering back to
         the slot. */
      canvas {
        display: block;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
      }
    `,
  ];

  /** @type {import('lit/directives/ref.js').Ref<HTMLCanvasElement>[]} */
  #cellCanvas = Array.from({ length: RING_MAX_VIEWS }, () => createRef());
  #offSheet = null;
  /** `pattern`, resolved through the kit's grammar; null ⇒ white paper. */
  #pattern = null;
  #patternWarn = { warned: false };

  constructor() {
    super();
    /** @type {string|null} the `pattern` attribute, verbatim (see willUpdate) */
    this.pattern = null;
    // The template's share: re-render on any settings change (the cell
    // count and size, the yaw captions) — the pixels ride the sheet channel
    // below.
    new StoreController(this, ring.store);
  }

  willUpdate(changed) {
    if (!changed.has('pattern')) return;
    // Validated ONCE here (one warning, in this component's name) and handed
    // to the paper verbatim — the kit parses the same grammar there.
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
    // The paper: the host's pattern, or white when it names none — a bare
    // vf-container would paint the desktop's ink (kit ask #6).
    const paper = this.#pattern ? this.pattern : 'white';
    return html`
      <vf-container class="ring-paper" fill-width height=${st.size} pattern=${paper}>
        <vf-grid
          class="ring-grid"
          columns=${n}
          rows="1"
          cell-width=${st.size}
          cell-height=${st.size}
          rules="none"
          role="group"
          aria-label="3D sprite atlas"
        >
          ${yaws.map(
            (yaw, i) => html`
              <vf-stack
                class="ring-cell"
                width=${st.size}
                height=${st.size}
                role="img"
                title=${`${yaw}°`}
                aria-label=${`view ${i + 1} of ${n}: ${yaw}° yaw`}
              >
                <canvas fill-width fill-height ${ref(this.#cellCanvas[i])}></canvas>
              </vf-stack>
            `
          )}
        </vf-grid>
      </vf-container>
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
