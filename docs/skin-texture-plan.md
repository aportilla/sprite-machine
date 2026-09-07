# Plan: the skin — color as a texture, geometry on occupancy alone

**Status:** implemented 2026-09-07 on `f8412b6`, the day it was planned
(`npm test` 232, `drive.mjs` 81 of 81, typecheck + prettier + build clean;
the Car reads **900 triangles** on the 3D View's strip and in `?diag=1`'s
title, 236 wedges, zero boundary and odd edges, the Cube 12; `?flat=1`
reads 1,092 — the gate-open column of the table below, flat mode opening
the gate; the Car's skin is 64 × 64 with 31 charted rects). Planned and
revised the same day after a review against the tree (the uniform-rect
swatch, the size bound, the golden expectation, the export motive).
**As built, where the code departs from the text below:** (1) **§5B was
wrong about S10.** The drive's erase drag was on the FRONT face, and the
Car draws a BACK: the carve UNIONS a plane's two views, so a FRONT erase
carves nothing (4950 voxels before and after — the check's own "trap 2"
comment knew it) and only recolored the +z faces, which the color-aware
merge turned into a count move and the occupancy merge does not (900 →
900, the first run's one failure). S10 now switches to the LEFT face
first — the Car has no RIGHT, so LEFT alone constrains its plane and the
same drag carves (4950 → 4746 voxels, 900 → 1134 triangles) — and its
check reads "the count moves on a silhouette change"; the caveat sits
beside the probe. (2) `userData.skin.charts` counts the CHARTED rects (31
on the Car), not the aligned list's length. (3) The packer's rule made
concrete: a shelf pack always fits at some height, so the width doubles
while the power-of-two height would exceed it. (4) `bakeSkin` takes no
`opts`; `finishVoxelMesh` takes `{ map }` or, flat, `{ color }` (the
packed `FLAT_COLOR`, decoded as sRGB onto the material's albedo). (5)
Goldens: `atlas-strip` re-blessed — 40 pixels of 850,000 differ, all in
the ring row: one channel by one (the sRGB last bit) and three
yellow/cyan flips on the body/window seam, §5D's prediction to the
letter; `boot-about` re-blessed too, a PRE-EXISTING mismatch (the About
box's date line is HEAD's commit date — Sep 5 in the golden, Sep 7 fresh
— 14 pixels of one digit, nothing of this work). (6) §6 step 5's DevTools
memory watch was not run in this session (headless); the map's dispose is
in `removeMesh`, and the watch is the user's eye.
**Depends on:** nothing outside this repo — no kit change, no new
dependency (three 0.185.1's `DataTexture` is all it needs).

Today every triangle in the model carries its color as a **vertex color**,
and that couples color to geometry twice over: the greedy mesher may only
merge coplanar faces **of the same color**, so a flat painted wall shatters
into one rectangle per color region, and every rectangle boundary then feeds
the T-junction repair, which adds triangles to keep the surface watertight.
Color is doing geometry's job. This plan moves the color into a **texture
— the skin** — one texel per voxel face, packed into charts, sampled
nearest, and lets the mesher merge on **occupancy alone**: a flat wall is
one rectangle, two triangles, whatever is painted on it.

**The numbers, measured on the shipped samples before a line was written**
(a scratch copy of `wedge-mesh.js` whose greedy merge read one color for
every face — the method is in §5A so the next reader can re-measure):

| Sample                                  | Exposed faces | Today (color merge, strict gate) | **Occupancy merge, strict gate (this plan)** | Occupancy merge, gate open |
| --------------------------------------- | ------------- | -------------------------------- | -------------------------------------------- | -------------------------- |
| Car (40³, 4950 voxels, 10 colors)       | 2270          | 1784 tris · 236 wedges           | **900 tris · 236 wedges**                    | 1092 tris · 308 wedges     |
| Cube (8³, 3 colors, one color per face) | 384           | 12 tris                          | **12 tris**                                  | 12 tris                    |

Two conclusions the plan is built on. **The win is about 2×** on a real
sprite (1784 → 900) and comes entirely from the base faces; and **opening
the wedge gate loses** — more wedges mean more gable caps and more split
faces (900 → 1092), so the strict same-material gate stays exactly as it
is, for the author control it already gives (README → Low-poly) and now
for the count too. Every mesh stayed watertight (zero odd edges) in every
regime.

**The count is not the reason, though.** Neither 1784 nor 900 troubles
any engine. What justifies the work is the **shape of the export**: the
default materials in Unity, Godot and Unreal ignore vertex colors — Unity's
Lit shaders need a custom shader, Godot's StandardMaterial3D a "use vertex
color as albedo" toggle, Unreal a material graph node — while a mesh with a
`map` renders in every engine's default material as it lands. Color as a
texture is the ordinary game-asset shape; vertex color is the exception an
importer has to be told about. The parked Export 3D Model… (§3I) is what
this is for; the halved count is the bonus that comes with it.

This document is written to be picked up cold: it names every file, seam,
signature and gate. Read it top to bottom once, then work §6 in order.
Where it cites a line number it is "at the time of writing" — re-find by
the named function; the names are stable.

> **Naming, before anything else.** _Atlas_ is taken twice: the 3×2
> document sheet (`sliceAtlas`, `sm-atlas-view`, `ATLAS_GRID`) and the 3D
> Sprite Atlas (the ring, `«slug»-atlas.zip`). _Sheet_ is the ring's
> rendered strip (`ringSheet`, the sheet channel). _Chart_ is the packed
> rectangle, the standard term, fine to use for the part. The texture as a
> whole is the **skin**: `src/lib/skin.js` (`bakeSkin`), `mesh.userData.skin`,
> `skin.test.mjs`, "the skin texture" in comments. Never `atlas`, never
> `sheet`, never `texture atlas`, in code.

---

## 1. Locked decisions

1. **A chart where the merge crossed a color; a swatch everywhere else.**
   A greedy rectangle (a `w × h` run of exposed faces on one slice) whose
   faces are **not all one color** becomes a `w × h` chart of texels
   holding the faces' `faceColor` values, verbatim, one texel per voxel
   face; the quad's UVs map its corners to the chart's corners. A
   rectangle whose faces **are** all one color — every 1×1, and every
   rectangle the color-aware merge already produced whole — gets no
   chart: its six UVs sit at the **center of its color's swatch texel**
   (decision 5), exactly as a wedge's do. The skin is therefore only the
   rectangles the old mesher had to split, plus the swatch strip — a
   fraction of "every exposed face" — and the 1×1-rect-with-a-gutter case
   cannot arise, since a 1×1 is uniform by definition. The trade: "one
   texel per voxel face" is not an invariant an artist could repaint in an
   image editor, and most triangles carry degenerate UVs — harmless to the
   renderer and to glTF; only tangent generation would care, and this
   model has no normal map. No projection tricks, no reuse of the sprite
   tiles as textures: the sprite views only cover the silhouette, and
   concave or stepped faces get their color from mirror-fill, relaxation
   and the dominant fallback (`colorize.js`), which never appear in any
   view.
2. **Merge on occupancy alone.** `greedyQuads` merges two exposed,
   coplanar, adjacent faces regardless of color. The color-aware merge is
   retired, not kept behind a flag: there is one mesher, as there is one
   render mode (README → Render modes).
3. **The wedge gate stays strict.** `sameMat` on the riser and the tread,
   nothing else consulted — unchanged. A wedge's whole surface is one
   material by construction, so its triangles need no chart: they point at
   that color's **swatch** (decision 5).
4. **Nearest sampling, no mipmaps, replicated gutters.** The skin is
   sampled `NearestFilter` both ways with `generateMipmaps = false`, so a
   texel is a hard pixel exactly as a vertex color was. Each chart is
   padded by **one texel on every side, replicating its edge**, so a
   fragment on a quad's edge that rounds to the neighbouring texel still
   reads its own color — and an engine that imports the exported skin with
   bilinear filtering on (Unity's default) gets no bleed either.
5. **A palette swatch strip.** The skin carries one texel per palette
   color (the build's `palette`, plus any relaxed or dominant color the
   faces actually hold) in a strip of 1×1 charts. Every single-material
   primitive — the wedge slope quads, the gable caps, and every **uniform
   base rectangle** (decision 1) — has all its UVs at the **center** of
   its color's swatch texel. One texel, sampled at its center, needs no
   gutter.
6. **UVs are a function of position, not a vertex attribute carried
   through the repair.** Every vertex of a charted rectangle — including
   the ones `eliminateTJunctions` inserts along its edges — lies on the
   integer lattice on the rectangle's own plane, so its UV is an affine
   read of its position: `u = chart.u0 + (vertex[A] − aLo)`,
   `v = chart.v0 + (vertex[B] − bLo)` in texels. Each triangle carries its
   chart (or its swatch color), and UVs are computed **after** the repair,
   at buffer-emit time. No interpolation, no per-vertex UV plumbing
   through `t-junction.js`, nothing to get wrong on a split edge.
7. **The material is a `map`, not `vertexColors`.**
   `MeshStandardMaterial({ map, flatShading: true, metalness: 0, roughness: 1 })`.
   The `color` attribute goes; `makeVertexColorLinearizer` and its test go
   with it. The skin declares `colorSpace = SRGBColorSpace`, so the GPU
   does the sRGB decode the linearizer used to do on the CPU.
8. **The skin is built from bytes, never through a canvas.** `bakeSkin`
   writes a `Uint8Array` of RGBA straight from the packed `faceColor`
   values and hands it to `THREE.DataTexture`. No 2D canvas, no
   `getImageData`, so a privacy browser's canvas farble (the Helium bug —
   `wedge-mesh.test.mjs`) cannot touch it.
9. **Pure where it can be.** Packing, baking and the UV arithmetic live in
   `src/lib/skin.js` with no THREE, Node-tested; `mesh-util.js` is the
   one place the `DataTexture` is made (`skinTexture`, beside the
   material it feeds). `faces.js` stays pure.
10. **Nothing else moves.** Ingest, carve, colorize and the pipeline's
    return shape are untouched; the rebuilder's contract (`build.setStats`,
    the `onMesh` seam), the stage, the ring renderer and the ring follower
    keep their calls. The one lifecycle change is disposal (§3G).
11. **`?flat=1` survives** as a material without a map in the flat gray
    (§3H). `?diag=1` is untouched — it reads positions and normals only.

---

## 2. How it fits: the seams that already exist

| Need                                             | Exists as                                                                                                     | Where                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| The per-face colors, keyed `idx*6 + f`           | `colorize()` → `faceColor: Map<number, number>` (packed RGBA, palette-snapped) + `palette: number[]`          | `src/lib/colorize.js` L102–221                             |
| The face vocabulary (keys, normals, axes, index) | `FACE_KEYS`, `FACE_NORMAL`, `FACE_INDEX`, `AXIS_INDEX`, `faceKeyOf`                                           | `src/lib/views.js` L43–66                                  |
| A rectangle's tangent axes and corner order      | `FACE_GEO[face]` — `N`, `A`, `B` and `quad(aMin, aMax, bMin, bMax, s)` → four corners CCW from outside        | `src/lib/faces.js` L19–128                                 |
| The greedy merge                                 | `greedyQuads(dims, surfaceMask, faceColor)` — the `cell[j] === c` tests are the color coupling                | `src/lib/faces.js` L172–230 (L205, L213)                   |
| The voxel index behind a tangent (a, b, s)       | `idxFor(face, a, b, s, dims)` (module-private)                                                                | `src/lib/faces.js` L133                                    |
| The wedge scan, the gate, the emit               | `wedgeMesh(result, opts)`: `sameMat`, `wedges[]`, `pushTri` / `pushQuad`, the `tris` list, the buffer flatten | `src/lib/wedge-mesh.js` L50–269                            |
| The lattice-exact repair, carrying a field       | `eliminateTJunctions(tris)` copies `normal` and `color` onto every split triangle                             | `src/lib/t-junction.js` L129–152 (L148)                    |
| The weld                                         | `mergeVertices(geo, 1e-4)` — welds by every attribute, so a `uv` attribute keeps chart seams split            | `src/lib/wedge-mesh.js` L257                               |
| The finish and the material                      | `finishVoxelMesh(geo, { nx, nz, s, userData })` — centers X/Z, makes the `MeshStandardMaterial`               | `src/lib/mesh-util.js` L42–58                              |
| The sRGB contract                                | `makeVertexColorLinearizer` (retires); the renderers' `outputColorSpace = SRGBColorSpace`                     | `mesh-util.js` L16; `stage.js` L38; `ring-renderer.js` L81 |
| The mesh's lifecycle                             | `rebuild()`: `removeMesh()` disposes `geometry` + `material`; `onMesh` hands the mesh out before the dispose  | `src/scene/rebuilder.js` L50–62, L107–122                  |
| The clone that shares the material               | `ring-renderer.js setSubject`: `sub.mesh.clone()` — geometry and material shared, so the map is shared too    | `src/scene/ring-renderer.js` L108–123                      |
| The count the user reads                         | `mesh.userData.triangles` → `build.setStats` → the 3D View's status strip ("900 triangles")                   | `wedge-mesh.js` L265; `sm-status-line.js`                  |
| The watertight oracle                            | `oddEdges(mesh)` — position-keyed, so split UV seams do not count                                             | `test/helpers.mjs` L134                                    |
| The greedy pins                                  | area conservation over the fixtures; the solid cube → 6 quads                                                 | `test/pipeline.test.mjs` L237–264                          |
| The gate pins                                    | the ramp, the farble, the seam, the two staircases                                                            | `test/wedge-mesh.test.mjs`                                 |

---

## 3. Design

### 3A. The picture

```
faceColor (colorize) ──┐
                       ├─► greedyQuads (occupancy) ─► rects {face, s, a, b, w, h, corners, normal}
surfaceMask ───────────┘                                      │
                                                              ▼
                                            bakeSkin(rects, wedges' colors, faceColor, dims)
                                                              │
                              ┌───────────────────────────────┼──────────────────────────┐
                              ▼                               ▼                          ▼
                    skin bytes (Uint8Array RGBA)    a chart per MULTI-COLOR rect   a swatch per color {u, v}
                              │                     {u0, v0} (null on a uniform one)   (uniform rects, wedges, caps)
                              ▼                               │                          │
                       DataTexture (nearest, sRGB)            ▼                          ▼
                                                  tris carry `chart` → UV = f(position)   tris carry `swatch` → its center
                                                  after the repair
```

The skin for the Car is small: of the rectangles the occupancy merge
produces, only the ones spanning a color boundary are charted (decision

1. — the rest and the wedges point at the swatch strip — so a 32×32 or
   64×64 skin. **The bound is the carve's exposed faces, not the grid's
   area**: a sparse sprite can expose far more than six times 64² faces — a
   checkerboard in all three views leaves a quarter of a 64³ grid as isolated
   voxels, about 390 000 exposed faces — but every one of those is a uniform
   1×1 and so a swatch, never a chart. The charted texels are bounded by the
   faces of multi-color rectangles, which cannot exceed the exposed faces
   (padded ×9 at the worst 1×2 shape); today's mesher already emits a
   triangle pair per such face, so nothing here is a new cliff. The packer
   grows without a ceiling (§3B) — a skin past a device's texture limit
   (16384 on desktop, 4096 on some mobile) is a sprite the carve could not
   have rebuilt live either.

### 3B. Pure — `src/lib/skin.js` (new, Node-tested)

```js
/**
 * @typedef {{face:string, s:number, a:number, b:number, w:number, h:number,
 *            normal:number[], corners:number[][]}} Rect      // faces.js's new quad shape
 * @typedef {{u0:number, v0:number, w:number, h:number}} Chart  // texel coords, gutter excluded
 * @typedef {{width:number, height:number, data:Uint8Array,
 *            charts:(Chart|null)[], swatch:Map<number, {u:number, v:number}>}} Skin
 *   charts[i] is rects[i]'s chart, null where the rect is uniform (a swatch)
 */
export function bakeSkin(rects, colors, faceColor, dims, opts = {}) → Skin
export function uvOfLattice(chart, rect, p) → [u, v]     // texel coords for a lattice point p on rect's plane
export function swatchUV(skin, packed) → [u, v]           // the texel CENTER of a color's swatch
```

- **Packing.** A shelf packer: sort the charts by padded height (then
  width) descending, lay shelves left to right, a new shelf when the row
  is full. Width starts at the smallest power of two ≥ the widest padded
  chart (min 16) and the sheet doubles its shorter side until everything
  fits; the final height is rounded up to a power of two. Power-of-two
  sizes are not required by three or by WebGL2, but exporters and older
  engines are happier, and it costs nothing here. **No ceiling**: the
  sheet doubles until the charts fit, whatever that takes (§3A says why
  it never matters in practice). Deterministic: the same input packs
  identically (the goldens depend on it, §5D).
- **Which rects are charted.** A rect is **uniform** when every one of
  its `w × h` face colors equals the first; a uniform rect is not baked
  and gets no chart — the emit gives its triangles the swatch of that
  color (§3E). `bakeSkin` takes every rect, decides, and returns the
  chart list aligned to the rects it charted (`chart: null` on a uniform
  one, so the caller need not re-test).
- **Baking a rect.** For texel `(i, j)` in `0..w × 0..h`, the color is
  `faceColor.get(idxFor(face, a + i, b + j, s, dims) * 6 + FACE_INDEX[face])`.
  `idxFor` moves from `faces.js`'s private scope to an export (or is
  re-implemented in `skin.js` from `FACE_GEO` — one home, prefer the
  export). Write the four bytes at `((v0 + j) * width + (u0 + i)) * 4`,
  RGBA from `unpackRGBA`, alpha 255.
- **Gutters.** After the chart's body, replicate: each edge texel copies
  outward one texel, the four corners fill from the corner texel. The
  chart record excludes the gutter; the packer allots `w + 2` by `h + 2`.
- **Swatches.** One 1×1 chart per distinct color in `colors` — the union of
  `palette` and every value in `faceColor` (relaxation averages and the
  dominant fallback are snapped to the palette, so in practice this is the
  palette; the union is the guard). A swatch has no gutter: nothing ever
  samples off its center.
- **`uvOfLattice(chart, rect, p)`.** With `A = FACE_GEO[rect.face].A` and
  `B = …B`: `u = chart.u0 + (p[AXIS_INDEX[A]] − rect.a)`,
  `v = chart.v0 + (p[AXIS_INDEX[B]] − rect.b)`. Returns texel coordinates;
  the caller divides by the skin's width and height. A rect's corners land
  on the chart's corners exactly; a T-junction vertex lands on the edge
  between two texels, which is what the gutter is for.
- **Orientation.** The texel grid's `i` runs along `A` and `j` along `B`,
  the same axes `FACE_GEO.quad` spans, so no per-face flip table: the
  affine read is the orientation. `DataTexture` defaults to
  `flipY = false`, so texel row 0 is `v = 0` — leave it there; do not set
  `flipY`.

### 3C. `faces.js` — the merge on occupancy, a richer quad

`greedyQuads(dims, surfaceMask)` drops the `faceColor` parameter and the
two `cell[…] === c` tests (L205, L213); `cell` and `c` go, `has` and
`used` stay. The quad record gains the rectangle in tangent coordinates —
`{ face, s, a, b, w, h, normal, corners }` — because the baker and the UV
read need the rect, not just its corners. `culledQuads` follows the same
shape (`w = h = 1`); it has no consumer but the area-conservation test,
which stays. `faceQuads` drops the color parameter too. Export `idxFor`
(rename to `voxelIndexOnFace` if the bare name reads badly outside the
file).

The `color` field on a quad is gone. `pipeline.test.mjs`'s cube pin (6
quads) still holds; the conservation test's `sumArea` reads corners only.

### 3D. `t-junction.js` — carry an opaque attribute

`eliminateTJunctions` copies `normal` and `color` onto every split
triangle (L148). Generalize: copy **every field of the source triangle
except `a`, `b`, `c`** (`{ ...t, a, b, c }`). The existing test "preserves
per-triangle color and normal" keeps passing; add nothing. The JSDoc names
a `color` field today; make the function generic — a `@template T` over
`{a, b, c, normal}` and `T[]` in and out — so `checkJs` carries the
mesher's richer record through rather than narrowing it. The wedge
mesher's triangle record becomes
`{ a, b, c, normal, chart: Chart|null, rect: Rect|null, swatch: number|null }`
— a charted base triangle carries its chart and rect; a uniform base
triangle, a wedge slope and a gable cap carry the packed color for the
swatch lookup.

### 3E. `wedge-mesh.js` — assembly

The scan (L83–138) is untouched: `sameMat`, the gate, `removed`, `wedges`
with their `color`. The emit changes shape:

1. `faceQuads(dims, baseMask)` (no color). Collect the rects into an
   array, bake once (`bakeSkin`), then emit each rect: a charted one as
   `pushQuad(…, normal, { chart, rect })`, a uniform one (its chart
   `null`) as `pushQuad(…, normal, { swatch: c })` with `c` its one color
   — rects → bake → emit, one pass each, the branch a line.
2. Wedge quads and caps: `pushQuad(…, HN, { swatch: wc })`, where `wc` is
   the wedge's color (in flat mode the swatch is irrelevant — §3H).
3. `eliminateTJunctions(tris)`.
4. Flatten: `pos`, `nrm` as today; a new `uv` `Float32Array(n * 6)`. For
   each triangle and vertex: if `t.rect`, the texel pair is
   `uvOfLattice(t.chart, t.rect, vertex)`; else it is
   `swatchUV(skin, t.swatch)`. Divide by the skin's width and height.
   Drop the `col` buffer and `toLin`.
5. `geo.setAttribute('uv', …)`; `mergeVertices(geo, 1e-4)` welds
   position + normal + uv — a lattice vertex shared by two charts stays two
   vertices, which is correct (they sample different texels) and harmless
   to watertightness (position-keyed, §2).
6. The skin → texture (the one THREE line outside `mesh-util`, or inside
   it — put it in `mesh-util.js` as `skinTexture(skin)` so `wedge-mesh.js`
   stays a builder):
   `new THREE.DataTexture(skin.data, skin.width, skin.height, THREE.RGBAFormat)`,
   then `colorSpace = SRGBColorSpace` and `needsUpdate = true`. That is
   all: in three 0.185.1 `DataTexture`'s constructor already sets
   `magFilter = minFilter = NearestFilter`, `generateMipmaps = false`,
   `flipY = false` and `unpackAlignment = 1` — decision 4 is the class's
   default. Restate them explicitly only as documentation, in one comment,
   never as a correction.
7. `finishVoxelMesh(geo, { nx, nz, s, map, userData })` with `userData`
   as today plus `skin: { width, height, charts: skin.charts.length }`.
   The triangle count expression is unchanged (`geo.index.count / 3`).

`FLAT_COLOR` stays for flat mode (§3H). The header comment's "PER-COLOR
for free" paragraph is rewritten: the wedge is per-material because of the
gate, and the base faces are no longer per-color at all.

### 3F. `mesh-util.js` — the material

`finishVoxelMesh` takes `map` and builds
`MeshStandardMaterial({ map, flatShading: true, metalness: 0, roughness: 1 })`;
with `map` null (flat mode) it builds the same material with `color` set
to `FLAT_COLOR`'s RGB and no map.
`makeVertexColorLinearizer` is deleted; its import in `wedge-mesh.js` and
its test in `wedge-mesh.test.mjs` (L197–214) go with it. `skinTexture(skin)`
lives here (§3E step 6). The file's header comment is rewritten (the
"vertex-colored" phrasing is wrong after this).

### 3G. Lifecycle — `rebuilder.js`, the ring

`removeMesh()` (L56–59) disposes `geometry` and `material`; add
`o.material?.map?.dispose?.()` before the material. The ring renderer's
clone shares the material and thus the map; THREE's dispose event releases
the renderer-side copy for both contexts, as it does the geometry today
(`ring-renderer.js` header). `onMesh` is called before the dispose, as
today. Nothing in `scene/ring.js` changes. The `build` slice and
`setStats` are unchanged: the status strip reads 900 for the Car on its
own.

### 3H. `?flat=1` and `?diag=1`

Flat mode today overrides every color with `FLAT_COLOR` and opens the
gate. Keep both: `flat` skips `bakeSkin` (no skin, `map: null`, the
material's `color` is the flat gray), the UVs are all zero (the attribute
still exists so the geometry's shape is one), and the gate stays open as
it is. `?diag=1` reads positions and normals — untouched. `main.js`
passes `flat` and `diag` as before.

### 3I. Export readiness (not in scope, designed for)

A `MeshStandardMaterial` with a `map` is exactly what `GLTFExporter`
serializes: the skin becomes an embedded PNG, the sampler
`NEAREST`/`NEAREST`, the UVs the geometry's `uv` attribute. The parked
Export 3D Model… dialog (`index.html` L560–599, `menus.js` L131) needs no
change now; when it goes live it exports the mesh as is. The skin's
`DataTexture` has no `image.src`, so the exporter will draw it through a
canvas to encode — that path is the exporter's, on export only, never on
the live model (decision 8 holds for what the app renders).

---

## 4. File-by-file changes

| File                              | Change                                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/skin.js` (new)           | `bakeSkin`, `uvOfLattice`, `swatchUV`, the shelf packer, the gutter replication — pure, no THREE                                                               |
| `src/lib/faces.js`                | `greedyQuads(dims, surfaceMask)` on occupancy; the quad record `{face, s, a, b, w, h, normal, corners}`; `culledQuads` and `faceQuads` follow; export `idxFor` |
| `src/lib/t-junction.js`           | split triangles copy every field but `a`/`b`/`c`                                                                                                               |
| `src/lib/wedge-mesh.js`           | rects → bake → emit; triangles carry `chart`/`rect` or `swatch`; the `uv` buffer; no `color` buffer, no linearizer; the header comment                         |
| `src/lib/mesh-util.js`            | `finishVoxelMesh({ map })`; `skinTexture(skin)`; delete `makeVertexColorLinearizer`; the header comment                                                        |
| `src/scene/rebuilder.js`          | dispose the map                                                                                                                                                |
| `test/skin.test.mjs` (new)        | §5A                                                                                                                                                            |
| `test/pipeline.test.mjs`          | the greedy tests read the new quad shape; add the two-color wall → one quad pin                                                                                |
| `test/wedge-mesh.test.mjs`        | drop the linearizer test; add the skin round-trip on the ramp; the watertight and gate tests stay verbatim                                                     |
| `test/t-junction.test.mjs`        | unchanged (the color-carry test now proves the generic carry)                                                                                                  |
| `README.md`, `docs/SMOKE-TEST.md` | §7                                                                                                                                                             |

Untouched: `pipeline.js`, `colorize.js`, `carve.js`, `ingest.js`,
`views.js`, `diag.js`, `stage.js`, `ring-renderer.js`, `scene/ring.js`,
`state/build.js`, `sm-status-line.js`, `main.js`, `index.html`, every
shell module, the drive.

---

## 5. Verification

### 5A. Node (`npm test`)

`test/skin.test.mjs` — the pure module, five or six cases, each a
mechanism:

- **The round-trip.** Build a two-color fixture (a wall painted in two
  colors over a full side and top, the `pipeline.test.mjs` pin below, so
  the merge produces at least one charted rect), run `buildVoxels`,
  `greedyQuads`, `bakeSkin`; for every **charted** rect and every `(i, j)`
  in it, the skin's texel at `(u0 + i, v0 + j)` equals `faceColor` at
  that face — and, read the other way, every exposed face of a charted
  rect is covered by exactly one texel. This is the one test that proves
  the skin says what the faces say.
- **Uniform rects are swatches.** Every rect whose faces are one color
  comes back with `chart: null`, and every rect with two or more colors
  with a chart; on the solid cube fixture the chart list is all null and
  the skin is the swatch strip alone.
- **The gutter.** Every chart's ring of padding texels equals the
  adjacent body texel (edges) or the corner texel (corners), and no two
  padded charts overlap (a coverage map over the sheet counts each texel
  at most once).
- **The swatches.** Every color in the union has a swatch, `swatchUV`
  returns its center (`x + 0.5, y + 0.5`), and a swatch texel holds its
  color.
- **Determinism and size.** The same input bakes byte-identical twice;
  the sheet is power-of-two on both axes; a single 1×1 rect packs into the
  minimum sheet.
- **`uvOfLattice`.** A rect's four corners map to the chart's four corners
  (through `FACE_GEO[face].quad`'s own corner order — the test derives the
  expectation from the corners' coordinates, never from a hand-written
  table); a lattice point in the interior of an edge maps between them.

`test/pipeline.test.mjs`: **a two-color wall merges to one quad** — a
4×4 front face painted in two colors (`img(['RRRR','RRRR','BBBB','BBBB'])`
over a full side and top) yields one `pz` rect of `w = 4, h = 4` from
`greedyQuads`, where the color-aware merge gave two. The cube-to-6 pin
and the conservation test stay.

`test/wedge-mesh.test.mjs`: the watertight, farble, seam and staircase
tests stay **verbatim** — their assertions are position-keyed and
count-keyed. Add one: **the mesh's uv attribute exists, every UV lies in
[0, 1], and the ramp's wedge triangles all sample one texel** (their six
UVs equal per triangle — the swatch path, which the ramp's uniform base
rects take too). Delete the linearizer test.

**Re-measuring the numbers.** The table at the top came from a scratch
copy of `wedge-mesh.js` whose `faceQuads(dims, baseMask, faceColor, true)`
call was given `{ get: () => 0xff808080 }` in place of `faceColor` (one
color for every face → the occupancy merge, the gate untouched),
run over the Car (its PNG decoded by a forty-line zlib reader — this
machine has no PNG decoder in Node) and the Cube's generator rows. After
the build the real thing measures itself: the 3D View's status strip
reads the count, and `?sample=car` should read **900 triangles** (the
Cube 12). If it reads more, the merge is still color-aware somewhere; if
it reads less, the gate opened.

### 5B. `tools/drive.mjs`

**No new check.** The drive already reads the count off the strip
(`tris`), waits on it for readiness, and asserts it moves on an erase
(S10). The count changing from 1784 to 900 on the Car boot changes no
assertion (they are `> 0` / `> 100` / "moved"). The full run must stay
green — 81 checks at the time of writing.

**One caveat to write beside the probe.** After this change the count is
**insensitive to a recolor**: the merge no longer sees color, so a paint
stroke that leaves the silhouette alone rebuilds the mesh with the same
triangle count (only the skin changed). S10's "moved" wait is on an
**erase drag** across the body — a silhouette change — so it holds. No
future drive wait may key on the count after a paint stroke; the skin's
`userData.skin` (or the build's stats generation, if one is ever added)
is the readiness signal for a recolor.

### 5C. `docs/SMOKE-TEST.md` — the eye

One item: **the Car looks the same.** Boot `?sample=car`, orbit it; every
color sits where it did, edges are hard (no bilinear smear at a chart
edge, no seam of the neighbouring color along a rectangle boundary — the
gutter's job), the wedges are the body's color, the shadow is unchanged.
Then the 3D Sprite Atlas at the default four views: identical frames to
the eye. Then a stroke: the color lands on the model at once (the skin
rebakes per rebuild).

### 5D. Captures and goldens

The goldens hide the 3D View, but the two `?ring` captures render the
model. Two things move under the pixels. The sRGB decode moves from the
CPU (`THREE.Color.setRGB` with `SRGBColorSpace`) to the GPU's texture
sampler — both the standard transfer function, but the last bit may
differ, a ±1 anywhere on the model. And **the "which color is this
fragment" decision moves** from the rasterizer (which of two triangles
owns a fragment center — an exact fixed-point edge test) to the sampler
(the floor of an interpolated UV inside one charted rect): a fragment
center within float epsilon of a lattice line between two colors can go
the other way, so expect a handful of **isolated pixel flips exactly on
color boundaries inside a merged rect** — never off one. Both are
deterministic run to run (the goldens stay `cmp`-stable once re-blessed).
Run the goldens check (`tools/goldens.sh check`) **before** touching
anything and again after; diff the ring goldens by eye and re-bless them
in the commit that ships this (README → `goldens.sh`: a golden changes
only in a commit that changed the look on purpose, after an eye on the
diff). The bug is anything larger: a smear along a chart edge, a face
whose colors shifted or mirrored, a wrong swatch.

### 5E. The standing gates

`npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, the
drive against a fresh dev server (a server already up on 5173 may be
serving something else), and `tools/goldens.sh check`:

```bash
npm run dev -- --port 5174 --strictPort
node tools/drive.mjs 5174
```

---

## 6. Implementation order (the app runs at every step)

1. **`faces.js` first, alone.** The occupancy merge and the new quad
   shape, `pipeline.test.mjs` updated, the two-color-wall pin added.
   Trim `wedge-mesh.js`'s call to the new signature in the same step
   (`faceQuads(dims, baseMask, true)` — an extra argument is harmless to
   JS but `checkJs` flags it) and, since `qd.color` no longer exists,
   give it the rect's origin color by reading `faceColor` at the rect's
   first face (`faceColor.get(idxFor(...) * 6 + f)`): the model renders
   with every merged rectangle in its first face's color — **visibly
   wrong on the Car, and the count already reads 900**. That is the
   checkpoint: the geometry is done and correct, only the paint is
   missing. `npm test`, `npm run typecheck`.
2. **`t-junction.js`** — the generic field carry. Its test is green
   before and after.
3. **`skin.js` + `skin.test.mjs`.** Pure; pass before the mesher touches
   it.
4. **`wedge-mesh.js` + `mesh-util.js`** — bake, the `uv` buffer, the
   texture, the material; the linearizer deleted. The Car looks right
   again. Typecheck (the JSDoc typedefs for `Rect` / `Chart` / `Skin`).
5. **`rebuilder.js`** — the map's dispose. Draw a few hundred strokes on
   the Car with the 3D Sprite Atlas shown and watch memory in DevTools
   stay flat (a leaked `DataTexture` per stroke would climb).
6. **`?flat=1`** by eye; `?diag=1` reports zero boundary edges on the Car.
7. **Goldens** (§5D), **the drive** (§5B), **the smoke items** (§5C).
8. **Docs** (§7), prettier, the full gate list, commit.

---

## 7. The doc ritual (this repo documents as it ships)

- **README** — **The technique → 6. Mesh**: greedy-meshed on occupancy,
  color as the skin (a chart where a rectangle crosses a color, a swatch
  where it does not, nearest, gutters, the swatch strip),
  `MeshStandardMaterial({ map, flatShading })`, the Car's count
  (1784 → 900) as the illustration in place of the cube's 768 → 12;
  **Render modes** and **Low-poly**: the gate paragraph gains its second
  reason (opening it costs triangles — the measured 1092);
  **Architecture** — the test list (`skin`), the listings (`skin.js`
  new; `faces.js`, `mesh-util.js`, `wedge-mesh.js` re-described; the
  "vertex-color linearizer" phrase gone); **Known limitations → Perf** and
  **→ Export**: the mesh carries its texture, `GLTFExporter` embeds it
  (the sentence that says the merged mesh is glTF-ready gains "with its
  skin"), **and the why** — the engines' default materials ignore vertex
  colors, a `map` lands everywhere (the intro's paragraph, in a sentence).
- **SMOKE-TEST** — the §5C item.
- **Header comments** — `faces.js`, `wedge-mesh.js`, `mesh-util.js`,
  `t-junction.js` (the carry), `rebuilder.js` (the map's dispose),
  `skin.js` (new). This codebase's comments are load-bearing; the
  `wedge-mesh.js` header's "PER-COLOR for free" paragraph must be
  rewritten, not left.
- **This document** — a **Status** line at the top in the house style:
  implemented on which date, the as-built departures from the text
  numbered, the counts the gates reported.
- **Commit message** — the repo's long-form style: what shipped, why
  (the coupling, the two measured numbers, the gate kept and why), what
  the gates said. No check counts.

---

## 8. Follow-ups (out of scope here; the model is ready for them)

- **Merge wedge runs along the ridge.** A wedge is one prism per notch
  cell today (one quad + caps each, `wedges` = 236 on the Car); adjacent
  wedges on the same ridge with the same `(R, sA, sB)` and material could
  be one prism with caps only at the run's ends — the cap logic
  (`capNeeded`) already knows a run's continuation. With the skin in
  place a merged wedge's UVs are still its swatch. Probably the next
  2× on a wedge-heavy sprite; measure first.
- **Export 3D Model…** goes live on this: `GLTFExporter` with the
  skin embedded, `NEAREST` samplers, `.glb` default (the dialog's parked
  form already says so), the scale field as units per voxel. The skin
  could also be offered beside the model as a PNG for engines that want
  it separately.
- **A skin in the 3D Sprite Atlas export?** No — the ring export is
  pre-rendered pixels; the skin is the model's, not the sprite's.
- **Bigger tiles.** The 64 ceiling is the carve's, not the mesher's;
  the skin's size scales with exposed faces, not the grid, so it does
  not move the ceiling either way.

---

## 9. Decisions to confirm (defaults chosen; change only if you disagree)

- **A. Gutter width 1 texel, replicated.** One guards a bilinear
  importer at the base level (Unity's default filter). Gutter width is
  **not** the lever for a mipmapped importer — a 3×3 padded chart is a
  blend by the second mip level whatever the gutter — so the future
  exporter writes `NEAREST` samplers (glTF's, which Unity's importer reads
  as point filtering) and that is the guard. Default 1.
- **B. Power-of-two skin.** Not required by three or WebGL2; kept for
  exporters and older engines. Default on.
- **C. Swatches for wedges, not charts.** A wedge's slope could carry a
  1×len chart of its ridge's tread colors instead, which would let a
  future looser gate paint a two-color wedge. With the gate strict the
  swatch is exact and cheaper. Default swatches; revisit only with the
  gate.
- **F. Swatches for uniform base rects** (decision 1). The alternative —
  every rect a chart, "one texel per voxel face" as a repaintable
  invariant — is one rule instead of a branch, at the cost of a skin
  sized by every exposed face (×9 for the 1×1s) for a property nothing
  planned uses. Default swatches; charting every rect is a
  `bakeSkin` option away if a repaintable skin is ever wanted.
- **D. `idxFor` exported from `faces.js`** rather than duplicated in
  `skin.js`. One home. Default export.
- **E. The `uv` attribute on flat mode** — present and zero (one geometry
  shape for the diag and any future exporter) rather than absent. Default
  present.

---

## 10. Risks and gotchas

- **Orientation is the one place to get wrong.** The chart's `(i, j)`
  runs along `FACE_GEO[face].A` and `B`; the UV read is an affine of the
  vertex position on those axes; nothing else states a direction. Write
  `uvOfLattice` first, test it against `FACE_GEO.quad`'s corners for all
  six faces (§5A, derived from the corners' coordinates), and never add a
  per-face flip table — a table is where a drift would hide. If a face
  renders mirrored, the bug is in the corner-to-UV mapping, not the bake.
- **`mergeVertices` and UVs.** The weld keys on every attribute, so a
  vertex shared by two charts stays two vertices. That is correct. If the
  triangle count in `userData` moves unexpectedly after adding `uv`,
  check the index count expression — it reads `geo.index.count / 3`,
  which counts triangles, not vertices, so it should not move at all.
- **The sRGB last bit, and the boundary flip.** §5D. Compare a ring
  capture before and after by `cmp`; expect a difference — ±1 anywhere,
  the odd pixel on a color boundary inside a charted rect; look at it.
- **`DataTexture` and `flipY`.** Leave `flipY` at its `DataTexture`
  default (`false` — the constructor's, along with nearest filtering and
  no mipmaps, §3E step 6). Setting it to match an image-backed texture
  would flip every chart.
- **Disposal.** A map is not disposed with its material; the rebuilder
  must dispose it explicitly (§3G). The ring's clone shares the map; the
  dispose event covers the second renderer. Watch memory in step 5.
- **The drive's readiness.** `APP_READY` waits for digits on the status
  strip; nothing here changes when the count lands (the same
  `build.setStats` call, the same frame).
- **The farble.** The skin is built from `faceColor`'s bytes; the gate is
  built from the same map. The farble test in `wedge-mesh.test.mjs` keeps
  passing because nothing here reads a canvas. Keep it that way: no
  canvas in `skin.js`, ever.
- **Typecheck.** `tsc` under `checkJs` will want the new quad shape in
  `faceQuads`'s consumers; the JSDoc typedefs in `skin.js` are the place
  to state it once. `eliminateTJunctions` goes generic (§3D) so the
  triangle record's `chart` / `rect` / `swatch` survive the repair in the
  types as well as at runtime.
- **The count no longer moves on a recolor.** §5B. A paint stroke that
  keeps the silhouette leaves the triangle count alone; nothing in the
  app or the drive may read "the count moved" as "the stroke landed".
