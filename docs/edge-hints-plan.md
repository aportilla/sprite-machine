# Plan: edge hints — the neighbouring faces' seam pixels, framing the canvas

**Status:** built 2026-09-09 as planned but for decision 2, which the Car
overturned within the hour (see below). Written against the app as of
`c08b252`. The feature name in the source is **edge hints**; the thing it
draws is a **strip**, and the lattice line two faces share is a **seam**.

**As built, where the code departs from the text below — decision 2 is
reversed: the strip is a FIRST HIT, not the seam line.** Built to the plan,
the Car showed nothing at all on any edge: like most sprites its art carries a
margin inside its tile, so the outermost line of every neighbour is
transparent and the strips were empty. Only the Cube, which fills its tiles,
showed anything. The strip therefore walks **inward** from the seam to the
first painted texel — which is what the user asked for in the first place
("the front-most **coloured** pixels"), and what makes the aid work: editing
FRONT you get the side view's nose profile row by row. The reading is honest
because **registration is about the axis the two faces share** — a roof line
at row y in the side view must be at row y in the front view — so how deep
along the depth axis the evidence sits does not bear on it, and the pipeline
already colours faces by exactly this depth-aware first hit (`colorize`). The
seam table, §2's derivation and everything else stand unchanged; only the
reader moved, `at` becoming `from` (the end the scan starts at). §9's test
gained a decoy texel one step deeper on every one of the twenty-four seams, so
the suite now pins which end the scan starts from as well as the line and the
direction. **§9's other error:** ALL EIGHT goldens frame a
document window, not six — `?fresh=1` opens the sample as an untitled
(main.js boot path 1), so `boot-about` and `desktop-patterns` carry the Car's
canvas behind their box too. All eight re-bless. Seven of them were **already
stale before this work**: vintage-frames went to 0.7.2 in `ca84c64` (11:18)
after the set was blessed in `70060c4` (09:37), moving two to four bytes in
every shot but `desktop-patterns` — the kit bump goldens.sh's own header warns
about, never regenerated. The re-blessing here folds that in.

The one-sentence spec: **just outside each edge of the draw canvas, one
texel of the adjacent face's art — the row or column of that face which
meets this face along the shared lattice edge — drawn on the canvas's own
texel lattice, continuing its rows and columns exactly.**

It is the onion-skin's sibling. The onion-skin answers "where is the
opposite face's art behind mine?"; the edge hints answer "what does the
art wrap into when it leaves my edge?" — the roof line arriving from the
side view, the nose arriving from the top view. Both are registration
aids for the same reason the carve exists: a tile is a literal slice of
the voxel lattice, so a FRONT pixel is only solid where the SIDE covers
its row and the TOP covers its column, and the author has to line those
up by eye.

---

## 1. The model

Editing view **V**, the canvas is `tileW × tileH` texels. Four strips are
drawn, each one texel deep, immediately outside V's four edges:

- the strip's texels sit **on V's lattice**, continuing its rows and
  columns — no gap, no separator, no hairline. A one-pixel gap or a rule
  between the canvas and the strip would put the hint half a texel out of
  register and the aid would lie. This is the feature's load-bearing
  constraint and everything in §4 exists to serve it.
- each strip is the **line of the neighbouring face's tile that lies
  against the shared seam** — for FRONT's left edge, the RIGHT tile's
  front-most column; for FRONT's top edge, the TOP tile's front row. §2
  derives all twenty-four.
- the four **corner texels stay empty**: a corner is a lattice _edge_
  of the voxel box, shared by no single face, so there is nothing
  honest to draw there.
- a neighbour with no art of its own contributes its **mirror-derived**
  art — its opposite's tile, flipped, exactly as `MIRROR_AXIS` defines
  it for the onion-skin and as the carve colours it. A neighbour whose
  opposite is empty too contributes nothing (transparent).
- the strips are **derived state on the change channel**, never the live
  one. Editing V can never change a strip: V's four neighbours are the
  four faces other than V and V's opposite, that set is closed under
  `VIEW_OPPOSITE`, so no stroke on V can move a neighbour's own art _or_
  a neighbour's mirror source. The strips recompute on a face switch, a
  tile resize, an undo, an all-faces replace and a load — the same
  cadence as `mirrorBehind`, through the same memo, at zero hot-path
  cost.

---

## 2. The geometry: which line comes from where

### 2.1 The derivation

