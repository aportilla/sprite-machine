# Plan: in-app tile drawing editor

**Status:** implemented, then evolved past this plan (see note) · **Date:** 2026-07-16

> **Update — shipped design differs from this plan.** The editor was first built
> as the modal below, then reworked into a **docked panel**: the app is now a
> left **sidebar** + middle **3D viewport** (`index.html` `#sidebar`/`#viewport`,
> flex layout in `style.css`); clicking a face **expands the sidebar** and docks
> the editor **below the controls** while the 3D view shrinks but stays live
> (`ui.setDrawingMode`, `createTileEditor` in `editor.js`). Other changes on top
> of this plan: pencil/eraser are gone — tools live in one **6×3 grid** of 16
> DB16 colors + an **eyedropper** + a **transparent (eraser)** tile; a
> **mirror-partner toggle** swaps the edited face to its opposite for reference;
> the dropzone/preview was replaced by a **"pick atlas" button** with the **whole
> app** as a drag-drop target; and `writeTexel` normalizes fully-transparent
> texels so erasing invisible pixels can't silently un-derive a face (a bug the
> adversarial review caught). The data model, mirror/dirty semantics, live-rebuild
> plumbing, `blitTile`/`cellOf`, DB16 palette, and download below are unchanged.

Add a basic drawing tool: click a face tile in the **faces** preview to open a
modal pixel editor (16-color palette + pencil/eraser); strokes update the 3D
preview live; a **download** button saves the current atlas as a PNG. The
feature is purely additive — no changes to the voxel pipeline (`carve`,
`colorize`, `ingest`) or the mesh builders.

---

## Locked decisions

