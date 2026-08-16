# Desktop UX plan

Sprite Machine becomes a **full System 7 virtual desktop**: a menu bar, movable
windows, a floating tool palette, and user documents that live as **files on
the desktop** — saved in the browser, reopened by double-clicking their icons.
The mockup this plan implements is /Users/adam/Desktop/MOCKUP.png: menu bar +
per-tool options strip up top, a document window ("Cargo Ship") holding the
face picker and pixel canvas, a floating tools palette on the left, and two
satellite windows — **Full Sprite View** and **3D View** — on the right.

This is a **shell replacement, not an engine change**. The pipeline
(`lib/`), the state layer (`state/`), and the editor leaves survive intact;
what changes is the chrome they're mounted in and a new persistence layer
underneath.

---

## 1. What we build on

Almost everything the mockup shows already exists as a component:

| Mockup element | Existing piece | Where |
| --- | --- | --- |
| Desktop (gray dither, window stacking, active window) | `vf-desktop` | vintage-frames 0.3.0 (bump from ^0.2.1, Phase 1) |
| Menu bar + drop menus | `vf-menu-bar` / `vf-menu` / `vf-menu-item` | vintage-frames (we already use `vf-menu` in `sm-topbar`) |
| Document / satellite windows | `vf-window` (`closable zoomable movable resizable`) | vintage-frames |
| Floating tool palette | `vf-window variant="utility"` — floats above the document tier automatically | vintage-frames |
| Desktop file icons (select, drag, rename in place, double-click to open) | `vf-icon` (`selectable movable editable`, `vf-open` event) | vintage-frames |
| Modal dialogs / alerts | `vf-dialog` (already used for the Colors picker) | vintage-frames |
| Face picker, canvas, tool strip, color wells, per-tool options, stage controls, stats | the existing `sm-*` leaves | `src/components/` |

`~/MyProjects/system7web` is the reference application for every desktop
idiom and should be read before implementing (its `src/main.ts` especially):

- **Viewport-filling raster** — `desktop.fitWithin(clientWidth, clientHeight)`
  on `resize` + `onScaleChange`; the page owns the leftover sub-pixel slack.
- **`applyCursor()`** — the kit's System 7 pointer set (arrow, I-beam,
  crosshair, wristwatch), driven by `aria-busy` / `data-vf-cursor` state.
- **Window placement** — center on the *current* raster at open time, snapped
  to the drag lattice (`snapSys`, `systemPxQuantum`) and clamped below the
  20px menu bar; a dragged window keeps its position across close/reopen.
- **Close wiring** — `vf-close` on the desktop, `event.target.hidden = true`;
  the window never removes itself.
- **Launcher icons** — `vf-icon[data-opens]` + `vf-open` → un-hide, center,
  `desktop.bringToFront()`; the icon's `open` ghost mirrors the window's
  `hidden` attribute via a `MutationObserver`.
- **The one rule** — the page (and our components) may set **layout** only;
  every aesthetic comes from the kit.

One difference from system7web: that repo authors its desktop as static
markup in `index.html` with behavior in one script. Sprite Machine keeps its
own architecture — **connected Lit components reading store slices** — so the
desktop skeleton lives in `index.html` (it *is* layout), but menus, icons,
and window visibility are driven by components/modules wired to the store,
exactly like today's chrome.

---

## 2. Target UX spec

### 2.1 The desktop

- `index.html` becomes: one `<vf-desktop>` filling the viewport (black page
  behind the bezel), containing the menu bar, the options strip, the four
  windows, the dialogs, and the file-icon layer.
- `fitWithin` + `onScaleChange` + `applyCursor()` at boot (system7web's exact
  pattern).
- The current `#app` header / 50-50 split / `style.css` frame styles are
  retired. `style.css` keeps only the palette tokens and page reset.

### 2.2 Menu bar (per the mockup, clause by clause)

