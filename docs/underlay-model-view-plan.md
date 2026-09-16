# Plan: the underlay is the model's view

**Status:** drafted 2026-09-16. The stopgap in §1 is built. Nothing else is
built and no decision is made. The ask: _"i suppose one option would be to just
generate the opacity fade bg from total merged data of the entire model - like
just a view of the complete 3d asset from that side created by looking at our
voxel data... what do you think? is there an easy performant way to do it? or a
robust way? where in our pipeline would it be best to calculate the face view
of the asset to use as the opacity faded bg of the draw canvas for that
face?"_, then _"both - make the easy fix now and write the plan"_.

The short version: the engine gains a projection of a voxel result from one
side, and a union that leaves one layer out. The per-layer carve cache moves
from the rebuilder to the document, so the editor and the 3D View share it. The
underlay becomes the edited layer's mirrored opposite, as drawn, under the
other layers as built. A switch costs a union and a projection, a few
milliseconds, and a stroke still never touches the underlay.

## 1. Where it stands

The report: a truck whose wheels layer is drawn on one side tile only. Editing
the cab layer, the wheels showed behind the canvas on that side and not on the
other. `editorViewModel` took each other layer's art on the face and nothing
when that face had no art, while `colorize` fills such a face from the mirrored
opposite tile, so the model had wheels on both sides.

The stopgap, in `src/state/derive.js`: each other layer contributes its
opposite face mirrored under its art on the face. That is how the model colors
a layer's face at the level of the art, since the carve unions opposite tiles
into one silhouette and `colorize` takes the facing tile first and the mirrored
opposite second. Its cost is unchanged. It still differs from the model in four
ways:

1. Art the carve removes still shows, such as a side pixel with no front or top
   pixel in its row or column.
2. Layers stack in block order, not by depth, so on one face a later layer
   that sits behind an earlier one draws over it.
3. A layer drawn on one plane only is one voxel deep and lies on one face of
   the lattice (`layerOffset`). The stopgap shows it on both sides.
4. Parts of other layers hidden behind other layers from that side still show.

## 2. The model we copy

The draughtsman's elevation. A side elevation is the object seen from that
side, projected from the object, not the other drawings traced over each other.
The onion skin of the paint and animation tools shows the neighbouring
drawings. This one shows the object.

The in-app precedents: the 3D View, which is the model rebuilt from the tiles;
the document icons, which render the model; and single layer, where
`unionVoxels` `only` places one layer in the whole model's lattice.

## 3. The design

### 3.1 The engine: `projectView` and `unionVoxels` `except`

`projectView(result, view)`, new in `packages/core/src/project.js` and exported
from the root entry:

- It returns `{ width, height, data }` RGBA at the view's image size in the
  result's dims (`VIEWS[view].imgW`, `imgH`), in the tile's frame.
- It makes one pass over `surfaceMask`. Every voxel whose face toward the
  viewer (`VIEW_TO_FACE[view]`) is exposed projects through
  `VIEWS[view].projectInto`, the carve's own mapping. Per pixel, the voxel
  nearest the viewer along the face normal wins, and the pixel takes that
  face's `faceColor`, opaque. A pixel no voxel covers stays transparent.
- The first solid voxel along a pixel's ray always has that face exposed, so it
  always has a color. In a union, the owning layer has it too.
- The result is what the 3D View shows from that side, voxel for voxel, before
  the wedges.

A scratchpad prototype, on the sample car: projecting the front gives the front
tile back, all 221 texels in the same colors and none extra. One view takes
0.14 ms at a 40 tile and 0.6 ms with the car resized to a 64 tile.

`unionVoxels(results, { except: k })`, additive beside `only`:

- It keeps the union's lattice and placement over every kept layer, `k`
  included, as `only` does, and builds the solid from every kept layer but `k`.
  The other layers sit where they do in the whole model even when `k` is what
  sets the lattice.
- With no other layer holding a view, `providedViews` is empty and the solid is
  empty. One result with `except: 0` is that case, not the result untouched.
- Palette, views and warnings are the shown layers'.
- An index with no result throws a `RangeError`, as does `only` with `except`.

### 3.2 The app: one voxel cache per document

The per-layer `buildVoxels` cache is private to `scene/rebuilder.js`. It holds
the active document only and is dropped on a document switch. The editor needs
the same results.

