// ---------------------------------------------------------------------------
// <sm-editor> — the tools panel (LEFT half of the workspace): the CONNECTED
// container for the drawing editor. Permanently docked by main.js at boot —
// a face is always selected; the 3D view stays live + interactive on the
// right. No imports from the voxel pipeline.
//
// A LitElement rendering into the LIGHT DOM (`createRenderRoot() { return this }`)
// so style.css's `.editor-*` rules and `capture.sh dom` keep working untouched;
// style.css gives the host `display: contents`, so the box tree is exactly the
// `.editor` column it wraps.
//
// THE ONLY EDITOR FILE THAT KNOWS THE STORE EXISTS. Two StoreControllers
// re-render it on any session (brush state) or doc (structural) change; it
// derives the per-face view model via derive.js and translates every leaf
// event into a store action or doc mutation:
//   1. SETTINGS row (fixed): the TILE-SIZE number field (inline — 15 lines of
//      template; a component would be ceremony, and its UNCONDITIONAL slot is
//      what lets lit reuse the node so keyboard focus survives re-renders) and
//      <sm-face-picker> (sm-select-face → session.selectFace).
//   2. A dotted separator.
//   3. MAIN area (grows): the RAIL — <sm-tool-strip> over <sm-color-wells> —
//      beside the DRAW BOX: <sm-tool-options> (it IS the .editor-opts bar) over
//      <sm-draw-canvas> (the pixel-canvas subsystem; its sm-live strokes fold
//      into the doc, its eyedrops become session picks).
//   4. <sm-color-picker>, the 256-color vf-dialog (lazy-built on first open).
//
// THE VIEW MODEL IS MEMOIZED on (face, views-identity, tile geometry) — the
// two-speed contract depends on it: a live stroke mutates `views[face]`
// SILENTLY (same object), so guides / onion-skin / the working tile's identity
// stay put mid-stroke and the canvas never resets its buffer; a structural doc
// change (load / resize / replace-all) swaps the `views` object, so the next
// render re-derives everything — the old imperative showFace(), now pull-based.
//
// ONE ELEMENT, FOREVER: created once and never destroyed, which is what keeps
// the tile field's keyboard focus alive across resizes with no refocus hack.
// The brush state itself lives in the session slice and outlives even this.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { LitElement, html } from 'lit';
import { live } from 'lit/directives/live.js';
import { maxCornerRadius } from '../lib/rect.js';
import { session, RECENT_SLOTS } from '../state/session.js';
import { doc } from '../state/doc.js';
import { editorViewModel } from '../state/derive.js';
import { StoreController } from '../state/store-controller.js';
import './sm-face-picker.js'; // registers <sm-face-picker>
import './sm-tool-strip.js'; // registers <sm-tool-strip>
import './sm-color-wells.js'; // registers <sm-color-wells>
import './sm-tool-options.js'; // registers <sm-tool-options>
import './sm-color-picker.js'; // registers <sm-color-picker>
import './sm-draw-canvas.js'; // registers <sm-draw-canvas>

export class SmEditor extends LitElement {
  static properties = {
    // Session-constant inputs (main.js assigns them once at creation).
    palette: { attribute: false },
    palette256: { attribute: false },
    faces: { attribute: false },
    sizeMin: { type: Number },
    sizeMax: { type: Number },
  };

  constructor() {
    super();
    this.palette = [];
    this.palette256 = [];
    /** @type {string[]|null} */
    this.faces = null;
    this.sizeMin = 1;
    this.sizeMax = 64;

    // Any session action (brush state) or structural doc change re-renders;
    // live strokes are silent on both by design.
    new StoreController(this, session.store);
    new StoreController(this, doc.store);

    // One-shot canvas dev hooks (?cursor / ?rect / ?fill paint halves) —
    // assigned by main.js before docking, handed to <sm-draw-canvas>, consumed
    // there on its first update with real tile geometry.
    this.previewCursor = false;
    this.previewRect = null;
    this.fillOnMount = null;
  }

  // --- session reads ---------------------------------------------------------
  // There are deliberately no setters — every write is a session ACTION, so an
  // accidental assignment throws instead of silently forking.
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

  createRenderRoot() {
    return this; // light DOM — style.css + `capture.sh dom` keep working
  }

  // --- derived bounds --------------------------------------------------------
  // The pencil tip is capped at the tile edge (a single stamp can't exceed the
  // canvas); the rect's corner radius at half the shorter tile side (the biggest a
  // full-tile rect could use — a per-rect clamp in roundedRectRows handles smaller
  // rects). Both derive from the live tile; the session actions do the clamping.
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
    // A tile resize can leave the persisted pencil size / corner radius past
    // the new bounds — the clamp itself lives in the session action.
    const d = doc.get();
    const k = this.#vmKey;
    if (d.tileW && d.tileH && (!k || k.tileW !== d.tileW || k.tileH !== d.tileH)) {
      session.clampTools(this.#brushMax, this.#radiusMax);
    }
  }

