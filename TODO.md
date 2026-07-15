# sprite-machine — working notes / handoff

Turn a **3×2 pixel-art atlas** of orthographic face views (a car drawn as
`RIGHT FRONT TOP / LEFT BACK BOTTOM`) into a **3D object** in the browser
(Vite + vanilla JS + Three.js). Two render modes exist; a third (**low-poly**)
is the active work.

---

## Run / verify

```bash
npm run dev      # http://localhost:5173  (dev server is usually already running)
npm test         # node --test — pure pipeline tests (no THREE/DOM). 22 passing.
npm run build    # vite build (catches import/syntax errors fast)
```

**Visual verification (the app has an infinite rAF loop, so headless Chrome must
be force-killed or it leaks — this is how you screenshot):**

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --disable-gpu --use-gl=angle --use-angle=swiftshader \
  --hide-scrollbars --window-size=1000,850 --virtual-time-budget=3000 \
  --user-data-dir=/tmp/cr-x --screenshot=/tmp/shot.png \
  "http://localhost:5173/?sample=1&lowpoly=1&rotate=0"
pkill -f "user-data-dir=/tmp/cr-x"; rm -rf /tmp/cr-x   # ALWAYS clean up
```
Then `Read /tmp/shot.png`. `macOS has no \`timeout\`; use the pkill line.`
`--use-angle=swiftshader` makes WebGL work headless (the "ReadPixels" log lines
are harmless).

**Test-only URL params** (`src/main.js`): `?sample=0|1` (0=Cube,1=Car) ·
`?lowpoly=1` · `?flat=1` (low-poly with one flat gray color — isolates geometry
from color) · `?mode=box` · `?rotate=0` · `?cam=front|top`.
**2D diagonalizer preview page:** `http://localhost:5173/diag.html` (raw pixels
vs cleaned 45° polygons per view — great for eyeballing the diagonalizer).

---

## Architecture (pure pipeline = no THREE/DOM, Node-testable)

```
src/lib/
  views.js        6 view defs: normals, axes, VIEWS[name].project(x,y,z,dims)->{u,v}
  atlas.js        slice a 3x2 sheet into named tiles; auto tile size (120x80 -> 40x40)
  ingest.js       sprite -> occupancy/color typed arrays; auto-crop; resample; rot/flip
  carve.js        dim reconciliation; visual-hull AND; surface extraction; FACE_KEYS
  colorize.js     depth-aware first-hit per-face voxel coloring + palette snap
  faces.js        surface voxels -> quads (culled or greedy-merged); FACE_GEO export
  pipeline.js     buildVoxels(rawViews,opts) -> {dims,solid,gviews,faceColor,palette,...}
  mesh.js         voxel result -> merged vertex-colored THREE.Mesh (VOXEL MODE)
  textured-box.js fast box-with-decals preview (BOX MODE)
  sprite-data.js  built-in Cube + Car samples (both as atlases) + grid->ImageData
  vectorize.js    marchingSquares tracer + clipLoopBox (Sutherland-Hodgman) + signedArea
  diagonalize.js  *** 45° diagonalizer *** per-color-region: staircases->45, corners sharp
  lowpoly.js      reconstructPlanes(result)->{xy,xz,zy}; sweepSolidGrid/carveGrid (proven)
  tile-mesh.js    *** LOW-POLY MODE *** extrude-intersect 45° tile engine (single-silhouette)
src/
  main.js         scene, lights, shadowed ground, camera framing, render loop, state
  ui.js           panel: samples, atlas dropzone, mode + mirror/alpha/greedy/lowpoly toggles
  image-io.js     File/URL -> ImageData
  diag-preview.js /diag.html dev preview of the diagonalizer
```

The atlas layout convention + orientation table are in `README.md`. `gviews` are
co-registered grid-frame per-view `{occ,rgb,imgW,imgH}` masks (front=x/y plane,
top=x/z, side=z/y), indexed 1:1 with the voxel grid via `VIEWS.project`.

---

## What works (committed, `git log`)

- **Voxel mode** — visual-hull voxelization, greedy-meshed, per-face colors, real
  shadows. Solid, shipped.
- **Box mode** — instant textured-box preview / fallback.
- **Low-poly mode (geometry)** — `tile-mesh.js`, the **extrude-intersect** engine.
  Clean, symmetric 45° slopes; sharp structural corners; watertight; ~400 tris.
  **This was the breakthrough** after several failed approaches (see below).
- **2D diagonalizer** — `diagonalize.js`, validated & Node-tested. See `/diag.html`.
- **Atlas input**, mirror toggles, per-sample orientation transforms, tests, README.

---

## The low-poly technique — decisions & dead ends (so you don't repeat them)

Goal: **only exact 45° planes** (flat V/H or 45°; the tile set = cube / wedge /
outer-corner / inner-corner). No arbitrary/shallow slopes. Every vertex on the
half-integer lattice → watertight by construction.

Approaches tried (5 design workflows ran; final winner is implemented):

1. ❌ **planar-remesh** (voxel region-grow + PCA + QEF, slope from a blurred
   occupancy gradient) — **MELTED** (bulged flats, spiky wheels). Root cause:
   inferring slopes from the grid; the gradient can't tell a staircase from a
   corner at ~22px. *Deleted.*
2. ❌ **lowpoly-mesh slab-loft** (sweep front polygon clipped by RDP-**smoothed**
   box bounds) — slats/holes. RDP made bounds fractional (arbitrary slopes) and a
   `resampleClosed` hack broke vertex correspondence. *Deleted.*
