# Plan: a pure core

**Status:** built 2026-09-12, every step landed, the decisions in §6 made as
recommended, the gates green, the car's glb byte for byte what it was; the
3D View, the 3D Sprite Atlas, the document icons and the export await the
user's eye. The ask: _"our published npm package has three js as a peer dependency... because
we expose an api to directly create three js models. i wonder though - whether
three can import glTF models and use those, allowing the package to be more
pure? thoughts?"_, then _"yes, let's do that"_ to the recommendation below.

The short version: the engine's real output is a set of typed arrays and a
skin bitmap. Three is used in three places inside the mesher, each a thin
call: earcut through `ShapeUtils`, a vertex weld from the addons, and the
final `BufferGeometry` / `DataTexture` / `Mesh` assembly. The glb writer is
already three-free. So the root entry drops three entirely: `wedgeMesh` and
`buildModel` return a plain record, `modelToGlb` reads it, and a new
`sprite-machine/three` entry turns the record into a `THREE.Mesh` for a page
that wants one. Three becomes an optional peer with a loose floor. Any other
engine, and a three page that prefers it, loads the glb.

## 1. The model we copy

No System 7 model; this is engine work. The shape copied is three's own split
of a core from its addons, and the package's existing `/node` entry: one pure
root that takes pixels and returns data, and format adapters at subpaths that
carry their own dependencies. glTF is the door for everyone else, and
`GLTFLoader` reads what `modelToGlb` writes: the NEAREST sampler, the sRGB
base color texture, the unlit extension, the node name.

## 2. The design

### 2.1 The record

`wedgeMesh(result, opts)` returns a `Built`:

```text
{ geometry: { position: Float32Array,   xyz per vertex, centered on X and Z
              normal:   Float32Array,   unit length, one per vertex
              uv:       Float32Array,   [0, 1] pairs, zero in flat mode
              index:    Uint32Array,    CCW triples
              bounds:   { min: [x, y, z], max: [x, y, z] } },
  skin:  Skin | null,                                   the bake's: sRGB RGBA, row 0 is v = 0
  color: number | null,                                 packed RGBA when skin is null
  triangles, wedges, slopes, charts }                   the counts userData carries today
```

`buildModel(sheet, opts)` returns a `Model`, the `Built` plus `dims`,
`unitsPerVoxel` and `warnings`. Its `triangles` is the record's, not a copy.
`skin` is the bake's `Skin` itself, which already carries the bytes and the
charts, with the chart count beside it. `modelToGlb(model, opts)` reads
`model.geometry`, `model.skin` and `model.color`, and `computeDiag` takes a
`geometry`. The positions are scaled as today: one unit per voxel from
`buildModel`, `worldSize` over the longest side from `wedgeMesh`'s option.
The centering and the bounds move from `finishVoxelMesh` into the mesher's
assembly step, on the arrays, after the weld as today.

A flat color reaches the glb as a linear base color factor. Three converted
it when the material's color was set; `modelToGlb` now applies the sRGB
transfer itself. Only the app's `?flat` export takes this path, since
`buildModel` never builds flat.

`index` is always `Uint32Array`; the glb writer already narrows to sixteen
bits when the count allows, and the three adapter passes it through.

### 2.2 Triangulation

The `earcut` package replaces `THREE.ShapeUtils.triangulateShape`. Three
0.185 vendors mapbox/earcut 3.0.2. The package's latest is 3.2.3, whose ear
loop no longer skips a vertex after each cut and whose filter and cure passes
were restructured, so its diagonals differ. The dependency is pinned to
3.0.2 exactly, and the swap is a flatten: each loop's `[a, b]` pairs into one
array, the hole start offsets into a second, and the flat index triples back
into faces. `ShapeUtils` also strips a repeated closing vertex,
which `Loop` never carries, so the indices line up with
`[outer, ...holes].flat()` as they do now. A polygon's triangle count does
not depend on the diagonals chosen, and the mesher's area check catches a bad
triangulation, so the existing counts hold.

### 2.3 The weld

`weldVertices(position, normal, uv)` in a new `weld.js` replaces
`mergeVertices`. It indexes the flat Float32 triangle buffers: a vertex's key
is its eight components, each scaled by ten thousand, offset by a half and
truncated, which is the rule three's weld applies at its default tolerance.
Vertices keep first-seen order. So the welded buffers, and the glb bytes,
come out as they do today. Every input is lattice-exact, so no vertex is
near a key boundary.