**SpriteModel** (the app menu)
- *About…* — `vf-dialog` with the app blurb (content from today's README intro).
- *Settings…* — `vf-dialog` holding the render prefs that today live in
  `sm-stage-controls`: smooth slopes (lowpoly), auto-rotate. Room to grow.
- *Quit* — closes the open document (dirty check, §3.5) and every window,
  leaving the bare desktop with its file icons. Reopen anything by icon.

**File**
- *New* — new untitled document (blank atlas via `loadBlank()`), opens the
  document window. Untitled docs exist only in memory until saved.
- *Open…* — `vf-dialog` listing saved documents (name, size, modified date)
  plus the built-in samples; double-clicking a desktop icon is the faster path.
- *Close* — closes the document window (dirty check), back to the desktop.
- *Save* — persists the current doc (§3). First save of an untitled doc asks
  for a name (dialog with a text field); a saved doc saves silently in place
  and its desktop icon appears/refreshes.
- *Duplicate* — saves a copy as "«name» copy", which becomes the open doc.
- *Rename…* — dialog with a text field; renames the stored doc + window title.
  (Desktop icons also rename in place — `vf-icon editable` — and the two paths
  converge on the same store action.)
- *Export…* — downloads the document `.png` **verbatim** (metadata chunks
  included, §3.2), named after it (`cargo-ship.png`); an untitled doc exports
  a freshly encoded file. Round-trips losslessly through the drop target.
- *Properties…* — dialog for document metadata: name, atlas dimensions
  (read-only), and the **tile-size stepper**, which relocates here from the
  editor's settings row (the mockup's document window shows tile size only as
  a status-bar readout).

**Edit**
- *Undo / Redo* — new capability, phased separately (§5, Phase 5). Menu items
  render disabled until that phase lands.
- *Pick Color…* — opens the existing 256-color Colors dialog
  (`session.openPicker()`).

**View**
- *3D View* / *Sprite View* — checkmarked toggles showing/hiding those two
  windows (`hidden` on the `vf-window`, checkmark mirrors it).
