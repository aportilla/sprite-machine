# Plan: layers

**Status:** built 2026-09-12, all seven steps, the gates green, uncommitted and
not yet eyeballed. Every decision taken as recommended (§6), and the build's
refinements are in §9. The ask: _"adding
support for LAYERS to our sprite sheet - and merging them to create our 3d
model. a layer would just be an expansion of our png image... stacking
another set of 2x3 tile faces below the current - and updating our baked in
metadata to track which face-set corresponds to which layer. the 3d model
would be the combination of the 3d shapes in each layer... which would allow
us to compose more complex models that aren't constrained by the convex hull
of our 2d face projections... we'd keep our same ui for the most part - but
add menu commands for switching layers and adding new layers. each layer
would share the same tile size, and so we can use the same faded 'preview' to
show the other layers contents when editing any layer - this will help us
keep things lined up. the 'edge' pixel preview should only be for the
currently edited layer. the 3d model view always shows the unified final
model."_

The short version: a document's PNG grows downward, one 3×2 block of six
tiles per layer, all blocks at one tile size, and a `sprite-machine:layers`
chunk names the blocks in order. The engine carves each layer to its own
visual hull and unions the hulls into one voxel solid, then colors, meshes
and skins that solid as it does today, so the 3D View, the 3D Sprite Atlas,
the glb export, the document icon and the CLI all show the unified model. The
editor edits one layer at a time: the Sprite Editor gains a **Layer** menu
(New Layer, Delete Layer, Rename Layer…, then one item per layer with the
edited one checked), the faded art behind the canvas becomes the other
layers' art on the same face over the edited layer's mirrored opposite, and
the edge hints stay the edited layer's own.

## 1. The model we copy

System 7's paint programs had no layers. The commands come from the layered
programs of the era, Photoshop 3's layer commands and the Layer menu
Photoshop 4 gave them: _New Layer_, _Delete Layer_, a name per layer, and
the current layer shown checked in a list. A new layer becomes the current
one. Layers stack: where two overlap, the later one is on top. The in-app
precedent for a checked list at the tail of a menu is the View menu's window
list, and for a name prompt the document's Rename….

## 2. The design

### 2.1 The sheet and the chunk

A document stays one PNG. With N layers it is `3t` wide and `2tN` tall:
block k (from 0) is the rows `2tk` to `2t(k+1)`, holding that layer's six
tiles in the fixed 3×2 layout. Block 0 is Layer 1, the top block. New Layer
appends a transparent block at the bottom. Every block shares the tile
size, so the lattice is one `t × t × t` box for the whole document and a
pixel at (u, v) in any layer's FRONT tile is the same lattice line as in
every other layer's.

The chunk `sprite-machine:layers` holds the blocks in order:

```json
{ "layers": [{ "name": "Layer 1" }, { "name": "Layer 2" }] }
```

Its length is the layer count and its entries the names. It is written on
every save, like the ring chunk (decision 3), so a one-layer document reads
`{ "layers": [{ "name": "Layer 1" }] }`. Reading is best-effort, like the
other chunks: a missing or malformed chunk, or a count that does not divide
the height into whole blocks, reads as no chunk.

Where the count comes from (decision 2):

- **The engine** takes it from the chunk: `readSheet` returns the names,
  and `sheetToGlb` builds `names.length` layers when that divides the height
  into whole blocks, else one. `buildModel` builds one layer unless given
  `layers`, so a 3t × 2tN sheet with no option reads the tall tiles it reads
  today. The engine accepts non-square tiles, so it never infers layers
  from a shape.
- **The app** takes it from the shape, always: `sheetShape(w, h)` returns
  `{ tile: t, layers: N }` for a `3t × 2tN` sheet with N up to `LAYER_MAX`,
  and the chunk only names the blocks, padded or trimmed to N. So a paste or
  a drop that lost its chunks (the system clipboard strips them) opens as N
  layers named by default, and the first save writes the chunk. A sheet
  that fails the rule opens as it does today, one layer of whatever the 3×2
  layout gives, which the lenient drop allows and the paste refuses. This
  changes one thing: a chunk-less `3t × 2tN` drop, today one layer of tall
  tiles, becomes N square layers.