1. **Palette:** the fixed **DB16** (DawnBringer 16) ramp — 16 colors, exact
   values listed in [§3B](#b-fixed-16-color-palette-db16).
2. **Mirror-derived faces:** a face with no art of its own stays
   **mirror-derived unless the user provides explicit pixels.** The editor
   pre-seeds its canvas with the mirrored-opposite image (so what you edit
   matches what the thumbnail shows); the face only becomes real, independent
   art once the user actually edits it. Open-and-close-without-drawing leaves it
   mirror-derived. See [§3D](#d-mirror-derived-faces).
3. **Edit semantics:** **every stroke stays** — live edits, no cancel/revert.
   Closing the modal keeps whatever was drawn.
4. **Download:** fixed filename **`atlas.png`**.

---

## 1. How it fits the existing architecture

This is mostly _wiring_ onto seams that already exist — not new machinery.

| What we need                  | What already exists                                                                | Where                      |
| ----------------------------- | ---------------------------------------------------------------------------------- | -------------------------- |
| Source of truth for the sheet | `state.atlasImage` (a real `ImageData`)                                            | `main.js:63`               |
| Re-render on change           | `rebuild()` — reads `state.views`, **disposes the old mesh** (leak-safe), rebuilds | `main.js:91`               |
| Per-tile data                 | `state.views[name]` = `{width,height,data}` cell, or `null` if blank               | `main.js`, `atlas.js`      |
| Clickable targets             | `slotEls[name] = {slot, cv}` — one `<canvas>` per face                             | `ui.js:167-174`            |
| Callback pattern              | `createUI({ onSample, onAtlas, onOptionChange })`                                  | `ui.js:95` / `main.js:157` |
| Tile ↔ sheet math            | `subTile(img, sx, sy, w, h)`, `sx=c*tileW, sy=r*tileH`                             | `atlas.js:34,102`          |

**Canonical data model.** Every edit is blitted back into `state.atlasImage`,
which remains the single source of truth. `state.views` is _replaced wholesale_
on every `sliceAndBuild` (`main.js:145`), so edits stored only in `state.views`
would be silently discarded on the next sample switch or atlas drop. Keeping the
sheet in sync also makes **download free** — `state.atlasImage` already _is_ the
current atlas.

---

## 2. The caveat we state honestly

**Drawn pixels are not 1:1 with voxels.** Downstream of the tile, `buildVoxels`
crops each view to its alpha bounding box (`ingest.js:94`), reconciles each axis
to the **max** extent across views (`reconcileDims`, `carve.js:53`), then
**nearest-neighbor resamples** to that grid (`resampleView`, `ingest.js:135`).
So if the user draws FRONT wider than BACK, the model rescales along X and single
edge pixels can shift or drop. This is _pre-existing_ pipeline behavior (README:
"disagreeing views are resampled up") — the editor merely inherits it. We will
**not** claim pixel-perfect fidelity. Optional nicety: surface the reconciled
`result.dims` in the editor so the effective resolution is visible.

---

## 3. Design details

### A. The editing surface = the full `tileW × tileH` cell

Not the auto-cropped content, and not the whole sheet. The full cell is the only
representation that lets a user draw _new_ pixels outside the current alpha
bounds (the crop happens later, inside `buildVoxels`→`ingestSprite`). A `null`
(blank) tile opens as a fresh transparent `Uint8ClampedArray(tileW*tileH*4)`.

Use the **rounded** `tileW/tileH` that `sliceAtlas` returned (cache them in
`state`) for both the blank-buffer size and the blit rect — never re-derive from
image dimensions (off-by-one on non-divisible sheets; `sliceAtlas` _warns_ but
does not fail when `cols*tileW != width`). The blit writes only within
`[sx, sx+tileW) × [sy, sy+tileH)`, leaving any remainder pixels of a
non-divisible sheet untouched.

### B. Fixed 16-color palette (DB16)

No fixed palette exists in the codebase today — the render palette is derived
per-sprite by `buildPalette` (`colorize.js:28`). We add a new **authoring**
palette, `PENCIL_PALETTE`, to `src/lib/constants.js` as 16 packed-RGBA `uint32`
values (via `packRGBA`, `a=255`). This is _only_ the brush's swatch set;
`buildPalette`/`makeSnapper` stay untouched, and because drawn pixels are already
exact palette colors, snapping is a no-op on them.

**Wedge-gate safety.** The low-poly wedge merge test `sameMat` uses
`TOL2 = 12*12` (~12 Euclidean units, `wedge-mesh.js:70`); two _distinct_ palette
colors closer than that would falsely fuse into a smooth wedge. DB16's minimum
pairwise distance is ≈58 — comfortably clear — so no two swatches can false-merge.
DB16 also includes neutral grays, so the `palette[0]` dominant-body fallback
(`colorize.js:220`, `wedge-mesh.js:61`) stays sensible.

DB16 values (index → hex → r,g,b):

| #   | hex       | r,g,b      |     | #   | hex       | r,g,b       |
| --- | --------- | ---------- | --- | --- | --------- | ----------- |
| 0   | `#140c1c` | 20,12,28   |     | 8   | `#597dce` | 89,125,206  |
| 1   | `#442434` | 68,36,52   |     | 9   | `#d27d2c` | 210,125,44  |
| 2   | `#30346d` | 48,52,109  |     | 10  | `#8595a1` | 133,149,161 |
| 3   | `#4e4a4e` | 78,74,78   |     | 11  | `#6daa2c` | 109,170,44  |
| 4   | `#854c30` | 133,76,48  |     | 12  | `#d2aa99` | 210,170,153 |
| 5   | `#346524` | 52,101,36  |     | 13  | `#6dc2ca` | 109,194,202 |
| 6   | `#d04648` | 208,70,72  |     | 14  | `#dad45e` | 218,212,94  |
| 7   | `#757161` | 117,113,97 |     | 15  | `#deeed6` | 222,238,214 |

### C. Live update via `rebuild()` directly

One tile changed → mutate `state.views[name]` → blit into `state.atlasImage` →
call `rebuild()`. This skips re-slicing all six tiles and the redundant preview
redraws that `sliceAndBuild` would do. Requirements:

- **`frameNext` stays `false`** so the camera never jumps mid-stroke (only
  `sliceAndBuild(true)` sets it).
- **Debounce:** coalesce rebuilds to at most one per animation frame (rAF). The
  editor's own 2D canvas repaints immediately per pixel, decoupled from the 3D
  rebuild cadence, so drawing stays responsive even though
  `buildVoxels` + greedy-mesh + T-junction repair + `mergeVertices` is not free.
- **Carry rotation forward:** copy the old `current.rotation.y` onto the new mesh
  after `scene.add`, so auto-rotate doesn't visibly snap to 0 on each rebuild.
- Leak safety is already handled: `rebuild()` disposes the previous mesh's
  geometry + material (`main.js:95-104`), and both builders emit a single
  textureless `MeshStandardMaterial`. Route **all** live rebuilds through
  `rebuild()`.

### D. Mirror-derived faces

When `state.views[name]` is `null`, the thumbnail shows the _mirrored opposite_
(`setThumbnails`, `ui.js:234-240`). Opening a blank canvas there would be a
jarring "what-you-see-isn't-what-you-edit" discontinuity. Per decision #2:

- **Pre-seed** the editor's working buffer with the mirrored-opposite image
  (reuse `ui.js`'s `mirrorImage` + `VIEW_MIRROR_AXIS`), so the editor shows
  exactly what the thumbnail shows.
- Badge the face: _"derived — editing creates independent art for this face."_
- Track a **`dirty`** flag. On close, if the buffer is unchanged (user drew
  nothing), leave `state.views[name] = null` — the face stays mirror-derived. If
  `dirty`, commit the full buffer as real art for that face.

**Why seed the full mirror rather than only the explicit pixels:** LEFT and RIGHT
project to the same carving plane, and `carve` is an AND of every provided view's
silhouette. Committing a near-empty LEFT tile (only a few explicit pixels) would
erode the whole shape along that axis. Seeding the full mirrored silhouette keeps
carving consistent (the seeded silhouette equals the opposite's), and the user's
edits refine from there. This is the correct reading of "mirror-derived unless
explicit pixels are provided": the tile stays derived until you engage, then your
version (mirror + your changes) becomes the real, now-independent tile.

### E. Hard-pixel alpha rule

Pencil writes `(r,g,b,255)`; eraser writes `(0,0,0,0)`. **No intermediate alpha,
ever** (no anti-aliasing, no soft brush). This keeps `ingest`'s `alpha>=128`
threshold (`ingest.js:14`) and `atlas.isBlank`'s `alpha!==0` test (`atlas.js:49`)
from diverging. A consequence: a fully-erased tile re-slices back to `null` and
reverts to mirror-derived — the desired behavior.

### F. Download

`state.atlasImage` is kept canonical, so the current atlas is always available as
a full-sheet `ImageData`. The download button encodes it to PNG and saves as
`atlas.png`. Round-trip note: the exported PNG is the **raw pre-transform** sheet;
re-importing it goes through `onAtlas`, which resets `transforms={}`
(`main.js:173`), so the 3D round-trips faithfully only under identity transforms
(true for the Car sample and any dropped sheet). Baking transforms into exported
pixels is out of scope.

---

## 4. File-by-file changes (implementation order)

**Step 1 — `src/lib/constants.js`** (modify)
Export `PENCIL_PALETTE`: the 16 DB16 entries, each as `{ packed, css }`
(`packed` via `packRGBA(r,g,b,255)`, `css` as `#rrggbb`). Import `packRGBA` from
`ingest.js` (no cycle — `ingest.js` imports nothing from `constants.js`).

**Step 2 — `src/lib/atlas.js`** (modify)
Add two tested pure helpers beside `subTile`:

- `blitTile(sheet, tile, sx, sy)` — inverse of `subTile`; copies `tile.data` rows
  into `sheet.data` at the rect, in place (does not change the `ImageData`
  identity).
- `cellOf(name, layout = DEFAULT_ATLAS_LAYOUT) → {r,c} | null` — locate a view's
  grid cell without duplicating the layout scan.

**Step 3 — `src/image-io.js`** (modify)
Add `imageDataToBlob(imageData) → Promise<Blob>` (wrap-if-plain guard like
`ui.js:38-41` → canvas → `putImageData` → `toBlob('image/png')`) and
`downloadBlob(blob, filename)` (`createObjectURL` → temporary `<a download>` →
`revokeObjectURL`). First export path in the repo.

**Step 4 — `src/editor.js`** (new)
Self-contained modal, pure DOM (same `el()` idiom as `ui.js`), **zero imports
from the pipeline**. Exports:

```
openTileEditor({ name, tile, tileW, tileH, palette, frontEdge, seedMirror, onLive, onCommit, onClose })
```

- Overlay appended to `document.body`: a large integer-scaled nearest-neighbor
  `<canvas>` (`image-rendering: pixelated`), a 16-swatch DB16 row, a
  pencil/eraser toggle, and a close/done control.
- Holds a working `Uint8ClampedArray` copy of `tile.data`, pre-seeded from
  `seedMirror` for derived faces (§3D). Tracks a `dirty` flag.
- Pointer down/move → map client→tile pixel via the inverse of `drawPixels`'s
  scale/offset math (the scale isn't returned, so recompute
  `scale = max(1, floor(min(box/tileW, box/tileH)))`) → write pencil
  `(r,g,b,255)` / eraser `(0,0,0,0)` → repaint immediately → debounced
  `onLive(workingTile)`.
- Close → `onCommit(workingTile, dirty)`; remove the overlay **and its pointer
  listeners** so nothing leaks across repeated opens.

**Step 5 — `src/ui.js`** (modify)
Add `onTileEdit` + `onDownload` to `createUI`'s params. In the slot loop, **drop
the `'ro'` class** (so base `.slot` `cursor:pointer` applies) and set
`slot.onclick = () => onTileEdit(name)`. Add a "download" button in the atlas
section → `onDownload()`. `setThumbnails` is reused unchanged for post-edit
refresh.

**Step 6 — `src/main.js`** (modify)

- In `sliceAndBuild`, cache `state.tileW/tileH/cols/rows` from `sliceAtlas`'s
  return (rounded values).
- `onTileEdit(name)`: resolve `tile = state.views[name]` or a fresh transparent
  buffer; compute `seedMirror` (mirrored opposite) for derived faces; call
  `openTileEditor({ ... onLive/onCommit → applyTileEdit(name, tile, dirty) })`.
- `applyTileEdit(name, tile, dirty)`: for a derived face, if `!dirty` keep
  `state.views[name] = null`; otherwise
  `state.views[name] = isAllTransparent(tile) ? null : tile`, then
  `blitTile(state.atlasImage, tile, c*tileW, r*tileH)` via `cellOf`,
  `ui.setThumbnails(state.views)`, `ui.setAtlasPreview(state.atlasImage)`, and an
  rAF-debounced `rebuild()` (carrying `rotation.y`).
- `onDownload()`:
  `imageDataToBlob(state.atlasImage).then(b => downloadBlob(b, 'atlas.png'))`.

**Step 7 — `src/style.css`** (modify)
Add `.editor-overlay` (fixed dim backdrop, flex-center), `.editor-panel`,
`.editor-canvas`, `.editor-swatch(.active)`, `.editor-tool(.active)`, and a
`.slot:hover` affordance. Reuse the existing dark tokens.

---

## 5. Testing

**Node (pure, `npm test`)** — add `test/atlas.test.mjs`:

- **Round-trip:** `sliceAtlas(sheet)` then `blitTile` every view back into a
  fresh sheet is byte-equal to the original (divisible sheet).
- **Empty-tile:** a fully-transparent tile blitted in re-slices to `null` via
  `isBlank`.
- **`cellOf`:** returns the correct `{r,c}` for all six view names.

These lock the write-back inverse and the empty-tile semantics.

**Browser (manual, via `tools/capture.sh`)** — click a face → editor opens with
16 DB16 swatches → draw → 3D + thumbnail update live with no camera reframe →
erase → voxels disappear → open a derived face → it shows the mirror, editing it
creates real art, closing without drawing leaves it derived → download → PNG
matches the edited sheet → re-drop that PNG → identical 3D (identity transforms).

---

## 6. Scope

One new module (`editor.js`) + one new test file, ~6 small edits, no
pipeline/mesh changes. The riskiest work is the editor's pointer→pixel mapping
and the rAF debounce; everything else is straightforward wiring onto existing
seams.
