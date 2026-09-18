// <sm-editor>: a document window's body, holding <sm-draw-canvas>, whose
// selection commands it forwards. apps/sprite-editor/windows.js creates one per
// document and keeps it until the document closes, so the canvas survives hides
// and DOM re-orders.
//
// With `on all faces` on, the canvas's selection operations are also applied to
// the layer's other faces (lib/select-faces.js). The option is read at a
// selection's first operation and holds for its life. Each closed gesture is one
// undo step over every face it changed.

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { createRef, ref } from 'lit/directives/ref.js';
import { maxCornerRadius } from '../lib/rect.js';
import { createFaceSelection } from '../lib/select-faces.js';
import { session } from '../state/session.js';
import { workspace } from '../state/workspace.js';
import { editorViewModel, editorOverlays } from '../state/derive.js';
import { StoreController } from '../state/store-controller.js';
import './sm-draw-canvas.js'; // registers <sm-draw-canvas>
import { baseStyles } from './base-styles.js';

export class SmEditor extends LitElement {
  static styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
      .editor {
        height: 100%;
        display: flex;
        flex-direction: column;
        background: var(--sm-white);
      }
      /* The artwork well the canvas centers in, full bleed to the frame. */
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
    /** The DocContext this editor edits. Set before the element connects and
     *  never changed. */
    ctx: { attribute: false },
  };

  constructor() {
    super();
    /** @type {import('../state/workspace.js').DocContext|null} */
    this.ctx = null;

    // Session (brush state) and workspace (face, layer, activation) changes
    // re-render. Live strokes notify neither.
    new StoreController(this, session.store);
    new StoreController(this, workspace.store);
  }

  // The doc is wired on each connect: ctx is not set at construction, and
  // vf-desktop disconnects and reconnects windows when it re-orders them on a
  // raise.
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

  /** @type {import('lit/directives/ref.js').Ref<import('./sm-draw-canvas.js').SmDrawCanvas>} */
  #canvas = createRef();

  /** The canvas's selection texels and place, or null. */
  copySelection() {
    return this.#canvas.value?.copySelection() ?? null;
  }

  /** Paste `float` at (x, y) as the canvas's selection.
   *  @param {import('../lib/select.js').Float} float @param {number} x @param {number} y */
  pasteFloat(float, x, y) {
    this.#canvas.value?.pasteFloat(float, x, y);
  }

  /** Select the canvas's whole tile. */
  selectAll() {
    this.#canvas.value?.selectAll();
  }

  /** Mirror the canvas's selection.
   *  @param {'horizontal'|'vertical'} axis */
  flipSelection(axis) {
    this.#canvas.value?.flipSelection(axis);
  }

  /** Whether this editor's window is the active document window. The canvas
   *  limits a selection's Esc to that window, since every canvas listens for
   *  keys on the document. */
  get #isActive() {
    return !!this.ctx && workspace.get().activeKey === this.ctx.key;
  }

  // Tool bounds for session.clampTools. sm-options-bar derives the same pair.
  get #brushMax() {
    const d = this.ctx.doc.get();
    return Math.max(1, Math.min(d.tileW || 1, d.tileH || 1));
  }
  get #radiusMax() {
    const d = this.ctx.doc.get();
    return maxCornerRadius(d.tileW || 1, d.tileH || 1);
  }

  // The view model, memoized on face, layer, `layers` identity and tile size. A
  // live stroke mutates layers[layer][face] in place, so the memo holds
  // mid-stroke and the canvas keeps its buffer. Its key names the layer and
  // face the canvas's buffer belongs to, which the edit handlers address.
  #vm = null;
  #vmKey = null; // identities the memo is valid for
  #viewModel() {
    const d = this.ctx.doc.get();
    const { face, layer } = this.ctx;
    const k = this.#vmKey;
    if (
      !this.#vm ||
      k.face !== face ||
      k.layer !== layer ||
      k.layers !== d.layers ||
      k.tileW !== d.tileW ||
      k.tileH !== d.tileH
    ) {
      this.#vm = editorViewModel(d, face, layer);
      this.#vmKey = { face, layer, layers: d.layers, tileW: d.tileW, tileH: d.tileH };
    }
    return this.#vm;
  }

  willUpdate() {
    // A tile resize can leave the pencil or eraser size or the corner radius
    // out of bounds. Only the active window clamps, since the tool settings
    // are app-wide.
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

  render() {
    if (!this.ctx) return html``;
    const d = this.ctx.doc.get();
    const s = session.get();
    const vm = this.#viewModel();
    return html`
      <div class="editor">
        <div class="editor-drawbox">
          <sm-draw-canvas
            ${ref(this.#canvas)}
            .tile=${vm.tile}
            .tileW=${d.tileW}
            .tileH=${d.tileH}
            .onionBehind=${vm.onionBehind}
            .edgeHints=${vm.edgeHints}
            .tool=${s.tool}
            .option=${s.option}
            .ink=${s.ink}
            .pencilSize=${s.pencilSize}
            .pencilShape=${s.pencilShape}
            .eraserSize=${s.eraserSize}
            .eraserShape=${s.eraserShape}
            .cornerRadius=${s.cornerRadius}
            .fillContiguous=${s.fillContiguous}
            .fillAllFaces=${s.fillAllFaces}
            .active=${this.#isActive}
            @sm-live=${this.#onLive}
            @sm-commit=${this.#onCommit}
            @sm-selection-op=${this.#onSelectionOp}
            @sm-gesture=${(e) => session.setGesture(e.detail.active)}
            @sm-selection=${this.#onSelection}
            @sm-rect-drag=${(e) => workspace.setRectDrag(this.ctx.key, e.detail.bounds)}
            @sm-pick-color=${(e) => session.pickColor(e.detail.rgb)}
            @sm-pick-transparent=${() => session.setTool('eraser')}
            @sm-replace-all-tiles=${this.#onReplaceAllTiles}
          ></sm-draw-canvas>
        </div>
      </div>
    `;
  }

  // An untouched derived or empty face stays as it is. applyTileEdit does not
  // notify the change channel, so the view model memo stays valid.
  #onLive = (e) => {
    const { tile, dirty } = e.detail;
    if (!this.#vmKey || (this.#vm.wasDerived && !dirty)) return;
    const { layer, face } = this.#vmKey;
    this.ctx.doc.applyTileEdit(layer, face, tile);
  };

  // One gesture over every face it changed. The canvas commits the edited face
  // first, so its pair leads the entry.
  #onCommit = (e) => {
    if (!this.#vmKey) return;
    const { before, after } = e.detail;
    const { layer, face } = this.#vmKey;
    const pairs = this.#faceSel?.takePairs() ?? [];
    if (pairs.length)
      this.ctx.history.pushFaces(layer, [{ face, before, after }, ...pairs]);
    else this.ctx.history.pushTile(layer, face, before, after);
  };

  #onSelection = (e) => {
    const { bounds } = e.detail;
    if (!bounds) this.#dropFaceSelection();
    workspace.setSelection(this.ctx.key, bounds);
  };

  // The selection over the layer's other faces, and whether this selection's
  // operations have begun (which settles the option for its life).
  /** @type {ReturnType<typeof createFaceSelection>|null} */
  #faceSel = null;
  #faceSelLive = false;

  #dropFaceSelection() {
    this.#faceSel = null;
    if (!this.#faceSelLive) return;
    this.#faceSelLive = false;
    if (this.ctx) workspace.setSelectionLifted(this.ctx.key, false);
  }

  // Lift the layer's other faces at the marquee. A document off the drawing
  // convention takes no part: the checkbox is greyed for it.
  #liftFaceSelection(bounds) {
    const d = this.ctx.doc.get();
    const { layer, face } = this.#vmKey;
    const views = d.layers[layer];
    if (!bounds || !views || !d.tileW || d.tileW !== d.tileH) return null;
    if (Object.keys(d.transforms ?? {}).length > 0) return null;
    return createFaceSelection(views, face, bounds, d.tileW);
  }

  // A selection operation from the canvas, before it writes the edited face.
  #onSelectionOp = (e) => {
    if (!this.#vmKey) return;
    const { op, bounds } = e.detail;
    if (op === 'drop') {
      this.#dropFaceSelection();
      return;
    }
    const { layer } = this.#vmKey;
    // An `end` with pairs still waiting is a gesture the edited face sat out.
    if (op === 'end') {
      const pairs = this.#faceSel?.takePairs() ?? [];
      if (pairs.length) this.ctx.history.pushFaces(layer, pairs);
      return;
    }
    if (!this.#faceSelLive) {
      this.#faceSelLive = true;
      workspace.setSelectionLifted(this.ctx.key, true);
      if (session.get().selectAllFaces) this.#faceSel = this.#liftFaceSelection(bounds);
    }
    if (!this.#faceSel) return;
    const changed =
      op === 'move'
        ? this.#faceSel.moveTo(e.detail.dx, e.detail.dy)
        : op === 'flip'
          ? this.#faceSel.flip(e.detail.axis)
          : this.#faceSel.clear();
    if (changed.length === 0) return;
    for (const face of changed) {
      this.ctx.doc.applyTileEdit(layer, face, this.#faceSel.tile(face));
    }
    // The underlay is the opposite face and the hints are the neighbours, so
    // both follow the move. `tile` keeps its identity, which resets the canvas.
    this.#vm = {
      ...this.#vm,
      ...editorOverlays(this.ctx.doc.get(), this.#vmKey.face, layer),
    };
    this.requestUpdate();
  };

  // Fill with contiguous off and all faces on: recolor the layer's six tiles
  // under one atlas undo snapshot.
  #onReplaceAllTiles = (e) => {
    if (!this.#vmKey) return;
    const { target, fill } = e.detail;
    const { layer } = this.#vmKey;
    this.ctx.history.withAtlasSnapshot(() =>
      this.ctx.doc.replaceAllTiles(layer, target, fill)
    );
  };
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-editor')) customElements.define('sm-editor', SmEditor);
