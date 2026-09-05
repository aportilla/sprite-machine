// ---------------------------------------------------------------------------
// <sm-draw-canvas> — the pixel-canvas subsystem: the 4-layer stack (onion-skin
// background, the editable pixel canvas, the cursor overlay, the selection's
// marching-ants overlay), the working
// buffer, the selection/pencil/rect/fill/eraser/eyedropper gestures (the
// pencil's tip is its size AND its shape — the disc inscribed in the N×N box,
// or the box itself, lib/brush.js brushRows, one primitive under the stamp
// and the hover preview; the
// eraser is a pencil that writes transparency — it shares the stroke path but
// carries its OWN tip size and its OWN tip shape; every erase
// previews as the ERASE TREATMENT, the marching ants around what it would
// clear — the tip's own outline, a disc ringed as a disc; the rect tool's
// right-drag rings its box), the
// whole-system-px layout fitting, and the
// gesture-scoped keys (Esc cancels an in-flight rect or drops a selection,
// Shift square-locks a rect or axis-locks a selection move — document-level,
// but canvas business).
//
// THE SELECTION (MacPaint's selection rectangle): drag a marquee out (a
// press is a click until it moves past SELECT_SLOP or onto another texel —
// then a marquee, anchor to corner inclusive, ONE texel the smallest), drag
// inside it to move the selected pixels, click outside / Esc / switch tools
// to drop it where it sits. The model is BASE + FLOAT: on the first move
// press the marquee's texels are lifted out ONCE as their own tile
// (#selFloat, lib/select.js liftRect) and the hole they leave is cleared on a
// pristine copy of the buffer (#selBase); every offset is then a pure
// composite of (base, float, offset) written INTO #work in place — so
// dragging across the sprite and back never smears what it crossed, and the
// working buffer's identity (which the doc holds by reference) never changes.
// Transparent texels of the float never travel: the base shows through them.
// The selection is canvas state and dies with the working buffer (any
// structural change — undo, a face switch, a resize — drops it; the pixels
// are already in the document). Each move gesture is one undo step through
// the ordinary begin/end bracket; a marquee writes nothing.
//
// A presentational LEAF: props down (tile geometry + view model + the brush
// state), bubbling events up:
//   - sm-live        { tile, dirty }  on each actual pixel change (the tile is
//                    the working buffer BY REFERENCE — never cloned)
//   - sm-commit      { before, after }  one finished gesture's snapshot pair
//                    (copies), for the container's undo history
//   - sm-selection   { bounds | null }  the selection's CURRENT outline
//                    whenever it changes (a marquee corner, a float offset,
//                    a drop) — never per ants tick, never twice for the
//                    same value; the container mirrors it onto its context
//   - sm-rect-drag   { bounds | null }  the rect tool's drag in flight — the
//                    box as the release would paint it (square-locked) —
//                    whenever it changes (the press, a corner move, Shift
//                    down / up) and null when it ends (commit, Esc, cancel,
//                    a tool switch); the same dedupe, the same mirror — for
//                    the options strip's readout
//   - sm-pick-color  { rgb }          an eyedrop hit a painted texel
//   - sm-pick-transparent             an eyedrop hit empty space
//   - sm-replace-all-tiles { target, fill }  a fill click with contiguous off
//                    and "on all faces" on
//
// STATE SPLIT — the correctness core, carried over verbatim: reactive props are
// what the template + updated() react to; everything the pointer hot paths
// touch is a plain `#private` field (the pixel buffer and its ImageData view,
// stroke/drag state, the selection's base/float/offset, the cursor claim, the
// on-screen scale), so a pencil drag or a selection move can never schedule a
// re-render at pointer-move rate. Canvas backing stores are sized
// imperatively, never template-bound (a bound width would clear the buffer
// mid-diff). Every stroke is HARD-pixel (alpha 0 or 255) via lib/brush.js.
// The low-rate reactive inputs beyond the brush state are `active` —
// whether this window is the desktop's active document window — which gates
// the selection's no-drag Esc (every open window's canvas listens on the
// document; only the active one answers).
// The PAPER under the art is the kit's 12% dither (`gray-12`, a sparse field
// of dots), always — the stack container's own kit pattern, the transparency
// look (an empty texel reads as dotted paper, a painted one covers it — WHITE
// art included, a clear patch in the dots).
//
// The working buffer resets in willUpdate when the tile IDENTITY (or the tile
// geometry) changes — identity is the caller's contract: the same reference
// means "same art, don't reset". Any `tool` change cancels an in-flight
// gesture (strictly more robust than the old key-only cancel).
//
// One-shot dev-hook props (plain fields, consumed on the first update; the
// capture tool can't hover/drag/click):
//   - previewCursor: draw the pencil footprint at the tile center (at the
//     session's size and shape — ?cursor=<N>[,<shape>] seeds both).
//   - previewRect {x0,y0,x1,y1,square}: draw the rect tool's live drag preview
//     (modeled as an active drag with no captured pointer, so ESC still
//     demonstrates cancel).
//   - fillOnMount {x,y}: perform a fill click at (x,y). Applied LOCALLY (this
//     tile) even with "on all faces" on — a local fill avoids a re-mount
//     mid-mount.
//   - selectOnMount {x0,y0,x1,y1,dx,dy}: select that box, and with a nonzero
//     offset lift + float it there (the pixels reach the doc like a mount
//     fill — no gesture bracket, no undo entry). The ants draw at phase 0 and
//     never tick under the hook, so a capture stays byte-deterministic.
// ---------------------------------------------------------------------------

import { css, LitElement, html } from 'lit';
import { createRef, ref } from 'lit/directives/ref.js';
// The named imports also execute the kit module, registering <vf-container>
// (and every other vf-* element) for the template below.
import { effectiveScale, onScaleChange, prefersReducedMotion } from 'vintage-frames';
import { writeTexel, stampBrush, strokeLine } from '../lib/brush.js';
import { roundedRectRows, squareEnd } from '../lib/rect.js';
import { keyAt, floodFill, replaceColor } from '../lib/fill.js';
import {
  liftRect,
  clearRect,
  compositeFloat,
  normalizeBounds,
  boundsContain,
  translateBounds,
  constrainAxis,
} from '../lib/select.js';
import { ANTS_PERIOD } from '../lib/ants.js';
import {
  drawPencilPreview,
  drawFootprintAnts,
  drawRectPreview,
  drawMarchingAnts,
} from './draw-overlays.js';
import { baseStyles } from './base-styles.js';

// MIRROR_ALPHA keeps the onion-skin a faint hint — a pale tint of the
// opposite face's art over the dithered paper. It is the fade's ONLY source:
// the background layer carries no CSS opacity.
const MIRROR_ALPHA = 0.22;

// The marching ants' step: one system px of dash travel per tick. Brisk, the
// way MacPaint's were; the ANTS_PERIOD-px dash cycle makes eight ticks one
// cycle.
const ANTS_MS = 100;