  // --- template --------------------------------------------------------------
  render() {
    const d = doc.get();
    const face = session.get().face;
    const vm = this.#viewModel();
    return html`
      <div class="editor">
        <div class="editor-settings">
          <div class="editor-tile-group">
            <vf-number-field
              class="editor-tile-size"
              .value=${live(String(d.tileW))}
              min=${this.sizeMin}
              max=${this.sizeMax}
              step="1"
              label="tile size (${this.sizeMin}–${this.sizeMax})"
              @vf-change=${this.#onTileSize}
            ></vf-number-field>
            <vf-label dim>tile size</vf-label>
          </div>
          <sm-face-picker
            .faces=${this.faces}
            .selected=${face}
            @sm-select-face=${(e) => session.selectFace(e.detail.face)}
          ></sm-face-picker>
        </div>
        <vf-separator class="editor-sep"></vf-separator>
        <div class="editor-main">
          <div class="editor-rail">
            <sm-tool-strip
              .tool=${this.tool}
              .picking=${this.picking}
              @sm-pick-tool=${(e) => session.setTool(e.detail.tool)}
              @sm-arm-eyedropper=${() => session.armEyedropper()}
            ></sm-tool-strip>
            <sm-color-wells
              .ink=${this.ink}
              .erase=${this.erase}
              .picking=${this.picking}
              .recent=${this.recent.slice(1, RECENT_SLOTS + 1)}
              @sm-pick-color=${this.#onPickColor}
              @sm-pick-transparent=${() => session.selectTransparent()}
              @sm-open-picker=${() => session.openPicker()}
            ></sm-color-wells>
          </div>
          <div class="editor-drawbox">
            <sm-tool-options
              class="editor-opts"
              .tool=${this.tool}
              .pencilSize=${this.pencilSize}
              .brushMax=${this.#brushMax}
              .cornerRadius=${this.cornerRadius}
              .radiusMax=${this.#radiusMax}
              .fillReplace=${this.fillReplace}
              .fillAllTiles=${this.fillAllTiles}
              @sm-set-pencil-size=${(e) =>
                session.setPencilSize(e.detail.n, this.#brushMax)}
              @sm-set-corner-radius=${(e) =>
                session.setCornerRadius(e.detail.n, this.#radiusMax)}
              @sm-set-fill-opts=${this.#onFillOpts}
            ></sm-tool-options>
            <sm-draw-canvas
              .tile=${vm.tile}
              .tileW=${d.tileW}
              .tileH=${d.tileH}
              .mirrorBehind=${vm.mirrorBehind}
              .guides=${vm.guides}
              .tool=${this.tool}
              .ink=${this.ink}
              .erase=${this.erase}
              .picking=${this.picking}
              .pencilSize=${this.pencilSize}
              .cornerRadius=${this.cornerRadius}
              .fillReplace=${this.fillReplace}
              .fillAllTiles=${this.fillAllTiles}
              .previewCursor=${this.previewCursor}
              .previewRect=${this.previewRect}
              .fillOnMount=${this.fillOnMount}
              @sm-live=${this.#onLive}
              @sm-pick-color=${this.#onPickColor}
              @sm-pick-transparent=${() => session.selectTransparent()}
              @sm-replace-all-tiles=${this.#onReplaceAllTiles}
            ></sm-draw-canvas>
          </div>
        </div>
        <sm-color-picker
          .palette=${this.palette256}
          .open=${this.pickerOpen}
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
  // The single funnel every color pick routes through (recency swatch, canvas
  // eyedrop; the dialog adds a close on top): the session action sets the ink,
  // clears the erase/eyedropper flags, and promotes the MRU recency.
  #onPickColor = (e) => {
    session.pickColor(e.detail.rgb);
  };

  #onFillOpts = (e) => {
    const { replace, allTiles } = e.detail;
    if (replace !== undefined) session.setFillReplace(replace);
    if (allTiles !== undefined) session.setFillAllTiles(allTiles);
  };

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

  // Fill with BOTH "replace" and "all tiles" on: recolor across the whole
  // sheet; the structural change re-derives this editor over the new pixels.
  #onReplaceAllTiles = (e) => {
    const { target, fill } = e.detail;
    doc.replaceAllTiles(target, fill);
  };

  // Tiles are locked SQUARE (the only registering shape) and the resize
  // CENTERS the art on every axis; the structural change re-derives the same
  // face at the new size. (The number field keeps focus by itself — its
  // element is never unmounted.)
  #onTileSize = (e) => {
    const n = e.detail.valueAsNumber;
    if (Number.isFinite(n) && n !== doc.get().tileW) doc.resizeTiles(n, n);
  };
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-editor')) customElements.define('sm-editor', SmEditor);