- *Show Grid* — checkmarked toggle drawing a texel grid on the pixel canvas's
  overlay (new painter in `draw-overlays.js`; drawn only at scales where the
  hairlines don't swamp the art, e.g. scale ≥ 4).

**Key equivalents** — `shortcut` on `vf-menu-item` (0.3.0, §5a) renders the
right-aligned glyph column *and* owns the live app-wide keydown match, so
these are one attribute each: Save **⌘S**, Open **⌘O**, Duplicate **⌘D**,
Export **⇧⌘E**, Undo **⌘Z**, Redo **⇧⌘Z**, Pick Color **⌘K**, Show Grid
**⌘G** (Ctrl stands in for ⌘ off-Mac, per the kit). Two System 7 staples stay
unassigned on purpose: the browser owns **⌘N**/**⌘W** before the page ever
sees them, and a shortcut column showing keys that can't fire would be a lie.
The kit deliberately never matches a bare printable key, so the existing
B/R/G/I/E tool keys keep living in `src/shortcuts.js`, unchanged.

### 2.3 The options strip

The full-width white band under the menu bar (mockup: "Pencil Tool · Size
———"): the active tool's name plus today's `sm-tool-options` content (pencil
tip slider, eraser tip slider, rect radius stepper, fill checkboxes). It's a
fixed strip, not a window — always present, blank-ish when a tool has no
options. This honors the standing preference for persistent, in-flow controls
over popups.

### 2.4 The windows

All four windows are **open by default** (persistent panels, not
hunt-for-them popups); closing any is reversible via the View menu or the
document icon.

1. **Document window** — title = document name; body = face picker row over
   the pixel canvas; the window's **`status` slot** (kit chrome as of 0.3.0)
   reads the tile size ("40px x 40px"), with the grow box flush in its right
   end. `closable movable resizable`; the canvas's existing ResizeObserver +
   integer-texel-scale layout (`#layout()` in `sm-draw-canvas.js`) already
   handles an arbitrary box, so the grow box works for free. Closing it =
   File → Close (dirty check).
2. **Tools palette** — `variant="utility" movable`: the tool strip over the
   color wells (today's `sm-tool-strip` + `sm-color-wells`), floating above
   the document tier, never deactivating the document window.
3. **Full Sprite View** — *new leaf component* `sm-atlas-view`: the whole 3×2
   atlas drawn nearest-neighbor at the largest integer scale that fits, the
   `status` slot showing atlas dimensions ("120px x 80px"). Subscribes to the
   doc's **live channel** (`onLive`) so it tracks strokes at rAF rate —
   the second live subscriber ever, after the rebuilder; the channel is
   already multi-listener.
4. **3D View** — the THREE `<canvas>` moves into this window's body; the
   `status` slot holds today's `sm-stage-controls` (camera presets, toggles
   that don't graduate to Settings) and `sm-stats-readout`. The stage
   resizes on the window's **`vf-resize`** event (0.3.0): stream events fire
   *after* the new box is applied to layout, so the handler measures the
   resized body and calls `stage.resize` live through the drag, with the
   `commit: true` event as the settle point. One contract to respect: the
   event is gesture-only — a programmatic `width`/`height` write fires
   nothing — so the two programmatic call-sites (boot restore of a persisted
   size, any future zoom-box handling) resize the stage explicitly.

Default layout mirrors the mockup: document window center-left, palette at
the left edge, sprite view upper-right, 3D view lower-right — authored as
`top`/`left` in system px, clamped to the raster at boot (adopt system7web's
`centerWindow` lattice-snap/clamp helper for anything that would land
off-raster on a small viewport).

### 2.5 Desktop file icons

- One `vf-icon` per **saved document** (`selectable movable editable`), plus
  a cluster of read-only **sample icons** (Car, Cube, …). Double-click
  (`vf-open`): samples open as a fresh untitled copy; saved docs load from
  storage. The open document's icon wears the kit's `open` ghost.
- Icon art is **generated from the document itself**: the atlas's FRONT tile
  drawn nearest-neighbor into a 32×32 canvas → data URI → the icon's
  `vf-img`. Regenerated on every save. (Sample icons same treatment, done
  once at boot.) Fallback for an empty front tile: a generic document glyph.
  These are color art, so every generated icon declares **`color`** (0.3.0):
  selection darkens it the way System 7 darkened color icons, instead of
  inverting it into a photographic negative.
- In-place rename (Return on a selected icon) renames the stored doc.
- Dragged icon positions persist (§3.4).

### 2.6 Dialogs and alerts

About, Settings, Open, Save-as/Rename (one name-prompt dialog, two uses),
Properties, and the **unsaved-changes alert** ("Save changes to "Cargo Ship"
before closing?" — Save / Don't Save / Cancel), all `vf-dialog`. Long
storage work (unlikely at these sizes) declares `aria-busy` for the
wristwatch, per the kit's modal async-work pattern.

---

## 3. Documents & persistence

### 3.1 Storage mechanism: IndexedDB (recommendation)

localStorage would *work* — a max-size atlas (tile 64 → 192×128) is a few KB
as PNG — but IndexedDB is the right call:

- **Blobs are first-class** — we store the PNG bytes the doc already
  round-trips through (`imageDataToBlob`), no base64 inflation or string
  quota games (localStorage's ~5MB is shared with everything else).
- **Async by nature** — saves can't jank a stroke.
- **Blob-shaped truth** — the store holds the document *file* (one PNG blob
  per record, §3.2) plus rebuildable listing caches, indexed by id.

Kept in the project's zero-dependency spirit: a ~60-line promise wrapper
(`src/storage/db.js`), one database (`sprite-machine`, version 1), one object
store (`docs`, keyPath `id`). No library.

localStorage still gets the *desktop* state (§3.4) — tiny, synchronous at
boot, exactly what it's good at.

### 3.2 The document IS a .png

**Commitment: a document is exactly one sprite `.png` — the 3×2 atlas — with
all metadata encoded inside it.** No sidecar record is load-bearing. This
works because of two facts:

1. **The pixels alone are already a complete document.** Tile size is
   auto-derived from the image dimensions and the fixed 3×2 grid (the
   existing `sliceAtlas` contract — a 120×80 sheet ⇒ 40×40 tiles); the
   desktop icon is rendered from the FRONT tile; atlas dimensions are the
   image's. Loading a doc *is* today's `loadFile` path. Any bare PNG in the
   right layout is a valid document with nothing lost but its name.
2. **PNG carries metadata natively.** The format is a signature plus a chunk
   list, and ancillary text chunks (`tEXt`, `iTXt`) are standard, ignored by
   every decoder, and sized without meaningful limit. The spec even
   predefines the keys we want:

   | Chunk key | Carries |
   | --- | --- |
   | `Title` | the document name ("Cargo Ship") |
   | `Creation Time` | created timestamp |
   | `Software` | `sprite-machine <version>` (doubles as the schema marker) |
   | `sprite-machine:transforms` | per-view rot/flip JSON, written **only when non-identity** (editor-authored docs never need it; it exists for imported unconventional sheets) |

**`src/lib/png-chunks.js`** — a new *pure* module (~100 lines, zero deps):
parse the chunk list from a `Uint8Array`, read/insert/replace `tEXt`/`iTXt`
chunks (with the CRC32 table), splicing between `IHDR` and the first `IDAT`.
Pure typed-array code, so it slots straight into the project's Node-tested
`lib/` tier (`test/png-chunks.test.mjs`: round-trip, CRC validity, chunk
order, unknown-chunk passthrough, and that a doctored file still decodes via
the browser path in `drive.mjs`). Canvas `toBlob` can't emit custom chunks,
so the save path post-processes: `doc.drain()` (the existing
drain-before-consume contract) → `imageDataToBlob(atlasImage)` →
`insertChunks(bytes, meta)` → one Blob → `put`.

The IndexedDB record shrinks to `{id, png}` plus **rebuildable cache
fields** (name, modifiedAt, icon data-URI) denormalized for a fast boot
listing — declared cache, never truth: on any disagreement the chunk wins,
and the whole index can be rebuilt by re-scanning the blobs (a chunk scan
stops before `IDAT`, no image decode needed). `modifiedAt` lives in the
record rather than the file, the way a real filesystem keeps mtime outside
the file's bytes — rewriting the PNG on every save to bump a timestamp
inside it would be churn with no reader. Rename = rewrite the `Title` chunk
(+ the cache field).

**The payoff — one artifact, three doors:** File → Export downloads the
saved bytes *verbatim*, so an exported file **is** the document, name and
all; dropping any exported PNG back onto the desktop (or any machine's
sprite-machine) restores it losslessly, title included; and any foreign 3×2
sprite sheet is a legal, if anonymous, document. Save, Export, and the
existing drop-import converge on a single format.

**Degradation is graceful by construction:** an optimizer, editor, or chat
app that strips text chunks costs the *name and timestamps only* — the
pixels still carry everything structural, and the drop path falls back to
the dropped file's own filename for the title.

### 3.3 The `files` state slice

New `src/state/files.js`, same shape as the other slices (pure actions over
`createStore`, Node-tested with an injected storage stub):

- State: `list` (metadata of every saved doc, no blobs), `currentId` (null =
  untitled/none), `currentName`, `dirty`.
- Actions: `refresh`, `open(id)`, `saveCurrent(name?)`, `close`,
  `duplicate`, `rename`, `remove`, `markDirty` / `markClean`.
- **Dirty tracking**: subscribe to the doc's change channel + a light hook on
  `applyTileEdit` (or the live channel) → `dirty = true`; save / load →
  `false`. A `beforeunload` guard warns when `dirty` (explicit Save is the
  contract — System 7 idiom — with that guard as the safety net; autosave is
  a deliberate non-goal for v1, revisit if it chafes).
- The document window title, the File menu's enabled states, and the icon
  ghost all read this slice.

### 3.4 Desktop state (localStorage)

One JSON key (`sprite-machine:desktop`, versioned): per-window
`hidden`/`top`/`left`/`width`/`height`, per-icon position, Show Grid, last
open doc id. Restored at boot before first paint; written debounced on
change (a `MutationObserver` on the windows' reflected attributes, or simply
snapshotting on `visibilitychange`/`beforeunload` + after each drag —
decide in implementation; snapshot-on-exit is simplest and loses nothing
that matters).

### 3.5 Boot flow

1. Parse params (kept: `?sample`, `?edit`, `?rotate`, all existing hooks).
2. Restore desktop state; `refresh` the files index.
3. If `?sample` → that sample as an untitled doc (test path, unchanged
   determinism). Else if a last-open doc id restores → open it. Else → the
   default sample untitled.
4. `fitWithin`, `applyCursor`, mount, go.

---

## 4. Architecture changes

```
index.html              vf-desktop skeleton: menu bar slot, options strip,
                        4 windows (sm-* leaves in their bodies), dialogs, icon layer
src/main.js             composition root grows: desktop fit + cursor + shell/persistence wiring
src/shell/
  windows.js            window visibility/placement <-> shell slice + vf-close wiring;
                        centerWindow lattice helper (adapted from system7web)
  menus.js              vf-menu-select -> store/file actions; checkmark + enabled sync
  icons.js              desktop icon layer: renders vf-icons from files.list,
                        vf-open/rename wiring, front-tile icon art generation
  desktop-state.js      localStorage snapshot/restore (§3.4)
src/storage/db.js       the IndexedDB promise wrapper (docs store)
src/lib/png-chunks.js   NEW pure module: PNG chunk parse + tEXt/iTXt insert/read,
                        CRC32 (typed arrays only — Node-tested like the rest of lib/)
src/state/files.js      the files slice (§3.3)
src/state/shell.js      window visibility + showGrid (store-driven so menus/components stay in sync)
src/components/
  sm-atlas-view.js      NEW leaf: full-atlas live view + dims status bar
  sm-options-bar.js     NEW connected strip: tool name + relocated sm-tool-options
  sm-editor.js          slims down: face picker + canvas only (tools/wells/options
                        move out to their windows; tile stepper to Properties)
  sm-topbar.js          RETIRED (menu bar + Export/Open absorb it)
  sm-stage-controls.js  re-homed into the 3D View window's bottom strip
```

Load-bearing constraints, carried forward:

- **Two-speed state stands.** Nothing new subscribes at stroke rate except
  `sm-atlas-view` on the live channel (rAF-coalesced, one blit per frame —
  same cost class as the rebuilder). Menus, icons, titles: change channel.
- **Dependency arrows still point down.** `shell/` sits beside `scene/` in
  the presentation layer; `storage/` is a leaf the `files` slice injects, so
  the slice stays Node-testable.
- **One element, forever** still holds for `<sm-editor>`/`<sm-draw-canvas>` —
  the document window hides, never unmounts, so canvas identity and focus
  behavior survive.
- **The kit draws everything.** Layout-only CSS from us; if we're writing a
  border or a color, it's a bug (system7web's one rule).
- **HMR teardown** extends to the new wiring (menus, icons, observers).

---

## 5a. Kit features delivered (vintage-frames 0.3.0)

The kit's author is this project's author, and the four gaps this plan
surfaced **shipped in 0.3.0** (on npm; this repo bumps `^0.2.1 → ^0.3.0` as
Phase 1's first task). What landed, and where the plan consumes it:

1. **`vf-resize` on `vf-window`** — detail `{width, height, commit}`, whole
   system px. Stream events fire once per size the drag writes, *after* the
   new box is applied to layout (a measuring handler reads the resized
   state); a final `commit: true` fires as the gesture settles, only if the
   size changed. Gesture-only by contract — programmatic writes fire
   nothing. → Consumed by the 3D View stage (§2.4.4).
2. **`shortcut` on `vf-menu-item`** — glyph-spelled ("⇧⌘Z"), draws the
   right-anchored key column, mirrors to `aria-keyshortcuts`, and is a
   *live* app-wide key equivalent (menu open or not; Ctrl stands in for ⌘
   off-Mac; bare printable keys deliberately never match). → Consumed by the
   File/Edit/View assignments (§2.2), with B/R/G/I/E staying app-side.
3. **`status` slot on `vf-window`** — the classic bottom readout strip (1px
   rule over a 15px band), zero-height until populated, grow box flush in
   its right end. → Consumed by the Document window ("40px x 40px"), Full
   Sprite View ("120px x 80px"), and the 3D View's controls strip (§2.4).
4. **`color` on `vf-icon`** — declares slotted art as color; selection
   darkens it (the System 7 treatment) instead of `invert(1)`'s photographic
   negative. The label plate still inverts. → Consumed by every generated
   front-tile document icon (§2.5).

Any *new* gap that surfaces during implementation follows the same loop: kit
change → `npm link` to verify here → publish → version bump (the dependency
stays the published package, per system7web's split).

## 5. Phases

Each phase lands green (`npm test`, `typecheck`, `lint`, `drive.mjs`,
re-baselined captures) before the next starts.

**Phase 1 — the shell swap (no new features).**
Bump `vintage-frames` to `^0.3.0`, then
`vf-desktop` + menu bar + four windows; existing leaves re-homed (editor
body, palette, options strip, 3D canvas + controls); `sm-topbar` retired with
its functions temporarily parked in menus (Export works; Open lists samples
only). Tile stepper moves to Properties. Windows close/reopen via View menu.
No persistence yet. *This phase eats the screenshot-baseline churn in one
bite.*

**Phase 2 — desktop behaviors.**
Placement defaults + lattice clamp, cursor, Show Grid, About + Settings
dialogs, sample icons on the desktop (open-as-untitled), Quit. `?window`-less
determinism verified (fixed capture viewport ⇒ fixed raster ⇒ byte-stable).

**Phase 3 — persistence.**
`lib/png-chunks.js` (+ its Node suite) first — the document format before
the storage of it. Then `storage/db.js`, `files` slice, Save/Save-as/Open/Close/Duplicate/Rename/
Properties flows, dirty tracking + unsaved-changes alert + `beforeunload`,
saved-doc icons with generated art, boot restore of last doc.

**Phase 4 — desktop state.**
Window/icon layout + toggles to localStorage; restore at boot.

**Phase 5 — Undo/Redo.**
Bounded history (~50 entries) in a new `state/history.js`: per-gesture tile
snapshots (`{face, before, after}` — ≤16KB each at tile 64); whole-atlas
snapshots for resize / replace-all / load boundaries. Edit-menu items
enable; ⌘Z/⇧⌘Z. This retires the README's "no undo" caveat and the
all-tiles-replace footgun.

**Phase 6 — docs + polish.**
README rewrite (the UI section is now a desktop spec), memory/docs updates,
`drive.mjs` scenario expansion (menu-driven save/open round-trip), a
`?fresh=1` param to boot with storage ignored (deterministic captures on a
machine with saved docs).

---

## 6. Testing & tooling impact

- **`tools/capture.sh`** — stays the visual regression surface; every
  baseline re-cuts at Phase 1. Fixed viewport ⇒ `fitWithin` yields a fixed
  raster ⇒ shots stay byte-deterministic. Headless has no pointer, so the
  JS-drawn cursor never paints in captures.
- **`tools/drive.mjs`** — biggest churn: probe paths now descend through
  `vf-window` bodies; new scenarios for menu selection (the press-drag
  gesture), menu key equivalents (⌘S as trusted input), window drag +
  grow-box resize (asserting `vf-resize` reaches the stage), icon
  double-click, save/open round-trip
  (IndexedDB is fully available to headless Chrome). The dev-hook params all
  survive because they act on the store, not the layout.
- **Node suites** — new: `test/png-chunks.test.mjs` (chunk round-trip, CRC,
  splice position, unknown-chunk passthrough), `test/files.test.mjs` (slice
  against a storage stub), `test/history.test.mjs` (Phase 5),
  `test/atlas-view` scale math if extracted pure. Existing suites untouched
  — the pipeline and state contracts don't move.
- **New test-only params** — `?fresh=1` (ignore storage), `?hide=<window>`
  if a capture needs a window out of frame.

## 7. Risks & open questions

- **Small viewports** — a fixed-system-px window set on a laptop-half screen
  will overlap; the clamp keeps everything grabbable, but a real
  small-screen layout is out of scope (the kit's scale system is the
  eventual answer).
- **Kit gaps** — closed: 0.3.0 shipped everything this plan asks of the kit
  (§5a). Anything new that surfaces follows the same kit-first loop.
- **Multi-document** — the store slices are singletons, so v1 is **one open
  document at a time** (matching the mockup and the File-menu grammar).
  True multi-doc means doc-scoped slices — noted as future work, not
  designed here.
- **Safari/private-mode IndexedDB quirks** — the files slice must degrade
  gracefully (storage unavailable ⇒ Save disabled with an explanatory
  dialog, app otherwise fully functional).
- **Naming** — mockup says "SpriteModel"; the repo says "Sprite Machine".
  Assume the menu reads **Sprite Machine** unless told otherwise.

## 8. Non-goals (v1)

Autosave; multiple simultaneous documents; folders/Trash on the desktop;
cross-device sync; mobile/touch layouts; in-desktop file manager beyond
icons + the Open dialog.
