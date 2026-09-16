# Plan: the live rebuild's cost

**Status:** drafted 2026-09-15. Nothing is built and no decision is made. The
ask: _"i tested sprite machine on an old 2015 macbook air ( running linux and
firefox ) and it worked great! EXCEPT - there was significant lag when i drew
on the canvas... i suspect the issue is the model rebuilding we're doing...
does that sound right to you? what are some options we might consider for how
to address this? could we push some work into a worker to avoid disrupting the
painting ui?"_

The short version: the suspicion is right, and it is the mesher, not the
voxelization. `wedgeMesh` is 17.9 ms of a 19.5 ms rebuild on the sample car,
and it grows with the cube of the tile size: 65 ms at a 64³ tile, the largest
the app allows. The whole rebuild runs synchronously inside the animation-frame
callback that blits the stroke, and a frame does not reach the screen until
every callback returns, so the brush waits on the mesh once per frame. Three
things follow, in order: the live rebuild leaves the frame and paces itself to
the machine it is on; the mesher stops sweeping the whole lattice to find a
thousand surface voxels; and, if a guarantee is wanted rather than enough
speed, the build moves to a worker. Nothing in the interface changes.

## 1. What it costs today

Measured on this Mac (M-series) with Node on `packages/core` at 5740068, over
`src/assets/car-atlas.png`: a 40³ lattice, 4,950 solid voxels, 1,733 of them on
the surface, 244 triangles out, a 64×64 skin.

| stage                           | ms   |
| ------------------------------- | ---- |
| `buildVoxels`, the edited layer | 1.6  |
| `unionVoxels`, three layers     | 0.6  |
| `wedgeMesh`                     | 17.9 |

Every live edit pays all three: the rebuilder caches one `buildVoxels` result
per layer, so a stroke re-carves only the layer it edits, but the union and the
mesh are recomputed whole. The sample car is one layer, where `unionVoxels`
hands that layer back untouched and costs nothing; the 0.6 ms is the same car
stacked three deep, which then meshes in 17.2 ms. The mesh's cost follows the
lattice and the surface, not the layer count.

`wedgeMesh` alone, by tile size:

| tile | ms    | cells     |
| ---- | ----- | --------- |
| 24³  | 6.9   | 13,824    |
| 32³  | 14.2  | 32,768    |
| 40³  | 17.9  | 64,000    |
| 64³  | 65.3  | 262,144   |
| 96³  | 220.3 | 884,736   |
| 128³ | 507.5 | 2,097,152 |

`TILE_MAX` is 64, so the last two rows are past what a document can hold. They
are there for the curve: the cost is the cell count, not the model.

Where the mesher's time goes, self-time at 40³: `idxFor` 3.4 ms, the
`wedgeMesh` body 3.9 ms, `step` 2.2 ms, `faceRegions` 2.2 ms, `solidAt` 1.1 ms,
`voxIndex` 0.8 ms. earcut, the skin bake, the weld and the T-junction repair
are under 0.5 ms together. Almost none of it is the geometry it produces. It is
per-cell closure and allocation overhead on full-lattice sweeps: the wedge scan
walks all 64,000 cells once per ridge, and `faceRegions` makes 384,000 `idxFor`
calls, each allocating an `{x, y, z}`, to find a few thousand exposed faces.

Why it lands on the brush. The canvas writes its pixels in the pointer handler
and `applyTileEdit` schedules `flushLive` with `requestAnimationFrame`. The
rebuilder subscribes to that flush and `rebuild()` runs the pipeline
synchronously inside the callback. Animation-frame callbacks run before the
frame composites, so the painted pixels cannot appear until the mesh finishes.
Every frame of a stroke, the ink waits on the model. A 2015 Air's Broadwell i5
is roughly 3 to 5 times slower per core, which puts the car at 60 to 90 ms a
frame and a large tile past 250 ms.

Two costs were checked and are not it: the Color Palette's scan and the 3D
Sprite Atlas's paint, both on the same live channel, are 0.02 and 0.03 ms.

Two are unmeasured and named honestly. `toMesh` builds a `BufferGeometry` and a
skin texture on every rebuild, and the upload is the GPU driver's; on
integrated graphics that is not free. And `stage.js` renders a 2048² PCF shadow
map on every frame it draws, which on a Broadwell GPU could be tens of
milliseconds by itself. §3.2 addresses the second cheaply.

## 2. The model we copy

System 7's update region. A classic Mac application redrew a window's content
when it got the update event, not when the content changed, and the Toolbox
kept the pointer and the ink ahead of whatever the application was doing with
the rest of the screen. MacPaint is the same bargain at the small end: the
brush marks the bitmap now, and everything derived from it catches up.

