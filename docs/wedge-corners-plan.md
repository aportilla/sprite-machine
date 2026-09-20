# Plan: wedge corners

**Status:** drafted 2026-09-19, revised the same day around the user's rim
model and their test document. Every decision is made (2026-09-19). Steps 1 to
8 are built (2026-09-19), gates green, eye checks open, plus a step 9 (§3.13)
the user asked for over a missed corner of their own. `Built` gained `gaps`
beside `corners`, the count of ends still capping into a corner no pass
matched. Across the sweep 505 of 729 hulls are clean and 504 ends keep a gable,
down from 972; the test cube has no gap left.
The ask, over screenshots of dents where slopes meet: _"Is there a robust way
to create wedges that can cleanly fill these sorts of dents? I assume there
would be a 1x1, 1x2, and 2x2 wedge fill pieces"_, then _"i'm interested in the
idea of supporting 2 color corner pieces... consider a pyramid, where each side
is a different color"_ and _"IF we color each external face of the corner gap
filler to match its adjacent external edges - then we end up with a perfect low
poly pyramid with sharp colors"_. On the design: _"there are corners with 4
outer edges, in which case we split them and fill the gap with two triangles,
and there are corners with 3 outer edges, in which case we fill it with a
single triangle"_, and _"only one of the crosslines will be 'raised' across the
gap, the other will be flush to a face. we choose the raised one always"_. On
the test document: _"i don't think that example is exhaustive of all possible
corner types"_.

The short version: a slope can end only one way today, in a gable cap, and
where slopes meet at a corner the caps leave a gap. Every gap has a rim of
three or four lattice points. Three take one triangle. Four take two, split on
the diagonal that is raised across the gap. When the slopes that meet have the
same pitch, each triangle lies in its slope's plane and takes its color, so a
two-color corner is a sharp color edge. When the pitches differ, one triangle
is a facet. The
rim's points are vertices the mesh already has, so every fill is on the integer
lattice. Slopes move from rectangles to traced polygons, which the region
tracer already does for walls. A gap the corner pass does not match keeps
today's gable.

## 1. Where it stands

### 1.1 One way to end a slope

`wedgeMesh` (`packages/core/src/wedge-mesh.js`) scans each ridge axis R (z, x,
y) for notch cells and fills each with a prism along R. One wedge per cell, the
first ridge wins. Each end of a wedge along R resolves one of three ways
(`wedge-mesh.js:377`):

- **Continue.** The next cell holds a wedge of the same kind and orientation.
  Nothing is emitted.
- **Complement.** The next cell is solid. The solid's face leaves `baseMask`
  and the cap's complement joins that plane's halves.
- **Cap.** Anything else. A triangular half joins the plane the end lies on.

A slope is one rectangle per greedy block of one plane and one color
(`wedge-mesh.js:307`). The header lists the gap: "3D corners where two ridges
meet become a step".

### 1.2 The corners

Canonical frame: the shared axis is y with the floor below. Arm A has ridge z
and its wall on −x. Arm B has ridge x and its wall on −z. Every other case is
this one turned or mirrored, and the shared solid can be a wall as well as a
floor.

**Two slopes, outside.** A block on a floor, the block in x<0, z<0. Arm A runs
along z<0 in the cells x∈[0,1] and ends at z=0. Arm B runs along x<0 in
z∈[0,1] and ends at x=0. The corner cell [0,1]³ has the floor below it and
touches the block only along its vertical edge, so it is no notch and gets
nothing. Both arms cap into it. The gap is two cap triangles over a floor
square.

**Three slopes, outside.** A box vertex whose three edges are all chamfered.
Three arms, one per ridge, cap into one empty cell that has no solid face
neighbor. The gap is three cap triangles around one cell corner.

**Inside.** Walls in x<0 and in z<0, a floor in y<0. The cell [0,1]³ has one
solid neighbor on each axis, so it is a notch of all three ridges. Ridge z
takes it. Arm B stops one cell short and caps toward it, and the −z wall face
of the cell shows through A's complement. When the walls' inside corner is
chamfered above (a y-ridge arm), that arm also stops at the cell's top.

A scratchpad probe of today's engine (fixtures in §11):

| Fixture                                 | Wedges | Slopes | Triangles | Odd edges |
| --------------------------------------- | ------ | ------ | --------- | --------- |
| Plinth: 2×2 slab on a 4×4 slab          | 8      | 4      | 44        | 0         |
| Pyramid 5/3/1, one color or two         | 16     | 8      | 76        | 0         |
| L slab one high on a 6×6 floor          | 5      | 2      | 28        | 0         |
| L slab three high on a 6×6 floor        | 7      | 3      | 38        | 0         |
| Slab with a bevelled plan corner, floor | 11     | 5      | 52        | 0         |
| The test cube (§1.4)                    | 38     | 9      | 58        | 0         |

