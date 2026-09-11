// ---------------------------------------------------------------------------
// <sm-options-bar> — the settings strip under the menu bar: the current-ink
// swatch (every tool that paints — the eraser and the selection hide it;
// clicking it opens the Colors dialog) and the per-tool options
// (<sm-tool-options>: the pencil's tip-shape popup + tip slider, the
// eraser's own pair of the same, the rect's radius stepper
// beside a READOUT of its drag in flight, fill checkboxes, the selection's
// READOUT alone — a tool with no settings, whose strip says what it has
// instead: the active window's marquee, live; each readout the box's size
// as width × height, `0 × 0` for none). THE CELLS ARE WALLED: the kit's own
// `<vf-separator vertical>` — a 1-system-px rule that stretches itself to
// the row's height, so the wall runs from the band's top to its bottom rule,
// drawn DOTTED (one px on, one off — `--vf-separator-style`, the kit's
// restyle hook, set on the row below; the color the kit's black) —
// stands between the swatch and the tool's options whenever BOTH are up
// (the pencil, the rect, the fill; never a rule dangling after the
// eyedropper's lone swatch, and none in a strip with no swatch), the seam
// between the ink (app-level) and the tool's own settings; the rect's
// second wall, between its stepper and its readout, is the leaf's
// (sm-tool-options, whose header states the grammar: a rule separates
// different things, never a control from its own readout). No
// tool-name caption: the Tools palette's inverted cell and the Tools menu's
// checkmark already say which tool is live. A fixed strip, not a window —
// blank when a tool has no options (the standing preference for persistent,
// in-flow controls over popups), and — like the utility windoids — on screen
// only while the application is active: a desktop click hides the whole
// band, and it returns with the app.
//
// THE BAND IS A KIT CONTAINER: the strip is a `<vf-container fill-width
// height="36" pattern="white" rule="bottom">` — the menu bar's own anatomy in
// the kit's grammar (white paper over one row of ink, NO drop shadow: a
// chrome band, not a raised panel), so the rule and every metric here ride
// --vf-scale. The rule is the box's own border inside the declared height,
// so the band is 35 rows of paper over the line and its box bottoms out at
// exactly TOP_RESERVE (20 + 36 = 56); the flex row inside fills the paper to
// the rule (`fill-height`, the container's own word for it).
//
// A CONNECTED chrome component: session (tool + ink + option values) and doc
// (the clamp bounds derive from the live tile geometry) drive it; every leaf
// event becomes a session action. `:host` IS the strip — the desktop lays it
// out in flow right under the menu bar (shell/layout.js's TOP_RESERVE keeps
// the window tier clear of the band).
//
// ---------------------------------------------------------------------------

import 'vintage-frames';
import { css, LitElement, html, nothing } from 'lit';
import { maxCornerRadius } from '../lib/rect.js';
import { rgbToHex } from '../lib/color.js';
import { session } from '../state/session.js';
import { shell } from '../state/shell.js';
import { workspace } from '../state/workspace.js';
import { StoreController, ActiveDocController } from '../state/store-controller.js';
import { baseStyles } from './base-styles.js';
import { SmToolOptions } from './sm-tool-options.js'; // registers <sm-tool-options>

export class SmOptionsBar extends LitElement {
  static styles = [
    baseStyles,
    css`
      :host {
        display: block;
        /* The band's tier: over every window and icon, under the menu tier
           (see the header). */
        position: relative;
        z-index: 1500000;
      }
      /* The row inside the band (see header): fills the paper to the rule and
       lays the controls out; every length in system px rides --vf-scale. The
       gap is the gutter on either side of a cell wall (12, the leaf's own —
       it was 24 while the space alone stood in for a rule); the wall itself
       stretches to this row's height, the band's paper. */
      .strip {
        display: flex;
        align-items: center;
        gap: calc(var(--vf-scale, 1) * 12px);
        padding: 0 calc(var(--vf-scale, 1) * 14px);
        /* The walls are DOTTED — one px on, one off — through the kit's own
           restyle hook for its separator (the one vf-menu sets for its rule);
           the color stays the kit's black (the menu dims its own). A custom
           property, so it inherits into the leaf's shadow root and the rect's
           inner wall reads the same. At 1 system px a CSS dotted border is a
           1×1 on/off run, and the band's 35 rows (70 at 2×) are an odd count,
           so the run fits with a dot at each end and nothing stretched. */
        --vf-separator-style: dotted;
      }
    `,
  ];

