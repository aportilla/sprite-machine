# Lit adoption plan

Replace the editor UI's manual DOM construction (`document.createElement` +
`setAttribute` + hand-rolled re-render functions) with **Lit templates and
reactive state**. `vintage-frames` is already a LitElement kit, so `lit` is
already in our module graph — we'd be adopting the library we already ship,
not adding one.

## Why

`src/editor.js` (1191 lines) and `src/ui.js` (229 lines) build every element
imperatively and then keep the DOM in sync by hand. The specific shenanigans:

- **Three hand-rolled re-render paths** — `syncUI()` (classList toggles across
  five buttons + the canvas cursor class), `renderToolOptions()` (`innerHTML = ''`
  and rebuild on every tool switch), `renderRecent()` (`innerHTML = ''` and
  rebuild on every ink pick). Each is a manual, partial implementation of what
  `render()` does wholesale: state → DOM, diffed.
- **A destroy/re-mount lifecycle** — switching face, resizing the tile, or an
  all-tiles replace tears down the whole editor (`destroy()`: document-level
  key listeners, a ResizeObserver, the picker dialog on `<body>`,
  `container.innerHTML = ''`) and rebuilds it from scratch. The `brush` object
  lives in `main.js` _only_ so tool/ink/recency survive that re-mount, and the
  `focusSize` parameter exists _only_ to hand focus back to the tile-size field
  the re-mount just destroyed.
- **Stringly-typed component wiring** — every `vf-*` element is driven through
  `setAttribute` and `/** @type {any} */` casts; initial state and updates take
  different code paths (e.g. `vf-checkbox` gets a `checked` attribute at build
  time but a `.checked` property in `syncControls`).

What Lit replaces: all of the above collapse into template expressions over
reactive state — one `render()` describes the DOM for any state, and updates
are diffs, not rebuilds. What Lit deliberately does **not** replace: roughly
half of editor.js is canvas painting, pointer/drag geometry, and layout math
(`layout()`, `stroke()`, `drawCursor()`, `drawRectPreview()`, the Bresenham
walk, the texel math). That is imperative 2D work on raw buffers and stays
exactly as it is, behind refs. The win is deleting the _synchronization_ code,
not the _drawing_ code.

## Decisions (with recommendations)

### 1. LitElement components, not bare `lit-html` render calls

`lit-html` alone would keep closure-state + manual `update()` calls — better
than today, but still hand-scheduled. **LitElement's reactive properties**
give us scheduling for free (mutate state → batched async re-render), plus
`connectedCallback`/`disconnectedCallback` for exactly the lifecycle work
`destroy()` does by hand today. It's also the idiom `vintage-frames` itself
uses, so one mental model covers both codebases.

Plain-JS flavor (this repo is checkJs, no decorators):

```js
static properties = { face: {}, tool: { state: true }, ... };
constructor() { super(); this.tool = 'pencil'; ... }  // NEVER class fields — see Risks
```

### 2. Light-DOM rendering (`createRenderRoot() { return this; }`)

No shadow root for our components, for three load-bearing reasons:

