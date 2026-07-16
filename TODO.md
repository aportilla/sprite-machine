# sprite-machine — working notes / handoff

Turn a **3×2 pixel-art atlas** of orthographic face views (a car drawn as
`RIGHT FRONT TOP / LEFT BACK BOTTOM`) into a **3D object** in the browser
(Vite + vanilla JS + Three.js). Three render modes: **voxel (3D)**, **low-poly**
(45° wedges), and **box (fast)**.

---

## Run / verify

```bash
npm run dev      # http://localhost:5173  (dev server is usually already running)
npm test         # node --test — pure pipeline tests (no THREE/DOM)
npm run build    # vite build (catches import/syntax errors fast)
```

**Visual verification — always use `tools/capture.sh`** (the app has an infinite
rAF loop, so headless Chrome must be force-killed or it leaks; the script wraps
the launch + `pkill` + temp-dir cleanup so the caller never issues a bare
`rm -rf`, which would force a permission prompt every time):

```bash
tools/capture.sh shot 'http://localhost:5173/?sample=1&lowpoly=1&rotate=0&cam=bq' /tmp/shot.png   # -> PNG
tools/capture.sh dom  'http://localhost:5173/?sample=1&lowpoly=1&rotate=0&diag=1'                  # -> DOM; grep 'DIAG …' from <title>
```

Then `Read` the PNG. **Stale-mesh gotcha:** Vite HMR hot-swaps an edited module
but does NOT rebuild the already-rendered object — a live tab (or a page that
loads mid-HMR-swap) shows the mesh from the *previous* code. A hard reload
(`Cmd+Shift+R`) or toggling an option forces a rebuild. `capture.sh` opens a
fresh page each time, so it's current — but a capture that lands during an HMR
swap can still read stale; re-run it if a tri count looks off.

**Test-only URL params** (`src/main.js`): `?sample=0|1` (0=Cube, 1=Car) ·
`?lowpoly=1` · `?flat=1` (low-poly in one flat gray — isolates geometry from
color) · `?mode=box` · `?rotate=0` · `?cam=front|top|fq|bq` (front / top /
front-quarter / back-quarter) · `?diag=1` (writes a watertightness self-check +
face-normal histogram to `document.title`; watertight ⇒ `boundaryEdges:0,
oddEdges:0`).
**2D diagonalizer preview page:** `http://localhost:5173/diag.html`.

---

## Architecture (pure pipeline = no THREE/DOM, Node-testable)

```
src/lib/
  views.js        6 view defs: normals, axes, VIEWS[name].project(x,y,z,dims)->{u,v}
  atlas.js        slice a 3x2 sheet into named tiles; auto tile size
  ingest.js       sprite -> occupancy/color typed arrays; auto-crop; resample; rot/flip
  carve.js        dim reconciliation; visual-hull AND; surface extraction; FACE_KEYS
  colorize.js     depth-aware first-hit per-face voxel coloring + palette snap
  faces.js        surface voxels -> quads (culled or greedy-merged); FACE_GEO export
  pipeline.js     buildVoxels(rawViews,opts) -> {dims,solid,gviews,faceColor,palette,...}
  mesh.js         *** VOXEL MODE ***   voxel result -> merged vertex-colored THREE.Mesh
  wedge-mesh.js   *** LOW-POLY MODE *** voxel solid + additive 45° wedges
  textured-box.js *** BOX MODE ***     fast box-with-decals preview
  sprite-data.js  built-in Cube + Car samples (both as atlases) + grid->ImageData
  vectorize.js    marchingSquares tracer + clipLoopBox + signedArea (used by diagonalize + tests)
  diagonalize.js  45° diagonalizer for the /diag.html preview (per-color region)
  lowpoly.js      sweepSolidGrid/carveGrid — the proven sweep===carve identity (tests only)
src/
  main.js         scene, lights, shadowed ground, camera framing, render loop, state
  ui.js           panel: samples, atlas dropzone, mode + mirror/alpha/greedy/lowpoly toggles
  image-io.js     File/URL -> ImageData
  diag-preview.js /diag.html dev preview of the diagonalizer
tools/
  capture.sh      headless-Chrome screenshot helper (self-cleans; no bare rm)
```

The atlas layout + orientation table are in `README.md`. `gviews` are
co-registered per-view `{occ,rgb,imgW,imgH}` masks (front=x/y, top=x/z,
side=z/y), indexed 1:1 with the voxel grid via `VIEWS.project`.

---

## What works (committed)

- **Voxel mode** (`mesh.js`) — visual-hull voxelization, greedy-meshed, per-face
  colors, real shadows. Solid, shipped.
- **Low-poly mode** (`wedge-mesh.js`) — additive 45° wedges on the voxel model.
  Smooth glass (windshield / rear / side windows), sharp material boundaries
  (roof/window, tyre/body), watertight. Shipped. **This replaced** the earlier
  extrude-intersect `tile-mesh.js` engine, now retired.