3. ❌ **marching tetrahedra** on the raw voxel grid — watertight but 3 failures the
   user caught: (a) **asymmetric** (one windshield smooth, mirror stepped — MT's
   6-tet split has a diagonal bias); (b) **ignores color borders** (window edges
   still stepped); (c) **chamfers structural corners** (it bevels *every* convex
   corner). Root cause: MT re-derives bevels from the grid and ignores the 2D
   diagonalizer. *Deleted.*
4. ✅ **extrude-intersect** (`tile-mesh.js`) — the winner (workflow score 9.2).
   The 45° solid = intersection of the three extruded **diagonalized** silhouettes,
   which factorizes (proven `sweepSolidGrid === carveGrid`) into a per-z clip of
   the **diagonalized front polygon** by the **raw ±1** top/side interval bounds.
   Key fixes over #2: front is *diagonalized* (45° in x-y), bounds are *raw
   integer* (step exactly ±1 → loft into exact 45° planes, symmetric), everything
   on the half-integer lattice → `mergeVertices` welds watertight. **No CSG kernel**
   — only 2D `clipLoopBox`.

Why it fixes the MT failures: the 2D diagonalizer is already symmetric, keeps
structural 90°s sharp, and is per-color. Extrude-intersect transports every 2D
guarantee into 3D untouched (a 2D 45° edge → a 3D 45° plane; a sharp 2D corner →
a sharp 3D edge). Nothing re-analyzes the grid.

Design-workflow rationale is captured in the two project memories
(`project-overview`, `visual-verification`) and the workflow transcripts under
`.../subagents/workflows/` if still present.

---

## >>> NEXT TASK: per-color parts (fixes the last issue) <<<

**Current gap:** `tile-mesh.js` uses the **single whole-object silhouette**, so
geometry is clean but the **window color edges are stepped** — the side face is
one flat plane, colored per-triangle by sampling the view, which slats the
glass/body boundary. (`?flat=1` confirms the geometry itself is clean.)

**The fix (workflow-recommended): sweep each palette color as its own PART.**
Each color's silhouette is diagonalized independently, so the glass region gets
its own 45° boundary → clean window edges; wheels become their own part.

### Approach I prototyped (reverted — it was buggy; here's the design + the bugs)

Add `colorMasks(result)` → for each color, `{xy,xz,zy}` masks from the facing
views (`front` for xy, `top` for xz, `right` for zy; use `gviews[view].rgb`).
Then per color: `front = diagonalizeLoop(marchingSquares(m.xy))`, per-z `bounds`
from `m.xz`/`m.zy` (fall back to the **whole-object** interval where the color is
absent from a plane), and run the existing sweep with that color, flat. Merge all
parts into one geometry.

**Bugs hit (fix these):**

1. **Missing-view extrusion (headlights, taillights, grille).** A color present in
   only ONE view (yellow headlights = front only) has empty `xz`/`zy`, so the
   fallback uses the *whole-object* bounds → it extrudes a yellow **bar through the
   entire car depth**. FIX: detect single-plane-only colors and clamp them to a
   **thin slab at the correct face** (e.g. front-only → z ∈ last ~1–2 voxels),
   OR paint them onto the parent part's face instead of making geometry. Multi-view
   colors (body/glass/wheels) are fine — the fallback correctly yields e.g. **4
   wheels** from front(x) × side(z).
2. **Glass protrudes as a slab.** Cyan's front band swept over its z-extent stuck
   out past the body. Investigate: parts must be **disjoint and coplanar** with the
   body (the architect's "both parts terminate on the same diagonalized boundary");
   the glass likely needs its bounds clamped to the body hull, or its front polygon
   is the wide windshield band rather than the greenhouse shape. Debug with a
   single color at a time (comment out others) + `?flat=1` per part.
3. General **alignment/tiling**: verify body(white) and glass(cyan) abut without
   overlap (they're disjoint silhouettes, so should tile) and don't z-fight.

**Alternative if per-color geometry stays messy:** keep the single-silhouette
geometry and **split each flat face polygon along the diagonalized color-region
boundary into coplanar colored sub-faces** (a per-face 2D clip by the color
region projected onto that face). This avoids the missing-view problem entirely
(no depth guessing) and gives clean 45° window seams. Heavier per-face code but
no protrusion/extrusion issues. Consider a **hybrid**: per-color parts for
multi-view structural colors (body/glass/wheels), face-paint for single-view
detail colors.

### Prototype-first tests to add (mirror the existing `sweep===carve` style)
- **symmetry**: build a silhouette with one 45° windshield, mirror it in z,
  assert the two triangle vertex-sets are exact mirror images.
- **45°-only edges**: every emitted edge direction cosine ∈ {0, ±1/√2, ±1}.
- **sharp corner**: a solid cube → output has zero half-integer/bevel vertices.
- **watertight**: after weld, every undirected edge used by exactly 2 triangles.

---

## Gotchas
- Headless Chrome leaks (infinite rAF) — always `pkill` + `rm` the `--user-data-dir`.
- `git` user is `Adam Portilla`; **commit as the user, no Claude attribution/co-author**.
- Flat shading wants per-face normals; `mergeVertices` won't over-weld across
  differing normals (fine — no visible seams; for a strict manifold assert, weld
  position-only).
- The diagonalizer keys bevels on "is this corner part of a zigzag" — a wheel
  becomes an **octagon** (correct: a pixel-art round wheel is a staircased circle).
- `lowpoly.js` still contains `smoothedBounds`/`rdp` — now unused by tile-mesh
  (which uses raw bounds); harmless, could be removed.
