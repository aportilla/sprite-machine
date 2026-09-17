# Plan: 1:2 wedges

**Status:** drafted 2026-09-16. Every decision is made (2026-09-16). Steps 1
to 4 shipped 2026-09-16 in app 0.3.7 and sprite-machine 0.4.0; the eye checks
in §4 are open. The ask: _"i'm intereested in extending this same pattern to support shallow 1x2
wedges in addition to our current 1x1 wedges"_, then, over the truck's jagged
windshield, _"1x2 wedges should make that slope nice and flat"_ and _"we should
put this one into our app as a default file in any case"_.

The short version: a 1:2 wedge is a notch that today's rule already finds,
taking the empty cell beside it when the two faces it covers run on in a
two-by-one step. The slope, its caps and the T-junction repair learn one more
lattice direction, and every vertex stays on the integer lattice. The truck
becomes a built-in document, and the wedge-end leak it exposes is fixed first.

## 1. Where it stands

### 1.1 The 1:1 rule

`wedgeMesh` (`packages/core/src/wedge-mesh.js`) scans each ridge axis R (z, x,
y, first ridge wins) for a notch: an empty cell q with solids at q+sA·A and
q+sB·B and empty cells at q−sA·A and q−sB·B. It fires when the two faces it
covers, the riser on q+sA·A and the tread on q+sB·B, pass `sameMat`. The cells
of one 45° plane merge into slope quads, their gable caps are traced into the
wall regions as `Half` pieces (`regions.js`), and the T-junction repair splits
axis and 45° edges (`t-junction.js`).

The rule reads only q's four neighbours. On a staircase of two-cell steps it
fills each step's corner cell and leaves the other cell as a flat face, so each
step is a 45° cove plus a one-cell riser or tread. That is the truck's
windshield in the screenshot.

### 1.2 The truck

`~/Downloads/truck.png`: 120×480, six layers (Cab, Bed Right, Bed Left,
Rollcage, Chassis, Tailgate), 40 tiles. In the Cab's left view the windshield
steps back one column every two rows (rows 24 to 29), a steep 1:2 line. The
cell pairs are vertical, so the 2-cell leg is the riser.

A scratchpad prototype of the scan rule in §3.1 gives, on the truck:

| Step (x-ridge, cab width x 11..25) | Today | With 1:2                                                                                                            |
| ---------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------- |
| Foot, on the hood (y 10, z 30)     | cove  | 1:2 across the width, as an end step (§3.1)                                                                         |
| Middle (y 12, z 29)                | cove  | 1:2 across the width                                                                                                |
| Top, under the roof (y 14, z 28)   | cove  | 1:2 at the two pillar columns only: the front view paints row 24 orange, so the glass above the cove fails the gate |

32 wedges become 1:2 (64 cells). With row 24 of the Cab's front view painted
glass between the pillars, the top step converts too: 45 wedges, and the pane
is one plane from the hood to the roof. The shipped art,
`~/Downloads/truck UPDATED.png`, does that: the Cab's left and front views
gain an orange roof row at row 23 and paint row 24 glass, so the build has 45
1:2 wedges and 554 triangles. The Car has no 1:2 steps that pass
the gate, so it builds as it does now. `~/Downloads/house.png` gains 50 1:2
wedges on its steep roof (`house (1).png` has none).

### 1.3 A leak the truck exposes

The truck is not watertight today: 35 boundary edges, 39 odd. All of them sit
at the 13 wedge cells, on the chassis, whose ridge end meets another layer's
solid. The cap rule skips an end that meets solid. That solid's face toward the
wedge cell stays a full square, so the slope's end edge lies across it with
nothing to pair with. A 4-voxel 45° staircase unioned with a front-only slab
layer reproduces it (9 odd edges). One hull cannot produce the case, since the
view that empties a notch cell also empties its neighbours along R. A layer
union can, and 1:2 ends need the same rule, so §3.3 fixes it first.

## 2. The model we copy

The pixel-art line. A line of slope one-half is drawn as runs of two pixels
per step, as in 2:1 isometric art and Bresenham's lines. The mesher reads such
a staircase as the line it stands for, as it already does for runs of one.
The in-app precedent is the 1:1 wedge and its authoring contract: paint the
faces a corner joins the same colour and it ramps, paint them differently and
it steps.

## 3. The design

### 3.1 The scan

