// <sm-draw-canvas>: the Sprite Editor's pixel canvas. It holds the working
// buffer, runs the tool gestures (select, pencil, eraser, rect, fill,
// eyedropper), fits the canvas to whole system px and handles the gesture and
// selection keys (Esc, Shift, Delete, Backspace and the tool letters).
//
// - The stack: the edge-hint frame (lib/edges.js) behind four canvases: the
//   underlay (the other layers and the mirrored opposite face), the pixel
//   canvas, the cursor overlay and the selection's ants. The frame's band takes
//   pointer input for sampling alone: a press there picks a strip texel's color
//   and nothing draws.
// - Selection: drag a marquee, then drag inside it to move the pixels. The first
//   move lifts the texels into #selFloat and clears them in a copy of the buffer
//   (#selBase). Each offset composites base and float into #work in place.
//   Transparent float texels show the base. A buffer reset drops the selection.
//   The Edit menu calls copySelection, pasteFloat (a float already lifted, over
//   a base with no hole) and selectAll, and the options strip calls
//   flipSelection.
// - State: everything the pointer paths touch is a private field, so a drag
//   never schedules a render. Canvas backing stores are sized in JS. A
//   template-bound width would clear them.
// - The working buffer resets when `tile`, tileW or tileH changes. `tile`
//   compares by identity: pass the same reference only when the art is
//   unchanged. A `tool` change cancels any gesture in flight.
// - `option` (Option held) changes only the hover preview, to the
//   eyedropper's, outside a drag (#sampling). A press reads its own altKey.
//
// Events (all bubble):
//   sm-live               { tile, dirty }    each pixel change. tile is the
//                                            working buffer, by reference.
//   sm-commit             { before, after }  one gesture's snapshot copies
//   sm-selection          { bounds | null }  the selection outline, on change
//   sm-rect-drag          { bounds | null }  the rect drag's box, on change
//   sm-pick-color         { rgb }            an eyedrop on a painted texel, in
//                                            the art or the edge-hint band
//   sm-pick-transparent                      an eyedrop on empty space
//   sm-replace-all-tiles  { target, fill }   a non-contiguous fill on all faces
//   sm-gesture            { active }         a drag started or ended

import { css, LitElement, html } from 'lit';
import { createRef, ref } from 'lit/directives/ref.js';
// Importing the kit also registers the vf-* elements the template uses.
import { effectiveScale, onScaleChange, prefersReducedMotion } from 'vintage-frames';
import { writeTexel, stampBrush, strokeLine } from '../lib/brush.js';
import { roundedRectRows, squareEnd } from '../lib/rect.js';
import { keyAt, floodFill, replaceColor } from '../lib/fill.js';
import {
  liftRect,
  clearRect,
  flipRect,
  compositeFloat,
  normalizeBounds,
  boundsContain,
  translateBounds,
  constrainAxis,
} from '../lib/select.js';
import { ANTS_PERIOD } from '../lib/ants.js';
import { EDGE_HINT } from '../lib/edges.js';
import { ONION_ALPHA } from '../lib/layers.js';
import { springTool } from '../lib/tools.js';
import {
  drawPencilPreview,
  drawFootprintAnts,
  drawRectPreview,
  drawMarchingAnts,
} from './draw-overlays.js';
import { baseStyles } from './base-styles.js';

// Marching ants tick: one system px of dash travel per tick.
const ANTS_MS = 100;

// Selection drag threshold in CSS px. A press that stays within it and on its
// anchor texel is a click, not a marquee.
const SELECT_SLOP = 3;

// The bare-letter tool shortcuts (shortcuts.js). Any of them cancels a drag.
const TOOL_KEYS = new Set(['s', 'b', 'r', 'g', 'e', 'i']);

// The stack's kit pattern, the 12% dither that shows through transparent texels.
// A vf-container with no pattern paints the desktop's pattern instead.
const PAPER = 'gray-12';