The in-app precedents are already here:

- the live channel, which coalesces every pointer move into one blit per
  animation frame (`doc.applyTileEdit` and `flushLive`);
- the stage, which renders on demand and not on a loop (`needsRender`);
- the rebuilder, which keeps one `buildVoxels` result per layer so a stroke
  re-carves one layer.

What is missing is the last step of that bargain: the derived view is allowed
to be late, and today it is not allowed to be.

## 3. The design

### 3.1 The live rebuild leaves the frame, and paces itself

Both changes are in `rebuilder.js` and both are on the live path only. A
structural change, a document switch, a layer switch and a pref still rebuild at
once, as they do now.

**It leaves the frame.** A live rebuild is handed to a task with `setTimeout`
instead of running inside `flushLive`. The stroke's pixels composite first and
the model follows in the same beat. The 3D View is then one frame behind the
canvas, which is what a derived view is for. `requestIdleCallback` is the
wrong tool: a stroke never leaves the browser idle, so the model would stop
following at all.

**It paces itself.** The rebuilder times each build and then leaves a gap as
long as the build took. A machine that meshes in 3 ms rebuilds after 3 ms and
stays live; a machine that meshes in 80 ms rebuilds after 80 ms and settles at
about six a second with a brush that keeps up. The rule is one line, and it
needs no device detection, no setting and no number tuned to a laptop:

```js
const SHARE = 1; // the gap after a build, as a multiple of what it cost
const wait = Math.max(0, lastEnd + lastCost * SHARE - now);
```

The rest is bookkeeping, and two parts of it matter:

- **The edited layers accumulate.** `rebuild(edited)` drops `cache[edited]` so
  that layer re-carves. A skipped flush must still record its layer, or the
  build that eventually runs would mesh a stale carve. The pacer holds a set of
  edited layers, and the build drops all of them and clears it.
- **The trailing build always happens.** A flush that arrives inside the gap
  arms one timer for the rest of it. The timer is latest-wins and there is only
  ever one. So the last flush of a stroke is what fires it, and the model
  always catches up without any stroke-end signal to subscribe to. A document
  switch cancels it.

The one thing that gets worse: for up to one gap, the mesh handed to `onMesh`
can be one build old, so a 3D Sprite Atlas or an Export 3D Model… taken in
that window would be that old. The gap is bounded by the last build's cost,
which is tens of milliseconds, and a menu pick takes longer than that, so the
window closes before a person can reach it. This is worth knowing, not worth
plumbing around.

### 3.2 The shadow map redraws when the geometry moves

`renderer.shadowMap.autoUpdate = false`, and `needsUpdate` set in the two cases
that can change the shadow: a new mesh in the stage, and a frame where
auto-rotate advanced the spin. The key light is fixed, so orbiting, damping and
a resize cannot change the shadow map and no longer redraw it.

The stage owns the flag. `requestRender` takes an optional argument for "the
geometry changed", which the rebuilder passes when it swaps a mesh in, and the
tick sets it while it is spinning. `OrbitControls`' listener keeps calling
`requestRender` with nothing, as it does today.

With §3.1 in place a stroke renders only on the paced builds, each of which
does change the geometry, so this is not what makes the brush smooth. It makes
orbiting and damping cheap, which is the other thing a slow GPU is asked to do.

### 3.3 The mesher stops sweeping the lattice

Four changes in `packages/core`, all of them output-identical. None changes an
export's signature or the result record.

1. **`idxFor` by arithmetic.** `voxIndex` is `x + nx * (y + ny * z)`, so each
   axis has a stride: 1, `nx`, `nx * ny`. A face's slice, A and B axes pick
   three of them. `idxFor(face, a, b, s, dims)` becomes
   `s * strideN + a * strideA + b * strideB` with the strides taken from a
   small per-face table, and allocates nothing. Same signature, same values.

2. **The wedge scan iterates candidates.** A wedge cell is empty and has solid
   neighbors on two adjacent sides, so every wedge cell is the face-neighbor of
   a surface voxel across an exposed face. One pass over `surfaceMask` collects
   those empty neighbors, marked in a `Uint8Array` so each is collected once.
   The existing ridge test then runs over that list instead of over `nx*ny*nz`
   cells three times. The candidates are visited in ascending voxel index,
   which is exactly today's z, y, x order, and the ridges are still tried in
   `RIDGES` order, so `wedges` comes out in the same order it does now and
   every downstream tie breaks the same way.