A 1:2 wedge is a notch q plus the cell p beside it along one in-plane axis L
(A or B), away from L's solid: p = q − sL·L. S is the other in-plane axis. It
covers three faces: the short-leg face on q+sL·L (one cell) and the long-leg
faces on q+sS·S and p+sS·S (two cells). Its profile is the right triangle at
q's inner corner with legs 2 along L and 1 along S.

```
shallow (L across, S up)          steep, the windshield (L up, S across)

 p  q  #   # short-leg solid       p  #   # long-leg solids
 #  #  #   # long-leg solids       q  #
                                   #  #   # short-leg solid (the hood)
```

At each notch, per ridge, the scan tries L = A, then L = B, then today's 1:1.
The two 1:2 shapes exclude each other. p is never a notch of the same ridge
(its neighbours along L are both empty), so trying 1:2 first at q is the whole
ordering rule. The ridge order still decides between ridges. A 1:2 fires when:

1. p is empty and unclaimed, p+sS·S is solid, and p−sL·L and p−sS·S are empty.
2. **Ends agree.** q+R and p+R are both solid or both not, and the same for
   q−R and p−R. A mixed end has no lattice-exact shape, so the pair falls back
   to 1:1.
3. **Gate.** Both long-leg faces pass `sameMat` against the short-leg face. The
   slope samples one swatch, the short-leg face's colour, as a 1:1 does. Flat
   mode skips the gate.
