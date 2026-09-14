# Plan: a single layer in the 3D View

**Status:** built and committed 2026-09-13, steps 1 to 5, gates green. The eye
checks in §3 are not yet confirmed. Every decision was made 2026-09-13. Not
released. The ask: _"on our 3d model view - we have a
single toggle control in the header strip now... i want to add a second. It
should toggle the display of the complete 3d model and the display of the 3d
model for JUST the current layer. The toggle should be 'single layer' and it
should be disabled for documents that have ONLY a single layer."_ And, while
the plan was drafted: _"i'm ok if the 3d view always displays the centered on
the full tile voxel volume- not some dynamic cropping in on the actual painted
voxels"_.

The short version: the 3D View's header gains a second checkbox, **single
layer**, after **rotate**. It sets a view pref, off at every load, and it is
greyed while the active document has one layer. While it is on, the 3D View
shows the model of the layer the active window edits, in place in the whole
model's lattice. The 3D Sprite Atlas, both exports and the document icon keep
the whole model. When a document opens or becomes active, the camera frames
the full tile volume, and a toggle or a layer switch never moves it. The
rebuilder already keeps one carve per layer, so a layer switch or a toggle
meshes from that cache and never carves. The engine gains one additive option,
`unionVoxels(results, { only })`, because a layer meshed on its own lattice can
move. The header row grows from 77 to 185 px, so the 3D View's width floor
rises from 109 to 187 px. The rail places the window at 214 px, so no window
moves.

The layers ask had the 3D View always show the whole model. With the checkbox
off, it still does. The framing changes with the checkbox off too: a model
drawn in part of its tile opens smaller than it does today.

## 1. The model we copy

Photoshop's Layers palette: Option-clicking a layer's eye shows that layer
alone, and Option-clicking it again shows them all. The in-app precedents:

- **rotate**, a checkbox in the 3D View's header bound to a view pref that is
  off at every load;
- the fill tool's **on all faces**, a checkbox greyed by a rule that keeps its
  value while greyed;
- the document window's status strip, which names the layer only when the
  document has more than one;
- the 3D Sprite Atlas, which fits the whole lattice at every yaw, so its
  framing never depends on what is painted.

## 2. The design

### 2.1 What the 3D View shows

One of two meshes:

- **The whole model**, the union of every layer, as today. It shows while
  single layer is off, and whenever the active document has fewer than two
  layers.
- **The edited layer**, the active document's `ctx.layer`, while single layer
  is on and the document has two layers or more. It follows the edited layer
  through a pick from the Layer menu's list or a digit key, New Layer, Delete
  Layer, a move and the clamp after an undo, and follows the active document
  through a switch.

Only the 3D View changes (decision 1). `onMesh` keeps handing the whole model
to the 3D Sprite Atlas and the model export, so the strip, Export Sprite
Atlas… and Export 3D Model… ignore the toggle. The document icon builds its
own model through `buildModel` and ignores it too.

An empty edited layer shows the empty well while the rest of the model exists,
and the status strip reads `0 triangles` (decision 8).

### 2.2 Where the layer sits

In place: inside the whole model's lattice, the full tile volume, where the
layer sits in the whole model (decision 2). It never re-centers on its painted
voxels or on a lattice of its own, so a toggle removes the other layers and
moves nothing.

This needs the engine. A layer's `buildVoxels` result has its own lattice: the
tile size on every axis its views observe and 1 on an axis none observes.
`unionVoxels` places such a one-plane layer on the lattice face its views look
at (`layerOffset`). `wedgeMesh` centers X and Z on the lattice it is given and
starts Y at 0. Meshed alone, a front-only layer would land mid-depth and a
top-only layer on the floor. A layer that observes every axis has the full
lattice and would not move, but the view needs one rule for both.

`unionVoxels(results, { only })` in `pipeline.js`:

- The lattice and each layer's placement are the union's, computed from every
  kept layer as today.