Nothing here is authored. `views.js` already publishes `VIEW_IMAGE_AXES`
— for each view, which world axis its image columns and rows run along
and whether the image index runs with the world coordinate (`flip:
false`) or against it — probed from the projections at load so it cannot
drift from them. The seam table is probed the same way, from
`VIEW_IMAGE_AXES`, `VIEW_AXES`, `FACE_NORMAL` and `faceKeyOf`. One home
for the convention; the table is a reading of it.

For view **V** and edge **E**:

1. **The edge's axis.** `left`/`right` sit on V's column axis, `top`/
   `bottom` on its row axis. The image index there is `0` for
   `left`/`top`, `max` for `right`/`bottom`.
2. **The neighbour.** Convert that image index to its world coordinate
   through V's flip (`0 → flip ? max : 0`); the coordinate is either the
   low or the high end of that world axis, which gives the outward sign,
   and `FACE_TO_VIEW[faceKeyOf(axis, sign)]` names the neighbour **N**.
3. **N's seam line.** N's plane spans V's _depth_ axis and the axis
   running _along_ the edge. The line we want is at V's own facing
   extreme along the depth axis — `max` where V's face normal is
   positive, `0` where it is negative — converted through N's flip on
   that axis into a first-or-last row or column of N's tile.
4. **The direction.** Along the seam, the strip is **reversed iff V's
   and N's flips on the shared tangent axis differ**.

### 2.2 The table it produces

Read "FRONT's left edge shows the RIGHT tile's last column, top to
bottom". _rev_ means the strip runs against the canvas's own direction.

| Editing | left edge             | right edge           | top edge             | bottom edge            |
| ------- | --------------------- | -------------------- | -------------------- | ---------------------- |
| FRONT   | RIGHT last col        | LEFT first col       | TOP first row        | BOTTOM first row _rev_ |
| BACK    | LEFT last col         | RIGHT first col      | TOP last row _rev_   | BOTTOM last row        |
| LEFT    | FRONT last col        | BACK first col       | TOP last col         | BOTTOM first col       |
| RIGHT   | BACK last col         | FRONT first col      | TOP first col _rev_  | BOTTOM last col _rev_  |
| TOP     | RIGHT first row _rev_ | LEFT first row       | FRONT first row      | BACK first row _rev_   |
| BOTTOM  | LEFT last row         | RIGHT last row _rev_ | FRONT last row _rev_ | BACK last row          |

Two facts to check it against. The user's own statement of the feature:
editing FRONT, the left edge shows the RIGHT tile's **last** column —
and the RIGHT view puts the object's front at its right column
(`u = z`), so that IS the front-most column of the side art. And the
whole table is **symmetric**: a cube has twelve edges, each shared by
exactly two faces, so the twenty-four entries pair up — `front.left`
reads RIGHT's last column while `right.right` reads FRONT's first
column, both unreversed; `front.bottom` reads BOTTOM's first row
reversed while `bottom.top` reads FRONT's last row reversed. All twelve
pairs agree, reversal included. That symmetry is the unit test (§9).

### 2.3 Tile shapes

Every tile in a document is `tileW × tileH`, and square tiles are the
registering shape, so every seam matches length for length. An
asymmetric sheet (the `?tile=WxH` hook, which already warns and shears)
can put a `tileH`-long edge against a `tileW`-long line — TOP's left
edge against the RIGHT tile's rows, say. The reader indexes
defensively: out of range yields a transparent texel, never a throw and
never a wrapped read.

---

## 3. Where it lives

The existing three-layer arrow — presentation → app state → domain —
already has a slot for exactly this shape of thing, next to
`mirrorBehind`. Nothing new is invented.

```
src/lib/edges.js          NEW, pure, Node-tested: the seam table probed from
                          views.js, and the frame builder — (views, tileW,
                          tileH, view) -> the (tileW+2) x (tileH+2) RGBA frame
src/state/derive.js       editorViewModel gains `edgeHints`, beside `tile`,
                          `wasDerived` and `mirrorBehind` — same memo, same
                          identity contract
src/components/sm-editor.js       one more prop down: .edgeHints=${vm.edgeHints}
src/components/sm-draw-canvas.js  the frame's own placed container + canvas,
                          the fit's reserved texel, #paintHints()
```

`lib/edges.js` exports:

```js
export const EDGE_HINT = 1;              // texels reserved on each side
export const EDGE_SEAMS = { … };         // probed: view -> edge -> {view, line, reverse}
export function edgeHintFrame(views, tileW, tileH, view) -> {width, height, data} | null
```

