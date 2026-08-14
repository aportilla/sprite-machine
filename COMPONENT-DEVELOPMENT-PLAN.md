# Component development plan — decompose the UI, formalize app state

> **STATUS: IMPLEMENTED** (August 2026). All six phases landed, one commit per
> phase, each gated on byte-identical `tools/refactor-check.sh` screenshots and
> a green `tools/drive.mjs`. Deviations from the letter of the plan, all in
> service of its intent: the doc slice gained a `sheet` generation counter (the
> rebuilder frames the camera on a new generation instead of a `frameNext`
> flag); `applyTileEdit` takes `(face, tile)` with the untouched-derived guard
> at the caller; face routing collapsed into `session.face` (seeded `'left'`,
> `?edit=` overrides) instead of a dock-relayed event; and the canvas's pure
> overlay painters split into `components/draw-overlays.js` to keep
> `sm-draw-canvas.js` near the size audit. See README's Architecture section
> for the as-built map.

A scoping + implementation plan for breaking the three monolithic UI files —
`src/components/sm-editor.js` (**1,382 lines**), `src/main.js` (**632**),
`src/ui.js` (**263**) — into small, single-purpose Lit components coordinated by
a formal app-state layer. No behavior change, no visual change: the whole
refactor must land **byte-identical** under `tools/capture.sh` and green under
`tools/drive.mjs` at every phase.

(Note: the editor file is `sm-editor.js`, not `.ts` — the project types plain JS
with JSDoc under `tsc checkJs`, and this plan stays on that convention. A
per-file TS migration is orthogonal and out of scope here.)

---

## 1. Where we are

The **bottom** of the codebase is already exemplary: `src/lib/` is pure
typed-array code with direct Node test suites. The problem is confined to the
**top**, where four distinct responsibilities interleave in three files:

| File                      | Lines | What's actually in it                                                                                                                                                                                                                                                                   |
| ------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/sm-editor.js` | 1,382 | Six UI regions (settings row, face picker, tool strip, color wells, options bar, picker dialog) **plus** the entire canvas subsystem (pixel buffer, pencil/rect/fill gestures, layout fitting, four overlay painters) **plus** global keyboard handling **plus** the dev-hook machinery |
| `main.js`                 | 632   | THREE scene + render loop **plus** canonical document state (`state`) **plus** the rebuild pipeline + rAF live-edit coalescing **plus** editor session wiring **plus** URL-param parsing                                                                                                |
| `ui.js`                   | 263   | Header chrome, stage overlays, stats readout, whole-app drag & drop — coordinated through a callback bag (`onSample`/`onAtlas`/`onOptionChange`/`onDownload`) and a returned method bag (`setStats`/`setError`/`syncControls`)                                                          |

Coordination today is **hub-and-spoke around `main.js`**: module-level mutable
state, closures over it, a callback bag down into `ui.js`, and `sm-*` DOM events
up from the editor. It works because there is exactly one editor and one scene —
but every feature threads through `main.js`, and `sm-editor.js` can't be split
because its six regions share reactive state (`tool`, `ink`, `recent`, …)
through `this`.

### What the monolith got right (and must survive the split)

These are the load-bearing design decisions in the current code. They are
constraints on the refactor, not casualties of it:

1. **The two-speed state system.** Reactive properties are what templates read;
   everything the canvas hot paths touch is a plain private field, so a pencil
   drag never schedules a re-render at pointer-move rate; canonical atlas writes
   are rAF-coalesced (`flushLive`). The state layer must _formalize_ this split,
   not flatten it.
2. **Light DOM everywhere** (`createRenderRoot() { return this }` +
   `display: contents` hosts). `style.css` classes, `capture.sh dom`, and every
   selector `drive.mjs` drives (`editor-tool`, `editor-canvas`,
   `editor-tile-size`, `editor-face-picker`, `editor-selected`,
   `editor-transparent`, `editor-recent`, `editor-opts`, `editor-picker-grid`,
   `stage-stats`, `sm-editor`, the `vf-*` tags) must keep working unchanged.
3. **Pixel buffers pass by reference.** `#work` is shared with its `ImageData`
   view, and `applyTileEdit` stores the editor's working buffer _by reference_
   into `state.views` — identity is the contract. The state layer must carry
   references + change notifications, never immutable snapshots or clones.
4. **Hard-pixel invariant** (alpha 0 or 255) so ingest (`alpha>=128`) and
   `isBlank` (`alpha!==0`) can never diverge.