- The solid, and so the colors, come from layer `only` alone, and the surface
  is extracted from that solid. The solid is the layer's own, translated, so
  every exposed face is exposed in the layer's own result, whose `colorize`
  colored it. A face that another layer buries in the union is exposed and
  colored.
- The palette, the provided views and the warnings are that layer's, the
  warnings prefixed as the union prefixes them.
- `only` naming a dropped layer returns that result untouched, so a caller's
  test for no provided view covers an empty layer. An index with no result
  throws a `RangeError`.
- Without `only`, nothing changes.

`buildModel` does not gain the option; nothing headless asks for one layer.
The option's shape is decision 4. The engine README's Layers paragraph gains a
sentence, and the engine bump is a patch.

### 2.3 The rebuilder

`scene/rebuilder.js` keeps its per-layer cache and holds two meshes:

- **The whole model**: `unionVoxels(cache)` through `wedgeMesh` and `toMesh`,
  handed to `onMesh` as today. It is rebuilt only when the model changes.
- **The shown mesh**, the one in the stage: the whole model's mesh itself, or
  the layer's, `unionVoxels(cache, { only })` through `wedgeMesh` and
  `toMesh`. The layer's mesh never reaches `onMesh` and is disposed directly.

The shown layer is `ctx.layer` when `prefs.singleLayer` is on and the document
has more than one layer, else null for the whole model. The early-out becomes:
the same `layers` array, no live edit, and the same shown layer. Otherwise:

| Change                                | Carve            | Whole model | Shown mesh                                |
| ------------------------------------- | ---------------- | ----------- | ----------------------------------------- |
| live flush                            | the edited layer | rebuilt     | the whole model's, or the layer's rebuilt |
| structural change other than a rename | every layer      | rebuilt     | the whole model's, or the layer's rebuilt |
| layer switch, or single layer checked | none             | kept        | the layer's, meshed from the cache        |
| single layer unchecked                | none             | kept        | the whole model's, nothing meshed         |
| rename                                | none             | kept        | kept                                      |

Besides the active document's two channels, the rebuilder subscribes to the
workspace store, where a layer switch lands, and to `prefs`, and `dispose`
drops both. Each notification runs the same `rebuild()`, and the early-out
makes the extra calls cheap. The order of the calls does not matter. The
workspace's tracker, a doc listener registered at `open()`, clamps `ctx.layer`
and touches the workspace store, so after a Delete Layer the rebuilder's
workspace listener can run before its doc listener. The first call rebuilds
from the current state and the second returns. With single layer on, New
Layer, Delete Layer and a move can mesh the view twice in one task, once for
the structural change with the old `ctx.layer` and once for the switch that
follows. The stage renders on the next frame, so only the second is drawn.

A new shown mesh takes the old one's `rotation.y`, except when the camera
frames, so the spin continues through a toggle or a switch, and it becomes the
stage's spin target. `?flat` applies to both meshes. `?diag` reports the whole
model.

While a single layer shows, a stroke meshes twice, the whole model and the
layer, where today it meshes once. The whole model stays eager because a shown
3D Sprite Atlas follows the stroke. §7 has the deferral.

### 2.4 The camera

The camera frames the full tile volume, the model's lattice box, as the 3D
Sprite Atlas frames the lattice (decision 3). It frames when it does today, on
a new sheet generation or a newly activated document, and never on a toggle, a
layer switch or a stroke. A model drawn in part of its tile opens smaller,
which shows how it sits in the tile, and the view orbits and zooms from there
as it does today.

`stage.frameObject(obj)` becomes `frameLattice(dims)`:

- The box is the lattice in world units, where the mesher puts it:
  `DEFAULT_WORLD_SIZE` over the longest axis, X and Z centered, Y from 0. For
  square tiles and a model with depth on every axis it is a 2.5-unit cube at
  any tile size. The orbit pivots on its center.
