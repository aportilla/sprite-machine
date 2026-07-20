# sprite machine

Turn low-resolution pixel-art **face sprites** (top / front / side / …) into a
real, rotatable **Three.js 3D object** — the chunky look is baked into the
geometry, not faked by a shader.

![voxel car from a 3×2 pixel atlas](docs/car.png)

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit + integration suites (node --test)
npm run typecheck  # tsc checkJs over src/ (JSDoc types)
npm run lint       # prettier --check .   (npm run format to fix)
npm run build      # static bundle in dist/
```

**Pick a built-in sample**, or load your own **3×2 sprite sheet** — click _pick
atlas ▾_ in the header or drop a PNG anywhere on the window. **Smooth slopes**
(low-poly additive 45° wedges) is on by default and toggles live; greedy meshing
is always on. Sprites are hard pixel art — every texel is fully opaque or fully
transparent — and every face with no view of its own is mirror-filled from its
opposite at render time. The app is a **header strip** over a **50/50 split**:
the live 3D object on the left, and on the right a **tools panel** always open on
one face. The face **tabs** switch which of the six you're editing (a
mirror-derived face reads empty — an honest view of the sheet) — see
[Drawing editor](#drawing-editor).

## Input: a 3×2 atlas

One sheet, six tiles, in this fixed layout (empty cells are fine — they fall back
to mirroring):

```
LEFT   FRONT  TOP
RIGHT  BACK   BOTTOM
```

The **tile size is auto-derived** from the image dimensions and the grid (a
120×80 sheet ⇒ 40×40 tiles). Each tile is a **literal slice of the voxel
lattice** — a pixel's position inside its tile _is_ its position in the object,
so tiles are read at full size (**no auto-crop**) and must be **registered across
faces**: a FRONT pixel only becomes solid where the SIDE covers its row and the
TOP covers its column. Use **square tiles** (a cubic lattice); the in-app editor
draws alignment guides to help you line pixels up.

**Tile orientation** (world: `+x` right, `+y` up, `+z` = front toward camera) —
draw each tile this way for a zero-transform ingest:

| Tile         | Draw as…                                                | Front points | Size           |
| ------------ | ------------------------------------------------------- | ------------ | -------------- |
| FRONT / BACK | head-on / from behind, upright                          | —            | width × height |
| RIGHT        | the right side                                          | right        | depth × height |
| LEFT         | the left side                                           | left         | depth × height |
| TOP          | plan view, width horizontal                             | top edge     | width × depth  |
| BOTTOM       | plan from below (car rolled sideways, not end-over-end) | top edge     | width × depth  |

The editor's face **tabs** switch which tile you're editing; check each tile's
orientation against this table's **Front points** column, using the faded
onion-skin of the mirrored opposite and the alignment guides behind the canvas.
Per-tile `rot`/`flip` transforms exist in the pipeline for sheets that don't
follow the convention.

## Drawing editor

The **tools panel** fills the right half of the window and is always open on one
face; the 3D view stays live on the left and rebuilds as you draw. Pick a face
with the **tabs**; a **header strip** across the top holds the brand, the
_pick atlas ▾_ menu, and _download_.

- **Panel layout** — the panel is a **classic Photoshop tool panel**: a fixed
  **3-region flex column** that exactly fills the panel height. A **settings header**
  (top, fixed) holds the tools; a **draw section** (middle) **grows to fill all
  remaining height**; a **colors tray** (bottom, fixed) reserves space for the
  palette. The pixel canvas fills the draw section below the tabs — its height is
  **CSS-driven** (the flex draw region), no longer a JS fraction — and the square
  editable canvas is **centered** in it and drawn **as large as an integer texel
  scale fits** (crisp, never a fractional pixel), **re-fitting responsively** when the
  window resizes. See `layout()` in `src/editor.js`.
- **Tools** — the **settings header** holds a **tool strip** of first-class tools
  (**pencil `B`**, **rect `R`**, and **fill `G`** are all live) — each a **square
  icon button** drawn from the open-source **Adobe Spectrum
  _workflow_** icon set (`draw` / `rectangle` / `color-fill`; the eyedropper ink
  picker in the colors tray uses `sampler`, and transparent is a checkerboard swatch,
  not an icon) — with
  the **tile-size stepper** (`tile size`) docked at its right, above a **per-tool options**
  row. For the **pencil**, a **tip-size slider** (`size: N px`, with a boxed readout)
  that stamps an
  **N×N** square footprint and **previews it** as a hairline outline on the canvas
  as you hover; while the pencil is active the **OS cursor is hidden** over the
  canvas, so that hover outline _is_ the cursor — the exact texels a stamp will
  cover, nothing else floating over them. For the **rect**, a **corner-radius
  stepper** (`radius: N px`, `0` = sharp): **drag** a box and a **live preview**
  (the exact filled texels, tinted by the ink — red while erasing — under a haloed
  bounding box) tracks the drag on the top overlay; **release** commits it, and
  **Esc** (or switching tool with `B`/`R`) **cancels** the in-flight box with
  nothing written. Hold **Shift** while dragging to lock the box to a **square** (the
  shorter extent wins, anchored at the start corner) — toggleable mid-drag, so the
  preview re-fits the instant you press or release Shift. Each corner rounds with a **convex** quarter-circle arc (bulging
  outward like a real rounded rectangle, not a concave scoop; clamped to half the
  shorter side), so even `radius: 1` clips the corner texel; the rect
  respects the active ink, so a **right-drag** (or the transparent ink) drags a
  rectangular **erase**. The rounded-rect rasterization is a pure, Node-tested
  primitive (`src/lib/rect.js`) shared by the preview and the commit, so what you
  see is exactly what lands. For the **fill** (paint-bucket), two **checkboxes**:
  a plain click is a **contiguous 4-connected flood** from the clicked texel (the
  connected region sharing its color becomes the active ink). **replace** upgrades
  that to a **whole-tile recolor** — _every_ texel matching the clicked color on the
  tile, contiguous or not. **all tiles** (only active while **replace** is on)
  extends the recolor across **every tile in the atlas**, so it's a global
  find-and-replace of one color. Transparency is a first-class "color": clicking
  empty space targets transparent (so **replace** floods every empty texel with the
  ink), and a **right-click** / the transparent ink fills _to_ transparent (delete a
  color). The flood + replace are pure, Node-tested primitives (`src/lib/fill.js`).
  There's **no undo**, so an all-tiles replace is committed immediately — reload the
  sample to revert. The bottom **colors tray** has a left **ink strip** — the
  **eyedropper** (`I` / hold **Alt** to sample mid-stroke) and a **selected-color
  preview** box that shows your current ink and, **clicked**, opens the **modal
  picker** over the **full 256-color palette** — beside a **scrollable palette box**:
  every color currently painted on _any_ face, so you can match existing colors,
  **plus your currently selected ink** (so a color picked from the modal lands here as
  the **selected tile** right away, before you've drawn a single pixel with it), led
  by a **transparent** swatch (`E` / **right-click**) — a
  **checkerboard tile** (the same checker the canvas shows through unpainted texels,
  so it previews what it paints) that selects the **empty / clear color**, not an
  eraser _tool_. The eyedropper and transparent swatch pick the pencil's **ink** — a
  sampled color, or transparent ("clear color") — rather than a drawing tool, so they
  sit _with the colors_, not the tools. Selecting transparent then drawing (or a
  right-click, or the `E` ink) lays clear texels, so it reads as painting a color, not
  wielding an eraser. The
  modal is a 16×16 grid of **256 distinct** swatches (**Esc**, the backdrop, or
  **✕** closes it). The base is the standard **xterm-256** set — but xterm-256
  names 256 indexed _slots_ and only 247 _distinct_ colors (nine values, e.g.
  `#808080`/`#000000`/`#ffffff`, repeat where its system, cube, and grayscale
  ranges overlap), so the nine redundant cells are backfilled with shades
  **interpolated from their Hilbert neighbors** — every cell is now a unique color
  that still sits in its local cluster. The whole thing is **laid out along a
  Hilbert curve** — a locality-preserving 1-D color order poured into the grid
  along a 2-D Hilbert curve, so similar shades stay adjacent both across and down
  (organic clusters, not strict bands): grayscale in the top-left, magentas/reds
  across the top, blues down the right, greens/cyans sweeping the bottom. The
  arrangement is a fixed, hand-verified layout spelled out in
  `src/lib/constants.js` (`PALETTE_256`). **Wedge-safety caveat:** xterm-256 is dense
  enough that some adjacent swatches fall _within_ the low-poly wedge merge tolerance
  (`sameMat`, `TOL2 = 12²` squared-L2), so a staircase of two such shades can now
  auto-smooth into a wedge. Recomputed against the real palette + gate there are **16
  within-tolerance pairs**: ten near-neutral grays (the grayscale ramp steps ~10/channel)
  **plus six fully _saturated_ dark primaries/secondaries** — an xterm system color
  (`0x80`=128) lands ~7–10 units from the matching 6×6×6-cube level (`0x87`=135) at the
  same hue (maroon, navy, green, purple, olive, teal). So it's **not only near-neutrals**:
  an author can place two of those on adjacent staircase voxels and get an unintended (but
  near-imperceptible) wedge. The 6×6×6 cube _levels_ still stay ≥40 apart _within_ the
  cube; it's the system-vs-cube overlap at the low end that adds the saturated pairs (the
  earlier sparse 8×8×4 grid kept _every_ swatch ≥36 apart, so none merged).
  `test/palette.test.mjs` pins the exact set. Every stroke is hard-pixel: fully opaque or fully erased, never
  anti-aliased.
