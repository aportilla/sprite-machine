// ---------------------------------------------------------------------------
// <sm-editor> — a document window's body: the CONNECTED container for the
// drawing surface. ONE EDITOR PER DOCUMENT, for the document's lifetime: the
// window reconciler (shell/windows.js) clones it into every document window
// with its `ctx` (the workspace DocContext) assigned BEFORE the append, and
// it lives until the document closes — a hide (or the desktop's DOM
// re-orders) never unmounts it, so canvas identity and focus behavior
// survive. What it holds: the full-bleed white artwork well holding
// <sm-draw-canvas>. (The face picker is app-level chrome now — the strip
// across the Full Sprite View windoid, serving the ACTIVE document; the
// 168-color Colors dialog likewise — <sm-color-picker> in index.html's
// dialog set, light-DOM so the kit's cursor can stack above its modal.)
//
// Store wiring (the editor's share of it): StoreControllers re-render on any
// session (brush state) or workspace (face, activation) change; the
// context's own doc is wired by hand in connectedCallback (the
// context isn't known at construction) and re-wired across the desktop's
// disconnect/reconnect node moves. The per-face view model is memoized on
// (face, views-identity, tile geometry) — the two-speed contract depends on
// it: a live stroke mutates `views[face]` SILENTLY (same object), so the
// onion-skin / the working tile's identity stay put mid-stroke and the canvas
// never resets its buffer. Canvas gesture commits feed THIS document's undo
// history (sm-commit → ctx.history.pushTile), and the canvas's two outlines —
// the selection's (sm-selection) and the rect tool's drag in flight
// (sm-rect-drag) — are mirrored onto THIS context's own selection store
// (workspace.setSelection / setRectDrag) for the options strip's readouts —
// and, for the selection, the coming Edit-menu gating — to follow. The canvas
// also learns whether THIS window is
// the active one (`active`): a selection's no-drag Esc acts on the active
// window's selection only — every open window's canvas listens on the
// document, so without it one Esc would drop them all.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { maxCornerRadius } from '../lib/rect.js';
import { session } from '../state/session.js';
import { workspace } from '../state/workspace.js';
import { editorViewModel } from '../state/derive.js';
import { StoreController } from '../state/store-controller.js';
import './sm-draw-canvas.js'; // registers <sm-draw-canvas>
import { baseStyles } from './base-styles.js';

export class SmEditor extends LitElement {
  static styles = [
    baseStyles,
    css`
      /* The host box dissolves — the window body's box sizes .editor. */
      :host {
        display: contents;
      }
      .editor {
        height: 100%;
        display: flex;
        flex-direction: column;
        background: var(--sm-white);
      }
      /* The artwork well: the white ground the pixel canvas centers in — full
         bleed, running edge to edge from the title bar down to the status
         strip (a window body carries no inset of its own — vintage-frames
         0.6.0 — so it meets the frame's own black line).
         The canvas box inside it carries its own paper — the kit's 12%
         dither, the transparency indicator. */
      .editor-drawbox {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        background: var(--sm-artwork);
      }
    `,
  ];

  static properties = {
    /** The workspace DocContext this editor edits — assigned by the window
     *  reconciler BEFORE the element enters the DOM, constant for life. */
    ctx: { attribute: false },
  };

  constructor() {
    super();
    /** @type {import('../state/workspace.js').DocContext|null} */
    this.ctx = null;

    // Any session action (brush state) or workspace change (this window's
    // face, the activation state the tool clamp gates on) re-renders; live
    // strokes are silent on both by design.
    new StoreController(this, session.store);
    new StoreController(this, workspace.store);
  }

  // The context's doc: wired by hand (the context isn't known at
  // construction), and re-wired on every reconnect — the desktop re-orders
  // slotted windows in the light DOM on raises, which disconnects and
  // reconnects this element.
  #unsubDoc = null;
  connectedCallback() {
    super.connectedCallback();
    if (this.ctx) {
      this.#unsubDoc = this.ctx.doc.subscribe(() => this.requestUpdate());
      this.requestUpdate(); // a reconnect may have missed structural changes
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.#unsubDoc?.();
    this.#unsubDoc = null;
  }

  /** Whether this editor's window is the active document window. */
  get #isActive() {
    return !!this.ctx && workspace.get().activeKey === this.ctx.key;
  }

