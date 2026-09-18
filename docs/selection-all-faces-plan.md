# Plan: a selection on all faces

**Status:** drafted 2026-09-18, every decision made the same day as
recommended (§6). All eight steps built the same day; the eye checks in §3 are
open. The ask: _"our 'selection' tool right now works on just a single face of
pixels... i'd like to introduce an option for it ( checkbox in the tool
settings ) to project that selection through the voxel space, selecting and
moving pixels on the other faces ( of the same layer ) moving them relative to
the face geometry... in other words, the opposite face has the say y axis but a
flipped x axis - so selection, and the movement of hte selection, would be
adjusted accordingly."_

The short version: the selection tool gains an **on all faces** checkbox in the
options strip, beside the fill tool's. With it on, the marquee on the edited
face is read as a box through the layer's lattice: the rectangle's columns and
rows, and the full depth behind it. The other five faces of the same layer each
get the box's projection as their own selection, and every move, flip and
Delete on the edited face is applied to them through the face geometry. The
opposite face takes the mirrored rectangle and the mirrored move. A neighboring
face takes a band along the axis it shares with the edited face and moves only
along that axis. Within the band, the layer's voxels decide: the move is made
on the voxels behind the marquee, each face is repainted from where they land,
and where the moved part passes under or behind something, the face that sees
both keeps the nearer one's pixels (§2.2). Six faces change as one undo step.
The edited face's canvas keeps its selection code; a pure module does the
geometry and the other five faces, and `<sm-editor>` wires the two together.
The engine does not change.

SPEC's next steps already list this as "a registered move". This plan builds
it, and leaves the registered paste as a follow-up.

## 1. The model we copy

- **MacPaint's marquee.** The selection on the edited face stays what it is:
  the marquee, the lift on the first move, the float over a fixed base.
  System 7 has no selection through a solid, so the rest follows in-app
  precedents.
- **The fill tool's "on all faces".** A checkbox in the options strip widens
  one face's act to the layer's six. The canvas stays a one-face component and
  reports (`sm-replace-all-tiles`); the editor and the doc do the rest.
- **Tile Size.** `resizeAtlas` already shifts faces together along the world
  axes they share, reading each view's flips from `VIEW_IMAGE_AXES`.
- **The edge hints.** `EDGE_SEAMS` is derived at load from `VIEW_IMAGE_AXES`,
  with no hand-written table per face pair. The projection is derived the same
  way.
- **The float.** A selection's pixels are the base plus the float at an
  offset, a function of the offset and never of the path the drag took. The
  other five faces keep that property.

## 2. The design

### 2.1 The geometry

Every face is an image of two world axes (`packages/core/src/views.js`, world
`+x` right, `+y` up, `+z` front):

| Face   | Columns run | Rows run |
| ------ | ----------- | -------- |
| front  | +x          | −y       |
| back   | −x          | −y       |
| left   | −z          | −y       |
| right  | +z          | −y       |
| top    | −x          | −z       |
| bottom | +x          | −z       |

A rectangle on the edited face V fixes an interval on each of V's two axes.
V's third axis, its depth, is unbounded: a drawing of the front says nothing
about depth. That is the box. For each image axis of another face N, on world
axis `a`:

- `a` is one of V's axes: N takes V's interval and V's move on `a`. When the
  two faces run `a` in opposite directions, the interval `[a0, a1]` becomes
  `[t−1−a1, t−1−a0]` on a tile of size `t`, and a move `d` becomes `−d`.
- `a` is V's depth axis: N takes the whole tile on that axis, and a move of 0.

Editing **Front**, with a rectangle of columns `[x0, x1]`, rows `[y0, y1]`,
moved by `(dx, dy)`:

| Face        | Selected                                    | Moves by    |
| ----------- | ------------------------------------------- | ----------- |
| back        | columns `[t−1−x1, t−1−x0]`, rows `[y0, y1]` | `(−dx, dy)` |
| left, right | every column, rows `[y0, y1]`               | `(0, dy)`   |
| top         | columns `[t−1−x1, t−1−x0]`, every row       | `(−dx, 0)`  |
| bottom      | columns `[x0, x1]`, every row               | `(dx, 0)`   |

Editing **Left**:

