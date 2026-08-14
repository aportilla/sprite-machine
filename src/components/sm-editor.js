// ---------------------------------------------------------------------------
// <sm-editor> — the tools panel (LEFT half of the workspace): a pixel editor for
// one atlas face, drawn with the `vintage-frames` System 7 web component kit.
// Permanently docked — a face is always selected; the 3D view stays live +
// interactive on the right. No imports from the voxel pipeline.
//
// A LitElement rendering into the LIGHT DOM (`createRenderRoot() { return this }`)
// so style.css's `.editor-*` rules and `capture.sh dom` keep working untouched;
// style.css gives the host `display: contents`, so the box tree is exactly the
// `.editor` column it wraps.
//
// The panel is a fixed flex column:
//   1. SETTINGS row (top, fixed): the TILE-SIZE number field (little-arrows
//      stepper) and the FACE PICKER — six pixel-art cube-view icons (vf-img)
//      over a vf-radio-group.
//   2. A dotted separator.
//   3. MAIN area (grows): a left RAIL — the TOOL STRIP (pencil / rect / fill /
//      eyedropper as a 1-column vf-grid of cells; the selected tool inverts)
//      over the COLOR WELL group: the current-ink vf-swatch (a click opens the
//      256-color picker dialog), the LAST THREE USED colors below it, and a
//      transparent checker swatch (the empty / clear "color") — beside the
//      DRAW BOX: a bordered column of the per-tool OPTIONS bar (the pencil's
//      tip-size vf-slider; the rect's corner-radius vf-number-field; the fill's
//      two vf-checkboxes) over the dark artwork well holding the pixel canvas.
//
// The 256-color picker is a vf-dialog holding a 16×16 vf-grid of vf-swatch
// cells, rendered lazily (the 256 cells are only built once the dialog is first
// opened) and driven by the `pickerOpen` boolean — its native <dialog> is
// top-layer, so living in our own template can never clip it.
//
// STATE SPLIT — the correctness core. What the TEMPLATE reads is either a
// reactive property (assigned by main.js) or the shared `session` store slice
// (bridged by a StoreController, so any action re-renders this element);
// everything the canvas hot paths touch is a plain `#private` field, so a
// pencil drag can never schedule a template re-render at pointer-move rate:
//
//   reactive props (static properties)    plain fields (never re-render)
//   ----------------------------------    ------------------------------
//   face, tile, tileW/tileH, guides,      #work / #imgData / #dirty (the pixel
//   mirrorBehind, faces, palette,         buffer — #work is shared BY REFERENCE
//   palette256, sizeMin/sizeMax           with #imgData, so it must never be
//                                         diffed or copied), #drawing, #prev,
//   session slice (read via getters:      #forceErase, #hoverTexel, the rect
//   tool, ink, erase, picking, recent,    drag state, the layout geometry
//   pencilSize, cornerRadius,             (#scale/#cssW/#cssH), refs, contexts
//   fillReplace, fillAllTiles,
//   pickerOpen — writes are ACTIONS)
//
// Every stroke is HARD-pixel (alpha 0 or 255) so downstream ingest (alpha>=128)
// and atlas.isBlank (alpha!==0) can never diverge.
//
// ONE ELEMENT, FOREVER. main.js creates a single <sm-editor> on the first build
// and never destroys it: a face swap, a tile resize and an all-tiles replace are
// property assignments, and `willUpdate` re-derives the working buffer (and drops
// any in-flight gesture) when `face` / `tile` / `tileW` / `tileH` change. Because
// the element persists, so does everything it owns — the tool, the ink, the
// recency row, the per-tool options and the tile field's keyboard focus — with no
// caller-owned "brush" bag and no focus-restore hack to carry them across.
//
// PROPERTIES (assigned by main.js; the element re-derives on any change)
//   - face: which of the six atlas faces is being edited.
//   - tile / tileW / tileH: the face's art and the (square) tile geometry.
//   - mirrorBehind: {width,height,data} onion-skin of the opposite face drawn
//     faded UNDER the pixel canvas (display only — never written to `#work`).
//     null when the opposite face has no art of its own. A mirror-derived face
//     opens with an EMPTY canvas and this faded mirror as its only reference.
//   - guides: from faceGuides() — extent of the orthogonal faces' pixels, drawn
//     as hairline rules over the canvas so you can align to the stricter carve.
//   - faces: the ordered list of all six atlas faces, shown in the face picker;
//     the edited `face` is the checked radio and picking another switches.
//   - palette: the DB16 ramp — no longer displayed; it seeds the default ink.
//   - palette256: the full 256-color editor palette ({ css, rgb }[]) shown in
//     the picker dialog as a 16x16 grid. It arrives already laid out along a
//     Hilbert curve (constants.js PALETTE_256), so iterating it row-major
//     clusters similar colors both across and down — this editor never reorders it.
//   - sizeMin/sizeMax: inclusive integer bounds for the TILE-size field.
//   - openPaletteOnMount: dev hook (?palette=1) — open the color-picker dialog
//     immediately so headless screenshots (which can't click the swatch) show it.
//   - previewCursor: dev hook (?cursor=N) — set the pencil size to N and draw its
//     footprint outline at the tile center on mount, so a headless shot (which has
//     no pointer to hover) can show the preview.
//   - previewRect: dev hook (?rect=x0,y0,x1,y1[,r[,sq]]) — select the rect tool and
//     draw its live drag preview for that box (radius r; sq=1 for the Shift square-
//     lock) on mount, so a headless shot (which can't drag) can show the tool
//     mid-drag.
//   - pickIndex: dev hook (?pick=N) — select palette256[N] as the ink on mount, as
//     if picked from the dialog, so a headless shot (which can't click a swatch) can
//     show it landing as the current-ink swatch.
//   - fillOnMount: dev hook (?fill=x,y[,r[,a]]) — select the fill tool, set its two
//     checkboxes (replace=r, all-tiles=a), and perform a fill at (x,y) on mount, so a
//     headless shot (which can't click) can show the tool + result. The mount fill is
//     always applied LOCALLY (to this tile only) even with a=1 — a single editor shot
//     shows only the current tile anyway, and a local fill avoids a re-mount mid-mount.
//
// EVENTS (bubbling CustomEvents; main.js listens on the dock)
//   - sm-live        { tile, dirty }   fired on each actual pixel change.
//   - sm-select-face { face }          the user picked another face.
//   - sm-resize-tile { size }          the user changed the tile size. Tiles are
//       locked SQUARE, so the caller resizes the whole atlas to size×size
//       (CENTERED — see resizeAtlas anchor:'center') and re-mounts.
//   - sm-replace-all-tiles { target, fill }   the user committed a fill with BOTH
//       the "replace" and "all tiles" checkboxes on. `target`/`fill` are color keys
//       ({transparent:true} | {r,g,b}); the caller replaces every `target` texel with
//       `fill` across the whole atlas sheet. The single-tile fill modes (contiguous
//       flood, or whole-tile replace) never fire this — they mutate the working tile
//       directly and fire sm-live like any stroke.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { LitElement, html, nothing } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { live } from 'lit/directives/live.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { repeat } from 'lit/directives/repeat.js';
import { createRef, ref } from 'lit/directives/ref.js';
import '../icons.js'; // registers the <sp-icon-*> tool glyphs used below
import { faceIcon } from '../face-icons.js';
import { roundedRectRows, maxCornerRadius, squareEnd } from '../lib/rect.js';
import { keyAt, floodFill, replaceColor } from '../lib/fill.js';
import { rgbKey } from '../lib/color.js';
import { session, RECENT_SLOTS } from '../state/session.js';
import { StoreController } from '../state/store-controller.js';

