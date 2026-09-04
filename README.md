# sprite machine

Turn low-resolution pixel-art **face sprites** (top / front / side / …) into a
real, rotatable **Three.js 3D object** — the chunky look is baked into the
geometry, not faked by a shader.

![voxel car from a 3×2 pixel atlas](docs/car.png)

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit + integration suites (node --test)
npm run typecheck  # tsc checkJs over src/ (JSDoc types)
npm run lint       # prettier --check .   (npm run format to fix)
npm run build      # static bundle in dist/
```

Two headless-Chrome tools verify what Node can't, both against a running dev
server:

```bash
tools/capture.sh shot 'http://localhost:5173/?sample=car&rotate=0' /tmp/shot.png
tools/capture.sh dom  'http://localhost:5173/?diag=1&rotate=0'   # light-DOM shell + title
node tools/drive.mjs                                             # desktop + editor smoke test
```

`capture.sh` shows what the app **looks** like — its shots are byte-deterministic
(fixed window size, DSF 1, virtual time budget, `rotate=0`, `?fresh=1` on a
machine with saved docs or a set desktop pattern, `?now=<when>` whenever
the menu bar's clock is in frame, and a selection only ever through
`?select=…`, whose ants stand still — a live selection's would tick between
shots), so `cmp` between two runs is a real
regression check
rather than a judgment call (its `dom` mode only serializes light DOM — the
desktop skeleton and `<title>`, never the components' shadow internals).
`drive.mjs` covers what no screenshot can: it drives the desktop over the
DevTools Protocol with real trusted input (keys, menu picks, ⌘-equivalents,
drags, window moves and grow-box resizes, the dialogs, a save → reopen
round-trip through IndexedDB), probing through the components' shadow roots,
and exits non-zero on any failure. The residue neither can cover reliably is
a short manual checklist: `docs/SMOKE-TEST.md`.

The app is a **System 7 virtual desktop**, drawn end to end with the
[`vintage-frames`](https://github.com/aportilla/vintage-frames) web component
kit: a menu bar, an options strip, one movable **document window per open
document** (the pixel canvas — several documents can be open at
once), and floating **utility windoids** that serve whichever document
is active — three permanent ones, the **Tools palette**, the **Full Sprite
View** (the face picker over the whole atlas as a clickable face-tile grid,
live), and the **3D View**, plus the toggleable **3D Sprite Atlas** (View
→ 3D Sprite Atlas: the model rendered orthographically from a ring of
angles, the rotation set an engine consumes — and what File → Export Sprite
Atlas… saves) — plus documents
that live as **files on the desktop**, saved in the browser and reopened by
double-clicking their icons. Clicking the desktop is "switching to the Finder": the application
deactivates, its windoids hide, and the menus fall back to the desktop's
grammar. See [The desktop](#the-desktop).

The first-ever boot **seeds two starter documents** (Car, Cube) into the
library as perfectly ordinary saved files — edit, rename or delete them like
anything you saved yourself; they're created once and never come back (any
persisted state, even an emptied desktop, suppresses the seeding). Every
load **boots to the About box** — the classic launch splash: the icon, the
version, the blurb, the same dialog as Sprite Machine → About… (see
[The About box](#the-about-box)); OK it — or click anywhere outside it —
and the bare desktop is yours,
File → New…, an icon's double-click or File → Open… the ways in — unless
the URL names a saved
document (**`?file=Cube`**, or the bare fragment **`#Cube`**;
case-insensitive, most-recently-modified on a name collision), which opens
that library file directly, on its remembered edited face. A prior
session's open windows deliberately don't reopen — the URL, not
localStorage, says what a load shows — and **no window's geometry comes
back either**: every session places the windoids, and every open places
its document window, fresh from the live raster (see
[Windows](#windows)); only the desktop icons restore. And
the URL keeps itself true: opening, saving or
switching to a saved document **mirrors its name into the fragment**
(`#Cube`, via `replaceState` — no history spam; an untitled document or the
bare desktop clears it, and any `?file=` is canonicalized away), so a plain
browser reload restores exactly what's on screen. The same
built-ins live on as **templates in File → New…**, the New Document
dialog: an Empty Document at a chosen tile size, or a template as a
fresh untitled copy. **Double-click a desktop icon**, pick File → Open…, or
drop your own **3×2 sprite sheet** PNG anywhere on the window. **Smooth slopes** (low-poly additive 45° wedges) is
on by default and toggles live in the 3D View's controls strip ("smooth",
beside "rotate"); greedy meshing is always on.
Sprites are hard pixel art — every texel is fully opaque or fully
transparent — and every face with no view of its own is mirror-filled from
its opposite at render time. The **face picker** (six pixel-art cube icons
over radio buttons, the Full Sprite View windoid's header)
switches which of the six you're editing (a
mirror-derived face reads empty — an honest view of the sheet) — see
[Drawing editor](#drawing-editor).

## Input: a 3×2 atlas

One sheet, six tiles, in this fixed layout (empty cells are fine — they fall back
to mirroring):

```
LEFT   FRONT  TOP
RIGHT  BACK   BOTTOM
```

The **tile size is auto-derived** from the image dimensions and the grid (a
120×80 sheet ⇒ 40×40 tiles). Each tile is a **literal slice of the voxel
lattice** — a pixel's position inside its tile _is_ its position in the object,
so tiles are read at full size (**no auto-crop**) and must be **registered across
faces**: a FRONT pixel only becomes solid where the SIDE covers its row and the
TOP covers its column. Use **square tiles** (a cubic lattice); the in-app
editor's onion-skin helps you line pixels up across faces.

**Tile orientation** (world: `+x` right, `+y` up, `+z` = front toward camera) —
draw each tile this way for a zero-transform ingest:

| Tile         | Draw as…                                                | Front points | Size           |
| ------------ | ------------------------------------------------------- | ------------ | -------------- |
| FRONT / BACK | head-on / from behind, upright                          | —            | width × height |
| RIGHT        | the right side                                          | right        | depth × height |
| LEFT         | the left side                                           | left         | depth × height |
| TOP          | plan view, width horizontal                             | top edge     | width × depth  |
| BOTTOM       | plan from below (car rolled sideways, not end-over-end) | top edge     | width × depth  |

The **face picker** switches which tile you're editing; check each tile's
orientation against this table's **Front points** column, using the faded
onion-skin of the mirrored opposite behind the canvas.
Per-tile `rot`/`flip` transforms exist in the pipeline for sheets that don't
follow the convention.

## Drawing editor

The **document window** holds the drawing surface — the full-bleed white
artwork well (it runs edge to edge, title bar to status strip) — and the 3D
View rebuilds live as you draw; the **face picker** rides the Full Sprite
View windoid (see its bullet below).
The tools live in the floating **Tools palette**, their per-tool options in
the **options strip** under the menu bar, and the tile-size stepper in
File → Properties…. Every control is a `vintage-frames` System 7 web
component (`vf-number-field`, `vf-radio-group`, `vf-slider`, `vf-checkbox`,
`vf-swatch`, `vf-grid`, `vf-dialog`, `vf-menu`, …), driven from a Lit
template — see [UI layer: Lit](#ui-layer-lit).

- **Canvas layout** — the pixel canvas fills the artwork well — its height is
  **CSS-driven** (flex), no JS pin — and the square editable canvas is drawn
  on the kit's own **virtual system-pixel grid**: the texel size is **the
  largest whole count of system px that fits** — a texel is then a whole
  count of device px by the kit's scale contract (crisp at any display
  density or browser zoom, never a fractional pixel) and a whole multiple of
  the unit the surrounding 1-bit chrome is drawn in — and the canvas layers
  ride a **placed `vf-container`**: `#layout()` states its
  width/height/top/left in whole system px (the DITL rectangle, centered by
  arithmetic — no flex centering, no measured correction), so the box lands
  on the pixel lattice **by construction** and the container's own grid-snap
  holds it there against any upstream fraction. It **re-fits responsively**
  when the window (or its grow box) resizes and when the display density or
  browser zoom changes. The onion-skin background under the art and the
  cursor + selection overlays over it draw at system-px resolution, so their
  hairlines are 1 system px — the kit's hairline unit. See `#layout()` in
  `src/components/sm-draw-canvas.js`. The canvas is **1-bit but for the
  art**: its paper is the kit's **50% dither** — `gray-50`, the desktop's
  own default, painted by the kit as the stack container's `pattern` — the
  classic transparency indicator, so an empty texel reads as dither, a
  painted one covers it, and **white art** reads against it (no
  checkerboard, no dot grid); and nothing is drawn over the art — no
  lattice of grid lines, so a fresh canvas is paper and art alone. The
  sprite is the only color on the canvas.
- **Tools** — the **Tools palette** holds the **tool strip**: a single column of square
  cells (the **selection `S`** first — MacPaint's palette led with it — then
  **pencil `B`**, **rect `R`**, **fill `G`**, the **eraser `E`**, and the
  **eyedropper `I`**; the selected cell inverts) — each an icon from the
  open-source **Adobe Spectrum _workflow_** set (`rect-select` / `draw` /
  `rectangle` / `color-fill` / `erase` / `sampler`) in a frameless `vf-grid` lattice run
  flush to the windoid's edge — no inner padding, the cells sharing the
  window frame's own black line. A cell **picks on the press**, not the
  click — System 7's tool palettes act on mouse-down: the cell inverts the
  instant the button goes down and the tool is live before it comes back
  up. That is feel, not a bridge (see [Windows](#windows)): the click that
  follows lands, and is a no-op on the tool already current. The **options
  strip** (a kit-drawn band under the menu bar — a `vf-container` in the
  kit's own grammar, `pattern="white" rule="bottom"`: white paper over one
  row of ink, the menu bar's anatomy, no drop shadow — so its rule and every
  metric in it scale with the raster) holds the **current-ink swatch** plus
  the tool's options — no tool-name caption: the palette's inverted cell and
  the Tools menu's checkmark already say which tool is live, an
  eyedropper strip is just the swatch, and the selection's strip (no
  swatch — the one tool besides the eraser that lays no color) is a
  **readout**: the active window's marquee as `left, top · width × height`
  in texels, live through a drag, "no selection" at rest. For the **pencil**, a **tip-size slider** (with an
  `N px` readout) that stamps an
  **N×N** square footprint and **previews it filled with the active ink** on the
  canvas as you hover — the exact texels a stamp will cover, looking exactly as
  the art would after the click (a translucent red block while erasing, since
  transparency can't be previewed on an overlay) — with the **OS crosshair kept
  on top** marking the position. For the **rect**, a **corner-radius
  stepper** (`radius: N px`, `0` = sharp): **drag** a box and a **live preview**
  (the exact filled texels, tinted by the ink — red while erasing — under a haloed
  bounding box) tracks the drag on the top overlay; **release** commits it, and
  **Esc** (or switching tool with `B`/`R`) **cancels** the in-flight box with
  nothing written. Hold **Shift** while dragging to lock the box to a **square** (the
  shorter extent wins, anchored at the start corner) — toggleable mid-drag, so the
  preview re-fits the instant you press or release Shift. Each corner rounds with a **convex** quarter-circle arc (bulging
  outward like a real rounded rectangle, not a concave scoop; clamped to half the
  shorter side), so even `radius: 1` clips the corner texel; a
  **right-drag** drags a rectangular **erase**. The rounded-rect rasterization is a pure, Node-tested
  primitive (`src/lib/rect.js`) shared by the preview and the commit, so what you
  see is exactly what lands. For the **fill** (paint-bucket), two **checkboxes**:
  **contiguous** (on by default) keeps a click a **contiguous 4-connected
  flood** from the clicked texel (the connected region sharing its color
  becomes the active ink); turned **off**, the click becomes a **whole-face
  recolor** — _every_ texel matching the clicked color on the face, contiguous
  or not. **on all faces** (only enabled while **contiguous** is off) extends
  the recolor across **every face in the atlas**, so it's a global
  find-and-replace of one color. Transparency is a first-class "color": clicking
  empty space targets transparent (so **replace** floods every empty texel with the
  ink), and a **right-click** fills _to_ transparent (delete a
  color). The flood + replace are pure, Node-tested primitives (`src/lib/fill.js`).
  The **selection** (`S`) is MacPaint's selection rectangle: **drag a box**
  out on the canvas and it takes the **marching ants** — a 1-system-px
  black/white dashed border on the selection's outermost texels, walking the
  perimeter briskly (its own topmost canvas layer, so no hover painter can
  wipe it; it stands still under the OS's reduce-motion preference), and
  **1-bit by construction**: the ring is a clockwise pixel walk emitted as
  black and white **runs on whole system px** (`src/lib/ants.js`, pure,
  Node-tested — four on, four off, a phase step marching them one px
  forward, the classic seam at the start corner) that the painter fills,
  never a dashed stroke — a stroke's dashes are measured along a path that
  starts on a half pixel, so every dash end anti-aliases to gray — with
  the kit's **arrow** over the selection and the crosshair outside; **drag
  inside** the box and the selected pixels **move** with the pointer,
  leaving transparency behind (the sprite's "white" IS transparency — there
  is no paper color); **Shift** while moving constrains to the dominant axis
  (toggleable mid-drag). **Transparent texels inside the selection are not
  pixels and never travel**: a moved selection overwrites the destination
  only where it is painted, so art under its empty texels shows through
  untouched — the lasso's most useful property, for free. Click outside,
  press **Esc**, or pick another tool and the selection **drops** where it
  sits (a click with no drag makes no selection — the smallest is 1×2 — and
  never flashes a one-texel box; Esc mid-drag cancels the marquee, or puts a
  moving float back where it was grabbed). Push the float off the canvas
  and what's off-tile at the drop is gone, as MacPaint lost what you dragged
  off the page (Undo has it). A right-click does nothing with this tool; an
  Alt-click still samples (an empty sample selects the eraser — a tool
  change, so the selection drops). Each **move gesture is one undo step**; a
  marquee writes nothing. The selection is canvas state and **dies with the
  working buffer** — any structural change (undo/redo, a face switch, a tile
  resize, an all-faces replace) drops it, its pixels already in the document
  (MacPaint kept a selection through Undo; re-deriving a float from a
  restored tile isn't worth the machinery). Each **document window holds its
  own**: switching windows leaves both up, ants marching; Esc drops only the
  active window's, a tool switch drops every window's — and the options
  strip's readout follows the active one (the canvas reports its outline
  through `sm-selection` onto its context's own per-window selection store,
  the plumbing Edit → Cut/Copy will gate on). A move edits **this face
  alone** today — which can break the carve's registration (a roof shifted
  on FRONT no longer lines up with TOP); the **registered move** ("on all
  faces": a FRONT marquee is a slab of voxels, so its columns shift on
  TOP/BOTTOM and its rows on the sides) is the planned follow-up, spelled
  out beside `#applyMove` in `sm-draw-canvas.js`. Under the hood the
  model is base + float (`src/lib/select.js`, pure, Node-tested): the
  marquee's texels are lifted out **once** on the first move press, the hole
  they leave is cleared on a pristine copy, and every offset composites
  (base, float, offset) into the working buffer **in place** — so a drag
  across the sprite and back never smears what it crossed, and the buffer's
  identity (which the document holds by reference) never changes.
  Every edit is **undoable** (Edit → Undo ⌘Z / Redo ⇧⌘Z): a gesture — stroke,
  rect, fill, selection move — undoes as one step, and an all-faces replace or tile resize as
  one whole-sheet step (bounded history, ~50 entries, cleared on a document
  load). The **eraser** (`E`) is a formal _tool_ mode, a full sibling
  of the drawing ops in the strip — not a "transparent color" in the wells: a
  pencil that writes **transparency**, sharing the pencil's stroke path but
  carrying its **own tip-size** setting (a separate slider and a separately
  persisted value — the two tools' settings are deliberately independent), its
  hover footprint drawn in the red-tinted erase treatment. The ink stays a solid color throughout, and **picking any
  color while the eraser is held returns to the pencil** — a pick means "paint
  with this". A **right-click** is the _momentary_ erase with any tool (the
  right-drag rect is the rectangular erase; a right-click fill deletes a
  region); the eraser cell is the _sticky_ one. The **current-ink swatch**
  lives in the **options strip** (a lone `vf-swatch` well wearing the kit's
  hard shadow), shown for **every tool but the eraser** — the one mode that
  paints no color — and, **clicked**, it opens the **"Colors" dialog** over
  the **full 168-color named palette**. There is no "recent colors" row and no
  used-color marking — the grid is the plain palette, every open. The
  **eyedropper** (`I`) is a sticky mode exactly like its siblings: it stays
  selected, and every canvas click samples the clicked texel — a painted texel's
  color becomes the **ink**, and **empty space hands you the eraser** (sampling
  emptiness selects the eraser tool) — until another tool is picked (while it's
  active a 1-cell hairline outline marks its sample target under the OS
  crosshair). Hold **Alt** instead for a momentary sample that doesn't leave the
  current tool (with the same two exceptions: a color pick leaves the eraser, an
  empty sample selects it). The
  dialog is a System 7 movable modal (`vf-dialog`) laid out as a traditional
  form: the 21×8 `vf-grid` of **168 distinct named** swatches over a **hover
  readout line** and a row holding a larger **preview swatch** of the
  _pending_ selection (a kit shadow well) beside a **hex text field**
  (`vf-text-field`), and a **Cancel / OK** button row. **Hovering** (or
  keyboard-focusing) any palette cell makes the readout line show that color
  as a **chip beside its name and hex** ("Teal `#009a96`") — the cells
  themselves wear no hover chrome, System 7 style; at rest the line shows the
  _pending_ selection instead,
  named through the palette — a typed color no swatch holds reads **"Custom"**
  — so the row always names what OK would commit. Opening seeds the form from
  the current ink; clicking a palette swatch
  **selects** — preview and field update, the dialog stays up — and the field
  takes **manual hex entry** (3- or 6-digit, `#` optional, any case — _any_
  color, not just the 168). Only **OK** (or **Enter** in the field) commits
  the ink, through the same single pick path as ever; while the field's text
  isn't a valid hex code **OK is disabled** and the preview holds the last
  valid color. **Cancel**, **Esc**, or the **close box** discards the pending
  selection. The palette is laid out as **value-banded hue rows**: row 1 is
  the grayscale ramp (White and Black up front, then a dark-to-light run),
  and rows 2–8 each sweep the hue wheel red → yellow → green → cyan → blue →
  violet → magenta at one value band, ordered darkest ("darkest", "dark",
  "deep", "strong", "vivid") down to "light" and "palest" — so a column reads
  roughly as one hue across seven values. The arrangement is a fixed,
  hand-verified layout spelled out in `src/lib/constants.js` (`PALETTE_168`),
  every entry carrying the **human color name** the readout shows.
  **Wedge-safety caveat:** a few same-hue neighbors fall _within_ the low-poly
  wedge merge tolerance (`sameMat`, `TOL2 = 12²` squared-L2), so a staircase of
  two such shades can auto-smooth into a wedge. Recomputed against the real
  palette + gate there are **8 within-tolerance pairs**, all same-hue value
  neighbors in the darkest and palest rows — Dark Olive/Olive, Deep
  Teal/Petrol, Teal/Persian Green, Blush/Peach, Vanilla/Cream, Ice Blue/Pale
  Sky, Celeste/Pale Cyan, Frost/Glacier — and, unlike the earlier xterm-256
  set, **no gray pair merges** (the grayscale ramp steps ~10–13/channel, well
  clear of the gate). An author can still place two of those eight pairs on
  adjacent staircase voxels and get an unintended (but near-imperceptible)
  wedge. `test/palette.test.mjs` pins the exact set. Every stroke is
  hard-pixel: fully opaque or fully erased, never anti-aliased.
- **Face picker** — six **cube-view icons** over a radio row (a `vf-radio-group`)
  in the **Full Sprite View windoid's** header switch which face
  the **active document's** window edits (each document keeps its own
  selection — the picker, like every utility windoid, shows the active
  one's), laid out as mirror pairs
  (`left`/`right`, `front`/`back`, `top`/`bottom`)
  so you can flip between a pair for reference. A pick is an ordinary
  **click** on the radio or its icon (see [Windows](#windows) for why no
  windoid control needs a press-driven bridge). Each icon is a **21×26 pixel-art**
  isometric cube (`src/assets/faces/`, wired up inside `sm-face-picker.js` — the one
  component that renders and styles them): the three
  quads the view shows (`front`, `left`, `top`) fill **solid red**, and their hidden
  opposites (`back`, `right`, `bottom`) draw a thin red **sliver** peeking out along
  the silhouette edge they hide behind — "the far side of this one". Left/right in
  the icons is the **object's own** handedness (stage-left): `left` is the cube's
  lower-**right** quad, the way a car facing you shows its left flank on your right —
  deliberately not the world-axis reading (`left` = −x, on the viewer's left). The **checked**
  face takes a **50% red dither** (`selected.png`) laid over its whole cube; the
  overlay is always in the DOM and the picker's template flips its visibility class
  off the `selected` prop, so it never re-mounts (and never depends on the kit's
  internal radio state). Being raster pixel art, every tile goes through
  the kit's **`vf-img`** — one image pixel is one system px, magnified
  nearest-neighbor on whole device pixels — and the dither is positioned with
  `vf-img`'s own `top`/`left` (system px), so it stays registered to the art's grid
  at any display scale. The **atlas grid** below the strip is a picking
  surface too: pressing any face's tile selects that face (the same
  press-not-click rule), and the selected tile is **stroked in the face
  art's red** (`--sm-select`, `#ff4f4f`) — see the Full Sprite View bullet
  under [Windows](#windows). A **mirror-derived** face (one with
  no art of its own) opens with an **empty canvas** and a **faded onion-skin** of
  the mirrored opposite behind it for reference; it becomes its own independent art
  only once you actually change a pixel — switching away and back leaves it derived,
  and erasing it fully reverts it to derived.
- **Live + canonical** — edits write straight back into the current sheet, so
  File → Save persists exactly what you see, File → Download downloads it (see
  [Documents](#documents-a-document-is-a-png)), the **Full Sprite View**
  tracks every stroke at frame rate, and the model rebuilds (rAF-debounced)
  with no camera jump.
- **Tile size** — a single **square-tile number field** in File → Properties…
  retiles the whole atlas to any integer **1–64** (the ceiling keeps the
  live per-stroke carve — a synchronous O(n³) walk — tractable). Tiles are **locked square**, so
  every resize is **registration-preserving**, and the stepper **keeps the art centered**:
  each axis splits the size change around the sprite (`resizeAtlas` with `anchor:'center'`)
  so it stays put in the canvas as the tile grows / shrinks instead of hugging a corner —
  growing pads transparency on **both** sides, shrinking crops **both**. The odd texel of
  an odd-sized ± step **alternates ends** (by the new size's parity) so repeated clicks
  can't drift the art off-center, and a **typed jump divides the difference** as evenly as
  it can (`splitLow`). Because a square resize just **translates** the whole solid, no
  sprite shears out of registration — but centering the **vertical** axis means the object
  no longer pins to `y=0`, so a ground-rested sprite **floats up off the shadow plane** as
  the tile grows (an accepted trade for centered authoring). Square is the **only
  registering shape** — a 3×2 atlas shares its depth axis between the side tile's width and
  the top tile's height, so a non-square tile would over-constrain that axis and shear the
  depth; locking the stepper square makes that impossible from the UI. The pure
  `resizeAtlas` in `src/lib/atlas.js` still **defaults to origin-anchored** (each axis's
  origin line fixed, `y=0` pinned) for the pipeline, and still accepts an asymmetric pair
  (the `?tile=WxH` dev hook, which **warns** and shears) so the shear path stays testable.

Drawn pixels map 1:1 to voxels at their **literal tile position** — `buildVoxels`
reads each view at full size (no crop, no re-centering) and the carve intersects
the extruded silhouettes, so a pixel survives only where every view sharing an
axis agrees. To help meet that stricter requirement the editor draws a **faded
onion-skin** of the opposite face behind the canvas. There is **no auto ground-rest**: an object sits at whatever Y
you paint it (paint at the tile's bottom to rest on the ground). The editor is
pure authoring — no changes to the carve / colorize / mesh pipeline. See
`src/components/` (the `<sm-editor>` container and its leaves).

**Dev hook:** append `?edit=<face>` (e.g. `?edit=front`) to boot with the editor
on that face — it's always open now, so this just picks the starting tab. It's how
the editor gets exercised in headless screenshots (the capture tool can't click),
and it's handy for jumping straight to a face while iterating. It joins the other
test-only URL params: `?sample=<index|name>`, `?rotate=0`, `?lowpoly=0|1`,
`?flat=1`, `?diag=1` (watertightness self-check — only the default low-poly/wedge
mesh is guaranteed watertight; with `?lowpoly=0` the greedy-voxel mesh's unrepaired
step T-junctions show as _expected_ nonzero boundary/odd edges, not holes, so the
`DIAG` title is tagged with the mode), `?cam=top|front|fq|bq`,
`?tile=<N>` (or `<W>x<H>` to force an asymmetric, out-of-registration resize the
locked-square UI can't produce) to apply one **centered** tile resize (the same
`anchor:'center'` path the stepper drives) after the first build,
`?palette=1` to open the 168-color "Colors" dialog on the first mount, `?cursor=<N>`
to set the pencil size to N and draw its filled footprint preview at the tile center
on mount, `?pick=<N>` to select `PALETTE_168[N]` as the ink on mount (as if picked
from the dialog) so a shot can show it landing as the current-ink swatch, and
`?rect=<x0,y0,x1,y1[,r[,sq]]>` to select the rect tool and draw its live drag preview
for that box (corner radius `r`; `sq=1` for the Shift square-lock) on mount so a shot
can show the tool mid-drag, and `?fill=<x,y[,c[,a]]>` to select the fill tool, set its
checkboxes (`contiguous=c`, defaulting on; `on-all-faces=a`), and fill at `(x,y)` on
mount (the mount fill is always applied to the current tile only — combine with
`?pick=<N>` to fill with a specific palette color) so a shot can show the tool +
result, and `?select=<x0,y0,x1,y1[,dx,dy]>` to select the selection tool and
put that box up on mount — with an offset, lifted and floated there, the
pixels landing like a mount fill (no undo entry) — its **ants standing at
phase 0** (no ticker, so the shot stays byte-identical across runs) — the
stepper, face picker, dialog, swatch pick, hover preview, rect drag, fill click,
and selection marquee / move
can't be driven headlessly. Six shell-era params round the set out:
`?fresh=1` boots with **storage ignored** (no desktop-state restore, no
`?file` resolution, no saved-doc icons — a bare desktop now, every icon
being a saved doc — no first-boot seeding, no About box greet, and no
state writes — deterministic
captures on a machine with saved docs) and `?hide=<window>[,<window>]`
(`document|tools|sprite|stage|ring`) hides windows a capture needs out of frame,
`?ring=<views>[,<elevation>[,<offset>[,<size>[,<paper>]]]]` shows the
**3D Sprite Atlas** windoid (View → 3D Sprite Atlas, which boots hidden)
with those settings — `?ring=4` the default set, `?ring=8,30,45,128,gray`
eight views at 30° from 45° in 128 px tiles on the gray paper (the fifth
field is the body's paper, `white` / `black` / `gray` — a slice setting
nothing in the UI writes today, so this hook is the one way to see the
other two); a missing trailing field keeps its default —
and `?now=<when>` (an ISO date-time like `2026-08-24T19:27`, read as local
time, or epoch milliseconds) **freezes the menu bar clock** at that instant —
a live clock would otherwise make every shot with the bar in frame differ by
the minute — `?patterns=1` opens the **Desktop Patterns** control
panel once the boot document has landed (the capture tool can't pull a
menu; under `?fresh` the desktop is on the dither, so the panel shows it
seeded), and `?about=1` opens the **About box** over the boot document
(the plain boot's own greet — but that boot's virgin seeding is an
IndexedDB round-trip the capture tool's virtual-time budget stalls on, so
under `?fresh` this is the way to a shot of it).
`?sample` shares the storage-untouched discipline: it opens the named
built-in as an untitled from in-memory data, skipping the seeding and the
`?file`/dialog boot alike (the deterministic path `drive.mjs` drives).

---

## The desktop

The shell is a full System 7 virtual desktop: `index.html` is one
`<vf-desktop>` skeleton (menu bar, options strip, the three utility
windoids, dialogs, the icon layer, plus a `<template>` the document windows
clone from) fitted to the viewport at boot (`fitWithin` + `onScaleChange`),
with the kit's page-drawn cursor (`applyCursor`) on top. The page sets
**layout only** — every aesthetic is the kit's.

### One machine, two roles

On a real System 7 machine the desktop belonged to the **Finder**: clicking
it switched applications — the app's windows lost their stripes and its
palettes hid. Sprite Machine has exactly one application, so both roles
share one menu bar and one boolean decides everything: **is a document
window the desktop's active window?**

- **Clicking the desktop background or a desktop icon deactivates the
  application** — the PAGE owns the press test (the kit's position: its
  furniture is slotted light DOM, so only the page knows which presses mean
  "the Finder"): `shell/windows.js` routes a press on the bare dither, and
  the icon layer its own presses, through `desktop.clearActive()`. Then
  every document window
  goes plain, the three windoids **hide** (they return with the
  application), the options strip hides with them, the bare-letter tool keys
  go inert, and the menus drop to the **Finder grammar** — About / Settings
  / Quit / New… / Open stay enabled, and Open reads the selection: with
  nothing selected it is **Open…**, the listing dialog (the Finder's
  browse); with a desktop icon selected it becomes a bare **Open** — no
  ellipsis, no dialog — and opens that icon directly, by pointer or ⌘O
  (the selection **survives the trip to the menu bar**, since a press on
  the application's chrome — the menu bar, a dropped menu, a modal dialog
  — is no press on the desktop; the kit's `vf-icon` would clear on it, so
  `shell/icons.js` re-selects across that press, a page-side bridge until
  the kit exempts its own chrome). Everything document-scoped greys out. A
  disabled item's key equivalent never fires (the kit's contract), so
  ⌘S/⌘Z/⌘K gate with their menus.
- **Clicking any document window — or opening one** (File → New…, an icon
  double-click, a drop) — **reactivates**: the windoids come back exactly
  where they were, aimed at the newly active document — and the activation
  **clears the Finder selection** (double-click, bare Open and ⌘O alike):
  the highlight names what the next Finder action acts on, and the
  application is forward now.
- **Sprite Machine → Desktop Patterns opens the Finder's window**: the
  Desktop Patterns control panel is a document-tier window (a striped
  bar, a close box — not a windoid), and on a real System 7 machine a
  control panel opened in the Finder's layer. `appActive` is "a
  **document** window is the desktop's active window", not "any window
  is", so the panel holding active mirrors as the desktop-focused state
  exactly like none: opening it deactivates the application (the windoids
  and the strip hide, the Finder grammar lands — which also clears the
  desktop for previewing), and its close box hands active to the topmost
  document window (the kit promotes the survivor), so the application
  returns where it was. See [Desktop Patterns](#desktop-patterns).
- Closing the last document window leaves the same desktop-focused state:
  a bare desktop whose windoid arrangement survives for the next open. And
  **boot begins in this state too**: until the first document window opens
  (a `?file` load, File → New…'s Create, a drop), nothing has activated —
  an About-greeted load shows the Finder grammar with the windoids hidden,
  and OK — or a click away — leaves it so (the splash opens nothing).
  A windoid is on screen _because_ a document window is, never before.

### Documents are windows

**One document = one window.** File → New…, the Open flow, and a dropped
PNG each open a **new** document window (staggered System 7
style); nothing ever loads over an open document — the unsaved-changes
question lives entirely on the close paths. Opening an already-open stored
document just activates its existing window. Untitled names count up
(`untitled`, `untitled 2`, …). Each document window carries its own
editor, its own edited-face selection, and its own bounded undo history;
the tool and ink stay app-level (one palette, one ink, System 7
style). The utility windoids and the Edit menu always serve the **active**
document: switching windows re-targets the 3D View (the camera re-frames —
a window switch is a new subject), the Full Sprite View, the options
strip's clamp bounds, and the Undo/Redo enablement. The View menu lists
every open document window by name, the active one checked (see
[Menu bar](#menu-bar)) — a pick brings a window buried under the others
forward.

### Menu bar

- **Sprite Machine** — _About…_ (the About box — see
  [The About box](#the-about-box); it is also the boot greeting),
  _Settings…_ (parked: the render prefs
  moved to the 3D View's controls strip, so the emptied item sits disabled
  as a placeholder for a future settings surface), _Desktop Patterns_ (the
  control panel — see [Desktop Patterns](#desktop-patterns); a window, not
  a dialog, so no ellipsis — the Apple menu's Control Panels listed it
  bare — and live in both roles), _Quit_ (the System 7
  cascade: every open document in
  turn, one unsaved-changes alert per dirty one — its window brought forward
  as it's asked about, Cancel anywhere aborting the rest — down to the bare
  desktop, windoid arrangement intact).
- **File** — _New…_ (the New Document dialog: an Empty Document at a chosen
  square tile size — the field is live for Empty only, since a template's
  art has a native size and a retile crops/pads rather than scales — or a
  built-in template (Car, Cube) as a fresh untitled copy; Create or a
  double-clicked row opens the new window), _Open…_ ⌘O (two grammars, one
  item, the label its readout: _Open…_ raises the saved-docs listing
  dialog — the application's while a document is focused, the Finder's
  browse with the desktop focused and nothing selected; with a desktop
  icon selected it relabels to a bare _Open_ and opens that icon at once,
  Finder-style — the ellipsis being System 7's promise of a dialog), _Close_
  (the active document, dirty-checked), _Save_ ⌘S (first save of an untitled
  doc prompts for a name), _Duplicate_ ⌘D (the stored copy opens in its own
  window), _Rename…_, _Download_ ⇧⌘E (the document `.png` verbatim — the
  downloaded atlas IS the source format, hence Download rather than Export,
  and no ellipsis: it acts immediately), _Export 3D Model…_ (the one
  **parked export configurator** — a dialog previewing the future exporter
  with every form field disabled and the Export button inert, Cancel the
  only live control), _Export Sprite Atlas…_ (**live**: the 3D Sprite
  Atlas windoid's four settings as a form — views, elevation, first angle,
  size — over a readout of the sheet they produce; the fields
  are bound to the same slice the windoid's strip edits, so a change here
  moves the strip behind the modal at once and Cancel reverts nothing — the
  strip IS the preview; **Export** saves exactly the pixels the strip shows,
  the whole sheet as `«slug»-atlas.png` — `car-atlas.png` — with a `Title`
  (`«name» atlas`), the `Software` marker and a **`sprite-machine:ring`**
  text chunk carrying the settings, the frame size, the yaw list and the
  engine **anchor** (where the lattice floor's center lands in every frame,
  the feet-row); enabled whenever a model exists, the windoid shown or not —
  see the 3D Sprite Atlas under [Windows](#windows)), and _Properties…_
  (name, atlas dims, the tile-size stepper — all of the active document).
- **Edit** — _Undo_ ⌘Z / _Redo_ ⇧⌘Z (the ACTIVE document's history;
  disabled until it has something — which also hands the key back to a
  focused field's native undo), _Pick Color…_ ⌘K (the 168-color dialog —
  app-level, like the ink it picks).
- **Tools** — the six sticky tool modes — _Selection_, _Pencil_, _Rectangle_,
  _Fill_, _Eraser_, _Eyedropper_ — with the active one checkmarked (the same
  session truth the palette's tool strip and the S/B/R/G/E/I keys write, so a
  pick from any of the three moves all three).
- **View** — _3D Sprite Atlas_ (a checkmark toggle over `prefs.showRing`:
  shows and hides the **3D Sprite Atlas** windoid — see
  [Windows](#windows) — **off every load**, the item unchecked; the
  windoid's own close box is the same uncheck, MacPaint's palettes closing
  from their box and coming back from the menu; document-scoped, so it
  greys with the desktop focused),
  _Arrange Windows_ / _Zoom Window_ ⌘J (**one item, two commands, a
  state rule** — which one is a reading of the windows, never of what
  was pressed last: with anything on screen off its placement — a drag,
  a grow, a zoom, the 3D Sprite Atlas shown into the doc box's band, a
  browser resize the document window sprung with — it is _Arrange
  Windows_, the boot placement re-run on the **current** raster: the
  windoids back to the rail at their placed sizes, every open document
  window onto the doc box at its size, cascaded in stacking order so the
  front window tops the cascade; with everything already where the
  placement puts it — Arrange would change nothing — it is _Zoom
  Window_, the active document window through the zoom box's own toggle
  (see [Windows](#windows)). A window zoomed from its slot still reads
  arranged — the zoom is the zoom box's own toggle — so repeats of ⌘J
  toggle the focused document between its slot and the vacancy while
  nothing else moves, and from any other state the first ⌘J lands the
  arrangement. The test is what's on screen — every visible window's
  live box against the box its placement would write, `arranged()` in
  `shell/windows.js`; hidden windows don't count, nor does the atlas
  strip's width, the user's own (Arrange still re-seeds it), nor which
  document sits on which cascade slot (a raise is stacking bookkeeping,
  not layout: two documents swapped across the cascade by a click still
  read arranged, where Arrange itself, once something is off, cascades
  in stacking order) — and the label is the readout, the Open… /
  Open idiom, the item's value turning with it. Greyed with no document
  window open — nothing on screen to arrange — and, arranged, in the
  Finder role (no active window to zoom); off its placement it is live
  in both roles, so from the Finder role a pick re-rails the hidden
  windoids too, nothing activating) — and then, after a separator, the
  menu's tail: the **open document windows**, one item per open document
  window (System 7's Window-menu idiom). Each reads the document's name
  (its window's title, so a rename or a first save relabels it); the
  **active** window's item is checked — a reading of which window holds
  the active state, so none is checked in the Finder role — and the order
  is **creation order**, the cascade's own (a raise never reorders the
  list); a pick brings that window forward through the same activation
  funnel a click on its title bar takes, from the Finder role too, where
  the application returns with it — the way back to a window buried under
  the others. Nothing in the markup: `shell/menus.js` keeps the section
  reconciled off the workspace, and with no document window open it is
  absent, separator included. The three
  permanent windoids need no toggles: they're up whenever a document
  window is active; the 3D Sprite Atlas is the one exception.
- **The clock** — System 7.5's menu bar clock at the bar's right end
  (`shell/clock.js` over a kit `vf-label` slotted after the last menu): the
  time in the bar's own Chicago (`7:27 PM`), ticking on the minute, its em
  on the menu titles' own rows (the label's line box is pinned to the bar's
  20px — no measured nudge). **Pressing it** (pointer down — the bar's own
  title rule) shows the **date** (`8/24/26` — System 7.5's own unpadded
  M/D/YY) for three seconds
  before the time returns; a second press returns it early. It's chrome,
  not a menu: the bar's press controller hit-tests titles by coordinate and
  ignores it, a press on it keeps the Finder selection like any menu-bar
  press and never deactivates the application, and it takes no focus. No
  icons beside it — the application menu and Balloon Help were furniture a
  one-application machine has no use for. `?now=<when>` freezes it for
  captures.

Key equivalents are the kit's own (`shortcut` on `vf-menu-item`; Ctrl stands
in for ⌘ off-Mac). ⌘N/⌘W stay unassigned on purpose — the browser owns them
before the page ever sees them. Arrange Windows' ⌘J is one of the few
clean letters left (no Mac browser binds it — Downloads is ⇧⌘J — and ⌘A
stays for a Select All); off-Mac, where Ctrl+J IS the browser's Downloads,
the kit's claim (`preventDefault` on a match) pre-empts it while the item
is live, and a disabled item claims nothing, so with no document open the
stroke falls through to the browser — exactly as a greyed Undo leaves ⌘Z
to a focused field's native undo. The bare-letter tool keys (S/B/R/G/E/I) keep
living in `src/shortcuts.js`; the kit deliberately never matches an
unmodified printable key — which is also what lets the Tools menu _display_
those letters in its shortcut column without ever double-firing them.

### Windows

Two tiers, two regimes — plus one **panel window** on demand, the Desktop
Patterns control panel (document tier, not a document — see
[Desktop Patterns](#desktop-patterns)):

- **Document windows** (document tier): one per open document, cloned from
  the `#tpl-document-window` template by the reconciler in
  `shell/windows.js` — created on open (the doc box, cascaded into the
  first free slot — never a remembered position), removed on close
  (existence IS visibility).
  Each is `movable resizable zoomable`; its title is its document's name,
  its `status` strip names the face it's editing ("Front Face"), and its
  `<sm-editor>` lives exactly as long as the document is open. The title
  bar's **zoom box** (the kit's, at the bar's right end) is a stateless
  toggle with the top-left held in both directions — a zoom never moves a
  window, only its far edges: one click grows the window right and down
  to the vacant middle's own edges (`zoomedBox` in `shell/layout.js` —
  the rail's inset gutter at the right, the bottom margin below), filling
  the open area from wherever its top-left sits without running under the
  windoid rail — and records the size it grew from; a click on a window
  already at that state returns exactly that remembered pre-zoom size (a
  session truth, like a windoid arrangement you dragged: it never
  persists — a reload still places every window fresh; the doc box's
  size for the CURRENT raster is the no-memory fallback). **⌘J's zoom
  half is this toggle**: with everything arranged the View menu's ⌘J
  item reads _Zoom Window_ and expands the active window from its doc
  box; the next ⌘J — still _Zoom Window_, a window zoomed from its slot
  reading as arranged — restores it, nothing else moving (see
  [Menu bar](#menu-bar)). And because a
  zoomed window's far edges are struts of the nine-slice pin, a browser
  resize keeps a zoomed window zoomed.
- **Utility windoids** (floating tier, `variant="utility"`): the **Tools
  palette**, the **Full Sprite View**, and the **3D View** — static markup,
  **permanently open**: persistent panels with no close box and no menu
  toggle, always on screen for the active document (only the desktop's
  deactivation hides them) — and the **3D Sprite Atlas**, the one
  toggleable windoid (below). They float above every document window, never
  take the active state (clicking the 3D View can't deactivate the window
  you're drawing in), show the kit's slim 11px dot bar (no title text, no
  close box — the heading still names the window for assistive tech), and
  hide as a set whenever the application deactivates, returning with it.
  A control in a windoid acts on the ordinary **click** unless mouse-down
  is the authentic feel (the Tools palette's cells and the Sprite View's
  face tiles) — no
  press-driven _bridges_ anywhere: raising a windoid re-inserts its node
  (the desktop keeps DOM order in step with z-order), and the kit does
  that in a task **after** the press's click has landed (vintage-frames
  0.5.4 — Chrome drops a click whose mousedown node left the tree, and the
  re-insert used to run at pointerup, which cost a control in a windoid
  behind another windoid its first click; the pointerdown picks the app
  once carried to dodge it are gone). The
  3D windoid stays `resizable` — its canvas re-fits via its own
  ResizeObserver, so the grow box works for free. Every windoid's controls
  strip is the window's **header** (`slot="header"` — vintage-frames
  0.6.1: the Finder window's header line, a white band over a 1px rule
  between the title bar and the body, a positioning anchor; its
  `header-height` authored on the window in `index.html`, the kit's
  grammar, at the same number the chrome arithmetic in `shell/layout.js`
  carries — `STAGE_STRIP`, `SPRITE_STRIP`, `RING_STRIP` — which the drive
  pins the markup against). The **Full Sprite
  View** carries the **face picker** in its header (`sm-atlas-controls`:
  the six cube-view radios — see the Drawing-editor bullet — in a placed
  `vf-container` at the picker block's rectangle, `SPRITE_PICKER_AT`,
  centered across the fixed header, declaring `pattern="white"` for the
  paper a bare container would otherwise inherit from the desktop — kit
  ask #6's bridge, the draw canvas's;
  [docs/kit-asks-pattern-paper.md](docs/kit-asks-pattern-paper.md)) over the
  **atlas grid**, its body (`sm-atlas-view`) — a formal 3×2 `vf-grid` holding one face tile per cell
  in the sheet's own arrangement, each cell a live canvas of that face's
  slice drawn nearest-neighbor, the grid's 1px rules the only lines
  between (frameless — the windoid frame is its perimeter), every cell
  on a **1-bit kit pattern** (`pattern` on `<sm-atlas-view>`, `gray-25`
  — any of the kit's 38 MacPaint patterns by name, or sixteen hex digits;
  painted per cell by the kit's own `PatternFillController` at the cell's
  declared size, so a tile's transparent texels read against paper, and
  dropping the attribute gives plain white cells back). The grid
  follows the ACTIVE document's **live channel**, so it tracks strokes at
  rAF rate (the second live subscriber ever, after the rebuilder), and it
  is a **picking surface**: pressing a tile selects that face — on the
  press, the Tools palette's mouse-down feel — with the picker radios and
  the edit canvas
  following, and the selected tile **stroked in the face art's red**
  (`--sm-select`, `#ff4f4f`, an inset ring over the tile's edge); the
  windoid carries **no status strip** (its status slot stays empty, so
  the kit draws no bottom bar — the grid runs down to the frame).
  The windoid is a **fixed-size picture frame** — movable but not
  resizable, no grow box: its width is the atlas grid block's
  (`SPRITE_WIDTH` = 3 cells + rules + borders, the narrower picker block
  centered in the header), and its height is derived through the active
  tile's own ratio plus the fixed chrome, the header's `SPRITE_STRIP`
  included (`spriteHeightFor` in `shell/layout.js`, applied by
  `fitSprite` in `shell/windows.js`), so the grid exactly fills the body
  below the header — no margins — at boot and across document switches
  and tile resizes; the **3D View** carries its **controls strip** in its
  header (`STAGE_STRIP` tall) — the two render toggles as checkboxes,
  **rotate** (auto-spin) and **smooth** (the low-poly wedge pass), a kit
  row stack writing the prefs slice live (`sm-stage-controls`; these
  lived in Settings… before) — over the THREE canvas in a **kit pattern
  well** (`#stage-well`, a `vf-container pattern="gray-25"` filling the
  body by its own `fill-width fill-height`): the renderer clears
  **transparent** (`alpha: true`, no scene
  background), so the model and its shadow composite over the 1-bit
  pattern rather than a flat gray — the same pattern the Sprite View's
  cells wear, both the kit's own fill; its status strip reading the fixed
  "3D Model View" — a static label; no build error or warning ever takes
  the line — with the build stats (grid / voxels / tris) riding the
  strip's hover tooltip. The 3D View
  carries its own size floor (`shell/windows.js` — declared to the grow box
  as the kit's `min-width` / `min-height`, and applied to any boot geometry
  and raster re-pin alike): width at the controls strip's content width so
  the checkboxes can never be clipped, height at enough canvas under the
  strip to still read as a view.
- **The 3D Sprite Atlas** (`sm-ring-view`, `#win-ring` — "ring" is the
  feature's code name throughout the source: the model rendered from a
  **ring** of yaw angles) — the active document's model rendered
  **orthographically** from a ring of evenly stepped yaws at one
  elevation, the way an engine consumes a pre-rendered rotation set, as a
  **row of tiles**: one cell per view, each the **tile at 1:1** — `size`
  system px square, one image pixel per system pixel — butted, no rules
  between (`rules="none"` on the grid), on **one sheet** of **white**
  kit paper that runs across the whole body — the ring slice's `paper`
  setting, which admits `white` / `black` / `gray` (each a kit pattern by
  name, `RING_PAPERS` in `state/ring.js`; gray is the kit's `dots`
  dither, a 1-bit surface's gray) but which **nothing in the UI writes**:
  a column of radios for it was built and retired the same day, the
  intent being that the app pick the paper for you one day from the
  sheet's own content (a sprite with a lot of white in it reads better on
  black, and the reverse) rather than ask; the plumbing stays, and the
  `?ring=` hook can seed it for a capture. A viewing choice either way —
  the export clears transparent whatever the setting says — (the Sprite
  View's pattern grammar, but the body's rather than the cells': a
  `vf-container pattern` under the grid, filling the body's width —
  `fill-width`, the kit's own fill, so it spans the scroll plane past
  the last tile and under a scrolled row — and the tile tall; the
  Desktop Patterns panel's element, its raster measured on the filled
  axis by the kit's own contract; each cell a `vf-stack` at the tile's
  declared size, the kit's box that paints nothing, so a frame's
  transparent margin reads as the same unbroken paper; the app-side
  bridge for kit ask #11, a window body's paper as a kit pattern —
  [docs/kit-asks-body-pattern.md](docs/kit-asks-body-pattern.md)),
  under a **two-row controls strip** of four
  labeled number fields — `views` (1–16, a 360/n step), `elev` (0–90°
  above the horizon), `from` (the first view's yaw, 0–359° from the
  front) and `size` (the tile's edge in px, 2–255). The strip is the
  window's **header** (`slot="header"` — vintage-frames 0.6.1: the Finder
  window's header line, a white band over a 1px rule between the title
  bar and the body across the whole window, outside the scroll area, so
  the controls hold while the row scrolls under them by construction;
  `header-height="63"` authored in `index.html`, `RING_STRIP` in
  `shell/layout.js` the same number), and it is a **DITL** (`sm-ring-controls`):
  the four captions (`vf-label`, a declared column width each,
  right-aligned so a caption hugs its field) and the four fields sit at
  the top/left `RING_FIELDS` in `shell/layout.js` states, against the
  header's own corner, in whole system px the kit writes as live
  `calc()` — two rows 4 in and 4 apart, a caption dropped 4 below its row
  (where its baseline meets the field's), an 8 inset, 40 and 36 caption
  columns, 6 gaps, the kit's 74 × 25 number field. That arithmetic IS the
  header's height (`RING_STRIP` = 62 + the rule) and the windoid's width
  floor (`RING_MIN_WIDTH` = 258 + the borders) — derivations, not
  measurements. The body is the row alone (`sm-ring-view`): the paper
  container in flow at the plane's origin, as wide as the plane — the
  kit sizes its scrolled plane to in-flow content that cannot wrap, and
  a filled box contributes its content's width, so the row IS the scroll
  range and the paper covers all of it — holding the `vf-grid` with its
  surface token cleared (the kit's own knob for what is behind the
  cells, `--vf-surface`) so the paper shows through, each cell a
  `vf-stack` at the tile's declared size. Nothing in the windoid is
  flexed, nothing but the paper's filled axis is measured — by the kit,
  for its raster — and neither component styles layout beyond that one
  token. No
  status line: the windoid's bottom edge is the kit's **horizontal scroll
  rail** (below). Defaults: four views at a 90° step, 45° up, from the
  front, 64 px tiles, white paper. **Yaw runs front → right → back → left** (yaw 0
  puts the camera on `+z`, the FRONT toward it; positive yaw walks it
  toward `+x`). **The frame is the tile**, and what fills it is the
  lattice's envelope, not the content's: the `nx×nz` footprint's bounding
  circle swept up the height — the same at every yaw — has its larger
  extent fit to the tile's edge, so the whole voxel box fits at every
  angle, the frame never changes between angles, strokes or first-angle
  offsets (a sprite can't jitter in an animation), and **px per voxel is
  derived**, a fraction (the Car at 40³ and 45° in a 64 tile is 0.94 px
  per voxel; loose at yaw 0, the margin transparent). The model is
  centered on the lattice's center, and the lattice floor's center lands
  on the **same row in every frame** — the engine anchor the export writes
  out, beside the derived scale. The **lights ride with the camera** (the
  stage's ambient + key + fill, re-posed per yaw in the camera's own
  frame): in an engine the camera and the sun are fixed and the object
  turns, so every angle is lit the same way; no ground plane, no shadow in
  a sprite. No antialiasing and no smoothing anywhere in the copy chain —
  every px a hard sample of the mesh — and the renderer clears
  transparent, so the margin is paper in the windoid and transparency in
  the file. It has its **own THREE world on an offscreen canvas**
  (`scene/ring-renderer.js`, made lazily on the first render — a strip
  never shown costs no GL context) fed the rebuilder's mesh through one
  `onMesh` seam (a shared-geometry clone — the rebuilder stays the
  pipeline's only consumer), renders the whole strip into **one sheet
  canvas** that the cells slice with `drawImage` and Export encodes
  verbatim, and renders **only while shown** (`scene/ring.js`: a change
  behind a hidden windoid marks the sheet dirty, the show renders it;
  shown, at most one render per animation frame, so a stroke follows at
  the Sprite View's cost class). The settings are app-level and
  session-only (the `ring` slice — the prefs discipline; per-document
  persistence in a PNG chunk is the planned follow-up), and the windoid
  is **toggleable**: View → 3D Sprite Atlas shows it (hidden every load)
  and its **close box** — the kit's, kept on this one windoid — hides it,
  one flag both ways (`prefs.showRing`); a show brings it to the front of
  the windoid band. It is the **classic scrolling document window turned
  windoid** (`resizable scrollbars="horizontal"` — vintage-frames 0.5.5:
  the rail on the frame's bottom edge and, the status slot being empty,
  the rail's corner cell reserved for the grow box; the viewport runs to
  the frame's edge, since a window body or a scroll viewport carries **no
  inset of its own** — 0.6.0, which retired the `flush` attribute every
  window here used to set; an inset is the content's, a `vf-stack pad`,
  and the Desktop Patterns panel is the one window that states one): its
  **height is a derivation**, `ringHeightFor(size)`
  — the chrome over one row of tile-size cells — re-fit as the size
  changes with the **top-left held** (only the bottom edge moves: a bigger
  tile grows the window down from where its bar sits, never up or
  sideways — so a strip left docked on the bottom margin grows past it at
  a big tile; drag it up, or Arrange re-docks it) and **declared to the
  grow box as the kit's size rect**
  (vintage-frames 0.5.6: `min-height` = `max-height` locks the axis, the
  kit's own Patterns-strip idiom, stated from `shell/windows.js` rather
  than the markup because the bound moves with the tile), so the window
  **resizes on the horizontal axis alone**; its **width is the user's** —
  seeded by the placement with the natural row (`ringWidthFor(views,
size)`: one cell per view, butted, plus the frame's borders, floored at
  the strip — the default four 64s sit two px under it, so the default
  row seeds at the floor with two px of paper right of the last tile —
  and capped at the vacant middle so a fresh strip never runs under
  the rail), moved by the grow box within the rect's `min-width` (the
  controls' DITL plus the borders, `RING_MIN_WIDTH`) — and a row that
  outgrows it **scrolls under the rail** while the header holds still
  above it (window chrome, outside the scroll area; the view count no
  longer touches the window). The
  placement **docks it on the bottom margin, left-aligned with the
  document window**, and — only while it is shown — takes its band (the
  tile's own height) out of the vacancy so a fresh open, Arrange Windows
  and the zoom box all land the document clear of it (toggling it on
  never moves an existing window: System 7 didn't rearrange your windows
  when you showed a palette — Arrange does, and re-seeds the strip's
  width). In the resize rule it is a **mixed box, without touching the
  frame's bands**: its y axis a fixed size (the bottom edge in the bottom
  band, a far strut; the top follows through the anchor rule) and its x
  axis a resizable one floored at the strip (the left edge in the left
  band, a near strut; the right edge springs with the middle, like the
  document window's above it) — so a resize keeps it docked at the
  document's left at its derived height, at any size, its width content
  rather than a fixed point. `?ring=…` shows it for captures.

Positions/sizes come from a **smart placement** computed against the live
raster (`shell/layout.js`, pure): the Tools palette top-left; the Full
Sprite View over the 3D View as a right-hand rail — **one column**, both
right-flush at the **same width** (the sprite windoid's fixed one), the
3D View absorbing the rest of the height below the options strip; and
the document window **top-left aligned beside the Tools palette** (its
top, a side inset to its right), filling the vacant middle but for the
**cascade room** it leaves at the right and bottom — so each further
document window opens at the **same size**, **cascaded** down-right into
the first slot no open document window holds (`cascadeFrom`: five slots,
the last landing flush with the vacancy's edges; a closed or dragged-away
window gives its slot back, and a full cascade wraps onto the first
rather than running into the rail or off the bottom). That placement is the **only** source of
window geometry — **nothing about a window persists across sessions**,
not the windoids' arrangement and not a document window's box. A browser
is resized and reopened on another monitor all the time, so a prior
session's top/left is no truth worth re-asserting over a raster that may
be nothing like the one it was dragged on: every session start places the
windoids for the raster it actually has, and every open — a saved
document or an untitled — lands on the cascade. Within a session, what
you drag is yours: the windoids keep their arrangement across
deactivation and across closing to zero, until the page reloads — or
until **View → Arrange Windows** (⌘J, while anything is off its
placement — see [Menu bar](#menu-bar)) re-runs the placement on the
raster as it is now, every window included. (Desktop
icons are the exception — the Finder's furniture, arranged by hand; see
[Desktop icons & state](#desktop-icons--state).) Everything clamps onto
the raster's lattice.
When the **browser window resizes**, the raster re-fits and **one rule
moves every window**, placed or dragged alike — the **nine-slice pin**
(`pinOf`/`pinTo` in `shell/layout.js`). The **open space below the options
strip** (the menu-bar + strip band is fixed-height chrome — the frame's
y = 0 line is the strip's bottom edge) is cut by a **ring of outer
bands** — 100 system px at the left and bottom, and at the top and right
widened to hold the rail: the top band runs through the 3D View's top
edge, the right band is the rail column — around a **middle that grows
and shrinks**. Each window edge keeps its place in its slice: an edge in
a band is a **strut** (its offset from that raster edge holds), an edge
in the middle a **spring** (its fraction of the middle holds). So a
window tucked against the right edge stays tucked, a window wholly
inside a corner never moves, a window spanning the middle **breathes**
with it, and a window left hanging off an edge keeps hanging by the same
amount. Because the bands hold the furniture, every **placed windoid is
all struts** and the placement is a **fixed point** of the rule: a resize
lands the rail exactly where Arrange Windows would — right-flush,
full-height — with nothing remembering whether a window was ever touched,
which is also what makes a resize **behind the boot dialog** (windoids
hidden, nothing open) come up right when the first document opens. A
document window is content, not furniture: its top-left (the cascade
slot) is a strut pair, its right and bottom edges spring with the
vacancy, so it keeps filling the middle proportionally (Arrange
re-applies the absolute cascade room). A **fixed-size** window (the
Tools palette, the Sprite View) resolves its edges through an **anchor
rule** — a lone strut holds, opposite struts keep the near edge (the
title bar is the handle), two springs keep the center — and a resizable
one floors its size the same way. All of it runs live, per resize event
(the raster itself re-fits live, so the windows track it in the same
stroke). The **unrounded pin is the per-window truth** between events,
re-derived only when the window has actually been moved or resized by
something else (a drag, a grow, a placement) — re-reading it each event
from the just-snapped geometry ratchets, because the placement lattice's
round-half-up walks windows down the screen across a long resize drag,
one notch at a time, never back up. Deliberately **no position clamp**
and no visibility guarantee on this path: a window near an edge may hang
partly off a shrunk raster, and that's the point — the same pin always
maps back exactly, so growing back returns it whole (clamping at the
small size rewrites the pin and turns the round trip into a drift). Sizes
get exactly **one intervention** past the pin: a resizable window
**bigger than the open area** shrinks to fit it — hanging off is
recoverable by a drag, but bigger-than-the-area is not (the title bar
can't leave the raster upward, so the grow-box corner would be
unreachable at any position); the shrink never touches the pin, so
growing the raster back restores the size exactly. The same oversize
clamp guards every placement (`clampWindow`) — the smart placement's
size floors on a tiny raster, a cascaded document window near the
raster's edge.

### Desktop Patterns

**Sprite Machine → Desktop Patterns** opens System 7.5's Desktop Patterns
control panel — the composition of the original (the **preview well**
across the top, the chooser under it, **Set Desktop Pattern** along the
bottom) with the classic scrollbar (one pattern at a time, "67/74")
replaced by a **grid of every pattern the kit ships**: the 38 standard
MacPaint fills (`PATTERN_NAMES`, palette order — vintage-frames
`docs/PATTERNS.md`) as a 13×3 `vf-grid` of 16px cells, a cell being
exactly two repeats of its 8×8 pattern the way MacPaint's own pattern bar
showed them (the last well stays empty — 38 tiles no rectangle). Every
fill is the kit's own: the well and each cell are `vf-container
pattern="…"` boxes at declared sizes (222×160 and 16×16), so the rasters
are exact and 1-bit at every density — the well framed by the kit's
`rule` on all four edges. The semantics are the Colors dialog's: opening
seeds the **pending** pattern from the desktop's current one; **clicking**
a cell selects it — the well previews it and a ring marks the cell (1px
black over the edge, 1px white inside it, so it reads on `black` and
`white` alike) — while the desktop stays as it was; only
**Set Desktop Pattern** commits, through the shell slice's one setter
(`shell.desktopPattern` → `shell/patterns.js` writes it onto
`vf-desktop`'s `pattern`, the kit's whole-screen raster repainting under
every window), and the close box discards a selection never set. The
pattern is the **one desktop setting that persists** (`desktop-state.js`,
in the same v3 blob as the icons; `?fresh=1` boots the dither), restored
onto the desktop before its first render — a corrupt value is ignored
through the kit's own `parsePattern`, never warned about. The window
itself is a fixed-size `vf-window` (`heading="Desktop Patterns" movable`,
248×304 — index.html's `#tpl-patterns-window` states the arithmetic; no
grow box, no zoom box; its body a `vf-stack pad="12"`, the content's own
12px inset, since a window body carries none of its own — vintage-frames
0.6.0 — and this is the one window whose content wants one) cloned per
open and **removed by its close box**
(existence IS visibility, the document windows' discipline; a second pick
while it's open just brings it forward — one panel, ever), placed by
`centeredBox` in `shell/layout.js` (centered in the open area below the
options strip's band) and **adopted by `shell/windows.js` as a panel**, so
View → Arrange Windows re-centers it and a browser resize re-pins it like
every window (centered, both edges spring — it keeps its center). It is
the Finder's window: see [One machine, two roles](#one-machine-two-roles)
for what opening and closing it does to the application. `?patterns=1`
opens it over the boot document for captures.

### The About box

**Sprite Machine → About…** — and every load the URL gives no document to
open (the top of this README): the classic launch splash, System 7's
About box on the plain dBoxProc frame (no bar, no close box; OK, Escape,
or a **click anywhere outside the box** dismisses it onto whatever was
there — at boot, the bare desktop in the Finder role, nothing opened and
nothing activated). The click-away is the kit's own **`light-dismiss`**
(vintage-frames 0.5.3), an opt-in the markup states on this one dialog:
a splash dismisses on a click away, while System 7's modal boxes refused
an outside click, and every question dialog here still does (a stray
click must never answer "Save changes?"). The kit consumes the click, so
nothing beneath reacts — a desktop icon under the pointer neither selects
nor opens, and a Finder selection survives — and nothing here listens
for the close (it arrives as `vf-close` with reason `outside`; the box
holds no pending state). The application's
**32×32 icon** (`src/assets/sprite-machine-icon.png`, through the kit's
`vf-img` at 1:1 — one image pixel one system px) sits beside three lines
— **Sprite Machine** in the display face, then **version N** with the
date beside it and **created by Adam Portilla** in the body face — over
the two-paragraph blurb in the same body face (Chicago for the title
alone; the reading lines in Geneva), whose
**Vintage Frames** is a real link to the kit's
[npm page](https://www.npmjs.com/package/vintage-frames) — opened in a new
tab, so the app and any unsaved document stay put; inked by `style.css`
in the paragraph's own black with the underline as its whole affordance,
and the arrow stays the arrow over it (System 7 had no pointing hand, and
the kit ships none) — and a default OK. The version and the
date are **build facts, never markup**: `vite.config.js` `define`s
`__APP_VERSION__` (package.json's `version`) and `__APP_DATE__` (HEAD's
commit date — the date of the code that is running, so every build of one
commit says the same thing and a capture stays byte-identical across runs;
formatted in Node as `Aug 24, 2026`, so no runtime locale or timezone can
move it, and a checkout without git reads the build day), and
`shell/menus.js` writes them into the box's two empty spans at wire-up,
so the markup never carries a stale number. Bumping `version` in
package.json is the whole release ritual. `?about=1` opens the box over
the boot document for captures.

### Documents: a document IS a .png

A document is exactly one sprite `.png` — the 3×2 atlas — with all metadata
in standard PNG text chunks (`lib/png-chunks.js`): `Title`, `Creation Time`,
`Software`, and `sprite-machine:transforms` (written only when
non-identity). The pixels alone are already a complete document (tile size
derives from the dimensions), so **Save, Download and drop-import converge on
a single format**: File → Download downloads the saved bytes verbatim,
dropping any downloaded PNG back restores it losslessly (title included — the
drop path reads the chunks), and any foreign 3×2 sheet is a legal, if
anonymous, document. A chunk-stripping optimizer costs the name and
timestamps only.

Storage is IndexedDB (`storage/db.js`: one `docs` store; the record is the
PNG bytes plus rebuildable listing caches — name, timestamps, icon data-URI,
dims — where the chunk wins on any disagreement), driven by the `files`
slice (`state/files.js` — the pure LIBRARY layer: listing, availability,
and the per-document storage operations, each taking an explicit doc +
identity; which documents are open and their dirty state is the
workspace's). Explicit Save is the contract (System 7 idiom); per-document
dirty tracking rides each context's doc channels, and a `beforeunload`
guard over ANY dirty open document is the safety net. Where IndexedDB is
broken (private windows), Save raises an explanatory dialog and everything
else still works.

### Desktop icons & state

Every saved doc gets a `vf-icon` (`selectable movable editable` — Return
renames in place, converging on the same workspace action as File →
Rename…, so any open window of that document retitles along) — and saved
docs are the ONLY icons: the built-in defaults (Car, Cube) are **seeded
into the library at the first-ever boot** (`seedDefaultDocs` in
`loaders.js`, through the same save path as ⌘S — real PNG bytes, chunks,
generated icon) and are ordinary mutable documents from then on; the
seeding runs only when NO prior state persists (no desktop-state blob AND
an empty library — deleting or emptying later never resurrects them); the
virgin boot then greets like any other — the About box, unless
`?file` names a doc (the just-seeded Car and Cube are already nameable).
Double-click opens
(into the existing window if one is open, deselecting the icon as the
application takes focus),
selecting an icon deactivates the application (a press in the icon layer is
a press on the Finder) and turns File → Open… into a bare File → Open
aimed at the selection — which holds through the menu-bar press that picks
it — and every open doc's icon wears the kit's `open` ghost. Icon art is generated **from
the document itself**: the FRONT tile, **trimmed to its content's bounding
box** (`contentBounds` — the art fills the icon however small it sits in its
tile), drawn into 32×32 → data URI, regenerated on every save (empty front
tile ⇒ a generic document glyph),
declared `color` so selection darkens instead of inverting. Icon
**placement is the windows' regime in the icons' own frame** — the whole
desktop below the **menu bar** (icons are the Finder's furniture; the
options strip is application chrome, hidden whenever the desktop takes
focus, so unlike the windows it reserves nothing above an icon): the
default lattice derives from the live raster (`iconDefault` in
`shell/layout.js` — the classic left-edge column below the Tools band,
folding into further columns when a cell would run off a short raster's
bottom), a saved position wins, pulled on-raster at boot (an off-raster
icon has nothing to grab, so it would be unreachable — the windows'
boot-clamp discipline), and on a **browser resize** every icon keeps its
**nine-slice pin** in the same stroke as the windows, in the icons' own
frame (`ICON_FRAME`: the desktop below the menu bar, uniform 100px
bands — no application furniture lives in the Finder's frame — and the
64px cell a fixed size, so an icon resolves through the anchor rule):
the classic left-edge column is a strut that stays at its 16px, its rows
spring with the middle, an icon dragged into a corner stays in that
corner — the same unrounded truth cache, the same no-clamp
reversibility, so a shrink-then-grow round-trips every icon exactly
home. Icon layout, the open SAVED documents' edited faces (and which
was active) and the **desktop pattern** (the Desktop Patterns panel's
setting — the one desktop setting that persists; see
[Desktop Patterns](#desktop-patterns))
persist in one versioned localStorage key (`shell/desktop-state.js`, v3 —
a v1 or v2 blob migrates shallowly, the window geometry those versions
persisted simply dropped, and a v3 blob from before the pattern reads the
dither), snapshotted on change/exit. **No window
geometry is in it**: the windoids and the document windows place fresh
from the live raster every session (see [Windows](#windows)) — the
persistence layer never sees a window. Icons restore at
boot; the per-document entries are deliberately NOT reopened then — what
a load shows is the URL's call (`?file=<name>`, else the About box; and
the address bar tracks the active saved document as `#<name>`
— `shell/url-state.js` — so a plain reload restores it) — they hand a
saved doc its remembered edited face whenever it IS opened. Untitled
windows don't survive a reload either way (no autosave — explicit Save is
the contract). The documents themselves live in IndexedDB.

---

## The technique: multi-view visual-hull voxelization

Given orthographic pixel sprites of an object's faces, we reconstruct a voxel
solid and color its surface. Chosen over three alternatives (textured box,
sprite-stacking, mesh boolean-extrude) because it's the only one that yields a
genuine solid that self-occludes, casts a true blocky shadow, and stays crisp at
any angle — 1 pixel = 1 voxel = 1 cube.

1. **Ingest** — each sprite is read at native pixel resolution into occupancy +
   packed-RGB typed arrays at **full tile size (no crop)**. Strict registration:
   a tile is a literal slice of the lattice, so texel (u,v) maps 1:1 to a fixed
   lattice line and must line up across faces (the author's job — the editor's
   onion-skin helps).
2. **Reconcile dims** — one integer resolution per axis comes straight from the
   (uniform) tile size: `front → W×H`, `side → D×H`, `top → W×D` (MagicaVoxel's
   `12×30 + 10×30 → 12×10×30` rule). Views are placed at **identity position** —
   no re-centering, no bottom-anchor — so a pixel stays exactly where it was
   painted. Well-formed sheets use **square tiles** (depth reads as a width in the
   side view but a height in the top view, so only a square tile registers on all
   three planes); a non-square or mismatched sheet takes the max per axis, places
   from the origin, and **warns**.
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

| Mode           | What it is                                            | Use                                           |
| -------------- | ----------------------------------------------------- | --------------------------------------------- |
| **voxel (3D)** | Visual-hull voxel solid (above), greedy-meshed        | The real object (low-poly off)                |
| **low-poly**   | Voxel solid + 45° wedges over same-surface staircases | Softer silhouette, fewer hard steps (default) |

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
opposite view, so a half-drawn sheet still colors every face — the built-in
**Cube** ships only LEFT/FRONT/TOP and mirror-fills RIGHT/BACK/BOTTOM; the
**Car** draws every face but RIGHT, which mirror-fills from LEFT. Mirroring is
a _coloring_ step; an axis with no view at all (neither side) is simply
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
round-trip) that the drawing editor depends on. `test/views.test.mjs` pins that
`VIEW_IMAGE_AXES` (the image-axis table the sheet resize registers by) can't
drift from the projections it's probed from. `test/rect.test.mjs` pins the rect tool's
rounded-rectangle rasterization (radius clamp, convex corners, per-row symmetry) and
the Shift square-lock. `test/fill.test.mjs` pins the fill tool's flood + replace
primitives (4-connectivity, contiguous vs. global scope, transparent-as-a-color,
the no-op guards, and a full-tile flood that can't overflow the stack).
`test/select.test.mjs` pins the selection tool's base + float primitives
(the bounds helpers, Shift's axis lock, lift → clear → composite as an
identity, the transparency rule, per-texel clipping that can never wrap a
right-edge overflow onto the next row, and off-tile-and-back reversibility).
`test/ring.test.mjs` pins the 3D Sprite Atlas's geometry (`lib/ring.js`:
the yaw ring, the lattice envelope — the footprint circle swept up the
height, bounded by the sphere — the frame that IS the tile, its larger
extent fit to the `size` edge with the px-per-voxel scale derived, the
camera direction and true up vector — unit, perpendicular, well defined
straight down — and the yaw-independent anchor), and
`test/ring-state.test.mjs` its settings slice (the defaults, every
setter's clamp / rounding / NaN no-op / silence on an unchanged value, the
size's 2–255 range, the offset's normalization, the paper's three names
and the setter's no-op on anything else, the sheet channel by reference,
and the export's metadata chunks round-tripping — the paper never in
them).
`test/palette.test.mjs` pins the editor's
168-color palette: 168 entries in a 21×8 grid, all colors AND names distinct,
valid `#rrggbb`, `packed` derived from `css`, the layout corners (the
grayscale ramp is row 1), and the exact set of within-wedge-tolerance color
pairs (all same-hue neighbors — no gray pair merges) so the wedge-safety note
can't drift.
`test/brush.test.mjs` pins the pencil primitives (Bresenham continuity, footprint
anchoring, the transparent-idempotence rule). `test/png-chunks.test.mjs` pins
the document format's chunk surgery (round-trip, CRC against the published
IEND reference, splice position, replace semantics, unknown-chunk
passthrough).

The **app-state layer** (`src/state/`) is pure JS with the same treatment:
`test/store.test.mjs` (the observable store: by-reference values, silent no-op
patches), `test/session.test.mjs` (tool/ink semantics,
clamp-on-resize), `test/doc.test.mjs` (the two-channel canonical document: silent
stroke writes, rAF-coalesced blit-then-notify via an injectable scheduler, the
drain-before-consume guard, blank-revert, the sheet generation), `test/derive.test.mjs`
(the per-face view model: tile identity, derived faces, mirrored onion-skin),
`test/files.test.mjs` (the document LIBRARY against an in-memory storage
stub: save/load/rename/remove/export with explicit identities, the chunk
metadata round-trip, storage degradation), `test/workspace.test.mjs` (the
open documents: per-context doc + history + face + identity, untitled
naming, per-context dirty tracking off the doc's channels, the activation
mirror, the stored flows, and `followActive`),
`test/history.test.mjs` (undo/redo: tile-gesture and whole-atlas entries,
snapshot copy-in/copy-out, the bound, load-boundary clearing),
`test/shell.test.mjs` (the shell slice's desktop pattern: the dither
default, the setter's silent no-op, a trimmed custom value, empty → the
default), `test/params.test.mjs` (the whole `?param` dev-hook surface, typed), and
`test/layout.test.mjs` (the desktop's window + icon arithmetic, `shell/layout.js`:
the smart placement — the one-column rail (the sprite windoid's fixed
`SPRITE_WIDTH` × `spriteHeightFor` size, the stage as wide, absorbing the
rest of the height on any raster), the document box top-left beside Tools
with exactly the cascade's room at its right and bottom (every slot inside
the vacancy, the last flush with its edges), tiny rasters degrading
gracefully — the 3D Sprite Atlas's box (`ringHeightFor`: the chrome over
one row of tile-size cells; `ringWidthFor`: the natural row floored at the
strip, capped at the vacancy at placement; docked on the bottom margin at
the doc box's left; shown, it shortens the doc box by the tile's own
height so every cascade slot clears it and stops the zoom box above it;
hidden, the placement is exactly as before) — the
document-window cascade (first free slot, a freed slot
reused, a full cascade wrapping) — the panel placement (`centeredBox`:
centered in the open area below the strip, its top-left floored at the
reserve on a tiny raster) — the raster-derived
icon lattice (the column wrap), the slot re-expression Arrange Windows
cascades by (`cascadeSlot`), and the nine-slice resize rule: struts keep
their offsets, springs their fraction of the middle, continuity across
every seam, edges outside the raster, a rigid corner widget, near + far
stretching and spring + spring scaling, the fixed-size anchor rule, the
resizable floor, the degenerate span, the frames (the windows' below the
options strip with the rail-sized top/right bands, the icons' below the
bare menu bar, uniform), no ratchet across a wiggle — and the test that
licenses one rule for everything: **the placement is a fixed point**, every
placed windoid re-pinning onto any other raster exactly where
`initialPlacement` puts it there — the bottom-docked atlas strip's left,
top and height included (a mixed box: its width is content), at four views
and at sixteen, at two tile sizes — with the rail's edges still struts
after a 2px lattice snap; `tools/drive.mjs` drives the real thing over
CDP, where a viewport change fires a true `resize`, and imports the pure
module as its oracle for the exact expected geometry).

Beyond that pipeline integration, the pure modules also have direct unit suites:
`test/carve.test.mjs` (vox/unvox round-trip, `extractSurface` masks + counts,
`reconcileDims`, `placeView`, plane-union, and a `projectInto`↔`project` drift
guard), `test/colorize.test.mjs` (the mirror-fill / relaxation / dominant-body
fallback tiers, on all three axes), `test/ingest.test.mjs`
(`applyTransform`/`flip` + the `ingestSprite` throw path), and
`test/t-junction.test.mjs` (multi-vertex edge splits with area + colour/normal
preservation), and `test/color.test.mjs` (the shared color helpers —
`hexToRgb`/`rgbToHex` round-trips, `normalizeHex`, and `rgbKey`'s big-endian
24-bit keying). `test/mesh.test.mjs` loads THREE to check `voxelMesh` welds
watertight, centres X/Z, and leaves Y as authored, plus the shared vertex-color
linearizer cache; `test/diag.test.mjs` exercises the `?diag=1` watertightness
self-check on closed vs. open surfaces.

```
src/lib/
  constants.js    default mirror (all-on) / world-size + DB16 pencil palette + named 168-color picker palette (pure)
  color.js        shared color helpers: hexToRgb / rgbToHex, normalizeHex, rgbKey (24-bit dedup) (pure)
  views.js        6 view defs + the face vocabulary (keys/normals/index/axis) all derive from FACE_NORMAL; projections, front-edge meta
  atlas.js        slice a 3x2 sheet <-> face tiles: blitTile write-back, cellOf, validateSheet (pure)
  ingest.js       sprite -> occupancy/color arrays (full tile, no crop), place, reorient
  carve.js        dim reconciliation, visual-hull AND, surface extraction
  colorize.js     depth-aware first-hit surface coloring + palette snap
  faces.js        surface voxels -> quads: greedy-merged or culled (pure)
  ring.js         the 3D Sprite Atlas's geometry: the yaw ring, the lattice envelope + square frame,
                  the camera pose (direction + true up), the sheet, the engine anchor (pure)
  rect.js         editor rect tool: rounded-rectangle rasterization, per-row runs (pure)
  fill.js         editor fill tool: contiguous flood + global color replace (pure)
  select.js       editor selection tool: bounds helpers, the axis lock, lift / clear / composite —
                  the base + float model with the transparency rule and the no-wrap clip (pure)
  brush.js        editor pencil primitives: writeTexel / stampBrush / strokeLine (Bresenham) (pure)
  pipeline.js     ingest -> carve -> colorize  (pure; Node-testable)
  t-junction.js   lattice-exact T-junction repair for merged+wedge meshes (pure)
  mesh-util.js    shared vertex-color linearizer + mesh finishing (THREE)
  mesh.js         quads -> merged, vertex-colored THREE.Mesh    (voxel mode; THREE)
  wedge-mesh.js   voxel solid + additive 45° wedges             (low-poly mode; THREE)
  sprite-data.js  built-in defaults (as atlases): first-boot seeds + New-dialog templates, + grid->ImageData helper
  png-chunks.js   PNG chunk surgery: parse + tEXt/iTXt read/replace, CRC32 — the document format (pure)
  diag.js         geometry watertightness self-check (dev only; ?diag=1)
src/state/        the app-state layer (pure JS, zero deps beyond lib/, Node-tested)
  store.js            createStore(): get / patch / subscribe — values BY REFERENCE, silent no-op patches
  store-controller.js the Lit bridges: StoreController (store change -> host.requestUpdate) and
                      ActiveDocController (workspace + active-doc structural changes, re-wired
                      across activation switches; opt-in `selection: true` follows the active
                      context's selection store too — only the options strip asks)
  doc.js              the canonical document (atlas + sliced views + tile geometry) with TWO channels:
                      change (structural) and live (stroke-rate, rAF-coalesced blit-then-notify);
                      owns applyTileEdit / drain / dropLive / loadAtlas / resizeTiles / replaceAllTiles
                      / restoreTile / restoreAtlas (the undo paths). A FACTORY — one instance per
                      open document (no singleton)
  workspace.js        the OPEN documents: DocContexts (own doc + history + face + fileId/name/dirty
                      + a per-context selection store: the canvas's marquee OUTLINE, for the strip's
                      readout — never through the workspace store, it moves at pointer rate),
                      activeKey (the kit's vf-activate mirrored in), untitled naming, per-context
                      dirty tracking, the stored flows (openStored/save/duplicate/rename/export),
                      and followActive() — the follow-the-active-document primitive
  session.js          editor session (app-level): tool, ink, per-tool options, picker
                      flag — one palette, one ink, however many documents are open
  prefs.js            lowpoly / autoRotate (the render toggles; the 3D View's controls strip writes them)
                      + showRing (the 3D Sprite Atlas windoid; View → 3D Sprite Atlas and its close
                      box write it, off by default)
  ring.js             the 3D Sprite Atlas's settings (views / elevation / offset / size — the tile's
                      edge in px — app-level, session-only, clamped setters) + the SHEET CHANNEL (the
                      rendered sheet, by reference, the doc's onLive shape) + ringMetaChunks (the
                      export's text chunks)
  build.js            dims / voxels / tris / warnings / error — written by the rebuilder (+ the loaders'
                      errors); the stats read by the 3D View's status tooltip, warnings/error recorded only
  files.js            the document LIBRARY: listing + availability + per-document storage ops
                      (save/load/rename/remove/export, each taking an explicit doc + identity) —
                      browser deps (storage, PNG codec, icon art) injected
  shell.js            appActive + icon selection (the menus and the focus gating share one
                      truth; the windoids are permanent — no flags) + the desktop pattern
                      (the Desktop Patterns panel's Set; the one desktop setting that persists)
  history.js          bounded undo/redo: tile-gesture + whole-atlas snapshot entries over the doc's
                      restores. A FACTORY — one instance per open document (no singleton)
  derive.js           pure selectors: editorViewModel(doc, face) -> { tile, mirrorBehind, wasDerived }
src/storage/
  db.js           the IndexedDB promise wrapper (one `docs` store) the files slice takes by injection
src/scene/
  stage.js        renderer, camera + orbit controls, lights, ground, framing, on-demand render loop, resize
  rebuilder.js    the pipeline's ONLY consumer: follows the ACTIVE document (change+live channels,
                  re-wired per activation) + prefs -> buildVoxels -> mesh swap -> build stats;
                  a window switch re-frames the camera (a new subject); hands every mesh (and
                  null before a dispose) to one outside consumer through the onMesh seam
  ring-renderer.js  the 3D Sprite Atlas's own THREE world on an offscreen canvas: a shared-geometry
                  clone of the rebuilder's mesh, an orthographic camera posed per yaw (lib/ring.js),
                  the light rig riding in the camera's frame, N frames rendered into ONE sheet canvas
  ring.js         the follower around it (the renderer made lazily on the first render): the onMesh
                  subject, a render per setting change or rebuild — at most one per frame, and only
                  while the windoid is shown (hidden: dirty, the show renders) — published on the
                  ring slice's sheet channel; Export's renderSheet()
src/shell/        the desktop's behavior modules (imperative wiring over the index.html skeleton)
  layout.js       the window + icon arithmetic (pure, Node-tested): initialPlacement (the smart
                  boot/open arrangement from the raster — the ONLY source of window geometry;
                  none persists; the atlas strip docked at the bottom, the doc box shortened
                  only while it is shown) + cascadeFrom (the document windows' first-free-slot
                  cascade) + spriteHeightFor (the fixed-size
                  Sprite View windoid: picker-block width, atlas-ratio height) + RING_FIELDS
                  (the 3D Sprite Atlas strip's DITL: the controls' box, rows, caption
                  columns and field lefts in whole system px against the window header's
                  corner — RING_STRIP, the header's height, and RING_MIN_WIDTH derive from
                  it) + ringHeightFor / ringRowWidth / ringWidthFor (the windoid:
                  a derived height — the chrome over one row of tile-size cells — the row's
                  own width, and a seeded, user-owned width: the row floored at its strip,
                  capped at the vacancy) + iconDefault
                  (the raster-derived icon lattice) + pinOf/pinTo (the nine-slice pin across raster
                  resizes — struts in the outer bands, springs in the middle — framed per tier:
                  WINDOW_FRAME below the options strip with the rail-sized top/right bands,
                  ICON_FRAME below the menu bar, uniform)
  windows.js      the two window regimes: windoid visibility (appActive <-> hidden; non-closeable —
                  but for the 3D Sprite Atlas: appActive AND prefs.showRing, its close box the
                  uncheck, fitRing its height-follows-the-tile-size derivation — declared to
                  the grow box as the kit's size rect, so it resizes on the horizontal axis
                  alone; the 3D View's floor is declared the same way), and
                  the document-window reconciler (template clone per context, the doc box
                  cascaded — never a restored geometry, title sync, close-box routing); the vf-activate wire into
                  shell.appActive + workspace.activeKey; boot clamp + the resize rule (every window
                  re-pins by the nine-slice pin — the placement being a fixed point of it); arrange()
                  (View → Arrange Windows: the placement re-run over every window) + arranged()
                  (would arrange() change anything on screen? every visible window's live box
                  against the target box its placement would write — the ⌘J item's state rule,
                  so every placement here is a computed box before it is a write) + zoomActive()
                  (⌘J's other half: the active document window through the zoom box's own
                  toggle) + onLayout (the layout signal the item re-derives on); the
                  Sprite View's fixed sizing (fitSprite — boot + doc switches/tile resizes);
                  the PANEL adoption (addPanel/removePanel: a document-tier window that is
                  not a document — the Desktop Patterns control panel — placed, arranged and
                  re-pinned like every window, and mirroring as the Finder's turn when active)
  menus.js        vf-menu-select -> workspace/file actions on the ACTIVE document; the two-role
                  focus gating + checkmark sync; the ⌘J item's state rule (Arrange Windows /
                  Zoom Window — value + label read off windows.arranged()); the View menu's
                  open-windows section (one item per open document window after a separator,
                  reconciled off the workspace: the name, the active one checked, creation
                  order; a pick activates its window, from the Finder role too); Desktop Patterns ->
                  the panel (patterns.js);
                  every dialog flow (About — the boot greeting too, its version + date
                  lines stamped at wire-up from vite.config.js's define — / Settings / New
                  Document (templates + tile size) / Open / name prompt / Properties /
                  unsaved-changes / storage notice / Export Sprite Atlas — the ring slice's
                  settings as a live form, Export = the strip's sheet as «slug»-atlas.png with
                  the ring chunk); the quit cascade
  icons.js        the icon layer: one vf-icon per saved doc (nothing else), generated front-tile art,
                  open/rename wiring, open ghosts, raster-derived placement + boot clamp + the
                  resize re-pin (below the menu bar), the Finder wire (icon presses deactivate; the
                  selection feeds the shell slice for the desktop-focused File → Open, and is
                  re-selected across a press on the app's chrome — menu bar / menu / dialog —
                  which the kit's vf-icon would otherwise clear: kit ask #5's page-side bridge)
  desktop-state.js  icon layout + the open saved docs' edited faces (+ active) + the desktop
                  pattern in one versioned localStorage key (v3; v1/v2 migrate, their window
                  geometry dropped) — window geometry never persists; this module never sees
                  a window
  url-state.js    the address-bar mirror: the ACTIVE saved document's name -> location.hash
                  (#Cube, replaceState; cleared for untitled/none) so a reload restores it
  clock.js        the menu bar clock: a kit vf-label at the bar's right end — the time on the
                  minute, a press shows the date for a moment (injectable now(); ?now freezes it)
  patterns.js     the desktop pattern: shell.desktopPattern -> vf-desktop's `pattern` (the boot
                  restore validated through the kit's own parsePattern), and the Desktop
                  Patterns control panel's lifecycle — ONE document-tier window cloned from
                  #tpl-patterns-window, centered (layout.js centeredBox), adopted by windows.js
                  as a panel, removed by its close box (existence IS visibility)
src/
  main.js         the composition root: parse params -> seed stores -> fit desktop + cursor -> shell wiring
                  -> stage + rebuilder -> boot documents (test-path sample / ?file=<name> /
                  the About box greet, after the one truly-virgin seeding) -> the ?patterns /
                  ?about capture hooks
  boot/params.js  URL-param parsing -> one typed boot object (pure, Node-tested)
  loaders.js      every way a sheet enters (template-or-sample / file / blank at a chosen tile size):
                  decode + validateSheet -> a FRESH workspace context | build.setError; a dropped
                  PNG's Title/transforms chunks restore its identity; + seedDefaultDocs, the
                  virgin-boot one-shot that saves the built-ins as ordinary stored documents
  drop-target.js  whole-app drag & drop + overlay -> loaders -> the new window surfaces
  shortcuts.js    document-level S/B/R/G/E/I -> session actions, gated on appActive (menu key
                  equivalents are the kit's; Esc/Shift are gesture-scoped and live in the canvas)
  components/     all Lit, standard SHADOW DOM (mostly `:host { display: contents }`; the one
                  exception is sm-color-picker — light DOM, see its entry) — see "UI layer" below
    sm-editor.js       CONNECTED container: a document window's body, one per open document — the
                       artwork well over ITS DocContext (`ctx`, assigned by
                       the reconciler pre-append); memoizes the per-face view model (face /
                       views-identity / geometry), feeds canvas gesture commits to ITS history,
                       tells its canvas whether it is the ACTIVE window (the selection's Esc gate)
    sm-draw-canvas.js  leaf: the pixel-canvas subsystem — working buffer (+ImageData view, by reference),
                       selection/pencil/rect/fill gestures (the selection's base + float + offset
                       composited in place, its ants on their own layer), integer-scale layout,
                       overlay layers, gesture-scoped keys, per-gesture undo capture (sm-commit)
    draw-overlays.js   pure canvas painters for the hover footprint / rect drag preview / the
                       selection's marching ants
    sm-face-picker.js, sm-tool-strip.js, sm-tool-options.js
                       presentational leaves: props down, bubbling sm-* events up, no store imports
    sm-options-bar.js, sm-tools-panel.js, sm-atlas-controls.js, sm-atlas-view.js,
    sm-ring-controls.js, sm-ring-view.js, sm-stage-controls.js, sm-status-line.js,
    sm-color-picker.js, sm-desktop-patterns.js
                       connected chrome: the options strip (a kit vf-container band: current-ink
                       swatch + options, no tool name; hidden while the desktop is focused;
                       bounds from the active document) / the Tools palette body / the
                       Sprite View's controls (sm-atlas-controls, in the window's HEADER
                       slot: the face picker in a placed vf-container at the DITL's
                       rectangle, SPRITE_PICKER_AT -> workspace.setFace on the ACTIVE key)
                       and its body (sm-atlas-view: the clickable 3×2 face-tile vf-grid —
                       tile picks fire on the press, the selected tile ringed in
                       --sm-select red — the cells live canvases following the active
                       document) / the 3D Sprite Atlas's controls (sm-ring-controls, in
                       the window's HEADER slot: the two-row settings strip as a DITL —
                       the captions and fields placed at the top/left shell/layout.js's
                       RING_FIELDS states against the header's corner -> the ring slice)
                       and its body (sm-ring-view: the body's paper — a vf-container
                       pattern filling the body's width, the tile tall, its pattern the
                       slice's paper setting, white with no control today — holding a
                       rules="none" vf-grid in flow, one bare vf-stack cell per view
                       painted 1:1 from the sheet channel) / the 3D View's controls
                       (sm-stage-controls, in the
                       window's HEADER slot: the rotate + smooth checkboxes in a kit row
                       stack -> prefs) / the windows' status
                       readouts (tile = the window's edited face; build = the 3D View's fixed
                       name, the build stats riding its tooltip; the Sprite View and the
                       3D Sprite Atlas carry none) /
                       the app-level Colors dialog (in index.html's dialog set, rendered into its
                       LIGHT DOM on purpose: the kit's page-drawn cursor stays above a modal only
                       when it can observe the vf-dialog's `open` flip, and its observer sees the
                       light DOM alone — a shadow-rooted dialog would open above the cursor) /
                       the Desktop Patterns panel's body (the kit-patterned preview well over
                       the 13×3 grid of every kit pattern over Set Desktop Pattern: a pending
                       selection picked by click, committed through shell.setDesktopPattern)
    ui-bits.js         shared caption + warning-row template helpers (+ the warn row's styles,
                       a css export its consumers compose into their own `static styles`) and
                       the `pattern` attribute's parse the two patterned-cell views share
    base-styles.js     the shared border-box reset every component composes first (box-sizing
                       doesn't inherit across shadow boundaries)
  image-io.js     File/URL/bytes <-> ImageData codecs, a canvas -> PNG bytes, PNG downloads,
                  generated icon art (browser)
  icons.js        registers the Adobe Spectrum workflow <sp-icon-*> tool-cell + warning glyphs, written literally in the component templates (color via currentColor, size via --mod-icon-size; no sp-theme)
```

### UI layer: Lit + a hand-rolled store

The chrome is `lit`, the library `vintage-frames` itself is built on (one deduped
copy — `npm ls lit`), organized in **three layers with dependency arrows only
pointing down**: presentation (`components/` + `scene/` + `shell/`) → app
state (`state/`) → domain (`lib/`, with `storage/` a leaf the files slice
takes by injection, so it stays Node-testable). The state mechanism is a
~40-line observable store (`createStore`: get / patch / subscribe). The
app-level slices are `workspace` (the open documents — see below),
`session` (the editor's brush state), `prefs`, `build`, `files` (the
document library), and `shell` (appActive + icon
selection); `doc` (the canonical document) and `history`
(undo/redo) are **factories, instantiated per open document** inside each
workspace DocContext. Two Lit ReactiveControllers bridge them:
`StoreController` (re-render on a slice change) and `ActiveDocController`
(re-render on workspace changes AND the active document's structural
changes, re-wired across activation switches via `followActive`).
**Connected** components (`sm-editor` and the chrome) read slices and call
named actions, and the `shell/` modules wire the desktop's skeleton
(menus, windows, icons — index.html markup, behavior only) to the same
slices; the editor **leaves** are dumb — props down, bubbling `sm-*` events
up, no store imports — so store coupling stays visible and greppable. Every
component is a **standard shadow-DOM Lit element**: its
styles live with it as ``static styles = css`…` ``, scoped to its own root and
composed over a shared `baseStyles` (`components/base-styles.js` — the
border-box reset, which does not inherit across shadow boundaries). The one
deliberate exception is `<sm-color-picker>`, which renders into its **light
DOM**: the kit's page-drawn cursor keeps itself above a modal by re-promoting
its top-layer popover when it observes a `vf-dialog`'s `open` attribute flip,
and its MutationObserver watches the light DOM only — a shadow-rooted dialog
opens above the cursor art. The same token discipline applies inside shadow
roots that state a cursor of their own (the canvas's crosshair, the tool
cells): `applyCursor()`'s `* { cursor: none }` blanket can't pierce a shadow
root, so those declarations read `var(--vf-cursor, …)` first, exactly like
the kit's own chrome. Hosts that
are pure containers dissolve with `:host { display: contents }`, so the
flattened box tree is exactly what the classed markup lays out;
`<sm-tool-options>` and `<sm-options-bar>` carry real boxes (they ARE the
options area and its strip). Leaf events are dispatched on the host element
itself — the host lives in the parent's tree, so they reach the container
without `composed`. `style.css` keeps only the page's share: the palette
tokens (custom properties inherit into every shadow tree), the reset, the
black ground behind the desktop bezel, the light-DOM Colors-dialog host's
display, the 3D viewport's fill rules, and the
drop overlay `drop-target.js` renders into the page. The `.warn` row's styles
live with its template as ui-bits' `warnStyles` export, composed by whoever
renders `warnRow()`. One consequence for tooling: `tools/capture.sh dom`
serializes light DOM only — now the desktop skeleton (menus, windows,
dialogs) plus `<title>`, but never the components' internals — so the
byte-deterministic screenshots and the shadow-piercing `drive.mjs` remain
the regression surface.

**The two-speed state system** is the correctness core. Store state is what
templates read; everything the canvas hot paths touch is a plain `#private`
field in `<sm-draw-canvas>` (the pixel buffer and its `ImageData` view,
stroke/drag state, the on-screen scale) — so a pencil drag can never schedule a
re-render at pointer-move rate. Each document's doc formalizes the split
with **two channels**: `subscribe` (change — structural: load / resize /
replace-all / undo restore, drives templates, view-model re-derivation,
dirty tracking and menu sync) and `onLive` (stroke-rate, rAF-coalesced
blit-then-notify, whose only subscribers are the mesh rebuilder and — same
cost class, one blit per frame — the Full Sprite View, both following the
ACTIVE document). A live stroke lands via `applyTileEdit`,
which stores the canvas's working buffer **by reference** into `views[face]`
_silently_ on the change channel — the onion-skin recomputes only on a
face switch or structural change, never mid-stroke — and every
canonical-atlas consumer (save, export, resize, replace-all, an undo
snapshot) folds the pending stroke in first through the one `drain()` guard.
Canvas backing stores are sized imperatively in `updated()`, never bound in a
template (a bound `width` would clear the buffer mid-diff); user-editable
`vf-*` values are controlled bindings with `live()`, so a re-render can't skip
a re-sync after typing.

**One element per document, for the document's lifetime:** each document
window's `<sm-editor>` is created with its window (the reconciler assigns
its DocContext before the append — via `document.importNode`, so the clone
is upgradeable and the assignment lands before `connectedCallback` wires
the doc subscription) and lives until the document closes. The desktop's
raise-driven DOM re-orders disconnect/reconnect it without loss (the canvas
subsystem rebuilds its observers on reconnect), and the brush state lives
in the app-level session slice, so it couldn't die with a DOM node anyway.
A face swap, tile resize, all-tiles replace or undo is just a store action;
the editor re-derives its per-face view model (memoized on face /
`views`-identity / tile geometry) and the canvas resets its working buffer
only when the tile's IDENTITY actually changes.

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
  call and a handful of triangles, and the render loop only redraws on change
  (idle scenes don't repaint). The carve is a synchronous O(n³) walk, so the tile
  stepper is capped at **64** (a 64³ grid still rebuilds live per stroke); to lift
  that ceiling, move `buildVoxels` to a Web Worker (it's pure typed-array code,
  trivially transferable — and `scene/rebuilder.js` is the pipeline's only
  caller, so making it async is a local change). For a scene of _many_ objects,
  batch identical ones with an object-level `InstancedMesh`.
- **Autosave** — a deliberate non-goal: explicit Save is the contract, with
  the `beforeunload` guard (any dirty open document) as the net; untitled
  windows don't survive a reload for the same reason.
- **The registered move** — the selection tool's next step, and the one
  that makes it a 3D tool: a move "on all faces" that keeps the atlas in
  registration. A marquee on one face is a slab of voxels — a FRONT rect's
  columns on TOP/BOTTOM, its rows on LEFT/RIGHT, its mirror on BACK — so a
  horizontal move on FRONT shifts those columns on the top and bottom
  faces (and the mirrored ones on BACK) by the same delta, a vertical move
  those rows on the sides, everything else untouched; the per-face bounds
  and deltas come from the views' image-axis table (`VIEW_IMAGE_AXES`, the
  one the sheet resize registers by), the per-face edit is `select.js`'s lift / clear /
  composite over each face's slice, and the undo is one whole-atlas
  snapshot. Controlled by a session checkbox in the strip, the fill tool's
  "on all faces" idiom. The single-face move is written so nothing about it
  changes shape for this (see `#applyMove` in `sm-draw-canvas.js`).
- **Export** — File → Export 3D Model… is a parked configurator dialog, a
  form only: the merged mesh is glTF-ready (`GLTFExporter`), and the
  `onMesh` seam the 3D Sprite Atlas added already hands every mesh to a
  consumer outside the stage. File → Export Sprite Atlas… is live (see
  [Windows](#windows)); its follow-ups: per-document settings in a
  `sprite-machine:ring` chunk on the document itself (the transforms
  chunk's idiom — the export chunk already has the JSON shape), a drop
  shadow in the sprite (a `ShadowMaterial` ground, consistent across the
  ring under the camera-relative key), elevation presets for isometric
  engines (30 / 35.264 / 45 / 60), and per-frame padding for engines that
  want it (the tile size is the user's already, so a power-of-two frame is
  a typed number; the scrolling strip shipped — see [Windows](#windows)).
  File → Download stays the source path (the document `.png` verbatim).