`src/state/voxels.js`, `createVoxels(doc)`, made with the DocContext in
`workspace.open` and disposed in `close`:

- `results()` returns one `buildVoxels` result per layer, building the missing
  ones from `doc.get()` with its `transforms`, as the rebuilder does now.
- A new `layers` identity (a structural change) drops every result. A live edit
  drops its own layer's.
- Its `onLive` listener is added when the context is made, before any
  consumer's, and live listeners run in insertion order. A consumer that reads
  `results()` in its own live listener never sees a stale layer. The module
  header states this.
- Nothing builds until a consumer asks.

The rebuilder reads `ctx.voxels.results()` in place of its own cache and keeps
`edited` only to decide whether to remesh. A document switch no longer
re-carves.

### 3.3 The underlay

`editorViewModel(docState, face, layer, results)`, with `results` from the
cache:

```js
onionBehind: compositeTiles([
  mirrored(views[opposite]), // the edited layer's opposite, as drawn
  modelView(results, face, layer, tileW, tileH), // the other layers, as built
]),
```

- `modelView` is `unionVoxels(results, { except: layer })` projected with
  `projectView(…, face)`, or null when that union has no provided view. When
  the projection is smaller than the tile, see decision 6.
- The edited layer stays out, so a stroke never changes the underlay. The memo
  in `sm-editor.js` keeps its key (face, layer, `layers` identity, tile size),
  and the underlay still recomputes only on a face or layer switch or a
  structural change.
- A switch to layer M after strokes on layer L reads L's new result, since the
  live flush dropped the old one.
- The edited layer's opposite stays drawn art. It shows what a derived face
  becomes, and README §Input has the reader check tiles against it.
- Single layer, in the 3D View's header, does not change the underlay.

Cost at a switch, from the prototype on this Mac with the car stacked seven
deep: `unionVoxels` 1.2 ms at a 40 tile and 2.2 ms at 64, plus the projection.
The carves come from the cache. Without the shared cache a switch would first
carve every other layer, about 3 ms each at 40 and 6 ms at 64, so 20 to 45 ms
for seven, and the performance plan puts a 2015 Air at 3 to 5 times that.

Memory: a result holds `solid` and `surfaceMask`, a byte a voxel each (0.5 MB
at 64³), the grid views and the `faceColor` Map, about a megabyte a layer at
64³ by estimate. Every open document keeps its results until it closes, where
today only the active one does. See decision 4.

### 3.4 What changes for the person drawing

- Another layer's pixels that the carve removes no longer show behind the
  canvas.
- Where layers overlap on a face, the nearer one shows. Where two hold the same
  voxel, the later one's color shows, as in the model.
- A layer drawn on one plane shows only on the side it lies on.
- A face no tile colors shows the neighbour average or the body color, as in
  the model.

README §Drawing editor and the read-me text say the underlay is the other
layers as built.

## 4. Steps, each landing green

1. **`projectView`.** `project.js`, the export, the package README and its
   tests.
2. **`unionVoxels` `except`.** `pipeline.js`, the package README and its tests.
   Steps 1 and 2 release together as engine patch 0.3.1: two additive exports.
   The app reads the engine through the workspace link, so the app steps do not
   wait for the publish.
3. **The voxel cache.** `state/voxels.js` on the DocContext, and the rebuilder
   reads it. Nothing visible changes. Verified by eye: the 3D View follows
   strokes, layer switches, single layer, Undo, Tile Size… and document
   switches as it does now.
4. **The underlay.** `derive.js` and `sm-editor.js`, replacing the stopgap, with
   the README and the read-me text. App patch. Verified by eye:
   - The truck, editing the cab: the wheels show faded on both side faces.
   - A pixel on another layer's side tile with nothing in its front row or top
     column shows neither behind the canvas nor in the 3D View.
   - An empty face still shows the edited layer's mirrored opposite.
   - The underlay holds still through a stroke, and a layer switch shows the
     last layer's latest strokes.
   - The Car and any one-layer document look as they do now.

## 5. Kit asks

None. Nothing here touches vintage-frames.

## 6. Tests

By `docs/TESTING.md`: the new pure functions get contract tests, and nothing
else is added.