The L slab's five wedges are three on ridge z, the corner cell among them, and
two on ridge x. Three high adds two on ridge y above the corner cell.

### 1.3 Which documents meet which

Outside corners come from any document. The plinth and the test cube are one
hull each.

An empty cell with one solid neighbor on each axis cannot come from one hull.
The view that empties a cell empties its whole line, and that line holds one of
the three neighbors. So inside corners come only from a layer union, and their
fixtures need `unionVoxels`. The 1:2 plan found the same for ends against
solid.

### 1.4 The test cube

`~/Downloads/tiny-cube-wedge-test.png`, the document behind the screenshots:
one layer, tile 8, a red box with each corner rounded a different way. It is a
sample, not the full set of corners. Its ends that cap today:

| Faces one cell                                  | What it is                           |
| ----------------------------------------------- | ------------------------------------ |
| ridge x 1:1 + ridge z 1:1, floor below          | two slopes over a floor              |
| ridge y 1:1 + ridge z 1:1, a wall on −x         | two slopes against a wall            |
| ridges x + y + z, all 1:1, no solid face        | three slopes                         |
| ridge x 1:2 + ridge y 1:2, part of the box held | unequal pitches: a 1:1 arm cuts in   |
| ridge z 1:1 beside the p cell of a 1:2          | unequal pitches, twice               |
| ridge x 1:1 beside ridge x 1:2                  | a pitch change along one ridge       |
| one end into open air, both solids stopping     | a flush gable: it merges into a wall |

Screenshots 2 to 4 are the first rows. 5 to 8 are the rest: the dark quad is a
wall face, not a floor, and the light triangle is the top cap of a vertical
chamfer.

### 1.5 The sweep

A scratchpad sweep builds a 10-cell box and rounds one vertex independently in
the front, side and top views, each in one of nine staircase styles (§10), 729
hulls in all. It classifies every end that caps today by §3's rules:

| Ends                                | Count | Fills by      |
| ----------------------------------- | ----- | ------------- |
| flush gables                        | 831   | nothing to do |
| two slopes, box 1×1×1               | 405   | §3.5          |
| two slopes, box 2×1×1 or 1×2×1      | 414   | §3.5          |
| two slopes, box 2×2×1               | 186   | §3.5          |
| two slopes, box 1×1×2               | 48    | §3.5          |
| three slopes, legs 1×1×1            | 101   | §3.6          |
| three slopes, one axis doubled      | 39    | §3.6          |
| a pitch change along one ridge      | 828   | §3.8          |
| two slopes, the box's floor partial | 144   | §3.8          |

292 of the 729 hulls are clean by §3.5 and §3.6 alone. Every other leftover is
slopes of unequal pitch meeting: a 1:2 arm whose last cells fall to 1:1 where
another view's cut takes its long leg's support, or three slopes whose legs
disagree. No pair of ends on one cell failed for any other reason. The sweep
weighs every style mix alike; art rounded the same way in each view is the
clean kind.

### 1.6 The pyramid

A stepped pyramid is two-slope corners stacked: each level's hip line ends
where the next level's begins, so the four hip lines are straight edges. Today
each side is one rectangle per level, because the greedy merge cannot join rows
of different lengths, and every level has four gaps. With one color per side,
each gap's two caps are two colors.

## 2. The model we copy

The hip roof. Roof planes keep their pitch around a corner. At an outside
corner two planes meet on a hip, at an inside corner in a valley, and a plane
that stops dead ends in a gable. The engine has gables only. The in-app
precedent is the gate: paint the faces a corner joins the same color and it
ramps, paint them differently and it steps. A corner fill adds no new control.

## 3. The design

### 3.1 Terms

- **Profile.** A wedge's cross-section, the right triangle K, P, Q of
  `endsOf` (`wedge-mesh.js:299`). K is the filled corner. P is the far end of
  the long leg L and Q the far end of the short leg S. P and Q are not low and
  high: a steep 1:2 has P at the top.
- **End.** A wedge's q record and a direction g = ±1 along its ridge. Its
  continuation cell is e0 = q + g·R. Its **end edge** is the slope's edge
  there, P to Q.
- **Arm.** The run of wedges behind an end.
- **Shared axis C.** Two arms with different ridges R_A and R_B share the third
  axis. Each arm has one leg along C and one along the other arm's ridge axis.
  The leg along C is the **rise** h. The other is the **run**: a for arm A,
  along R_B, and b for arm B, along R_A. Rise and run are names from the
  canonical frame. C can be any axis.