5. **Canvas backing stores are sized imperatively**, never template-bound;
   user-editable `vf-*` values are controlled with `live()`.
6. **State outlives DOM.** "One element, forever" exists so tool/ink/recency and
   the tile field's keyboard focus persist. Moving session state into a store
   makes this _stronger_ (state can't die with an element), but element
   persistence stays — it's also what preserves focus.
7. **Drain-before-consume.** Every canonical-atlas consumer (download, resize,
   replace-all) folds the pending live stroke in first. This ordering guard must
   have exactly one owner in the new design.

---

## 2. Target architecture

Three layers, dependency arrows only pointing down:

```
┌─────────────────────────────────────────────────────────────────────┐
│ PRESENTATION            components/ (Lit, light DOM)   scene/ (THREE)│
│   presentational leaves ← props/events → connected containers        │
│   sm-face-picker, sm-tool-strip,         sm-editor, sm-topbar,       │
│   sm-color-wells, sm-tool-options,       sm-stage-controls,          │
│   sm-color-picker, sm-draw-canvas        sm-stats-readout, rebuilder │
├─────────────────────────────────────────────────────────────────────┤
│ APP STATE               state/ (pure JS, zero deps, Node-tested)     │
│   observable slices: doc · session · prefs · build                   │
│   actions (named mutations) + selectors (pure derivations)           │
│   two channels on doc: change (structural) · live (stroke-rate, rAF) │
├─────────────────────────────────────────────────────────────────────┤
│ DOMAIN                  lib/ (pure typed arrays — unchanged)         │
│   atlas, fill, rect, guides, pipeline, mesh, … + NEW lib/brush.js    │
└─────────────────────────────────────────────────────────────────────┘
```

Key moves:

- **The THREE scene stops being the hub and becomes a peer.** `rebuilder.js` is
  just another store subscriber: it listens to `doc` + `prefs`, rebuilds the
  mesh, and writes `build` stats. This is also what makes the future Web-Worker
  carve a drop-in — the rebuilder is the pipeline's only consumer.
- **`main.js` becomes a composition root** (~80 lines): parse params, create the
  stage, mount components, apply boot hooks. No logic of its own.
- **Leaves are dumb** (props down, `sm-*` events up, no store imports) so they
  stay trivially testable and reusable; each region has exactly **one** connect
  point (`sm-editor` for the panel, each chrome element for itself). Store
  coupling stays visible and greppable.

### Target file map

```
src/
  main.js                  composition root: params → store seeds → mount → boot hooks (~80)
  boot/params.js           URL-param parsing → typed hook objects (pure-ish, Node-testable ~90)
  state/
    store.js               createStore(): get / patch / subscribe (pure, ~50)
    store-controller.js    ReactiveController: store change → host.requestUpdate() (~25)
    doc.js                 canonical atlas slice + actions + the LIVE channel (pure, ~160)
    session.js             editor session slice + actions (pure, ~120)
    prefs.js               lowpoly / autoRotate (pure, ~25)
    build.js               dims/voxels/tris/warnings/error, written by the rebuilder (pure, ~30)
    derive.js              pure selectors: editorViewModel(doc, face) → {tile, mirrorBehind,
                           guides, wasDerived} — the old showFace() derivation (~60)
  scene/
    stage.js               renderer, camera, lights, ground, framing, on-demand loop, resize (~170)
    rebuilder.js           doc/prefs subscriber → buildVoxels → mesh swap → build stats (~130)
  shortcuts.js             document-level B/R/G/I/E → session actions (~60)
  drop-target.js           whole-app drag & drop → loaders (~50)
  loaders.js               sample/file/blank → decode + validateSheet + doc.loadAtlas | build.setError (~70)
  components/
    sm-editor.js           CONNECTED container: panel layout + leaf wiring (~180)
    sm-face-picker.js      leaf (~70)
    sm-tool-strip.js       leaf (~70)
    sm-color-wells.js      leaf (~80)
    sm-tool-options.js     leaf (~90)
    sm-color-picker.js     leaf: the 256-color vf-dialog (~70)
    sm-draw-canvas.js      leaf: buffer + gestures + layout + overlays (~550)
    sm-topbar.js           connected chrome (~90)
    sm-stage-controls.js   connected chrome (~50)
    sm-stats-readout.js    connected chrome (~70)
  lib/
    brush.js               NEW pure primitives: writeTexel, stampBrush, strokeLine
                           (Bresenham) over a bare Uint8ClampedArray (~90)
```

Total lands near today's line count (~2,400 across ~20 files vs 2,277 across 3)
— the win is that no file holds more than one idea, and the state + brush layers
gain direct Node tests that today only exist implicitly via `drive.mjs`.

---

## 3. The app-state mechanism

### Recommendation: a hand-rolled observable store (zero dependencies)

```js
// state/store.js — the whole mechanism
export function createStore(initial) {
  let state = { ...initial };
  const listeners = new Set();
  return {
    get: () => state,
    patch(partial) {
      let changed = false;
      for (const k in partial)
        if (!Object.is(state[k], partial[k])) {
          changed = true;
          break;
        }
      if (!changed) return;
      state = { ...state, ...partial };
      for (const fn of listeners) fn(state);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
```

```js
// state/store-controller.js — the Lit bridge (the idiomatic Lit answer to
// shared state: a ReactiveController, not a base-class mixin)
export class StoreController {
  constructor(host, store) {
    (this.host = host).addController(this);
    this.store = store;
  }
  hostConnected() {
    this.unsub = this.store.subscribe(() => this.host.requestUpdate());
  }
  hostDisconnected() {
    this.unsub?.();
  }
  get value() {
    return this.store.get();
  }
}
```

Why this over the alternatives:

| Option                                  | Verdict                                                                                                                                                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hand-rolled store + StoreController** | ✅ ~75 lines total, zero deps, pure JS → direct Node tests, matches the repo's ethos (one deduped `lit`, everything testable headless). Swappable later if it ever pinches.                                                      |
| `@lit/context`                          | DI for deep/reusable trees. Our tree is two levels deep with exactly one store instance — context adds providers/consumers ceremony for no decoupling we need. Revisit only if a second independent editor instance ever exists. |
| `@lit-labs/signals`                     | Fine-grained reactivity we don't need (templates are small; the hot path bypasses reactivity entirely by design), plus a labs-status dep + polyfill.                                                                             |
| Redux / Zustand / nanostores            | Immutable-snapshot idioms fight constraint #3 (pixel buffers by reference, mutated in place at stroke rate). Fighting the library's grain to hold a mutable `ImageData` is worse than 50 lines of our own.                       |

Coarse-grained notification (whole-slice) is deliberate: subscribers are a
handful of small lit templates and re-render is a cheap diff. Per-key selectors
are a later optimization if ever measured to matter — do not build them now.

### The slices

**`session`** — the shared editor UI state that currently traps six regions in
one element. This is the heart of the refactor:

```
face, tool, ink, erase, picking, recent, pencilSize, cornerRadius,
fillReplace, fillAllTiles, pickerOpen
```

Actions (each a named, Node-testable function — the old `#selectColor`,
`#switchTool`, `#touchRecent` semantics move here verbatim): `selectFace`,
`setTool` (clears erase/picking, ensures an ink), `pickColor` (sets ink, clears
flags, promotes MRU — the single funnel for dialog/eyedrop/recency picks),
`selectTransparent`, `armEyedropper`, `setPencilSize` / `setCornerRadius`
(clamped against `doc` tile geometry — the clamp logic moves out of the element),
`setFillReplace` / `setFillAllTiles`, `openPicker` / `closePicker`. The boot
seeds `ink` from `PENCIL_PALETTE[0]` but **not** `recent` (preserving "the
untouched mount default never enters the recency row").

**`doc`** — the canonical document. Holds `atlasImage`, `views`, `transforms`,
`tileW/tileH/cols/rows`, `atlasWarnings` — all **by reference**. Actions:
`loadAtlas(imageData, transforms)`, `resizeTiles(size)`,
`replaceAllTiles(target, fill)`, `applyTileEdit(face, tile, dirty)`, `drain()`,
`download-snapshot` support. This slice owns the rAF blit coalescing
(`flushLive` / `dropLive` / the drain-before-consume guard) with an injectable
scheduler so Node tests can drive it manually.

**Two channels on `doc` — the formalization of the two-speed system:**

- `subscribe` (**change**, structural, low-frequency): new atlas, tile resize,
  replace-all. Drives templates and view-model recomputation.
- `onLive` (**live**, stroke-rate, rAF-coalesced): blit-then-notify per animation
  frame. Its **only** subscriber is the rebuilder.

Critically, `applyTileEdit` mutates `views[face]` **silently** on the change
channel (same staleness contract as today: guides/onion-skin recompute only on a
face switch or structural change, never mid-stroke) and stores the canvas's
working buffer by reference (identity equality is what tells the canvas _not_ to
reset its buffer on a re-render).

**`prefs`** — `lowpoly`, `autoRotate`. Written by `<sm-stage-controls>`; read by
the rebuilder (`lowpoly`) and the render loop (`autoRotate`, plain per-frame
read).

**`build`** — `dims`, `voxels`, `triangles`, `warnings`, `error`. Written by the
rebuilder and `loaders.js`; read by `<sm-stats-readout>`. Replaces
`setStats`/`setError`.

**`derive.js`** — pure selectors, chiefly `editorViewModel(doc, face)` returning
`{ tile, mirrorBehind, guides, wasDerived }` — the logic of today's `showFace()`
(opposite-face mirror via `mirrorImage`, `faceGuides`, fresh-tile fallback),
now Node-testable.

---

## 4. Component inventory

All components render **light DOM** with a `display: contents` host rule (added
to `style.css` per tag), so the box tree — and therefore every screenshot —
is unchanged. All inter-component events keep the `sm-*` naming and bubble.

### The editor panel

| Component           | Kind                    | Props (in)                                                                                                                                                                                                    | Events (out)                                                                                                                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<sm-editor>`       | **connected** container | — (reads `session` + `doc` via StoreController)                                                                                                                                                               | — (calls actions)                                                                                                                             | Renders the `.editor` column layout; computes the view-model via `derive.js`; translates every leaf event into a store action or doc mutation. The only editor file that knows the store exists. Persists forever, exactly as today.                                                                                                                                                                                                                                                                                                                                                         |
| `<sm-face-picker>`  | leaf                    | `faces`, `selected`                                                                                                                                                                                           | `sm-select-face {face}`                                                                                                                       | The six cube icons + `vf-radio-group` (`face-icons.js` unchanged). Keeps `.editor-face-picker` / `.editor-face-cell` classes and the radio/cell double-click guard.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `<sm-tool-strip>`   | leaf                    | `tool`, `picking`                                                                                                                                                                                             | `sm-pick-tool {tool}`, `sm-arm-eyedropper`                                                                                                    | The four `vf-grid` cells + module-constant icon templates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `<sm-color-wells>`  | leaf                    | `ink`, `erase`, `picking`, `recent`                                                                                                                                                                           | `sm-pick-color {rgb}`, `sm-pick-transparent`, `sm-open-picker`                                                                                | Current-ink swatch, keyed `repeat()` recency row, transparent well.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `<sm-tool-options>` | leaf                    | `tool`, `pencilSize`, `brushMax`, `cornerRadius`, `radiusMax`, `fillReplace`, `fillAllTiles`                                                                                                                  | `sm-set-pencil-size {n}`, `sm-set-corner-radius {n}`, `sm-set-fill-opts {replace?, allTiles?}`                                                | Clamp _bounds_ arrive as props (derived from doc tile geometry by the container); clamping itself lives in session actions. `live()` bindings preserved.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `<sm-color-picker>` | leaf                    | `palette`, `open`                                                                                                                                                                                             | `sm-pick-color {rgb}`, `sm-close`                                                                                                             | The `vf-dialog` + 16×16 grid. Preserves the lazy-build latch (256 cells constructed only on first open) and `.editor-picker-grid`.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `<sm-draw-canvas>`  | leaf (big)              | `tileW`, `tileH`, `tile`, `mirrorBehind`, `guides`, `tool`, `ink`, `erase`, `picking`, `pencilSize`, `cornerRadius`, `fillReplace`, `fillAllTiles` + one-shot `previewCursor` / `previewRect` / `fillOnMount` | `sm-live {tile, dirty}`, `sm-pick-color {rgb}` (eyedrop hit), `sm-pick-transparent` (eyedrop on empty), `sm-replace-all-tiles {target, fill}` | The whole canvas subsystem: 4-layer stack, `#layout()`, working buffer + `ImageData` view, pencil/rect/fill gestures, overlay painters, its own ResizeObserver, and the gesture-scoped keys (**Esc** to cancel a drag, **Shift** square-lock — these move _off_ the global handler and become internal, which they always really were). Buffer resets in `willUpdate` on `face`/`tileW`/`tileH`/`tile`-**identity** change; any `tool` change cancels an in-flight gesture (strictly more robust than today's key-only cancel). All hot-path private-field discipline carries over verbatim. |

The tile-size `vf-number-field` (15 lines of template) stays directly in
`<sm-editor>`'s settings row — a component for it would be ceremony. It must sit
in an unconditional template position so lit reuses the node and keyboard focus
survives re-renders (the focus contract `drive.mjs` exercises).

### The chrome (currently `ui.js`)

| Component             | Kind         | Reads     | Writes/Events                                                      |
| --------------------- | ------------ | --------- | ------------------------------------------------------------------ |
| `<sm-topbar>`         | connected    | `SAMPLES` | menu picks → `loaders.js`; download → drain + `imageDataToBlob`    |
| `<sm-stage-controls>` | connected    | `prefs`   | `prefs.setLowpoly` / `setAutoRotate`                               |
| `<sm-stats-readout>`  | connected    | `build`   | — (keeps `.stage-stats`, warn rows, error-replaces-stats rule)     |
| `drop-target.js`      | plain module | —         | depth-counted drag overlay + drop → `loaders.js` (unchanged logic) |

Converting the chrome to elements is strictly optional for the decomposition —
but it retires the callback/method bags, gives one consistent pattern, and is
the lowest-risk place to validate the store before touching the editor. Do it.

### Cross-cutting modules

- **`shortcuts.js`** — the document-level half of today's key handler: B/R/G/I/E
  → session actions, guarded by `session.pickerOpen` and the composed-path
  input-focus check. Wired once by `main.js`. (Esc/Shift live in the canvas.)
- **`scene/stage.js` + `scene/rebuilder.js`** — the THREE half of `main.js`.
  The rebuilder preserves: mesh disposal, spin carry-over (`prevRotY`), framed
  vs in-place rebuilds (`frameNext` becomes an option on structural loads), the
  `?diag` stale-geometry guard, and warning merge (`atlasWarnings` + build).
- **`boot/params.js`** — all URL-param parsing, returning typed hook objects.
  Most dev hooks stop being editor machinery and become **boot-time store
  actions**: `?edit` → `session.selectFace`, `?pick` → `session.pickColor`,
  `?palette` → `session.openPicker`, `?tile` → `doc.resizeTiles`, `?fill`'s
  checkbox half → session actions. Only the canvas-paint halves
  (`?cursor` footprint, `?rect` preview, `?fill`'s click) remain one-shot props
  on `<sm-draw-canvas>` — the two-phase willUpdate/updated hook machinery in
  the monolith mostly dissolves.

---

## 5. Migration phases

Every phase ends green on **all** gates before the next begins:
`npm test` · `npm run typecheck` · `npm run lint` · `node tools/drive.mjs` ·
the screenshot matrix `cmp`-identical · `capture.sh dom` diff-clean. Because
shots are byte-deterministic, "no visual change" is machine-checkable, not a
judgment call. One commit (or a few) per phase.

### Phase 0 — Safety net _(S)_

- [x] Add `tools/refactor-check.sh`: boots the dev server assumption, shoots a
      fixed URL matrix into a git-ignored `refactor-baselines/`, and `cmp`s
      against it; also captures `dom` snapshots for `diff`. Matrix (all
      `rotate=0`): default car; `edit=front`; `palette=1`; `cursor=5`;
      `rect=3,3,20,14,4` and `…,4,1` (square-lock); `fill=5,5,1`; `pick=37`;
      `tile=24`; `lowpoly=0`; `diag=1` (dom, title check).
- [x] Record baselines; run every gate once to confirm a clean start.

### Phase 1 — The state layer, under the monolith _(M — the keystone)_

- [x] `state/store.js` + `state/store-controller.js` + `test/store.test.mjs`.
- [x] `state/prefs.js`, `state/build.js`; re-point `main.js`'s `state.lowpoly`
      / `state.autoRotate` and `ui.setStats`/`setError` at them (ui.js still
      renders, now reading slices).
- [x] `state/session.js` + tests (MRU promotion, clamp-on-resize, tool-switch
      semantics, transparent/eyedrop rules). Convert `sm-editor.js`'s internal
      `state: true` properties to store reads via StoreController; its handlers
      become action calls. **The element stays monolithic.**
- [x] `state/doc.js` + tests (injectable scheduler; blit/drain ordering;
      silent-on-change stroke writes; blank-revert). Move `applyTileEdit`,
      `flushLive`, `dropLive`, drain guards out of `main.js`.
- [x] `state/derive.js` + tests; `showFace()` in main.js becomes a thin wrapper
      over it.

Exit: identical screenshots; `sm-editor.js` shrinks ~150 lines; session state
now survives even element replacement (stronger than "one element, forever").

### Phase 2 — Chrome components _(S — validates the pattern cheaply)_

- [x] `ui.js` → `<sm-topbar>`, `<sm-stage-controls>`, `<sm-stats-readout>`,
      `drop-target.js`, `loaders.js`. Retire `createUI` and both bags.
- [x] `display: contents` host rules; classes unchanged.

### Phase 3 — Editor leaves, the easy five _(M)_

- [x] Extract `<sm-face-picker>`, `<sm-tool-strip>`, `<sm-color-wells>`,
      `<sm-tool-options>`, `<sm-color-picker>` as presentational leaves;
      `<sm-editor>` becomes container + layout + wiring.
- [x] Preserve: lazy dialog build, `live()` bindings, keyed recency `repeat()`,
      module-constant icon templates, the HMR define-guard per new element.

### Phase 4 — The draw canvas _(L — the riskiest; sub-staged)_

- [x] 4a. `lib/brush.js` (pure `writeTexel` / `stampBrush` / `strokeLine`) +
      `test/brush.test.mjs` (Bresenham continuity, footprint anchoring, the
      transparent-idempotence rule — real coverage the monolith never had).
      Monolith consumes it in place.
- [x] 4b. Extract `<sm-draw-canvas>` (props/events per §4); buffer-reset on
      tile-identity change; gesture-cancel on any `tool` change.
- [x] 4c. Split the keyboard: `shortcuts.js` (global) vs canvas-internal
      Esc/Shift.
- [x] 4d. Dev hooks: `boot/params.js` + boot-time actions + the three one-shot
      canvas props. Delete the monolith's two-phase hook machinery.

### Phase 5 — Scene extraction + composition root _(M)_

- [x] `scene/stage.js`, `scene/rebuilder.js` (subscribes `doc.change`,
      `doc.live`, `prefs`; writes `build`).
- [x] `main.js` → ~80-line composition root. HMR teardown consolidated here
      (stage dispose, store-listener cleanup, observer disconnects).

### Phase 6 — Docs + cleanup _(S)_

- [x] Rewrite README's Architecture + "UI layer: Lit" sections for the new map.
- [x] Mark `ux-enhancement.md` superseded (as `docs/drawing-editor-plan.md`
      already is) or move it under `docs/`.
- [x] Audit: no UI file > ~600 lines; delete dead code; delete
      `refactor-baselines/` or promote the matrix script to a permanent tool.

---

## 6. Risks & mitigations

| Risk                                                                        | Mitigation                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A subscriber re-renders at stroke rate                                      | The pointer path touches no store; `doc.live` has exactly one subscriber (rebuilder); stroke writes are **silent** on `doc.change`. Assert in review: no `patch()` reachable from `pointermove`.                                                 |
| Buffer identity broken → canvas resets mid-session                          | `applyTileEdit` stores the working buffer by reference; `editorViewModel` returns `views[face]` (same reference) or a fresh tile only when truly absent; canvas resets only on face/geometry/**identity** change. Store never clones pixel data. |
| Tile-size field loses focus across a resize                                 | Element persistence + unconditional template slot (lit node reuse). `drive.mjs` covers it — treat any needed change to `drive.mjs` selectors as a design smell, not a test update.                                                               |
| Shadow-DOM creep breaks `style.css` / `capture.sh dom`                      | Every new element: light DOM + `display: contents` rule. Checked implicitly by the byte-identical screenshot gate.                                                                                                                               |
| Double-handling during migration (old path + store both firing)             | Phase discipline: each phase _moves_ a responsibility, never mirrors it. The `cmp` gate catches double-rebuild artifacts (e.g. rotation snap) as pixel diffs.                                                                                    |
| HMR duplicates listeners/stores                                             | Define-guard per element (existing pattern); store singletons live in modules with `import.meta.hot.dispose` cleanup in the composition root.                                                                                                    |
| Drain-ordering regressions (download/resize/replace losing the last stroke) | The guard has one owner (`doc.drain()`), called inside the three consuming actions — Node-tested with the injectable scheduler, plus `drive.mjs`'s end-to-end pass.                                                                              |

## 7. What this unlocks (deliberately out of scope now)

- **Undo/redo** — doc actions are now the single mutation choke point; a command
  log wraps them without touching components.
- **Worker carve** (the README's stated next step for lifting the 64³ cap) — the
  rebuilder is the pipeline's only caller; making it async is a local change.
- **Per-face dirty badges on the face picker** — a `derive.js` selector away.
- **A second editor pane / component reuse** — leaves are already dumb; if it
  ever happens, that's the moment to introduce `@lit/context` for store scoping.
- **Per-file TS migration** — orthogonal; the JSDoc convention stays for now.