- **Box mode** (`textured-box.js`) — instant textured-box preview / fallback.
- **2D diagonalizer** — `diagonalize.js`, validated & Node-tested (`/diag.html`).

---

## The low-poly wedge engine — how it works

**Geometry.** For every EMPTY cell that is a concave unit-step notch (two solid
orthogonal neighbours on adjacent sides, the other two sides empty), fill the
corner with a 45° triangular prism: the hypotenuse is the slope, the two covered
neighbour faces are culled, run ends get gable caps. Additive-only ⇒ can't hole
or melt the object; a cube has no notch ⇒ stays sharp. Half-integer lattice ⇒
`mergeVertices` welds watertight. One wedge per cell, ridge order z,x,y (so a
long extruded ridge wins the tie; true 3-D corners degrade to a step).

**Colour gate (the hard part — see the dead ends below).** A wedge fires only if
its two steps are the same MATERIAL, tested by sampling the **source sprite**,
not the voxel face colours. Per candidate:
1. **PROFILE view** = the view looking along the ridge (windshield→side, etc.).
   It sees the slope's *cross-section* with nothing in front to occlude it, so a
   windshield reads its true colour all the way down. Sample both steps: equal ⇒
   coherent surface ⇒ fill; differ ⇒ skip. (This is what fills the glass — the
   *facing* view is blocked by the hood on the lower steps.)
2. **FACING view + occlusion march** catches a hard material boundary that runs
   *along* the ridge (a roof/window edge) — the profile view reads both sides as
   the white pillar there, so it can't see it. If the two steps differ in the
   facing view AND the lower step isn't occluded, it's a real boundary ⇒ skip.
   **Guard (the "third-face" fix):** this veto also requires the two faces the
   wedge actually *covers* (cA, cB) to differ. The facing view samples each
   step's elevation *pixel*, and the lower step's pixel can belong to a
   *different* lower step (a pink riser under a white cap) — a face the wedge
   never touches. Without the guard, a monochrome staircase crossing a colour
   band in its elevation drops the step at every band edge (white-cap stair kept
   6/9 wedges, pink-band stair 3/9). With it, the count is band-invariant and the
   car is untouched (roof/window still white≠teal ⇒ still sharp). Regression:
   `test/wedge-mesh.test.mjs` "monochrome staircase … regardless of … colour band".
3. Colour the wedge from its **riser face** (the surface's true colour, e.g.
   teal glass; the profile view would give the white pillar).

### Colour-gate dead ends (don't repeat these)
- ❌ **strict same-colour on the two covered faces** (as the *primary* gate) — a
  slope's up-facing tread is coloured by the TOP view (white), so
  riser(teal)≠tread(white) → glass never fills; measured -44 windshield wedges on
  the Car (220→176). It only works as a *guard* on the facing veto (step 2), not
  as the fire condition — the profile view stays primary.
- ❌ **no gate** — fills all glass but bridges tyre↔body and roof↔window (blobs).
- ❌ **facing-view sample of the two steps** — the hood occludes the lower
  windshield steps → they read white → glass steps at the bottom / rear.
- ❌ **walk through the occluder to the lower riser** — the walk marches out of
  the glass into the hood → white.
- ✅ **profile view** (unoccluded cross-section) + facing-view boundary check.

---

## >>> NEXT / remaining <<<

- **Perf** — greedy-merge the low-poly base voxel faces (and coalesce wedge runs).
  Low-poly is ~4.8k tris on the Car vs voxel mode's few hundred, because the base
  faces are emitted per-voxel (culled, not greedy). Biggest easy win.
- **Convex staircases** — additive wedges only smooth *concave* notches; a hood
  sloping down-and-out still steps. Would need subtractive wedges / corner tiles.
- **3-D corner tiles** — where two wedge ridges meet, it currently steps.

### Prototype-first tests worth adding (Node, pure)
- **watertight**: after weld, every undirected edge used by exactly 2 triangles
  (the `?diag=1` check does this in-browser; port a headless version).
- **cube stays sharp**: a solid cube ⇒ zero wedges.
- **45°-only edges**: every emitted non-axis edge direction cosine ∈ {±1/√2}.

---

## Gotchas
- Screenshots: **use `tools/capture.sh`**, never a bare `rm -rf` (permission
  prompt). Stale-mesh after edits ⇒ hard reload (see Run/verify).
- `git` user is `Adam Portilla`; **commit as the user, no Claude attribution**.
- Flat shading wants per-face normals; `mergeVertices` won't over-weld across
  differing normals (fine — no visible seams).
- The diagonalizer keys bevels on "is this corner part of a zigzag" — a wheel
  becomes an **octagon** (correct: a pixel-art round wheel is a staircased circle).
