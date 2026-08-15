// ---------------------------------------------------------------------------
// <sm-draw-canvas> — the pixel-canvas subsystem: the 4-layer stack (checker/
// onion-skin background, the editable pixel canvas, the hairline guide overlay,
// the cursor overlay), the working buffer, the pencil/rect/fill/eyedropper
// gestures, the integer-scale layout fitting, and the gesture-scoped keys (Esc
// cancels an in-flight rect, Shift square-locks it — document-level, but
// canvas business).
//
// A presentational LEAF: props down (tile geometry + view model + the brush
// state), bubbling events up:
//   - sm-live        { tile, dirty }  on each actual pixel change (the tile is
//                    the working buffer BY REFERENCE — never cloned)
//   - sm-pick-color  { rgb }          an eyedrop hit a painted texel
//   - sm-pick-transparent             an eyedrop hit empty space
//   - sm-replace-all-tiles { target, fill }  a fill click with replace+all on
//
// STATE SPLIT — the correctness core, carried over verbatim: reactive props are
// what the template + updated() react to; everything the pointer hot paths
// touch is a plain `#private` field (the pixel buffer and its ImageData view,
// stroke/drag state, the on-screen scale), so a pencil drag can never schedule
// a re-render at pointer-move rate. Canvas backing stores are sized
// imperatively, never template-bound (a bound width would clear the buffer
// mid-diff). Every stroke is HARD-pixel (alpha 0 or 255) via lib/brush.js.
//
// The working buffer resets in willUpdate when the tile IDENTITY (or the tile
// geometry) changes — identity is the caller's contract: the same reference
// means "same art, don't reset". Any `tool` change cancels an in-flight
// gesture (strictly more robust than the old key-only cancel).
//
// One-shot dev-hook props (plain fields, consumed on the first update; the
// capture tool can't hover/drag/click):
//   - previewCursor: draw the pencil footprint at the tile center.
//   - previewRect {x0,y0,x1,y1,square}: draw the rect tool's live drag preview
//     (modeled as an active drag with no captured pointer, so ESC still
//     demonstrates cancel).
//   - fillOnMount {x,y}: perform a fill click at (x,y). Applied LOCALLY (this
//     tile) even with all-tiles on — a local fill avoids a re-mount mid-mount.
// ---------------------------------------------------------------------------

import { css, LitElement, html } from 'lit';
import { createRef, ref } from 'lit/directives/ref.js';
import { writeTexel, stampBrush, strokeLine } from '../lib/brush.js';
import { roundedRectRows, squareEnd } from '../lib/rect.js';
import { keyAt, floodFill, replaceColor } from '../lib/fill.js';
import {
  drawGuides,
  drawCursorOutline,
  drawPencilPreview,
  drawRectPreview,
} from './draw-overlays.js';
import { baseStyles } from './base-styles.js';

// MIRROR_ALPHA keeps the onion-skin a faint hint.
const MIRROR_ALPHA = 0.22;