A `LAYER_MAX` of 8 (decision 9) sits beside `TILE_MAX` in the engine's
`atlas.js`. A stroke carves one layer and unions all of them (§2.6); a
structural change, an undo, a save (the icon) and the CLI carve every
layer; and the list's digit keys run 1 to 8.

The per-view `sprite-machine:transforms` chunk applies to every block's
same-named tile. The app never writes a non-identity transform, and a
foreign sheet is one layer. The ring chunk, `Title`, `Creation Time` and
`Software` are unchanged; nothing reads `Software`, and it stays
`sprite-machine 1`.

### 2.2 The model: a union of hulls

Each layer builds exactly what it would build alone (decision 4): its six
tiles go through ingest, `reconcileDims`, `gridViews`, `carve`,
`extractSurface` and `colorize` as one `buildVoxels` call, with the same
mirror-fill and the same "an axis no view observes is 1" rule. So a layer
needs views on two planes to have depth, as a document does, and adding an
empty layer changes nothing.

`unionVoxels(results)` in the engine's `pipeline.js` merges the per-layer
results into one:

- **Skipped layers.** A result with no provided view is dropped, warnings
  included. This is load-bearing: `buildVoxels` on an empty layer
  reconciles every axis to 1 and `carve` fills that grid, so an empty layer
  is one phantom voxel at the origin plus four warnings. The test is
  `providedViews.length === 0`, so a tile whose alpha never reaches the
  ingest threshold counts as empty too. With every layer dropped the union
  is that empty result, and `buildModel` throws on it as it throws on a
  sheet with no painted view today.
- **The lattice** is the per-axis max of the layers' dims. Every tile is
  `t × t`, so two layers differ on an axis only when one of them observes
  it with no view, and that layer is one voxel deep there. Its slab sits on
  the face of the lattice its views look at: a front-only layer at the
  front plane, a top-only layer at the top, a left-only layer at the +x
  side, and with both views of a pair present, the positive one. Every
  other axis starts at 0. The union re-indexes each layer's `solid` and
  `faceColor` through its own dims and that offset, so `solid_u` is the OR
  of the layers' solids over the voxels each covers. A single-layer
  document has nothing to place against and is unchanged.
- **The surface** is `extractSurface(solid_u)`, never an OR of the
  per-layer masks: the mesher reads `solid` and `surfaceMask` and they must
  describe one grid, and a face buried under another layer's voxel is gone.
- **Colors.** A face exposed in the union at voxel v is exposed in every
  layer whose solid contains v: the union is a superset, so an empty
  neighbor in the union is empty in each layer. Every containing layer
  therefore has a color for it, from its own `colorize` with its own depth
  test, mirror-fill, relaxation and dominant fallback. The union takes the
  color from the **last** containing layer in block order (decision 1), so
  a later layer paints over an earlier one where they overlap. No color is
  recomputed, so a layer's face keeps the color its own sprite gave it even
  where another layer's voxel occludes that view in the composite.
- **Palette** is the union of the layers' palettes. Warnings concatenate,
  prefixed `Layer k:` when there is more than one layer. `solidCount` and
  `surfaceCount` are the union's, `providedViews` the union of the kept
  layers', and `layers` holds the per-layer results, null where dropped.
  `gviews` and `ingested` have no single-grid meaning and are left out;
  nothing reads them.
- One layer returns its result untouched, so the layered entry with one
  layer is `buildVoxels` byte for byte.

Wedges then form on the union as they do today: a riser from one layer and a
tread from another join into a slope when their colors match, and stay a
step otherwise. `wedgeMesh`, `regions.js`, `skin.js` and `t-junction.js` do
not change.

The engine API, all additive:

- `sliceLayers(img, { layers = 1 })` returns one views record per block
  with `tileW`, `tileH`, `cols`, `rows` and `warnings`. The tile is the width
  over 3 and the height over twice the count; block k's cell (r, c) starts
  at column `c · tileW` and row `(2k + r) · tileH`. `rows` stays the
  layout's 2. `sliceAtlas` is unchanged.
- `resizeAtlas(img, w, h, { layers = 1, anchor })` resizes every block with
  the per-view offsets it applies today and returns a `2 · layers · h` tall
  sheet. Without the option it reads the sheet as two rows of tall tiles
  and resizes those, as today.
- `buildLayeredVoxels(rawViewsByLayer, opts)` maps `buildVoxels` over the
  layers and unions; `unionVoxels(results)` is exported for a caller that
  keeps per-layer results (the rebuilder, §2.6).
- `buildModel(sheet, { transforms, layers = 1 })` slices the blocks, builds
  the union, throws only when every layer is dropped, and meshes the union
  at one unit per voxel.
- `LAYERS_CHUNK`, `layersChunk(names)`, `parseLayersChunk(text)` and
  `layerCount(height, names)` in a new engine `layers.js`, since the engine
  reads this chunk (the ring chunk stays app-side because it does not).
  `layerCount` is the names' count when it divides the height into whole
  blocks, else null.
- `readSheet` returns `layers` (the names, or null) beside `transforms`, and
  `sheetToGlb` builds `layerCount(height, names) ?? 1` layers. The CLI needs
  nothing.
- `LAYER_MAX`. Every new name goes in the barrel by name.

The engine bump is a patch: every default holds, and the additions are new
exports, new options and a new field.

### 2.3 The document

The doc slice (`state/doc.js`) holds every block and knows nothing about
which one is edited:

```text
{ atlasImage,            the whole sheet, by reference
  layers: views[],       one Record<face, tile|null> per block, sliced
  names: string[],       the layers' names, block order
  transforms, atlasWarnings, tileW, tileH, cols, rows, sheet }
```

`views` is retired; every reader takes `layers[i]`. The two-channel contract
holds per block: `applyTileEdit(layer, face, tile)` stores the working
buffer by reference into `layers[layer][face]` with no structural
notification, and the frame blit lands at `(c · tileW, (2 · layer + r) ·
tileH)`. The pending edit carries its layer, so a switch mid-frame blits
into the right block. `onLive` listeners receive `(state, { layer, face })`.