// The pixel-canvas CONTAINER fills the draw box below the options bar (CSS
// flex:1), so the canvas grows to consume whatever height the fixed settings row
// (top) leaves. Its height is CSS-driven — no JS pin — so nothing shifts as the
// tile size (and thus the drawn canvas) changes. The square canvas is centered
// inside at the largest integer texel scale that fits.

// Hairline extent rules: translucent cyan so they read as guides distinct from
// the sprite art. MIRROR_ALPHA keeps the onion-skin a faint hint.
const GUIDE_COLOR = 'rgba(120, 200, 255, 0.6)';
const MIRROR_ALPHA = 0.22;

// The four tool glyphs, as module-constant templates: a TemplateResult diffs to
// a no-op, where a freshly built element would make lit swap the icon on every
// re-render.
const ICON_DRAW = html`<sp-icon-draw></sp-icon-draw>`;
const ICON_RECT = html`<sp-icon-rectangle></sp-icon-rectangle>`;
const ICON_FILL = html`<sp-icon-color-fill></sp-icon-color-fill>`;
const ICON_SAMPLER = html`<sp-icon-sampler></sp-icon-sampler>`;

// Draw the four "furthest extent" hairlines into an OVERLAY context sized to the
// on-screen canvas (screen-res so the 1px lines stay crisp regardless of scale).
// The lines box the region where a painted pixel can survive the carve: verticals
// at the outer edges of the supported columns, horizontals at the supported rows.
function drawGuides(g, guides, scale, cssW, cssH) {
  g.clearRect(0, 0, cssW, cssH);
  if (!guides) return;
  const { uMin, uMax, vMin, vMax } = guides.extent;
  g.fillStyle = GUIDE_COLOR;
  const T = 1; // hairline thickness (screen px)
  if (uMin != null) g.fillRect(uMin * scale, 0, T, cssH); // left extent
  if (uMax != null) g.fillRect((uMax + 1) * scale - T, 0, T, cssH); // right extent
  if (vMin != null) g.fillRect(0, vMin * scale, cssW, T); // top extent
  if (vMax != null) g.fillRect(0, (vMax + 1) * scale - T, cssW, T); // bottom extent
}