export class SmDrawCanvas extends LitElement {
  static styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
      /* The canvas CONTAINER fills the draw box below the options bar and centers
       the integer-scaled canvas stack (sized by #layout()). */
      .editor-canvas-wrap {
        flex: 1 1 auto;
        min-height: 0; /* let it shrink so #layout() can integer-fit the canvas inside */
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 12px;
        overflow: hidden; /* clip if a tiny container forces the min (scale 1) canvas over */
      }
      /* The centered square holding the four aligned canvas layers; sized by #layout(). */
      .editor-canvas-stack {
        position: relative;
        flex: 0 0 auto;
      }
      /* All four layers fill the stack (backing stores managed in JS): a background
       (checkerboard via CSS + faded onion-skin, native tile res), the transparent pixel
       canvas (native tile res), then the guide + cursor overlays (screen res). */
      .editor-canvas-stack > canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
      }
      /* Only the pixel canvas takes pointer events (default auto); the others pass
       clicks through to it. */
      .editor-canvas {
        z-index: 1;
        cursor: crosshair;
        touch-action: none;
      }
      /* Faded onion-skin (drawn) over a checkerboard (CSS), UNDER the transparent
       pixel canvas so both show through unpainted texels. */
      .editor-canvas-bg {
        z-index: 0;
        pointer-events: none;
        /* Classic light transparency checker (pale gray + off-white), so empty texels
         read as "no color" against the darker gray canvas well framing them. */
        background-color: #a8a8a8;
        background-image: linear-gradient(
            45deg,
            #d0d0d0 25%,
            transparent 25%,
            transparent 75%,
            #d0d0d0 75%
          ),
          linear-gradient(
            45deg,
            #d0d0d0 25%,
            transparent 25%,
            transparent 75%,
            #d0d0d0 75%
          );
        background-size: 16px 16px;
        background-position:
          0 0,
          8px 8px;
      }
      /* Hairline extent rules sit ABOVE the pixel canvas; the cursor preview above them. */
      .editor-canvas-overlay {
        z-index: 2;
        pointer-events: none;
      }
      .editor-canvas-cursor {
        z-index: 3;
        pointer-events: none;
      }
    `,
  ];

  static properties = {
    tile: { attribute: false },
    tileW: { type: Number },
    tileH: { type: Number },
    mirrorBehind: { attribute: false },
    guides: { attribute: false },
    tool: {},
    ink: { attribute: false },
    erase: { type: Boolean },
    pencilSize: { type: Number },
    cornerRadius: { type: Number },
    fillReplace: { type: Boolean },
    fillAllTiles: { type: Boolean },
  };

  constructor() {
    super();
    this.tile = null;
    this.tileW = 0;
    this.tileH = 0;
    this.mirrorBehind = null;
    this.guides = null;
    this.tool = 'pencil';
    this.ink = null;
    this.erase = false;
    this.pencilSize = 1;
    this.cornerRadius = 0;
    this.fillReplace = false;
    this.fillAllTiles = false;

    // Dev hooks (plain: consumed once on the first update, never re-read).
    this.previewCursor = false;
    this.previewRect = null;
    this.fillOnMount = null;
  }

  // --- plain fields: the pixel buffer, gesture state, on-screen geometry -----
  #work = null; // Uint8ClampedArray of the working tile — shared with #imgData
  #workingTile = null; // { width, height, data:#work } handed out with sm-live
  #imgData = null; // ImageData VIEW over #work (by reference — never re-copied)
  #dirty = false; // has the user actually changed a pixel since the last reset?

  #drawing = false; // a pencil stroke is in progress
  #prev = null; // last painted texel this stroke, for line interpolation
  #forceErase = false; // right-click erases regardless of the active ink
  #hoverTexel = null; // last hovered texel, for the footprint preview
  // Rect-tool drag state: the anchor + moving corner, and the pointer we captured
  // (kept so ESC / pointercancel can release it).
  #rectDragging = false;
  #rectStart = null; // anchor corner texel {px,py}
  #rectEnd = null; // raw moving corner texel {px,py} (pre square-lock)
  #rectPointer = null; // captured pointerId, for release on cancel
  #shiftLock = false; // Shift held → constrain the drag to a square

  // Live on-screen geometry, re-derived by #layout(): `#scale` is the integer texel
  // size, `#cssW`/`#cssH` the pixel canvas's on-screen px. The guide + cursor overlays
  // draw in this screen space, so they read these.
  #scale = 1;
  #cssW = 0;
  #cssH = 0;
  #laidOut = false;
  #resizeObs = null;

  /** @type {import('lit/directives/ref.js').Ref<HTMLElement>} */
  #wrap = createRef();
  /** @type {import('lit/directives/ref.js').Ref<HTMLElement>} */
  #stack = createRef();
  /** @type {import('lit/directives/ref.js').Ref<HTMLCanvasElement>} */
  #bg = createRef();
  /** @type {import('lit/directives/ref.js').Ref<HTMLCanvasElement>} */
  #canvas = createRef();
  /** @type {import('lit/directives/ref.js').Ref<HTMLCanvasElement>} */
  #overlay = createRef();
  /** @type {import('lit/directives/ref.js').Ref<HTMLCanvasElement>} */
  #cursor = createRef();
  #ctx = null;
  #overlayCtx = null;
  #cursorCtx = null;

  #drawHooksDone = false; // the one-shot canvas dev hooks ran (first update)

  // --- lifecycle -------------------------------------------------------------
  connectedCallback() {
    super.connectedCallback();
    // Gesture-scoped keys only (Esc cancel, Shift square-lock, and the B/R/G
    // mid-drag abandon) — they must work wherever focus is, so they live on the
    // document; the general tool shortcuts belong to shortcuts.js.
    document.addEventListener('keydown', this.#onKeyDown);
    document.addEventListener('keyup', this.#onKeyUp);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.#onKeyDown);
    document.removeEventListener('keyup', this.#onKeyUp);
    this.#resizeObs?.disconnect();
    this.#resizeObs = null;
  }

  willUpdate(changed) {
    // A new face / tile geometry means a fresh working buffer (+ its ImageData
    // view) and no gesture carried over from the old one. `tile` compares by
    // IDENTITY: the caller hands the same reference back only when the art is
    // unchanged.
    if (changed.has('tileW') || changed.has('tileH') || changed.has('tile')) {
      this.#resetWorking();
    } else if (changed.has('tool')) {
      // Switching tools abandons any in-flight gesture — the rect box is
      // discarded (nothing committed) and a live pencil stroke ends.
      this.#cancelRect();
      this.#drawing = false;
      this.#prev = null;
      this.#forceErase = false;
    }
  }

  firstUpdated() {
    this.#ctx = this.#canvas.value.getContext('2d');
    this.#overlayCtx = this.#overlay.value.getContext('2d');
    this.#cursorCtx = this.#cursor.value.getContext('2d');
    // Re-fit whenever the canvas container resizes — it fills the flex draw box, so
    // a window resize (or any change to the fixed regions above) reflows its height
    // and the centered canvas must re-scale. Observing `wrap` directly is
    // feedback-free: #layout() never sets wrap's height (only the stack/overlay/
    // cursor INSIDE it), so resizing those never changes wrap's own box, and a
    // no-op re-run (same scale) early-returns.
    if (typeof ResizeObserver !== 'undefined') {
      this.#resizeObs = new ResizeObserver(() => this.#layout());
      this.#resizeObs.observe(this.#wrap.value);
    }
  }

  updated(changed) {
    const geom = changed.has('tileW') || changed.has('tileH') || changed.has('tile');
    // Canvas backing stores + the ImageData that shares `#work` are paired: they
    // are reconstructed together, imperatively, never bound in the template (a
    // template-bound width/height would clear the backing store mid-diff).
    if (geom) this.#applyGeometry();
    else if (changed.has('mirrorBehind')) this.#paintMirror();
    if (!geom && changed.has('guides')) this.#drawGuidesLayer();

    // The cursor overlay is canvas-drawn, so the state the template can't express
    // has to be re-stroked here.
    if (
      changed.has('tool') ||
      changed.has('erase') ||
      changed.has('pencilSize') ||
      changed.has('cornerRadius') ||
      changed.has('ink') // the pencil's filled preview is tinted by the ink
    ) {
      this.#redrawCursorLayer();
    }

    // One-shot dev hooks fire on the first update WITH REAL GEOMETRY — the
    // element can mount before the first sheet arrives (tileW 0), and the
    // hooks must not be consumed against an empty canvas.
    if (!this.#drawHooksDone && this.tileW > 0 && this.tileH > 0) {
      this.#drawHooksDone = true;
      this.#applyDrawHooks();
    }
  }

  // --- working buffer + canvas geometry --------------------------------------
  // Working copy of the tile's pixels — starts from the face's own art, or empty
  // for a face with none. A mirror-derived face opens EMPTY (the faded onion-skin
  // behind the canvas is the reference); it becomes real art only once the user
  // actually changes a pixel (tracked by `#dirty`).
  #resetWorking() {
    const w = this.tileW;
    const h = this.tileH;
    this.#work = new Uint8ClampedArray(Math.max(0, w * h * 4));
    if (this.tile?.data) this.#work.set(this.tile.data.subarray(0, this.#work.length));
    this.#workingTile = { width: w, height: h, data: this.#work };
    this.#imgData = w > 0 && h > 0 ? new ImageData(this.#work, w, h) : null;
    this.#dirty = false;
    // Nothing in flight can belong to the buffer we just replaced.
    this.#drawing = false;
    this.#prev = null;
    this.#forceErase = false;
    this.#hoverTexel = null;
    this.#rectDragging = false;
    this.#rectStart = null;
    this.#rectEnd = null;
    this.#rectPointer = null;
    this.#shiftLock = false;
    this.#laidOut = false; // force #layout() to re-fit for the new tile size
  }

  // Size the native-resolution layers to the tile, restore the onion-skin the
  // resize cleared, repaint the pixels and re-fit the stack.
  #applyGeometry() {
    const bg = this.#bg.value;
    const canvas = this.#canvas.value;
    if (!bg || !canvas) return;
    bg.width = this.tileW;
    bg.height = this.tileH;
    canvas.width = this.tileW;
    canvas.height = this.tileH;
    this.#paintMirror();
    this.#repaint();
    this.#layout();
  }

  // The faded opposite-face onion-skin, drawn into the (native-res) background
  // layer under the transparent pixel canvas.
  #paintMirror() {
    const bg = this.#bg.value;
    if (!bg) return;
    const g = bg.getContext('2d');
    g.clearRect(0, 0, bg.width, bg.height);
    const m = this.mirrorBehind;
    if (!m) return;
    const tmp = document.createElement('canvas');
    tmp.width = this.tileW;
    tmp.height = this.tileH;
    tmp
      .getContext('2d')
      .putImageData(
        new ImageData(new Uint8ClampedArray(m.data), this.tileW, this.tileH),
        0,
        0
      );
    g.imageSmoothingEnabled = false;
    g.globalAlpha = MIRROR_ALPHA; // putImageData ignores alpha; drawImage honors it
    g.drawImage(tmp, 0, 0);
    g.globalAlpha = 1;
  }

  #repaint() {
    if (this.#ctx && this.#imgData) this.#ctx.putImageData(this.#imgData, 0, 0);
  }

  // Fit the largest integer-scaled tile rect inside the canvas container's content
  // box, size every layer to it, and redraw the screen-res overlays. The container's
  // height is CSS-driven (it fills the flex draw box), so this only MEASURES it — it
  // never sets a height. Idempotent: a re-run at the same scale early-returns.
  #layout() {
    const wrap = this.#wrap.value;
    const stack = this.#stack.value;
    if (!wrap || !stack || !this.tileW || !this.tileH) return;
    // Measure both axes from the client box (border-excluded), subtracting padding so
    // the 1px border isn't double-counted: an over-measure could round the integer
    // scale one step too big and the stack would clip under overflow:hidden.
    const cs = getComputedStyle(wrap);
    const availW = Math.max(
      1,
      wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    );
    const availH = Math.max(
      1,
      wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
    );
    const s = Math.max(
      1,
      Math.floor(Math.min(availW / this.tileW, availH / this.tileH)) || 1
    );
    if (this.#laidOut && s === this.#scale) return; // scale unchanged → layers correct
    this.#laidOut = true;
    this.#scale = s;
    this.#cssW = this.tileW * s;
    this.#cssH = this.tileH * s;
    stack.style.width = `${this.#cssW}px`;
    stack.style.height = `${this.#cssH}px`;
    this.#overlay.value.width = this.#cssW; // screen-res backing: 1px hairlines stay crisp
    this.#overlay.value.height = this.#cssH;
    this.#cursor.value.width = this.#cssW;
    this.#cursor.value.height = this.#cssH;
    this.#drawGuidesLayer();
    this.#redrawCursorLayer(); // re-stroke the footprint / rect preview at the new scale
  }

  #drawGuidesLayer() {
    if (!this.#overlayCtx) return;
    drawGuides(this.#overlayCtx, this.guides, this.#scale, this.#cssW, this.#cssH);
  }

  // --- one-shot dev hooks (canvas halves; the state halves are boot actions) --
  #applyDrawHooks() {
    const clampX = (v) => Math.max(0, Math.min(this.tileW - 1, v | 0));
    const clampY = (v) => Math.max(0, Math.min(this.tileH - 1, v | 0));
    if (this.previewCursor) {
      // No pointer to hover in a headless shot — stamp the footprint at the center.
      this.#drawCursor({ px: this.tileW >> 1, py: this.tileH >> 1 });
    }
    if (this.previewRect) {
      this.#rectStart = {
        px: clampX(this.previewRect.x0),
        py: clampY(this.previewRect.y0),
      };
      this.#rectEnd = {
        px: clampX(this.previewRect.x1),
        py: clampY(this.previewRect.y1),
      };
      this.#shiftLock = !!this.previewRect.square; // ?rect=...,sq demos the Shift lock
      this.#rectDragging = true;
      this.#drawRectPreview();
    }
    if (this.fillOnMount) {
      this.#applyLocalFill(
        { px: clampX(this.fillOnMount.x), py: clampY(this.fillOnMount.y) },
        false
      );
    }
  }

  // --- template --------------------------------------------------------------
  // The CONTAINER (.editor-canvas-wrap) fills the draw box below the options bar
  // (CSS flex:1) — its height comes from the flex layout, not JS — so nothing
  // shifts when the tile size (and thus the drawn canvas) changes. Inside it, a
  // .editor-canvas-stack holds four aligned layers, centered and scaled by #layout()
  // to the largest integer texel size that fits. Only the pixel canvas takes
  // pointer events. The pixel + bg canvases keep a native tileW×tileH backing store
  // (CSS upscales them crisp); the overlay + cursor are SCREEN-res (backing tracks the
  // on-screen px) so their 1px lines stay crisp. Backing stores are set in
  // #applyGeometry()/#layout(), never bound here.
  render() {
    return html`
      <div class="editor-canvas-wrap" ${ref(this.#wrap)}>
        <div class="editor-canvas-stack" ${ref(this.#stack)}>
          <canvas class="editor-canvas-bg" ${ref(this.#bg)}></canvas>
          <canvas
            class="editor-canvas"
            ${ref(this.#canvas)}
            @pointerdown=${this.#onPointerDown}
            @pointermove=${this.#onPointerMove}
            @pointerup=${this.#onPointerUp}
            @pointercancel=${this.#onPointerCancel}
            @pointerleave=${this.#onPointerLeave}
            @contextmenu=${this.#onContextMenu}
          ></canvas>
          <canvas class="editor-canvas-overlay" ${ref(this.#overlay)}></canvas>
          <canvas class="editor-canvas-cursor" ${ref(this.#cursor)}></canvas>
        </div>
      </div>
    `;
  }

  // --- events -----------------------------------------------------------------
  #emit(type, detail) {
    // Dispatched on the HOST (which lives in the container's tree), so no
    // `composed` is needed for the container to hear it.
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  }

  #notifyLive() {
    this.#emit('sm-live', { tile: this.#workingTile, dirty: this.#dirty });
  }

  // --- gesture-scoped keyboard -------------------------------------------------
  // Esc aborts an in-flight rect drag (nothing committed); Shift held mid-drag
  // locks the box to a square; B/R/G/I mid-drag abandon the box (shortcuts.js
  // does the actual tool switch — abandoning is this canvas's business, so the
  // two compose without ordering coupling). Everything here is a no-op unless a
  // gesture is actually in flight.
  #onKeyDown = (e) => {
    if (!this.#rectDragging) return;
    if (e.key === 'Escape') {
      this.#cancelRect(); // discard the box mid-drag — no pixels written
      e.preventDefault();
      return;
    }
    // Shift held mid-drag locks the box to a square, even with the pointer still —
    // re-derive the preview from the raw corner (keydown repeats, so guard churn).
    if (e.key === 'Shift' && !this.#shiftLock) {
      this.#shiftLock = true;
      this.#drawRectPreview();
      return;
    }
    // Same guards as shortcuts.js so a letter typed into a (shadow-hosted) text
    // field can never abandon the drag when the tool switch it mirrors is
    // suppressed too.
    const target = e.composedPath ? e.composedPath()[0] : e.target;
    const tag = target && /** @type {Element} */ (target).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    // Switching tools mid rect-drag abandons the box (nothing committed) — same as
    // ESC, so B/R/G/I can't leave a half-dragged rect wired to the old pointer.
    if (k === 'b' || k === 'r' || k === 'g' || k === 'i') this.#cancelRect();
  };

  // Releasing Shift mid-drag drops the square-lock and re-derives the free box.
  #onKeyUp = (e) => {
    if (e.key === 'Shift' && this.#rectDragging && this.#shiftLock) {
      this.#shiftLock = false;
      this.#drawRectPreview();
    }
  };

  // --- texel math -------------------------------------------------------------
  #toTexel(e) {
    const rect = this.#canvas.value.getBoundingClientRect();
    const px = Math.floor(((e.clientX - rect.left) / rect.width) * this.tileW);
    const py = Math.floor(((e.clientY - rect.top) / rect.height) * this.tileH);
    if (px < 0 || py < 0 || px >= this.tileW || py >= this.tileH) return null;
    return { px, py };
  }

  // Like #toTexel but clamps to the tile instead of rejecting out-of-bounds, so a
  // rect drag that runs past the canvas edge (with the pointer captured) extends to
  // the edge rather than freezing.
  #toTexelClamped(e) {
    const rect = this.#canvas.value.getBoundingClientRect();
    const px = Math.floor(((e.clientX - rect.left) / rect.width) * this.tileW);
    const py = Math.floor(((e.clientY - rect.top) / rect.height) * this.tileH);
    return {
      px: Math.max(0, Math.min(this.tileW - 1, px)),
      py: Math.max(0, Math.min(this.tileH - 1, py)),
    };
  }

  // --- painting ---------------------------------------------------------------
  // The RGBA a write lays down right now: the active ink, or the hard-pixel
  // erase under a right-click / the transparent ink (lib/brush.js primitives).
  #writeColor() {
    const paint = !this.#forceErase && !this.erase;
    return paint
      ? { r: this.ink.r, g: this.ink.g, b: this.ink.b, a: 255 }
      : { r: 0, g: 0, b: 0, a: 0 };
  }

  // Continuous stroke: Bresenham from the previous texel (or a single stamp), so
  // a fast drag lays down a solid run rather than dotted samples.
  #stroke(px, py) {
    const color = this.#writeColor();
    const from = this.#prev || { px, py };
    const changed = strokeLine(
      this.#work,
      this.tileW,
      this.tileH,
      from.px,
      from.py,
      px,
      py,
      this.pencilSize,
      color
    );
    this.#prev = { px, py };
    if (changed) this.#commitPixels();
  }

  #commitPixels() {
    this.#dirty = true;
    this.#repaint();
    this.#notifyLive();
  }

  // --- overlays ---------------------------------------------------------------
  // The screen-space view the overlay painters (draw-overlays.js) draw in.
  get #overlayView() {
    return {
      tileW: this.tileW,
      tileH: this.tileH,
      scale: this.#scale,
      cssW: this.#cssW,
      cssH: this.#cssH,
    };
  }

  // The hover preview on the topmost overlay, under the cursor: the pencil fills
  // the exact texels a stamp would paint with the active ink (WYSIWYG — the OS
  // crosshair marks the position); the eyedropper outlines a single cell (its
  // sample target). Cleared with t == null when the pointer leaves the canvas.
  // Only these two have a hover preview — the rect tool relies on the OS
  // crosshair when idle and its own drag preview when dragging — so for any
  // other tool this just clears the overlay.
  #drawCursor(t) {
    this.#hoverTexel = t;
    const g = this.#cursorCtx;
    if (!g) return;
    if (this.tool === 'eyedropper') {
      drawCursorOutline(g, this.#overlayView, t, 1, false);
      return;
    }
    drawPencilPreview(
      g,
      this.#overlayView,
      this.tool === 'pencil' ? t : null,
      this.pencilSize,
      this.ink,
      this.erase
    );
  }

  // The moving corner after any Shift square-lock (raw corner when unlocked).
  #effectiveEnd() {
    if (this.#shiftLock && this.#rectStart && this.#rectEnd) {
      return squareEnd(this.#rectStart, this.#rectEnd);
    }
    return this.#rectEnd;
  }

  // The current rect bounds (anchor + effective end normalized to top-left →
  // bottom-right), or null when not dragging. Preview + commit both read this, so
  // the Shift square-lock applies identically to what you see and what you paint.
  #rectBounds() {
    const end = this.#effectiveEnd();
    if (!this.#rectStart || !end) return null;
    return {
      x0: Math.min(this.#rectStart.px, end.px),
      y0: Math.min(this.#rectStart.py, end.py),
      x1: Math.max(this.#rectStart.px, end.px),
      y1: Math.max(this.#rectStart.py, end.py),
    };
  }

  // Live preview of the rect on the cursor overlay: the exact filled texels,
  // tinted by the active ink (red while erasing), under a haloed hairline of the
  // drag bounding box so the extent reads on any art even before the fill is
  // obvious. Nothing is written to `#work` until #commitRect() on pointer-up.
  #drawRectPreview() {
    const g = this.#cursorCtx;
    if (!g) return;
    drawRectPreview(
      g,
      this.#overlayView,
      this.#rectBounds(),
      this.cornerRadius,
      this.ink,
      this.#forceErase || this.erase
    );
  }

  // Rasterize the finished rect into `#work` (same roundedRectRows the preview used,
  // so what you saw is what you get), then repaint + notify if anything changed.
  #commitRect() {
    const b = this.#rectBounds();
    if (!b) return;
    const color = this.#writeColor();
    let changed = false;
    roundedRectRows(b.x0, b.y0, b.x1, b.y1, this.cornerRadius, (y, xl, xr) => {
      for (let x = xl; x <= xr; x++) {
        if (writeTexel(this.#work, this.tileW, x, y, color)) changed = true;
      }
    });
    if (changed) this.#commitPixels();
  }

  // Abort an in-flight rect drag: drop the state, clear the preview, release the
  // captured pointer. Nothing is written to `#work` — ESC / pointercancel land here.
  #cancelRect() {
    if (!this.#rectDragging) return;
    this.#rectDragging = false;
    this.#rectStart = null;
    this.#rectEnd = null;
    this.#forceErase = false;
    this.#shiftLock = false;
    this.#cursorCtx?.clearRect(0, 0, this.#cssW, this.#cssH);
    if (this.#rectPointer != null) {
      this.#canvas.value?.releasePointerCapture?.(this.#rectPointer);
      this.#rectPointer = null;
    }
  }

  // Redraw the top (cursor) overlay for the current state: the rect drag preview
  // while dragging, else the pencil hover footprint (a no-op clear for the idle
  // rect tool). Used by #layout() and by updated() so a re-fit or a tool/ink change
  // repaints the right thing.
  #redrawCursorLayer() {
    if (this.#rectDragging) this.#drawRectPreview();
    else this.#drawCursor(this.#hoverTexel);
  }

  // --- sampling + fill ---------------------------------------------------------
  // An eyedrop: report what was hit — a painted texel's color, or empty space
  // (the transparent "clear color"). The container turns these into session
  // picks; the resulting prop changes redraw the hover footprint via updated().
  #sampleAt(px, py) {
    const work = this.#work;
    const i = (py * this.tileW + px) * 4;
    if (work[i + 3] === 0) {
      this.#emit('sm-pick-transparent');
    } else {
      this.#emit('sm-pick-color', {
        rgb: { r: work[i], g: work[i + 1], b: work[i + 2] },
      });
    }
  }

  // The ink a fill lays down: the active color, or transparent when erasing (a
  // right-click, or the eraser ink) — mirrors the pencil / rect erase rule.
  #fillInk(rightClick) {
    return rightClick || this.erase
      ? { transparent: true }
      : { r: this.ink.r, g: this.ink.g, b: this.ink.b };
  }

  // Apply a fill to THIS tile's working buffer: a contiguous flood from (t), or —
  // with "replace" on — a whole-tile recolor of every texel matching the clicked
  // color. Repaints + notifies like any stroke if anything changed. This is the
  // whole op for the single-tile modes; the all-tiles mode delegates instead (below).
  #applyLocalFill(t, rightClick) {
    const fill = this.#fillInk(rightClick);
    const i0 = (t.py * this.tileW + t.px) * 4;
    const changed = this.fillReplace
      ? replaceColor(this.#work, keyAt(this.#work, i0), fill)
      : floodFill(this.#work, this.tileW, this.tileH, t.px, t.py, fill);
    if (changed) this.#commitPixels();
  }

  // Route a fill click. "replace" + "all tiles" hands the whole op to the caller
  // (it recolors the clicked color across every tile and re-points this editor);
  // the target color is read from the clicked texel here so the caller doesn't have
  // to. Every other mode fills this tile in place.
  #doFill(t, rightClick) {
    if (this.fillReplace && this.fillAllTiles) {
      const target = keyAt(this.#work, (t.py * this.tileW + t.px) * 4);
      this.#emit('sm-replace-all-tiles', { target, fill: this.#fillInk(rightClick) });
      return;
    }
    this.#applyLocalFill(t, rightClick);
  }

  // --- pointer ----------------------------------------------------------------
  #onPointerDown = (e) => {
    const t = this.#toTexel(e);
    if (!t) return;
    e.preventDefault();
    this.#drawCursor(t);
    // The eyedropper tool samples on any click and never writes a pixel (its
    // sticky modality: it stays selected after the sample). Alt-hold is the
    // momentary version — sample without leaving the current tool — where a
    // right-click still erases even with Alt down.
    if (this.tool === 'eyedropper' || (e.button !== 2 && e.altKey)) {
      this.#sampleAt(t.px, t.py);
      return;
    }
    if (this.tool === 'fill') {
      this.#doFill(t, e.button === 2); // single click — no drag, no pointer capture
      return;
    }
    if (this.tool === 'rect') {
      // A real drag owns exactly one pointer; a second concurrent pointer (a stray
      // finger on a touch screen) must not hijack it. The ?rect dev-hook leaves a
      // phantom drag with no owner (#rectPointer null), which a real down may take over.
      if (this.#rectDragging && this.#rectPointer != null) return;
      this.#forceErase = e.button === 2;
      this.#shiftLock = e.shiftKey; // Shift held at press → start square-locked
      this.#rectDragging = true;
      this.#rectStart = t;
      this.#rectEnd = t;
      this.#rectPointer = e.pointerId;
      this.#canvas.value.setPointerCapture?.(e.pointerId);
      this.#drawRectPreview();
      return;
    }
    this.#forceErase = e.button === 2;
    this.#drawing = true;
    this.#prev = null;
    this.#canvas.value.setPointerCapture?.(e.pointerId);
    this.#stroke(t.px, t.py);
  };

  #onPointerMove = (e) => {
    if (this.#rectDragging) {
      // Only the drag-owning pointer rubber-bands the box; a non-owner move (or a
      // bare hover over the ownerless dev-hook phantom) leaves the preview pinned.
      if (e.pointerId !== this.#rectPointer) return;
      this.#shiftLock = e.shiftKey; // track Shift held during the drag
      this.#rectEnd = this.#toTexelClamped(e); // clamp so a past-the-edge drag pins
      this.#drawRectPreview();
      return;
    }
    const t = this.#toTexel(e);
    this.#drawCursor(t); // keep the footprint preview under the cursor (hover + drag)
    if (!this.#drawing || !t) return;
    this.#stroke(t.px, t.py);
  };

  #onPointerUp = (e) => {
    if (this.#rectDragging) {
      if (e.pointerId !== this.#rectPointer) return; // ignore a stray second pointer
      this.#rectEnd = this.#toTexelClamped(e);
      this.#commitRect();
      this.#rectDragging = false;
      this.#rectStart = null;
      this.#rectEnd = null;
      this.#forceErase = false;
      this.#shiftLock = false;
      this.#canvas.value.releasePointerCapture?.(this.#rectPointer); // the owner
      this.#rectPointer = null;
      this.#cursorCtx.clearRect(0, 0, this.#cssW, this.#cssH); // commit is on `#work`
      return;
    }
    this.#drawing = false;
    this.#prev = null;
    this.#forceErase = false;
    this.#canvas.value.releasePointerCapture?.(e.pointerId);
  };

  // pointercancel (gesture interrupted) discards an in-flight rect rather than
  // committing a box the user didn't finish; a pencil stroke is already committed.
  #onPointerCancel = (e) => {
    if (this.#rectDragging) {
      if (e.pointerId !== this.#rectPointer) return; // a non-owner can't abort the drag
      this.#cancelRect();
      return;
    }
    this.#drawing = false;
    this.#prev = null;
    this.#forceErase = false;
    this.#canvas.value.releasePointerCapture?.(e.pointerId);
  };

  // Clear the pencil hover footprint when the pointer leaves — but not mid rect
  // drag (capture keeps the events coming; the preview must survive an edge cross).
  #onPointerLeave = () => {
    if (!this.#rectDragging) this.#drawCursor(null);
  };

  #onContextMenu = (e) => e.preventDefault(); // right-click = erase
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-draw-canvas'))
  customElements.define('sm-draw-canvas', SmDrawCanvas);