- `packages/core/test`: `projectView` gives a carved tile back, lets the
  nearest voxel win where two share a ray, shows a mirror-filled face as the
  opposite tile mirrored, and leaves uncovered pixels transparent.
  `unionVoxels` `except` keeps the other layers' placement when the excepted
  layer sets the lattice, gives an empty `providedViews` when nothing is left,
  handles one result, and throws on a bad index and on `only` with `except`.
- `test/derive.test.mjs`: the underlay's rules replace the stopgap's, over
  `buildVoxels` results on 2×2 tiles: the edited layer's opposite mirrored,
  another layer's derived face shown, the edited layer's voxels never shown.
- `test/voxels.test.mjs`: the cache's invalidation, over `createDoc` with the
  doc tests' fake scheduler: a live edit drops its layer only, a structural
  change drops all.
- No test of the rebuilder, the editor or the canvas.

## 7. Decisions

1. **The underlay shows the model, not the art.** Recommended: registration is
   against what the model holds, and §1's four differences go. The alternative
   keeps the stopgap: no engine change and no cache move, with those four
   differences.
2. **The edited layer stays out of the model view.** Recommended: a stroke
   never changes the underlay and the memo holds. The canvas covers the layer's
   own surface wherever it has art. The alternative is the whole model, as the
   ask put it: a projection on every live flush, and a pixel just erased shows
   the layer's old surface until the next build.
3. **The edited layer's opposite stays drawn art, under the model view.**
   Recommended: it is the symmetry guide, and the order is today's. The
   alternative draws it over the model view, so it hides other layers.
4. **The cache lives on every open document, built on demand.** Recommended: a
   document switch stops re-carving, and a window's underlay never carves
   seven layers. It costs about a megabyte a layer at 64³ per open document,
   freed on close. The alternative is one cache for the active document,
   rebuilt on a switch as now, with today's memory and the re-carve.
5. **The engine API is two parts.** `projectView(result, view)` over any
   result, and `except` beside `only`. Recommended: each is small and useful
   alone, and the CLI or a test can project a one-layer build. The alternative
   is one `projectLayers(results, view, { except })`, which repeats the union's
   placement.
6. **A lattice flat on an axis.** When no layer observes an axis, the model is
   one voxel deep on it, and a view along the other two axes is one texel
   across. Where that texel belongs in the tile depends on which views the
   layers have. Recommended: leave the model view out when it is smaller than
   the tile. The document has no art on that axis yet, and a line on a guessed
   edge is worse than none. The alternative adds a `dims` floor to `unionVoxels`
   so the flat layer lands on the plane `layerOffset` puts it on.
7. **The worker, the performance plan's decision 7.** If that worker is built,
   the cache moves into it and `results()` stops being synchronous. Recommended:
   build this on the main-thread cache now. `state/voxels.js` is the one seam
   either way, and with a worker the underlay shows the mirrored opposite at
   once and the model view when it arrives. The alternative settles decision 7
   first.

## 8. Follow-ups

- `projectView` against the tiles finds the edited layer's own pixels that the
  carve removes. The editor could mark them, a registration check the
  person can see.
- The edge hints stay the edited layer's own (README §Edge hints). They could
  read the model view too.

## 9. Files touched

| File                                   | What                                                              |
| -------------------------------------- | ----------------------------------------------------------------- |
| `packages/core/src/project.js`         | new: `projectView`                                                |
| `packages/core/src/pipeline.js`        | `unionVoxels` `except`                                            |
| `packages/core/src/index.js`           | the `projectView` export                                          |
| `packages/core/README.md`              | `projectView` and `except`                                        |
| `packages/core/test/project.test.mjs`  | new: `projectView`'s contract                                     |
| `packages/core/test/pipeline.test.mjs` | `except`'s contract                                               |
| `src/state/voxels.js`                  | new: the per-document voxel cache                                 |
| `src/state/workspace.js`               | the cache on the DocContext, disposed on close                    |
| `src/scene/rebuilder.js`               | reads the document's cache in place of its own                    |
| `src/state/derive.js`                  | the underlay from the model view, replacing the stopgap           |
| `src/components/sm-editor.js`          | passes the cache's results to `editorViewModel`                   |
| `test/derive.test.mjs`                 | the underlay's rules                                              |
| `test/voxels.test.mjs`                 | new: the cache's invalidation                                     |
| `README.md`                            | §Drawing editor's underlay paragraph, §Source layout for `voxels` |
| `src/texts/read-me.txt`                | the underlay sentence in LAYERS                                   |