`edgeHintFrame` returns the whole `(tileW + 2) × (tileH + 2)` RGBA frame
with the middle and the corners transparent, ready for one
`putImageData` — the pure layer owns the frame's shape, the component
owns only where it lands. It returns `null` on a zero tile, the way
`mirrorBehind` returns null with nothing to show.

The memo in `sm-editor.js` needs no change: its key is already
`(face, views identity, tileW, tileH)`, and `applyTileEdit` mutates
`views[face]` in place, so a live stroke leaves the key — and the frame
— alone by construction. A structural change replaces `views` wholesale
and the frame recomputes with the rest of the view model.

---

## 4. The layout: the fit reserves a texel on each side

Today `#layout()` fits the largest whole-system-px texel inside the
well, then places one `vf-container` — the art stack — centred by
arithmetic in whole system px. Two things change.

**The fit's denominator grows by two on each axis.**

```js
const pad = this.edgeHints ? EDGE_HINT : 0; // texels per side
const fitW = this.tileW + 2 * pad;
const fitH = this.tileH + 2 * pad;
const k = Math.max(1, Math.floor(Math.min(availWSys / fitW, availHSys / fitH)) || 1);
const sysW = this.tileW * k,
  sysH = this.tileH * k; // the ART box (unchanged rule)
const outW = fitW * k,
  outH = fitH * k; // the OUTER box
const outLeft = Math.round(padL / scale + (availWSys - outW) / 2);
const outTop = Math.round(padT / scale + (availHSys - outH) / 2);
```

The outer box is what centres; the art stack sits at
`outLeft + pad * k, outTop + pad * k`. Every one of those is a whole
count of system px, so both boxes land on the device-pixel lattice by
construction — the same guarantee the single container has today, from
the same contract (a texel of `k` system px covers
`k × (--vf-scale × trueDpr)` device px, a whole count by the kit's scale
rule). The centring rounds once, on the outer box, and the art follows
it — so the art can sit half a system px off true centre exactly as it
can today, and never off the lattice.

The cost is real and intended: a 40 × 40 tile in a ~500 system px well
goes from `floor(500/40) = 12` to `floor(500/42) = 11` system px per
texel. The user asked for the space to be reserved; the alternative —
painting the strips into the well's 12 px padding without shrinking the
art — was rejected because the padding is a fixed 12 system px while a
texel is 11 or 12 or 20, so the strip would be clipped or overlapped at
most tile sizes and would jump between them.

**A second placed container carries the frame.**

```
.editor-canvas-wrap                      (relative, padding 12 system px)
  vf-container.editor-canvas-hints       NEW — outW × outH at (outLeft, outTop)
      canvas.editor-canvas-hint          (tileW+2) × (tileH+2) native, CSS-upscaled
  vf-container.editor-canvas-stack       sysW × sysH at (outLeft + k, outTop + k)
      canvas.editor-canvas-bg            ← the four existing layers, untouched
      canvas.editor-canvas               ← pointer events, its own box unchanged
      canvas.editor-canvas-cursor
      canvas.editor-canvas-select
```

Why a sibling container rather than growing the stack and insetting the
four layers inside it: the pixel canvas keeps its own box, so
`#toTexel`'s `getBoundingClientRect` math is untouched; the four layers
keep `inset: 0`, so nothing inside the art box acquires a fractional
offset at a fractional `--vf-scale`; and the frame gets its own
**declared pattern**, which is the whole visual story in §5. It also
makes the feature reversible in one commit: delete the container, set
`pad` to 0.