  // --- derived bounds --------------------------------------------------------
  // The session actions clamp against these; sm-options-bar derives the same
  // pair from the active context for its controls.
  get #brushMax() {
    const d = this.ctx.doc.get();
    return Math.max(1, Math.min(d.tileW || 1, d.tileH || 1));
  }
  get #radiusMax() {
    const d = this.ctx.doc.get();
    return maxCornerRadius(d.tileW || 1, d.tileH || 1);
  }

  // --- the memoized per-face view model --------------------------------------
  #vm = null;
  #vmKey = null; // identities the memo is valid for
  #viewModel() {
    const d = this.ctx.doc.get();
    const face = this.ctx.face;
    const k = this.#vmKey;
    if (
      !this.#vm ||
      k.face !== face ||
      k.views !== d.views ||
      k.tileW !== d.tileW ||
      k.tileH !== d.tileH
    ) {
      this.#vm = editorViewModel(d, face);
      this.#vmKey = { face, views: d.views, tileW: d.tileW, tileH: d.tileH };
    }
    return this.#vm;
  }

  willUpdate() {
    // A tile resize can leave the persisted pencil / eraser size or corner
    // radius past the new bounds — the clamp itself lives in the session
    // action. Only the ACTIVE window clamps: the session sliders are
    // app-level, and they bound against the document actually being edited.
    if (!this.ctx) return;
    const d = this.ctx.doc.get();
    const k = this.#vmKey;
    if (
      this.#isActive &&
      d.tileW &&
      d.tileH &&
      (!k || k.tileW !== d.tileW || k.tileH !== d.tileH)
    ) {
      session.clampTools(this.#brushMax, this.#radiusMax);
    }
  }

  // --- template --------------------------------------------------------------
  render() {
    if (!this.ctx) return html``;
    const d = this.ctx.doc.get();
    const s = session.get();
    const vm = this.#viewModel();
    const hooks = this.ctx.hooks;
    return html`
      <div class="editor">
        <div class="editor-drawbox">
          <sm-draw-canvas
            .tile=${vm.tile}
            .tileW=${d.tileW}
            .tileH=${d.tileH}
            .mirrorBehind=${vm.mirrorBehind}
            .edgeHints=${vm.edgeHints}
            .tool=${s.tool}
            .ink=${s.ink}
            .pencilSize=${s.pencilSize}
            .pencilShape=${s.pencilShape}
            .eraserSize=${s.eraserSize}
            .eraserShape=${s.eraserShape}
            .cornerRadius=${s.cornerRadius}
            .fillContiguous=${s.fillContiguous}
            .fillAllFaces=${s.fillAllFaces}
            .active=${this.#isActive}
            .previewCursor=${hooks?.previewCursor ?? false}
            .previewRect=${hooks?.previewRect ?? null}
            .fillOnMount=${hooks?.fillOnMount ?? null}
            .selectOnMount=${hooks?.selectOnMount ?? null}
            @sm-live=${this.#onLive}
            @sm-commit=${this.#onCommit}
            @sm-selection=${(e) => workspace.setSelection(this.ctx.key, e.detail.bounds)}
            @sm-rect-drag=${(e) => workspace.setRectDrag(this.ctx.key, e.detail.bounds)}
            @sm-pick-color=${(e) => session.pickColor(e.detail.rgb)}
            @sm-pick-transparent=${() => session.setTool('eraser')}
            @sm-replace-all-tiles=${this.#onReplaceAllTiles}
          ></sm-draw-canvas>
        </div>
      </div>
    `;
  }

  // --- handlers ---------------------------------------------------------------
  // One live/committed stroke from the canvas. An untouched derived/empty face
  // stays that way (mirror-derived or empty); otherwise the working buffer
  // becomes the face's real art — or null again if fully erased, reverting it
  // to mirror-derived (doc.applyTileEdit decides). Silent on the change
  // channel, so this render's memoized view model stays valid mid-stroke.
  #onLive = (e) => {
    const { tile, dirty } = e.detail;
    if (this.#vm?.wasDerived && !dirty) return;
    this.ctx.doc.applyTileEdit(this.ctx.face, tile);
  };

  // One finished gesture's snapshot pair → an undo entry for this face.
  #onCommit = (e) => {
    const { before, after } = e.detail;
    this.ctx.history.pushTile(this.ctx.face, before, after);
  };

  // Fill with contiguous OFF and "on all faces" ON: recolor across the whole
  // sheet under a whole-atlas undo snapshot; the structural change re-derives
  // this editor over the new pixels.
  #onReplaceAllTiles = (e) => {
    const { target, fill } = e.detail;
    this.ctx.history.withAtlasSnapshot(() => this.ctx.doc.replaceAllTiles(target, fill));
  };
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-editor')) customElements.define('sm-editor', SmEditor);