  constructor() {
    super();
    new StoreController(this, session.store);
    new StoreController(this, shell.store);
    // The clamp bounds derive from the ACTIVE document's tile geometry — the
    // strip's controls apply to whichever window is being edited — and the
    // readouts follow its outlines, the marquee and the rect drag (opt-in:
    // this strip is the one host that shows them, so the per-move re-render
    // lands here alone).
    new ActiveDocController(this, workspace, { selection: true });
  }

  /** The active window's selection outline, for the readout (null: none). */
  get #activeSelection() {
    return workspace.active()?.selection.get().bounds ?? null;
  }
  /** The active window's rect drag in flight, for the readout (null: none). */
  get #activeRectDrag() {
    return workspace.active()?.selection.get().rect ?? null;
  }

  // The same geometric bounds the editor derives: tips capped at the tile
  // edge, the radius at half the shorter side (the clamping itself lives in
  // the session actions).
  get #activeDoc() {
    return workspace.active()?.doc.get() ?? null;
  }
  get #brushMax() {
    const d = this.#activeDoc;
    return Math.max(1, Math.min(d?.tileW || 1, d?.tileH || 1));
  }
  get #radiusMax() {
    const d = this.#activeDoc;
    return maxCornerRadius(d?.tileW || 1, d?.tileH || 1);
  }

  render() {
    // Desktop focused: the strip belongs to the application, so — like the
    // utility windoids — the whole band hides (the desktop dither runs right
    // up to the menu bar, the Finder look), returning with the app. The
    // window clamp still reserves its space (TOP_RESERVE), so windows never
    // shuffle when it comes back.
    if (!shell.get().appActive) return nothing;
    return html`<vf-container fill-width height="36" pattern="white" rule="bottom">
      <div class="strip" fill-height>${this.#content()}</div>
    </vf-container>`;
  }

  #content() {
    const s = session.get();
    return html`
      ${this.#inkSwatch(s)}${this.#wall(s)}
      <sm-tool-options
        .tool=${s.tool}
        .pencilSize=${s.pencilSize}
        .pencilShape=${s.pencilShape}
        .eraserSize=${s.eraserSize}
        .eraserShape=${s.eraserShape}
        .brushMax=${this.#brushMax}
        .cornerRadius=${s.cornerRadius}
        .radiusMax=${this.#radiusMax}
        .fillContiguous=${s.fillContiguous}
        .fillAllFaces=${s.fillAllFaces}
        .selection=${this.#activeSelection}
        .rectDrag=${this.#activeRectDrag}
        @sm-set-pencil-size=${(e) => session.setPencilSize(e.detail.n, this.#brushMax)}
        @sm-set-pencil-shape=${(e) => session.setPencilShape(e.detail.shape)}
        @sm-set-eraser-size=${(e) => session.setEraserSize(e.detail.n, this.#brushMax)}
        @sm-set-eraser-shape=${(e) => session.setEraserShape(e.detail.shape)}
        @sm-set-corner-radius=${(e) =>
          session.setCornerRadius(e.detail.n, this.#radiusMax)}
        @sm-set-fill-opts=${this.#onFillOpts}
      ></sm-tool-options>
    `;
  }

  // The current-ink swatch: shown for every tool that paints — the eraser
  // (transparency) and the selection (it moves pixels, never lays any) hide
  // it — a lone well standing in for the current color, the case the kit
  // says wants the hard `shadow`. Clicking it opens the Colors dialog (⌘K
  // still works with any tool; an Alt-sample still changes the ink).
  static showsSwatch(tool) {
    return tool !== 'eraser' && tool !== 'select';
  }

  // The wall between the swatch and the tool's options: the kit's vertical
  // rule, only when both cells are up (see the header) — the leaf says
  // whether the tool has options at all.
  #wall(s) {
    if (!SmOptionsBar.showsSwatch(s.tool) || !SmToolOptions.hasOptions(s.tool))
      return nothing;
    return html`<vf-separator vertical></vf-separator>`;
  }

  #inkSwatch(s) {
    if (!SmOptionsBar.showsSwatch(s.tool)) return nothing;
    return html`
      <vf-swatch
        class="editor-selected"
        width="36"
        height="20"
        shadow
        color=${rgbToHex(s.ink)}
        label="selected color — open the color picker"
        title="selected color — open the color picker"
        @click=${() => session.openPicker()}
      ></vf-swatch>
    `;
  }

  #onFillOpts = (e) => {
    const { contiguous, allFaces } = e.detail;
    if (contiguous !== undefined) session.setFillContiguous(contiguous);
    if (allFaces !== undefined) session.setFillAllFaces(allFaces);
  };
}

// Guarded so Vite's HMR re-executing this module can't throw on a second define.
if (!customElements.get('sm-options-bar'))
  customElements.define('sm-options-bar', SmOptionsBar);