- `loadAtlas(image, transforms, { layers, names })` slices `layers` blocks.
  The count is `sheetShape`'s and the names are the chunk's fitted to it
  (§2.1); every opener (`openSheet`, `openStored`, the Finder's paste)
  passes both.
- `restoreTile(layer, face, tile)` and `replaceAllTiles(layer, target, fill)`
  address one block. Fill "on all faces" recolors the edited layer's six
  tiles (decision 11).
- `resizeTiles` resizes every block through the engine.
- `addLayer()` appends a transparent block and a default name;
  `removeLayer(i)` drops a block and its name; `renameLayer(i, name)` sets a
  name; `setNames(names)` restores them. Each returns whether the sheet
  changed, as `resizeTiles` does, since `withAtlasSnapshot` records an entry
  only on a truthy return; New Layer reads the new index from the count.
  All of them are structural patches, never a `sheet` bump: a
  bump means a new document, clears history and marks the context clean. A
  block is a contiguous run of rows, so append and remove are typed-array
  copies in the app's pure `lib/layers.js`, beside `defaultLayerName`,
  `nextLayerName` and the onion compositor.
- `restoreAtlas(image, names)` re-slices with the count the image and names
  give.

History (`state/history.js`): a tile entry carries its layer, `{ kind:
'tile', layer, face, before, after }`, and applies through
`restoreTile(layer, …)`, so an undo after a layer switch lands on the right
block and, like a face today, does not switch the editor to it. An atlas
entry snapshots `{ image, names }`, so New Layer, Delete Layer and Tile
Size… are each one whole-sheet step under `withAtlasSnapshot`. Rename
Layer… is a `names` entry, `{ kind: 'names', before, after }`, applied
through `setNames`, so every change to the document is undoable and a
snapshot's names never revert a later rename. A rename dirties like any
edit. The document's own Rename… stays outside history, since the
document's name is not in the document.

The edited layer is UI state on the DocContext beside the face: `ctx.layer`,
set by `workspace.setLayer(key, i)`, which clamps and `touch()`es exactly as
`setFace` does, so a switch never dirties the document. The context's doc
tracker clamps `ctx.layer` to the layer count on every structural change and
touches when it moved, which covers an undo of New Layer and Delete Layer.
Delete Layer selects the layer above the deleted one (the earlier block), or
Layer 1. New Layer selects the new layer. `open()` seeds `layer` as it seeds
`face`, and the desktop state's per-document entry gains `layer` beside
`face` (decision 12), read back on the `?file` boot.

Save writes the chunk from `state.names` inside `encodeDoc`, so Save,
Duplicate, a first save and the Finder's paste all get it with no caller
change. `files.load` and `readSheetMeta` return the names. Copy, Paste,
Duplicate and Rename keep the chunk, because they copy bytes. The icon call
passes `state.layers.length` to `buildModel`.

### 2.4 The editor

`editorViewModel(docState, face, layer)` reads the edited layer's block for
`tile`, `wasDerived` and `edgeHints`, so the edge hints show only the edited
layer, including that layer's mirrored-opposite fallback for a neighbor with
no art. Its faded underlay, renamed `onionBehind`, is one composited tile
(decision 5): the edited layer's opposite face mirrored, as today, then each
other layer's art on the same face in block order, later over earlier, at
full opacity, and null when all of those are empty. The canvas draws the one
image at the fade it uses today, `ONION_ALPHA`, moved from the canvas into
`lib/layers.js` so the Full Sprite View shares it. The composite is a pure
function in the same file. It recomputes with the view model, on a face or
layer switch or a structural change, never mid-stroke, which is right
because a window edits one layer at a time.

`sm-editor` keys its memo on `{ face, layer, layers, tileW, tileH }` and
passes `ctx.layer` to `applyTileEdit`, `pushTile` and `replaceAllTiles`. A
layer switch hands the canvas a different `tile`, so the working buffer
resets and a selection drops, as on a face switch. A face switch cannot
happen mid-gesture, since a stroke holds pointer capture, but a key can:
the session slice carries `gesture`, set by the canvas from press to
release, and a digit is ignored while it is set. Otherwise the stroke's
pixels, already in the old block by reference, would never reach history,
and its commit could be stamped with the new layer.

**The Full Sprite View** shows the edited layer's six tiles at full opacity,
each over the other layers' art on that face at the onion fade (decision 6),
so the map stays recognizable while a layer holding a few pixels is edited.
It paints from the sheet's blocks through one scratch canvas, and repaints
when the active context's layer changes, which the doc channels do not
carry. The face picker, the grid's shape and the windoid's size are
unchanged.

**The status strip** reads `Layer 2, Front Face` while the document has
more than one layer, and `Front Face` as today with one (decision 10).

### 2.5 The Layer menu and keys

A fifth menu, **Layer**, between Edit and View (decision 7):

```
Sprite Machine  File  Edit  Layer  View  Tools
```

```html
<vf-menu data-menu="layer" label="Layer">
  <vf-menu-item value="layer-new">New Layer</vf-menu-item>
  <vf-menu-item value="layer-delete">Delete Layer</vf-menu-item>
  <vf-menu-item value="layer-rename">Rename Layer…</vf-menu-item>
  <vf-separator></vf-separator>
  <!-- syncLayers: one item per layer, value layer:<i>, the edited one checked -->
</vf-menu>
```

- _New Layer_ appends and selects a layer named by the next free number,
  greyed at `LAYER_MAX`. _Delete Layer_ removes the edited layer, greyed
  with one layer. Both are one undo step. _Rename Layer…_ reuses the name
  prompt (`promptName('layer', name)`), greyed never (decision 8).
- The list follows the View menu's window list: one `checkable` item per
  layer in block order, named for the layer, the edited one checked, in its
  own menu so it never leapfrogs the window section's anchor. It syncs on
  the workspace store and on the active document's structural channel,
  where the count and names live.
- The list's items show `1` to `8` as their keys. The kit never fires a
  bare printable key, so `src/shortcuts.js` picks the layer on a digit
  under the tool letters' gates (a document window front, no field, no
  modifier, no picker) and not during a gesture (§2.4), and the Tools
  menu's letters stay the precedent.
  The three commands have no key equivalent, like New Folder and the
  Special menu.