4. **Shape.** A strict step: the short-leg face stops at one cell
   (q+sL·L−sS·S is empty) and the long-leg faces stop at two (p−sL·L+sS·S is
   empty). Or an end step: exactly one of them runs on, and the next notch
   inward on the same plane is a strict step. That notch is q−2sL·L+sS·S when
   the short-leg face runs on (the windshield's foot on the hood), and
   q+2sL·L−sS·S when the long-leg faces run on (a shallow run's foot on a
   floor).

A lone one-high ledge on a floor has no strict neighbour and stays a 45° cove,
as does every 45° staircase. A step whose second cell is another colour stays
a cove, as the truck's top step does.

### 3.2 The emit

- **Records.** `wedgeCell` holds both cells. A record adds `run` (the long
  axis, or null for 1:1) and `role` (`q` or `p`). `wedges` still counts cells
  and `slopes` counts blocks, so `Built` is unchanged.
- **Slopes.** A 1:2 plane is keyed by (R, L, S, sL, sS, sL·l + 2·sS·s of q),
  where l and s are q's L and S coordinates. The grid's t is the step index,
  −sS·s, and r runs along R, greedy-merged by colour as now. A 1:1 is the
  same plane with a one-cell long leg, keyed apart by the ratio. A block's quad runs
  from the first step's far corner (the end of the long leg) to the last
  step's near corner (the top of the short leg). Its normal is
  −sL·L̂ − 2sS·Ŝ, normalized. 1:1 and 1:2 planes never share a key, so a curve
  that mixes them is several blocks that meet on lattice lines.
- **Caps.** A 1:2 end gets a long half in the ±R plane: the right angle at q's
  inner corner, the leg along L over q and p. An end is skipped when its
  neighbours are the q and p of one 1:2 of the same orientation. The 1:1 skip
  also checks that the neighbour is a 1:1, so a 1:1 beside a 1:2 caps. A
  mismatched end caps both sides, as two 1:1s of different orientations do
  today: the caps overlap inside the solid, and the mesh still welds. See
  decision 6.
- **Solid ends.** See §3.3.

### 3.3 Ends against solid

An end whose neighbour is solid gets the complement of its cap on that
solid's face, and the full face leaves `baseMask`. For a 1:1 the complement is
the half with the opposite corner. For a 1:2 it is the long half with its
right angle at p's outer corner, painted per cell with the two solid faces'
colours. The slope's end edge then pairs with the complement's diagonal. This
lands before the 1:2 work, for 1:1 alone.

### 3.4 The lattice

- **`regions.js`.** `Half` gains an optional `run` (`'a'` or `'b'`): the leg
  along that axis is two cells, over (a, b) and the next cell away from the
  right angle. It also gains an optional `color2` for that second cell, which
  defaults to `color`. The piece is emitted with its long leg split at the
  midpoint, so its edges cancel against the unit edges beside it. It covers
  two cells in `texels` and `present`, and its area2 is 2. Its test point is
  its centroid, whose b is never an integer. Both fields are additive to an
  exported typedef.
- **`dropCollinear`.** It uses a cross product. The sign test assumes unit
  steps, and it would drop the corner where a 45° edge meets a 1:2 edge.
- **Hole test point.** It moves a sixteenth of the first edge's lattice step,
  turned right, from that step's midpoint. No other lattice line of an axis,
  1:1 or 1:2 direction comes that close to the midpoint, so the point is
  strictly inside the hole, off every lattice line. The old quarter-cell point
  can land on an island's diagonal.
- **`t-junction.js`.** `interiorPointsOnEdge` steps by the gcd of the edge's
  components, so a 1:2 edge splits at its lattice points as a 45° edge does.
  A triangulation chord still carries no mesh vertex, so it splits nowhere.

### 3.5 The Truck document

- `src/assets/truck-atlas.png`, from `~/Downloads/truck UPDATED.png`, and a
  `TRUCK_SAMPLE` in `lib/sprite-data.js` (`name: 'Truck'`, `tile: 40`).
- `loadSample` and `seedDefaultDocs` read a URL sample as a document PNG. They
  fetch the bytes and take the transforms, ring settings and layer names from
  its chunks (`readSheetMeta`), as the Finder's paste does, with `sheetLayers`
  for the count. `seedDefaultDocs` used to load one layer, which would have
  sliced the truck into 40×240 tiles. The truck's ring chunk sets 8 views.
- A first boot seeds it. An existing profile gets it from Special → Restore
  Default Files, which already stores any built-in missing by name.
  `?sample=truck` opens it.
- README §first boot says three starter documents, §Source layout names the
  asset, and the "layered built-in sample" follow-up leaves Known limitations.

## 4. Steps, each landing green

1. **The Truck document** (§3.5). App patch. Verified by eye:
   - Special → Restore Default Files adds Truck to the desktop, and its icon is
     the model.
   - It opens with six layers named Cab to Tailgate, and File → New… lists it.
   - A fresh profile (a private window) seeds Car, Truck and Cube.
2. **Ends against solid** (§3.3). Engine, unreleased. Verified by eye: the
   Truck with `?diag=1` reports no boundary edges, and the chassis looks as it
   does now.
3. **The lattice** (§3.4). No visible change. Engine tests only.
4. **1:2 wedges** (§3.1, §3.2), with the 1:1 cap skip checking the kind, the
   package README's step 6 and gate paragraph, and README §Low-poly, its
   "always on" sentence and Low-poly scope. Engine minor 0.4.0 for steps 2 to
   4, app patch. Verified by eye:
   - The Truck: the windshield is one flat pane from the hood to the roof, and
     the pillars run straight up it.
   - The Car and the Cube look as they do now.
   - A 1:2 staircase drawn in a new document, shallow and steep, is one slope,
     and a one-high ledge on a floor stays a 45° cove.
   - `?diag=1` on the Truck still reports no boundary edges.

## 5. Kit asks

None. Nothing here touches vintage-frames.

## 6. Tests

By `docs/TESTING.md`. The engine suite covers the rules. The Truck step adds
no test.

- `wedge-mesh.test.mjs`:
  - Shallow and steep 1:2 staircases weld watertight and are one slope each,
    and a 1:2 ramp costs the same triangles 1 wide and 4 wide.
  - An end step fires beside a strict step and not alone: a lone ledge on a
    floor stays 1:1, by the cell count.
  - A second cell of another colour falls back to 1:1.
  - A pair whose ridge ends disagree does not fire.
  - A curve that mixes 1:1 and 1:2 steps welds watertight.
  - A 1:2 run beside a 1:1 run along the ridge welds watertight.
  - Step 2: a wedge run whose end meets another layer's solid welds
    watertight (a staircase unioned with a front-only slab).
  - The existing 45° tests stand unchanged.
- `regions.test.mjs`: a 1:2 wall and its long halves trace to one diagonal
  edge. A 45°-to-1:2 corner keeps its vertex. A two-colour long half paints
  both cells. A hole whose first edge is a 1:2 diagonal is assigned to its
  outer.
- `t-junction.test.mjs`: a vertex inside a 1:2 edge splits it, and the result
  has no T-junction.

## 7. Decisions

1. **Both orientations, on every ridge.** Recommended: the long leg may lie on
   either in-plane axis, so a z- or x-ridge gets shallow and steep slopes and a
   y-ridge gets 1:2 chamfers in plan. It is one rule turned, and a rasterized
   curve has both. The truck's windshield is steep. The alternative is shallow
   only, the long leg horizontal, which changes nothing on the truck.
   _Decided 2026-09-16: as recommended._
2. **Strict steps plus end steps.** Recommended: §3.1's shape rule. The
   windshield's foot needs the end step. One alternative is strict steps only:
   the foot stays a cove, and the truck gets 17 1:2 wedges instead of 32.
   Another fires a run-on step with no strict neighbour: every one-high ledge
   on a floor and the foot of every 45° staircase on a floor ramp at 1:2, and
   the Car gains 4 1:2 wedges.
   _Decided 2026-09-16: as recommended._
3. **The gate reads all three covered faces.** Recommended: the slope is one
   swatch, and the art controls it as it does now. The alternative checks only
   the corner pair and paints the slope over a second cell of another colour,
   so the truck's orange roof line would turn to glass.
   _Decided 2026-09-16: as recommended._
4. **Ridge order first, then 1:2 before 1:1 within a ridge.** Recommended: one
   pass per ridge, and only 3-D corners can tell the difference. The
   alternative runs every ridge's 1:2 pass before any 1:1.
   _Decided 2026-09-16: as recommended._
5. **Ends against solid are fixed first, as their own patch.** Recommended: the
   truck leaks today, and 1:2 ends reuse the rule. The alternative folds it
   into step 4.
   _Decided 2026-09-16: as recommended. It is a step of its own, released with
   step 4 (decision 7)._
6. **A 1:2 beside a 1:1 along the ridge caps both.** Recommended for now:
   overlapping caps inside the solid, watertight, as mismatched 1:1 ends are
   today. The first truck art hit this at its pillars; the shipped art, a 1:2
   pane across the cab's width, does not. The exact end is a
   lattice triangle, the 1:2 cap less the 1:1 cap, so it can follow. The
   alternative builds the trim in step 4.
   _Decided 2026-09-16: as recommended._
7. **Versions.** Recommended: engine patch 0.3.1 for step 2, and minor 0.4.0
   for step 4, since a sheet with 1:2 steps builds a different mesh, as
   0.3.0's true views did. App patches throughout. The alternative is one
   engine release at 0.4.0.
   _Decided 2026-09-16: one engine release at 0.4.0, after step 4._
8. **Always on.** Recommended: like 1:1 wedges, with the gate as the control
   and `?flat` firing them ungated. The alternative is a `wedgeMesh` option.
   _Decided 2026-09-16: as recommended._
9. **The Truck as drawn, listed after the Car.** Recommended: the Car stays the
   first-boot default and `?sample`'s default, and the art ships as you drew
   it. Painting row 24 of the Cab's front view glass between the pillars
   flattens the whole pane. That is an art choice, made in the app before step
   1 copies the file, or later on the stored document. The alternative makes
   the Truck the default.
   _Decided 2026-09-16: the Truck is listed next to the Car, after it, and the
   Car stays the default. The art shipped as drawn._
   _Updated 2026-09-16: the Truck ships the user's repainted Cab,
   `~/Downloads/truck UPDATED.png` (§1.2): "I've updated the cab layer to
   properly render the slopes"._

## 8. Follow-ups

- The exact trim where a 1:2 end meets a 1:1 end (decision 6).
- 1:3 and longer runs: the same rule with an n-cell long leg, and caps that
  are still lattice triangles. Each new ratio adds end-trim cases against the
  others.
- A charted slope, so a slope can cross a colour seam along its steps instead
  of falling back.

## 9. Files touched

| File                                     | What                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `packages/core/src/wedge-mesh.js`        | the 1:2 scan, records, slope planes, long-half caps, ends against solid  |
| `packages/core/src/regions.js`           | `Half` `run` and `color2`, `dropCollinear`, the hole test point          |
| `packages/core/src/t-junction.js`        | edges of any lattice direction                                           |
| `packages/core/test/wedge-mesh.test.mjs` | the 1:2 rules, ends against solid                                        |
| `packages/core/test/regions.test.mjs`    | long halves, mixed-slope corners, a 1:2 hole edge                        |
| `packages/core/test/t-junction.test.mjs` | a split 1:2 edge                                                         |
| `packages/core/README.md`                | step 6 and the gate paragraph                                            |
| `src/assets/truck-atlas.png`             | new: the Truck's sheet                                                   |
| `src/lib/sprite-data.js`                 | `TRUCK_SAMPLE` in `SAMPLES`                                              |
| `src/loaders.js`                         | samples load their layer count and names                                 |
| `README.md`                              | first boot, §Low-poly, Low-poly scope, §Source layout, Known limitations |