### 2.4 The three adapter

`packages/core/src/three.js`, published as `sprite-machine/three`:

```js
import { toMesh, toGeometry, skinTexture } from 'sprite-machine/three';

const mesh = toMesh(model); // a THREE.Mesh, as buildModel returned today
const geo = toGeometry(model.geometry); // a BufferGeometry with its bounds computed
const map = skinTexture(model.skin); // a DataTexture, nearest, sRGB, flipY false
```

`toMesh` builds what `finishVoxelMesh` builds now: a flat-shaded
`MeshStandardMaterial` with metalness 0 and roughness 1, the skin as its
`map` or the packed color as its `color`, shadows on. `toGeometry` and
`skinTexture` are the pieces for a caller with its own material. The adapter
touches only core classes, no addons; the newest thing it uses is the
color-space API, so the peer floor is `>=0.152.0`, marked optional in
`peerDependenciesMeta`. The barrel never imports it, and `sideEffects:
false` holds, so a bundle that never imports the entry never sees three.

The package typechecks as it does now: three ships no types and none are
installed, so the import resolves untyped as it does in `wedge-mesh.js`
today, and the root entry loses every `import('three')` in its JSDoc.

### 2.5 The app

The app imports the adapter by its published name, as it imports `/node`'s
sibling today, so the rule in `CLAUDE.md` reads "through its published
entries" instead of "through its barrel".

- **The rebuilder** calls `wedgeMesh`, then `toMesh` on the result, and
  reads `triangles` from the record. `?diag` passes `built.geometry`. The
  `onMesh` payload gains `model`, the record, beside `mesh` and `dims`.
- **The model export** keeps the record: `stats()` reads `triangles`, `skin`
  and `geometry.bounds`, and `exportGlb` passes the record with `dims` and
  `unitsPerVoxel` to `modelToGlb`.
- **The icon renderer** calls `buildModel`, then `toMesh`, and fits on
  `model.geometry.position`.
- The stage, the ring renderer and the ring follower take the `THREE.Mesh`
  as today and need nothing.

### 2.6 The words

The engine README's install line drops three, its API section shows the two
routes for a three page, `toMesh` and `GLTFLoader` on the glb, and states
that every other engine loads the glb. The root README's engine paragraph
follows. The package description drops "three.js mesh or".

## 3. Steps, each landing green

1. **Earcut and the weld.** The `earcut` dependency at 3.0.2 exactly,
   `weld.js` with its test, and `wedge-mesh.js` triangulating and welding
   through them, its header following, still returning the `THREE.Mesh`. A
   car built by the CLI before and after the step compares byte for byte.
2. **The record and the adapter.** `wedgeMesh` returns the `Built`,
   `buildModel` the `Model`, `modelToGlb` and `computeDiag` read them,
   `modelToGlb` converts a flat color to linear, `mesh-util.js` goes,
   `three.js` and the `./three` export arrive, the peer loosens and turns
   optional, `skinTexture` and `finishVoxelMesh` leave the barrel,
   `weldVertices` joins it. The tests and helpers follow the shape, the
   app's three readers switch in the same step, and the comment in
   `src/lib/ring.js` that names `finishVoxelMesh` follows, so every gate
   stays green.
3. **The words.** Both READMEs, the engine paragraph and the repo layout
   line in the root's, the description, the `CLAUDE.md` line, this plan's
   status line.

The engine releases as a minor: the return of `wedgeMesh` and `buildModel`
changes shape and two exports leave the barrel. The app has no visible
change and stays unbumped.

## 4. Kit asks

None.

## 5. Tests

By `docs/TESTING.md`.

- `weldVertices` is new pure logic in the published package, so it gets a
  contract test: equal vertices merge, vertices that differ only in normal or
  only in uv stay split, the output keeps first-seen order, the index
  references the merged vertices, and the triangle count is unchanged.
- The adapter is wiring over three's classes with no rules of its own, so it
  gets no test. The 3D View, the 3D Sprite Atlas, the icon and the export are
  verified by eye.