- **W and F.** On an arm's profile, W is the far end of the leg along C (the
  top of the wall) and F the far end of the run (the floor's outer point).
  W = P when L = C, else W = Q.
- **Box.** The a × b × h cells at the corner.
- **Rim.** The closed loop of lattice points around a gap.

### 3.2 The rim rule

A gap is a set of faces today's mesh puts inside a corner: the caps that face
one empty region, and the floor or wall faces of that region between them. Its
rim is that set's boundary: the edges one face of the set uses and no other,
chained into a loop, with collinear runs merged. That leaves the arms' end
edges and the outer edges of the covered floor.

- A rim of three points takes one triangle.
- A rim of four points takes two, split on one of its two diagonals. One
  diagonal lies flush on a face of the gap or of a slope beside it. The other
  is raised across the gap. Split on the raised one.
- A fill triangle that coincides with a slope triangle facing the other way
  cancels it: both leave the mesh. The valley and §3.8 do this.

The test is one sign. Order the rim p0 to p3 counterclockwise seen from
outside. The diagonal p0–p2 is the raised one when p3 lies behind the plane of
(p0, p1, p2), which is the sign of det[p1 − p0, p2 − p0, p3 − p0]. The raised
split is also the one that fills more. A flat rim has no raised diagonal and
either split will do.

Every rim point is a vertex the mesh has or a cell corner, so every fill is on
the integer lattice, whatever the pitches. The faces inside the rim leave the
mesh: caps are not emitted, covered solid faces join `removed`, and a slope
half that the fill covers leaves its slope grid.

**Color** (decisions 1 and 2). A rim edge has the color of the face that stays
on its far side: a slope for an end edge, a wall or floor face for the rest. It
also counts the color of the gap's own face on its near side: the cap, which is
its slope's color again, or the floor or wall face the fill hides. A fill
triangle needs two edges that share a color, by `sameMat`, and takes that
color. When two colors qualify, a far side's wins. A three-point rim's triangle
has three colored edges, so two of three decide it. Each triangle of a
four-point rim has two, since its third edge is the diagonal, so both must
agree. A gap fills whole or not at all: if either triangle of a four-point rim
fails, the gap stays. Flat mode skips the test.

What differs between corner kinds is which faces make the gap, and the gates.
§3.5 to §3.8 say that per kind. The fill is this one routine.

| Corner                     | Rim                                     | Fill                        |
| -------------------------- | --------------------------------------- | --------------------------- |
| two slopes, outside (§3.5) | W, F of A, the far floor corner, F of B | two triangles, the hip      |
| three slopes (§3.6)        | the three far leg ends                  | one triangle                |
| inside, one color (§3.7)   | the three cell corners two steps from K | one triangle, the cut cube  |
| inside, two arms (§3.7)    | see §3.7                                | two triangles, the valley   |
| unequal pitches (§3.8)     | three or four points                    | a facet, or a plane and one |

### 3.3 Equal pitches: the fold

Read each arm as a ramp over the box, y/h = 1 − x/a for A and 1 − z/b for B.
An outside corner fills y/h ≤ min of the two, an inside corner y/h ≤ max. Both
fold on the line from (0, h, 0) to (a, 0, b), and that fold is the raised
diagonal of the rim:

|       | Hip                             | Valley                          |
| ----- | ------------------------------- | ------------------------------- |
| On A  | (0,h,0), (a,0,0), (a,0,b)       | (0,h,0), (0,h,b), (a,0,b)       |
| On B  | (0,h,0), (0,0,b), (a,0,b)       | (0,h,0), (a,h,0), (a,0,b)       |
| Reach | past the arm's end, b or a rows | the arm's own rows at the wall  |
| Hangs | below the fold, on the floor    | above the fold, on the wall top |

Each triangle lies in its arm's plane. The hip's other diagonal, F of A to F of
B, lies flush on the floor. The valley's other diagonal lies flush on the wall.

The arms must share the rise. Wedge kinds give (run, rise) of (1,1), (2,1) or
(1,2), so the boxes are 1×1×1, 2×1×1, 1×2×1, 2×2×1 and 1×1×2. With unequal
rises the exact fold leaves the lattice at a half cell, and three unequal
chamfers meet at a third. §3.8 fills those from the rim instead.

### 3.4 Two passes

Pass 1 is today's scan, unchanged. Pass 2 is the corner pass. It reads pass 1's
wedges and the solid, and it adds the fills. Anything pass 2 does not match is
emitted as today, so the fallback is today's mesh.

Pass 2 runs inside corners first, then outside, because a filled inside corner
presents ends that a hip can use (the bevelled slab needs this).

The end logic of §1.1 becomes one function over (profile, cell, R, g), since a
cut cube's open faces resolve the same way as a wedge's.

### 3.5 Two slopes: hips

Index every end that would cap by its continuation cell e0. Two ends (A, g_A)
and (B, g_B) with the same e0 make a hip when:

1. R_A ≠ R_B. C is the third axis.
2. Both arms have their solid along C on the same side s_C.
3. A's solid along R_B is on side −g_B, and B's solid along R_A is on side
   −g_A. Each arm's wall is behind the other's end.
4. The rises are equal.
5. Every box cell is in the lattice, not solid and unclaimed. The box is
   e0 + i·g_B·R_B + j·g_A·R_A − k·s_C·C for i<a, j<b, k<h. Column i=0 lines up
   with A's q and i=1 with A's p. A tall arm's q is the cell on the floor.
6. The cell on the s_C side of every box column is solid.
7. The color rule of §3.2. A's triangle holds A's end edge and the floor's
   outer edge beside it, so the face past that floor edge, or the floor face
   the hip hides on this side of it, must be A's color. The same for B. On a
   pyramid the far face is the next level's slope on the same side. On a floor
   that runs on in another color, the hidden floor face carries it.

It emits:

- Neither end caps.
- The a·b floor faces join `removed`. They are exposed and wholly covered.
- A half on A's plane: W at r0, F at r0, F at r0 + g_A·b, where r0 is the end's
  lattice position along R_A. It takes A's color. The same on B's plane with a
  and B's color.

The pyramid touches the box's outer faces only along floor edges and at its
apex, so a solid beside the box from another layer changes nothing.

### 3.6 Three slopes: the corner tetrahedron

Three ends of three ridges on one e0 make a corner tetrahedron when:

1. Their profiles share one vertex V, a corner of e0: for each arm, V is its K
   on the face of e0 it caps.
2. The legs agree: the two arms with a leg along an axis give it one length.
   Lengths (1,1,1), or one axis doubled.
3. The cells the tetrahedron spans are in the lattice, not solid and unclaimed.
4. The color rule of §3.2: two of the three arms share a color.

It emits one triangle on the three far leg ends, in that color, with the
normal away from V, and none of the three ends caps. The tetrahedron touches solids only along
edges, so nothing joins `removed`. Its edges are the three end edges.

Three slopes whose legs disagree go to §3.8.

### 3.7 Inside corners

Take each empty cell c with exactly one solid neighbor on each axis, sides
(s_x, s_y, s_z).

**The cut cube.** When pass 1 put a 1:1 in c and the three covered faces pass
`sameMat` pairwise, all three 1:1 prisms are valid there. Their union has a
vertex at the cell's center, off the lattice. The cut cube contains it and
stays on the lattice: the cell less the tetrahedron at its open corner. With K
the corner where the three solids meet, the one new triangle joins the three
cell corners two unit steps from K. In the canonical frame that is (1,1,0),
(1,0,1), (0,1,1), normal −(s_x, s_y, s_z)/√3.

- The three solid faces join `removed`.
- c's pass 1 wedge leaves its slope grid. No slope plane has area in c.
- Each open face of c is the end of a 1:1 of that axis's ridge with the other
  two sides: it continues, complements or caps by the shared end logic. An arm
  of any of the three ridges whose end faces c continues into it.

Under the gate, a one-color inside corner always has all three prisms valid, so
it is always a cut cube, with or without a chamfer above it (decision 4).

**The valley.** An end (B, g_B) whose e0 holds a pass 1 wedge of another ridge
makes a valley when:

1. R_A ≠ R_B, the same s_C, equal rises.
2. A's solid along R_B is on side g_B. B is heading into A's wall.
3. B's prism fits at each of the next a cells toward the wall, claims ignored:
   the cells are not solid, the solids B's kind needs are there (the 1:1 notch
   or `fit12`'s checks, by `solidAt` alone), and B's wall faces pass `sameMat`
   against B's color. The floor faces are A's and already covered.
4. The cell after those a, for B's q and its p, is solid.
5. A is regular over the box: each of the b rows holds a wedge of one plane
   and one packed color.

Its rim in the canonical 1×1×1 case is (1,1,0), (0,1,0), (1,0,0), (1,0,1).
Today's mesh splits it (1,1,0) to (1,0,0): B's cap and A's complement. The
other split is the valley. It emits:

- B gains guest records in the a cells. Guests answer the same-kind neighbor
  test, so B's old cap goes.
- A's grid cells for those b rows at that step become one half: W at the wall,
  W at the wall + b, F at the wall + b. B's guests become one half the same
  way, with a.
- An end against solid skips its complement when the face is already in
  `removed` as another wedge's leg face. In a valley each arm's near end lies
  on faces the other arm covers.

This is the two-color inside corner, and the corner where a 1:2 arm meets a
1:1. A cell that passes the cut cube takes the cut cube.

### 3.8 Unequal pitches: facets

Where the pitches differ no fold is on the lattice, but the rim is. The fill
is still three points and one triangle, or four and two on the raised diagonal.
At most one of the triangles lies in a slope's plane. The other is a facet on
a plane of its own.

Worked case, from the sweep: front square, side 1:1, top steep. H is the box's
outer coordinate and I = H − 1. A 1:1 arm on ridge x runs under the top face,
(y − I) + (z − I) = 1, and ends at x = I. A 1:2 arm on ridge y climbs the
vertical edge, (x − I) + (z − I + 1)/2 = 1. The x arm's notch row takes the
support of the 1:2's p cell in the top row, so pass 1 puts a 1:1 there and
both ends cap. The rim:

- P1 = (I, H, I), the top of the x arm's end edge.
- P2 = (I, I, H), where the x arm's end edge meets the 1:2's.
- P3 = (H, I, I−1), the other end of the 1:2's end edge.
- Q = (H, H, I−1), the top face's corner above P3.

P2 to Q is the raised diagonal: (P2, P3, Q) lies in the 1:2's plane and
carries that slope to the top face, and (P1, P2, Q) is the facet. P1 to P3 lies
flush on the stray 1:1's slope, x + z = 2I. All four points satisfy both
chamfers' half-spaces, so the fill stays inside the shape the art means. It
absorbs the stray 1:1: that wedge's slope and caps leave the mesh.

The rule, as built for a pitch change along one ridge: the 1:2 arm and the 1:1
at the next cell share their profile's corner and their short leg's end and
differ at the long one, so the rim is the 1:2's end edge and the 1:1's far end
edge. The raised diagonal runs from the 1:2's long leg end to the shared point
at the far plane, and the triangle on it lies in the 1:2's plane, the other
being the facet. The fill is the two cells under those two planes; it absorbs
the 1:1 and any cap wholly inside it, and stands down when a cap or a solid
face it touches straddles either plane. Both arms must share a color and the
fill takes it, which is §3.9's reading of §3.2 for this kind.

That leaves 234 of the sweep's 414 pitch-change corners, and all 144 ends whose
box floor is partial, on today's gable. Still to write: the straddling case,
where the fill covers part of a long cap or a solid face and the remainder is
no `Half`; and the partial floor.

### 3.13 The rim from the gap

The kinds of §3.5 to §3.8 each name the faces that make their gap. The last
pass names none: it reads §3.2 straight off the mesh, so a corner the kinds
have no name for still closes.

- **The gap.** Seed from a cap that is no flush gable and no fill took. Its
  cells are the wedge's cells one step along the ridge, so a 1:2's cap gives
  two. Close: every cap facing one of those cells joins, and its cells join, to
  a fixed point. Every cell must be in the lattice, not solid and unclaimed,
  and there is a ceiling of four cells and four caps.
- **The faces.** Those caps, plus the exposed solid face of every cell side
  that meets solid. A face already in `removed` stands the fill down.
- **The rim.** Each face's boundary, wound counterclockwise about its outward
  normal and cut into unit lattice steps so a long edge cancels against short
  ones. An edge whose reverse is present is interior; the rest chain into one
  loop, which then runs counterclockwise seen from outside, and collinear runs
  merge. A branch or a second loop stands the fill down, and so does a rim of
  any length but three or four.
- **The fill.** §3.2's: one triangle, or two on the raised diagonal, which is
  p0–p2 when p3 lies behind the plane of (p0, p1, p2). Every rim point must lie
  inside every arm's slope, so the fill stays inside the shape the art means. A
  fill triangle on an arm's slope plane takes that plane's normal exactly, so
  it welds into the slope rather than seaming against it.
- **Color.** A rim edge carries the color of the gap face it bounds, which is
  the arm's for a cap and the face's for a wall or floor. A run two cells long
  has a color only when every face along it matches. A triangle needs two of
  one color, and the gap fills whole or not at all. This is §3.2's near side
  only: the far side is the kinds' business, and reading one side is
  conservative, never wrong in the other direction.

Worked case, the user's `missed-case.png`: an L two cells by one, its plan
corner bevelled 1:2 and both tops chamfered 1:1. The three arms share no vertex
and the box floor is a third arm's cell, so §3.5 and §3.6 both decline. The
gap is the three caps and one wall face; the rim comes out at four points, one
triangle lands in the top chamfer's plane and the other is a facet.

### 3.9 Color

The rule is §3.2's. What follows from it:

- Arms need not match each other. Each passed its own gate, and each triangle
  of a fold reads only its own two edges, so an equal-pitch fold is a sharp
  color edge.
- The pyramid. A level's hip has A's end edge and B's, and two floor edges.
  Past the floor edge beside A lies the next level's slope on A's side, or the
  base slab's wall on that side, so A's triangle reads A twice. B's reads B
  twice. Every side comes out one flat color.
- A three-point rim with two colors fills in the majority color. With three
  colors it stays a gap.
- The floor a hip hides never blocks a fill, and it can carry one. An outline
  drawn down a pyramid's edges in the top view is covered. A chamfer ring
  painted around a block's foot on a floor of another color closes at its
  corners when the ring's corner pixel is painted too.
- In the worked case of §3.8, the 1:2's triangle reads the 1:2 slope and the
  wall beside it, which that arm's gate already matched. The facet reads the
  45° slope and the top face, which that arm's gate matched.
- A rim edge two cells long has one color only when both faces past it match.
- Every `faceColor` value has a swatch (`skin.js:130`), so a color always
  resolves.

### 3.10 Slopes through the tracer

`traceRegions(cells, halves)` (`regions.js:89`) is pure 2D and already takes
unit halves and long halves.

- Group q wedges by today's plane key and by packed color. A cell is
  `{a: r, b: t, color}` with r the lattice position along R and t the step
  index, as now.
- Grid line b maps to the lattice by P: line t is step t's P line and line t+1
  its Q line. Q of step t is P of step t+1, since a step adds (n·s_L, −s_S) to
  (L, S). So vertex (a, b) is R = a and (L, S) = P₀ + b·(n·s_L, −s_S), all
  integers.
- A fold triangle is a `Half` in that grid. Its leg along b is one step. Its
  leg along a is the other arm's run, so `run: 'a'` when that run is 2. For a
  hip the right angle is F at r0, the cell is the first past the end, and `hiA`
  is g_A < 0. For a valley the right angle is W at the wall + g·b, and the half
  replaces the arm's cells in those rows. `hiB` is whether that point is on the
  Q line.
- A valley half replaces cells. `traceRegions` throws when two pieces share a
  directed edge.
- Triangulate with earcut as the base regions do, keep the area check, paint
  `{swatch}`. `pushTri` rewinds about the normal, so the grid's handedness does
  not matter.
- `slopes` counts slope regions. A rectangle is still two triangles. The hole
  test point's clearance holds, since the grid's diagonals are 1:1 and 1:2.
- Slope regions stay out of `bakeSkin`.
- Triangles in no slope's plane are pushed as they are, with a swatch.

`dropCollinear` joins a run of collinear halves, so a pyramid side is one
triangle or trapezoid. Expected: the plinth and the pyramid at 20 triangles
each (top 2, four sides 8, the base slab's walls 8, bottom 2).

### 3.11 The T-junction repair

`interiorPointsOnEdge` skips an edge that changes all three coordinates as a
triangulation chord (`t-junction.js:23`). A fold is such an edge and it is
real, and so are a facet's edges. Two sides of one fold can split it at
different lattice points, when one side has a color band or a level the other
lacks. The gcd stepping already walks any lattice direction. Drop the skip
(decision 6): splitting a chord at a vertex that lies on it keeps the surface
and the pairing, because both triangles on the chord split alike. One step's
fold has gcd 1 and no interior point. A fold chained over k levels has k − 1.

### 3.12 What stays

- Pass 1, the gates, `sameMat`, one wedge per cell.
- `Built`, plus an additive `corners` count of fills and a `gaps` count of the
  ends still capping into a corner the pass did not match. `wedges` still counts
  pass 1 cells.
- The weld splits by normal and uv, so a fold stays a hard edge.
- The skin, the glTF writer, the three adapter and the app.

## 4. Steps, each landing green

1. **Slopes through the tracer** (§3.10), no fills yet. The surface is
   unchanged and tapered slopes lose triangles. Engine tests. Verified by eye:
   the Car, the Truck and the Cube look as they do now.
2. **The T-junction repair** (§3.11). No visible change. Engine tests.
3. **Hips** (§3.5, §3.9) with `corners`. Verified by eye:
   - The test cube: the gaps over a floor and against a wall are gone.
   - A stepped pyramid with a color per side is four flat sides with sharp
     color edges.
   - A slab on a wider slab has a continuous chamfer around its corners.
   - `?diag=1` reports no boundary edges on those and on the Truck.
4. **Corner tetrahedra** (§3.6). Verified by eye: the test cube's three-slope
   corner closes with one facet.
5. **Unequal pitches** (§3.8). The rules are written against the sweep first.
   Verified by eye: the test cube has no gap left, and a box rounded 1:1 in one
   view and 1:2 in another closes at every vertex.
6. **Cut cubes** (§3.7). Verified by eye: a layered document with an inside
   corner on a floor closes with one facet, and the Truck's bed and chassis
   look right where layers meet.
7. **Valleys** (§3.7). Verified by eye: an inside corner whose two walls differ
   in color folds on a sharp color edge.
8. **Docs.** The header and the "Not handled" note of `wedge-mesh.js`, SPEC
   §Low-poly, the package README's step 6, and a plain sentence in README
   §Slopes and sharp edges with the built-in Read Me if it carries that
   section.
9. **The rim from the gap** (§3.13), last, over what the kinds leave. Verified
   by eye: `missed-case.png`'s dent closes, and the Car, the Truck and the Cube
   are untouched.

Engine minors for the mesh changes, app patches (decision 7).

## 5. Kit asks

None. Nothing here touches vintage-frames.

## 6. Tests

By `docs/TESTING.md`. The engine suite covers the rules. No app test.

- `wedge-mesh.test.mjs`:
  - The plinth welds watertight, reports four corners and costs a frustum's
    triangles.
  - The pyramid, one color and two, welds and has four slope regions. With two
    colors each side's triangles sample their own side's swatch.
  - A hip whose shared solid is a wall welds.
  - A hip fills when each triangle's two rim edges share a color, whatever the
    floor it hides, and stays a gap when one triangle's edges differ.
  - A chamfer ring on a floor of another color closes at its corners when the
    ring's corner is painted, and stays a gap when it is not.
  - Hips of each box, 2×1×1, 2×2×1 and 1×1×2, weld watertight.
  - A hip with another layer's solid beside its box welds.
  - An L whose plan corner is bevelled 1:2 and whose tops are chamfered 1:1
    closes from the rim alone, over the wall face between the three caps.
  - A box vertex with three 1:1 chamfers closes with one triangle and welds,
    and so does one with an axis doubled. Two colors of three fill in the
    majority color. Three colors keep the gap.
  - The sweep of §1.5 welds watertight in every combination, at every step.
    After step 5 no end in it caps except a flush gable.
  - The test cube welds.
  - An L slab on a floor, one high and three high, is a cut cube: it welds,
    and a triangle has the diagonal normal.
  - An inside corner with walls of two colors is a valley and welds. A 2:1 arm
    meeting a 1:1 arm at a wall is a valley and welds.
  - The bevelled slab on a floor welds with no cap at the corner.
  - The corner gates hold under the ±1 farble.
  - The existing tests stand.
- `t-junction.test.mjs`: a vertex inside an edge that changes all three
  coordinates splits it, and the result has no T-junction.
- `regions.test.mjs`: nothing new. The tracer's contract is unchanged.

## 7. Decisions

1. **Color: two edges of one color.** The rule of §3.2. It replaces three
   drafted gates: a hip's hidden floor matching either arm, arms gating alone,
   and a triangle in no slope's plane needing one color.
   _Decided 2026-09-19, the user's rule: "the test for whether we fill a 3 edge
   gap should be if 2 or more of the edges have the same color - if so - the
   fill triangle gets that color. for our 4 edge caps that we split into two
   triangles - the same rule applies - and would yield our perfect pyramids."_
2. **A floor that runs on in another color.** A block with a chamfer ring
   painted around its foot on a floor of another color, or a windshield meeting
   sloped side glass over a body of another color. The face past the hip's
   floor edge is the floor beyond, so by decision 1 alone neither triangle has
   two edges of one color and the corner stays a gap, with no way to paint
   around it. Recommended: a rim edge also counts the color of the gap's own
   face on its near side, here the floor the hip hides, which the artist
   paints with the ring. The pyramid is unchanged, since the far side already
   matches. The alternatives: the far side only, or let an end edge decide its
   triangle alone.
   _Decided 2026-09-19: as recommended ("go with your reccomendation")._
3. **A four-point rim splits on its raised diagonal.** §3.2: it is the hip and
   the valley where pitches agree, it carries the longer slope through where
   they differ, and it is one sign test.
   _Decided 2026-09-19, the user's rule: "only one of the crosslines will be
   'raised' across the gap, the other will be flush to a face. we choose the
   raised one always."_
4. **A one-color inside corner is a cut cube, chamfer above or not.**
   Recommended: the y-ridge prism is valid there by today's notch rule, and an
   L slab with no floor already chamfers that corner. The alternative is a
   valley when no third arm continues, which leaves a cap under a third arm
   that does.
   _Decided 2026-09-19: as recommended._
5. **Unequal pitches fill with a lattice facet.** Recommended (§3.8). The
   alternatives: leave those gaps, which the sweep finds in 436 of 729 style
   mixes, or clip exactly on rational coordinates, which costs the integer
   lattice in the weld, the tracer and the T-junction repair.
   _Decided 2026-09-19: as recommended._
6. **Drop the chord skip.** Recommended (§3.11). The alternative marks fold
   edges and passes them to the repair.
   _Decided 2026-09-19: as recommended._
7. **Versions.** Recommended: engine 0.6.0 after step 4, 0.7.0 after step 5 and
   0.8.0 after step 7, an app patch with each. The alternative is one engine
   release after step 7.
   _Decided 2026-09-19: as recommended._
8. **The diagonal run is a follow-up.** Recommended: see §8. The alternative
   builds it with step 6.
   _Decided 2026-09-19: as recommended._
9. **Always on.** Recommended: like the wedges, with the gate as the control
   and `?flat` firing ungated. The alternative is a `wedgeMesh` option.
   _Decided 2026-09-19: as recommended._

## 8. Follow-ups

- The diagonal run. Along the foot of a wall that is a staircase in plan, cut
  cubes alternate with floor-only cells. A corner tetrahedron in each of those
  cells puts every facet on one plane x + y + z = c. Merging them needs a
  tracer for a triangular grid.
- Inside corners with one axis doubled: the cut x/a + y/h + z/b ≤ 2 is on the
  lattice when the three arms agree on a, b and h.
- The exact trim where a 1:2 end meets a 1:1 end away from a corner, from the
  1:2 plan.

## 9. Files touched

| File                                     | What                                                 |
| ---------------------------------------- | ---------------------------------------------------- |
| `packages/core/src/wedge-mesh.js`        | the corner pass, the shared end logic, traced slopes |
| `packages/core/src/t-junction.js`        | edges that change all three coordinates              |
| `packages/core/test/wedge-mesh.test.mjs` | the fills, the gates, the sweep                      |
| `packages/core/test/t-junction.test.mjs` | a split fold edge                                    |
| `packages/core/README.md`                | step 6 and the gate paragraph                        |
| `docs/SPEC.md`                           | §Low-poly                                            |
| `README.md`                              | §Slopes and sharp edges                              |

`regions.js` should need no change.

## 10. Notes for the build

- A 1:2 fires on a strict two-by-one step. A fixture whose tread is two cells
  wide becomes a 1:2 corner. Keep treads one cell, or three and more, for 1:1.
- `sameMat` is not transitive. Test the pairs the rule names.
- `removed` takes only exposed faces that the fill covers whole.
- Slope merging compares packed colors exactly. A long half spans two rows, so
  both rows need one packed color.
- `Wedge` is a JSDoc typedef and the package typechecks. Guests and fills need
  their fields typed.
- `earcut` is pinned at 3.0.2. Its diagonal picks decide triangle counts only
  inside a region, never the count of a triangle or a trapezoid.
- The app has nothing to change. `buildModel` carries the mesh to the 3D View,
  the atlas, the export and the icons.
- The sweep. Skip the views: build `{dims, solid, surfaceMask, faceColor: new
Map()}` by hand and call `wedgeMesh(result, { flat: true })`, which skips the
  gate and the skin. The body is cells 1 to 10 on x and z and 0 to 9 on y in a
  12-cell lattice. A style is the cells cut from a 2D corner per row, outer row
  first: square `[]`, 1:1 `[1]`, `[2,1]`, `[3,2,1]`, shallow `[2]`, `[4,2]`,
  steep `[1,1]`, `[2,2,1,1]`, round `[4,2,1,1]`. The front view cuts the
  (+x, +y) corner, the side (+z, +y), the top (+x, +z), and a cell is solid
  when all three keep it. `surfaceMask` bits follow `FACE_KEYS`. A lone end is
  a flush gable when neither of its wedge's solids runs on past the end.
- An end that faces the p cell of a 1:2 keys to another cell than that 1:2's
  own end, which keys by q. Unequal-pitch corners show up as lone or partial
  groups for that reason.

## 11. Fixtures

Sprite rows for `img` in `packages/core/test/helpers.mjs`. `T` and `R` are its
palette letters.

```
plinth, one hull          front, right: '.TT.' 'TTTT'      top: 4×4 of T

pyramid 5/3/1, one hull   front: '..T..' '.TTT.' 'TTTTT'   right: the same in R
two colors                top: 'TTTTT' 'RTTTR' 'RRTRR' 'RTTTR' 'TTTTT'

floor, a layer            front, right: blank rows over one full row
                          top: full
L slab, a layer           front, right: full rows over one blank row
                          top: 'TTTTTT' ×3 then 'TTT...' ×3

bevelled slab, a layer    front, right: '.TTT.' '.....'
on a 5×5 floor            top: '.....' '.TTT.' '.TTT.' '.TT..' '.....'

the test cube, one hull   front: '........' '..TTT...' '.TTTTT..' '.TTTTTT.' ×4 '........'
(tile 8, left not right)  left:  '........' '..TTTT..' '..TTTTT.' '.TTTTTT.' ×4 '........'
                          top:   '........' '...TTTT.' '.TTTTTT.' ×3 '..TTTTT.' '...TTTT.' '........'
```

The layered ones are `unionVoxels([floor, slab])`.
