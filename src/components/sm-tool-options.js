// ---------------------------------------------------------------------------
// <sm-tool-options> — the draw box's per-tool options bar: the pencil's
// tip-size slider (with a live readout), the eraser's OWN tip-size slider (an
// independent setting and a deliberately separate branch — not a DRY slip; the
// two tools' options may diverge), the rect's corner-radius field beside a
// READOUT of the drag in flight (its box's width × height in texels, live
// through the drag, `0 × 0` at rest), the fill's two checkboxes, or the
// selection's READOUT alone — a tool with no settings: its strip states the
// active window's marquee as width × height in texels, live through a drag,
// `0 × 0` for none — and nothing for the eyedropper (its strip is just the
// ink swatch). A readout is the SIZE alone, never the position (the
// `left, top ·` prefix went Sep 5 2026: "just the width and height"). And
// every label in the strip is plain ink — no `dim` on a caption or a readout
// (they went the same day: a readout is a value and a caption names a live
// control, and the kit's dim is the disabled look; the strip has nothing
// disabled in it). THE STRIP'S CELLS ARE WALLED by the kit's own rule —
// `<vf-separator vertical>`, a 1-system-px line that stretches itself to its
// flex row's height (`align-self: stretch` is the kit's, so the wall runs
// from the band's top to its bottom rule) — and a rule stands between
// DIFFERENT things only: the bar puts one between the ink swatch and the
// tool's options whenever both are up (sm-options-bar), and the rect's
// branch here puts one between the radius stepper (a setting) and the
// readout (a value); never between a control and its own readout — the
// pencil's slider and its `N px` are one cell, the fill's two boxes one
// group. For a wall in this leaf to reach the band the host itself
// stretches to the row's height (its own `align-self: stretch` below — the
// bar centers its children, which would otherwise shrink-wrap the host to
// its tallest control). A presentational LEAF: props down (`tool`, values +
// clamp BOUNDS — the clamping itself lives in the session actions the
// container calls — and the two outlines, `selection` / `rectDrag`),
// bubbling `sm-set-pencil-size {n}` / `sm-set-eraser-size {n}` /
// `sm-set-corner-radius {n}` / `sm-set-fill-opts {contiguous?|allFaces?}`
// events up. `live()` bindings throughout, so a re-render can't skip a
// re-sync after typing.
//
// This element IS the options area (`:host` carries the box — it fills the
// desktop's options strip beside the current-ink swatch); its shadow root
// holds the bare controls, exactly the surface drive.mjs probes (the LAST
// vf-label is the readout it reads).
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { css, LitElement, html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import { baseStyles } from './base-styles.js';

export class SmToolOptions extends LitElement {
  // The one sm-* host with a REAL box (no `display: contents`): this element
  // IS the options area, so `:host` carries its flex-row layout. The strip
  // around it (sm-options-bar) paints the white band; this host stays
  // chromeless and just lays its controls out.
  static styles = [
    baseStyles,
    css`
      /* Kit-scaled metrics: the strip band is drawn in system px (a kit
       vf-container band), so the lengths in it ride the same --vf-scale. */
      :host {
        flex: 1;
        min-width: 0;
        /* The band's full height (the bar's row centers its children, which
           would shrink-wrap this box to its tallest control): a vertical rule
           in here stretches to THIS box, and the wall must run from the
           band's top to its bottom rule. The controls still center inside. */
        align-self: stretch;
        display: flex;
        align-items: center;
        gap: calc(var(--vf-scale, 1) * 12px);
      }
      .editor-size-slider {
        flex: 1;
        max-width: calc(var(--vf-scale, 1) * 260px);
      }
    `,
  ];

  static properties = {
    tool: {},
    pencilSize: { type: Number },
    eraserSize: { type: Number },
    brushMax: { type: Number },
    cornerRadius: { type: Number },
    radiusMax: { type: Number },
    fillContiguous: { type: Boolean },
    fillAllFaces: { type: Boolean },
    /** The selection tool's readout: the active window's current marquee
     *  {x0,y0,x1,y1} in texels (may hang off the tile), or null for none. */
    selection: { attribute: false },
    /** The rect tool's readout: the active window's drag in flight
     *  {x0,y0,x1,y1} in texels (the box as the release would paint it, the
     *  Shift square-lock applied), or null between drags. */
    rectDrag: { attribute: false },
  };

  constructor() {
    super();
    this.tool = 'pencil';
    this.pencilSize = 1;
    this.eraserSize = 1;
    this.brushMax = 1;
    this.cornerRadius = 0;
    this.radiusMax = 0;
    this.fillContiguous = true;
    this.fillAllFaces = false;
    this.selection = null;
    this.rectDrag = null;
  }

  /** A box's size as the readouts state it — `width × height` in texels,
   *  inclusive bounds; `0 × 0` for none (the resting readout, so the strip
   *  always carries the same label in the same place). */
  static size(b) {
    return b ? `${b.x1 - b.x0 + 1} × ${b.y1 - b.y0 + 1}` : '0 × 0';
  }

  /** Does this tool put anything in the options area? The eyedropper alone
   *  does not (render's final `nothing`) — the bar asks before walling the
   *  ink swatch off from an options cell that would be empty. */
  static hasOptions(tool) {
    return tool !== 'eyedropper';
  }

  render() {
    if (this.tool === 'pencil') {
      // vf-input fires on every drag move / key change, so the hover footprint
      // tracks the slider in real time.
      return html`
        <vf-slider
          class="editor-size-slider"
          min="1"
          max=${this.brushMax}
          step="1"
          .value=${live(this.pencilSize)}
          label="pencil size (1–${this.brushMax})"
          @vf-input=${(e) => this.#emit('sm-set-pencil-size', { n: e.detail.value })}
        ></vf-slider>
        <vf-label>${this.pencilSize} px</vf-label>
      `;
    }
    if (this.tool === 'eraser') {
      // Mirrors the pencil's slider but binds the eraser's own size — kept as
      // its own branch on purpose (see the header note).
      return html`
        <vf-slider
          class="editor-size-slider"
          min="1"
          max=${this.brushMax}
          step="1"
          .value=${live(this.eraserSize)}
          label="eraser size (1–${this.brushMax})"
          @vf-input=${(e) => this.#emit('sm-set-eraser-size', { n: e.detail.value })}
        ></vf-slider>
        <vf-label>${this.eraserSize} px</vf-label>
      `;
    }
    if (this.tool === 'rect') {
      // The radius stepper, a rule, then the readout: the box being dragged
      // as width × height (the square-locked box, the one the release
      // paints), `0 × 0` between drags — the label always there, so nothing
      // shifts when a drag begins. The rule walls a setting off from a value
      // (the header's grammar), the kit's own vertical separator.
      return html`
        <vf-label>radius</vf-label>
        <vf-number-field
          min="0"
          max=${this.radiusMax}
          step="1"
          .value=${live(String(this.cornerRadius))}
          label="corner radius (0–${this.radiusMax})"
          @vf-change=${(e) =>
            this.#emit('sm-set-corner-radius', { n: e.detail.valueAsNumber })}
        ></vf-number-field>
        <vf-separator vertical></vf-separator>
        <vf-label title="rectangle: width × height (texels)"
          >${SmToolOptions.size(this.rectDrag)}</vf-label
        >
      `;
    }
    if (this.tool === 'fill') {
      // "contiguous" (the default) keeps the click a 4-connected flood; off, it
      // recolors every matching texel on the face — and "on all faces" (only
      // meaningful with contiguous off) extends that recolor across the atlas.
      return html`
        <vf-checkbox
          .checked=${live(this.fillContiguous)}
          title="fill only the connected region sharing the clicked color; off recolors every matching texel on the face"
          @vf-change=${(e) =>
            this.#emit('sm-set-fill-opts', { contiguous: !!e.detail.checked })}
          >contiguous</vf-checkbox
        >
        <vf-checkbox
          .checked=${live(this.fillAllFaces)}
          ?disabled=${this.fillContiguous}
          title="recolor the clicked color across every face in the atlas"
          @vf-change=${(e) =>
            this.#emit('sm-set-fill-opts', { allFaces: !!e.detail.checked })}
          >on all faces</vf-checkbox
        >
      `;
    }
    if (this.tool === 'select') {
      // A readout, not a setting: the marquee's size in texels — the whole
      // float's, so a move holds it steady and a float pushed off the tile
      // still reads its full size — and `0 × 0` with nothing selected (a
      // "no selection" caption stood here until Sep 5 2026).
      return html`
        <vf-label title="selection: width × height (texels)"
          >${SmToolOptions.size(this.selection)}</vf-label
        >
      `;
    }
    return nothing;
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  }
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-tool-options'))
  customElements.define('sm-tool-options', SmToolOptions);