3. **`solidAt` and `step` by offsets.** Both build and spread three-element
   arrays per call, inside the innermost loop. They become index arithmetic on
   the neighbor offsets (±1, ±`nx`, ±`nx*ny`) with the bounds check from the
   cell's own coordinates.

4. **`faceRegions` over exposed faces.** Today it walks every plane of every
   face, `6 * nx * ny * nz` slots, to find the ones set in `surfaceMask`. It
   becomes one pass over `surfaceMask` that buckets each exposed face into its
   plane's cell list, then sorts each plane's cells by (b, a), which is the
   order the sweep produces today. Planes with no cells and no halves are
   skipped as they are now.

The profile says these four cover the `idxFor`, `step`, `solidAt` and
`voxIndex` self-time and most of the two loop bodies. Three to five times is
the estimate from that arithmetic, not a promise; the number to trust is the
one measured after step 4 lands. The same work speeds up Export 3D Model…, the
document icons and the CLI, which run the same mesher.

`faceColor` stays a `Map<number, number>`: see decision 6.

### 3.4 The worker, if a guarantee is wanted

The engine is already shaped for it. The root entry imports no three and
touches no DOM, and `wedgeMesh` returns a plain record of typed arrays, so a
module worker can import `sprite-machine` and the main thread keeps
`sprite-machine/three` for `toMesh`. The return trip transfers, with no copy.

The shape, if it is built:

- `src/scene/rebuild-worker.js` holds the per-layer `buildVoxels` cache and
  runs `unionVoxels` and `wedgeMesh`.
- The main thread posts a generation number with each message. A live edit
  sends one layer's six tiles, copied, since the editor keeps mutating its
  working buffer. A structural change bumps the generation and sends the whole
  layer set. A message whose generation the worker does not have is answered
  with a request for the full set, so no structural change can be missed
  silently.
- Backpressure is latest-wins: one build in flight, one queued, anything older
  dropped. Without it the view falls seconds behind the brush on a slow
  machine, which is worse than what we have.
- One worker, keyed by document in the message. Only the active document
  rebuilds.

What it buys and what it does not: it makes the brush's smoothness a property
of the architecture rather than of the mesher being fast enough. It does not
make a build faster, `toMesh` and the texture upload stay on the main thread,
and it adds a second copy of the layer cache whose consistency is now our
problem. That last one is the real work: today `rebuild()` reads `ctx.doc.get()`
and gets consistency for free.

## 4. Steps, each landing green

1. **The pacer.** `rebuilder.js` alone, §3.1. Verified by eye, with the 3D
   View open on the Car:
   - A long stroke on the Front face moves ink under the pointer with no
     hitching, and the model follows a beat behind.
   - Lifting the pen leaves the model matching the canvas, every time, on a
     stroke that ends slowly and on one that ends with a flick.
   - Paint Bucket, Paste and Delete land in the model at once from an idle
     view, and within a gap when they follow a stroke.
   - A layer switch, a digit key, single layer, Tile Size…, Undo and a
     document switch all rebuild with no wait.
   - Same checks on the Air: the brush keeps up and the model lags visibly,
     which is the trade being made.
2. **The shadow map.** `stage.js`, §3.2. Verified by eye: orbiting the car is
   smoother and its shadow is unchanged through the drag and the damping; a
   stroke's new geometry casts an updated shadow; with rotate on, the shadow
   follows the spin.
3. **The mesher's lookups.** `faces.js` and `wedge-mesh.js`: the stride
   arithmetic and the neighbor offsets. Engine patch. The suite is the pin, and
   a scratchpad A/B on the car confirms the buffers are identical before it
   lands.
4. **The mesher's sweeps.** `wedge-mesh.js` and `regions.js`: the wedge
   candidates and the exposed-face bucketing. Engine patch, same A/B. Measure
   and record the number here.
5. **The readout.** The build's ms in the build slice and in the `?diag` title,
   decision 5. This is how the Air gets checked rather than guessed at.
6. **The worker.** Only if decision 7 says so, and only after the numbers from
   step 4.

Steps 3 and 4 are the engine and release as a patch: the output is unchanged
and no export moves. Steps 1, 2 and 5 are the app, and a brush that keeps up is
a visible change, so the app bumps too.

## 5. Kit asks

None. Nothing here touches vintage-frames.

## 6. Tests

By `docs/TESTING.md`, no new test.

The engine changes are refactors whose contract is "the same output", and the
existing suite is what holds them to it: `wedge-mesh.test.mjs` pins
watertightness on a cube and a staircase, one quad per ramp, the material gate
and its tolerance, the centering, and the skin's UVs; `regions.test.mjs` pins
the region tracing, the caps' diagonal and a cube's six quads; `diag.test.mjs`
pins the closed-surface check. A scratchpad A/B against the current build over
the sample car is how each step is confirmed byte for byte. It stays in the
scratchpad and is never committed.