- **`style.css` keeps working untouched.** Every `.editor-*` / `.stage-*` rule
  targets light-DOM classes; shadow DOM would orphan all of it and force a
  simultaneous CSS migration into `static styles` (which are shadow-scoped and
  a silent no-op in light DOM — don't mix).
- **`tools/capture.sh dom` stays inspectable.** `--dump-dom` serializes light
  DOM only; our markup staying light keeps headless verification able to see
  the editor's structure ([[visual-verification]] workflow).
- We need no slot machinery, no style encapsulation, and the editor already
  does document-level key handling — encapsulation buys nothing here.

Shadow DOM per component is a possible later step (Phase 4), not part of this
migration.

### 3. One `<sm-editor>` element first, not a component tree

Port `createTileEditor` as a single `<sm-editor>` with private template
_functions_ for its regions (settings row, tool strip, color wells, options
bar, picker dialog). Splitting into `sm-face-picker` / `sm-color-wells` /
etc. multiplies property-plumbing for no reactivity gain at this size; the
natural seams are noted in Phase 4 if `render()` ever gets unwieldy. `ui.js`
is small enough that bare `lit-html` `render()` into its existing containers
suffices — no component needed.

### 4. Classify state explicitly: reactive vs. plain fields

This is the correctness core of the migration. Reactive state is what the
_template_ reads; everything the canvas hot paths touch stays plain fields so
a pencil drag can never schedule template re-renders at pointer-move rate.

| Reactive (`static properties`)                                                                   | Plain private fields (never trigger renders)                                                                  |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `face`, `tile`, `tileW/tileH`, `guides`, `mirrorBehind`, `faces`, `sizeMin/Max` (set by main.js) | `#work`, `#imgData`, `#dirty` (the pixel buffer — shared by reference with `ImageData`, must never be diffed) |
| `tool`, `erase`, `picking`, `ink`, `recent` (internal state; today's `brush`)                    | `#drawing`, `#prev`, `#forceErase`, `#hoverTexel` (stroke state)                                              |
| `pencilSize`, `cornerRadius`, `fillReplace`, `fillAllTiles`                                      | `#rectStart/#rectEnd/#rectPointer/#shiftLock` (drag state)                                                    |
| `pickerOpen`                                                                                     | `#scale/#cssW/#cssH/#laidOut` (layout), `#resizeObs`, element refs                                            |

Rule of thumb: if `syncUI()`/`renderToolOptions()`/`renderRecent()` reads it
today, it's reactive; if only a canvas context reads it, it's a field.
(`pencilSize` and `cornerRadius` are both — the slider readout/template reads
them AND the cursor overlay does; they go reactive, and the overlay redraw
rides `updated()`.)

### 5. Controlled `vf-*` bindings, with `live()` where the user can type

Templates re-assert bindings on every render, which can fight a component's
internal state. The pattern, uniformly: **bind our state down, listen to
`vf-change`/`vf-input` up, and route user edits back into our state** — the
controlled-component contract. Two sharpenings:

- `vf-number-field` / `vf-slider` values get `live()`
  (`.value=${live(this.tileW)}`) so the diff compares against the _DOM's_
  current value, not the last-rendered one — otherwise a re-render after user
  typing can silently skip the re-sync.
- Bind properties (`.value=`, `.checked=`, `?disabled=`), not attributes, for
  anything stateful; attributes only for genuinely static config
  (`columns="16"`, `cell-width="12"`). This also kills most of the
  `/** @type {any} */` casts (the `CustomEvent` detail casts stay).

The interop table for every component we use (full component reference:
<https://aportilla.github.io/vintage-frames>; machine-readable API in the
package's `custom-elements.json`):

| Component                                                    | Down (bindings)                                          | Up (events)                         |
| ------------------------------------------------------------ | -------------------------------------------------------- | ----------------------------------- |
| `vf-number-field`                                            | `.value=${live(n)}` `min=` `max=` `label=`               | `@vf-change` (detail.valueAsNumber) |
| `vf-slider`                                                  | `.value=${live(n)}` `min=` `max=`                        | `@vf-input` (live) / `@vf-change`   |
| `vf-checkbox`                                                | `.checked=${b}` `?disabled=${b}`                         | `@vf-change` (detail.checked)       |
| `vf-radio-group`/`vf-radio`                                  | `.value=${face}` on the group; `value=` per radio        | `@vf-change` (detail.value)         |
| `vf-swatch`                                                  | `color=${ifDefined(hex)}` (undefined ⇒ checker)          | `@click`                            |
| `vf-dialog`                                                  | `.open=${this.pickerOpen}` (sync'd w/ native `<dialog>`) | `@vf-close`                         |
| `vf-menu`/`vf-menu-item`                                     | static                                                   | `@vf-menu-select` (detail.value)    |
| `vf-grid`, `vf-separator`, `vf-label`, `vf-img`, `vf-button` | static attributes                                        | —                                   |

Note the wins hiding in that table: the current-ink swatch's
`removeAttribute('color')` dance becomes `ifDefined(clear ? undefined : hex)`,
and the picker dialog's `ensurePicker`/`openPicker`/`closePicker`/`pickerOpen`
bookkeeping becomes one boolean — `vf-dialog.show()` is verbatim
`this.open = true` routed through the same `updated()` sync the property
binding takes (`modal-dialog.js`), so `.open=${…}` + `@vf-close` is fully
equivalent; and its native `<dialog>` is top-layer, so the dialog can live in
our template instead of being appended to `<body>` (the "never clipped"
workaround is unnecessary under `showModal()`).

### 6. Callbacks become DOM events

`onLive`/`onSelectFace`/`onResizeTile`/`onReplaceAllTiles` become bubbling
`CustomEvent`s (`sm-live`, `sm-select-face`, `sm-resize-tile`,
`sm-replace-all-tiles`) that `main.js` listens for on the dock — the same
pattern `vintage-frames` uses toward us. (Light DOM ⇒ no `composed` needed;
`bubbles: true` suffices.)

## Target shape

```js
// src/components/sm-editor.js
import { LitElement, html, nothing } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { live } from 'lit/directives/live.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { repeat } from 'lit/directives/repeat.js';
import { createRef, ref } from 'lit/directives/ref.js';

class SmEditor extends LitElement {
  static properties = { /* per the state table */ };
  createRenderRoot() { return this; } // light DOM — style.css + capture.sh dom keep working

  render() {
    return html`
      <div class="editor">
        <div class="editor-settings">${this.#settingsRow()}</div>
        <vf-separator class="editor-sep"></vf-separator>
        <div class="editor-main">
          <div class="editor-rail">${this.#toolStrip()} ${this.#colorWells()}</div>
          <div class="editor-drawbox">
            <div class="editor-opts">${this.#toolOptions()}</div>
            <div class="editor-canvas-wrap" ${ref(this.#wrap)}>${this.#canvasStack()}</div>
          </div>
        </div>
        ${this.#pickerDialog()}
      </div>`;
  }

  // Today's renderToolOptions(), as a branch instead of an innerHTML rebuild:
  #toolOptions() {
    if (this.tool === 'pencil')
      return html`<vf-slider .value=${live(this.pencilSize)} min="1"
          max=${this.#brushMax} label="pencil size (1–${this.#brushMax})"
          @vf-input=${this.#onSize}></vf-slider>
        <vf-label dim>${this.pencilSize} px</vf-label>`;
    if (this.tool === 'rect') return html`…`;
    if (this.tool === 'fill') return html`…`;
    return nothing;
  }

  // Today's renderRecent(), keyed so swatches move instead of rebuilding:
  #recentRow() {
    return repeat(this.recent.slice(1, 4), rgbKey, (c) => html`
      <vf-swatch width="16" height="16" color=${rgbHex(c)}
        @click=${() => this.#selectColor(c)}></vf-swatch>`);
  }

  connectedCallback()    { super.connectedCallback();  document.addEventListener('keydown', this.#onKeyDown); … }
  disconnectedCallback() { super.disconnectedCallback(); document.removeEventListener('keydown', this.#onKeyDown); … }

  willUpdate(changed) {
    // The re-mount, relocated: when face/tile/tileW arrive, rebuild #work +
    // #imgData together, reset drag state, clamp pencilSize/cornerRadius.
    if (changed.has('tile') || changed.has('tileW')) this.#resetWorking();
  }
  updated(changed) {
    // Imperative tail: canvas backing stores, repaint, layout(), overlay redraws.
  }
}
if (!customElements.get('sm-editor')) customElements.define('sm-editor', SmEditor);
```

The pointer/keyboard/painting function bodies move across **verbatim** — they
mutate plain fields and paint contexts. Only their _registration_ (template
`@pointerdown=` bindings on the canvas, `connectedCallback` for document
listeners) and the calls to the dead sync functions change.

What each of today's mechanisms maps to:

| Today                                                | After                                                       |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| `el()` / `caption()` + `append` chains               | `html` templates                                            |
| `syncUI()` classList toggles                         | `classMap({ active: this.tool === 'pencil' })` etc.         |
| `renderToolOptions()` innerHTML rebuild              | `#toolOptions()` branch                                     |
| `renderRecent()` innerHTML rebuild                   | `repeat(…, rgbKey, …)`                                      |
| `syncPreview()` set/removeAttribute                  | `color=${ifDefined(…)}`                                     |
| `ensurePicker()` lazy build + open/close bookkeeping | `.open=${this.pickerOpen}` + a lazy `#pickerBuilt` latch    |
| `destroy()` (listeners, observer, dialog, innerHTML) | `disconnectedCallback()` — and in Phase 3, mostly _nothing_ |
| caller-owned `brush` for re-mount survival           | internal reactive state on a persistent element (Phase 3)   |
| `focusSize` refocus hack                             | deleted — the field never unmounts (Phase 3)                |
| `onXxx` callback options                             | bubbling `sm-*` CustomEvents                                |

## Phases

Each phase lands green (`npm test` · `typecheck` · `lint`) and
screenshot-verified before the next starts.

### Phase 0 — dependency + conventions

- `package.json`: add `"lit": "^3.3.0"` to `dependencies`. It resolves to the
  copy `vintage-frames` already hoisted (`^3.2.0` — same major), so verify
  **one** copy with `npm ls lit` and confirm the built bundle size is ~flat.
- Conventions (this document is the reference): light-DOM render roots,
  `sm-` tag prefix, `static properties` + constructor init (never class
  fields), guarded `customElements.define`.

### Phase 1 — pilot on `ui.js` (small, exercises every interop pattern)

Convert `createUI` to lit-html `render()` calls into its existing containers
(`#topbar`, `.stage-controls`, `.stage-stats`, the drop overlay). The
reactive payoffs are `setStats`/`setError` (today: `innerHTML = ''` +
rebuild) and `syncControls` (today: property pokes) — both become one
`renderStats(model)` / `renderControls(state)` re-render. The menu, drop
overlay, and header become static templates in the same pass.

_Acceptance:_ pixel-identical `capture.sh` shots of the default boot, a
warnings case (`?tile=12x30` — the non-square shear warning), and `?lowpoly=0`
(exercises the controlled checkbox). DOM dump shows the same classes.

### Phase 2 — `<sm-editor>`, one-for-one (the big one)

Port `createTileEditor` into `src/components/sm-editor.js` per the sketch,
**keeping the external contract**: `main.js`'s `mountEditor` still creates a
fresh element per face swap / resize (`document.createElement('sm-editor')`,
assign properties, swap into the dock), so all re-mount semantics — derived
faces, `wasDerived`, one-shot dev hooks — are provably untouched while the
whole interior changes. Callbacks become `sm-*` events wired at mount.
`brush` stays caller-owned this phase: the element copies it in on mount and
writes changes back through, so persistence still works the old way.

Template reproduces **today's DOM shape and class names exactly** — they are
load-bearing for `style.css` and for capture crops.

Dev hooks (`openPaletteOnMount`, `previewCursor`, `previewRect`, `pickIndex`,
`fillOnMount`) become properties consumed once in `firstUpdated()`.

_Acceptance:_ the full dev-hook screenshot suite, before/after (see
Verification); the keyboard checklist (B/R/G/I/E, Esc mid-drag, Shift lock,
Alt-eyedrop, typing in the tile field not hijacked); typecheck clean with the
`@type {any}` cast count reduced.

### Phase 3 — persistence: delete the re-mount

One `<sm-editor>` created at boot and never destroyed. Face swap, tile
resize, and all-tiles replace become property assignments; `willUpdate`
re-derives the working buffer and resets drag state when `face`/`tile`/`tileW`
change (this relocation of "what re-initializes when" is the phase's whole
risk — the checklist is the state table above).

Deletions this unlocks in `main.js` + the component:

- the `brush` object and its threading (tool/ink/recency are now just
  component state that persists because the element does);
- `mountEditor`'s destroy/create dance and `currentEditor` tracking;
- the `focusSize` refocus hack (the number field never unmounts — focus
  survives a resize natively);
- per-mount picker dialog rebuild (built once, ever);
- most of `disconnectedCallback`'s reason to exist.

`main.js` keeps ownership of `state.views`, `freshTile`, `wasDerived`
computation, and all pipeline work — unchanged.

_Acceptance:_ type `40`→`41`→`42` in the tile field and keep typing with no
refocus code; open the palette, swap faces, palette state sane; the derived
lifecycle (open derived → paint → becomes real → erase fully → derived again)
per README; screenshot suite again.

### Phase 4 — optional, explicitly deferred

- Split `sm-face-picker` / `sm-color-picker-dialog` out if `render()` sprawls.
- `faceIcon()` → a template function (it already returns elements; today's CSS
  `:has()` selected-overlay mechanism keeps working either way).
- Shadow DOM + `static styles` per component, retiring the `.editor-*` section
  of `style.css` — only if components ever need to live outside this app;
  costs dom-dump inspectability.

## Risks & gotchas

| Risk                                                                                                     | Mitigation                                                                                                                  |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Class fields silently kill reactivity** (a JS field shadows the accessor `static properties` installs) | Initialize every reactive prop in the constructor; never declare it as a field. Phase-2 smoke test: tool switch re-renders. |
| Re-renders during drags (perf + preview flicker)                                                         | State classification table; pointer handlers touch only plain fields; overlay redraws stay canvas-only.                     |
| Template bindings fighting `vf-*` internal state / user typing                                           | Controlled pattern everywhere; `live()` on user-editable values.                                                            |
| Binding `<canvas>` width/height in the template clears backing stores mid-diff                           | Canvas sizing + `ImageData` reconstruction stay imperative in `willUpdate`/`updated`, paired (they share one buffer).       |
| `vf-radio-group` re-syncs via MutationObserver when children re-render                                   | Bind `.value` on the group only; radios render with stable static attrs; verify no checked-flicker in Phase 2 shots.        |
| `customElements.define` throws on Vite HMR re-execution                                                  | Guard with `customElements.get()`; editor edits already trigger full reload today (no `hot.accept`).                        |
| `static styles` are a no-op in light DOM                                                                 | All styles stay in `style.css` until/unless Phase 4.                                                                        |
| Events not reaching `main.js`                                                                            | `bubbles: true` on all `sm-*` events; listeners on the dock.                                                                |
| Phase-3 re-init drift (something the old re-mount reset, the persistent element doesn't)                 | Phase 2 ships the 1:1 port first so Phase 3's diff is _only_ lifecycle; acceptance list pins the known resets.              |

## Non-goals

- `src/lib/**` (the pure pipeline), `main.js`'s THREE scene/render loop, the
  Node test suites, and `tools/capture.sh` are untouched.
- No visual changes whatsoever: class names, DOM shape (Phase 2), and
  therefore every screenshot, are preserved.
- No TypeScript conversion, no decorators, no SSR/testing-library adoption.

## Verification

Before/after each phase, the shot suite (dev server up, then
`tools/capture.sh shot '<url>' <out.png>` and compare):

```
?sample=car&edit=front&rotate=0            # editor baseline
?sample=car&edit=bottom&rotate=0           # face picker checked-state overlay
?sample=car&edit=front&palette=1&rotate=0  # 256-color dialog
?sample=car&edit=front&cursor=7&rotate=0   # pencil footprint preview
?sample=car&edit=front&pick=196&rotate=0   # ink landing on the swatch
?sample=car&edit=front&rect=4,4,20,14,3&rotate=0     # rect drag preview
?sample=car&edit=front&rect=4,4,20,14,0,1&rotate=0   # Shift square-lock
?sample=car&edit=front&fill=1,1,1&rotate=0 # fill + replace checkbox
?sample=car&tile=12x30&rotate=0            # warnings in the stats overlay
?lowpoly=0&diag=1&rotate=0                 # controlled checkbox + DIAG title
```

Plus per-phase: `npm test` (147), `npm run typecheck`, `npm run lint`,
`npm run build` with a bundle-size note, and the Phase-2/3 manual keyboard
checklist. `capture.sh dom` diffs are the tiebreaker when a shot looks off.
