// ---------------------------------------------------------------------------
// <sm-editor> — the tools panel (LEFT half of the workspace): the CONNECTED
// container for the drawing editor. Permanently docked — a face is always
// selected; the 3D view stays live + interactive on the right. No imports from
// the voxel pipeline.
//
// A LitElement rendering into the LIGHT DOM (`createRenderRoot() { return this }`)
// so style.css's `.editor-*` rules and `capture.sh dom` keep working untouched;
// style.css gives the host `display: contents`, so the box tree is exactly the
// `.editor` column it wraps.
//
// The container renders the panel LAYOUT and wires the presentational leaves —
// props down, bubbling `sm-*` events up, translated into session actions here:
//   1. SETTINGS row (fixed): the TILE-SIZE number field (inline — 15 lines of
//      template; a component would be ceremony, and its UNCONDITIONAL slot is
//      what lets lit reuse the node so keyboard focus survives re-renders) and
//      <sm-face-picker> (its sm-select-face bubbles straight to the dock).
//   2. A dotted separator.
//   3. MAIN area (grows): the RAIL — <sm-tool-strip> over <sm-color-wells> —
//      beside the DRAW BOX: <sm-tool-options> (it IS the .editor-opts bar) over
//      <sm-draw-canvas> (the whole pixel-canvas subsystem).
//   4. <sm-color-picker>, the 256-color vf-dialog (lazy-built on first open).
//
// The brush state (tool, ink, recency, per-tool options, picker flag) lives in
// the SESSION slice — read through getters, written through actions; a
// StoreController re-renders this element on any change, and the state
// outlives even the element. The doc-derived view model (tile, onion-skin,
// guides) and tile geometry arrive as properties assigned by main.js.
//
// ONE ELEMENT, FOREVER. main.js creates a single <sm-editor> on the first
// build and never destroys it: a face swap, a tile resize and an all-tiles
// replace are property assignments. Because the element persists, so does the
// tile field's keyboard focus — no refocus hack.
//
// EVENTS heard here (from the leaves): sm-pick-tool, sm-arm-eyedropper,
// sm-pick-color, sm-pick-transparent, sm-open-picker, sm-close,
// sm-set-pencil-size, sm-set-corner-radius, sm-set-fill-opts.
// EVENTS passing through to the dock (main.js): sm-select-face, sm-live,
// sm-replace-all-tiles — plus sm-resize-tile emitted by the tile field here.
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { LitElement, html } from 'lit';
import { live } from 'lit/directives/live.js';
import { maxCornerRadius } from '../lib/rect.js';
import { session, RECENT_SLOTS } from '../state/session.js';
import { StoreController } from '../state/store-controller.js';
import './sm-face-picker.js'; // registers <sm-face-picker>
import './sm-tool-strip.js'; // registers <sm-tool-strip>
import './sm-color-wells.js'; // registers <sm-color-wells>
import './sm-tool-options.js'; // registers <sm-tool-options>
import './sm-color-picker.js'; // registers <sm-color-picker>
import './sm-draw-canvas.js'; // registers <sm-draw-canvas>

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

    // The shared editor-session slice holds the brush state; this controller
    // re-renders the element on any session action. The getters below read it,
    // so the template keeps plain `this.tool` / `this.ink` reads.
    new StoreController(this, session.store);

    // One-shot canvas dev hooks (?cursor / ?rect / ?fill paint halves) —
    // assigned by main.js before docking, handed to <sm-draw-canvas>, consumed
    // there on its first update.
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
    return Math.max(1, Math.min(this.tileW || 1, this.tileH || 1));
  }
  get #radiusMax() {
    return maxCornerRadius(this.tileW || 1, this.tileH || 1);
  }

  willUpdate(changed) {
    // A tile resize can leave a persisted pencil size / corner radius past the
    // new bounds — the clamp itself lives in the session action.
    if (changed.has('tileW') || changed.has('tileH')) {
      session.clampTools(this.#brushMax, this.#radiusMax);
    }
  }

  // --- template --------------------------------------------------------------
  render() {
    return html`
      <div class="editor">
        <div class="editor-settings">
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
          <sm-face-picker .faces=${this.faces} .selected=${this.face}></sm-face-picker>
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
              .tile=${this.tile}
              .tileW=${this.tileW}
              .tileH=${this.tileH}
              .mirrorBehind=${this.mirrorBehind}
              .guides=${this.guides}
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
              @sm-pick-color=${this.#onPickColor}
              @sm-pick-transparent=${() => session.selectTransparent()}
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

  #onTileSize = (e) => {
    const n = e.detail.valueAsNumber;
    if (Number.isFinite(n) && n !== this.tileW) {
      // Light DOM ⇒ no `composed` needed; the dock hears it on the way up.
      this.dispatchEvent(
        new CustomEvent('sm-resize-tile', { detail: { size: n }, bubbles: true })
      );
    }
  };
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-editor')) customElements.define('sm-editor', SmEditor);