The pacer is timing and wiring in the app: verified by eye, per step 1, and by
the `?diag` readout. Its rule is one `Math.max`, and a test of it would pin
arithmetic, not a rule. Decision 4 records the alternative.

## 7. Decisions

1. **The pacing rule.** A gap as long as the last build took, so a rebuild
   never takes more than half the wall clock, measured per build with no device
   detection and no setting. Recommended: it is one line, it self-tunes to the
   machine, and a fast machine keeps the behavior it has today. The
   alternatives are a fixed rate (say ten rebuilds a second), which is either
   too slow here or too fast on the Air, or a preference, which asks the person
   to diagnose their own laptop.
2. **Where the live rebuild runs.** Always out of the animation-frame callback,
   in a task, even when the last build was cheap. Recommended: one rule,
   always, and the frame the ink is in never carries a mesh. The alternative
   keeps a cheap build in the callback and defers only when it grew expensive,
   which makes the fast path and the slow path behave differently for no gain
   anyone can see.
3. **The stroke-end rebuild.** A trailing timer inside the pacer. Recommended:
   it needs no new signal, and it covers every burst that is not a stroke, such
   as a held key or a sequence of fills. The alternative subscribes to the
   session's gesture flag, which is a stroke-only signal and one more wire from
   the editor to the scene.
4. **The pacer's home.** Inline in `rebuilder.js`, no new module and no test.
   Recommended, per the testing policy's default. The alternative extracts the
   wait as a pure function in its own module with a contract test, which is
   worth it only if the rule grows past one `Math.max`.
5. **The build-time readout.** Add the build's ms to the build slice and print
   it in the existing `?diag` title, beside the watertightness numbers.
   Recommended: it is the only way to know what the Air actually pays, it
   reuses a flag that exists, and it adds nothing to the interface. The
   alternatives are a new dev flag, or nothing, which leaves the Air a guess.
6. **`faceColor`.** Leave it a `Map`, and revisit after step 4's measurement.
   Recommended: a `Uint32Array` of `n * 6` with 0 for "no face" would be
   faster, but `faceColor` is in the published result record that `buildVoxels`,
   `unionVoxels`, `wedgeMesh`, `faceRegions` and `bakeSkin` all pass around, so
   changing it is a breaking engine change and a minor bump. Once the sweeps
   are sparse, the Map is read a few thousand times instead of 384,000, and it
   may stop mattering. The alternative is to change it in the same pass and bump
   minor once, rather than possibly twice.
7. **The worker.** Hold it until steps 1 to 4 are measured on the Air.
   Recommended: it is the largest change here and the only one that adds a
   second source of truth for the document, and the first four steps may leave
   nothing for it to fix. The alternative builds it now, and answers the ask
   directly, at the cost of carrying the cache-mirroring for a problem that may
   already be gone.
8. **The shadow map.** Redraw it when the geometry moves, per §3.2.
   Recommended: it is a handful of lines and it makes every camera move
   cheaper. The alternative leaves it, or shrinks the map to 1024², which
   changes how the shadow looks.

## 8. Follow-ups

- Reuse the skin texture across rebuilds when the palette has not changed, so a
  stroke stops uploading a texture per build.
- A 1024² shadow map, or a lower `RENDER_SCALE`, if the Air is still short of
  smooth after steps 1 to 4. Both change what the view looks like, so both are
  the user's call.
- `buildVoxels` carves the full lattice per layer, 1.6 ms of every rebuild, and
  takes the same sparse treatment. It is not what the stroke waits on.
- Incremental meshing was considered and rejected: one pixel in a front view
  recarves a whole z-column, so the affected slab is most of the model and the
  bookkeeping buys little.

## 9. Files touched

| File                              | What                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `src/scene/rebuilder.js`          | the pacer: the deferred live rebuild, the gap, the pending layers, the trailing build |
| `src/scene/stage.js`              | `shadowMap.autoUpdate` off, `requestRender`'s geometry argument, the spin's update    |
| `src/state/build.js`              | the build's ms in the stats                                                           |
| `packages/core/src/faces.js`      | `idxFor` by stride arithmetic                                                         |
| `packages/core/src/wedge-mesh.js` | the wedge candidates, `solidAt` and `step` by offsets                                 |
| `packages/core/src/regions.js`    | `faceRegions` over the exposed faces                                                  |
| `src/scene/rebuild-worker.js`     | new, decision 7 only                                                                  |