// The selection tool's drag threshold, in CSS px — the OS's own click-vs-drag
// idiom: a press that moves no further than this (and stays on its anchor
// texel) is a CLICK, no selection; past it the press is a marquee, whose box
// is the anchor to the corner inclusive — so a wiggle inside one texel
// selects that texel (the earlier rule, "a marquee that ends on its anchor
// is a click", floored a selection at 1×2; it went Sep 5 2026).
const SELECT_SLOP = 3;

// The bare-letter tool keys (shortcuts.js's map) — mid-gesture, any of them
// abandons the drag in flight before the switch it makes lands.
const TOOL_KEYS = new Set(['s', 'b', 'r', 'g', 'e', 'i']);

// The PAPER under the art — the stack container's `pattern`, the kit's own
// 1-bit fill (vintage-frames docs/PATTERNS.md): the 12% dither (`gray-12`,
// one ink px in eight, a sparse field of dots — lighter than the desktop's
// 50% default, so the art sits on near-white paper), the transparency
// indicator — a painted texel covers the dots, WHITE art reading as a clear
// patch in them. Declaring a pattern is also what keeps the desktop's
// pattern ink out of the box — see the template note.
const PAPER = 'gray-12';

export class SmDrawCanvas extends LitElement {
  static styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
      /* The canvas WELL fills the draw box below the options bar. No flex
       centering: it is only the measuring box and the positioning anchor
       (position: relative — "the one line of CSS this feature can't write
       for you", the kit's position.ts) for the placed vf-container holding
       the canvas layers; #layout() computes the centered top/left in whole
       system px. The padding rides --vf-scale (12 system px) like every
       other chrome metric, keeping the whole chain above the canvas in
       whole system px. */
      .editor-canvas-wrap {
        flex: 1 1 auto;
        min-height: 0; /* let it shrink so #layout() can integer-fit the canvas inside */
        position: relative;
        padding: calc(var(--vf-scale, 1) * 12px);
        overflow: hidden; /* clip if a tiny container forces the min (scale 1) canvas over */
      }
      /* The square holding the four aligned canvas layers is a kit
       <vf-container> — the DITL rectangle: #layout() states its width/
       height/top/left in whole system px and the kit writes them as live
       calc(var(--vf-scale) * Npx) lengths (VfSized / VfPositioned), so the
       box lands on the device-pixel grid BY CONSTRUCTION — no measured
       correction, nothing that can ratchet. The container's own
       GridSnapController still holds the box on the grid against any
       upstream fraction, and its shadow .box is both that correction's
       target and the canvases' positioning anchor, so all four layers ride
       it together. No rule block needed: the kit owns the container's
       layout entirely. */
      /* All four layers fill the stack (backing stores managed in JS): a background
       (the faded onion-skin, system-px res), the transparent pixel canvas
       (native tile res), then the cursor + selection overlays (system-px
       res — their 1px hairlines are 1 system px, the kit's hairline unit). */
      .editor-canvas-stack > canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
      }
      /* Only the pixel canvas takes pointer events (default auto); the others pass
       clicks through to it. The kit's page-drawn cursor claims the crosshair via
       the template's data-vf-cursor — and this declaration must read the kit's
       --vf-cursor token first (the \`* { cursor: none }\` blanket applyCursor
       installs can't pierce a shadow root, and a bare \`cursor: crosshair\` here
       out-cascades the inherited none, so BOTH crosshairs would show). The native
       crosshair is only the fallback for any boot state where applyCursor hasn't
       taken over yet. */
      .editor-canvas {
        z-index: 1;
        cursor: var(--vf-cursor, crosshair);
        touch-action: none;
      }
      /* The faded onion-skin, DRAWN into the system-res backing store (see
       #paintBg) on a transparent ground — the container's dither is the
       paper — UNDER the transparent pixel canvas so it shows through
       unpainted texels. No layer opacity: the onion-skin's fade is its own
       alpha (MIRROR_ALPHA). */
      .editor-canvas-bg {
        z-index: 0;
        pointer-events: none;
      }
      /* The cursor preview sits ABOVE the pixel canvas. */
      .editor-canvas-cursor {
        z-index: 2;
        pointer-events: none;
      }
      /* The selection's marching ants, topmost — nothing may cover the
       boundary — and on their OWN layer: every hover / rect painter clears
       and redraws the cursor layer at pointer-move rate, and ants drawn
       there would be wiped by the next move. (The erase previews' and the
       eyedropper target's ants ARE the cursor layer's painting — what the
       hover draws, redrawn per move and per tick — so they live there; the
       two rings are never up at once, a selection dropping on any tool
       switch.) */
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
    mirrorBehind: { attribute: false },
    tool: {},
    ink: { attribute: false },
    pencilSize: { type: Number },
    /** The pencil's tip shape, 'circle' | 'square' (lib/brush.js PENCIL_SHAPES). */
    pencilShape: {},
    eraserSize: { type: Number },
    /** The eraser's own tip shape, the same two names. */
    eraserShape: {},
    cornerRadius: { type: Number },
    fillContiguous: { type: Boolean },
    fillAllFaces: { type: Boolean },
    /** Whether this window is the desktop's active document window — the
     *  selection's no-drag Esc gate (decision: Esc drops the ACTIVE window's
     *  selection only). Nothing else reads it. */
    active: { type: Boolean },
  };

  constructor() {
    super();
    this.tile = null;
    this.tileW = 0;
    this.tileH = 0;
    this.mirrorBehind = null;
    this.tool = 'pencil';
    this.ink = null;
    this.pencilSize = 1;
    this.pencilShape = 'circle';
    this.eraserSize = 1;
    this.eraserShape = 'circle';
    this.cornerRadius = 0;
    this.fillContiguous = true;
    this.fillAllFaces = false;
    this.active = false;

    // Dev hooks (plain: consumed once on the first update, never re-read).
    this.previewCursor = false;
    this.previewRect = null;
    this.fillOnMount = null;
    this.selectOnMount = null;
  }

  // --- plain fields: the pixel buffer, gesture state, on-screen geometry -----
  #work = null; // Uint8ClampedArray of the working tile — shared with #imgData
  #workingTile = null; // { width, height, data:#work } handed out with sm-live
  #imgData = null; // ImageData VIEW over #work (by reference — never re-copied)
  #dirty = false; // has the user actually changed a pixel since the last reset?

  #drawing = false; // a pencil stroke is in progress
  #prev = null; // last painted texel this stroke, for line interpolation
  #forceErase = false; // right-click erases regardless of the active ink
  // Undo capture: the tile's bytes at gesture start, and whether the gesture
  // actually changed a pixel — a commit emits sm-commit {before, after}.
  #gestureBefore = null;
  #gestureChanged = false;
  #hoverTexel = null; // last hovered texel, for the footprint preview
  // Rect-tool drag state: the anchor + moving corner, and the pointer we captured
  // (kept so ESC / pointercancel can release it).
  #rectDragging = false;
  #rectStart = null; // anchor corner texel {px,py}
  #rectEnd = null; // raw moving corner texel {px,py} (pre square-lock)
  #rectPointer = null; // captured pointerId, for release on cancel
  #shiftLock = false; // Shift held → constrain the drag to a square
  #rectNotified = null; // the box last reported through sm-rect-drag (dedupes emits)

  // Selection-tool state (the header's base + float model). `#sel` is the
  // marquee in TILE texels, inclusive — the LIFT ORIGIN, never translated in
  // place; the CURRENT rectangle (what the ants draw, what "inside"
  // hit-tests against) is `#sel` shifted by `#selOffset` — see #selRect.
  #sel = null; // {x0,y0,x1,y1} | null
  #selFloat = null; // {width,height,data,opaque} — lifted once, on the first move press
  #selBase = null; // #work with the marquee cleared: "the hole" — pristine for the selection's life
  #selOffset = { dx: 0, dy: 0 }; // the float's displacement from #sel
  #selDrag = null; // null | 'marquee' | 'move' — the gesture in flight
  #selAnchor = null; // marquee: the anchor texel · move: the grab texel
  #selPress = null; // marquee: the press's client point, for the SELECT_SLOP test
  #selMoved = false; // marquee: past the slop (or off the anchor texel) — a drag, so the release selects
  #selOffsetAtGrab = null; // move: #selOffset when the press landed (a cancel reverts to it)
  #selLast = null; // move: the last pointer texel (Shift with the pointer still re-derives from it)
  #selPointer = null; // the captured pointerId, released on every exit path
  #selShift = false; // Shift held during a move → the axis lock (guards keydown repeat)
  #selNotified = null; // the outline last reported through sm-selection (dedupes emits)
  // The ants: the selection's own overlay layer, the erase previews' ring on
  // the cursor layer, and ONE ticker that runs while either is up (#syncAnts).
  // `#antsStatic` (the ?select hook) pins phase 0 with no
  // timer, so a capture with a selection in frame stays byte-deterministic.
  #antsPhase = 0;
  #antsTimer = null;
  #antsStatic = false;

  // Live on-screen geometry, re-derived by #layout(), in the kit's SYSTEM px
  // (the vintage-frames virtual pixel grid): `#texelSys` is the whole-system-px
  // texel size, `#sysW`/`#sysH` the canvas box in system px (also the overlay
  // backings' resolution — the painters draw in system space), `#fitScale` the
  // CSS px per system px the fit was derived at. Placement itself lives on
  // the vf-container's own top/left/width/height properties.
  #texelSys = 1;
  #sysW = 0;
  #sysH = 0;
  #fitScale = 1;
  #laidOut = false;
  #resizeObs = null;
  #offScale = null; // onScaleChange release — set up per connect, like the observer

  /** @type {import('lit/directives/ref.js').Ref<HTMLElement>} */
  #wrap = createRef();
  /** @type {import('lit/directives/ref.js').Ref<import('vintage-frames').VfContainer>} */
  #stack = createRef();
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

  #drawHooksDone = false; // the one-shot canvas dev hooks ran (first update)

  // --- lifecycle -------------------------------------------------------------
  connectedCallback() {
    super.connectedCallback();
    // Gesture-scoped keys only (Esc cancel / selection drop, Shift square- or
    // axis-lock, and the S/B/R/G/E/I mid-drag abandon) — they must work
    // wherever focus is, so they live on the document; the general tool
    // shortcuts belong to shortcuts.js.
    document.addEventListener('keydown', this.#onKeyDown);
    document.addEventListener('keyup', this.#onKeyUp);
    // The desktop re-inserts a document window's node to raise it, which
    // disconnects and reconnects this element mid-session: the selection
    // fields survive (same instance), so the ants' ticker — stopped on
    // disconnect so it can't leak into a context whose element is gone —
    // comes back here iff a ring is up (a selection's; an erase preview's
    // stale hover re-syncs on the next move either way).
    this.#syncAnts();
    // Setup mirrors disconnectedCallback's teardown: raising any window makes
    // vf-desktop re-order the slotted windows in the light DOM, which
    // disconnects + reconnects this element — the observer torn down there
    // must come back here. On the first connect there's no wrap yet, so this
    // no-ops and firstUpdated does the initial setup.
    this.#observeResize();
    // A density/zoom change moves --vf-scale under the fit: re-derive it.
    // The kit updates every --vf-scale BEFORE these callbacks run (writer
    // tier first), so effectiveScale() inside #layout() reads the new value;
    // the container's declared lengths are live calcs and stay on the new
    // grid even in the beat before this re-fit lands.
    this.#offScale = onScaleChange(() => this.#layout());
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
  }

  willUpdate(changed) {
    // A new face / tile geometry means a fresh working buffer (+ its ImageData
    // view) and no gesture carried over from the old one. `tile` compares by
    // IDENTITY: the caller hands the same reference back only when the art is
    // unchanged.
    if (changed.has('tileW') || changed.has('tileH') || changed.has('tile')) {
      this.#resetWorking();
    } else if (changed.has('tool')) {
      // Switching tools abandons any in-flight gesture — a selection drops
      // where it sits (its pixels are already in the buffer; a move mid-drag
      // reverts to where it was grabbed first), the rect box is discarded
      // (nothing committed) and a live pencil stroke ends (its pixels stay,
      // so it still commits an undo entry).
      this.#dropSelection();
      this.#cancelRect();
      this.#endGesture();
      this.#drawing = false;
      this.#prev = null;
      this.#forceErase = false;
    }
  }

  firstUpdated() {
    this.#ctx = this.#canvas.value.getContext('2d');
    this.#cursorCtx = this.#cursor.value.getContext('2d');
    this.#antsCtx = this.#antsLayer.value.getContext('2d');
    this.#observeResize();
  }

  // Re-fit whenever the canvas container resizes — it fills the flex draw box, so
  // a window resize (or any change to the fixed regions above) reflows its height
  // and the centered canvas must re-scale. Observing `wrap` directly is
  // feedback-free: #layout() never sets wrap's height (only the stack/overlay/
  // cursor INSIDE it), so resizing those never changes wrap's own box, and a
  // no-op re-run (same scale) early-returns.
  #observeResize() {
    if (typeof ResizeObserver === 'undefined' || !this.#wrap.value) return;
    this.#resizeObs = new ResizeObserver(() => this.#layout());
    this.#resizeObs.observe(this.#wrap.value);
  }

  updated(changed) {
    const geom = changed.has('tileW') || changed.has('tileH') || changed.has('tile');
    // Canvas backing stores + the ImageData that shares `#work` are paired: they
    // are reconstructed together, imperatively, never bound in the template (a
    // template-bound width/height would clear the backing store mid-diff).
    if (geom) this.#applyGeometry();
    else if (changed.has('mirrorBehind')) this.#paintBg();

    // The cursor overlay is canvas-drawn, so the state the template can't express
    // has to be re-stroked here.
    if (
      changed.has('tool') ||
      changed.has('pencilSize') ||
      changed.has('pencilShape') ||
      changed.has('eraserSize') ||
      changed.has('eraserShape') ||
      changed.has('cornerRadius') ||
      changed.has('ink') // the pencil's and the rect drag's previews are painted in the ink
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
    this.#gestureBefore = null;
    this.#gestureChanged = false;
    this.#drawing = false;
    this.#prev = null;
    this.#forceErase = false;
    this.#hoverTexel = null;
    this.#rectDragging = false;
    this.#rectStart = null;
    this.#rectEnd = null;
    this.#rectPointer = null;
    this.#shiftLock = false;
    this.#notifyRectDrag(); // a box in flight went with the buffer (a no-op when none was)
    // A selection dies with the buffer it was lifted from (the pixels it
    // moved are already in the document): null the fields outright — no
    // cancel, nothing to revert into a buffer being replaced — and stop the
    // ticker. The ants layer clears on the re-fit below (a backing resize
    // clears a canvas) and directly here for a same-size swap.
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
    this.#notifySelection(); // the outline went with it (a no-op when none was up)
    this.#laidOut = false; // force #layout() to re-fit for the new tile size
  }

  // Size the native-resolution pixel canvas to the tile, repaint the pixels
  // and re-fit the stack — which sizes and paints the system-res layers, the
  // background among them (#resetWorking cleared #laidOut, so #layout() runs
  // in full).
  #applyGeometry() {
    const canvas = this.#canvas.value;
    if (!canvas) return;
    canvas.width = this.tileW;
    canvas.height = this.tileH;
    this.#repaint();
    this.#layout();
  }

  // The background layer under the transparent pixel canvas — SYSTEM-res,
  // sized in #layout() beside the overlays: the faded opposite-face
  // onion-skin, magnified nearest-neighbor to the texel size. The ground
  // stays transparent — the container's dither is the paper, and the
  // transparency indicator with it.
  #paintBg() {
    const bg = this.#bg.value;
    if (!bg || !bg.width || !bg.height) return;
    const g = bg.getContext('2d');
    g.clearRect(0, 0, bg.width, bg.height);
    const m = this.mirrorBehind;
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
      g.imageSmoothingEnabled = false; // a whole-multiple magnification: crisp texels
      g.globalAlpha = MIRROR_ALPHA; // putImageData ignores alpha; drawImage honors it
      g.drawImage(tmp, 0, 0, this.#sysW, this.#sysH);
      g.globalAlpha = 1;
    }
  }

  #repaint() {
    if (this.#ctx && this.#imgData) this.#ctx.putImageData(this.#imgData, 0, 0);
  }

  // Fit the largest whole-SYSTEM-px texel size inside the well's content box,
  // place + size the canvas vf-container, and redraw the system-res overlays.
  // This is what puts the art on the same virtual pixel grid as the kit's
  // chrome: a texel of k system px covers k × (--vf-scale × trueDpr) device px
  // — a whole count by the kit's scale contract — so every texel renders
  // identically crisp at any display density or browser zoom, at a whole
  // multiple of the unit the surrounding 1-bit art is drawn in (vf-img's one
  // image px = one system px, times k).
  //
  // Placement is DECLARED, not corrected: the centered top/left are computed
  // here in whole system px (centering rounds to the art grid — within half a
  // system px of true center, the way QuickDraw placed things, and the same
  // whole-art-px rule snapToSystemPx holds window chrome to) and handed to
  // the vf-container, which writes them as live calc(var(--vf-scale) * Npx)
  // lengths — on the device-pixel grid by construction, per the kit's
  // SIZING.md. The flex centering + measured snap this replaces produced
  // fractional origins by design and then had to cancel them per resize
  // event, which is where the down-right ratchet lived (drive.mjs's "cannot
  // ratchet" pin holds the door shut).
  //
  // The well's height is CSS-driven (it fills the flex draw box), so this
  // only MEASURES the wrap — it never sets a size on it. Idempotent: a re-run
  // at the same (texel, scale) pair re-states only the placement
  // (value-idempotent on the kit's reactive properties).
  #layout() {
    const wrap = this.#wrap.value;
    const stack = this.#stack.value;
    if (!wrap || !stack || !this.tileW || !this.tileH) return;
    // Measure both axes from the client box (border-excluded), subtracting padding so
    // the 1px border isn't double-counted: an over-measure could round the texel
    // size one step too big and the canvas would clip under overflow:hidden.
    const cs = getComputedStyle(wrap);
    const padL = parseFloat(cs.paddingLeft);
    const padT = parseFloat(cs.paddingTop);
    const availW = Math.max(1, wrap.clientWidth - padL - parseFloat(cs.paddingRight));
    const availH = Math.max(1, wrap.clientHeight - padT - parseFloat(cs.paddingBottom));
    // CSS px per system px in force here — the document window's inline
    // --vf-scale, inherited through the flat tree into this shadow root; the
    // same multiplier every metric around the canvas rides.
    const scale = effectiveScale(this);
    const availWSys = availW / scale;
    const availHSys = availH / scale;
    const k = Math.max(
      1,
      Math.floor(Math.min(availWSys / this.tileW, availHSys / this.tileH)) || 1
    );
    const sysW = this.tileW * k;
    const sysH = this.tileH * k;
    // Center within the content box, in whole system px. VfPositioned anchors
    // on the wrap's PADDING box, so the padding (12 system px — measured back
    // out of the resolved style rather than restated here) is part of the
    // offset. An oversized minimum-scale canvas centers negative and clips on
    // both sides under overflow:hidden, exactly as the flex centering did.
    stack.left = Math.round(padL / scale + (availWSys - sysW) / 2);
    stack.top = Math.round(padT / scale + (availHSys - sysH) / 2);
    if (this.#laidOut && k === this.#texelSys && scale === this.#fitScale) return;
    this.#laidOut = true;
    this.#texelSys = k;
    this.#fitScale = scale;
    this.#sysW = sysW;
    this.#sysH = sysH;
    stack.width = sysW;
    stack.height = sysH;
    // System-res backings: hairlines are 1 system px.
    this.#bg.value.width = this.#sysW;
    this.#bg.value.height = this.#sysH;
    this.#cursor.value.width = this.#sysW;
    this.#cursor.value.height = this.#sysH;
    this.#antsLayer.value.width = this.#sysW;
    this.#antsLayer.value.height = this.#sysH;
    this.#paintBg(); // the backing resize cleared it — the onion-skin at the new scale
    this.#redrawCursorLayer(); // re-stroke the footprint / rect preview at the new scale
    this.#drawAnts(); // the backing resize cleared the ants — re-stroke them at the new scale
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
    if (this.selectOnMount) {
      // A selection with no owning pointer (like ?rect's phantom drag): the
      // ants stand at phase 0 for the capture, and a real press inside takes
      // over normally (#selDrag stays null). With an offset, lift and float
      // it there — the pixels reach the doc like a mount fill, no gesture
      // bracket, no undo entry.
      const h = this.selectOnMount;
      this.#antsStatic = true;
      this.#sel = normalizeBounds(
        { px: clampX(h.x0), py: clampY(h.y0) },
        { px: clampX(h.x1), py: clampY(h.y1) }
      );
      this.#selOffset = { dx: 0, dy: 0 };
      if (h.dx || h.dy) {
        this.#liftSelection();
        this.#selOffset = { dx: h.dx | 0, dy: h.dy | 0 };
        if (this.#selFloat.opaque > 0) {
          this.#compositeSelection();
          this.#commitPixels();
        }
      }
      this.#startAnts(); // a no-op under #antsStatic — the once-drawn phase 0
      this.#drawAnts();
      this.#notifySelection();
    }
  }

  // --- template --------------------------------------------------------------
  // The WELL (.editor-canvas-wrap) fills the draw box below the options bar
  // (CSS flex:1) — its height comes from the flex layout, not JS — so nothing
  // shifts when the tile size (and thus the drawn canvas) changes. Inside it,
  // a kit <vf-container> holds the four aligned layers: #layout() states its
  // width/height/top/left in whole system px (the DITL rectangle — centered
  // by arithmetic, on the pixel lattice by construction), and the canvases
  // fill its box (inset: 0 against the container's own anchor, so all four
  // ride its grid-snap correction together). The container DECLARES its
  // pattern — the PAPER (PAPER, the kit's 12% dither, the transparency
  // indicator) — and not only
  // for the reading: a vf-container with no pattern of its
  // own INHERITS THE DESKTOP'S. vf-desktop paints its pattern as black ink
  // on transparent through an inline --_vf-pattern-image custom property on
  // its .screen, custom properties inherit through the slot into every
  // window, and a bare container's shadow .box (.vf-pattern-fill) resolves
  // it — so the stack would paint the desktop's OWN pattern under the
  // transparent texels (the 50% dither by default — never this paper), and
  // paint it BLURRED: `image-rendering: pixelated` and the white ground ride
  // the kit's .vf-patterned class, which only a declared pattern earns, so
  // the leaked raster is bilinear-scaled wherever a system px is more than
  // one device px — the "fuzzy 1px grid" a bare stack shows on a Retina
  // display (Sep 4 2026). A declared pattern gives the box its own ink, its
  // own ground and its own crisp raster. Kit ask #6: the private token
  // should not inherit.
  // Only the pixel canvas takes pointer events. It keeps a native tileW×tileH
  // backing store (CSS upscales it crisp); the bg + cursor + selection
  // layers are SYSTEM-res (backing tracks the box's system px) so their 1px
  // lines are 1 system px — the kit's own hairline unit.
  // Backing stores are set in #applyGeometry()/#layout(), never bound here.
  // The pixel canvas's
  // data-vf-cursor is the kit's page-drawn cursor claim — cloned once, never
  // re-applied by Lit, so #setCursorClaim's imperative flips (the arrow over a
  // selection) are never reverted by a render.
  render() {
    return html`
      <div class="editor-canvas-wrap" ${ref(this.#wrap)}>
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

  // --- events -----------------------------------------------------------------
  #emit(type, detail) {
    // Dispatched on the HOST (which lives in the container's tree), so no
    // `composed` is needed for the container to hear it.
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  }

  #notifyLive() {
    this.#emit('sm-live', { tile: this.#workingTile, dirty: this.#dirty });
  }

  // --- undo capture -----------------------------------------------------------
  // A gesture (pencil/eraser stroke, rect drag, fill click) brackets its pixel
  // writes with begin/end; end emits `sm-commit {before, after}` — snapshot
  // copies, so the container can hand them straight to the history — only when
  // the gesture actually changed something. A cancelled rect discards its
  // capture in #cancelRect instead (nothing was written).
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

  // --- gesture-scoped keyboard -------------------------------------------------
  // Three tiers, checked in order. A SELECTION DRAG in flight (a pointer is
  // captured, so nothing modal can be open): Esc cancels it, Shift toggles
  // the move's axis lock, the tool letters abandon it. A SELECTION UP with no
  // drag: only Esc, dropping it — and this one key is a document-wide
  // listener for as long as the selection lives (minutes, across dialogs and
  // menus, with other windows active), so it carries guards no gesture key
  // ever needed: the ACTIVE window only, no modal open, not typed into a
  // field — and never preventDefault (the kit's modal Esc is the native
  // `cancel` event, which a prevented keydown suppresses; the kit's menus
  // bail on defaultPrevented, so a prevented Esc would strand a dropped menu
  // open). Then the rect tier as ever: Esc aborts an in-flight rect drag
  // (nothing committed); Shift held mid-drag locks the box to a square;
  // S/B/R/G/E/I mid-drag abandon the box (shortcuts.js does the actual tool
  // switch — abandoning is this canvas's business, so the two compose without
  // ordering coupling). Everything here is a no-op unless a gesture is
  // actually in flight or a selection is up.
  #onKeyDown = (e) => {
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
    // ESC, so S/B/R/G/E/I can't leave a half-dragged rect wired to the old pointer.
    if (TOOL_KEYS.has(k)) this.#cancelRect();
  };

  // A selection drag in flight: Esc cancels (the marquee vanishes; a move
  // reverts to where it was grabbed), Shift down starts the move's axis lock
  // from the last pointer texel (keydown repeats, so guard on the flag), and
  // a tool letter abandons the drag — the tool switch shortcuts.js makes then
  // drops the selection through willUpdate (S with the selection tool live
  // is a silent no-op patch and switches nothing; listed so the key set
  // mirrors the rect's rule).
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

  // A selection up, no drag: Esc drops it — under the three guards the header
  // of #onKeyDown spells out, and without preventDefault. Anything else
  // passes untouched.
  #onSelectionUpKey(e) {
    if (e.key !== 'Escape') return;
    if (!this.active) return; // the ACTIVE window's selection only
    if (document.querySelector('vf-dialog[open]')) return; // the modal owns Esc
    const target = e.composedPath ? e.composedPath()[0] : e.target;
    const tag = target && /** @type {Element} */ (target).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    this.#dropSelection();
  }

  // Releasing Shift mid-drag drops the square-lock (rect) or the axis lock
  // (selection move) and re-derives the free box / offset.
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
  // erase under a right-click / the eraser tool (lib/brush.js primitives).
  #writeColor() {
    const paint = !this.#forceErase && this.tool !== 'eraser';
    return paint
      ? { r: this.ink.r, g: this.ink.g, b: this.ink.b, a: 255 }
      : { r: 0, g: 0, b: 0, a: 0 };
  }

  // The N×N tip a stroke (or its hover preview) uses right now: the eraser
  // carries its own size setting; every other stroking state is the pencil's.
  get #tipSize() {
    return this.tool === 'eraser' ? this.eraserSize : this.pencilSize;
  }

  // …and its shape, the same split: the eraser's own popup setting under
  // the eraser tool, the pencil's for every other stroke (a right-button
  // pencil stroke erases with the same disc it would paint).
  get #tipShape() {
    return this.tool === 'eraser' ? this.eraserShape : this.pencilShape;
  }

  // Is the footprint under the pointer an erasing one — the eraser tool's, or
  // any stroke's under the right button (the momentary erase)?
  get #erasing() {
    return this.tool === 'eraser' || this.#forceErase;
  }

  // Does the cursor layer wear the ants right now — an erasing footprint
  // under the pointer, the eyedropper's sample target, or a rect drag
  // erasing? The one ticker marches whichever ring is up: this one, or the
  // selection's on its own layer.
  get #cursorAntsUp() {
    if (this.#rectDragging) return this.#forceErase;
    return !!this.#hoverTexel && (this.#erasing || this.tool === 'eyedropper');
  }

  // Start or stop the ticker on demand — called wherever a ring appears or
  // goes (every hover redraw, a rect drag's begin / end / cancel, a
  // reconnect). Stopping resets the phase, so every ring starts at the seam.
  #syncAnts() {
    if (this.#sel || this.#cursorAntsUp) this.#startAnts();
    else this.#stopAnts();
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

  // --- overlays ---------------------------------------------------------------
  // The system-px view the overlay painters (draw-overlays.js) draw in — the
  // backings are system-res, so painter space IS the kit's pixel grid.
  get #overlayView() {
    return {
      tileW: this.tileW,
      tileH: this.tileH,
      scale: this.#texelSys,
      sysW: this.#sysW,
      sysH: this.#sysH,
    };
  }

  // The hover preview on the topmost overlay, under the cursor: the pencil fills
  // the exact texels a stamp would paint with the active ink (WYSIWYG — the OS
  // crosshair marks the position) — the box, or the circle tip's disc; an
  // ERASING footprint — the eraser tool's,
  // or the pencil's under a right button (the momentary erase, for the
  // stroke's length) — is the erase treatment, the marching ants around the
  // texels the tip would clear (draw-overlays.js drawFootprintAnts, at the
  // ticker's phase — the tip's own outline, a circle tip's disc ringed as a
  // disc); the eyedropper wears the same ring around the single
  // cell it would sample. Cleared with t == null when the pointer leaves the
  // canvas. Only these have a hover preview — the rect tool relies on the OS
  // crosshair when idle and its own drag preview when dragging — so for any
  // other tool this just clears the overlay. Every call re-syncs the ants
  // ticker: it runs while a ring is up (a selection's, an erase preview's,
  // the sampler's target), never otherwise.
  #drawCursor(t) {
    this.#hoverTexel = t;
    const g = this.#cursorCtx;
    if (!g) return;
    if (this.tool === 'eyedropper') {
      drawFootprintAnts(g, this.#overlayView, t, 1, this.#antsPhase);
    } else if (this.#erasing) {
      drawFootprintAnts(
        g,
        this.#overlayView,
        t,
        this.#tipSize,
        this.#antsPhase,
        this.#tipShape // the ring is the tip's own outline: a disc for a circle tip
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

  // Live preview of the rect on the cursor overlay: the exact filled texels in
  // the active ink at full opacity — the box as the release would paint it and
  // nothing more (no outline: the 50% tint under a haloed hairline bounding box
  // went Sep 5 2026; the paint itself is the extent's readout, the pencil's
  // hover idiom). Erasing (a right-drag) wears the erase treatment — the ants
  // around the box, at the ticker's phase. Nothing is written to `#work`
  // until #commitRect() on pointer-up.
  #drawRectPreview() {
    // Every change to the box routes through a preview redraw (the press, a
    // corner move, Shift down / up, the ?rect hook) — so the readout's report
    // rides here, ahead of the overlay (a re-fit's redraw reports nothing
    // new: the emit dedupes on the box's value).
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
    // The box wrote nothing — drop its undo capture without emitting.
    this.#gestureBefore = null;
    this.#gestureChanged = false;
    this.#cursorCtx?.clearRect(0, 0, this.#sysW, this.#sysH);
    this.#syncAnts(); // an erasing drag's ring went with it
    this.#notifyRectDrag(); // …and the readout's box
    if (this.#rectPointer != null) {
      this.#canvas.value?.releasePointerCapture?.(this.#rectPointer);
      this.#rectPointer = null;
    }
  }

  // Report the rect drag's box to the container — the box as the release
  // would paint it while a drag is in flight, null otherwise — only when it
  // actually changed (a same-texel move, a re-fit's redraw report nothing),
  // so the per-context store downstream sees one patch per real change:
  // #notifySelection's discipline for the other outline.
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

  // Redraw the top (cursor) overlay for the current state: the rect drag preview
  // while dragging, else the pencil hover footprint (a no-op clear for the idle
  // rect tool). Used by #layout() and by updated() so a re-fit or a tool/ink change
  // repaints the right thing, by the ants ticker while the cursor layer wears
  // a ring — an erase preview, the sampler's target — (it marches through
  // this), and by a stroke's release (a
  // right-button stroke's ring leaves with the button).
  #redrawCursorLayer() {
    if (this.#rectDragging) this.#drawRectPreview();
    else this.#drawCursor(this.#hoverTexel);
  }

  // --- the selection ------------------------------------------------------------
  // The CURRENT selection rectangle: the lift origin shifted by the float's
  // offset — what the ants draw and what a press hit-tests against. May hang
  // off the tile (the ants layer clips it; the composite clips per texel).
  get #selRect() {
    return this.#sel
      ? translateBounds(this.#sel, this.#selOffset.dx, this.#selOffset.dy)
      : null;
  }

  // The outline the world sees: the current rectangle — except a marquee
  // press that hasn't become a drag yet (#selMoved), which is a click in
  // progress, not a selection (nothing drawn, nothing reported).
  get #selOutline() {
    const b = this.#selRect;
    if (b && this.#selDrag === 'marquee' && !this.#selMoved) return null;
    return b;
  }

  // Has a marquee press become a drag: the pointer past SELECT_SLOP from
  // where it went down, or on a texel other than the anchor (a 1-px texel
  // can change under a sub-slop move)?
  #marqueeMoved(e, t) {
    const p = this.#selPress;
    const a = this.#selAnchor;
    return (
      (!!p &&
        Math.max(Math.abs(e.clientX - p.x), Math.abs(e.clientY - p.y)) > SELECT_SLOP) ||
      (!!a && (t.px !== a.px || t.py !== a.py))
    );
  }

  // Report the outline to the container — only when it actually changed
  // (a same-texel move, an ants tick, a re-fit report nothing), so the
  // per-context selection store downstream sees one patch per real change.
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

  // Lift the marquee's texels out ONCE (the first move press): the float is a
  // copy of the rect with its opaque count, the base is the buffer with the
  // rect cleared to transparency — pristine for the selection's whole life,
  // so every offset is a pure function of (base, float, offset).
  #liftSelection() {
    this.#selFloat = liftRect(this.#work, this.tileW, this.#sel);
    this.#selBase = this.#work.slice();
    clearRect(this.#selBase, this.tileW, this.#sel);
  }

  // #work ← base, then the float's OPAQUE texels at the current offset —
  // written IN PLACE (never `#work = …`): the doc holds this buffer by
  // reference, and a fresh one would silently detach it from the screen.
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

  // The selection tool's press: inside the current selection starts a MOVE
  // (lifting on the first one); anywhere else drops what's up and starts a
  // MARQUEE. Primary button only — a right-click does nothing with this tool
  // (there is nothing to erase with), and a second concurrent pointer never
  // hijacks a drag (the rect's rule).
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
    this.#drawAnts(); // draws nothing yet: a press is a click until it moves
  }

  // Release: a press that never became a drag is a CLICK, not a selection
  // (which is also what "click outside to deselect" means — the drop already
  // happened on the press); a drag becomes the selection — the anchor to the
  // release texel inclusive, ONE texel the smallest (a wiggle inside it) —
  // ants marching. The release point counts toward the slop too, so a press
  // and release with no move event between still reads by where it landed.
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

  // Abort a marquee in flight (Esc, pointercancel, a tool letter): as the
  // click case — no selection.
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

  // Grab the float: lift on the first move, open the undo bracket (`before`
  // is the buffer as it is now — the composite at the current offset, or the
  // untouched art), remember where the offset stood, capture the pointer.
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

  // One pointer texel → the float's offset: the drag delta from the grab
  // texel (axis-locked under Shift) on top of the offset at the grab. A
  // same-texel move is no churn. An EMPTY float (opaque 0 — a marquee over
  // empty space, a derived face) moves only its marquee: it can never change
  // a byte, so it must not composite, dirty the buffer, fire sm-live or
  // trigger a rebuild per pointer move — the guard IS the derived-face
  // special case.
  //
  // FUTURE — THE REGISTERED MOVE ("on all faces", the fill tool's idiom; a
  // planned follow-up, not a maybe). Today a move edits THIS face alone,
  // which breaks the carve's registration: the front face's roof shifted +6
  // columns no longer lines up with the top face's, so the voxels the two
  // agreed on vanish. A marquee on one face is really a SLAB of voxels —
  // a FRONT rect (columns x0..x1, rows y0..y1) is those columns across the
  // whole depth on TOP/BOTTOM and those rows across the whole depth on
  // LEFT/RIGHT, with BACK the mirror of FRONT — so the registered move is
  // well-defined: a +dx on FRONT shifts TOP's and BOTTOM's columns x0..x1
  // (every row) by dx and BACK's mirrored columns by −dx, the sides
  // untouched (x is their depth axis); a +dy shifts LEFT's, RIGHT's and
  // BACK's rows y0..y1 (every column) by dy, TOP/BOTTOM untouched. The
  // per-face bounds and deltas come from lib/views.js's axis mappings
  // (VIEW_IMAGE_AXES — the table the sheet resize registers by); the
  // per-face edit is lib/select.js's lift / clear / composite
  // over each face's own slice; the undo is ONE whole-atlas snapshot
  // (history.withAtlasSnapshot) rather than a tile entry; and the live
  // preview during the drag stays THIS face's (the other faces land at
  // release through doc.replaceAllTiles-style structural write, like the
  // all-faces fill). A session checkbox (`moveAllFaces`) in the strip is the
  // control. Nothing about the single-face move above changes shape for it.
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
      this.#commitPixels(); // dirty + changed + repaint + sm-live
    }
    this.#drawAnts();
    this.#notifySelection();
  }

  // Release: close the undo bracket (sm-commit iff a byte changed — a drag
  // that returned exactly to its start emits a pair the history drops as
  // identical anyway). The selection stays up, FLOATING: the next drag inside
  // starts from this offset over the same base and float.
  #endMove() {
    this.#endGesture();
    this.#releaseSelPointer();
    this.#selDrag = null;
    this.#selShift = false;
    this.#drawAnts();
  }

  // Abort a move in flight: the offset reverts to where the press landed and
  // the buffer re-composites there — through #repaint + #notifyLive DIRECTLY,
  // never #commitPixels (that would mark the gesture changed and #endGesture
  // would then record an undo entry for a gesture that ended where it
  // began); then the capture drops without emitting (the #cancelRect idiom).
  // The selection stays floating at its pre-drag offset.
  #cancelMove() {
    if (this.#selDrag !== 'move') return;
    const g = this.#selOffsetAtGrab;
    if (this.#selOffset.dx !== g.dx || this.#selOffset.dy !== g.dy) {
      this.#selOffset = { ...g };
      if (this.#selFloat.opaque > 0) {
        this.#compositeSelection();
        this.#repaint();
        this.#notifyLive(); // the live channel must see the bytes go back
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

  // The one exit: cancel any drag in flight, then forget. It writes nothing —
  // #work already holds the composite (the last move gesture committed it),
  // so a drop is purely forgetting. Called from a press outside the
  // selection, the selection-up Esc, and willUpdate's tool-change branch
  // (#resetWorking nulls the fields directly — nothing to revert into a
  // buffer being replaced).
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

  #releaseSelPointer() {
    if (this.#selPointer != null) {
      this.#canvas.value?.releasePointerCapture?.(this.#selPointer);
      this.#selPointer = null;
    }
  }

  // The ants on their own layer: the current rectangle at the current phase.
  // A marquee press that hasn't become a drag draws NOTHING — a click never
  // flashes a one-texel box; the ants appear the moment the press moves past
  // the slop or onto another texel, a one-texel box included.
  #drawAnts() {
    const g = this.#antsCtx;
    if (!g) return;
    drawMarchingAnts(g, this.#overlayView, this.#selOutline, this.#antsPhase);
  }

  #clearAnts() {
    this.#antsCtx?.clearRect(0, 0, this.#sysW, this.#sysH);
  }

  // The ticker runs only while a ring is up — a selection's, or the cursor
  // layer's: an erase preview, the eyedropper's target (idle costs nothing);
  // each tick advances the phase and re-strokes whichever ring is showing:
  // the selection's on its layer, the cursor layer's through its own redraw.
  // Under the OS's reduce-motion preference, or the ?select hook's static
  // flag, the ants draw once at phase 0 and stand still.
  #startAnts() {
    if (this.#antsTimer != null) return;
    if (this.#antsStatic || prefersReducedMotion()) return;
    this.#antsTimer = setInterval(() => {
      this.#antsPhase = (this.#antsPhase + 1) % ANTS_PERIOD;
      if (this.#sel) this.#drawAnts();
      if (this.#cursorAntsUp) this.#redrawCursorLayer();
    }, ANTS_MS);
  }

  #stopAnts() {
    if (this.#antsTimer != null) clearInterval(this.#antsTimer);
    this.#antsTimer = null;
    this.#antsPhase = 0;
  }

  // The kit's page-drawn cursor: the arrow over a selection (you're about to
  // grab it), the crosshair elsewhere — MacPaint's reading. Flipped on the
  // pixel canvas's own claim attribute, imperatively (a bound attribute would
  // put a pointer-move-rate value on the reactive path), and only when it
  // differs (a setAttribute per move would be churn). The kit resolves the
  // claim by hit-test on the NEXT pointer move (its observer can't see into
  // this shadow root), so a flip lands a frame later — invisible in motion,
  // and a reset with the pointer still shows when it next moves. Accepted.
  #setCursorClaim(kind) {
    const c = this.#canvas.value;
    if (c && c.getAttribute('data-vf-cursor') !== kind)
      c.setAttribute('data-vf-cursor', kind);
  }

  // --- sampling + fill ---------------------------------------------------------
  // An eyedrop: report what was hit — a painted texel's color, or empty space
  // (which the container maps to the eraser tool: sampling emptiness hands you
  // the eraser). The resulting prop changes redraw the hover footprint via
  // updated().
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

  // The ink a fill lays down: the active color, or transparent under a
  // right-click — mirrors the pencil / rect erase rule.
  #fillInk(rightClick) {
    return rightClick
      ? { transparent: true }
      : { r: this.ink.r, g: this.ink.g, b: this.ink.b };
  }

  // Apply a fill to THIS tile's working buffer: a contiguous flood from (t), or —
  // with contiguous OFF — a whole-tile recolor of every texel matching the clicked
  // color. Repaints + notifies like any stroke if anything changed. This is the
  // whole op for the single-tile modes; the on-all-faces mode delegates instead
  // (below).
  #applyLocalFill(t, rightClick) {
    const fill = this.#fillInk(rightClick);
    const i0 = (t.py * this.tileW + t.px) * 4;
    const changed = this.fillContiguous
      ? floodFill(this.#work, this.tileW, this.tileH, t.px, t.py, fill)
      : replaceColor(this.#work, keyAt(this.#work, i0), fill);
    if (changed) this.#commitPixels();
  }

  // Route a fill click. Contiguous OFF + "on all faces" hands the whole op to the
  // caller (it recolors the clicked color across every tile and re-points this
  // editor); the target color is read from the clicked texel here so the caller
  // doesn't have to. Every other mode fills this tile in place.
  #doFill(t, rightClick) {
    if (!this.fillContiguous && this.fillAllFaces) {
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
    // The selection tool: a move press inside the selection, a marquee
    // press anywhere else (the Alt-sample above still works with it — and an
    // Alt-sample of emptiness selects the eraser, a tool change that drops
    // the selection through willUpdate).
    if (this.tool === 'select') {
      this.#onSelectDown(e, t);
      return;
    }
    if (this.tool === 'fill') {
      // Single click — no drag, no pointer capture; the whole gesture is
      // synchronous (the on-all-faces path writes nothing locally, so its
      // capture drops silently — the container snapshots the atlas instead).
      this.#beginGesture();
      this.#doFill(t, e.button === 2);
      this.#endGesture();
      return;
    }
    if (this.tool === 'rect') {
      // A real drag owns exactly one pointer; a second concurrent pointer (a stray
      // finger on a touch screen) must not hijack it. The ?rect dev-hook leaves a
      // phantom drag with no owner (#rectPointer null), which a real down may take over.
      if (this.#rectDragging && this.#rectPointer != null) return;
      this.#forceErase = e.button === 2;
      this.#shiftLock = e.shiftKey; // Shift held at press → start square-locked
      this.#beginGesture();
      this.#rectDragging = true;
      this.#rectStart = t;
      this.#rectEnd = t;
      this.#rectPointer = e.pointerId;
      this.#canvas.value.setPointerCapture?.(e.pointerId);
      this.#drawRectPreview();
      this.#syncAnts(); // an erasing drag's ring marches from the press
      return;
    }
    // The pencil and the eraser share the stroke path — #writeColor() decides
    // whether the run lays ink or transparency.
    this.#forceErase = e.button === 2;
    this.#beginGesture();
    this.#drawing = true;
    this.#prev = null;
    this.#canvas.value.setPointerCapture?.(e.pointerId);
    this.#stroke(t.px, t.py);
    this.#drawCursor(t); // the footprint follows the button: a right press wears the ants at once
  };

  #onPointerMove = (e) => {
    if (this.#selDrag) {
      // Only the drag-owning pointer moves the marquee's corner or the float
      // (the rect's rule); the corner is clamped so a past-the-edge drag pins
      // to the tile, and so the float's grab texel can never leave it — the
      // float itself may hang off, clipped at drop time.
      if (e.pointerId !== this.#selPointer) return;
      const t = this.#toTexelClamped(e);
      if (this.#selDrag === 'marquee') {
        // A press becomes a marquee the moment it moves past the slop or
        // onto another texel; until then it is a click in progress.
        if (!this.#selMoved) this.#selMoved = this.#marqueeMoved(e, t);
        this.#sel = normalizeBounds(this.#selAnchor, t);
        this.#drawAnts();
        this.#notifySelection();
      } else {
        this.#selLast = t;
        this.#selShift = e.shiftKey; // track Shift held during the drag
        this.#applyMove(t, e.shiftKey);
      }
      return;
    }
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
    // The selection tool's hover: the arrow inside the selection, the
    // crosshair outside (its cursor layer stays clear — the ants live on
    // their own layer, so #drawCursor below is just the clear).
    if (this.tool === 'select') {
      const cur = this.#selRect;
      this.#setCursorClaim(
        cur && t && boundsContain(cur, t.px, t.py) ? 'arrow' : 'crosshair'
      );
    }
    this.#drawCursor(t); // keep the footprint preview under the cursor (hover + drag)
    if (!this.#drawing || !t) return;
    this.#stroke(t.px, t.py);
  };

  #onPointerUp = (e) => {
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
      this.#canvas.value.releasePointerCapture?.(this.#rectPointer); // the owner
      this.#rectPointer = null;
      this.#cursorCtx.clearRect(0, 0, this.#sysW, this.#sysH); // commit is on `#work`
      this.#syncAnts(); // an erasing drag's ring went with it
      this.#notifyRectDrag(); // …and the readout's box: the strip reads 0 × 0 again
      return;
    }
    this.#endGesture();
    this.#drawing = false;
    this.#prev = null;
    this.#forceErase = false;
    this.#canvas.value.releasePointerCapture?.(e.pointerId);
    this.#redrawCursorLayer(); // a right-button stroke's ring leaves with the button
  };

  // pointercancel (gesture interrupted) discards an in-flight rect rather than
  // committing a box the user didn't finish, and cancels a selection drag
  // the same way (a marquee vanishes, a move reverts to its grab); a pencil
  // stroke is already committed (its pixels stay, so its undo entry still
  // lands).
  #onPointerCancel = (e) => {
    if (this.#selDrag) {
      if (e.pointerId !== this.#selPointer) return; // a non-owner can't abort the drag
      if (this.#selDrag === 'marquee') this.#cancelMarquee();
      else this.#cancelMove();
      return;
    }
    if (this.#rectDragging) {
      if (e.pointerId !== this.#rectPointer) return; // a non-owner can't abort the drag
      this.#cancelRect();
      return;
    }
    this.#endGesture();
    this.#drawing = false;
    this.#prev = null;
    this.#forceErase = false;
    this.#canvas.value.releasePointerCapture?.(e.pointerId);
    this.#redrawCursorLayer(); // as the release: the ring leaves with the button
  };

  // Clear the pencil hover footprint when the pointer leaves — but not mid
  // rect or selection drag (capture keeps the events coming; the preview must
  // survive an edge cross — with the pointer captured a mid-move leave fires
  // only on a release outside). The selection tool's cursor claim returns to
  // the crosshair too, so re-entry starts honest.
  #onPointerLeave = () => {
    if (this.#rectDragging || this.#selDrag) return;
    this.#drawCursor(null);
    if (this.tool === 'select') this.#setCursorClaim('crosshair');
  };

  #onContextMenu = (e) => e.preventDefault(); // right-click = erase
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-draw-canvas'))
  customElements.define('sm-draw-canvas', SmDrawCanvas);