| Face        | Selected                                    | Moves by    |
| ----------- | ------------------------------------------- | ----------- |
| right       | columns `[t−1−x1, t−1−x0]`, rows `[y0, y1]` | `(−dx, dy)` |
| front, back | every column, rows `[y0, y1]`               | `(0, dy)`   |
| top, bottom | every column, rows `[x0, x1]`               | `(0, dx)`   |

Editing **Top**:

| Face   | Selected                                    | Moves by    |
| ------ | ------------------------------------------- | ----------- |
| bottom | columns `[t−1−x1, t−1−x0]`, rows `[y0, y1]` | `(−dx, dy)` |
| front  | columns `[t−1−x1, t−1−x0]`, every row       | `(−dx, 0)`  |
| back   | columns `[x0, x1]`, every row               | `(dx, 0)`   |
| left   | columns `[y0, y1]`, every row               | `(dy, 0)`   |
| right  | columns `[t−1−y1, t−1−y0]`, every row       | `(−dy, 0)`  |

Back, Right and Bottom follow from the first table the same way. Three things
fall out:

- The opposite face always gets the rectangle mirrored left to right and the
  move with `dx` reversed. That is the ask's example, and it holds for Top and
  Bottom too, because Bottom is Top rolled sideways.
- A neighboring face gets a band: full height or full width, because the box
  has no depth limit. It moves along the shared axis only. A move along the
  edited face's other axis is a move along the neighbor's line of sight: it
  moves no texel there, and only changes how deep the part lies (§2.2). Moving
  the whole car up on Front does not change Top.
- A row range can land on columns. Left's columns are Top's rows.

### 2.2 What moves on a neighboring face

The band is the box's exact shadow, but moving everything in it is only right
when the selection takes in the whole drawing. Take the Truck's Cab layer on
the Left face, with a marquee around the upper cab that also reaches forward
over the empty space above the hood. On Top, the band is every row from the
marquee's front edge to its back edge, at full width, and the hood lies in
those rows. Moving the whole band would drag the hood along with the cab.

So the selection is resolved in the lattice, which is what "through the voxel
space" asks for. At the first operation the layer is built (§2.5). The
**selected voxels** are the solid voxels whose pixel on the edited face lies
in the rectangle, and **the rest** are the layer's other solid voxels. The
hood's voxels sit below the marquee, and the empty space above them holds
none, so the selection is the upper cab alone.