The Finder, the Text Viewer and Desktop Patterns are untouched. The Keyboard
Shortcuts and Read Me text files gain the layer keys and a Layers paragraph;
an existing profile keeps its seeded copies, as today.

### 2.6 Everything else that reads a sheet

- **The rebuilder** keeps one `buildVoxels` result per layer. A live flush
  names its layer, so only that layer is rebuilt and the union is recomputed
  from the cache; a structural change drops the cache. Its early-out is "no
  layer has a painted view". Warnings merge as the union returns them.
- The 3D Sprite Atlas, the model export dialog and the glb take the
  rebuilder's mesh and dims, so they need nothing.
- **The icon** renders the union through `buildModel(sheet, { transforms,
layers })`. Existing files keep their icons until saved, as today.
- **The paste rule** accepts `3t × 2tN` for `1 ≤ N ≤ LAYER_MAX` and reports
  N; the paste alert's copy says so. The drop stays lenient: a sheet that
  fits the rule opens as N layers, any other as one layer of whatever the
  3×2 layout gives, as today. A chunk naming more layers than the shape
  bears, or more than `LAYER_MAX`, is read as no chunk.
- `loadBlank`, the New dialog and the samples stay one layer.
- **The engine README** documents the stacked sheet, the chunk, the union
  and the new names; the package description drops "3×2".
- **The README** gains the layered sheet in §Input, the Layer menu in §Menu
  bar, the underlay and hints rules in §Drawing editor, the chunk in
  §Documents, the union in §The technique, and loses concavity's first
  sentence in §Known limitations.

## 3. Steps, each landing green

1. **The engine's sheet.** `LAYER_MAX`, `sliceLayers`, `resizeAtlas`'s
   `layers` option, the new `layers.js` codec and `layerCount`, the barrel.
   Tests: the per-block slice round trip, a layered resize keeps every
   block registered and the right height, the chunk round trip, the count
   rule.
2. **The engine's union.** `unionVoxels`, `buildLayeredVoxels`,
   `buildModel`'s `layers` option, `readSheet` and `sheetToGlb`, the
   engine README and package description. Tests: the union contract (§5).
3. **The document.** `lib/layers.js` (the blocks and the names; the
   compositor comes in step 5), `lib/sheet-shape.js`, `state/doc.js`,
   `state/history.js`, `state/workspace.js`, `state/files.js`,
   `loaders.js`, the Finder's paste, `main.js`'s icon call and boot
   restore, `scene/icon-renderer.js`, `shell/desktop-state.js`, and the
   three readers of `views`, so the gates stay green: the rebuilder unions
   every layer with no cache yet, and `derive.js` and `sm-editor` read
   `layers[ctx.layer]` with the underlay still the mirrored opposite. The
   app opens, edits, saves and reopens a layered document, still on Layer 1
   with no way to switch. Tests: the pure rules (§5).
4. **The model.** The rebuilder's per-layer cache. The 3D View, atlas and
   export show the union of a layered file dropped in.
5. **The editor.** The compositor and `ONION_ALPHA` in `lib/layers.js`,
   `derive.js`'s underlay, the canvas's property and gesture flag,
   `state/session.js`, `sm-atlas-view`, `sm-status-line`. Verified by eye
   with a two-layer document staged by step 6's menu.