const toHex2 = (n) => n.toString(16).padStart(2, '0');
const rgbHex = ({ r, g, b }) => `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;

export class SmEditor extends LitElement {
  static properties = {
    // --- inputs (main.js owns these) ---------------------------------------
    face: {},
    tile: { attribute: false },
    tileW: { type: Number },
    tileH: { type: Number },
    palette: { attribute: false },
    palette256: { attribute: false },
    mirrorBehind: { attribute: false },
    guides: { attribute: false },
    faces: { attribute: false },
    sizeMin: { type: Number },
    sizeMax: { type: Number },
  };

  // NEVER declare a reactive property as a class field — the field would shadow
  // the accessor `static properties` installs and silently kill reactivity.
  constructor() {
    super();
    this.face = '';
    this.tile = null;
    this.tileW = 0;
    this.tileH = 0;
    this.palette = [];
    this.palette256 = [];
    this.mirrorBehind = null;
    this.guides = null;
    this.faces = null;
    this.sizeMin = 1;
    this.sizeMax = 64;

    // The shared editor-session slice holds the brush state (tool, ink,
    // recency, per-tool options, picker flag); this controller re-renders the
    // element on any session action. The getters below read it, so the
    // template and gesture code keep their `this.tool` / `this.ink` reads.
    new StoreController(this, session.store);

    // Dev hooks (plain: consumed once on mount, never re-read).
    this.openPaletteOnMount = false;
    this.previewCursor = null;
    this.previewRect = null;
    this.pickIndex = null;
    this.fillOnMount = null;
  }

  // --- session reads ---------------------------------------------------------
  // The brush state lives in the session slice; these getters keep every
  // existing template / gesture read (`this.tool`, `this.ink`, …) working
  // verbatim. There are deliberately no setters — every write is a session
  // ACTION, so an accidental assignment throws instead of silently forking.
  get tool() {
    return session.get().tool;
  }
  get ink() {
    return session.get().ink;
  }
  get erase() {
    return session.get().erase;
  }
  get picking() {
    return session.get().picking;
  }
  get recent() {
    return session.get().recent;
  }
  get pencilSize() {
    return session.get().pencilSize;
  }
  get cornerRadius() {
    return session.get().cornerRadius;
  }
  get fillReplace() {
    return session.get().fillReplace;
  }
  get fillAllTiles() {
    return session.get().fillAllTiles;
  }
  get pickerOpen() {
    return session.get().pickerOpen;
  }

  // --- plain fields: the pixel buffer, gesture state, on-screen geometry -----
  #work = null; // Uint8ClampedArray of the working tile — shared with #imgData
  #workingTile = null; // { width, height, data:#work } handed out with sm-live
  #imgData = null; // ImageData VIEW over #work (by reference — never re-copied)
  #dirty = false; // has the user actually changed a pixel this mount?

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

  #pickerBuilt = false; // the dialog's 256 cells exist once it has been opened
  #cursorState = null; // last-seen session keys the cursor overlay depends on
  #stateHooksDone = false; // the dev hooks' reactive half ran (willUpdate)
  #drawHooksDone = false; // the dev hooks' canvas half ran (updated)

  createRenderRoot() {
    return this; // light DOM — style.css + `capture.sh dom` keep working
  }

  // --- derived bounds --------------------------------------------------------
  // The pencil tip is capped at the tile edge (a single stamp can't exceed the
  // canvas); the rect's corner radius at half the shorter tile side (the biggest a
  // full-tile rect could use — a per-rect clamp in roundedRectRows handles smaller
  // rects). Both are re-derived from the live tile, so a shrink clamps a persisted
  // value down.
  get #brushMax() {
    return Math.max(1, Math.min(this.tileW || 1, this.tileH || 1));
  }
  get #radiusMax() {
    return maxCornerRadius(this.tileW || 1, this.tileH || 1);
  }

  // --- lifecycle -------------------------------------------------------------
  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('keydown', this.#onKeyDown);
    document.addEventListener('keyup', this.#onKeyUp);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // The key listeners aren't on this element, so drop them explicitly.
    document.removeEventListener('keydown', this.#onKeyDown);
    document.removeEventListener('keyup', this.#onKeyUp);
    this.#resizeObs?.disconnect();
    this.#resizeObs = null;
  }

  willUpdate(changed) {
    const geom =
      changed.has('tileW') ||
      changed.has('tileH') ||
      changed.has('tile') ||
      changed.has('face');

    // A tile resize can leave a persisted pencil size / corner radius past the
    // new bounds — the clamp itself lives in the session action.
    if (changed.has('tileW') || changed.has('tileH')) {
      session.clampTools(this.#brushMax, this.#radiusMax);
    }

    // The re-mount, relocated: a new face / tile geometry means a fresh working
    // buffer (+ its ImageData view) and no gesture carried over from the old one.
    if (geom) this.#resetWorking();

    if (!this.#stateHooksDone) {
      this.#stateHooksDone = true;
      this.#applyStateHooks();
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
    const geom =
      changed.has('tileW') ||
      changed.has('tileH') ||
      changed.has('tile') ||
      changed.has('face');
    // Canvas backing stores + the ImageData that shares `#work` are paired: they
    // are reconstructed together, imperatively, never bound in the template (a
    // template-bound width/height would clear the backing store mid-diff).
    if (geom) this.#applyGeometry();
    else if (changed.has('mirrorBehind')) this.#paintMirror();
    if (!geom && changed.has('guides')) this.#drawGuidesLayer();

    // The cursor overlay is canvas-drawn, so the state the template can't express
    // has to be re-stroked here. Session keys don't appear in lit's `changed`
    // map (they aren't reactive properties), so diff a snapshot of the keys the
    // overlay depends on instead.
    const s = session.get();
    const cs = this.#cursorState;
    if (
      !cs ||
      cs.tool !== s.tool ||
      cs.erase !== s.erase ||
      cs.picking !== s.picking ||
      cs.pencilSize !== s.pencilSize ||
      cs.cornerRadius !== s.cornerRadius
    ) {
      this.#cursorState = {
        tool: s.tool,
        erase: s.erase,
        picking: s.picking,
        pencilSize: s.pencilSize,
        cornerRadius: s.cornerRadius,
      };
      this.#redrawCursorLayer();
    }

    if (!this.#drawHooksDone) {
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

  // --- dev hooks (consumed once on mount) ------------------------------------
  // Split in two: the half that sets reactive state runs in willUpdate (so it is
  // part of the first render, not a second update scheduled from updated()), the
  // half that paints a canvas overlay runs after the geometry is laid out.
  #applyStateHooks() {
    if (this.previewCursor) session.setPencilSize(this.previewCursor, this.#brushMax);
    // ?pick=N runs before the ?palette=1 open (so the dialog reflects it) and
    // before ?fill (so ?pick=N&fill=x,y fills with palette color N).
    if (this.pickIndex != null && this.palette256?.[this.pickIndex]) {
      this.#selectColor(this.palette256[this.pickIndex].rgb);
    }
    if (this.openPaletteOnMount) this.#openPicker();
    if (this.previewRect) {
      // Modeled as an active drag with no captured pointer, so the preview survives
      // a re-layout and pressing ESC still demonstrates cancel.
      session.setTool('rect');
      if (this.previewRect.r != null) {
        session.setCornerRadius(this.previewRect.r, this.#radiusMax);
      }
    }
    if (this.fillOnMount) {
      session.setTool('fill'); // a fill paints, not erases (clears erase/picking)
      session.setFillReplace(this.fillOnMount.replace);
      session.setFillAllTiles(this.fillOnMount.all);
    }
  }

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
  render() {
    return html`
      <div class="editor">
        <div class="editor-settings">${this.#settingsRow()}</div>
        <vf-separator class="editor-sep"></vf-separator>
        <div class="editor-main">
          <div class="editor-rail">${this.#toolStrip()}${this.#colorWells()}</div>
          <div class="editor-drawbox">
            <div class="editor-opts">${this.#toolOptions()}</div>
            ${this.#canvasStack()}
          </div>
        </div>
        ${this.#pickerDialog()}
      </div>
    `;
  }

  // Tile size: the classic "little arrows" number field. Tiles are locked SQUARE,
  // so a resize is always alignment-safe. Beside it, the face picker: six
  // pixel-art cube-view icons (vf-img — see face-icons.js) over a vf-radio-group,
  // laid out as mirror pairs by `faces`. The checked face's icon takes the
  // "selected" dither overlay (CSS, off vf-radio's reflected `checked`).
  #settingsRow() {
    const faces = this.faces || [this.face];
    return html`
      <div class="editor-tile-group">
        <vf-number-field
          class="editor-tile-size"
          .value=${live(String(this.tileW))}
          min=${this.sizeMin}
          max=${this.sizeMax}
          step="1"
          label="tile size (${this.sizeMin}–${this.sizeMax})"
          @vf-change=${this.#onTileSize}
        ></vf-number-field>
        <vf-label dim>tile size</vf-label>
      </div>
      <vf-radio-group
        class="editor-face-picker"
        label="edit face"
        .value=${this.face}
        @vf-change=${this.#onFacePick}
      >
        <div class="editor-face-row">
          ${faces.map(
            (f) => html`
              <div
                class="editor-face-cell"
                title=${f}
                @click=${(e) => this.#onFaceCellClick(e, f)}
              >
                ${faceIcon(f)}
                <vf-radio value=${f} aria-label=${f}></vf-radio>
              </div>
            `
          )}
        </div>
      </vf-radio-group>
    `;
  }

  // Pencil, rect, and fill are the drawing ops; the eyedropper arms a one-shot
  // sample (`I`, or hold Alt). The selected cell inverts (CSS off `.active`).
  #toolStrip() {
    const cell = (name, glyph, title, active, onClick) => html`
      <button
        type="button"
        class=${classMap({ 'editor-tool': true, active })}
        title=${title}
        aria-label=${name}
        @click=${onClick}
      >
        ${glyph}
      </button>
    `;
    return html`
      <vf-grid
        class="editor-toolstrip"
        columns="1"
        cell-width="28"
        cell-height="28"
        role="group"
        aria-label="tools"
      >
        ${cell('pencil', ICON_DRAW, 'pencil — draw (B)', this.tool === 'pencil', () =>
          this.#switchTool('pencil')
        )}
        ${cell(
          'rectangle',
          ICON_RECT,
          'rectangle — drag a box (R)',
          this.tool === 'rect',
          () => this.#switchTool('rect')
        )}
        ${cell(
          'fill',
          ICON_FILL,
          'fill — flood a region, or replace a color (G)',
          this.tool === 'fill',
          () => this.#switchTool('fill')
        )}
        ${cell(
          'eyedropper',
          ICON_SAMPLER,
          'eyedropper — click the sprite to sample (I, or hold Alt while drawing)',
          this.picking,
          () => this.#armEyedropper()
        )}
      </vf-grid>
    `;
  }

  // The current-ink swatch doubles as the picker opener (a click drops the
  // 256-color dialog). While the transparent ink is active it shows the kit's
  // no-color checker — the same "empty color" the canvas shows through unpainted
  // texels — which is just the `color` attribute going away.
  #colorWells() {
    const clear = this.erase && !this.picking;
    const inkHex = clear || !this.ink ? undefined : rgbHex(this.ink);
    return html`
      <div class="editor-colors">
        <vf-swatch
          class="editor-selected"
          width="40"
          height="28"
          color=${ifDefined(inkHex)}
          label="selected color — open the color picker"
          title="selected color — open the color picker"
          @click=${this.#openPicker}
        ></vf-swatch>
        <div class="editor-recent">${this.#recentRow()}</div>
        <vf-swatch
          class=${classMap({ 'editor-transparent': true, active: clear })}
          width="16"
          height="16"
          label="transparent (clear) color"
          title="transparent — paint the empty / clear color (E, or right-click)"
          @click=${this.#selectTransparent}
        ></vf-swatch>
      </div>
    `;
  }

  // The "last three used colors" under the current swatch: recency slots 1..3
  // (slot 0 is the current ink, already shown by the swatch above). Keyed by
  // color, so a promotion moves a swatch instead of rebuilding the row.
  #recentRow() {
    return repeat(this.recent.slice(1, RECENT_SLOTS + 1), rgbKey, (c) => {
      const hex = rgbHex(c);
      return html`<vf-swatch
        width="16"
        height="16"
        color=${hex}
        label=${hex}
        title=${hex}
        @click=${() => this.#selectColor(c)}
      ></vf-swatch>`;
    });
  }

  // Contextual options: the pencil's tip-size slider (with a live readout), the
  // rect's corner-radius field, or the fill's two checkboxes.
  #toolOptions() {
    if (this.tool === 'pencil') {
      // vf-input fires on every drag move / key change, so the hover footprint
      // tracks the slider in real time.
      return html`
        <vf-slider
          class="editor-size-slider"
          min="1"
          max=${this.#brushMax}
          step="1"
          .value=${live(this.pencilSize)}
          label="pencil size (1–${this.#brushMax})"
          @vf-input=${this.#onPencilSize}
        ></vf-slider>
        <vf-label dim>${this.pencilSize} px</vf-label>
      `;
    }
    if (this.tool === 'rect') {
      return html`
        <vf-label dim>radius</vf-label>
        <vf-number-field
          min="0"
          max=${this.#radiusMax}
          step="1"
          .value=${live(String(this.cornerRadius))}
          label="corner radius (0–${this.#radiusMax})"
          @vf-change=${this.#onCornerRadius}
        ></vf-number-field>
      `;
    }
    if (this.tool === 'fill') {
      // "replace" upgrades the flood to a whole-tile recolor of every matching
      // texel; "all tiles" (only meaningful with replace on) extends that across
      // the atlas.
      return html`
        <vf-checkbox
          .checked=${live(this.fillReplace)}
          title="recolor every matching texel on this tile (not just the contiguous region)"
          @vf-change=${(e) => session.setFillReplace(e.detail.checked)}
          >replace</vf-checkbox
        >
        <vf-checkbox
          .checked=${live(this.fillAllTiles)}
          ?disabled=${!this.fillReplace}
          title="replace the clicked color across every tile in the atlas"
          @vf-change=${(e) => session.setFillAllTiles(e.detail.checked)}
          >all tiles</vf-checkbox
        >
      `;
    }
    return nothing;
  }

  // The CONTAINER (.editor-canvas-wrap) fills the draw box below the options bar
  // (CSS flex:1) — its height comes from the flex layout, not JS — so nothing
  // shifts when the tile size (and thus the drawn canvas) changes. Inside it, a
  // .editor-canvas-stack holds four aligned layers, centered and scaled by #layout()
  // to the largest integer texel size that fits: a background (checkerboard via CSS +
  // faded opposite-face onion-skin), the transparent pixel canvas, a hairline guide
  // overlay, and a cursor overlay (the hover footprint). Only the pixel canvas takes
  // pointer events. The pixel + bg canvases keep a native tileW×tileH backing store
  // (CSS upscales them crisp); the overlay + cursor are SCREEN-res (backing tracks the
  // on-screen px) so their 1px lines stay crisp. Backing stores are set in
  // #applyGeometry()/#layout(), never bound here.
  #canvasStack() {
    return html`
      <div class="editor-canvas-wrap" ${ref(this.#wrap)}>
        <div class="editor-canvas-stack" ${ref(this.#stack)}>
          <canvas class="editor-canvas-bg" ${ref(this.#bg)}></canvas>
          <canvas
            class=${classMap({
              'editor-canvas': true,
              // With the pencil (its eraser/eyedropper ink modes included) the hover
              // footprint outline stands in for the pointer, so hide the OS cursor
              // over the canvas — CSS `.pencil-active { cursor: none }` leaves only
              // the outline. The rect tool keeps the default crosshair.
              'pencil-active': this.tool === 'pencil',
            })}
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

  // A System 7 movable modal holding the Hilbert-laid palette as a 16×16 grid of
  // swatch cells. 256 cells are expensive, and most mounts never open the dialog —
  // so nothing is rendered until the first open, and from then on `pickerOpen`
  // alone drives it (`vf-dialog.show()` is verbatim `open = true`).
  #pickerDialog() {
    if (!this.#pickerBuilt) return nothing;
    return html`
      <vf-dialog
        heading="Colors"
        closable
        width="244"
        height="266"
        .open=${this.pickerOpen}
        @vf-close=${() => session.closePicker()}
      >
        <vf-grid
          class="editor-picker-grid"
          columns="16"
          cell-width="12"
          cell-height="12"
          collapse
          role="group"
          aria-label="color palette"
        >
          ${this.palette256.map(
            (p) =>
              html`<vf-swatch
                width="14"
                height="14"
                color=${p.css}
                label=${p.css}
                title=${p.css}
                @click=${() => {
                  this.#selectColor(p.rgb);
                  session.closePicker();
                }}
              ></vf-swatch>`
          )}
        </vf-grid>
      </vf-dialog>
    `;
  }

  // --- ink + tool selection ---------------------------------------------------
  // The pick/tool semantics themselves (MRU recency, flag clearing, clamping)
  // live in the session slice's actions; these wrappers add only what is
  // element-local (the picker-built latch, cancelling an in-flight gesture).

  // The single path every color pick funnels through (picker dialog, in-sprite
  // eyedrop, recency swatch): make `color` the ink, clear the erase/eyedropper
  // flags, and promote it to the top of the recency list.
  #selectColor(color) {
    session.pickColor(color);
  }

  #selectTransparent = () => {
    session.selectTransparent();
  };

  #openPicker = () => {
    this.#pickerBuilt = true;
    session.openPicker();
    this.requestUpdate(); // #pickerBuilt is a plain latch — ask for the render
  };

  // Abandon any in-flight rect (switching tool mid-drag discards the box, matching
  // the B/R/G keys), then select the tool — the action returns to painting (out
  // of eraser / eyedropper); the ink is always set.
  #switchTool(tool) {
    this.#cancelRect();
    session.setTool(tool);
  }

  #armEyedropper() {
    session.armEyedropper();
  }

  // --- control handlers -------------------------------------------------------
  #onTileSize(e) {
    const n = e.detail.valueAsNumber;
    if (Number.isFinite(n) && n !== this.tileW) this.#emit('sm-resize-tile', { size: n });
  }

  #onPencilSize(e) {
    session.setPencilSize(e.detail.value, this.#brushMax);
    this.#drawCursor(this.#hoverTexel); // reflect the new footprint immediately
  }

  #onCornerRadius(e) {
    session.setCornerRadius(e.detail.valueAsNumber, this.#radiusMax);
    if (this.#rectDragging) this.#drawRectPreview(); // re-round the in-flight box live
  }

  // Picking a face re-mounts the editor there (live edits are already committed),
  // exactly as the old folder tabs did.
  #onFacePick(e) {
    const f = e.detail.value;
    if (f && f !== this.face) this.#emit('sm-select-face', { face: f });
  }

  // The cube icon is a click target too; the radio's own click already routes
  // through the group's vf-change, so skip it here to avoid a double switch.
  #onFaceCellClick(e, f) {
    if (/** @type {Element} */ (e.target).closest?.('vf-radio')) return;
    if (f !== this.face) this.#emit('sm-select-face', { face: f });
  }

  #emit(type, detail) {
    // Light DOM ⇒ no `composed` needed; the dock hears it on the way up.
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  }

  #notifyLive() {
    this.#emit('sm-live', { tile: this.#workingTile, dirty: this.#dirty });
  }

  // --- keyboard ---------------------------------------------------------------
  // B / R / G / I / E pick pencil / rect / fill / eyedropper / transparent-ink;
  // Esc aborts an in-flight rect drag (nothing committed). While the picker dialog
  // is open the native <dialog> owns the keys (Esc closes it), so everything below
  // is skipped. The rest are suppressed while a text/number input is focused so
  // typing there is never hijacked.
  #onKeyDown = (e) => {
    if (this.pickerOpen) return;
    if (e.key === 'Escape' && this.#rectDragging) {
      this.#cancelRect(); // discard the box mid-drag — no pixels written
      e.preventDefault();
      return;
    }
    // Shift held mid-drag locks the box to a square, even with the pointer still —
    // re-derive the preview from the raw corner (keydown repeats, so guard churn).
    if (e.key === 'Shift' && this.#rectDragging && !this.#shiftLock) {
      this.#shiftLock = true;
      this.#drawRectPreview();
      return;
    }
    // The kit's fields host their <input> in shadow DOM, so check the composed
    // path's innermost target, not just the light-DOM tag.
    const target = e.composedPath ? e.composedPath()[0] : e.target;
    const tag = target && /** @type {Element} */ (target).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    // Switching tools mid rect-drag abandons the box (nothing committed) — same as
    // ESC, so B/R/G can't leave a half-dragged rect wired to the old pointer.
    if (this.#rectDragging && (k === 'b' || k === 'r' || k === 'g')) this.#cancelRect();
    if (k === 'b' || k === 'r' || k === 'g') {
      session.setTool(k === 'b' ? 'pencil' : k === 'r' ? 'rect' : 'fill');
    } else if (k === 'i') {
      session.armEyedropper();
    } else if (k === 'e') {
      session.selectTransparent();
    } else {
      return;
    }
    e.preventDefault();
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

  // Brush footprint: an N×N square anchored so the hovered texel stays inside and
  // odd sizes center exactly (even sizes bias up-left). Shared by the stamp and the
  // hover preview so what you see is what you paint. Returned bounds are unclamped.
  #brushBounds(cx, cy, size) {
    const o = Math.floor((size - 1) / 2);
    return { x0: cx - o, y0: cy - o, x1: cx - o + size - 1, y1: cy - o + size - 1 };
  }

  // --- painting ---------------------------------------------------------------
  // Write one texel; returns true only if the bytes actually changed. Any two
  // fully-transparent texels are treated as equal regardless of stray RGB left
  // under alpha 0, so erasing an already-invisible texel is a true no-op and
  // never dirties a mirror-derived face into real art.
  #writeTexel(px, py) {
    const work = this.#work;
    const i = (py * this.tileW + px) * 4;
    const paint = !this.#forceErase && !this.erase;
    const r = paint ? this.ink.r : 0;
    const g = paint ? this.ink.g : 0;
    const b = paint ? this.ink.b : 0;
    const a = paint ? 255 : 0;
    if (a === 0 && work[i + 3] === 0) return false;
    if (work[i] === r && work[i + 1] === g && work[i + 2] === b && work[i + 3] === a) {
      return false;
    }
    work[i] = r;
    work[i + 1] = g;
    work[i + 2] = b;
    work[i + 3] = a;
    return true;
  }

  // Stamp the whole pencil footprint centered on (cx,cy), clipped to the tile;
  // returns true if any texel changed.
  #stampBrush(cx, cy) {
    const b = this.#brushBounds(cx, cy, this.pencilSize);
    const x1 = Math.min(this.tileW - 1, b.x1);
    const y1 = Math.min(this.tileH - 1, b.y1);
    let changed = false;
    for (let py = Math.max(0, b.y0); py <= y1; py++) {
      for (let px = Math.max(0, b.x0); px <= x1; px++) {
        if (this.#writeTexel(px, py)) changed = true;
      }
    }
    return changed;
  }

  // Bresenham so a fast drag lays down a continuous stroke, not dotted samples —
  // stamping the full footprint at each step along the line.
  #stroke(px, py) {
    let changed = false;
    if (this.#prev) {
      let x0 = this.#prev.px;
      let y0 = this.#prev.py;
      const dx = Math.abs(px - x0);
      const dy = -Math.abs(py - y0);
      const sx = x0 < px ? 1 : -1;
      const sy = y0 < py ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        if (this.#stampBrush(x0, y0)) changed = true;
        if (x0 === px && y0 === py) break;
        const e2 = 2 * err;
        if (e2 >= dy) {
          err += dy;
          x0 += sx;
        }
        if (e2 <= dx) {
          err += dx;
          y0 += sy;
        }
      }
    } else if (this.#stampBrush(px, py)) {
      changed = true;
    }
    this.#prev = { px, py };
    if (changed) this.#commitPixels();
  }

  #commitPixels() {
    this.#dirty = true;
    this.#repaint();
    this.#notifyLive();
  }

  // --- overlays ---------------------------------------------------------------
  // Hairline outline of the footprint the pencil would stamp, drawn on the topmost
  // overlay under the cursor (a haloed white rect; red while erasing). The
  // eyedropper previews a single cell (its sample target). Cleared with t == null
  // when the pointer leaves the canvas. Only the PENCIL has a hover footprint — the
  // rect tool relies on the OS crosshair when idle and its own drag preview when
  // dragging — so for any other tool this just clears the overlay.
  #drawCursor(t) {
    this.#hoverTexel = t;
    const g = this.#cursorCtx;
    if (!g) return;
    g.clearRect(0, 0, this.#cssW, this.#cssH);
    if (!t || this.tool !== 'pencil') return;
    const size = this.picking ? 1 : this.pencilSize;
    const b = this.#brushBounds(t.px, t.py, size);
    const x0 = Math.max(0, b.x0);
    const y0 = Math.max(0, b.y0);
    const x1 = Math.min(this.tileW - 1, b.x1);
    const y1 = Math.min(this.tileH - 1, b.y1);
    if (x1 < x0 || y1 < y0) return;
    const rx = x0 * this.#scale + 0.5;
    const ry = y0 * this.#scale + 0.5;
    const rw = (x1 - x0 + 1) * this.#scale - 1;
    const rh = (y1 - y0 + 1) * this.#scale - 1;
    g.lineWidth = 3; // dark halo so the outline reads on any art color
    g.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    g.strokeRect(rx, ry, rw, rh);
    g.lineWidth = 1;
    g.strokeStyle =
      this.erase && !this.picking
        ? 'rgba(255, 120, 120, 0.95)'
        : 'rgba(255, 255, 255, 0.95)';
    g.strokeRect(rx, ry, rw, rh);
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

  // Live preview of the rect on the cursor overlay: the exact texels a commit will
  // fill (via the shared roundedRectRows — so rounded corners show precisely),
  // tinted by the active ink (red while erasing), under a haloed hairline of the
  // drag bounding box so the extent reads on any art even before the fill is
  // obvious. Nothing is written to `#work` until #commitRect() on pointer-up.
  #drawRectPreview() {
    const g = this.#cursorCtx;
    if (!g) return;
    g.clearRect(0, 0, this.#cssW, this.#cssH);
    const b = this.#rectBounds();
    if (!b) return;
    const s = this.#scale;
    const erasing = this.#forceErase || this.erase;
    g.fillStyle = erasing
      ? 'rgba(255, 120, 120, 0.35)'
      : `rgba(${this.ink.r}, ${this.ink.g}, ${this.ink.b}, 0.5)`;
    roundedRectRows(b.x0, b.y0, b.x1, b.y1, this.cornerRadius, (y, xl, xr) => {
      if (xr < xl) return; // empty row at an extreme radius
      g.fillRect(xl * s, y * s, (xr - xl + 1) * s, s);
    });
    const rx = b.x0 * s + 0.5;
    const ry = b.y0 * s + 0.5;
    const rw = (b.x1 - b.x0 + 1) * s - 1;
    const rh = (b.y1 - b.y0 + 1) * s - 1;
    g.lineWidth = 3; // dark halo so the box reads on any art color
    g.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    g.strokeRect(rx, ry, rw, rh);
    g.lineWidth = 1;
    g.strokeStyle = erasing ? 'rgba(255, 120, 120, 0.95)' : 'rgba(255, 255, 255, 0.95)';
    g.strokeRect(rx, ry, rw, rh);
  }

  // Rasterize the finished rect into `#work` (same roundedRectRows the preview used,
  // so what you saw is what you get), then repaint + notify if anything changed.
  #commitRect() {
    const b = this.#rectBounds();
    if (!b) return;
    let changed = false;
    roundedRectRows(b.x0, b.y0, b.x1, b.y1, this.cornerRadius, (y, xl, xr) => {
      for (let x = xl; x <= xr; x++) if (this.#writeTexel(x, y)) changed = true;
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
  #sampleAt(px, py) {
    const work = this.#work;
    const i = (py * this.tileW + px) * 4;
    if (work[i + 3] === 0) {
      // Sampling empty space picks the transparent ink (clear color).
      session.selectTransparent();
    } else {
      // Route through #selectColor so an off-palette (imported) sample becomes the
      // ink (and joins the recency row) just like any pick.
      this.#selectColor({ r: work[i], g: work[i + 1], b: work[i + 2] });
    }
    this.#drawCursor(this.#hoverTexel); // eyedrop ended → footprint returns to size
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
  // (it recolors the clicked color across every tile and re-mounts this editor);
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
    // Alt-hold = momentary eyedropper (sample without switching ink first);
    // a right-click still erases even with Alt down. Works with any tool.
    if (e.button !== 2 && (e.altKey || this.picking)) {
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
if (!customElements.get('sm-editor')) customElements.define('sm-editor', SmEditor);