**One rule decides every texel.** A texel on a face colors the nearest solid
voxel on its line of sight, and no other. That is how the engine reads the art
(`colorize`'s first-hit test), and the move keeps it true. Each face N with
art of its own is split into two pictures:

- **The part**: every texel a selected voxel projects to.
- **The rest**: every texel one of the rest projects to.
- A texel can be in both, as the roof is over the lower cab. A painted texel
  in neither is a **stray**: art the carve ignores.

At each offset the selected voxels are moved in the lattice and projected onto
N. That gives the part's texels and, at each one, the depth of its nearest
voxel from N's viewer. The rest's texels and depths never change. The face is
then:

- where one picture alone has a voxel, that picture;
- where both have one, the nearer, and the part on a tie, which is two voxels
  in one cell;
- clear elsewhere, but for the strays below.

So the silhouette is the moved model's, and a texel changes hands only when
the voxel it colors does. A voxel moved out of the lattice projects nothing.
It stays in the list while the selection is up, so it comes back with the
part.

**Under and behind.** Move a part under an overhang of the same layer, and the
face that looks down on them keeps the overhang's texels, because the overhang
is still the nearest thing on those lines. The part's old texels leave, and
none of it is painted over the overhang. The part's picture is kept whole
while the selection is up, so moving it back out brings its texels back. The
test also runs where nothing moves in a face's image. A move along N's line of
sight leaves the part's texels in place and changes their depth: a part
dragged sideways on Front, past something that stood between it and the Left
viewer, comes out in front, and Left then shows the part.

**The colors.** A picture's color at a texel:

- Where its voxel was the nearest on that line before the move, the texel's
  own bytes. That art was its own.
- Where its voxel was hidden behind the other picture's, the art there was
  never its own. It takes the color the model gave that surface, which is what
  the 3D View has been showing (`faceColor`: a palette color, from the
  surfaces around it). A surface that was buried, with no air in front of it,
  has no model color and takes the texel's bytes (decision 12).

On Top, in the Truck example, the hood is the rest alone and is untouched. The
roof's texels are in both pictures, with the roof nearer, so the art there is
the part's. Drag the upper cab back by 2 and the roof's art goes 2 rows back
with it. The 2 front rows it leaves are the lower cab's now. The lower cab's
top was buried under the roof, so those rows keep the bytes they have, and the
spot may want a touch-up. The silhouette is right.

**Strays.** A stray has no voxel, so it has no depth: a part that lands on it
covers it, and it shows again when the part moves on. A stray goes with the
band only when the band moves whole, which is when the rest has no texel in
it. Otherwise it stays. That keeps a drawing in one piece. Faces often
disagree by a pixel, and a hood drawn one texel wider on Top than Front allows
has strays along its edge. They stay with the hood when the cab moves, and
they go with everything else under ⌘A.

**The edited face** is not tested for depth. Its float paints over its base,
as it always has: it is the face in view, and what is dragged there is what
shows (decision 13).

**Another layer never occludes.** Each layer has its own six faces and its own
art, and the engine's first-hit test runs within a layer. The build here is of
the edited layer alone.

Two cases reduce to the plain rule:

- **The opposite face.** Its lines of sight run along the box, so every voxel
  behind the mirrored rectangle is selected. With nothing nearer where it
  lands, it is the mirrored move of §2.1, texel for texel.
- **⌘A, or a rectangle around the whole drawing.** Every solid voxel is
  selected and there is no rest, so every band moves whole and takes its
  strays with it. All six faces move, every painted pixel of them. This is the
  case the README sends users to twice ("move it up in the side faces too").

A part moved into space the model already fills merges with it, as it would if
the six faces were redrawn by hand. That is the visual hull, not this feature.

**This is the voxel move.** The move is made in the lattice. Each face's
painted texels are the projection of the moved lattice, and so is the choice
of which voxel each texel colors. Only the colors come from the art, because
the lattice has none of its own: a voxel's colors are read from the faces,
snapped to the palette, and made up from its neighbors on any surface no face
sees. Redrawing the faces from the lattice outright would lose what the
lattice does not hold:

- **Strays.** Projecting the carve drops every texel the faces do not yet
  agree on. On a half-drawn document that is most of a face.
- **The art's bytes.** Every texel would be rewritten with a derived color,
  where the move reached and where it did not.
- **Derived faces.** A projection would write art into a face that has none.

The document is the six faces, and the model is whatever the carve makes of
them, so the move has to come back through the faces either way. The plain
projection is kept as the contract test for the rule (§5).

### 2.3 Which faces take part

- **The same layer only.** The carve is of the edited layer alone, so another
  layer never holds a texel back and never moves.
- **Faces with art of their own.** A face with no art is mirror-derived from
  its opposite and follows it with nothing written, so it stays derived. A
  face whose projected rectangle lifts no painted texel takes no part.
- **An empty edited face.** A mirror-derived face opens empty, with its
  opposite faint behind it. Its marquee lifts nothing, but the box still
  projects, so dragging there moves the opposite's art and the rest. The
  edited face stays derived.
- **A paste is never projected.** A pasted float has no pixels on the other
  faces. It moves on the edited face alone, checkbox or not.
- **Documents on the convention.** The projection reads tiles by the drawing
  convention, as the edge hints do. The checkbox is greyed for a document with
  non-square tiles or a view transform, which only a dropped PNG can carry
  (decision 9).

### 2.4 The operations

| On the edited face         | On the other faces                                                                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drag the marquee           | Nothing is written. The projected rectangles follow it (§2.7).                                                                                                                                                         |
| Move                       | The selected voxels move, and each face is composited by depth at the projected offset (§2.2).                                                                                                                         |
| Shift axis lock            | Free: the lock is applied to `(dx, dy)` before it is projected.                                                                                                                                                        |
| Esc or a cancel mid-move   | The offset returns to the grab, and every face is recomposited there.                                                                                                                                                  |
| Flip Horizontal / Vertical | The selected voxels mirror within the box. The opposite and the two neighbors that share the axis flip the part's picture with them. The two faces that look along it keep their pictures, at new depths (decision 4). |
| Delete or Backspace        | Every face shows the rest alone, and its strays: the selected voxels are gone (decision 5).                                                                                                                            |
| Copy                       | The edited face's pixels alone, as today. The clipboard holds one picture.                                                                                                                                             |
| Drop                       | Esc, a click outside, a tool, face or layer switch, or a structural change. Every face keeps what it shows.                                                                                                            |
| Off the tile               | The part keeps its off-tile texels and off-lattice voxels while the selection is up and loses them at the drop, on every face alike.                                                                                   |

Each closed gesture is one undo step covering every face it changed. Undo is a
structural change, so it drops the selection, as it does today.

### 2.5 The pieces

**`src/lib/select-faces.js`, new and pure.** It imports the view tables and
`buildVoxels` from `sprite-machine`, as `lib/edges.js` imports the tables.

```js
projectBounds(view, bounds, onto, t); // the rectangle on `onto`, inclusive
projectDelta(view, dx, dy, onto); // {dx, dy} on `onto`
projectFlip(view, axis, onto); // 'horizontal' | 'vertical' | null
liftFaces(views, view, bounds, t); // {voxels, faces: [{face, part, rest}]}, §2.2
createFaceSelection(views, view, bounds, t);
```

The per-pair mapping is one table derived at load from `VIEW_IMAGE_AXES`: for
each image axis of `onto`, whether it takes `view`'s columns, rows or neither,
and whether it runs reversed. `projectFlip` is null for the two faces that
look along the flipped axis.

`liftFaces` builds the layer with `buildVoxels`, for its `solid` and its
`faceColor`. One pass over the solid voxels splits them into the selected and
the rest with `VIEWS[view].projectInto`, keeps the selected as a list, and
gives each face its two pictures: the part's color per texel, and the rest's
color and depth per texel, strays included at no depth. A depth is the
voxel's distance from the face's viewer along `FACE_NORMAL`.

Each operation transforms the list, a translation by the world move and a
mirror per flip, and projects it onto each face for the part's texels and
depths. The part's color at a texel is read from its source texel, back
through `projectDelta` and `projectFlip`. The composite is §2.2's: the nearer
picture at each texel, the part on a tie. It replaces `compositeFloat` on
these five faces. The edited face keeps `compositeFloat`, in the canvas.

`createFaceSelection` holds the lifts and one working tile per face, and
mirrors the canvas's verbs:

```js
sel.moveTo(dx, dy); // the voxels at the world move, each face recomposited. Returns the faces that changed.
sel.flip(axis); // the voxels mirrored in the box, each part's picture on its projected axis
sel.clear(); // each face its rest alone
sel.tile(face); // the working tile, handed to doc.applyTileEdit by reference
sel.takePairs(); // [{face, before, after}] since the last take, as copies
```

`moveTo` takes the absolute offset, so a cancel is a `moveTo` back to the
grab. `takePairs` keeps a copy of each face as last committed, so a second
drag of one selection records its own step.

**`<sm-draw-canvas>`.** It stays a one-face component and gains one event,
sent before it writes, so the carve reads the faces as they stood:

```
sm-selection-op  { op: 'move', bounds, dx, dy }  bounds: the lift origin. dx, dy: the offset.
                 { op: 'flip', bounds, axis }
                 { op: 'clear', bounds }
                 { op: 'end' }                   a gesture closed, after any sm-commit
                 { op: 'drop' }
```

`move` fires at the lift with a zero offset and at every offset change,
including a cancel's revert and a move of an empty float. A pasted selection
sends none of these. Nothing else in the canvas changes.

**`<sm-editor>`.** On the first `move`, `flip` or `clear` of a selection, with
`session.selectAllFaces` on, it creates the face selection from the doc's
tiles for its layer and face. Each op calls the matching verb and hands every
changed face to `doc.applyTileEdit(layer, face, sel.tile(face))`, the path a
stroke takes, so the sheet blit, the Full Sprite View, the palette, the dirty
flag and the rebuild all follow. `drop` forgets it.

One undo step: `sm-commit` pushes the edited face's pair and `takePairs()`
together as one entry. An `end` with pairs still waiting, which happens when
the edited face is empty and only the others changed, pushes them alone.

The view model: a stroke never changed the underlay or the edge hints, so the
editor memoizes them. A projected move changes both, since the underlay is
the opposite face and the hints are the neighbors. The editor refreshes
`onionBehind` and `edgeHints` after each op and keeps `tile`, whose identity
resets the canvas.

**`state/history.js`.** A new entry kind, `faces`:
`{layer, faces: [{face, before, after}]}`, pushed by `pushFaces(layer, pairs)`.
Pairs with identical bytes are dropped, and an entry with none left is not
recorded, so a cancelled move leaves no step.

**`state/doc.js`.** `restoreTiles(layer, tiles)` blits every face and slices
once, so an undo notifies once. `restoreTile` becomes the one-face call of it.

**The live channel.** `flushLive` calls each listener once per edit, and the
rebuilder rebuilds on each call. Six faces in one frame would carve and mesh
the layer six times, and `docs/live-rebuild-performance-plan.md` measures one
rebuild of the sample car at 19.5 ms. The channel changes to one call per
flush, carrying the edits:
`onLive((state, edits) => …)`. The rebuilder clears each edited layer's cache
and rebuilds once. The Full Sprite View, the palette and the dirty flag
already do one thing per call, and now do it once per frame. A projected move
then costs what a one-face move costs, plus five projections of the selected
voxels and five tile-sized composites: a part is a few thousand voxels, and a
whole 40 px model tens of thousands.

**The first operation's cost.** One `buildVoxels` of one layer, at the press
that starts the move: a few milliseconds at 40 px, more at 64. If it shows,
the result can come from the per-document voxel cache in
`docs/underlay-model-view-plan.md` once that lands.

### 2.6 The option

`session.selectAllFaces`, on at every load (decision 2). The options strip shows
it after the flip buttons, behind a separator:

```
40 × 12  ┊  [Flip Horizontal] [Flip Vertical]  ┊  ☐ on all faces
```

`sm-tool-options` emits `sm-set-select-opts {allFaces}`. The option is read at
a selection's first operation and holds for that selection's life, so drawing
a marquee, then checking the box, then dragging projects. From the first
operation until the drop the checkbox is greyed (decision 3), which needs a
`lifted` flag beside `bounds` in `ctx.selection`.

### 2.7 Showing it

- **The edited canvas** is unchanged: the same ants, the same `W × H`.
- **The underlay and the edge hints** follow the move live (§2.5). The faint
  opposite behind the drawing moves with the selection, which is the first
  sign that the option is on.
- **The 3D View** rebuilds each frame, as it does for a stroke.
- **The Full Sprite View** draws the projected rectangle on each of the other
  five cells while the option is on and a selection is up: static ants, 1
  system px, from `projectBounds` over the `ctx.selection` store (decision 6).
  On a neighbor the outline is the band the box passes through. Not every
  texel in it moves (§2.2).

### 2.8 The words

- README: §Drawing's tool table and §Selecting and moving. The closing
  paragraph ("A move changes only the face you are on…") becomes the checkbox:
  what it does, in the README's terms, with no "voxel", "project" or "band".
  §Fixing common problems' "The model sits off to one side" gets the one-step
  answer.
- `src/texts/read-me.txt`: the same sentence. Built-in texts read the app's
  text, so every profile sees it.
- SPEC: §Drawing editor's Selection, Flip and Delete bullets, the options
  strip, §Architecture's `lib/` line, the live channel, and the next steps'
  Selection entry, which keeps the paste.
- Header comments: `lib/select-faces.js`, `sm-draw-canvas.js` (the event),
  `sm-editor.js`, `state/doc.js` (the channel), `state/history.js` (the kind).

## 3. Steps, each landing green

1. **The live channel reports a flush.** `doc.onLive` calls once per flush
   with the edits; the rebuilder, the Full Sprite View, the palette and the
   workspace's dirty flag take the new shape. Tests: §5. By eye: draw on the
   Car and the Truck. The 3D View, the Full Sprite View and the Color Palette
   follow every stroke as before.
2. **The geometry.** `projectBounds`, `projectDelta` and `projectFlip` in
   `lib/select-faces.js`. Tests: §5. Nothing calls them yet.
3. **The lift.** `liftFaces` and `createFaceSelection`. Tests: §5.
4. **One undo step for many faces.** `pushFaces` and the `faces` kind in
   `state/history.js`, `restoreTiles` in `state/doc.js`. Tests: §5.
5. **The move.** `session.selectAllFaces`, the checkbox, `sm-selection-op`,
   the editor's wiring, the view model refresh. Verified by eye, on the Car
   (40 px tiles), with the selection tool and **on all faces** checked:
   - On the Front face, ⌘A and drag up 3. The Full Sprite View shows Left,
     Right and Back rise with it while Top and Bottom hold still, and the 3D
     View shows the whole car 3 higher, intact. The faint picture behind the
     drawing rises too. One ⌘Z puts all of it back.
   - Drag right instead: Back and Top move left, Bottom moves right, the
     sides hold still, and the car slides sideways in the 3D View.
   - On the Truck's Cab layer, on the Left face, drag a box around the upper
     cab that also reaches forward over the space above the hood, and move it
     back 2. On Top the hood does not change, the roof reaches 2 rows further
     back, and the 3D View shows the upper cab moved with the hood and the
     lower cab whole.
   - Esc in the middle of a drag puts every face back. Shift locks the axis on
     every face.
   - The Right face opens empty because it is mirror-derived. ⌘A there and
     drag: the Left face's art moves the other way, and Right still opens
     empty.
   - On the Truck, press a wheel layer's number, ⌘A and drag: that layer's
     faces move and the others hold still.
   - Under and behind: in a new 16 px document, draw a shelf and a box beside
     it, not under it, in two colors, on Front, Left and Top. On Left, drag
     the box under the shelf. On Top the box's pixels leave and the shelf's
     stay as they were, and the shelf's top keeps its color in the 3D View.
     Drag it back out before letting go of the selection: the box's pixels
     return to Top. Put it under the shelf again, let go, select it again and
     drag it out: Top paints the box's footprint in the color the 3D View
     showed on the box's top.
   - Paste, then drag the paste: only the edited face changes.
   - Unchecked, a move changes the edited face alone, as today. After the
     first drag of a selection the checkbox is greyed until the selection
     drops.
6. **Flip and Delete.** The `flip` and `clear` ops. By eye: on Left, ⌘A and
   Flip Horizontal turns the car end for end in the 3D View, with Top and
   Bottom flipped top to bottom and Front and Back unchanged. Select a part
   and press Delete: it leaves the model and every face. One ⌘Z each.
7. **The outlines.** The Full Sprite View's five rectangles. By eye: drag a
   marquee on Front and watch Back mirror it, Top and Bottom show a column
   band and Left and Right a row band. They go when the selection drops or the
   box is unchecked.
8. **The words.** §2.8, and this plan's status line.

The app bump is a patch: an option on a tool that already exists. The engine
does not change.

## 4. Kit asks

None. `vf-checkbox` and `vf-separator` are in the strip already.

## 5. Tests

By `docs/TESTING.md`: the new pure rules get contract tests. The canvas event,
the editor's wiring, the checkbox, the view model refresh and the outlines are
wiring and look, checked by eye.

Step 1, `test/doc.test.mjs`: edits to several faces and layers in one frame
reach a listener as one call carrying each edit once; the existing live tests
take the new shape.

Step 2, `test/select-faces.test.mjs`:

- `projectBounds` agrees with the engine: for every pair of faces, a voxel
  whose `VIEWS[view].project` lies in the rectangle has its
  `VIEWS[onto].project` inside the projected one. The opposite's rectangle is
  the mirror, and projecting it back returns the original. A neighbor's spans
  the whole tile on the edited face's depth axis.
- `projectDelta` agrees the same way: moving a voxel by the world move behind
  `(dx, dy)` moves its pixel on `onto` by the projected delta. It is zero
  along the line of sight.
- `projectFlip`: the opposite flips on the same image axis, a neighbor on the
  axis it shares, and the faces that look along the flip give null.

Step 3, `test/select-faces.test.mjs`, on small hand-built layers:

- A rectangle around everything puts every painted texel of every face with
  art in the part, and leaves no rest.
- A part over a body: a neighbor's texel with both kinds of voxel on its line
  is in both pictures; one with selected voxels alone is the part's; one with
  unselected voxels alone is untouched by any move, though it lies in the
  band.
- Occlusion: a part moved under a nearer voxel of the rest leaves that texel's
  bytes alone, and the texel stays painted. Moved back out, every face is
  restored byte for byte. Two voxels in one cell show the part.
- A move along a face's line of sight that brings the part in front of the
  rest turns the texels they share to the part's color, with no texel of that
  face moving.
- The colors: a picture whose voxel was nearest keeps the texel's bytes; one
  whose voxel was hidden takes `faceColor` where the surface was exposed, and
  the texel's bytes where it was buried.
- A stray stays when the rest has a texel in its face's band, and moves when
  it has none. A part covers a stray it lands on, and the stray returns when
  the part moves on.
- A face with no art is skipped, and so is a face whose rectangle lifts
  nothing. Clear texels in the rectangle select nothing behind them.
- `moveTo` is a function of the offset: two moves equal one, and a move back
  to zero restores every face byte for byte.
- The rule is the voxel move: after a move, each face's painted texels are the
  projection of the rest and the moved selected voxels, plus that face's
  strays, and the picture shown at each texel is the nearest voxel's. For a
  part moved into empty space, carving the six results gives the old solid
  with the selected voxels moved.
- `takePairs` returns copies, only for faces that changed, and a second take
  with no change returns none.

Step 4: `test/history.test.mjs`, a `faces` entry undoes and redoes every face
as one step, identical pairs are dropped, and an entry of identical pairs is
not recorded. `test/doc.test.mjs`, `restoreTiles` blits each face into the
layer's block and notifies once.

## 6. Decisions

**All thirteen decided as recommended on 2026-09-18** ("read our README.md and
then proceed with the implementation of docs/selection-all-faces-plan.md"), with
decision 2's default reversed the same day: the box is **on** at every load.
Four details the build settled, each following from a decision rather than
replacing one:

- The part is kept as a picture per face, not a list of voxels re-projected at
  every offset (§2.5). The two agree on which texels the part covers, since a
  translation and a mirror carry the projection with them; they differ only in
  depth under a mirror along a face's line of sight, where the picture model is
  what decision 4 asks for, and in a color a voxel hidden behind another
  selected voxel would want. The depths still mirror within the box, so the
  first-hit test against the rest holds.
- `liftFaces` returns `{dims, solid, selected, box, faces}`, each face carrying
  its two pictures, its strays, its band and whether the band moves whole.
- The underlay and hint refresh is `editorOverlays` in `state/derive.js`, which
  `editorViewModel` now composes.
- The Full Sprite View's outlines are `drawStillAnts` in `draw-overlays.js`, on a
  second canvas per cell at system-px resolution.

1. **What moves on a neighboring face.** Recommended: §2.2's rule, resolved in
   the carve. A texel moves when the selection's voxels cover it and stays
   when the rest of the model still needs it. It is what "through the voxel
   space" means, a part moves without cutting the body it sits on, and ⌘A
   still moves everything. The cost is one carve at the first operation and a
   rule that takes a paragraph to state. The alternatives: (a) move the whole
   band, which is simple and exact for ⌘A but drags along anything that shares
   the band with the part, as the hood shares the upper cab's rows on Top;
   (b) project to the opposite face only, which leaves the neighbors to be
   moved by hand; (c) move the voxels and redraw the six faces from their
   projection, which paints the same silhouettes but drops every stray,
   replaces the art's colors with derived ones and rewrites texels the move
   never touched (§2.2).
2. **The checkbox.** Recommended: **on all faces**, the fill tool's words, off
   on every load. The alternative remembers it in prefs. _Decided 2026-09-18:
   the words as recommended, but **on** at every load ("let's make 'on all
   faces' be ON by default"), so the faces stay in line unless the box is
   unchecked._
3. **When the option is read.** Recommended: at a selection's first move, flip
   or Delete, held for that selection's life, with the checkbox greyed from
   then until the drop. A marquee drawn before the box is checked still
   projects. The alternative leaves the checkbox live and lets a change wait
   for the next selection, with nothing on screen saying so.
4. **Flips.** Recommended: a flip projects to the opposite face and to the two
   neighbors that share the flipped axis. The two faces that look along the
   axis are left alone: their outlines do not change under the flip, so the
   model stays whole, and their art stays on its own end. The alternatives:
   also exchange those two faces' art within the band, so a car flipped end
   for end takes its grille with it (§7); or flips never project, which leaves
   a flipped face at odds with its neighbors.
5. **Delete.** Recommended: it projects, by the same rule, so a deleted part
   leaves the model. The alternative clears the edited face alone, which the
   carve already turns into a hole through the model.
6. **The outlines on the Full Sprite View.** Recommended: build step 7, static
   ants on the other five cells. They show what a drag will touch before it
   starts. A cell is 35 system px for a 40 px tile, so an outline lands within
   a pixel of the truth, not on it. The alternative ships without them and
   relies on the underlay, the hints and the 3D View.
7. **The undo entry.** Recommended: the `faces` kind, the changed tiles alone.
   The alternative reuses the fill's whole-sheet snapshot, which copies every
   layer's sheet twice per drag.
8. **The live channel.** Recommended: one call per flush (step 1). Every
   listener is better for it. The alternative keeps the channel and has the
   rebuilder coalesce its own calls, which leaves the Full Sprite View
   painting six times a frame.
9. **Documents off the convention.** Recommended: grey the checkbox for
   non-square tiles or a view transform. The alternative maps through the
   transforms, for sheets only a hand-made PNG can produce.
10. **A paste onto every face.** Recommended: not in this plan (§7). A pasted
    picture has one face's pixels, and what it should put on the others is its
    own question.
11. **A moved part and the rest on one line of sight.** Recommended: on the
    five other faces the nearer voxel's picture shows, and the part on a tie
    (§2.2). A part moved under or behind something never paints over the art
    that colors the thing in front of it, and a part moved in front takes the
    texel. The cost is a depth per texel and a projection of the selected
    voxels at every offset. The alternative paints the part over everything,
    as a float does, and recolors whatever it passes under.
12. **The color of a surface no art described.** A part that comes out from
    behind something needs a color on a face whose texel there belonged to
    what hid it, and so does a surface the part uncovers. Recommended: the
    model's color for that surface, which is what the 3D View showed before
    the move, and the texel's own bytes where the surface was buried and the
    model had none. It is a palette color, written only where no art existed
    for that surface. The alternative is always the texel's bytes, which
    paints a part that comes out in the color of what hid it.
13. **The edited face.** Recommended: its float paints over its base with no
    depth test, as it always has. It is the face in view, and what is dragged
    there is what shows. The alternative tests it too, so a float slides
    behind nearer art on the canvas. The canvas would need the depths, and
    the selection tool would behave differently with the box checked.

## 7. Follow-ups

- **A paste onto every face**, the other half of SPEC's entry.
- **Every layer at once**, to move a whole layered document in one drag.
- **The flip's exchange** of the two faces that look along the flipped axis
  (decision 4).
- **The solid from the voxel cache**, once `docs/underlay-model-view-plan.md`
  lands, in place of the carve at the first operation.
- **The outline of what will move**, in place of the band, on the Full Sprite
  View: it needs the carve before the first operation.
- **A box with a depth limit.** A marquee takes everything behind it, so both
  of a pair of wheels seen from the side. Limiting the box's depth needs a way
  to set it, and is its own plan.

## 8. Files touched

| File                                                 | What                                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/lib/select-faces.js`                            | new: the projection, `liftFaces`, `createFaceSelection`                           |
| `src/components/sm-draw-canvas.js`                   | `sm-selection-op`, sent before each write; none for a paste                       |
| `src/components/sm-editor.js`                        | the face selection's wiring, the joined undo step, the underlay and hints refresh |
| `src/components/sm-tool-options.js`                  | the checkbox, `sm-set-select-opts`                                                |
| `src/components/sm-options-bar.js`                   | binds `selectAllFaces` and the greyed state                                       |
| `src/components/sm-atlas-view.js`                    | step 7: the projected outlines                                                    |
| `src/state/session.js`                               | `selectAllFaces`, `setSelectAllFaces`                                             |
| `src/state/workspace.js`                             | `lifted` in `ctx.selection`; the dirty flag's listener                            |
| `src/state/doc.js`                                   | the live channel's one call per flush; `restoreTiles`                             |
| `src/state/history.js`                               | the `faces` kind, `pushFaces`                                                     |
| `src/scene/rebuilder.js`, `sm-palette-view.js`       | the live channel's new shape                                                      |
| `test/select-faces.test.mjs`                         | new: §5                                                                           |
| `test/doc.test.mjs`, `test/history.test.mjs`         | §5                                                                                |
| `README.md`, `src/texts/read-me.txt`, `docs/SPEC.md` | §2.8                                                                              |