- The fit is today's: the box's bounding sphere, the 1.25 margin, and the iso
  direction or the `?cam` preset. It takes the narrower of the camera's two
  angles, where today's reads only the vertical one. The rail can make the 3D
  View several times taller than it is wide, and a vertical fit would cut off
  the volume's sides there. The far plane stays past the volume however far
  the fit puts the camera.
- The fit reads the canvas's size, and the canvas can have none when a frame
  is asked for. A document window activated from the desktop frames while the
  windoids are still hidden, since `beforeFront` runs before the front
  application changes. Such a frame waits, and `resize()` applies it when the
  canvas first has a size.
- It reads `dims` alone, with no mesh. A single layer shares the whole model's
  lattice (§2.2), so the box is the same in both modes. The rebuilder passes
  the whole model's dims once a build has a provided view, so an empty build
  still leaves the generation unconsumed.

A Tile Size… change keeps the sheet generation, and so the camera. For square
tiles the box it framed is unchanged.

### 2.5 The pref and the header

`prefs.singleLayer` and `setSingleLayer(v)`, off at every load, beside
`autoRotate` (decision 5).

`<sm-stage-controls>` puts the second checkbox after rotate in the same row,
12 px apart, the fill options' spacing:

```js
const p = prefs.get();
const count = workspace.active()?.doc.get().layers.length ?? 0;
html`
  <vf-stack direction="row" gap="12" pad="0 8" fill-height>
    <vf-checkbox
      id="stage-rotate"
      .checked=${live(p.autoRotate)}
      title="spin the model automatically"
      @vf-change=${(e) => prefs.setAutoRotate(e.detail.checked)}
      >rotate</vf-checkbox
    >
    <vf-checkbox
      id="stage-single-layer"
      .checked=${live(p.singleLayer)}
      ?disabled=${count < 2}
      title="show only the edited layer"
      @vf-change=${(e) => prefs.setSingleLayer(e.detail.checked)}
      >single layer</vf-checkbox
    >
  </vf-stack>
`;
```

`count` is 0 with no active document. An `ActiveDocController` beside the
prefs controller re-renders on a document switch and on the active document's
structural changes, where the count changes. Greyed, the checkbox keeps its
check (decision 6). The kit dims the label and leaves the box and its ✕ black,
as it does for on all faces, and a greyed checkbox shows the whole model,
which on a one-layer document is the same mesh.

The row (decision 7): the kit's checkbox is a 13 px box, a 6 px gap and the
label in the display face. By the face's glyph manifest, "rotate" is 42 px
wide, which the current 77 px row confirms, and "single layer" is 77 px. The
row is 8 + 61 + 12 + 96 + 8 = 185 px. `layout.js` derives `STAGE_MIN_WIDTH`
from it, 2 + 185 = 187 px, and the height floor keeps its 107 px canvas. The
resize policy, `windoidBox` and the grow box's floor read the constant. The
placement, `FRAME_BANDS`, `STAGE_STRIP` and `windows.html` do not change.

### 2.6 The status strip

The build slice's `triangles` becomes the shown mesh's count (decision 8), and
`sm-status-line` reads it as today. `dims`, `voxels` and `warnings` stay the
whole model's, since the Export Sprite Atlas… dialog reads `dims` for its
readout and to enable Export. With the whole model empty the strip is blank,
as today.

### 2.7 The words

- README: the intro's line on the 3D View's header; §Windows, the 3D View's
  checkbox, what it shows, the camera's framing and the triangle count;
  §Architecture, the rebuilder's line.
- The engine README: `only` in the Layers paragraph.
- `src/texts/read-me.txt`: a sentence in LAYERS. A seeded copy on an existing
  profile keeps the old text.
- The header comments of `sm-stage-controls.js`, `rebuilder.js`, `stage.js`
  and `build.js`, and the stage floor's comment in `layout.js`.

## 3. Steps, each landing green