- **Face tabs** — six **curved folder tabs** across the top of the draw section
  switch which face you edit, laid out as mirror pairs
  (`left`/`right`, `front`/`back`, `top`/`bottom`)
  so you can flip between a pair for reference. Each tab's folder silhouette is an
  **inline SVG rebuilt from its measured width** (`drawTab` in `src/editor.js`), so
  the S-curve "ears" keep a **fixed pixel shape at any tab width** (only the flat top
  between them grows) rather than distorting like a single stretched background; the
  tabs **overlap** into clean valleys under a shared black **seam**, and the active
  tab lifts above the seam to take the artwork gray so its open base merges into the
  canvas below. A **mirror-derived** face (one with
  no art of its own) opens with an **empty canvas** and a **faded onion-skin** of
  the mirrored opposite behind it for reference; it becomes its own independent art
  only once you actually change a pixel — switching away and back leaves it derived,
  and erasing it fully reverts it to derived.
- **Live + canonical** — edits write straight back into the current sheet, so the
  **download** button saves the edited atlas as `atlas.png`, and the model
  rebuilds (rAF-debounced) with no camera jump.
- **Tile size** — a single **square-tile stepper** docked at the right of the tool
  strip retiles the whole atlas to any integer **1–64** (the ceiling keeps the
  live per-stroke carve — a synchronous O(n³) walk — tractable). Tiles are **locked square**, so
  every resize is **registration-preserving**, and the stepper **keeps the art centered**:
  each axis splits the size change around the sprite (`resizeAtlas` with `anchor:'center'`)
  so it stays put in the canvas as the tile grows / shrinks instead of hugging a corner —
  growing pads transparency on **both** sides, shrinking crops **both**. The odd texel of
  an odd-sized ± step **alternates ends** (by the new size's parity) so repeated clicks
  can't drift the art off-center, and a **typed jump divides the difference** as evenly as
  it can (`splitLow`). Because a square resize just **translates** the whole solid, no
  sprite shears out of registration — but centering the **vertical** axis means the object
  no longer pins to `y=0`, so a ground-rested sprite **floats up off the shadow plane** as
  the tile grows (an accepted trade for centered authoring). Square is the **only
  registering shape** — a 3×2 atlas shares its depth axis between the side tile's width and
  the top tile's height, so a non-square tile would over-constrain that axis and shear the
  depth; locking the stepper square makes that impossible from the UI. The pure
  `resizeAtlas` in `src/lib/atlas.js` still **defaults to origin-anchored** (each axis's
  origin line fixed, `y=0` pinned) for the pipeline, and still accepts an asymmetric pair
  (the `?tile=WxH` dev hook, which **warns** and shears) so the shear path stays testable.

Drawn pixels map 1:1 to voxels at their **literal tile position** — `buildVoxels`
reads each view at full size (no crop, no re-centering) and the carve intersects
the extruded silhouettes, so a pixel survives only where every view sharing an
axis agrees. To help meet that stricter requirement the editor draws **hairline
extent rules** (how far the orthogonal faces' pixels reach — the box a pixel must
land inside to survive the carve) and a **faded onion-skin** of the opposite face
behind the canvas. There is **no auto ground-rest**: an object sits at whatever Y
you paint it (paint at the tile's bottom to rest on the ground). The editor is
pure authoring — no changes to the carve / colorize / mesh pipeline. See
`src/editor.js` and `src/lib/guides.js`.

**Dev hook:** append `?edit=<face>` (e.g. `?edit=front`) to boot with the editor
on that face — it's always open now, so this just picks the starting tab. It's how
the editor gets exercised in headless screenshots (the capture tool can't click),
and it's handy for jumping straight to a face while iterating. It joins the other
test-only URL params: `?sample=<index|name>`, `?rotate=0`, `?lowpoly=0|1`,
`?flat=1`, `?diag=1` (watertightness self-check — only the default low-poly/wedge
mesh is guaranteed watertight; with `?lowpoly=0` the greedy-voxel mesh's unrepaired
step T-junctions show as _expected_ nonzero boundary/odd edges, not holes, so the
`DIAG` title is tagged with the mode), `?cam=top|front|fq|bq`,
`?tile=<N>` (or `<W>x<H>` to force an asymmetric, out-of-registration resize the
locked-square UI can't produce) to apply one **centered** tile resize (the same
`anchor:'center'` path the stepper drives) after the first build,
`?palette=1` to open the 256-color palette modal on the first mount, `?cursor=<N>`
to set the pencil size to N and draw its footprint outline at the tile center on
mount, `?pick=<N>` to select `PALETTE_256[N]` as the ink on mount (as if picked
from the modal) so a shot can show it landing as the selected-color preview + palette tile, and
`?rect=<x0,y0,x1,y1[,r[,sq]]>` to select the rect tool and draw its live drag preview
for that box (corner radius `r`; `sq=1` for the Shift square-lock) on mount so a shot
can show the tool mid-drag, and `?fill=<x,y[,r[,a]]>` to select the fill tool, set its
checkboxes (`replace=r`, `all-tiles=a`), and fill at `(x,y)` on mount (the mount fill
is always applied to the current tile only — combine with `?pick=<N>` to fill with a
specific palette color) so a shot can show the tool + result — the
stepper, tabs, modal, swatch pick, hover preview, rect drag, and fill click can't be
driven headlessly.

---

## The technique: multi-view visual-hull voxelization

Given orthographic pixel sprites of an object's faces, we reconstruct a voxel
solid and color its surface. Chosen over three alternatives (textured box,
sprite-stacking, mesh boolean-extrude) because it's the only one that yields a
genuine solid that self-occludes, casts a true blocky shadow, and stays crisp at
any angle — 1 pixel = 1 voxel = 1 cube.

1. **Ingest** — each sprite is read at native pixel resolution into occupancy +
   packed-RGB typed arrays at **full tile size (no crop)**. Strict registration:
   a tile is a literal slice of the lattice, so texel (u,v) maps 1:1 to a fixed
   lattice line and must line up across faces (the author's job — the editor
   guides help).
2. **Reconcile dims** — one integer resolution per axis comes straight from the
   (uniform) tile size: `front → W×H`, `side → D×H`, `top → W×D` (MagicaVoxel's
   `12×30 + 10×30 → 12×10×30` rule). Views are placed at **identity position** —
   no re-centering, no bottom-anchor — so a pixel stays exactly where it was
   painted. Well-formed sheets use **square tiles** (depth reads as a width in the
   side view but a height in the top view, so only a square tile registers on all
   three planes); a non-square or mismatched sheet takes the max per axis, places
   from the origin, and **warns**.
3. **Carve** — a voxel is solid iff it lands inside the silhouette of **every**
   provided view. For axis-aligned orthographic sprites this is just a boolean
   **AND of extruded masks** — no camera matrices, no CSG. Because opposite views
   project to the same plane, three orthogonal views fully constrain the shape;
   the extra three only add color.
4. **Surface extract** — keep only voxels with ≥1 exposed face; record a 6-bit
   exposure mask per voxel.
5. **Color** — the part most likely to look wrong. Each exposed face is colored
   by the view that **actually sees it first** along its axis
   (depth-aware first-hit), snapped to the sprite palette. This is what stops the
   naive "stamp one sprite pixel down the whole depth ray" smear. Faces no view
   can see fall through a principled chain: mirrored opposite → neighbor average
   → dominant body color.
6. **Mesh** — exposed faces (interior culled) are **greedy-meshed**: coplanar
   same-color faces merge into the largest rectangles, so a flat wall is one quad
   instead of one-per-texel (the reference cube drops from 768 → **12** triangles,
   appearance-identical). Emitted into one `BufferGeometry` with
   per-face vertex colors, rendered `MeshStandardMaterial({ vertexColors,
flatShading })`. One draw call, real shadows, and `flatShading` lets the
   directional light separate top from sides for free.

### Render modes

| Mode           | What it is                                            | Use                                           |
| -------------- | ----------------------------------------------------- | --------------------------------------------- |
| **voxel (3D)** | Visual-hull voxel solid (above), greedy-meshed        | The real object (low-poly off)                |
| **low-poly**   | Voxel solid + 45° wedges over same-surface staircases | Softer silhouette, fewer hard steps (default) |

### Low-poly (additive wedges)

Low-poly mode keeps the voxel solid and **adds 45° wedges** into concave
unit-step notches — a staircase of same-surface voxels becomes a smooth ramp
(windshield, roof, wheel arch). It's **additive only**: wedges fill notches, so
they can never punch a hole or eat the object, and a shape with no staircase (a
plain cube) gets no wedges and stays sharp. Every vertex lands on the integer
lattice, so the result welds **watertight**.

Whether a wedge fires is a **strict same-material test on the two faces it would
merge** — the corner's **riser** and **tread**. Same color on both ⇒ the corner
ramps; different ⇒ it stays a crisp step. Nothing else is consulted, which hands
the sprite author exact, local control over every wedge: to smooth a slope, paint
both faces it joins the same color (so the top-view art over a windshield must
match the glass down to its foot); to keep an edge sharp — a roof/window seam, a
tyre/body join — paint them differently and it can never round. The wedge takes
its color from that shared material. See `src/lib/wedge-mesh.js`.

### Missing faces

Not every face has to be drawn. **Mirror-fill is always on for all three axes:**
a surface face with no view of its own takes its color from the mirrored
opposite view, so a half-drawn sheet still colors every face — the built-in
**Cube** ships only LEFT/FRONT/TOP and mirror-fills RIGHT/BACK/BOTTOM; the
**Car** draws every face but RIGHT, which mirror-fills from LEFT. Mirroring is
a _coloring_ step; an axis with no view at all (neither side) is simply
unconstrained for carving — the shape fills to the bounding box there and warns.

### Coordinate conventions

World: `+x` right, `+y` up, `+z` toward the camera/front. In a **side (left)**
sprite the object's front is the left column; in a **top** sprite the front is
the top row. See `src/lib/views.js` for all six projection mappings.

---

## Architecture

The whole grid pipeline is **pure typed-array code — no THREE, no DOM** — so it's
verified in Node (`test/pipeline.test.mjs`), including the depth-smear regression
and asymmetric-face coloring. A companion `test/wedge-mesh.test.mjs` loads THREE
to gate the low-poly wedge engine (the Helium canvas-farbling regression), and
`test/atlas.test.mjs` locks the tile write-back inverse (slice → `blitTile`
round-trip) that the drawing editor depends on. `test/guides.test.mjs` pins the
editor's cross-axis alignment guides (and that `VIEW_IMAGE_AXES` can't drift from
the projections it's probed from). `test/rect.test.mjs` pins the rect tool's
rounded-rectangle rasterization (radius clamp, convex corners, per-row symmetry) and
the Shift square-lock. `test/fill.test.mjs` pins the fill tool's flood + replace
primitives (4-connectivity, contiguous vs. global scope, transparent-as-a-color,
the no-op guards, and a full-tile flood that can't overflow the stack).
`test/palette.test.mjs` pins the editor's
256-color palette: 256 entries, all distinct, valid `#rrggbb`, `packed`
derived from `css`, and the exact set of within-wedge-tolerance color pairs (the
six saturated system-vs-cube overlaps included) so the wedge-safety note can't drift.

Beyond that pipeline integration, the pure modules also have direct unit suites:
`test/carve.test.mjs` (vox/unvox round-trip, `extractSurface` masks + counts,
`reconcileDims`, `placeView`, plane-union, and a `projectInto`↔`project` drift
guard), `test/colorize.test.mjs` (the mirror-fill / relaxation / dominant-body
fallback tiers, on all three axes), `test/ingest.test.mjs`
(`applyTransform`/`flip` + the `ingestSprite` throw path), and
`test/t-junction.test.mjs` (multi-vertex edge splits with area + colour/normal
preservation), and `test/color.test.mjs` (the shared `rgbKey`/`distinctColors`
helpers — big-endian 24-bit keying, first-seen dedup, and the deliberately looser
`alpha===0`-only skip vs. ingest's `alpha>=128`). `test/mesh.test.mjs` loads THREE to check `voxelMesh` welds
watertight, centres X/Z, and leaves Y as authored, plus the shared vertex-color
linearizer cache; `test/diag.test.mjs` exercises the `?diag=1` watertightness
self-check on closed vs. open surfaces.

```
src/lib/
  constants.js    default mirror (all-on) / world-size + DB16 pencil palette + Hilbert-laid xterm-256 palette (pure)
  color.js        shared color helpers: hexToRgb, rgbKey (24-bit dedup), distinctColors (pure)
  views.js        6 view defs + the face vocabulary (keys/normals/index/axis) all derive from FACE_NORMAL; projections, front-edge meta
  atlas.js        slice a 3x2 sheet <-> face tiles: blitTile write-back, cellOf, validateSheet (pure)
  ingest.js       sprite -> occupancy/color arrays (full tile, no crop), place, reorient
  carve.js        dim reconciliation, visual-hull AND, surface extraction
  colorize.js     depth-aware first-hit surface coloring + palette snap
  faces.js        surface voxels -> quads: greedy-merged or culled (pure)
  guides.js       editor alignment guides: per-face cross-axis extent (pure)
  rect.js         editor rect tool: rounded-rectangle rasterization, per-row runs (pure)
  fill.js         editor fill tool: contiguous flood + global color replace (pure)
  pipeline.js     ingest -> carve -> colorize  (pure; Node-testable)
  t-junction.js   lattice-exact T-junction repair for merged+wedge meshes (pure)
  mesh-util.js    shared vertex-color linearizer + mesh finishing (THREE)
  mesh.js         quads -> merged, vertex-colored THREE.Mesh    (voxel mode; THREE)
  wedge-mesh.js   voxel solid + additive 45° wedges             (low-poly mode; THREE)
  sprite-data.js  built-in samples (as atlases) + grid->ImageData helper
  diag.js         geometry watertightness self-check (dev only; ?diag=1)
src/
  main.js         scene, lights, ground, framing, render loop + always-on editor wiring
  ui.js           header strip (samples, pick/drop atlas, download) + stage overlays (options, stats)
  editor.js       tools panel (right half): a fixed 3-region flex column — SETTINGS header (tool strip: pencil + rect + fill live, docked tile-size stepper; per-tool options: pencil size SLIDER + hover footprint preview, rect corner-radius + live drag preview / Esc-cancel, or fill replace / all-tiles checkboxes), DRAW section (curved folder face tabs drawn per-tab as inline SVG via drawTab + canvas that fills the region via layout(): centered integer-scaled canvas), COLORS tray (ink strip: eyedropper + selected-color preview opening the 256 modal; scrollable palette box led by the transparent swatch); align guides
  image-io.js     File/URL -> ImageData decode + ImageData -> PNG download (browser)
  icons.js        real UI glyphs — registers the Adobe Spectrum workflow <sp-icon-*> elements used by ui.js + editor.js (color via currentColor, size via --mod-icon-size; no sp-theme)
```

## Known limitations & next steps

- **Concavity** — a visual hull is a convex-ish over-approximation along each
  axis (e.g. the gap between wheels fills into a skirt). An opt-in per-column
  **depth channel** would subtract single-axis notches; the color rule already
  handles depth.
- **Low-poly scope** — wedges are **additive only**: a convex staircase (a hood
  sloping down-and-out) still steps, and where two wedge ridges meet at a true
  3-D corner it degrades to a step rather than a corner tile. Base faces **are**
  greedy-merged like voxel mode; the T-junctions that merging leaves against the
  unit-scale wedge edges are stitched out by a lattice-exact repair pass
  (`t-junction.js`), so the result stays watertight (a regression test asserts
  zero boundary edges).
- **Perf** — hidden-face culling + greedy meshing (both on) keep it to one draw
  call and a handful of triangles, and the render loop only redraws on change
  (idle scenes don't repaint). The carve is a synchronous O(n³) walk, so the tile
  stepper is capped at **64** (a 64³ grid still rebuilds live per stroke); to lift
  that ceiling, move `buildVoxels` to a Web Worker (it's pure typed-array code,
  trivially transferable). For a scene of _many_ objects, batch identical ones
  with an object-level `InstancedMesh`.
- **Export** — the merged mesh is glTF-ready (`GLTFExporter`) for use in other
  engines / animation.