6. **The menu.** `menus.html`, `index.js` (the handlers, `syncLayers`, the
   name prompt's third use), `shortcuts.js`, the two text files.
7. **The words.** README, the headers and comments touched, this plan's
   status line.

Steps 1 and 2 are the engine alone and release as one patch. Steps 3 to 7
are the app.

## 4. Kit asks

None. The menu, its checked list, the name prompt and the radio row all
exist. Arrow-key equivalents would be a kit ask (the key grammar has no
arrow glyphs), which is one reason the list takes digits.

## 5. Tests

By `docs/TESTING.md`: unit tests on the new pure rules, nothing on the menu,
the strip's copy or the look.

Engine (`packages/core/test`):

- `sliceLayers`: block k's tiles come from rows `2tk` on; a one-layer call
  matches `sliceAtlas`.
- `resizeAtlas` with `layers`: every block resizes with the same offsets and
  the sheet is `2 · layers · h` tall.
- `layersChunk` / `parseLayersChunk` round trip; `layerCount` takes the
  chunk's count when it divides the height and null otherwise; `readSheet`
  returns the names.
- `unionVoxels`: two disjoint layers give the sum of their voxels; an
  exposed face of a voxel both layers hold takes the later layer's color; a
  blank layer adds nothing and its warnings are dropped; a single layer is
  identical to `buildVoxels`; a front-only layer lands at the front plane
  of the larger lattice and a top-only one at the top; every exposed face
  of the union has a color.
- `buildModel` with `layers`: builds the union, throws only when every
  layer is blank, and without the option reads a sheet as today.

App (`test/`):

- `sheetShape` accepts `3t × 2tN` up to `LAYER_MAX` and reports N; refuses
  `3t × (2t + 1)` and N above the cap.
- `lib/layers.js`: append and remove a block, default and next names, the
  compositor's order and its null.
- `doc.js`: a layered load slices every block; a tile edit blits into its
  layer's block; `restoreTile` on a non-edited layer; `addLayer` and
  `removeLayer` change the count without a `sheet` bump and report the
  change; `replaceAllTiles` stays inside its block.
- `history.js`: a tile entry restores on its own layer; an atlas entry
  restores the names; a `names` entry restores a rename.
- `workspace.js`: `setLayer` clamps and does not dirty; the tracker clamps
  after a structural change; `openStored` reopens a layered document with
  its count and names.
- `derive.js`: `tile` and `edgeHints` come from the edited layer; the
  underlay composites the other layers over the mirrored opposite.
- `files.js`: the layers chunk round-trips through save and load and
  survives a copy.
- `desktop-state.js`: the entry carries `layer` (the migration shapes in the
  existing test move with it).

Existing tests follow the signature changes (`applyTileEdit`, `pushTile`,
`editorViewModel`, `sheetShape`'s return).

## 6. Decisions

All thirteen were taken as recommended on 2026-09-12, with the ask to implement
the plan.

1. **Precedence.** Where layers overlap, the later block (the higher layer
   number) colors the surface. Recommended, since New Layer appends and a
   detail layer sits over the body it is drawn on. The alternative is the
   earlier block winning.
2. **The count.** The app takes it from the shape, always: `3t × 2tN` of
   square tiles is N layers and the chunk only names them, so a chunk-less
   paste or drop opens layered. The engine takes it from the chunk and
   keeps every default. Recommended: an additive engine (a patch) and one
   rule in the app for every route. The cost is that a chunk-less
   `3t × 2tN` drop, one layer of tall tiles today, becomes N layers. The
   alternative infers only on the paste and reads such a drop as one layer,
   like the engine.
3. **Always write the chunk**, like the ring chunk, so every saved file
   names its layers and a one-layer file is explicit. Recommended. The
   alternative writes it only above one layer, like transforms.
4. **The lattice.** Each layer builds what it builds alone and the union
   lattice is the per-axis max, so one layer is today's model and an empty
   layer changes nothing. A layer with views on one plane only is one voxel
   deep, placed on the face of the lattice its views look at (a front-only
   layer at the front). Recommended. The alternatives: place such a slab at
   the origin, which puts a front-only detail at the back of the body; or
   extend an axis no view of the layer observes to the union's extent,
   which extrudes a front-only detail through the body and paints its
   mirror on the back.
5. **The underlay.** The other layers' same-face art in block order over
   the edited layer's mirrored opposite, one image at the existing fade.
   Recommended, since the mirror is the registration aid within a layer and
   the others are the aid across layers. The alternative drops the mirror
   when a document has more than one layer.
6. **The Full Sprite View** shows the edited layer over the other layers'
   faded art, tile by tile. Recommended, so the map keeps its shape while a
   sparse layer is edited. The alternative shows the edited layer alone.
7. **A Layer menu** between Edit and View, with the list at its tail and
   digits `1` to `8` on the list's items. Recommended. The alternatives are
   the commands in Edit with the list in View, or no keys at all.
8. **Rename Layer…** ships with New and Delete, as an undo step.
   Recommended: the names are in the chunk from the start and the prompt
   exists. The alternative leaves the numbered defaults and defers it.
9. **`LAYER_MAX` is 8.** Recommended: it bounds the union pass every stroke
   runs over the cached layers, the full rebuild a structural change, a
   save and the CLI run over every layer, and the digit keys. The
   alternative is no cap, with the list past 8 unkeyed.
10. **The status strip** reads `Layer 2, Front Face` with more than one
    layer and `Front Face` with one. Recommended. The alternative names the
    layer always.
11. **Fill "on all faces"** recolors the edited layer's six tiles.
    Recommended, since a fill is an edit of the layer under the pointer. The
    alternative recolors every layer.
12. **The edited layer persists** in the desktop state beside the face, and
    returns on the `?file` boot. Recommended. The alternative always opens
    on Layer 1.
13. **The `Software` chunk** stays `sprite-machine 1`. Recommended: nothing
    reads it, and the chunk and the shape already tell a layered file
    apart. The alternative writes `sprite-machine 2` on a layered save as a
    schema marker.

## 7. Follow-ups

- Duplicate Layer, Merge Down, and Move Layer Up / Down (which changes
  precedence).
- A drawn face beating a mirror-derived one across layers, so a later
  layer's blank back never paints over the body's drawn back. It needs
  `colorize` to report which rule colored each face.
- Hide a layer from the union, a `hidden` flag per entry in the chunk.
- A layered built-in sample, and a `?layer=` dev hook beside `?edit=`.
- A Layers windoid, if the menu proves slow for switching.
- The layer count in the glb's `extras`.
- A versioned re-seed of the text files, still open from the text files
  plan, so an existing profile reads the new Layers paragraph.

## 8. Files touched

| File                                              | What                                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/atlas.js`                      | `LAYER_MAX`, `sliceLayers`, `resizeAtlas`'s `layers` option                                                         |
| `packages/core/src/layers.js`                     | new: `LAYERS_CHUNK`, `layersChunk`, `parseLayersChunk`, `layerCount`                                                |
| `packages/core/src/pipeline.js`                   | `unionVoxels`, `buildLayeredVoxels`                                                                                 |
| `packages/core/src/model.js`                      | `buildModel`'s `layers` option                                                                                      |
| `packages/core/src/node.js`                       | `readSheet` returns `layers`; `sheetToGlb` passes the count                                                         |
| `packages/core/src/index.js`                      | the new exports                                                                                                     |
| `packages/core/README.md`, `package.json`         | the stacked sheet, the chunk, the union, the API; the description                                                   |
| `packages/core/test/*`                            | the layered sheet builder in `helpers.mjs`, the tests in §5                                                         |
| `src/lib/layers.js`                               | new: block append and remove, default names, the underlay compositor, `ONION_ALPHA`                                 |
| `src/lib/sheet-shape.js`                          | `3t × 2tN`, returns `layers`                                                                                        |
| `src/state/doc.js`                                | `layers`, `names`, the block-addressed edits, `addLayer` / `removeLayer` / `renameLayer` / `setNames`               |
| `src/state/history.js`                            | the layer in tile entries, the names in atlas entries, the `names` entry                                            |
| `src/state/workspace.js`                          | `ctx.layer`, `setLayer`, the clamp in the tracker, `openStored` forwards the count and names                        |
| `src/state/session.js`                            | `gesture`                                                                                                           |
| `src/state/derive.js`                             | `editorViewModel(docState, face, layer)`, `onionBehind`                                                             |
| `src/state/files.js`                              | the chunk written and read                                                                                          |
| `src/loaders.js`                                  | `readSheetMeta` and `openSheet` carry the names and count                                                           |
| `src/apps/finder/index.js`                        | the paste's count and names; the alert's copy                                                                       |
| `src/scene/rebuilder.js`                          | the per-layer cache and the union                                                                                   |
| `src/scene/icon-renderer.js`, `src/main.js`       | the count into `buildModel`; the boot's layer restore                                                               |
| `src/components/sm-editor.js`                     | the memo key, the layer in every edit                                                                               |
| `src/components/sm-draw-canvas.js`                | `mirrorBehind` → `onionBehind`, the fade constant moved out, the gesture flag, comments                             |
| `src/components/sm-atlas-view.js`                 | the edited block over the faded others; a repaint on a layer switch                                                 |
| `src/components/sm-status-line.js`                | the layer in the readout                                                                                            |
| `src/apps/sprite-editor/menus.html`               | the Layer menu                                                                                                      |
| `src/apps/sprite-editor/index.js`                 | the handlers, `syncLayers`, the prompt's `layer` use                                                                |
| `src/shortcuts.js`                                | the digits                                                                                                          |
| `src/shell/desktop-state.js`                      | `layer` in the document entry                                                                                       |
| `src/texts/keyboard-shortcuts.txt`, `read-me.txt` | the keys, a Layers paragraph                                                                                        |
| `README.md`                                       | §Input, §Drawing editor, §Menu bar, §Windows (the Full Sprite View), §Documents, §The technique, §Known limitations |
| `test/*`                                          | the tests in §5, the signature follow-through                                                                       |

## 9. As built

Where the build refines the design above:

- The doc keeps its pending live edits per layer and face, so edits to two
  layers inside one frame both blit, and `onLive` fires once per edit.
- `sm-editor` addresses `applyTileEdit`, `pushTile` and `replaceAllTiles` by the
  layer and face its view model was built for, the ones the canvas's buffer
  belongs to, beside the `gesture` guard.
- The canvas reports `sm-gesture` after each press, release, cancel, key and
  update, and turns it off when its window is removed mid-drag.
- The compositor is `compositeTiles(tiles)` in `lib/layers.js`, straight-alpha
  over. `derive.js` passes it the mirrored opposite and the other layers' tiles.
- `sheetLayers(w, h)` in `lib/sheet-shape.js` is the count every opener passes:
  the shape's, else 1. `fitLayerNames` gives a missing or blank name the default,
  and `nextLayerName` counts up from the new layer's own number.
- History records a rename with `withNamesSnapshot(fn)`, the names twin of
  `withAtlasSnapshot`.
- The rebuilder skips a structural change that keeps the doc's `layers` array,
  which is a rename, and its early-out is the union's `providedViews`.
- `buildModel` throws when the union has no provided view, so a sheet whose
  tiles never reach the ingest alpha threshold throws where it used to build one
  phantom voxel.
- `unionVoxels([])` is one empty layer. A new document window activates before
  its pixels load, so the rebuilder unions a doc with no layers.
- `readSheetMeta` reads each chunk on its own, so a malformed transforms chunk no
  longer loses the ring settings and names.
- The status strip leads with the layer's name, so a renamed layer reads
  `Wheels, Front Face`.
- The follow-ups in §7 are in the README's next steps.