1. **The engine.** `unionVoxels`'s `only`, its doc comment and the engine
   README. Tests: §5. Nothing in the app reads it yet.
2. **The camera.** `stage.js`'s `frameLattice` and the rebuilder's call.
   Verified by eye:
   - After a reload, the Car opens smaller than before and low in the view,
     and the Cube, painted to its tile's edges, opens with every corner in
     view.
   - A stroke, an undo and Tile Size… leave the camera where it is, and
     switching document windows frames the other document.
   - With the 3D View resized much taller than it is wide, clicking the
     desktop and then the Cube's window frames the Cube with its sides in
     view.
   - Orbiting pivots on the middle of the volume, above a floor-resting car.
3. **The header.** `prefs.singleLayer`, the checkbox and its greying, and the
   width floor. Nothing reads the pref yet. Verified by eye: the header reads
   rotate, then single layer, whole at the 3D View's narrowest; single layer
   is greyed on the Car and enabled after Layer → New Layer; a check stays,
   greyed, after Delete Layer; the grow box stops at the row; Arrange Windows
   puts the rail where it was.
4. **The view.** `rebuilder.js` and `build.js`. Verified by eye on the Car
   with a second layer that holds a small mark on its Front face alone:
   - Checking single layer shows the mark alone, at the car's front, with the
     camera still, and the strip counts the mark's triangles. Painting on the
     layer updates it at frame rate.
   - `1` shows the car without the mark and `2` the mark again, with the
     camera still.
   - Unchecking shows the whole car at once.
   - With rotate on, a toggle or a switch keeps the spin's angle.
   - View → 3D Sprite Atlas shows the whole car and follows a stroke on the
     mark. File → Export 3D Model… counts the whole car's triangles, and the
     file holds the whole car.
   - New Layer empties the view and the strip reads `0 triangles`. Move Layer
     Up keeps the moved layer shown. Delete Layer down to one layer greys the
     checkbox and shows the whole model, and Undo shows the layer alone again.
   - Opening the Cube frames it and greys the checkbox. Back in the Car's
     window, the camera frames the Car's volume and the view shows its edited
     layer.
5. **The words.** §2.7, and this plan's status line.

Step 1 is the engine and releases as a patch. Steps 2 to 5 are the app: the
new framing and the checkbox.

## 4. Kit asks

None. `vf-checkbox` has `disabled`, which dims only the label, and `vf-stack`
has `gap`.

## 5. Tests

By `docs/TESTING.md`: the engine's new rule gets a contract test. The pref,
the checkbox, the rebuilder, the stage's fit and the width floor are wiring,
THREE and a layout number, and are checked by eye.

Engine, in `packages/core/test/pipeline.test.mjs` beside the union tests and
with their fixtures:

- A front-only layer shown alone keeps the union's lattice and its place: over
  `LEFT_RED`, `only: 1` gives 4³ dims and the four voxels at z = 3, and none
  of the body's.
- The shown layer colors its own faces: `unionVoxels([cube, half], { only: 0 })`
  colors (0, 3, 0) +y blue where the union colors it red; with `only: 1`, the
  face the union buries at (1, 3, 0) +x is exposed and red; every exposed face
  has a color.
- A layer that observes every axis is its own result: with `only`, the
  `solid`, `surfaceMask` and `faceColor` equal that layer's.
- `only` naming a blank layer returns that result, with no provided views, and
  an index past the results throws.

App: none.

## 6. Decisions

1. **What the toggle covers.** The 3D View alone. The 3D Sprite Atlas, both
   exports and the document icon keep the whole model. Recommended: the ask
   names the model view, and a file should never depend on a view toggle left
   on. The alternative has the atlas follow the view, so Export Sprite Atlas…
   writes one layer while the toggle is on. Decided 2026-09-13: as recommended.