- Existing tests follow the shape: `userData.wedges` and its siblings become
  the record's counts, `geometry.boundingBox` becomes `geometry.bounds`,
  `material.map.image` becomes `skin`, `oddEdges` and `triUVs` take a
  `geometry`, and the diag stub is a `geometry`.

## 6. Decisions

1. **The record's shape.** `geometry` (the arrays and bounds), `skin`,
   `color` and the counts, flat; `buildModel` adds `dims`, `unitsPerVoxel`
   and `warnings`. Recommended: `toMesh(model)`, `modelToGlb(model)` and
   `computeDiag(model.geometry)` each read the part they need, and no name
   collides with three's `Mesh`. The alternative keeps `model.mesh` as the
   field name with the record inside it. Decided 2026-09-12: as recommended.
2. **Where the adapter lives.** `sprite-machine/three`, three an optional
   peer. Recommended: it costs nothing when unused and the one-import
   convenience stays. The alternatives are to drop it from the package, with
   the app carrying its own in `src/scene` and the README showing the ten
   lines; or to keep three required with the adapter in the barrel, which is
   the shape being retired. Decided 2026-09-12: as recommended.
3. **The peer floor.** `>=0.152.0`, the release that introduced the
   color-space API the adapter uses. Recommended: the adapter uses no addons,
   so a three release never needs an engine bump. The alternative keeps the
   caret on the app's minor, which admits one three minor at a time. Decided
   2026-09-12: as recommended.
4. **Earcut's source.** The `earcut` package as a dependency (ISC, no
   dependencies, ESM), pinned to 3.0.2, the version three vendors.
   Recommended: the license and the updates live in its package, and the pin
   keeps step 1's byte-for-byte check meaningful. The alternative vendors
   three's copy under `src/lib/` with its license header. Decided
   2026-09-12: as recommended.
5. **The material.** `toMesh` builds today's material and `toGeometry` and
   `skinTexture` are exported for a caller with its own. Recommended: the
   default matches what the package returns now, and a custom material needs
   the texture anyway. The alternative gives `toMesh` a `material` option.
   Decided 2026-09-12: as recommended.

## 7. Follow-ups

- Bump `earcut` to 3.2.x as its own change, verified by the mesher's area
  check, the watertight tests and an eyeball, since the diagonals move.
- Mesh at one unit per voxel always and scale the `Object3D` in the app, so
  `worldSize` and `unitsPerVoxel` go.
- A glTF round-trip test in the engine's suite, reading the written glb back
  through `glbParts` into a `geometry`, if a reader ever lands.

## 8. Files touched

| File                               | What                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `packages/core/src/weld.js`        | new: `weldVertices`                                                                                   |
| `packages/core/src/three.js`       | new: `toMesh`, `toGeometry`, `skinTexture`                                                            |
| `packages/core/src/wedge-mesh.js`  | earcut, the weld, the centering and bounds, the `Built` record, the header                            |
| `packages/core/src/mesh-util.js`   | deleted                                                                                               |
| `packages/core/src/model.js`       | the `Model` typedef, `buildModel` spreads the record, `modelToGlb` reads it and converts a flat color |
| `packages/core/src/diag.js`        | takes a `geometry`                                                                                    |
| `packages/core/src/index.js`       | `skinTexture` and `finishVoxelMesh` out, `weldVertices` in                                            |
| `packages/core/package.json`       | the `./three` export, the peer range and `peerDependenciesMeta`, `earcut` at 3.0.2, the description   |
| `package-lock.json`                | `earcut`                                                                                              |
| `packages/core/test/weld.test.mjs` | new: the contract in §5                                                                               |
| `packages/core/test/*`             | `helpers.mjs`, `wedge-mesh`, `gltf`, `model` and `diag` follow the shape                              |
| `packages/core/README.md`          | the install line, the two routes, the glb for every other engine                                      |
| `src/scene/rebuilder.js`           | `toMesh`, the counts from the record, the `onMesh` payload                                            |
| `src/scene/model-export.js`        | reads the record                                                                                      |
| `src/scene/icon-renderer.js`       | `toMesh`, the fit on the record                                                                       |
| `src/lib/ring.js`                  | the comment that names `finishVoxelMesh`                                                              |
| `README.md`                        | the engine paragraph, the repo layout line                                                            |
| `CLAUDE.md`                        | "through its published entries"                                                                       |
