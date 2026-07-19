# TODO — sprite-machine cleanup & improvement hit-list

> 🗄️ **ARCHIVED HISTORICAL REVIEW — do not action from this file.** This was an
> earlier sweep, since **superseded by `hit-list.md`** (which reflects the current
> tree). Most items here are done or obsolete: every reference to a **deleted file**
> (`textured-box.js` / box mode, and the vectorize → lowpoly → diagonalize →
> diag-preview chain) is **N/A (file removed)**; the Tier 4 `mesh-util` extraction,
> Tier 7 CI / tsconfig / prettier / editorconfig, and the Tier 3 README fixes are
> all **applied**. The one genuinely-open item is a **LICENSE file + package.json
> license field** (still absent — needs an owner's license choice). The banners
> below are kept verbatim as history.

> **✅ Executed** on branch `cleanup/todo-sweep`. All tiers applied. Gates:
> `npm test` 22 pass (7 added by this work), `npm run typecheck` clean,
> `npm run build` OK, and voxel / low-poly / box modes screenshot-verified.
>
> **Two honest deviations from the plan:**
>
> - **Tier 5 — greedy low-poly base faces:** _not_ applied. A regression test
>   proved greedy-merging base faces leaves T-junctions at wedge seams and
>   **breaks the watertight weld** low-poly advertises (`?diag=1` boundaryEdges
>   went non-zero). Kept per-voxel, documented the trade-off, and added a
>   permanent **watertightness regression test** — the item's explicit
>   "at minimum" completion, now backed by proof.
> - **Bonus (not in the list):** verification uncovered a **pre-existing box-mode
>   crash** — `texturedBoxMesh` called `putImageData()` on atlas-sliced tiles
>   (plain objects, not `ImageData`), so box mode threw for any sliced atlas.
>   Fixed. Also: `LICENSE` skipped and Prettier left config-only, per your calls.

> **⚠️ Partially superseded (2026-07-16).** A later UI/pipeline refactor removed
> **box mode** (`textured-box.js` deleted), the **alpha-threshold** option
> (sprites are now hard pixels — solid at `alpha >= 128`), and the **per-axis
> mirror toggles** (mirror-fill is now always on for all three axes). Any item
> below that references `texturedBoxMesh` / box mode, `alphaThreshold` /
> `DEFAULT_ALPHA_THRESHOLD`, or the old `{x:true,y:false,z:false}` mirror default
> is obsolete — kept for history, not action.

Prioritized backlog from a codebase review of `src/`, `test/`, docs, and tooling.
Each item is tagged **severity** (impact) / **effort** (S ≤30 min, M ≈½ day, L ≥1 day)
and cites `file:line`. Findings were cross-checked against the actual code; three
plausible-but-wrong claims were dropped (see [Checked & dismissed](#checked--dismissed)).

Legend: 🔴 high · 🟠 medium · ⚪ low

---

## Tier 1 — Correctness bugs (do first)

- [ ] **🔴 S · Box-mode `CanvasTexture`s leak on every rebuild.**
      `texturedBoxMesh` creates up to 6 `THREE.CanvasTexture`s (`src/lib/textured-box.js:35`,
      attached at `:82`). The rebuild disposer only calls `geometry.dispose()` +
      `material.dispose()` (`src/main.js:140-148`) — and `Material.dispose()` does **not**
      free `.map`. Every UI/atlas change in box mode leaks the previous mesh's GPU textures
      (and their backing `<canvas>`) unbounded.
      → In the disposal traverse also do `m.map?.dispose?.()` for each material (voxel/wedge
      meshes use vertex colors, so they're unaffected).

- [ ] **🟠 S · No error handling on image decode — bad input fails silently.**
      `createImageBitmap`/`fetch` throw on a corrupt/non-image file or a failed atlas URL
      (`src/image-io.js:14-21`), but the `async` drop/file handlers (`src/ui.js:70-73`,
      `:81-86`) and `onSample` (`src/main.js:210-211`) never `catch`. Result: an unhandled
      promise rejection and a silently unchanged UI (or a blank app on boot if the sample
      URL 404s).
      → Wrap the decode calls in `try/catch` and surface the failure through the existing
      `ui.setStats({ warnings })` channel.

---

## Tier 2 — Retire the abandoned low-poly code path (one decision, big cleanup)

The shipping low-poly path is the **additive-wedge** engine (`src/lib/wedge-mesh.js`,
reached from `src/main.js:166`). An older **planar-remesh / z-sweep + 45° diagonalizer**
approach still lives in the tree but is **unreachable from the app** — confirmed by
tracing every import edge and by its absence from `dist/`. It survives only through
tests and a standalone dev page. This is the same generation as the already-deleted
`tile-mesh.js` (commit `3e1dc8b`); `wedge-mesh.js:16` literally calls it a "dead end".

- [ ] **🟠 M · Decide the fate of the `vectorize → lowpoly → diagonalize → diag-preview` chain, then act as a unit.**
      Dead-from-the-app files: `src/lib/vectorize.js`, `src/lib/lowpoly.js`,
      `src/lib/diagonalize.js`, `src/diag-preview.js`, `diag.html`.
      **Blast radius if deleted** (must be one commit or `node --test` breaks):
  - Remove test imports + blocks in `test/pipeline.test.mjs`: imports at `:11-13`;
    the 7-case "vectorize fidelity" loop (`~:247-254`), the z-sweep test (`:257`),
    and the 3 "diagonalize:" tests (`:290/:297/:306`). That's **11 of 22** pipeline
    test executions guarding non-shipping code.
  - Keep everything else in `pipeline.test.mjs` (buildVoxels, ingest, carve, faces,
    atlas) — those exercise the live pipeline.
  - `diag.html` is **already orphaned from the build** (`vite.config.js` has no
    `rollupOptions.input`, so only `index.html` ships) — it works under `vite dev` but
    vanishes from `npm run build`.
    → **Recommended:** delete the five files + their tests. **Alternative:** if the
    diagonalizer is a keeper, move it to an `experiments/` dir, add `diag.html` to
    `build.rollupOptions.input`, and note in the README that it's off the product path.
    _(Note: `src/lib/vectorize.js` also has a truly-unused export `signedArea` at `:135`
    — resolves automatically on delete.)_
    _(Note: `src/main.js:66` comment "planar remesh: staircases → flat angled facets"
    describes this reverted approach — fix or drop it; see Tier 3.)_

---

## Tier 3 — Docs / README drift (each a small, high-value fix)

- [ ] **🟠 S · README cites a "Van 832 → 110 triangles" sample that doesn't exist.**
      `README.md:80-81`. Only samples are **Cube** and **Car** (`src/lib/sprite-data.js:47,55,61`).
      → Rename to "Car" and regenerate the count from `car-atlas.png` (via the `?diag=1`
      title readout) or drop the specific number. The cube `768 → 12` figure is real
      (backed by `test/pipeline.test.mjs:220`).

- [ ] **🟠 S · README top-view "front direction" prose contradicts its own table and the code.**
      Table `README.md:42` says TOP front → _top_ edge; prose `README.md:123` says _bottom_
      row. Code agrees with the table: `src/lib/views.js:117` maps `+z` to image row `v=0`
      (top). The inline comment `src/lib/views.js:108` is wrong the _same_ way as the prose.
      → Fix prose `:123` **and** comment `views.js:108`; add a one-line test pinning the
      TOP/BOTTOM front-row convention so they can't drift again.

- [ ] **🟠 S · README Architecture module list is stale + overstates colorize coverage.**
      The `src/lib` listing (`README.md:133-145`) omits `vectorize.js`, `lowpoly.js`,
      `diagonalize.js`, and `src/diag-preview.js`. Separately, `README.md:130` implies
      colorize is directly tested, but the depth-smear/asymmetry cases
      (`test/pipeline.test.mjs:74,96`) only cover it through `buildVoxels`; `buildPalette`
      and `makeSnapper` (`src/lib/colorize.js:29,46`) have **zero** direct tests.
      → Update the listing to match reality (or delete the files per Tier 2), reword the
      coverage claim to "integration-level", and add a unit test for `makeSnapper` —
      colorize is called out as "the part most likely to look wrong".

- [ ] **⚪ S · README says `npm test` is "pure-pipeline", but the suite now loads THREE.**
      `README.md:12,129` predate `test/wedge-mesh.test.mjs`, which imports `wedgeMesh`
      (THREE) and guards the shipped low-poly path + the Helium canvas-farbling fix, yet is
      never mentioned.
      → Describe two suites (pure typed-array pipeline + THREE-loaded wedge-mesh gate) and
      reference `wedge-mesh.test.mjs` in the low-poly section.

- [ ] **⚪ S · Stale inline comment: `src/main.js:66` labels low-poly as "planar remesh".**
      The shipped mode is additive 45° wedges.
      → `// low-poly: additive 45° wedges over same-color staircases`.

---

## Tier 4 — Simplification & de-duplication (DRY the pipeline)

- [ ] **🟠 S · Extract the shared sRGB-byte → linear vertex-color cache.**
      `src/lib/mesh.js:34-46` (`toLinear`) and `src/lib/wedge-mesh.js:144-155` (`toLin`) are
      byte-identical (Map cache + reused `THREE.Color` + `unpackRGBA` + `SRGBColorSpace`).
      → Extract `makeVertexColorLinearizer()` into a shared `mesh-util.js`; both builders call it.

- [ ] **🟠 M · Extract the shared quad→geometry "tail" (framing + material + shadows).**
      `src/lib/mesh.js:80-92` and `src/lib/wedge-mesh.js:238-248` copy-paste the same
      `translate((-nx*s)/2, 0, (-nz*s)/2)`, bounds compute, `MeshStandardMaterial({vertexColors,
flatShading, metalness:0, roughness:1})`, and shadow flags — `wedge-mesh.js:238` even
      comments "match voxelMesh framing exactly".
      → `finishVoxelMesh(geo, {nx, nz, s})` returning the configured Mesh.

- [ ] **🟠 S · Unify the packed-color representation.**
      Canonical is little-endian RGBA (`src/lib/ingest.js:10` `packRGBA`), but
      `src/lib/diagonalize.js:25` packs big-endian `0xRRGGBB` (byte-swapped, no alpha) and
      `src/diag-preview.js:12` formats it to match. Also `src/lib/wedge-mesh.js:71` and
      `src/lib/colorize.js:56` hand-inline the `&255 / >>>8 / >>>16` split that `unpackRGBA`
      already does. _(Currently harmless — the divergent layout is dev-only — but it's a trap.)_
      → One layout everywhere; replace inline splits with `unpackRGBA`. _(Moot if Tier 2 deletes diagonalize.)_

- [ ] **⚪ S · Centralize the face-key → axis map (3–4 copies).**
      Identical `{px:'x',nx:'x',…}` at `src/lib/colorize.js:26` and `src/lib/textured-box.js:72`,
      implicit again in `src/lib/faces.js:17`. `views.js` already owns the other face metadata.
      → Export `FACE_AXIS` from `src/lib/views.js` (ideally derived from `FACE_NORMAL`) and import it.

- [ ] **⚪ S · Hoist scattered default constants.**
      Mirror default `{x:true,y:false,z:false}` (`colorize.js:108`, `textured-box.js:60`,
      `main.js:61`, both `sprite-data.js` samples), `worldSize = 2.5` (`mesh.js:23`,
      `wedge-mesh.js:56`, hardcoded-non-overridable at `textured-box.js:66`), and
      `alphaThreshold = 128` (`ingest.js:80`, `main.js:62`, `diagonalize.js:20`).
      → Shared `DEFAULT_MIRROR / DEFAULT_WORLD_SIZE / DEFAULT_ALPHA_THRESHOLD`; make
      `texturedBoxMesh` honor `opts.worldSize` like the other two builders.

- [ ] **⚪ M · Single canonical face-name vocabulary.**
      `SLOT_ORDER` (`src/ui.js:9`) and `DEFAULT_ATLAS_LAYOUT` (`src/lib/atlas.js:11-14`)
      independently re-list the six face names; `views.js` derives `VIEW_NAMES` canonically.
      Also `src/lib/views.js:24` exports a `FACES` array that **nothing imports** (dead;
      duplicates `carve.js:110`'s `FACE_KEYS`).
      → Define the vocabulary once in `views.js`; delete the dead `FACES` export; derive the rest.

- [ ] **⚪ S · `sliceAtlas` reimplements `deriveTileSize` inline.**
      `src/lib/atlas.js:67-68` re-derives `img.width/cols, img.height/rows` instead of
      calling `deriveTileSize` (`:27`), which is otherwise only exercised by a test (so it
      can drift and is effectively untested against real slicing). _(Keep the `Math.round`
      at `:70-71` when delegating.)_

- [ ] **⚪ S · Add `unvoxIndex(idx, dims)` next to `voxIndex`.**
      `src/lib/colorize.js:117-120` hand-writes the inverse of `carve.js:16`'s index packing;
      they must stay in lockstep with no compiler to catch drift.

---

## Tier 5 — Performance (mostly micro; one real refactor)

- [ ] **⚪ S · Redundant `firstHitFromFace` ray-march in colorize.**
      `src/lib/colorize.js:130` and `:136` call it with byte-identical args (the mirror-fill
      branch re-walks the whole depth ray to the same boolean). It's the most expensive
      per-face op.
      → Hoist `const firstHit = firstHitFromFace(...)` once, reuse in both branches.

- [ ] **⚪ S · Parse `URLSearchParams` once in `main.js`.**
      `new URLSearchParams(location.search)` is built 4× (`:78`, `:166`, `:177`, `:259`);
      `:166`/`:177` re-parse inside `rebuild()`. `location.search` never changes.
      → One module-level `params`; resolve static `flat`/`diag` flags into constants.

- [ ] **⚪ S · Camera aspect uses a per-frame poll instead of a resize listener.**
      `src/main.js:237-248` runs `resize()` every frame from `tick()` (`:251`), forcing a
      layout read each frame, and updates `camera.aspect` only inside the half-res
      buffer-size guard — so a sub-2px CSS width change leaves aspect stale.
      → Add `window.addEventListener('resize', resize)`, move `camera.aspect = w/h` outside
      the buffer guard, and drop the per-frame `resize()` call.

- [ ] **⚪ M · `wedgeMesh` grows plain JS arrays then copies to `Float32Array`.**
      `src/lib/wedge-mesh.js:143` uses `[]` push-arrays filled 3 floats at a time, then
      `Float32BufferAttribute` re-allocates and copies (`:234-236`) — boxing `O(tris·9)`
      numbers. `mesh.js` preallocates because its count is known up front.
      → Optional: preallocate to an upper bound + write cursor, `subarray()` before
      `setAttribute`. Profile-gated.

- [ ] **⚪ L · Low-poly base faces aren't greedy-merged (known limitation).**
      `src/lib/wedge-mesh.js:186-201` emits one unit quad per exposed texel; a flat wall is
      N quads vs 1 in voxel mode. `mergeVertices` (`:237`) welds but doesn't reduce triangles.
      → Route non-wedge base faces through `greedyQuads` (must skip the wedge-`removed` set
      and honor the color-tolerance rule). At minimum, add a comment at `:186` documenting
      the deliberate non-greedy choice so nobody "fixes" it and breaks removed-face culling.

---

## Tier 6 — Robustness & edge cases

- [ ] **⚪ S · `sliceAtlas` drops a lone `tileW`/`tileH` override.**
      `src/lib/atlas.js:66`: `if (!tileW || !tileH) { recompute BOTH }` — supplying only one
      silently loses it (latent today; all live callers pass both).
      → `if (!tileW) tileW = …; if (!tileH) tileH = …;`

- [ ] **⚪ S · Box mode never reports its triangle count.**
      `src/main.js:159-162` leaves `stats.triangles` at its `0` initializer, so the stats
      panel omits the line (`src/ui.js:244`), though `textured-box.js:89` sets
      `userData.triangles = 12`.
      → `stats.triangles = current.userData.triangles;` in the box branch.

- [ ] **⚪ S · `sliceAtlas` builds garbage instead of warning on a degenerate sheet.**
      A 0-size decoded image derives `tileW/tileH = 0`, skips the mismatch warning
      (`src/lib/atlas.js:73`), and yields all-null views with no diagnostic (`:82-91`).
      → Guard: if dims aren't positive integers or `tileW/tileH < 1`, push a clear warning
      and return all-null.

- [ ] **⚪ S · `carve()` returns a solid 1×1×1 box for empty input, undocumented.**
      `src/lib/carve.js:80` (`.fill(1)`) + `reconcileDims` axis-default of 1 → `buildVoxels({})`
      emits a lone cube with no distinction from real art. No test covers the zero-view path.
      → Document the contract at `:80` and add a `providedViews.length === 0` guard/warning at
      the pipeline level.

- [ ] **⚪ M · Inconsistent, unvalidated module-boundary error philosophy.**
      `sliceAtlas`/`reconcileDims` surface `warnings[]` (good), but `buildVoxels`
      (`src/lib/pipeline.js:17`) does no shape check (a malformed view throws in
      `ingest.js` with no indication which view), `colorize.js:110` silently identity-snaps
      an empty palette, and nothing validates `data.length === width*height*4`.
      → Pick one convention (threaded `warnings[]` or typed throws); validate the
      `{width,height,data}` shape once in `ingestSprite` with a clear message.

- [ ] **⚪ S · Inconsistent `userData` contract across the 3 builders; `worldHeight` is dead output.**
      `voxelMesh` → `{triangles, quads, worldHeight}`; `wedgeMesh` → `{triangles, wedges}`;
      `texturedBoxMesh` → `{triangles}`. Only `triangles` is read (`main.js:172`); `worldHeight`
      and `quads` have **no** readers (`mesh.js:93-95`).
      → Document `triangles` as the guaranteed key and drop the dead `worldHeight`/`quads`
      (or normalize all three to set `worldHeight`).

- [ ] **⚪ S · `sameMat` alpha asymmetry (latent).**
      `src/lib/wedge-mesh.js:68-74`: the fast path compares all 32 bits (incl. alpha), the
      tolerant path only 24. Can't misfire today (alpha is always 255), but the two paths
      disagree on whether alpha counts.
      → Mask alpha out of the exact path: `((a>>>0)&0xffffff)===((b>>>0)&0xffffff)`.

---

## Tier 7 — Engineering hygiene / DX

- [ ] **🟠 M · No linter, formatter, editorconfig, LICENSE, CI, or type-check config.**
      The code is JSDoc-typed throughout (`@typedef Dims`, param shapes) but nothing runs.
      → Add: (1) a CI workflow running `npm ci && npm test` on push/PR; (2) `tsconfig.json`
      with `checkJs/noEmit/allowJs` + a `typecheck` script (near-free safety net on existing
      JSDoc); (3) prettier + `format`/`lint` scripts; (4) `.editorconfig`; (5) a `LICENSE`

  - `package.json` `license` field.

- [ ] **🟠 S · `tools/capture.sh` swallows Chrome failures and reports false success.**
      Both Chrome calls end in `|| true` (`:32`, `:36`) and shot mode unconditionally prints
      `shot -> $OUT` (`:33`) even when no PNG was written; no `mkdir -p` for the output dir.
      → After the call, verify the artifact: `[ -s "$OUT" ] && echo … || { echo "capture
failed" >&2; exit 1; }`; add `mkdir -p "$(dirname "$OUT")"`; optionally check
      `[ -x "$CHROME" ]` up front.

- [ ] **⚪ S · `package.json` hygiene.**
      `version: "0.0.0"` despite real feature history (`:4`); no `engines.node` floor despite
      relying on `node:test`; bare `node --test` glob (`:11`).
      → Bump version, add `"engines": { "node": ">=18" }`, scope to `node --test test/`.

- [ ] **⚪ M · `computeDiag` ships in the main bundle for a debug-only path.**
      `src/main.js:96-129` (~34 lines) runs only under `?diag=1` (`:177`, used by
      `tools/capture.sh`) and writes JSON into `document.title`.
      → Optional: move to `lib/diag.js` and `await import()` it behind the flag so it
      tree-shakes out of normal builds.

- [ ] **⚪ S · Document why the normal attribute is kept under `flatShading`.**
      `flatShading:true` makes the per-vertex normals cosmetic for lighting, but they're
      load-bearing for `mergeVertices` welding (`src/lib/wedge-mesh.js:237`) and `computeDiag`
      (`src/main.js:98`). A future "optimization" deleting them would silently corrupt the
      wedge silhouette.
      → One-line comment at each `setAttribute('normal', …)` (`mesh.js:75`, `wedge-mesh.js:235`).

- [ ] **⚪ S · Dead CSS.**
      `.slot.drag`, `.slot-clear`, `.slot.filled .slot-clear:hover` (`src/style.css:168-171,
183-197`) target elements the read-only faces grid no longer creates (`src/ui.js:108-115`).
      → Delete those blocks (`.dropzone.drag` on the atlas zone is still live).

---

## Checked & dismissed

Verified against the code and found **not** actionable — recorded so they aren't re-raised:

- **"Stale README reference to the retired diagonalizer"** — the README never mentions
  `diagonalize`/`vectorize`/`z-sweep`; the Architecture listing already omits them. Nothing to remove.
- **"`resampleView` silently downsamples and loses color"** — moot: `resampleView` was
  retired for `placeView`, which places each view at native scale (1:1) and only pads,
  so it never resamples up OR down. Disagreeing views now intersect (clip), not stretch.
- **"Wedge gate tolerance duplicates colorize's palette-snap"** — `wedge-mesh` reads
  already-snapped colors from `faceColor` and does no snapping; the `TOL2` tolerance
  covers adjacent-palette-entry farble drift that snapping was never meant to fix.
  Comparing snapped indices instead would reintroduce the dropped-wedge bug fixed in `02db502`.

---

<sub>Generated from a multi-agent code review (6 dimensions × find→adversarially-verify).
46 findings confirmed, 3 rejected. Severity/effort are reviewer estimates — reprioritize as needed.</sub>
