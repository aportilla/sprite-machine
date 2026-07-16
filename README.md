# sprite machine

Turn low-resolution pixel-art **face sprites** (top / front / side / …) into a
real, rotatable **Three.js 3D object** — the chunky look is baked into the
geometry, not faked by a shader.

![voxel car from a 3×2 pixel atlas](docs/car.png)

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # pipeline + wedge-mesh + atlas round-trip (node --test)
npm run build    # static bundle in dist/
```

**Pick a built-in sample**, or load your own **3×2 sprite sheet** — click *pick
atlas…* or drop a PNG anywhere on the window. **Low-poly** (additive 45° wedges)
is on by default and toggles live; greedy meshing is always on. Sprites are hard
pixel art — every texel is fully opaque or fully transparent — and every face
with no view of its own is mirror-filled from its opposite (and shown, derived,
in the faces preview). Click any face in that preview to **edit its pixels
in-app** — see [Drawing editor](#drawing-editor).

## Input: a 3×2 atlas

One sheet, six tiles, in this fixed layout (empty cells are fine — they fall back
to mirroring):

```
LEFT   FRONT  TOP
RIGHT  BACK   BOTTOM
```

The **tile size is auto-derived** from the image dimensions and the grid (a
120×80 sheet ⇒ 40×40 tiles). Each tile is auto-cropped to its content, so
padding/centering doesn't matter.

**Tile orientation** (world: `+x` right, `+y` up, `+z` = front toward camera) —
draw each tile this way for a zero-transform ingest:

| Tile | Draw as… | Front points | Size |
|---|---|---|---|
| FRONT / BACK | head-on / from behind, upright | — | width × height |
| RIGHT | the right side | right | depth × height |
| LEFT | the left side | left | depth × height |
| TOP | plan view, width horizontal | top edge | width × depth |
| BOTTOM | plan from below, width horizontal | bottom edge | width × depth |

The UI's **faces** preview lays the sliced tiles out like the sheet and marks
this **Front points** edge in green on each thumbnail, so a mis-oriented tile is
obvious at a glance. Per-tile `rot`/`flip` transforms exist in the pipeline for
sheets that don't follow the convention.

## Drawing editor

Click any tile in the **faces** preview to open an in-app pixel editor in a
right-side panel; the 3D view stays live beside it and rebuilds as you draw.

- **Palette** — a fixed **DB16** ramp (16 colors) plus an **eyedropper** (sample
  a color straight from the sprite) and a **transparent** tile (erase). Every
  stroke is hard-pixel: fully opaque or fully erased, never anti-aliased.
- **Mirror-pair tabs** — a `[front|back]` / `[left|right]` / `[top|bottom]` pill
  under the canvas switches which face of the pair you're editing, so you can flip
  back and forth for reference. A **mirror-derived** face opens seeded with the
  mirrored opposite (exactly what its thumbnail shows) and only becomes its own
  independent art once you actually change a pixel — open-and-close leaves it
  derived, and erasing it fully reverts it to derived.
- **Live + canonical** — edits write straight back into the current sheet, so the
  **download** button saves the edited atlas as `atlas.png`, and the model
  rebuilds (rAF-debounced) with no camera jump.

Drawn pixels are **not** 1:1 with voxels: `buildVoxels` still auto-crops each view
and resamples disagreeing axes up to the reconciled grid, so a face drawn wider
than its opposite rescales along that axis. The editor is pure authoring — no
changes to the carve / colorize / mesh pipeline. See `src/editor.js`.

**Dev hook:** append `?edit=<face>` (e.g. `?edit=front`) to open the editor on
that face right after the first build. It's how the editor gets exercised in
headless screenshots (the capture tool can't click), and it's handy for jumping
straight to a face while iterating. It joins the other test-only URL params:
`?sample=<index|name>`, `?rotate=0`, `?lowpoly=0|1`, `?flat=1`, `?diag=1`
(watertightness self-check), and `?cam=top|front|fq|bq`.

---

## The technique: multi-view visual-hull voxelization

Given orthographic pixel sprites of an object's faces, we reconstruct a voxel
solid and color its surface. Chosen over three alternatives (textured box,
sprite-stacking, mesh boolean-extrude) because it's the only one that yields a
genuine solid that self-occludes, casts a true blocky shadow, and stays crisp at
any angle — 1 pixel = 1 voxel = 1 cube.

1. **Ingest** — each sprite is read at native pixel resolution into occupancy +
   packed-RGB typed arrays, then **auto-cropped to its alpha bounding box** (the
   #1 real-world failure is art that isn't centered per view).
2. **Reconcile dims** — one integer resolution per axis is derived from the
   sprite sizes: `front → W×H`, `side → D×H`, `top → W×D`. Disagreeing views are
   nearest-neighbor resampled up and a warning is surfaced.
   (MagicaVoxel's `12×30 + 10×30 → 12×10×30` rule.)
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

| Mode | What it is | Use |
|---|---|---|
| **voxel (3D)** | Visual-hull voxel solid (above), greedy-meshed | The real object (low-poly off) |
| **low-poly** | Voxel solid + 45° wedges over same-surface staircases | Softer silhouette, fewer hard steps (default) |

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
opposite view, so a half-drawn sheet still colors every face — both built-in
samples ship only LEFT/FRONT/TOP and mirror-fill RIGHT/BACK/BOTTOM. Mirroring is
a *coloring* step; an axis with no view at all (neither side) is simply
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
round-trip) that the drawing editor depends on.

```
src/lib/
  constants.js    default mirror (all-on) / world-size + DB16 pencil palette (pure)
  views.js        6 view definitions: normals, axes, projections, front-edge meta
  atlas.js        slice a 3x2 sheet <-> face tiles: blitTile write-back, cellOf (pure)
  ingest.js       sprite -> occupancy/color arrays, auto-crop, resample, reorient
  carve.js        dim reconciliation, visual-hull AND, surface extraction
  colorize.js     depth-aware first-hit surface coloring + palette snap
  faces.js        surface voxels -> quads: greedy-merged or culled (pure)
  pipeline.js     ingest -> carve -> colorize  (pure; Node-testable)
  t-junction.js   lattice-exact T-junction repair for merged+wedge meshes (pure)
  mesh-util.js    shared vertex-color linearizer + mesh finishing (THREE)
  mesh.js         quads -> merged, vertex-colored THREE.Mesh    (voxel mode; THREE)
  wedge-mesh.js   voxel solid + additive 45° wedges             (low-poly mode; THREE)
  sprite-data.js  built-in samples (as atlases) + grid->ImageData helper
  diag.js         geometry watertightness self-check (dev only; ?diag=1)
src/
  main.js         scene, lights, ground, framing, render loop + drawing-editor wiring
  ui.js           left panel: samples, pick/drop atlas, clickable faces, options, stats
  editor.js       inline tile editor (right panel): DB16 palette, eyedropper/eraser, mirror tabs
  image-io.js     File/URL -> ImageData decode + ImageData -> PNG download (browser)
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
  call and a handful of triangles; for a scene of *many* objects, batch identical
  ones with an object-level `InstancedMesh`, and move `buildVoxels` to a Web
  Worker (it's pure typed-array code, trivially transferable) if rebuilds ever
  stall the main thread.
- **Export** — the merged mesh is glTF-ready (`GLTFExporter`) for use in other
  engines / animation.
