# hit-list — sprite-machine review (2026-07-18)

Prioritized backlog from a fresh, whole-codebase review of `src/`, `test/`, docs,
and tooling. Every item was **adversarially verified against the code on disk** —
a second agent re-opened each cited location and confirmed the issue is real and
_present in the current tree_ (not already fixed). 40 findings survived; 3 were
dropped as duplicates/false.

Each item is tagged **severity** / **effort** and cites `file:line`, states
**what & why**, gives a **concrete fix**, and names the **gate** that proves it
done. Read top-to-bottom or cherry-pick — items are independent unless noted.

Legend: 🔴 high · 🟠 medium · ⚪ low · effort **S** ≤30 min · **M** ≈½ day · **L** ≥1 day

> **Relationship to `TODO.md`:** that file is a _prior_ review, mostly executed and
> partly obsolete (it still lists deleted files — `textured-box.js`, `vectorize.js`,
> `lowpoly.js`, `diagonalize.js`, `diag-preview.js` — as open work). This hit-list
> supersedes it and reflects the current tree. Cleaning up `TODO.md` is itself an
> item below (Docs §D3).

---

## Cold-start context (read this first if you're new to the repo)

**What it is.** Turns a 3×2 pixel-art sprite atlas (six face tiles: LEFT/FRONT/TOP
over RIGHT/BACK/BOTTOM) into a rotatable Three.js voxel object via multi-view
**visual-hull voxelization**, plus an always-open in-app pixel **editor**.

**Pipeline (pure typed-array code, no THREE, no DOM — Node-testable):**
`ingest` (sprite → occupancy/color arrays, full tile, no crop) → `carve` (dim
reconcile + boolean-AND of extruded silhouettes + surface extraction) → `colorize`
(depth-aware first-hit face coloring + palette snap) → `faces` (surface voxels →
greedy-merged or culled quads). Then THREE builders: `mesh.js` (voxel mode) or
`wedge-mesh.js` (low-poly: voxel solid + additive 45° wedges, default on), both
finishing through `mesh-util.js`. `t-junction.js` stitches merged/wedge seams
watertight.

**Load-bearing invariants** (several findings guard these):

- **Face-key order** is `['px','nx','py','ny','pz','nz']` (`carve.js` `FACE_KEYS`);
  the 6-bit surface exposure mask and `faceColor` keyed `idx*6+f` depend on it.
- **`FACE_NORMAL`** (`views.js`) is meant to be the single source of truth for
  per-face axis/direction; the depth march in `colorize.firstHitFromFace` derives
  direction from it. Several places re-spell normals by hand (see DRY §Y1).
- **Hard pixel:** a texel is solid iff `alpha >= 128` (`ALPHA_SOLID`). Fully opaque
  or fully erased, never anti-aliased.
- **Packed color:** canonical is little-endian RGBA in a uint32 (`ingest.packRGBA`
  / `unpackRGBA`). A separate 24-bit big-endian key exists only for Set-dedup.
- **Square-tile registration:** a 3×2 atlas shares its depth axis between the side
  tile's width and the top tile's height, so only a **square** tile registers on
  all three planes. The UI locks the tile-size stepper square.
- **Watertightness** is a tested contract for low-poly: `?diag=1` /
  `test/wedge-mesh.test.mjs` assert zero boundary edges.

**Run / verify (the gates every item should pass):**

```bash
npm run dev        # http://localhost:5173
npm test           # node --test test/*.test.mjs — 80 assertions, all green today
npm run typecheck  # tsc checkJs over src/ (JSDoc types); clean today
npm run lint       # prettier --check . — RED today (see DX §T1); goes green after that fix
npm run build      # vite static bundle
```

Test suites: `pipeline` + `atlas` + `guides` + `rect` + `fill` + `palette` are pure;
`wedge-mesh` loads THREE and guards the shipped low-poly path (watertightness +
the Helium canvas-farbling regression).