export class SmDrawCanvas extends LitElement {
  static styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
      /* The well fills the draw box. It is the measuring box and the
       positioning anchor for the placed containers. #layout() sets their
       boxes in whole system px. */
      .editor-canvas-wrap {
        flex: 1 1 auto;
        min-height: 0; /* lets the well shrink so #layout() can re-fit */
        position: relative;
        padding: calc(var(--vf-scale, 1) * 12px);
        overflow: hidden; /* clips a minimum-scale canvas larger than the well */
      }
      /* The edge-hint frame, one texel larger than the art on every side,
       sits behind the stack. */
      .editor-canvas-hints {
        z-index: 0;
      }
      .editor-canvas-stack {
        z-index: 1;
      }
      /* Native-res strips, one texel per image px, upscaled crisp. */
      .editor-canvas-hint {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
        pointer-events: none;
      }
      /* The band's hover ants, over the strips, at system-px res. */
      .editor-canvas-band {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
      }
      /* The four layers fill the stack. The pixel canvas is native tile res.
       The others are system-px res. */
      .editor-canvas-stack > canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
      }
      /* The cursor reads --vf-cursor first. The kit's cursor: none rule can't
       pierce the shadow root, so a bare crosshair would show beside the kit's
       page-drawn cursor. The crosshair is the fallback before applyCursor runs. */
      .editor-canvas {
        z-index: 1;
        cursor: var(--vf-cursor, crosshair);
        touch-action: none;
      }
      /* The underlay, under the pixel canvas. Its fade is drawn at
       ONION_ALPHA (#paintBg), not with CSS opacity. */
      .editor-canvas-bg {
        z-index: 0;
        pointer-events: none;
      }
      /* The cursor preview, above the pixel canvas. */
      .editor-canvas-cursor {
        z-index: 2;
        pointer-events: none;
      }
      /* The selection's ants, topmost. They have their own layer because the
       cursor layer is cleared on every pointer move. */
      .editor-canvas-select {
        z-index: 3;
        pointer-events: none;
      }
    `,
  ];

  static properties = {
    tile: { attribute: false },
    tileW: { type: Number },
    tileH: { type: Number },
    /** The underlay tile, drawn faded behind the art, or null. */
    onionBehind: { attribute: false },
    /** The edge-hint frame around the tile (lib/edges.js edgeHintFrame). */
    edgeHints: { attribute: false },
    tool: {},
    /** Option (Alt) is held. The tool is unchanged. */
    option: { type: Boolean },
    ink: { attribute: false },
    pencilSize: { type: Number },
    /** 'circle' | 'square' (lib/brush.js PENCIL_SHAPES). */
    pencilShape: {},
    eraserSize: { type: Number },
    /** 'circle' | 'square'. */
    eraserShape: {},
    cornerRadius: { type: Number },
    fillContiguous: { type: Boolean },
    fillAllFaces: { type: Boolean },
    /** Whether this is the active document window. Only the active window's
     *  Esc drops its selection. */
    active: { type: Boolean },
  };

  constructor() {
    super();
    this.tile = null;
    this.tileW = 0;
    this.tileH = 0;
    this.onionBehind = null;
    this.edgeHints = null;
    this.tool = 'pencil';
    this.option = false;
    this.ink = null;
    this.pencilSize = 1;
    this.pencilShape = 'circle';
    this.eraserSize = 1;
    this.eraserShape = 'circle';
    this.cornerRadius = 0;
    this.fillContiguous = true;
    this.fillAllFaces = false;
    this.active = false;
  }

  // Pixel buffer and stroke state
  #work = null; // Uint8ClampedArray of the working tile, shared with #imgData
  #workingTile = null; // { width, height, data:#work } sent with sm-live
  #imgData = null; // ImageData view over #work
  #dirty = false; // a pixel changed since the last reset

  #drawing = false; // a pencil stroke is in progress
  #prev = null; // last painted texel this stroke, for line interpolation
  #forceErase = false; // right-button erase
  #gestureNotified = false; // last state sent with sm-gesture
  // Undo capture: the bytes at gesture start and whether a pixel changed.
  #gestureBefore = null;
  #gestureChanged = false;
  #hoverTexel = null; // last hovered texel, for the hover preview
  #bandTexel = null; // last hovered edge-hint pick {px,py,rgb}, in frame texels
  // Rect drag
  #rectDragging = false;
  #rectStart = null; // anchor corner texel {px,py}
  #rectEnd = null; // moving corner texel {px,py}, before the square lock
  #rectPointer = null; // captured pointerId
  #shiftLock = false; // Shift square lock
  #rectNotified = null; // last box sent with sm-rect-drag

  // Selection. #sel is the marquee in tile texels, inclusive, at the lift
  // origin. The current rectangle is #sel shifted by #selOffset (#selRect). A
  // paste's lift origin is where it was pasted, which may be off the tile.
  // #startMove lifts only when there is no float, so a paste is never lifted
  // again.
  #sel = null; // {x0,y0,x1,y1} | null
  #selFloat = null; // {width,height,data,opaque}, lifted on the first move
  #selBase = null; // #work with the marquee cleared, fixed for the selection's life
  #selOffset = { dx: 0, dy: 0 }; // the float's offset from #sel
  #selDrag = null; // null | 'marquee' | 'move'
  #selAnchor = null; // marquee: the anchor texel. move: the grab texel.
  #selPress = null; // marquee: the press's client point, for SELECT_SLOP
  #selMoved = false; // marquee: past the slop or off the anchor texel
  #selOffsetAtGrab = null; // move: #selOffset at the press, restored on cancel
  #selLast = null; // move: the last pointer texel
  #selPointer = null; // captured pointerId
  #selShift = false; // move: Shift axis lock
  #selNotified = null; // last outline sent with sm-selection
  // One ticker for the selection's ants and the cursor layer's ants.
  #antsPhase = 0;
  #antsTimer = null;

  // Geometry from #layout(), in system px: #texelSys is the texel size,
  // #sysW/#sysH the canvas box and overlay backing size, #fitScale the CSS px
  // per system px at the fit.
  #texelSys = 1;
  #sysW = 0;
  #sysH = 0;
  #fitScale = 1;
  #fitPad = 0; // the edge-hint band the fit reserved, in texels per side
  #laidOut = false;
  #resizeObs = null;
  #offScale = null; // onScaleChange unsubscribe

  /** @type {import('lit/directives/ref.js').Ref<HTMLElement>} */
  #wrap = createRef();
  /** @type {import('lit/directives/ref.js').Ref<import('vintage-frames').VfContainer>} */
  #stack = createRef();
  /** @type {import('lit/directives/ref.js').Ref<import('vintage-frames').VfContainer>} */
  #hints = createRef();
  /** @type {import('lit/directives/ref.js').Ref<HTMLCanvasElement>} */
  #hintCanvas = createRef();
  /** @type {import('lit/directives/ref.js').Ref<HTMLCanvasElement>} */
  #bandCanvas = createRef();
  /** @type {import('lit/directives/ref.js').Ref<HTMLCanvasElement>} */
  #bg = createRef();
  /** @type {import('lit/directives/ref.js').Ref<HTMLCanvasElement>} */
  #canvas = createRef();
  /** @type {import('lit/directives/ref.js').Ref<HTMLCanvasElement>} */
  #cursor = createRef();
  /** @type {import('lit/directives/ref.js').Ref<HTMLCanvasElement>} */
  #antsLayer = createRef();
  #ctx = null;
  #cursorCtx = null;
  #antsCtx = null;
  #bandCtx = null;

  // Lifecycle
  connectedCallback() {
    super.connectedCallback();
    // Gesture keys listen on the document so they work wherever focus is.
    // Tool shortcuts live in shortcuts.js.
    document.addEventListener('keydown', this.#onKeyDown);
    document.addEventListener('keyup', this.#onKeyUp);
    // Raising a window disconnects and reconnects this element, so restart what
    // disconnectedCallback stopped. On the first connect there is no wrap yet,
    // and firstUpdated sets up the observer.
    this.#syncAnts();
    this.#observeResize();
    // Re-fit when --vf-scale changes. The kit updates --vf-scale before these
    // callbacks run.
    this.#offScale = onScaleChange(() => this.#layout());
    this.#notifyGesture();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.#onKeyDown);
    document.removeEventListener('keyup', this.#onKeyUp);
    this.#resizeObs?.disconnect();
    this.#resizeObs = null;
    this.#offScale?.();
    this.#offScale = null;
    this.#stopAnts();
    // A removed window never releases its drag. A reconnect reports it again.
    if (this.#gestureNotified) {
      this.#gestureNotified = false;
      this.#emit('sm-gesture', { active: false });
    }
  }

  willUpdate(changed) {
    if (changed.has('tileW') || changed.has('tileH') || changed.has('tile')) {
      this.#resetWorking();
    } else if (changed.has('tool')) {
      // A tool change discards a rect drag and ends a pencil stroke, which still
      // commits. It drops the selection unless the new tool is the selection
      // tool: a paste or Select All installs its selection before the canvas
      // sees the tool.
      if (this.tool !== 'select') this.#dropSelection();
      this.#cancelRect();
      this.#endGesture();
      this.#drawing = false;
      this.#prev = null;
      this.#forceErase = false;
    }
    this.#notifyGesture();
  }

  firstUpdated() {
    this.#ctx = this.#canvas.value.getContext('2d');
    this.#cursorCtx = this.#cursor.value.getContext('2d');
    this.#antsCtx = this.#antsLayer.value.getContext('2d');
    this.#bandCtx = this.#bandCanvas.value.getContext('2d');
    this.#observeResize();
  }

  // Re-fit when the well resizes. #layout() never sizes the well, so this
  // can't loop.
  #observeResize() {
    if (typeof ResizeObserver === 'undefined' || !this.#wrap.value) return;
    this.#resizeObs = new ResizeObserver(() => this.#layout());
    this.#resizeObs.observe(this.#wrap.value);
  }

  updated(changed) {
    const geom = changed.has('tileW') || changed.has('tileH') || changed.has('tile');
    // Paint the edge hints before the fit: #layout() reserves the band only
    // when there is one.
    if (changed.has('edgeHints')) this.#paintHints();
    if (geom) this.#applyGeometry();
    else if (changed.has('onionBehind')) this.#paintBg();
    else if (changed.has('edgeHints')) this.#layout(); // the band appeared or went away

    if (
      changed.has('tool') ||
      changed.has('option') ||
      changed.has('pencilSize') ||
      changed.has('pencilShape') ||
      changed.has('eraserSize') ||
      changed.has('eraserShape') ||
      changed.has('cornerRadius') ||
      changed.has('ink') // the previews paint in the ink
    ) {
      this.#redrawCursorLayer();
    }
  }

  // Working buffer and canvas geometry
  // Reset the working copy from the tile's art, or empty when it has none. A
  // mirror-derived face opens empty, with the underlay behind it.
  #resetWorking() {
    const w = this.tileW;
    const h = this.tileH;
    this.#work = new Uint8ClampedArray(Math.max(0, w * h * 4));
    if (this.tile?.data) this.#work.set(this.tile.data.subarray(0, this.#work.length));
    this.#workingTile = { width: w, height: h, data: this.#work };
    this.#imgData = w > 0 && h > 0 ? new ImageData(this.#work, w, h) : null;
    this.#dirty = false;
    // Clear gesture state from the old buffer.
    this.#gestureBefore = null;
    this.#gestureChanged = false;
    this.#drawing = false;
    this.#prev = null;
    this.#forceErase = false;
    this.#hoverTexel = null;
    this.#bandTexel = null;
    this.#rectDragging = false;
    this.#rectStart = null;
    this.#rectEnd = null;
    this.#rectPointer = null;
    this.#shiftLock = false;
    this.#notifyRectDrag();
    // The selection goes with the buffer. The ants layer is cleared here for a
    // same-size swap.
    this.#sel = null;
    this.#selFloat = null;
    this.#selBase = null;
    this.#selOffset = { dx: 0, dy: 0 };
    this.#selDrag = null;
    this.#selAnchor = null;
    this.#selPress = null;
    this.#selMoved = false;
    this.#selOffsetAtGrab = null;
    this.#selLast = null;
    this.#selPointer = null;
    this.#selShift = false;
    this.#stopAnts();
    this.#clearAnts();
    this.#setCursorClaim('crosshair');
    this.#notifySelection();
    this.#laidOut = false; // force a full re-fit
  }

  // Size the native-res pixel canvas to the tile, repaint it and re-fit. The
  // re-fit sizes and paints the system-res layers.
  #applyGeometry() {
    const canvas = this.#canvas.value;
    if (!canvas) return;
    canvas.width = this.tileW;
    canvas.height = this.tileH;
    this.#repaint();
    this.#layout();
  }

  // Paint the system-res background: the underlay at ONION_ALPHA, magnified
  // nearest-neighbor, on a transparent ground.
  #paintBg() {
    const bg = this.#bg.value;
    if (!bg || !bg.width || !bg.height) return;
    const g = bg.getContext('2d');
    g.clearRect(0, 0, bg.width, bg.height);
    const m = this.onionBehind;
    if (m) {
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
      g.imageSmoothingEnabled = false; // crisp texels
      g.globalAlpha = ONION_ALPHA; // putImageData ignores alpha; drawImage honors it
      g.drawImage(tmp, 0, 0, this.#sysW, this.#sysH);
      g.globalAlpha = 1;
    }
  }

  // Blit the (tileW + 2) x (tileH + 2) edge-hint frame at native res. CSS
  // upscales it by the same texel size as the art.
  #paintHints() {
    const c = this.#hintCanvas.value;
    if (!c) return;
    const f = this.edgeHints;
    if (!f) {
      c.width = 0;
      c.height = 0;
      return;
    }
    c.width = f.width; // resizing clears the canvas
    c.height = f.height;
    c.getContext('2d').putImageData(new ImageData(f.data, f.width, f.height), 0, 0);
  }

  #repaint() {
    if (this.#ctx && this.#imgData) this.#ctx.putImageData(this.#imgData, 0, 0);
  }

  // Fit the largest whole-system-px texel size in the well, place and size both
  // containers, and resize the system-res layers. Whole system px keep the art
  // on the device-pixel grid. The well is measured, never sized. A re-run at the
  // same texel size, scale and band only re-sets the positions.
  #layout() {
    const wrap = this.#wrap.value;
    const stack = this.#stack.value;
    const hints = this.#hints.value;
    if (!wrap || !stack || !hints || !this.tileW || !this.tileH) return;
    // Measure the client box minus padding. Over-measuring could round the
    // texel size up and clip the canvas.
    const cs = getComputedStyle(wrap);
    const padL = parseFloat(cs.paddingLeft);
    const padT = parseFloat(cs.paddingTop);
    const availW = Math.max(1, wrap.clientWidth - padL - parseFloat(cs.paddingRight));
    const availH = Math.max(1, wrap.clientHeight - padT - parseFloat(cs.paddingBottom));
    // CSS px per system px, inherited from the document window's --vf-scale.
    const scale = effectiveScale(this);
    const availWSys = availW / scale;
    const availHSys = availH / scale;
    // The edge-hint band is measured in texels and reserved before the fit, so
    // the art scales down to make room.
    const pad = this.edgeHints ? EDGE_HINT : 0;
    const fitW = this.tileW + 2 * pad;
    const fitH = this.tileH + 2 * pad;
    const k = Math.max(1, Math.floor(Math.min(availWSys / fitW, availHSys / fitH)) || 1);
    const sysW = this.tileW * k;
    const sysH = this.tileH * k;
    // Center the outer box (art plus band) in whole system px. VfPositioned
    // anchors on the well's padding box, so the padding is part of the offset.
    // An oversized canvas centers at a negative offset and clips. The art sits
    // a whole band in, so the strips share the canvas's texel lattice.
    const outLeft = Math.round(padL / scale + (availWSys - fitW * k) / 2);
    const outTop = Math.round(padT / scale + (availHSys - fitH * k) / 2);
    hints.left = outLeft;
    hints.top = outTop;
    stack.left = outLeft + pad * k;
    stack.top = outTop + pad * k;
    if (
      this.#laidOut &&
      k === this.#texelSys &&
      scale === this.#fitScale &&
      pad === this.#fitPad
    )
      return;
    this.#laidOut = true;
    this.#texelSys = k;
    this.#fitScale = scale;
    this.#fitPad = pad;
    this.#sysW = sysW;
    this.#sysH = sysH;
    stack.width = sysW;
    stack.height = sysH;
    hints.width = fitW * k;
    hints.height = fitH * k;
    // The band's ants layer covers the whole frame, at system-px res.
    this.#bandCanvas.value.width = fitW * k;
    this.#bandCanvas.value.height = fitH * k;
    // System-res backings: hairlines are 1 system px.
    this.#bg.value.width = this.#sysW;
    this.#bg.value.height = this.#sysH;
    this.#cursor.value.width = this.#sysW;
    this.#cursor.value.height = this.#sysH;
    this.#antsLayer.value.width = this.#sysW;
    this.#antsLayer.value.height = this.#sysH;
    // Resizing the backings cleared them.
    this.#paintBg();
    this.#redrawCursorLayer();
    this.#drawAnts();
  }

  // Template
  // The well holds two placed vf-containers: the edge-hint frame and, over it,
  // the canvas stack. Both containers declare a pattern so the desktop's
  // pattern doesn't leak in (see PAPER). Backing stores are set in
  // #applyGeometry() and #layout(), never bound here. Lit sets each static
  // data-vf-cursor once, so the claims set in code (#setCursorClaim for the
  // canvas, #drawBandCursor for the band) persist across renders.
  render() {
    return html`
      <div class="editor-canvas-wrap" ${ref(this.#wrap)}>
        <vf-container
          class="editor-canvas-hints"
          pattern="white"
          data-vf-cursor="arrow"
          ${ref(this.#hints)}
          @pointerdown=${this.#onBandDown}
          @pointermove=${this.#onBandMove}
          @pointerleave=${this.#onBandLeave}
        >
          <canvas class="editor-canvas-hint" ${ref(this.#hintCanvas)}></canvas>
          <canvas class="editor-canvas-band" ${ref(this.#bandCanvas)}></canvas>
        </vf-container>
        <vf-container class="editor-canvas-stack" pattern=${PAPER} ${ref(this.#stack)}>
          <canvas class="editor-canvas-bg" ${ref(this.#bg)}></canvas>
          <canvas
            class="editor-canvas"
            data-vf-cursor="crosshair"
            ${ref(this.#canvas)}
            @pointerdown=${this.#onPointerDown}
            @pointermove=${this.#onPointerMove}
            @pointerup=${this.#onPointerUp}
            @pointercancel=${this.#onPointerCancel}
            @pointerleave=${this.#onPointerLeave}
            @contextmenu=${this.#onContextMenu}
          ></canvas>
          <canvas class="editor-canvas-cursor" ${ref(this.#cursor)}></canvas>
          <canvas class="editor-canvas-select" ${ref(this.#antsLayer)}></canvas>
        </vf-container>
      </div>
    `;
  }

  // Events
  #emit(type, detail) {
    // Dispatched on the host, in the container's tree, so `composed` isn't needed.
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  }

  #notifyLive() {
    this.#emit('sm-live', { tile: this.#workingTile, dirty: this.#dirty });
  }

  // Undo capture
  // A gesture brackets its pixel writes with #beginGesture and #endGesture.
  // #endGesture emits sm-commit with snapshot copies only if a pixel changed.
  #beginGesture() {
    this.#gestureBefore = this.#work ? this.#work.slice() : null;
    this.#gestureChanged = false;
  }

  #endGesture() {
    if (this.#gestureBefore && this.#gestureChanged) {
      const w = this.tileW;
      const h = this.tileH;
      this.#emit('sm-commit', {
        before: { width: w, height: h, data: this.#gestureBefore },
        after: { width: w, height: h, data: this.#work.slice() },
      });
    }
    this.#gestureBefore = null;
    this.#gestureChanged = false;
  }

  // Commit an in-gesture write only if a byte changed since #beginGesture, so a
  // write that changes nothing keeps a derived face derived and the document
  // clean.
  #commitChanged() {
    const before = this.#gestureBefore;
    if (before && this.#work.some((v, i) => v !== before[i])) this.#commitPixels();
  }

  // A drag is in progress: a pencil or eraser stroke, a rect drag or a
  // selection drag.
  get #dragging() {
    return this.#drawing || this.#rectDragging || this.#selDrag != null;
  }

  // Emit sm-gesture when a drag starts or ends. Every handler that can start or
  // end one calls this after it runs.
  #notifyGesture() {
    const active = this.#dragging;
    if (active === this.#gestureNotified) return;
    this.#gestureNotified = active;
    this.#emit('sm-gesture', { active });
  }

  // Gesture keys
  // Checked in order:
  // 1. A selection drag: Esc cancels, Shift toggles the axis lock, a tool
  //    letter cancels.
  // 2. A selection with no drag: Esc drops it, and Delete or Backspace clears
  //    it. The selection can outlive dialogs, menus and window changes, so
  //    both check for the active window, an open dialog and a focused text
  //    field, and a clear also for an open menu. Esc never calls
  //    preventDefault: a prevented Esc suppresses a dialog's cancel event and
  //    keeps an open menu from closing.
  // 3. A rect drag: Esc cancels, Shift square-locks, a tool letter cancels.
  //    shortcuts.js makes the tool switch.
  #onKeyDown = (e) => {
    this.#keyDown(e);
    this.#notifyGesture();
  };

  #keyDown(e) {
    if (this.#selDrag) {
      this.#onSelectionDragKey(e);
      return;
    }
    if (this.tool === 'select' && this.#sel) {
      this.#onSelectionUpKey(e);
      return;
    }
    if (!this.#rectDragging) return;
    if (e.key === 'Escape') {
      this.#cancelRect();
      e.preventDefault();
      return;
    }
    // Square-lock even with the pointer still. keydown repeats, so check the flag.
    if (e.key === 'Shift' && !this.#shiftLock) {
      this.#shiftLock = true;
      this.#drawRectPreview();
      return;
    }
    // The same guards as shortcuts.js, so a letter typed in a text field
    // doesn't cancel the drag.
    const target = e.composedPath ? e.composedPath()[0] : e.target;
    const tag = target && /** @type {Element} */ (target).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (TOOL_KEYS.has(k)) this.#cancelRect();
  }

  // A selection drag: Esc cancels (a move reverts to its grab), Shift starts
  // the axis lock from the last texel, and a tool letter cancels. The tool
  // switch then drops the selection in willUpdate.
  #onSelectionDragKey(e) {
    if (e.key === 'Escape') {
      if (this.#selDrag === 'marquee') this.#cancelMarquee();
      else this.#cancelMove();
      e.preventDefault();
      return;
    }
    if (e.key === 'Shift') {
      if (this.#selDrag === 'move' && !this.#selShift) {
        this.#selShift = true;
        this.#applyMove(this.#selLast, true);
      }
      return;
    }
    const target = e.composedPath ? e.composedPath()[0] : e.target;
    const tag = target && /** @type {Element} */ (target).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (TOOL_KEYS.has(e.key.toLowerCase())) {
      if (this.#selDrag === 'marquee') this.#cancelMarquee();
      else this.#cancelMove();
    }
  }

  // A selection with no drag: Esc drops it, without preventDefault (see
  // #onKeyDown). Delete or Backspace clears it.
  #onSelectionUpKey(e) {
    const clear = e.key === 'Delete' || e.key === 'Backspace';
    if (e.key !== 'Escape' && !clear) return;
    if (!this.active) return;
    if (document.querySelector('vf-dialog[open]')) return; // the dialog takes its keys
    const target = e.composedPath ? e.composedPath()[0] : e.target;
    const tag = target && /** @type {Element} */ (target).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (!clear) {
      this.#dropSelection();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // A key typed while a menu is open is meant for the menu.
    if (document.querySelector('vf-menu[open]')) return;
    e.preventDefault();
    this.#clearSelection();
  }

  // Releasing Shift ends the rect's square lock or the move's axis lock.
  #onKeyUp = (e) => {
    if (e.key !== 'Shift') return;
    if (this.#selDrag === 'move' && this.#selShift) {
      this.#selShift = false;
      this.#applyMove(this.#selLast, false);
      return;
    }
    if (this.#rectDragging && this.#shiftLock) {
      this.#shiftLock = false;
      this.#drawRectPreview();
    }
  };

  // Texel math
  #toTexel(e) {
    const rect = this.#canvas.value.getBoundingClientRect();
    const px = Math.floor(((e.clientX - rect.left) / rect.width) * this.tileW);
    const py = Math.floor(((e.clientY - rect.top) / rect.height) * this.tileH);
    if (px < 0 || py < 0 || px >= this.tileW || py >= this.tileH) return null;
    return { px, py };
  }

  // Like #toTexel, but clamped to the tile, so a captured drag past the canvas
  // edge keeps tracking.
  #toTexelClamped(e) {
    const rect = this.#canvas.value.getBoundingClientRect();
    const px = Math.floor(((e.clientX - rect.left) / rect.width) * this.tileW);
    const py = Math.floor(((e.clientY - rect.top) / rect.height) * this.tileH);
    return {
      px: Math.max(0, Math.min(this.tileW - 1, px)),
      py: Math.max(0, Math.min(this.tileH - 1, py)),
    };
  }

  // Painting
  // The RGBA a write lays down: the ink, or transparent for the eraser or a
  // right-button stroke.
  #writeColor() {
    const paint = !this.#forceErase && this.tool !== 'eraser';
    return paint
      ? { r: this.ink.r, g: this.ink.g, b: this.ink.b, a: 255 }
      : { r: 0, g: 0, b: 0, a: 0 };
  }

  // A right-button pencil stroke erases with the pencil's size and shape.
  get #tipSize() {
    return this.tool === 'eraser' ? this.eraserSize : this.pencilSize;
  }

  get #tipShape() {
    return this.tool === 'eraser' ? this.eraserShape : this.pencilShape;
  }

  get #erasing() {
    return this.tool === 'eraser' || this.#forceErase;
  }

  // A press would sample: the eyedropper, or Option held outside a drag.
  get #sampling() {
    return springTool(this.tool, this.option, this.#dragging) === 'eyedropper';
  }

  // Whether the cursor layer shows ants: an erasing footprint, the eyedropper's
  // target, or an erasing rect drag.
  get #cursorAntsUp() {
    if (this.#rectDragging) return this.#forceErase;
    return !!this.#hoverTexel && (this.#erasing || this.#sampling);
  }

  // Whether the band shows its hover ants: the pointer is over a strip texel a
  // press would pick, and it would sample.
  get #bandAntsUp() {
    return !!this.#bandTexel && this.#sampling;
  }

  // Run the ticker only while some ants are up. Stopping resets the phase.
  #syncAnts() {
    if (this.#sel || this.#cursorAntsUp || this.#bandAntsUp) this.#startAnts();
    else this.#stopAnts();
  }

  // Draw a line from the previous texel, so a fast drag paints a solid run.
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
      this.#tipSize,
      color,
      this.#tipShape
    );
    this.#prev = { px, py };
    if (changed) this.#commitPixels();
  }

  #commitPixels() {
    this.#dirty = true;
    this.#gestureChanged = true;
    this.#repaint();
    this.#notifyLive();
  }

  // Overlays
  // The system-px view for the draw-overlays.js painters.
  get #overlayView() {
    return {
      tileW: this.tileW,
      tileH: this.tileH,
      scale: this.#texelSys,
      sysW: this.#sysW,
      sysH: this.#sysH,
    };
  }

  // The cursor layer's hover preview. A press that would sample shows ants
  // around its texel. Otherwise an erasing footprint shows ants, and the pencil
  // shows the texels it would paint in the ink. Other tools clear the layer, as
  // does `t` null. Re-syncs the ants ticker.
  #drawCursor(t) {
    this.#hoverTexel = t;
    const g = this.#cursorCtx;
    if (!g) return;
    if (this.#sampling) {
      drawFootprintAnts(g, this.#overlayView, t, 1, this.#antsPhase);
    } else if (this.#erasing) {
      drawFootprintAnts(
        g,
        this.#overlayView,
        t,
        this.#tipSize,
        this.#antsPhase,
        this.#tipShape
      );
    } else {
      drawPencilPreview(
        g,
        this.#overlayView,
        this.tool === 'pencil' ? t : null,
        this.#tipSize,
        this.ink,
        this.#tipShape
      );
    }
    this.#syncAnts();
  }

  // The moving corner, square-locked under Shift.
  #effectiveEnd() {
    if (this.#shiftLock && this.#rectStart && this.#rectEnd) {
      return squareEnd(this.#rectStart, this.#rectEnd);
    }
    return this.#rectEnd;
  }

  // The normalized rect bounds, or null when not dragging. The preview and the
  // commit both use it.
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

  // Preview the rect on the cursor layer: the texels the release would paint,
  // or ants when erasing. #work is untouched until #commitRect().
  #drawRectPreview() {
    // Every change to the box passes through here, so report it first.
    this.#notifyRectDrag();
    const g = this.#cursorCtx;
    if (!g) return;
    drawRectPreview(
      g,
      this.#overlayView,
      this.#rectBounds(),
      this.cornerRadius,
      this.ink,
      this.#forceErase,
      this.#antsPhase
    );
  }

  // Rasterize the rect into #work with the same roundedRectRows as the preview.
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

  // Abort a rect drag. Nothing is written.
  #cancelRect() {
    if (!this.#rectDragging) return;
    this.#rectDragging = false;
    this.#rectStart = null;
    this.#rectEnd = null;
    this.#forceErase = false;
    this.#shiftLock = false;
    // Drop the undo capture without emitting.
    this.#gestureBefore = null;
    this.#gestureChanged = false;
    this.#cursorCtx?.clearRect(0, 0, this.#sysW, this.#sysH);
    this.#syncAnts();
    this.#notifyRectDrag();
    if (this.#rectPointer != null) {
      this.#canvas.value?.releasePointerCapture?.(this.#rectPointer);
      this.#rectPointer = null;
    }
  }

  // Emit sm-rect-drag when the box changes: the box while dragging, else null.
  #notifyRectDrag() {
    const next = this.#rectDragging ? this.#rectBounds() : null;
    const last = this.#rectNotified;
    if (
      next === last ||
      (next &&
        last &&
        next.x0 === last.x0 &&
        next.y0 === last.y0 &&
        next.x1 === last.x1 &&
        next.y1 === last.y1)
    )
      return;
    this.#rectNotified = next;
    this.#emit('sm-rect-drag', { bounds: next });
  }

  // Redraw the cursor layer: the rect preview while dragging, else the hover
  // preview.
  // Repaint the hover previews: the cursor overlay over the art, the ants over
  // the band.
  #redrawCursorLayer() {
    if (this.#rectDragging) this.#drawRectPreview();
    else this.#drawCursor(this.#hoverTexel);
    this.#drawBandCursor();
  }

  // Selection
  // The current selection rectangle: #sel shifted by #selOffset. It may hang
  // off the tile.
  get #selRect() {
    return this.#sel
      ? translateBounds(this.#sel, this.#selOffset.dx, this.#selOffset.dy)
      : null;
  }

  // The drawn and reported outline. Null while a marquee press is still a click.
  get #selOutline() {
    const b = this.#selRect;
    if (b && this.#selDrag === 'marquee' && !this.#selMoved) return null;
    return b;
  }

  // Whether a marquee press is a drag: past SELECT_SLOP, or on another texel.
  #marqueeMoved(e, t) {
    const p = this.#selPress;
    const a = this.#selAnchor;
    return (
      (!!p &&
        Math.max(Math.abs(e.clientX - p.x), Math.abs(e.clientY - p.y)) > SELECT_SLOP) ||
      (!!a && (t.px !== a.px || t.py !== a.py))
    );
  }

  // Emit sm-selection when the outline changes.
  #notifySelection() {
    const next = this.#selOutline;
    const last = this.#selNotified;
    if (
      next === last ||
      (next &&
        last &&
        next.x0 === last.x0 &&
        next.y0 === last.y0 &&
        next.x1 === last.x1 &&
        next.y1 === last.y1)
    )
      return;
    this.#selNotified = next;
    this.#emit('sm-selection', { bounds: next });
  }

  // On the first move, copy the marquee's texels into the float and clear them
  // in a copy of the buffer, the base.
  #liftSelection() {
    this.#selFloat = liftRect(this.#work, this.tileW, this.#sel);
    this.#selBase = this.#work.slice();
    clearRect(this.#selBase, this.tileW, this.#sel);
  }

  // Write the base plus the float's opaque texels at the offset into #work, in
  // place. The document holds #work by reference, so it is never reassigned.
  #compositeSelection() {
    compositeFloat(
      this.#work,
      this.#selBase,
      this.tileW,
      this.tileH,
      this.#selFloat,
      this.#sel.x0 + this.#selOffset.dx,
      this.#sel.y0 + this.#selOffset.dy
    );
  }

  // A press inside the selection starts a move. Elsewhere it drops the
  // selection and starts a marquee. Primary button only.
  #onSelectDown(e, t) {
    if (e.button !== 0) return;
    if (this.#selDrag) return;
    const cur = this.#selRect;
    if (cur && boundsContain(cur, t.px, t.py)) {
      this.#startMove(e, t);
      return;
    }
    this.#dropSelection();
    this.#startMarquee(e, t);
  }

  #startMarquee(e, t) {
    this.#selAnchor = t;
    this.#sel = { x0: t.px, y0: t.py, x1: t.px, y1: t.py };
    this.#selOffset = { dx: 0, dy: 0 };
    this.#selDrag = 'marquee';
    this.#selPress = { x: e.clientX, y: e.clientY };
    this.#selMoved = false;
    this.#selPointer = e.pointerId;
    this.#canvas.value.setPointerCapture?.(e.pointerId);
    this.#startAnts();
    this.#drawAnts(); // draws nothing until the press moves
  }

  // A press that never moved is a click and leaves no selection. Otherwise the
  // selection is the anchor to the release texel, inclusive. The release point
  // counts toward the slop.
  #endMarquee(e) {
    const end = this.#toTexelClamped(e);
    const moved = this.#selMoved || this.#marqueeMoved(e, end);
    this.#releaseSelPointer();
    this.#selDrag = null;
    this.#selPress = null;
    this.#selMoved = false;
    if (!moved) {
      this.#sel = null;
      this.#selAnchor = null;
      this.#stopAnts();
      this.#clearAnts();
      this.#notifySelection();
      return;
    }
    this.#sel = normalizeBounds(this.#selAnchor, end);
    this.#drawAnts();
    this.#notifySelection();
  }

  // Abort a marquee. No selection remains.
  #cancelMarquee() {
    if (this.#selDrag !== 'marquee') return;
    this.#releaseSelPointer();
    this.#selDrag = null;
    this.#selPress = null;
    this.#selMoved = false;
    this.#sel = null;
    this.#selAnchor = null;
    this.#stopAnts();
    this.#clearAnts();
    this.#notifySelection();
  }

  #startMove(e, t) {
    if (!this.#selFloat) this.#liftSelection();
    this.#beginGesture();
    this.#selAnchor = t;
    this.#selOffsetAtGrab = { ...this.#selOffset };
    this.#selLast = t;
    this.#selShift = e.shiftKey;
    this.#selDrag = 'move';
    this.#selPointer = e.pointerId;
    this.#canvas.value.setPointerCapture?.(e.pointerId);
    this.#setCursorClaim('arrow');
  }

  // Set the float's offset from the drag delta, axis-locked under Shift. An
  // empty float (opaque 0) moves only the marquee. It must not call
  // #commitPixels, which would mark an empty derived face dirty.
  #applyMove(t, shift) {
    const a = this.#selAnchor;
    const g = this.#selOffsetAtGrab;
    let d = { dx: t.px - a.px, dy: t.py - a.py };
    if (shift) d = constrainAxis(d.dx, d.dy);
    const next = { dx: g.dx + d.dx, dy: g.dy + d.dy };
    if (next.dx === this.#selOffset.dx && next.dy === this.#selOffset.dy) return;
    this.#selOffset = next;
    if (this.#selFloat.opaque > 0) {
      this.#compositeSelection();
      this.#commitPixels();
    }
    this.#drawAnts();
    this.#notifySelection();
  }

  // End a move and close the undo bracket. The selection stays up at its
  // offset, over the same base and float.
  #endMove() {
    this.#endGesture();
    this.#releaseSelPointer();
    this.#selDrag = null;
    this.#selShift = false;
    this.#drawAnts();
  }

  // Abort a move: revert to the offset at the grab and re-composite. This uses
  // #repaint and #notifyLive, not #commitPixels, so no undo entry is recorded.
  #cancelMove() {
    if (this.#selDrag !== 'move') return;
    const g = this.#selOffsetAtGrab;
    if (this.#selOffset.dx !== g.dx || this.#selOffset.dy !== g.dy) {
      this.#selOffset = { ...g };
      if (this.#selFloat.opaque > 0) {
        this.#compositeSelection();
        this.#repaint();
        this.#notifyLive();
      }
    }
    this.#gestureBefore = null;
    this.#gestureChanged = false;
    this.#releaseSelPointer();
    this.#selDrag = null;
    this.#selShift = false;
    this.#drawAnts();
    this.#notifySelection();
  }

  // Cancel any drag and forget the selection. Writes nothing: #work already
  // holds the composite.
  #dropSelection() {
    if (!this.#sel) return;
    this.#cancelMarquee();
    this.#cancelMove();
    this.#sel = null;
    this.#selFloat = null;
    this.#selBase = null;
    this.#selOffset = { dx: 0, dy: 0 };
    this.#selAnchor = null;
    this.#selOffsetAtGrab = null;
    this.#selLast = null;
    this.#selShift = false;
    this.#stopAnts();
    this.#clearAnts();
    this.#setCursorClaim('crosshair');
    this.#notifySelection();
  }

  // Clear the selection as one undo step, then drop it. A marquee's texels go
  // transparent. A lifted selection leaves its base, so the art under it shows.
  #clearSelection() {
    this.#beginGesture();
    if (this.#selFloat) this.#work.set(this.#selBase);
    else clearRect(this.#work, this.tileW, this.#sel);
    this.#commitChanged();
    this.#endGesture();
    this.#dropSelection();
  }

  #releaseSelPointer() {
    if (this.#selPointer != null) {
      this.#canvas.value?.releasePointerCapture?.(this.#selPointer);
      this.#selPointer = null;
    }
  }

  #drawAnts() {
    const g = this.#antsCtx;
    if (!g) return;
    drawMarchingAnts(g, this.#overlayView, this.#selOutline, this.#antsPhase);
  }

  #clearAnts() {
    this.#antsCtx?.clearRect(0, 0, this.#sysW, this.#sysH);
  }

  // Each tick advances the phase and redraws whichever ants are up. Under
  // reduced motion the ants stay at phase 0.
  #startAnts() {
    if (this.#antsTimer != null) return;
    if (prefersReducedMotion()) return;
    this.#antsTimer = setInterval(() => {
      this.#antsPhase = (this.#antsPhase + 1) % ANTS_PERIOD;
      if (this.#sel) this.#drawAnts();
      if (this.#cursorAntsUp || this.#bandAntsUp) this.#redrawCursorLayer();
    }, ANTS_MS);
  }

  #stopAnts() {
    if (this.#antsTimer != null) clearInterval(this.#antsTimer);
    this.#antsTimer = null;
    this.#antsPhase = 0;
  }

  // Set the kit cursor on the pixel canvas: the arrow over a selection, the
  // crosshair elsewhere. Set imperatively, and only on change, to keep it off
  // the render path. The kit reads the claim on the next pointer move.
  #setCursorClaim(kind) {
    const c = this.#canvas.value;
    if (c && c.getAttribute('data-vf-cursor') !== kind)
      c.setAttribute('data-vf-cursor', kind);
  }

  // Selection commands from the Edit menu and the options strip, called through
  // <sm-editor>. Each does nothing during a drag.

  /**
   * The selection's texels and the top-left of its current rectangle, or null.
   * @returns {{float: import('../lib/select.js').Float, x: number, y: number}|null}
   */
  copySelection() {
    if (!this.#sel || this.#dragging) return null;
    // A moved selection or a paste copies its whole float, off-tile texels too.
    const f = this.#selFloat;
    const float = f
      ? { width: f.width, height: f.height, data: f.data.slice(), opaque: f.opaque }
      : liftRect(this.#work, this.tileW, this.#sel);
    const b = this.#selRect;
    return { float, x: b.x0, y: b.y0 };
  }

  /**
   * Install `float` at (x, y) as a lifted selection, written as one undo step.
   * @param {import('../lib/select.js').Float} float @param {number} x @param {number} y
   */
  pasteFloat(float, x, y) {
    if (this.#dragging || !this.#work || !this.tileW || !this.tileH) return;
    this.#dropSelection();
    this.#sel = { x0: x, y0: y, x1: x + float.width - 1, y1: y + float.height - 1 };
    this.#selFloat = float;
    this.#selBase = this.#work.slice();
    if (float.opaque > 0) {
      this.#beginGesture();
      this.#compositeSelection();
      this.#commitChanged();
      this.#endGesture();
    }
    this.#startAnts();
    this.#drawAnts();
    this.#notifySelection();
  }

  /** Select the whole tile, not lifted. */
  selectAll() {
    if (this.#dragging || !this.#work || !this.tileW || !this.tileH) return;
    this.#dropSelection();
    this.#sel = { x0: 0, y0: 0, x1: this.tileW - 1, y1: this.tileH - 1 };
    this.#startAnts();
    this.#drawAnts();
    this.#notifySelection();
  }

  /**
   * Mirror the selection within its rectangle, as one undo step. A marquee flips
   * in the buffer. A lifted selection flips its whole float over the same base.
   * @param {'horizontal'|'vertical'} axis
   */
  flipSelection(axis) {
    if (!this.#sel || this.#dragging) return;
    this.#beginGesture();
    const f = this.#selFloat;
    if (f) {
      const whole = { x0: 0, y0: 0, x1: f.width - 1, y1: f.height - 1 };
      flipRect(f.data, f.width, whole, axis);
      if (f.opaque > 0) this.#compositeSelection();
    } else {
      flipRect(this.#work, this.tileW, this.#sel, axis);
    }
    this.#commitChanged();
    this.#endGesture();
  }

  // Sampling and fill
  // Report the eyedropped texel's color, or sm-pick-transparent for empty space.
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

  // The fill's ink: the active color, or transparent for a right-click.
  #fillInk(rightClick) {
    return rightClick
      ? { transparent: true }
      : { r: this.ink.r, g: this.ink.g, b: this.ink.b };
  }

  // Fill this tile: a flood from t, or with contiguous off, a recolor of every
  // texel of the clicked color.
  #applyLocalFill(t, rightClick) {
    const fill = this.#fillInk(rightClick);
    const i0 = (t.py * this.tileW + t.px) * 4;
    const changed = this.fillContiguous
      ? floodFill(this.#work, this.tileW, this.tileH, t.px, t.py, fill)
      : replaceColor(this.#work, keyAt(this.#work, i0), fill);
    if (changed) this.#commitPixels();
  }

  // With contiguous off and all faces on, the container recolors every tile
  // (sm-replace-all-tiles). Otherwise fill this tile.
  #doFill(t, rightClick) {
    if (!this.fillContiguous && this.fillAllFaces) {
      const target = keyAt(this.#work, (t.py * this.tileW + t.px) * 4);
      this.#emit('sm-replace-all-tiles', { target, fill: this.#fillInk(rightClick) });
      return;
    }
    this.#applyLocalFill(t, rightClick);
  }

  // Pointer
  // A press, release or cancel can start or end a drag, so each reports it.
  #onPointerDown = (e) => {
    this.#pointerDown(e);
    this.#notifyGesture();
  };

  #onPointerUp = (e) => {
    this.#pointerUp(e);
    this.#notifyGesture();
  };

  #onPointerCancel = (e) => {
    this.#pointerCancel(e);
    this.#notifyGesture();
  };

  #pointerDown(e) {
    const t = this.#toTexel(e);
    if (!t) return;
    e.preventDefault();
    this.#drawCursor(t);
    // The eyedropper, or Alt with any tool, samples. A right-click with Alt
    // still erases.
    if (this.tool === 'eyedropper' || (e.button !== 2 && e.altKey)) {
      this.#sampleAt(t.px, t.py);
      return;
    }
    if (this.tool === 'select') {
      this.#onSelectDown(e, t);
      return;
    }
    if (this.tool === 'fill') {
      // A synchronous click. The all-faces path writes nothing here, so
      // #endGesture emits nothing.
      this.#beginGesture();
      this.#doFill(t, e.button === 2);
      this.#endGesture();
      return;
    }
    if (this.tool === 'rect') {
      // A drag owns one pointer, and a second pointer can't take it over.
      if (this.#rectDragging && this.#rectPointer != null) return;
      this.#forceErase = e.button === 2;
      this.#shiftLock = e.shiftKey;
      this.#beginGesture();
      this.#rectDragging = true;
      this.#rectStart = t;
      this.#rectEnd = t;
      this.#rectPointer = e.pointerId;
      this.#canvas.value.setPointerCapture?.(e.pointerId);
      this.#drawRectPreview();
      this.#syncAnts();
      return;
    }
    // The pencil and eraser share the stroke path. #writeColor() picks ink or
    // transparency.
    this.#forceErase = e.button === 2;
    this.#beginGesture();
    this.#drawing = true;
    this.#prev = null;
    this.#canvas.value.setPointerCapture?.(e.pointerId);
    this.#stroke(t.px, t.py);
    this.#drawCursor(t); // a right press shows the erase ants at once
  }

  #onPointerMove = (e) => {
    if (this.#selDrag) {
      // Only the owning pointer moves the drag. The texel is clamped to the
      // tile, though the float itself may hang off.
      if (e.pointerId !== this.#selPointer) return;
      const t = this.#toTexelClamped(e);
      if (this.#selDrag === 'marquee') {
        if (!this.#selMoved) this.#selMoved = this.#marqueeMoved(e, t);
        this.#sel = normalizeBounds(this.#selAnchor, t);
        this.#drawAnts();
        this.#notifySelection();
      } else {
        this.#selLast = t;
        this.#selShift = e.shiftKey;
        this.#applyMove(t, e.shiftKey);
      }
      return;
    }
    if (this.#rectDragging) {
      // Only the owning pointer moves the box.
      if (e.pointerId !== this.#rectPointer) return;
      this.#shiftLock = e.shiftKey;
      this.#rectEnd = this.#toTexelClamped(e);
      this.#drawRectPreview();
      return;
    }
    const t = this.#toTexel(e);
    // The selection tool's cursor: the arrow inside the selection, the
    // crosshair outside.
    if (this.tool === 'select') {
      const cur = this.#selRect;
      this.#setCursorClaim(
        cur && t && boundsContain(cur, t.px, t.py) ? 'arrow' : 'crosshair'
      );
    }
    this.#drawCursor(t);
    if (!this.#drawing || !t) return;
    this.#stroke(t.px, t.py);
  };

  #pointerUp(e) {
    if (this.#selDrag) {
      if (e.pointerId !== this.#selPointer) return; // ignore a stray second pointer
      if (this.#selDrag === 'marquee') this.#endMarquee(e);
      else this.#endMove();
      return;
    }
    if (this.#rectDragging) {
      if (e.pointerId !== this.#rectPointer) return; // ignore a stray second pointer
      this.#rectEnd = this.#toTexelClamped(e);
      this.#commitRect();
      this.#endGesture();
      this.#rectDragging = false;
      this.#rectStart = null;
      this.#rectEnd = null;
      this.#forceErase = false;
      this.#shiftLock = false;
      this.#canvas.value.releasePointerCapture?.(this.#rectPointer);
      this.#rectPointer = null;
      this.#cursorCtx.clearRect(0, 0, this.#sysW, this.#sysH);
      this.#syncAnts();
      this.#notifyRectDrag();
      return;
    }
    this.#endGesture();
    this.#drawing = false;
    this.#prev = null;
    this.#forceErase = false;
    this.#canvas.value.releasePointerCapture?.(e.pointerId);
    this.#redrawCursorLayer(); // clears a right-button stroke's ants
  }

  // pointercancel discards a rect drag and cancels a selection drag. A pencil
  // stroke ends and keeps its pixels and undo entry.
  #pointerCancel(e) {
    if (this.#selDrag) {
      if (e.pointerId !== this.#selPointer) return; // only the owner can cancel
      if (this.#selDrag === 'marquee') this.#cancelMarquee();
      else this.#cancelMove();
      return;
    }
    if (this.#rectDragging) {
      if (e.pointerId !== this.#rectPointer) return; // only the owner can cancel
      this.#cancelRect();
      return;
    }
    this.#endGesture();
    this.#drawing = false;
    this.#prev = null;
    this.#forceErase = false;
    this.#canvas.value.releasePointerCapture?.(e.pointerId);
    this.#redrawCursorLayer();
  }

  // Clear the hover preview and reset the selection cursor on leave, except
  // during a rect or selection drag.
  #onPointerLeave = () => {
    if (this.#rectDragging || this.#selDrag) return;
    this.#drawCursor(null);
    if (this.tool === 'select') this.#setCursorClaim('crosshair');
  };

  #onContextMenu = (e) => e.preventDefault(); // right-click erases

  // The edge-hint band
  // The strips lie outside the pixel canvas, so the hint frame's container
  // carries their pointer input. It is sampling only: nothing there draws.

  // The pick under a pointer event: a strip texel and its color, or null off
  // the frame, over the art, or on an empty strip texel. The frame's corners
  // are always empty, so they never pick.
  /** @returns {{px:number,py:number,rgb:{r:number,g:number,b:number}}|null} */
  #bandPickAt(e) {
    const f = this.edgeHints;
    const c = this.#hintCanvas.value;
    if (!f || !c) return null;
    const rect = c.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const px = Math.floor(((e.clientX - rect.left) / rect.width) * f.width);
    const py = Math.floor(((e.clientY - rect.top) / rect.height) * f.height);
    if (px < 0 || py < 0 || px >= f.width || py >= f.height) return null;
    const onArt =
      px >= EDGE_HINT &&
      py >= EDGE_HINT &&
      px < f.width - EDGE_HINT &&
      py < f.height - EDGE_HINT;
    if (onArt) return null;
    const i = (py * f.width + px) * 4;
    if (f.data[i + 3] === 0) return null;
    return { px, py, rgb: { r: f.data[i], g: f.data[i + 1], b: f.data[i + 2] } };
  }

  // A press samples by the canvas's rule: the eyedropper, or Alt with any tool.
  // An empty texel picks nothing, since there is no art out here to erase.
  #onBandDown = (e) => {
    if (this.#dragging) return;
    if (this.tool !== 'eyedropper' && !(e.button !== 2 && e.altKey)) return;
    const pick = this.#bandPickAt(e);
    if (!pick) return;
    e.preventDefault();
    this.#bandTexel = pick;
    this.#drawBandCursor();
    this.#emit('sm-pick-color', { rgb: pick.rgb });
  };

  #onBandMove = (e) => {
    this.#bandTexel = this.#bandPickAt(e);
    this.#drawBandCursor();
  };

  #onBandLeave = () => {
    this.#bandTexel = null;
    this.#drawBandCursor();
  };

  // The system-px view over the whole frame, for the band's ants.
  get #bandOverlayView() {
    const f = this.edgeHints;
    const k = this.#texelSys;
    return {
      tileW: f.width,
      tileH: f.height,
      scale: k,
      sysW: f.width * k,
      sysH: f.height * k,
    };
  }

  // The band's ants and its cursor claim. The crosshair shows only while a
  // press would sample, so the strips never look drawable.
  #drawBandCursor() {
    const hints = this.#hints.value;
    const kind = this.edgeHints && this.#sampling ? 'crosshair' : 'arrow';
    if (hints && hints.getAttribute('data-vf-cursor') !== kind)
      hints.setAttribute('data-vf-cursor', kind);
    const c = this.#bandCanvas.value;
    const g = this.#bandCtx;
    if (!g || !c) return;
    if (!this.edgeHints) {
      g.clearRect(0, 0, c.width, c.height);
      return;
    }
    const t = this.#bandAntsUp ? this.#bandTexel : null;
    drawFootprintAnts(g, this.#bandOverlayView, t, 1, this.#antsPhase);
    this.#syncAnts();
  }
}

// Guarded against a second define when Vite's HMR re-runs the module.
if (!customElements.get('sm-draw-canvas'))
  customElements.define('sm-draw-canvas', SmDrawCanvas);
