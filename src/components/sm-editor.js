// ---------------------------------------------------------------------------
// <sm-editor> — the document window's body: the CONNECTED container for the
// drawing surface. Docked into the window by index.html and never destroyed
// (ONE ELEMENT, FOREVER — the window hides, never unmounts, so canvas
// identity and focus behavior survive). Slimmed by the desktop shell: the
// tool strip / color wells live in the Tools palette (<sm-tools-panel>), the
// per-tool options in the options strip (<sm-options-bar>), and the
// tile-size stepper in File → Properties — what remains is the FACE PICKER
// row over the black-framed artwork well holding <sm-draw-canvas>, plus the
// 256-color Colors dialog (top-layer, so living in this template can't clip).
//
// Store wiring (the editor's share of it): two StoreControllers re-render on
// any session (brush state) or doc (structural) change, plus the shell slice
// for the Show Grid toggle; the per-face view model is memoized on (face,
// views-identity, tile geometry) — the two-speed contract depends on it: a
// live stroke mutates `views[face]` SILENTLY (same object), so guides /
// onion-skin / the working tile's identity stay put mid-stroke and the canvas
// never resets its buffer. Canvas gesture commits feed the undo history
// (sm-commit → history.pushTile; an all-tiles replace snapshots the atlas).
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { css, LitElement, html } from 'lit';
import { maxCornerRadius } from '../lib/rect.js';
import { session } from '../state/session.js';
import { doc } from '../state/doc.js';
import { shell } from '../state/shell.js';
import { history } from '../state/history.js';
import { editorViewModel } from '../state/derive.js';
import { StoreController } from '../state/store-controller.js';
import './sm-face-picker.js'; // registers <sm-face-picker>
import './sm-color-picker.js'; // registers <sm-color-picker>
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
      /* Settings row: the six-face cube picker, centered (the mockup's row
         under the title bar). */
      .editor-settings {
        flex: none;
        display: flex;
        justify-content: center;
        padding: 8px 12px;
      }
      /* The dotted rule between the picker and the artwork well. */
      .editor-sep {
        flex: none;
        margin: 0 12px;
        --vf-separator-color: var(--sm-black);
        --vf-separator-style: dotted;
      }
      /* The artwork well: the dark box the pixel canvas centers in. */
      .editor-drawbox {
        flex: 1;
        min-height: 0;
        margin: 10px 12px 12px;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--sm-black);
        background: var(--sm-artwork);
      }
    `,
  ];

  static properties = {
    // Session-constant inputs (main.js assigns them once at creation).
    palette256: { attribute: false },
    faces: { attribute: false },
  };

  constructor() {
    super();
    this.palette256 = [];
    /** @type {string[]|null} */
    this.faces = null;

    // Any session action (brush state), structural doc change, or shell
    // toggle (Show Grid) re-renders; live strokes are silent on all by design.
    new StoreController(this, session.store);
    new StoreController(this, doc.store);
    new StoreController(this, shell.store);

    // One-shot canvas dev hooks (?cursor / ?rect / ?fill paint halves) —
    // assigned by main.js before docking, handed to <sm-draw-canvas>, consumed
    // there on its first update with real tile geometry.
    this.previewCursor = false;
    this.previewRect = null;
    this.fillOnMount = null;
  }

  // --- derived bounds --------------------------------------------------------
  // The session actions clamp against these; sm-options-bar derives the same
  // pair for its controls.
  get #brushMax() {
    const d = doc.get();
    return Math.max(1, Math.min(d.tileW || 1, d.tileH || 1));
  }
  get #radiusMax() {
    const d = doc.get();
    return maxCornerRadius(d.tileW || 1, d.tileH || 1);
  }

  // --- the memoized per-face view model --------------------------------------
  #vm = null;
  #vmKey = null; // identities the memo is valid for
  #viewModel() {
    const d = doc.get();
    const face = session.get().face;
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
    // radius past the new bounds — the clamp itself lives in the session action.
    const d = doc.get();
    const k = this.#vmKey;
    if (d.tileW && d.tileH && (!k || k.tileW !== d.tileW || k.tileH !== d.tileH)) {
      session.clampTools(this.#brushMax, this.#radiusMax);
    }
  }

  // --- template --------------------------------------------------------------
  render() {
    const d = doc.get();
    const s = session.get();
    const vm = this.#viewModel();
    return html`
      <div class="editor">
        <div class="editor-settings">
          <sm-face-picker
            .faces=${this.faces}
            .selected=${s.face}
            @sm-select-face=${(e) => session.selectFace(e.detail.face)}
          ></sm-face-picker>
        </div>
        <vf-separator class="editor-sep"></vf-separator>
        <div class="editor-drawbox">
          <sm-draw-canvas
            .tile=${vm.tile}
            .tileW=${d.tileW}
            .tileH=${d.tileH}
            .mirrorBehind=${vm.mirrorBehind}
            .guides=${vm.guides}
            .tool=${s.tool}
            .ink=${s.ink}
            .pencilSize=${s.pencilSize}
            .eraserSize=${s.eraserSize}
            .cornerRadius=${s.cornerRadius}
            .fillReplace=${s.fillReplace}
            .fillAllTiles=${s.fillAllTiles}
            .showGrid=${shell.get().showGrid}
            .previewCursor=${this.previewCursor}
            .previewRect=${this.previewRect}
            .fillOnMount=${this.fillOnMount}
            @sm-live=${this.#onLive}
            @sm-commit=${this.#onCommit}
            @sm-pick-color=${(e) => session.pickColor(e.detail.rgb)}
            @sm-pick-transparent=${() => session.setTool('eraser')}
            @sm-replace-all-tiles=${this.#onReplaceAllTiles}
          ></sm-draw-canvas>
        </div>
        <sm-color-picker
          .palette=${this.palette256}
          .open=${s.pickerOpen}
          @sm-pick-color=${(e) => {
            session.pickColor(e.detail.rgb);
            session.closePicker();
          }}
          @sm-close=${() => session.closePicker()}
        ></sm-color-picker>
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
    doc.applyTileEdit(session.get().face, tile);
  };

  // One finished gesture's snapshot pair → an undo entry for this face.
  #onCommit = (e) => {
    const { before, after } = e.detail;
    history.pushTile(session.get().face, before, after);
  };

  // Fill with BOTH "replace" and "all tiles" on: recolor across the whole
  // sheet under a whole-atlas undo snapshot; the structural change re-derives
  // this editor over the new pixels.
  #onReplaceAllTiles = (e) => {
    const { target, fill } = e.detail;
    history.withAtlasSnapshot(() => doc.replaceAllTiles(target, fill));
  };
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-editor')) customElements.define('sm-editor', SmEditor);