**Headless visual check** (the capture tool can't click, so use test-only URL params):
`tools/capture.sh shot "http://localhost:5173/?<params>" out.png`. Params:
`?sample=<i|name>`, `?lowpoly=0|1`, `?flat=1`, `?diag=1` (watertightness readout in
`document.title`), `?cam=top|front|fq|bq`, `?rotate=0`, `?tile=<N|WxH>`,
`?edit=<face>`, `?palette=1`, `?cursor=<N>`, `?pick=<N>`, `?rect=<x0,y0,x1,y1[,r[,sq]]>`,
`?fill=<x,y[,r[,a]]>`. Screenshot-verify any change that touches geometry, color,
or the editor UI — tests don't cover the render output or interactions.

---

## Tier 1 — Correctness bugs

- [ ] **🔴 M · Max tile size 256 drives a synchronous 256³ = 16.7 M-voxel carve that freezes the tab.**
      `TILE_MAX = 256` (`src/lib/atlas.js:20-21`) and the editor stepper exposes the
      whole range (`src/editor.js:234` `sizeMax=256`, passed at `:461`). A square 256px
      tile carves an `nx=ny=nz=256` grid: `carve()` (`src/lib/carve.js:103-153`) runs a
      fully synchronous triple loop over 16,777,216 voxels, then `extractSurface()` and
      `colorize()` walk the same arrays again (colorize marches a depth ray per exposed
      face) — all on the main thread inside `rebuild()`, no chunking/worker/yield. ~100px
      already stutters; 256 hangs the tab for seconds-to-minutes. Trivially reachable:
      hold the **+** stepper, type 256, or load `?tile=256` (`src/main.js:537-539` clamps
      the _integer_ into [1,256] but not the O(n³) work).
      → Lower `TILE_MAX` to a tractable ceiling (e.g. 64 → 262 k voxels), **or** gate on
      a voxel-count threshold (`nx*ny*nz`) with a `ui.setStats` warning + skip/defer, **or**
      move `carve`/`colorize` into a Web Worker (they're pure typed-array code, trivially
      transferable). At minimum, stop freezing silently.
      _Gate: `npm test`; `?tile=200` no longer hangs; `?tile=64` still builds._

- [ ] **⚪ S · Toolbar tool-switch leaves a stale pencil footprint outline on the canvas.**
      The keyboard tool-switch (`onKeyDown`, `src/editor.js`) ends with
      `redrawCursorLayer()` (`:804`) which clears the pencil hover footprint. The three
      toolbar buttons `pencilBtn/rectBtn/fillBtn.onclick` (`src/editor.js:468-500`) call
      `renderToolOptions()` + `syncUI()` but **not** `redrawCursorLayer()`. So: hover with
      pencil (footprint painted on the cursor overlay) → move off-canvas → click rect/fill
      → the ghost outline stays drawn until the next `pointermove`, and since `syncUI()`
      removed `.pencil-active` you see the OS cursor **and** the ghost at once. Keyboard
      path (`B`/`R`/`G`) is fine, so the two entry points diverge.
      → Call `redrawCursorLayer()` in the three button handlers after `syncUI()`; better,
      fold the shared switch body (cancelRect + set brush + `renderToolOptions` + `syncUI` + `redrawCursorLayer`) into one helper both paths call.
      _Gate: `?edit=front` + manual button click; visual (no ghost outline)._

- [ ] **⚪ S · `renderUsed` early-return skips the "in-sprite" ring refresh when erasing the last pixel of the pinned ink.**
      `renderUsed()` (`src/editor.js:630-659`) builds a signature from
      `painted ∪ {brush.color}` (`:640-642`) and early-returns at `:643` when unchanged,
      skipping `syncActiveSwatch()` **and** `markInSprite()` — but `markInSprite` is fed
      `painted` (`:658`), a _different_ set. Reachable: pick color B, paint it, set
      `brush.erase` via the transparent swatch while `brush.color` stays B, erase the last
      B pixel → `painted` drops B but the signature set still has it → sig unchanged →
      early return → the "in sprite" ring stays lit on B in the 256-color modal. Cosmetic,
      modal-only, transient. _(Verification upgraded this from "self-consistent" — the
      divergence is genuinely reachable.)_
      → Move `markInSprite`/`syncActiveSwatch` outside the early-return (gate only the DOM
      swatch rebuild on the signature).
      _Gate: `npm test` (editor logic unaffected); manual repro in `?palette=1`._

## Tier 2 — Robustness & edge cases

_(Both are defensive/latent — no current caller triggers them, but they sit at input
boundaries with no contract.)_

- [ ] **⚪ S · No sheet-shape validation at the atlas ingestion boundary.**
      `onAtlas` (`src/main.js:488-491`) assigns `state.atlasImage` and builds with zero
      shape validation; the sample path (`:479`) resolves an arbitrary image.
      `deriveTileSize` (`src/lib/atlas.js:36-39`) computes `width/cols` with no
      integer/finite check. `sliceAtlas`'s dimension guard (`atlas.js:86`) catches
      missing/zero/NaN dims but **not** a present-but-too-short `data` buffer — `subTile`
      then reads `undefined` bytes → 0/transparent → silently partly-blank tiles, no
      warning. `resizeAtlas` (`atlas.js:252-292`) has no shape guard at all.
      → Extract one `validateSheet(img)` (finite `width,height > 0` and
      `data.length >= width*height*4`), call it at the boundary
      (`onAtlas`/`onSample`/`sliceAndBuild`) before assigning `state.atlasImage`, surface
      via `ui.setError` (mirroring the decode `try/catch`). Then `sliceAtlas`/`resizeAtlas`
      can trust their input.
      _Gate: `npm test` + a new degenerate-sheet test asserting the warning/error path._

- [ ] **⚪ S · `gridToImageData` throws on an empty rows array and mis-indexes ragged grids.**
      `src/lib/sprite-data.js:10-27`: `h = rows.length; w = rows[0].length` with no guard
      (`:11-12`). Empty `rows` → `rows[0]` undefined → TypeError; a ragged grid
      over/under-indexes silently (`w` from `rows[0]` only). Only `cubeAtlasImage()` feeds
      it today (hardcoded well-formed grid) so it can't fire — but it's an exported helper
      with no input contract, and samples build **eagerly at import**, so any future
      empty/ragged caller crashes at module load.
      → Guard the empty case (return 0×0 `ImageData` or throw a descriptive error); assert
      or document uniform row length.
      _Gate: `npm test` + a unit test for the empty/ragged input._

## Tier 3 — Performance

_(All low — the app already runs one draw call. These are hot-loop tidiness + an
idle-GPU fix; note "micro" vs "meaningful" per item.)_

- [ ] **⚪ M · Render loop renders + updates controls every frame even when nothing changes.**
      `tick()` (`src/main.js:524-529`) unconditionally calls `controls.update()` +
      `renderer.render()` every rAF. With `?rotate=0`, no drag, and OrbitControls damping
      settled, the GPU redraws the full scene (2048² shadow maps, PCF) at 60fps forever.
      `enableDamping` needs `controls.update()` only _while_ damping is in flight.
      → Gate rendering on a `needsRender` flag set by controls `change`/`start`/`end`,
      resize, rebuild, and autoRotate; render every frame only while `autoRotate` is true.
      _Meaningful for battery/idle-GPU; active frame-time unchanged. Gate: visual — object
      still rotates/drags smoothly; `?rotate=1` still spins._

- [ ] **⚪ M · `carve()` allocates a fresh `{u,v}` object per voxel × view in the innermost loop.**
      `src/lib/carve.js:131-151` calls `spec.project(x,y,z,dims)` which returns a new
      object literal (`src/lib/views.js:78/88/102/113/125/138`); `colorize.sampleView`
      (`src/lib/colorize.js:84-89`) has the same shape per exposed face. On a 48³ tile ×
      up to 6 views that's hundreds of thousands of short-lived allocations per carve, and
      carve re-runs on **every** live edit.
      → Add a `projectInto(x,y,z,d,out)` to each `VIEWS` entry that mutates one reused
      `{u,v}` (or compute the flat `u*imgW+v` inline); hoist one scratch object outside the
      loops.
      _Micro — the literal never escapes, so V8 scalar-replacement likely absorbs much of
      it; fix is cheap/correct, practical win uncertain. Gate: `npm test`._

- [ ] **⚪ S · `buildVoxels` recomputes `solidCount` with a third full O(n³) pass.**
      `src/lib/pipeline.js:41-42` runs a standalone `for i… solidCount += solid[i]` after
      `carve()` and `extractSurface()` (`src/lib/carve.js:171-197`) have _each_ already
      visited every voxel — `extractSurface` already gates on `if (!solid[idx]) continue`.
      → Return `solidCount` from `carve()` (inc on fill / dec on clear) or add one `count++`
      on the passing branch of `extractSurface()`; drop the pipeline loop.
      _Gate: `npm test` (buildVoxels tests assert counts)._

- [ ] **⚪ S · `faceColorAt` recomputes `FACE_KEYS.indexOf(face)` inside the greedy triple loop.**
      `src/lib/faces.js:147` runs the linear scan on every `(a,b,s)` cell in both
      `culledQuads` (`:165`) and `greedyQuads` (`:192`), though `face` is constant for the
      whole per-face pass (caller iterates `for (const face of FACE_KEYS)`).
      → Pass the known index `f` down, or hoist `const f = FACE_KEYS.indexOf(face)` to
      per-face scope. _Micro. Gate: `npm test`._

## Tier 4 — DRY, dead code & cleanup

- [ ] **🟠 M · Face-normal vocabulary is triplicated across `carve.js`, `views.js`, `faces.js`.**
      The six outward normals in `px,nx,py,ny,pz,nz` order are hand-spelled three times:
      `carve.js` `NEIGHBORS` (`:156-163`) beside `FACE_KEYS` (`:164`); `views.js`
      `FACE_NORMAL` (`:38-45`); and `faces.js` `FACE_GEO`'s per-face `normal:` literals
      (`:19/38/57/76/95/114`). `views.js` already comments that `FACE_AXIS` is "derived
      from `FACE_NORMAL` so it can't drift" — but `NEIGHBORS` and `FACE_GEO.normal` aren't
      held to that. Three copies can silently drift from the convention the 6-bit mask and
      `faceColor` keying depend on.
      → Make `FACE_NORMAL` (indexed by `FACE_KEYS`) the single source. In `carve.js`,
      `NEIGHBORS = FACE_KEYS.map(k => FACE_NORMAL[k])`; in `faces.js` read `FACE_NORMAL[face]`
      instead of the literal. Consider co-locating `FACE_KEYS` + `FACE_NORMAL`.
      _Gate: `npm test` (pipeline + wedge-mesh cover the normal-dependent paths)._

- [ ] **🟠 S · Distinct-opaque-color extraction + 24-bit key is copy-pasted between `main.js` and `editor.js`.**
      `editor.js` `distinctWorkColors()` (`:616-628`) and `main.js` `usedColorsExcept()`
      (`:320-337`) have byte-identical inner loops (walk RGBA 4 bytes at a time, skip
      alpha-0, dedup by a 24-bit packed key — `editor.js:416` `rkey`, `main.js:330`
      inline). This is a _third_ packed-color layout (big-endian 24-bit RGB) vs
      `ingest.packRGBA`'s canonical little-endian RGBA.
      → Extract one pure `distinctColors(rgbaData) → [{r,g,b}]` into a shared util
      (`fill.js` or a small color util) + one `rgbKey({r,g,b})`; call from both.
      _Gate: `npm test`; palette row + used-color pips still render (`?palette=1`)._

- [ ] **⚪ S · `isAllTransparent` (main.js) duplicates the non-exported `isBlank` (atlas.js).**
      `src/main.js:245-249` scans `for i=3; i<d.length; i+=4` — byte-for-byte
      `atlas.js` `isBlank` (`:56-59`), which isn't exported. Same "is this tile empty?"
      purpose at both call sites (`main.js:285` vs `atlas.js:114`), and `fill.js`/`editor.js`
      comments already cite "`atlas.isBlank`" as _the_ shared invariant while the second
      caller rolls its own.
      → Export `isBlank`, import it in `main.js`, delete `isAllTransparent`, repoint the
      comments. _Gate: `npm test`._

- [ ] **⚪ S · `mirrorImage` (ui.js) and `flip` (ingest.js) are the same axis-flip blit.**
      `ui.js:51-67` `mirrorImage(img, axis)` and `ingest.js:53-70` `flip(img, flipX, flipY)`
      both allocate `W*H*4` and copy with the same mirror math; `mirrorImage` is just `flip`
      with a single-axis boolean from an `'x'/'y'` string. `flip` isn't exported so `ui.js`
      can't reuse it.
      → Export one `flip(img, flipX, flipY)`; implement `mirrorImage` as
      `flip(img, axis==='x', axis==='y')` or drop it. _Gate: `npm test`; onion-skin seed
      still mirrors correctly (`?edit=right`)._

- [ ] **⚪ S · `#rrggbb` hex parsing is reimplemented in `editor.js` and twice in `constants.js`.**
      The `parseInt(css.slice(1,3),16)/…` decode appears as `editor.js` `hexToRgb`
      (`:129-135`) and twice in `constants.js` building `PENCIL_PALETTE` (`:53-56`) and
      `PALETTE_256` (`:115-118`). `constants.js` already computes each swatch's packed
      uint32, yet `editor.js` re-parses css → `{r,g,b}` at runtime (~10 call sites incl.
      `:258/415/473/485/497/692/782/787/792/823`).
      → Attach `{r,g,b}` (or reuse `packed` via `unpackRGBA`) to each palette entry; delete
      `editor.js` `hexToRgb`. If a css→rgb helper is still wanted, export one shared.
      _Gate: `npm test` (palette suite); colors render correctly (`?palette=1`, `?pick=N`)._

- [ ] **⚪ S · `ALPHA_SOLID = 128` is duplicated in `ingest.js` and `guides.js`.**
      `ingest.js:21` defines it; `guides.js:18` redefines the same value with a comment
      "matches ingest.js hard-pixel threshold" — an explicit hand-sync. Both drive
      `data[…+3] >= ALPHA_SOLID` (`ingest.js:107`, `guides.js:32`).
      → Export `ALPHA_SOLID` from `ingest.js` (or `constants.js`), import in `guides.js`,
      drop the literal + comment. _Gate: `npm test` (guides suite)._

- [ ] **⚪ S · Wedge-mesh `FKEY`/`FIDX`/`AXI` re-derive face/axis mappings defined elsewhere.**
      `src/lib/wedge-mesh.js:37-48`: `AXI = {x:0,y:1,z:2}` duplicates `views.js:204`
      `AXIS_ARG` (up to the `n`-prefix); `FKEY` (`:39-46`) restates the
      `FACE_NORMAL`/`FACE_AXIS` correspondence; `FIDX` (`:48`) is `FACE_KEYS.indexOf`
      memoized (also done inline in `faces.js:147`).
      → Export a shared `FACE_INDEX` (or `faceKeyOf(axis,sign)`) + the axis-index map and
      import them. _Gate: `npm test` (wedge-mesh watertightness)._

- [ ] **⚪ S · `VIEW_TO_FACE` is exported but only self-consumed, and duplicates `VIEWS[*].face`.**
      `src/lib/views.js:25-35`: `VIEW_TO_FACE` is exported yet its only reference anywhere
      is `:34`, where `views.js` builds `FACE_TO_VIEW` from it; nothing imports the forward
      map, and every pair equals `VIEWS[name].face`. (The inverse `FACE_TO_VIEW` _is_ used
      by `colorize.js`.)
      → Make `VIEW_TO_FACE` file-local, or build both from `VIEWS`:
      `FACE_TO_VIEW = Object.fromEntries(VIEW_NAMES.map(n => [VIEWS[n].face, n]))`.
      _Gate: `npm test`._

- [ ] **⚪ S · `VIEW_MIRROR_AXIS` is a six-entry map whose every value is `'x'`.**
      `src/lib/views.js:178-185`; single consumer `src/main.js:351`. A per-view table that's
      constant reads as if the axis varies when it never does, and `mirrorImage`'s `'y'`
      branch (`ui.js:56-57`) is consequently dead in practice.
      → Replace with a documented `MIRROR_AXIS = 'x'` constant (or inline `'x'` with a
      comment); note the unexercised `y` branch. Keep the map only if a view is expected to
      mirror vertically. _Gate: `npm test`; mirror-fill visual unchanged._

- [ ] **⚪ S · `VIEWS` entries carry dead `axis`/`step`/`from`/`face` config that misleads about the depth march.**
      `src/lib/views.js:69-140`: every entry declares `face/axis/step/from` (e.g.
      `front: {…, step:-1, from:'max'}`), but a repo-wide grep shows none are read — the
      only consumers read `spec.project` (+ carve reads `imgW/imgH`). The real first-hit
      march (`colorize.firstHitFromFace`, `:70-82`) derives direction purely from
      `FACE_NORMAL`. Not a live bug (they agree), but a drift hazard: flipping `step` here
      would silently do nothing.
      → Delete the unused keys, or comment them documentation-only; if kept, add a test
      asserting `step`/`from` agree with `FACE_NORMAL`. _Gate: `npm test`._

- [ ] **⚪ S · Wedge `dominant` fallback is misnamed and effectively unreachable.**
      `src/lib/wedge-mesh.js:66`: `const dominant = palette?.length ? palette[0] : FLAT_COLOR`
      — named "dominant" but it's the _first_ color inserted (scan order), not the
      most-frequent (unlike `colorize.js:213-214`'s real tally). It's consulted only at
      `:140`, after the gate at `:134` (`if (!flat && !sameMat(cA,cB)) continue`); since
      `sameMat` is false when either operand is null, passing the non-flat gate guarantees
      both `cA,cB` are non-null, so `dominant` can only be selected in **flat** mode — where
      the color is overridden to `FLAT_COLOR` at `:217`. It's never rendered.
      → Drop the fallback (`const color = (cA != null ? cA : cB) >>> 0`), or rename it
      `bodyFallback` and comment that it's flat-mode-only. _Gate: `npm test` + `?flat=1`
      visual unchanged._

- [ ] **⚪ S · `?diag=1` async import can read geometry a later `rebuild()` already disposed.**
      `src/main.js:185` captures `current.geometry` into `geo` and passes it to a
      dynamically-imported `computeDiag()` in a `.then()`. A fast live edit under `?diag=1`
      can run another `rebuild()` (which does `scene.remove` + `geometry.dispose()`,
      `:152`) before the import settles. Benign today — THREE's `dispose()` only fires a GPU
      event and leaves the JS typed arrays intact until GC — but it measures a stale mesh.
      → Gate the `.then()` on `geo === current?.geometry`. Dev-only, low priority.
      _Gate: `?diag=1` still prints the watertightness readout._

- [ ] **⚪ S · App-level listeners are never removed (HMR-only concern).**
      `src/main.js` registers window `resize` (`:516`), a canvas `ResizeObserver` (`:521`,
      handle not retained), the `tick()` rAF (`:528`); `ui.js` registers document `click`
      (`:143`) + app drag/drop (`:163-182`). None are torn down. **Not** a production leak
      (single-mount SPA), but Vite HMR re-executes module top level on edit without
      unloading, accumulating duplicate handlers + rAF loops until a full reload.
      → Optional: `import.meta.hot?.dispose(() => { removeEventListener…; cancelAnimationFrame(rafId); resizeObserver.disconnect(); })`.
      Otherwise fine as-is. _(Note: the three `cancelAnimationFrame` calls at
      `main.js:273/406/448` are for the separate `liveRAF` preview loop, not `tick()`.)_
      _Gate: none (dev ergonomics)._

## Tier 5 — Docs & comment drift

- [ ] **🟠 S · README describes a UI "faces preview" that no longer exists.**
      `README.md:56-57` says the UI's "faces" preview "lays the sliced tiles out like the
      sheet, so you can eyeball each tile's orientation against this table's Front points
      column." No such preview exists: `ui.js` renders only the header + stage overlays,
      and the editor shows six **text** tabs (`editor.js:292-301`) with no tile image or
      Front-points marker. `views.js:147/155-162` comments still reference the gone grid.
      → Reword to the actual UI (tabs switch which face you edit; orientation is checked via
      onion-skin/guides + the table's Front points column); drop the "lays out like the
      sheet" claim; fix the `views.js` comments. _Gate: prose review._

- [ ] **🟠 S · `main.js:237` comment + `docs/drawing-editor-plan.md` point to a superseded design.**
      `src/main.js:237` (`// Tile editor wiring (see docs/drawing-editor-plan.md)`) sends
      readers to a doc describing a design no longer shipped — a **modal** editor opened
      from a "faces" preview, a `ui.setDrawingMode` API that exists **nowhere** in `src`, a
      "6×3 grid of 16 DB16 colors", and a "left sidebar + middle viewport" layout. The
      shipped editor is an always-open docked panel (`createTileEditor`) with pencil/rect/fill
      tools + a 256-color modal in a 50/50 split; DB16 only seeds the default brush.
      → Repoint the `main.js:237` pointer at README's "Drawing editor" / `editor.js`'s
      header; add a stronger "superseded — history only" banner atop the plan doc (or move
      it to `docs/archive/`). _Gate: prose review._

- [ ] **⚪ S · `TODO.md` presents completed/obsolete items as an open, unchecked backlog.**
      All 34 items are `[ ]` yet the banner says "✅ Executed": Tier 3 README fixes are
      applied, Tier 4 `mesh-util` extraction is done (`mesh-util.js` exists), Tier 7
      CI/tsconfig/prettier/editorconfig all exist. Meanwhile Tiers 1–6 cite **deleted**
      files as actionable (`textured-box.js`, the `vectorize→lowpoly→diagonalize→diag-preview`
      chain). Genuinely still open: a `LICENSE` file + `package.json` `license` field (both
      absent — `TODO.md:269-275`).
      → Check off / strike executed items, mark deleted-file items "N/A — file removed",
      prune to what's live (the missing LICENSE), or archive `TODO.md` as a dated historical
      review. _Gate: prose review._

- [ ] **⚪ S · `finishVoxelMesh` doc claims it rests the base on `y=0`, but the code hard-codes a 0 Y offset.**
      `src/lib/mesh-util.js:31-34` JSDoc says "center on X/Z, rest its base on the ground
      (y=0)"; `wedge-mesh.js:269` repeats it. The transform is
      `geo.translate((-nx*s)/2, 0, (-nz*s)/2)` (`mesh-util.js:40`) — Y is a hard-coded 0, no
      `min.y` subtraction. Vertical position is whatever the artist painted (`carve.js:77-79`
      "no auto ground-rest"), and `main.js:433-434` documents the intentional float-up after
      tile-resize centering. Comment-only, but actively misleading. **Do not** add a y-rest
      translate.
      → Reword `mesh-util.js:33` + `wedge-mesh.js:269` to "centers X/Z, leaves Y as
      authored". _Gate: prose review._

- [ ] **⚪ S · README quickstart under-describes the test suite.**
      `README.md:12` calls `npm test` "pipeline + wedge-mesh + atlas round-trip", but the
      suite is seven files (adds guides, rect, fill, palette; the Architecture section
      `:297-311` lists all seven correctly).
      → Change the quickstart comment to e.g. `# unit + integration tests (node --test)`.
      _Gate: prose review._

- [ ] **⚪ S · `tsconfig` excludes `test/` from typecheck; README omits lint/format/typecheck scripts.**
      `tsconfig.json:15` `include: ["src"]` means the seven `test/*.mjs` are never
      type-checked despite `checkJs`. README (`:11-13`) documents dev/test/build but not the
      `typecheck`/`lint`/`format` scripts (`package.json:15-17`).
      → Optionally add `"test"` to the tsconfig include (or a second config); mention
      `npm run lint`/`typecheck` in the README dev section. _Gate: `npm run typecheck`._

## Tier 6 — Testing gaps

- [ ] **🟠 M · `colorize()` fallback branches (mirror-fill, relaxation, dominant-body) have no value test.**
      `colorize()` — the module the README calls "most likely to look wrong" — is never
      called directly; only leaf helpers `buildPalette`/`makeSnapper` are unit-tested. Its
      four-tier fallback lacks value assertions: the mirror-fill branch
      (`src/lib/colorize.js:130-135`) is gated on `mirror[FACE_AXIS]` but tests only set
      `mirror.x` (no `mirror.y/z`), so the y/z branches never run; the neighbor-averaging
      relaxation loop (`:141-206`) and dominant-body fallback (`:208-216`) have **zero**
      value assertions (phantom-block/truck tests only assert `faceColor.has(...)`). A
      regression breaking averaging or the dominant tally would still pass.
      → Add `colorize.test.mjs` calling `colorize()` directly with hand-built `gviews`:
      (a) facing view occluded, opposite present, mirror on — assert the mirrored color for
      **x, y, and z**; (b) mirror-off falling through to relaxation — assert the averaged
      snapped color; (c) geometry forcing the dominant branch — assert the majority color.
      Add a `buildVoxels` test toggling `mirror.y`/`mirror.z`.
      _Gate: `npm test`._

- [ ] **🟠 M · `carve`/`extractSurface`/`reconcileDims`/`gridViews`/`placeView`/`unvoxIndex` tested only transitively.**
      Tests import only `voxIndex` from `carve.js`. Concretely uncovered: `carve()`'s
      plane-UNION logic (`carve.js:123-152`); `placeView()`'s general padding path
      (`ingest.js:132-146`) incl. negative-offset/clip (gridViews always passes `off=0`);
      `unvoxIndex` round-trip (`voxIndex(unvoxIndex(i))===i`); `reconcileDims`'s
      unconstrained-axis warning (`carve.js:49-54`).
      → Add `carve.test.mjs`: unvox/vox round-trip over non-cubic dims; `extractSurface` on
      a known 2×2×2 solid (exact 6-bit masks + count); `reconcileDims` unconstrained axis
      (default=1 + "unconstrained" warning); `placeView` with a smaller view + non-zero and
      negative offsets. _Gate: `npm test`._

- [ ] **🟠 M · `mesh.js` `voxelMesh` and `mesh-util.js` (linearizer + `finishVoxelMesh`) have zero tests.**
      `wedge-mesh.test.mjs` proves THREE loads, but the voxel-mode builder `voxelMesh()`
      (`mesh.js:22`) and its shared deps `makeVertexColorLinearizer()` (`mesh-util.js:15`)
      and `finishVoxelMesh()` (`:39`) are untested — extracted "so the two builders can't
      drift", yet nothing asserts it (oddEdges runs only vs `wedgeMesh`).
      → Reuse `oddEdges()` against `voxelMesh(buildVoxels(cube))` + a non-cube; assert X/Z
      centering (and that **Y is authored**, not `min.y===0` — see Docs item above);
      unit-test the linearizer for a known packed color → linear triple + that it caches
      (same array ref for repeat keys). _Gate: `npm test`._

- [ ] **🟠 M · `eliminateTJunctions`: only the single-vertex split is tested.**
      The one direct test (`pipeline.test.mjs:473-486`) inserts a single interior vertex.
      Uncovered: an edge with **multiple** interior lattice points
      (`t-junction.js:37-42`) + the multi-vertex ring triangulation; the defensive
      fan-fallback in `triangulateConvex` (`:99-118`, self-labeled a "safety net"), never
      reached; per-triangle color/normal preservation (the test uses one color).
      → Add cases: a rect edge split at ≥2 interior vertices (assert no T-junctions +
      conserved area via shoelace + preserved color/normal); a convex ring with collinear
      boundary points forcing the non-ear-clip path. _Gate: `npm test`._

- [ ] **🟠 S · `applyTransform`: only `rot:1` tested — flips, `rot 2/3`, negative rot, and the pipeline branch uncovered.**
      `applyTransform` is the reorientation for non-conforming sheets, but only `rot:1` is
      exercised (`pipeline.test.mjs:282-296`). Untested: `flip()`'s flipX/flipY branches
      (`ingest.js:53-70`); the rot normalization `(((t.rot||0)%4)+4)%4` (`:80`); rot+flip
      ordering (flip after rot); and `buildVoxels` never passes `transforms`, so
      `pipeline.js:24`'s `transforms[name]` branch is uncovered end-to-end.
      → Assert flipX/flipY on a 2×1 asymmetric image; `rot:2`/`rot:3`; `rot:-1 === rot:3`;
      rot+flip ordering; one `buildVoxels` test passing `opts.transforms`.
      _Gate: `npm test`._

- [ ] **🟠 S · `sliceAtlas` warning/guard paths (unusable / non-divisible / unknown view) untested.**
      Only the happy path (clean 3×2) is tested. Three user-facing warning branches are
      unasserted: "Atlas is unusable" for 0-size/sub-1px tiles (`atlas.js:86-92`); the
      non-divisible warning `cols*tileW !== img.width` (`:94-100`); the "Unknown view"
      warning + tile-skip `continue` (`:106-112`).
      → Add `sliceAtlas` cases: tiny sheet (empty views + `/unusable/` warning); a 7×5
      non-divisible sheet (`/but image is/` warning + top-left reads); a custom layout with
      a bogus view name (`/Unknown view/`). _Gate: `npm test`._

- [ ] **⚪ S · `faceGuides` tested only for `front`.**
      `guides.test.mjs:55-78` only calls `name='front'`. The per-face colFlip/rowFlip
      handling (`guides.js:42/54/71`) differs per face — a flip-sign error on `right`/`bottom`
      would mis-place hairlines with no failing test; the both-siblings-present union path
      is also never asserted.
      → Parameterize over all six faces (at least `top` and `right`); add a both-siblings
      case with differing extents. _Gate: `npm test`._

- [ ] **⚪ S · `roundedRectRows` non-zero-origin offset arithmetic barely covered.**
      Only one r>0 test uses a non-zero top-left (1,2); the emitted run `cb(y, x0+clip, x1-clip)`
      (`rect.js:77`) computes `clip` from relative positions, so an origin-translation
      off-by-one is masked at (0,0). No test asserts actual `xl/xr` values at a non-zero
      origin.
      → Add a rounded raster at e.g. `x0=5,y0=7` asserting concrete `xl/xr` for top + middle
      rows. _Gate: `npm test`._

- [ ] **⚪ S · `ingestSprite` malformed-input throw path is not asserted.**
      `ingestSprite`'s validation throw (`ingest.js:95-100`, fired on `width/height<=0` or
      `data.length < w*h*4`) — the module's only error path — has no `assert.throws` test
      (`rg` finds zero `assert.throws` in `test/`).
      → `assert.throws(() => ingestSprite({width:0,height:1,data:new Uint8ClampedArray(4)}))` + a truncated-data case. _Gate: `npm test`._

- [ ] **⚪ S · `mirrorImage` (ui.js) and `computeDiag` (diag.js) pure helpers have no tests.**
      `mirrorImage` (`ui.js:51-67`) is a pure image-flip main.js uses to seed the editor
      canvas — an x/y mix-up would only surface as a mirrored-face surprise. `computeDiag`
      (`diag.js:10`), the `?diag=1` watertightness self-check, is pure over a geometry-like
      input and untested — and `wedge-mesh.test.mjs` reimplements its own `oddEdges()`
      rather than exercising `computeDiag`, so the shipped check could regress silently.
      → Test `mirrorImage` on a 2×1 asymmetric image (axis `x` swaps columns, `y` swaps
      rows); have `wedge-mesh.test.mjs` call `computeDiag` instead of its private `oddEdges`,
      or add a watertight-vs-open geometry stub test. _Gate: `npm test`._

## Tier 7 — DX & tooling

- [ ] **🔴 S · CI never runs `npm run lint`, so Prettier drift lands unchecked — and the tree is already non-conformant.**
      The `lint` script (`prettier --check .`, `package.json:17`) exists but CI
      (`.github/workflows/ci.yml:18-20`) runs only typecheck/test/build. The gap is real,
      not theoretical: **`npm run lint` fails today** on `test/palette.test.mjs:30` (a long
      `assert.fail(...)` line over `printWidth: 90`, `.prettierrc.json:4`). Because CI skips
      lint, the drift merged and will keep accumulating. _(Independently confirmed: typecheck,
      test, and build are green; only lint is red.)_
      → `npm run format` (or `npx prettier --write test/palette.test.mjs`) to fix the
      existing drift, then add `- run: npm run lint` to `ci.yml`.
      _Gate: `npm run lint` green; CI step present._

- [ ] **⚪ S · `capture.sh dom` mode never validates output — silent false success.**
      Only `shot` mode checks Chrome produced a file (`tools/capture.sh:111-113`, gated on
      `[ -s "$OUT" ]`). The `dom` branch (`:79-80`) relies on
      `wait "$CHROME_PID" 2>/dev/null || true` (`:108`), swallowing Chrome's exit code — so
      if Chrome fails or the dev server is down, `capture.sh dom <url>` prints nothing and
      still exits 0, handing an agent a false-success signal.
      → Capture `dom` stdout to a temp file, gate on non-empty like shot mode
      (`[ -s "$domfile" ] || { echo 'capture failed: empty DOM' >&2; exit 1; }`) before
      printing; at minimum stop discarding Chrome's exit status for dom mode. Keep the
      `|| true` on the cleanup lines (reap/pkill/kill) — those are correct.
      _Gate: `capture.sh dom` against a dead port exits non-zero._

---

## How this list was produced

Multi-agent review: 10 dimensions (correctness × pipeline/mesh/editor, resource
lifecycle, robustness, performance, DRY/dead-code, docs drift, testing gaps,
DX/tooling) each read the live code and filed findings; every finding was then
**adversarially verified** by a second agent that re-opened the cited code and
confirmed (or corrected/rejected) it; a synthesis pass deduped and grouped. 43
findings confirmed → 40 after dedup (2 duplicates merged, plus the two Prettier
findings folded into DX §T1). The two 🔴 items were additionally re-checked by hand
against the current tree. Severity/effort are reviewer estimates — reprioritize as
needed.
