// <sm-editor>: a document window's body, holding <sm-draw-canvas>, whose
// selection commands it forwards. apps/sprite-editor/windows.js creates one per
// document and keeps it until the document closes, so the canvas survives hides
// and DOM re-orders.

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { createRef, ref } from 'lit/directives/ref.js';
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
            @sm-gesture=${(e) => session.setGesture(e.detail.active)}
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

  // An untouched derived or empty face stays as it is. applyTileEdit does not
  // notify the change channel, so the view model memo stays valid.
  #onLive = (e) => {
    const { tile, dirty } = e.detail;
    if (!this.#vmKey || (this.#vm.wasDerived && !dirty)) return;
    const { layer, face } = this.#vmKey;
    this.ctx.doc.applyTileEdit(layer, face, tile);
  };

  #onCommit = (e) => {
    if (!this.#vmKey) return;
    const { before, after } = e.detail;
    const { layer, face } = this.#vmKey;
    this.ctx.history.pushTile(layer, face, before, after);
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