2. **Where the layer sits.** In place, in the whole model's lattice, the full
   tile volume. The alternative meshes the layer on its own lattice with no
   engine change, and moves a one-plane layer. Decided 2026-09-13: in place,
   per _"i'm ok if the 3d view always displays the centered on the full tile
   voxel volume- not some dynamic cropping in on the actual painted voxels"_.
3. **What the camera frames.** Recommended was today's fit on the painted
   model, taken from the whole model's mesh in either mode, so a model opens
   filling the view. The alternative frames the full tile volume, as the 3D
   Sprite Atlas does, so the camera depends on nothing painted, and a model
   drawn in part of its tile opens smaller. Either way a toggle never moves the
   camera. Decided 2026-09-13: the full tile volume, per _"yes, we want to open
   the the full tile volume... models may draw smaller - but that's ok, the
   user can zoom and rotate this view. and the smallness is an indicator of
   truth about how the model is fit within the tile."_
4. **The engine option.** `unionVoxels(results, { only })`, one layer index.
   Recommended: it has one meaning, the one the view needs. The alternative is
   a per-layer visibility mask the hidden-layer next step could share, which
   would settle now whether a hidden layer still sizes the lattice. Decided
   2026-09-13: as recommended.
5. **The pref.** App-wide and off at every load, like rotate. Recommended: the
   3D View is one window serving the active document, so the checkbox never
   flips on a document switch. The alternatives keep it per document window,
   like the edited layer, or persist it in the desktop state. Decided
   2026-09-13: as recommended.
6. **Greyed.** The checkbox keeps its check while greyed, and a document that
   gains a second layer then shows a single layer again. Recommended, as on
   all faces keeps its value. The alternatives read unchecked while greyed, or
   clear the pref when the active document drops to one layer. Decided
   2026-09-13: as recommended.
7. **The header.** One row, with the 3D View's width floor at 187 px.
   Recommended: the canvas keeps its height, and the placement is 214 px wide.
   The alternative stacks the checkboxes in two rows. The header grows by a 20
   px row, the canvas is 20 px shorter at the placed size, the height floor
   rises to 180 px and the width floor is 114 px. Decided 2026-09-13: as
   recommended.
8. **The triangle count.** The shown mesh's: the edited layer's while a single
   layer shows, `0 triangles` for an empty one. Recommended: the strip
   describes its window. The alternative is the whole model's count always,
   which Export 3D Model… already shows. Decided 2026-09-13: as recommended.

## 7. Follow-ups

- While a single layer shows, rebuild the whole model when a stroke ends
  rather than every frame, if strokes lag at large tile sizes. A shown atlas
  would then trail the stroke.
- The other layers as a faint ghost around the shown layer, the underlay's
  idea in the 3D View.
- An edited-layer-only option in the export dialogs, if per-layer files are
  wanted.

## 8. Files touched

| File                                   | What                                                                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/pipeline.js`        | `unionVoxels`'s `only`                                                                                                                  |
| `packages/core/test/pipeline.test.mjs` | the tests in §5                                                                                                                         |
| `packages/core/README.md`              | `only` in the Layers paragraph                                                                                                          |
| `src/state/prefs.js`                   | `singleLayer`, `setSingleLayer`                                                                                                         |
| `src/components/sm-stage-controls.js`  | the second checkbox, its greying, the header comment                                                                                    |
| `src/apps/sprite-editor/layout.js`     | `STAGE_MIN_WIDTH` from the header row                                                                                                   |
| `src/scene/rebuilder.js`               | the whole model and the shown mesh, the workspace and prefs subscriptions, framing on the whole model's dims                            |
| `src/scene/stage.js`                   | `frameObject` → `frameLattice`: the lattice box, the fit on the narrower angle, the far plane, a frame that waits for the canvas's size |
| `src/state/build.js`                   | `triangles` counts the shown mesh                                                                                                       |
| `src/texts/read-me.txt`                | a sentence in LAYERS                                                                                                                    |
| `README.md`                            | the intro, §Windows (the 3D View), §Architecture                                                                                        |