Two details. The frame container declares a pattern like every
`vf-container` over paper — a bare one inherits the desktop's ink,
blurred (kit ask #6). And the art stack takes `z-index: 1` so its
layers' own z-indices cannot interleave with the frame behind it.

The hint canvas is **native-resolution** — `(tileW+2) × (tileH+2)`,
one `putImageData`, CSS upscaling it crisp under `image-rendering:
pixelated`, exactly as the pixel canvas does. The upscale is a whole
multiple by construction, so there is no resampling question.

`#paintHints()` mirrors `#paintBg()`: called from `updated()` when
`edgeHints` changes, and from `#layout()` after a re-fit (a backing
resize clears the canvas). `#layout()`'s early-return guard gains `pad`
beside `k` and `scale`, so the first frame to arrive with hints re-fits.

---

## 5. The look

The drawable area must stay legible as the drawable area, and the strips
must not be mistaken for art. The canvas already says which is which
with paper: it wears the kit's 12% dither (`gray-12`), the transparency
indicator, on the white artwork well.

**The frame band is the well's white** (`pattern="white"`, the Full
Sprite View header's own grammar). So the dithered rectangle remains
exactly the drawable canvas, the strips read as art laid on the white
well just outside it, and no new visual vocabulary is introduced — the
1-bit chrome gains nothing, the sprite art stays the only colour. It
also means white art in a strip is invisible; that is the same trade the
well already makes everywhere outside the canvas, and it is the reason
the alternative in §8 is on the table.

The strips draw at **full opacity**, not the onion-skin's `MIRROR_ALPHA`
fade. The fade exists because the onion-skin sits _behind_ the art and
must never be mistaken for it; a strip is outside the canvas, cannot be
confused with the art, and is only useful if the author can read its
exact colours against the row they are drawing.

Nothing else changes: no rule, no label, no readout, no caption, no
change to the status strip, and nothing is drawn over the art.

---

## 6. What this is not

- **Not interactive.** The hint canvas takes no pointer events. The
  eyedropper does not sample a strip, the pencil does not paint into
  one, a rect drag does not extend into one, and `#toTexel` still
  rejects everything outside the art box.
- **Not a first-hit search.** The strip is the neighbour's line _at the
  seam_ — the literal adjacent texels — not "scan inward until something
  is painted". A first-hit strip would show art that is not at the seam
  and would misregister the author against the depth axis. §8 records
  it as a decision in case the eye disagrees.
- **Not on the live channel.** §1's closure argument means a strip
  cannot change under a stroke, so nothing repaints at pointer rate.
- **Not toggleable.** Always on, like the onion-skin and like smooth
  slopes. The `pad` seam in §4 makes a `View` toggle a small change if
  it is ever wanted; nothing is built for it now.
- **Not the atlas grid's business.** The Full Sprite View shows the
  whole sheet already; hints are the edit canvas's aid alone.

---

## 7. Steps

Each step leaves the app running.

1. **`src/lib/edges.js`** — the probe, `EDGE_SEAMS`, `EDGE_HINT`, the
   effective-art reader (own tile, else the opposite mirrored by column),
   and `edgeHintFrame`. Nothing consumes it yet.
2. **`test/edges.test.mjs`** — §9's rules. Red to green with no UI in
   play.
3. **`src/state/derive.js`** — `editorViewModel` returns `edgeHints`.
   `test/derive.test.mjs` gains nothing (the frame's rules are edges').
4. **`sm-editor.js`** — one prop down.
5. **`sm-draw-canvas.js`** — the property, the template's second
   container, `#paintHints()`, the fit's `pad`, the early-return guard,
   and the header comment (the module's comment block is the subsystem's
   documentation; the four-layer stack becomes four layers over a frame).
6. **Eyeball** — the Car at `?sample=car&edit=front`, then `edit=top`
   and `edit=right` (the derived face, where the neighbours are
   mirror-fills). What to look for is in §12.
7. **README** — §Drawing editor's canvas-layout bullet (the fit reserves
   a texel a side), a new bullet for the hints, the closing onion-skin
   sentence (two registration aids now), and the `src/lib/` map line.
8. **Re-bless the goldens** in the shipping commit, after an eye on the
   diff, and run the standing gates.

---

## 8. Decisions for the user

Defaults are chosen and the plan is written to them; say so only where
you disagree.

1. **The frame's paper — white.** The dithered rectangle stays the
   drawable area and the strips sit on the well. The alternative is
   `gray-12` across the whole outer box, so the strips sit on the same
   dotted paper as the art and white hint pixels read as clear patches —
   at the cost of the canvas's boundary becoming invisible. A third
   option, a darker pattern (`gray-25`) reading as a recessed mat,
   is available but is noise at small texel sizes. This one is an eye
   question; it is one attribute either way.
2. **The seam line, not a first-hit scan.** §6. If the Car's nose turns
   out to leave the FRONT's left strip nearly empty in practice and you
   want the first painted texel walking back from the seam instead, it
   is a different reader over the same table — but it stops being an
   honest picture of the seam.
3. **Mirror-derived neighbours contribute.** A neighbour with no art of
   its own shows its opposite, mirrored — what the model will actually
   render. The honest-sheet alternative (a derived neighbour shows
   nothing, the way the face picker opens a derived face empty) would
   leave the Car with no left-edge hint at all while editing FRONT,
   since it ships without a RIGHT view.
4. **Always on, no menu item.** §6.
5. **Full opacity, not faded.** §5.

---

## 9. Tests, by `docs/TESTING.md`

Question 1 applies — new pure logic with inputs and outputs — so
**`test/edges.test.mjs`**, on the rules and nothing else:

- **The seam relation is symmetric.** For every one of the twenty-four
  (view, edge) entries, the neighbour's own entry pointing back names
  this view's matching line and agrees on the reversal. Twelve pairs,
  the cube's twelve edges — a rule, not a table restated.
- **A marked texel lands where the convention says.** A synthetic sheet
  with one opaque texel at a known place in one tile; assert the index
  it appears at in the neighbouring face's strip. Four cases, covering
  each axis pair and at least one reversed seam (`front`'s bottom edge
  from BOTTOM, `top`'s left edge from RIGHT).
- **The mirror fallback.** A neighbour with no art of its own yields its
  opposite's line, mirrored; with neither, a transparent strip.
- **The frame's shape.** `(tileW+2) × (tileH+2)`, the middle and the
  four corners transparent, and an empty sheet yielding an empty frame.

Nothing else. **No drive check**: the frame is derived state with no
wiring of its own — no menu item, no gesture, no stored record — and
S21 already crosses the canvas's re-fit (`the draw canvas re-fits when
the grow box grows the document window`), which the reserved texel does
not change. **No SMOKE item**: there is no gesture to feel. **No layout
assertion**: the fit's arithmetic is layout numbers, and the goldens
frame it.

**Goldens:** six of the eight frame a document window and all six move,
both because the canvas re-scales and because the strips appear —
`editor-pencil`, `editor-rect`, `editor-selection`, `editor-fill`,
`derived-face`, `atlas-strip`. They re-bless in the shipping commit
after the diff has been eyeballed. (`boot-about` and `desktop-patterns`
have no document window and must not move; if either does, something
else broke. Note the known boot-about date staleness on a commit day.)

Standing gates: `npm test`, `npm run lint`, `npm run typecheck`,
`node tools/drive.mjs <port>`, `tools/goldens.sh check <port>` — against
a **fresh** dev server on a free port, never a long-running 5173.

---

## 10. Files touched

```
src/lib/edges.js                     new
test/edges.test.mjs                  new
src/state/derive.js                  editorViewModel gains edgeHints
src/components/sm-editor.js          one prop
src/components/sm-draw-canvas.js     the frame container + canvas, the fit's pad,
                                     #paintHints, the header comment
README.md                            §Drawing editor (two bullets + the closing
                                     sentence), the src/lib map line
docs/goldens/*.png                   six re-blessed
docs/edge-hints-plan.md              this file
```

No kit ask. Nothing the kit ships is missing here: a second placed
`vf-container` with a declared pattern is the kit's own grammar, and the
existing bridge for kit ask #6 (every container over paper declares one)
covers the new box.

---

## 11. Follow-ups, if they earn their place

- **Eyedropping a hint texel.** Natural and cheap once the strip exists
  — but it means giving the frame pointer events and a hit test, and a
  click just outside the canvas currently drops a selection. Out of
  scope.
- **The corner texels.** Empty by decision. A cube's corner is a lattice
  _vertex_; if three-face registration ever wants a mark there, it is a
  different feature.
- **The registered move.** Already in the README's next steps: a
  selection move that keeps the atlas in registration. Edge hints make
  the misregistration a one-face move causes visible, which is a good
  reason to want it sooner.
- **A depth cue.** A strip could dim with distance if a first-hit
  reader ever ships (§8.2), so the author can see how far back the
  matching art sits. Speculative.

---

## 12. Risks and gotchas

- **The seam between the two containers.** The two boxes must meet with
  no gap and no overlap. The kit's scale contract makes them integral in
  device px, so they should meet exactly — but this is the one thing to
  put an eye on first, at browser zoom 100%, 125% and 200% and on a
  Retina display. A one-device-px light line between the strip and the
  art means the two containers are snapping differently and the
  single-container variant (§4's rejected shape) is the fallback.
- **The strip must be on the art's lattice.** Look along a row: a hint
  texel's top and bottom edges must line up dead-on with the canvas row
  it sits beside. If it is off by a fraction, the aid is worse than
  nothing.
- **A privacy browser's canvas farbling** perturbs `getImageData` by ±1,
  which is why the wedge gate snaps and tolerates. Nothing here reads
  pixels back — the frame is built from the document's own typed arrays
  and only ever written — so it is not exposed.
- **The reserved texel changes every canvas shot.** Expect all six
  document-window goldens to differ wholesale (a re-scale, not a
  last-bit diff); that is the change, not a regression, and it is worth
  saying so in the commit.
- **`?tile=WxH`'s sheared sheets** put mismatched seams together. The
  reader clamps (§2.3); do not let a length assumption in.
