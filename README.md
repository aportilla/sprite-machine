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
(fixed window size, DSF 1, virtual time budget, `rotate=0`, and `?fresh=1` on a
machine with saved docs), so `cmp` between two runs is a real regression check
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
document** (face picker + pixel canvas — several documents can be open at
once), and three floating **utility windoids** that serve whichever document
is active — the **Tools palette**, the **Full Sprite View** (the whole
atlas, live), and the **3D View** — plus documents that live as **files on
the desktop**, saved in the browser and reopened by double-clicking their
icons. Clicking the desktop is "switching to the Finder": the application
deactivates, its windoids hide, and the menus fall back to the desktop's
grammar. See [The desktop](#the-desktop).

**Double-click a sample icon** (Car, Cube — they open as fresh untitled
copies), pick File → Open…, or drop your own **3×2 sprite sheet** PNG
anywhere on the window. **Smooth slopes** (low-poly additive 45° wedges) is
on by default and toggles live in Settings; greedy meshing is always on.
Sprites are hard pixel art — every texel is fully opaque or fully
transparent — and every face with no view of its own is mirror-filled from
its opposite at render time. The **face picker** (six pixel-art cube icons
over radio buttons) switches which of the six you're editing (a
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
TOP covers its column. Use **square tiles** (a cubic lattice); the in-app editor
draws alignment guides to help you line pixels up.

**Tile orientation** (world: `+x` right, `+y` up, `+z` = front toward camera) —
draw each tile this way for a zero-transform ingest:

| Tile         | Draw as…                                                | Front points | Size           |
| ------------ | ------------------------------------------------------- | ------------ | -------------- |
| FRONT / BACK | head-on / from behind, upright                          | —            | width × height |
| RIGHT        | the right side                                          | right        | depth × height |
| LEFT         | the left side                                           | left         | depth × height |
| TOP          | plan view, width horizontal                             | top edge     | width × depth  |
| BOTTOM       | plan from below (car rolled sideways, not end-over-end) | top edge     | width × depth  |

The editor's **face picker** switches which tile you're editing; check each tile's
orientation against this table's **Front points** column, using the faded
onion-skin of the mirrored opposite and the alignment guides behind the canvas.
Per-tile `rot`/`flip` transforms exist in the pipeline for sheets that don't
follow the convention.

## Drawing editor

The **document window** holds the drawing surface — the face picker row over
the black-framed artwork well — and the 3D View rebuilds live as you draw.
The tools live in the floating **Tools palette**, their per-tool options in
the **options strip** under the menu bar, and the tile-size stepper in
File → Properties…. Every control is a `vintage-frames` System 7 web
component (`vf-number-field`, `vf-radio-group`, `vf-slider`, `vf-checkbox`,
`vf-swatch`, `vf-grid`, `vf-dialog`, `vf-menu`, …), driven from a Lit
template — see [UI layer: Lit](#ui-layer-lit).

- **Canvas layout** — the pixel canvas fills the artwork well — its height is
  **CSS-driven** (flex), no JS pin — and the square editable canvas is
  **centered** in it and drawn **as large as an integer texel scale fits**
  (crisp, never a fractional pixel), **re-fitting responsively** when the
  window (or its grow box) resizes. See `#layout()` in
  `src/components/sm-draw-canvas.js`. View → Show Grid (⌘G) draws the texel
  lattice on the overlay, only at scales ≥ 4 where the hairlines don't swamp
  the art.
- **Tools** — the **Tools palette** holds the **tool strip**: a single column of square
  cells (**pencil `B`**, **rect `R`**, **fill `G`**, the **eraser `E`**, and the
  **eyedropper `I`**; the selected cell inverts) — each an icon from the
  open-source **Adobe Spectrum _workflow_** set (`draw` / `rectangle` /
  `color-fill` / `erase` / `sampler`) in a `vf-grid` lattice. The **options
  strip** (the white band under the menu bar) names the active tool and holds
  its options. For the **pencil**, a **tip-size slider** (with an
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
  a plain click is a **contiguous 4-connected flood** from the clicked texel (the
  connected region sharing its color becomes the active ink). **replace** upgrades
  that to a **whole-tile recolor** — _every_ texel matching the clicked color on the
  tile, contiguous or not. **all tiles** (only active while **replace** is on)
  extends the recolor across **every tile in the atlas**, so it's a global
  find-and-replace of one color. Transparency is a first-class "color": clicking
  empty space targets transparent (so **replace** floods every empty texel with the
  ink), and a **right-click** fills _to_ transparent (delete a
  color). The flood + replace are pure, Node-tested primitives (`src/lib/fill.js`).
  Every edit is **undoable** (Edit → Undo ⌘Z / Redo ⇧⌘Z): a gesture — stroke,
  rect, fill — undoes as one step, and an all-tiles replace or tile resize as
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
  region); the eraser cell is the _sticky_ one. Below the tool strip sit the
  **color wells**: the **current-ink swatch** (a `vf-swatch` showing the active
  ink that, **clicked**, opens the **"Colors" dialog** over the **full 256-color
  palette**) and the **last three used colors** under it (a most-recently-used
  row — every pick, eyedrop, or recency re-pick promotes its color; clicking one
  re-inks instantly). The
  **eyedropper** (`I`) is a sticky mode exactly like its siblings: it stays
  selected, and every canvas click samples the clicked texel — a painted texel's
  color becomes the **ink**, and **empty space hands you the eraser** (sampling
  emptiness selects the eraser tool) — until another tool is picked (while it's
  active a 1-cell hairline outline marks its sample target under the OS
  crosshair). Hold **Alt** instead for a momentary sample that doesn't leave the
  current tool (with the same two exceptions: a color pick leaves the eraser, an
  empty sample selects it). The
  dialog is a System 7 movable modal (`vf-dialog`) holding a 16×16 `vf-grid` of
  **256 distinct** swatches (**Esc** or the **close box** closes it). The base is
  the standard **xterm-256** set — but xterm-256
  names 256 indexed _slots_ and only 247 _distinct_ colors (nine values, e.g.
  `#808080`/`#000000`/`#ffffff`, repeat where its system, cube, and grayscale
  ranges overlap), so the nine redundant cells are backfilled with shades
  **interpolated from their Hilbert neighbors** — every cell is now a unique color
  that still sits in its local cluster. The whole thing is **laid out along a
  Hilbert curve** — a locality-preserving 1-D color order poured into the grid
  along a 2-D Hilbert curve, so similar shades stay adjacent both across and down
  (organic clusters, not strict bands): grayscale in the top-left, magentas/reds
  across the top, blues down the right, greens/cyans sweeping the bottom. The
  arrangement is a fixed, hand-verified layout spelled out in
  `src/lib/constants.js` (`PALETTE_256`). **Wedge-safety caveat:** xterm-256 is dense
  enough that some adjacent swatches fall _within_ the low-poly wedge merge tolerance
  (`sameMat`, `TOL2 = 12²` squared-L2), so a staircase of two such shades can now
  auto-smooth into a wedge. Recomputed against the real palette + gate there are **16
  within-tolerance pairs**: ten near-neutral grays (the grayscale ramp steps ~10/channel)
  **plus six fully _saturated_ dark primaries/secondaries** — an xterm system color
  (`0x80`=128) lands ~7–10 units from the matching 6×6×6-cube level (`0x87`=135) at the
  same hue (maroon, navy, green, purple, olive, teal). So it's **not only near-neutrals**:
  an author can place two of those on adjacent staircase voxels and get an unintended (but
  near-imperceptible) wedge. The 6×6×6 cube _levels_ still stay ≥40 apart _within_ the
  cube; it's the system-vs-cube overlap at the low end that adds the saturated pairs (the
  earlier sparse 8×8×4 grid kept _every_ swatch ≥36 apart, so none merged).
  `test/palette.test.mjs` pins the exact set. Every stroke is hard-pixel: fully opaque or fully erased, never
  anti-aliased.
- **Face picker** — six **cube-view icons** over a radio row (a `vf-radio-group`)
  across the document window's top switch which face you edit, laid out as mirror pairs
  (`left`/`right`, `front`/`back`, `top`/`bottom`)
  so you can flip between a pair for reference. Each icon is a **21×26 pixel-art**
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
  at any display scale. A **mirror-derived** face (one with
  no art of its own) opens with an **empty canvas** and a **faded onion-skin** of
  the mirrored opposite behind it for reference; it becomes its own independent art
  only once you actually change a pixel — switching away and back leaves it derived,
  and erasing it fully reverts it to derived.
- **Live + canonical** — edits write straight back into the current sheet, so
  File → Save persists exactly what you see, File → Export downloads it (see
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
axis agrees. To help meet that stricter requirement the editor draws **hairline
extent rules** (how far the orthogonal faces' pixels reach — the box a pixel must
land inside to survive the carve) and a **faded onion-skin** of the opposite face
behind the canvas. There is **no auto ground-rest**: an object sits at whatever Y
you paint it (paint at the tile's bottom to rest on the ground). The editor is
pure authoring — no changes to the carve / colorize / mesh pipeline. See
`src/components/` (the `<sm-editor>` container and its leaves) and
`src/lib/guides.js`.

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
`?palette=1` to open the 256-color "Colors" dialog on the first mount, `?cursor=<N>`
to set the pencil size to N and draw its filled footprint preview at the tile center
on mount, `?pick=<N>` to select `PALETTE_256[N]` as the ink on mount (as if picked
from the dialog) so a shot can show it landing as the current-ink swatch, and
`?rect=<x0,y0,x1,y1[,r[,sq]]>` to select the rect tool and draw its live drag preview
for that box (corner radius `r`; `sq=1` for the Shift square-lock) on mount so a shot
can show the tool mid-drag, and `?fill=<x,y[,r[,a]]>` to select the fill tool, set its
checkboxes (`replace=r`, `all-tiles=a`), and fill at `(x,y)` on mount (the mount fill
is always applied to the current tile only — combine with `?pick=<N>` to fill with a
specific palette color) so a shot can show the tool + result — the
stepper, face picker, dialog, swatch pick, hover preview, rect drag, and fill click
can't be driven headlessly. Two shell-era params round the set out:
`?fresh=1` boots with **storage ignored** (no desktop-state restore, no
last-doc reopen, no saved-doc icons, no state writes — deterministic captures
on a machine with saved docs) and `?hide=<window>[,<window>]`
(`document|tools|sprite|stage`) hides windows a capture needs out of frame.

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
  application), the options strip blanks, the bare-letter tool keys
  go inert, and the menus drop to the **Finder grammar** — About / Settings
  / Quit / New stay enabled, Open… enables when a desktop icon is selected
  (and then opens the selection instead of the listing dialog), everything
  document-scoped greys out. A disabled item's key equivalent never fires
  (the kit's contract), so ⌘S/⌘Z/⌘K/⌘G gate with their menus.
- **Clicking any document window — or opening one** (File → New, an icon
  double-click, a drop) — **reactivates**: the windoids come back exactly
  where they were, aimed at the newly active document.
- Closing the last document window leaves the same desktop-focused state:
  a bare desktop whose windoid arrangement survives for the next open.

### Documents are windows

**One document = one window.** File → New, a sample icon, the Open flow, and
a dropped PNG each open a **new** document window (staggered System 7
style); nothing ever loads over an open document — the unsaved-changes
question lives entirely on the close paths. Opening an already-open stored
document just activates its existing window. Untitled names count up
(`untitled`, `untitled 2`, …). Each document window carries its own
editor, its own edited-face selection, and its own bounded undo history;
the tool, ink, and recency stay app-level (one palette, one ink, System 7
style). The utility windoids and the Edit menu always serve the **active**
document: switching windows re-targets the 3D View (the camera re-frames —
a window switch is a new subject), the Full Sprite View, the options
strip's clamp bounds, and the Undo/Redo enablement.

### Menu bar

- **Sprite Machine** — _About…_, _Settings…_ (the render prefs: smooth
  slopes, auto rotate), _Quit_ (the System 7 cascade: every open document in
  turn, one unsaved-changes alert per dirty one — its window brought forward
  as it's asked about, Cancel anywhere aborting the rest — down to the bare
  desktop, windoid arrangement intact).
- **File** — _New_ (a new untitled window), _Open…_ ⌘O (two grammars: the
  saved-docs + samples listing dialog while a document is focused; with the
  desktop focused it acts on the selected icon, Finder-style), _Close_
  (the active document, dirty-checked), _Save_ ⌘S (first save of an untitled
  doc prompts for a name), _Duplicate_ ⌘D (the stored copy opens in its own
  window), _Rename…_, _Export…_ ⇧⌘E (downloads the document `.png`
  verbatim), and _Properties…_ (name, atlas dims, the tile-size stepper —
  all of the active document).
- **Edit** — _Undo_ ⌘Z / _Redo_ ⇧⌘Z (the ACTIVE document's history;
  disabled until it has something — which also hands the key back to a
  focused field's native undo), _Pick Color…_ ⌘K (the 256-color dialog, in
  the active window).
- **Tools** — the five sticky tool modes — _Pencil_, _Rectangle_, _Fill_,
  _Eraser_, _Eyedropper_ — with the active one checkmarked (the same session
  truth the palette's tool strip and the B/R/G/E/I keys write, so a pick from
  any of the three moves all three).
- **View** — _Show Grid_ ⌘G (checkmarked). The windoids need no toggles:
  they're permanent, up whenever a document window is active.

Key equivalents are the kit's own (`shortcut` on `vf-menu-item`; Ctrl stands
in for ⌘ off-Mac). ⌘N/⌘W stay unassigned on purpose — the browser owns them
before the page ever sees them. The bare-letter tool keys (B/R/G/I/E) keep
living in `src/shortcuts.js`; the kit deliberately never matches an
unmodified printable key — which is also what lets the Tools menu _display_
those letters in its shortcut column without ever double-firing them.

### Windows

Two tiers, two regimes:

- **Document windows** (document tier): one per open document, cloned from
  the `#tpl-document-window` template by the reconciler in
  `shell/windows.js` — created on open (staggered defaults, or a restored
  position for a saved doc), removed on close (existence IS visibility).
  Each is `movable resizable`; its title is its document's name, its
  `status` strip reads its own tile size, and its `<sm-editor>` lives
  exactly as long as the document is open.
- **Utility windoids** (floating tier, `variant="utility"`): the **Tools
  palette**, the **Full Sprite View**, and the **3D View** — static markup,
  **permanently open**: persistent panels with no close box and no menu
  toggle, always on screen for the active document (only the desktop's
  deactivation hides them). They float above every document window, never
  take the active state (clicking the 3D View can't deactivate the window
  you're drawing in), show the kit's slim 11px dot bar (no title text, no
  close box — the heading still names the window for assistive tech), and
  hide as a set whenever the application deactivates, returning with it. The
  sprite and 3D windoids stay `resizable` — the canvases re-fit via their
  own ResizeObservers, so the grow box works for free. The **Full Sprite
  View** (`sm-atlas-view`) draws the whole atlas nearest-neighbor, scaled to
  fit the window as large as its aspect ratio allows (never clipped, never
  scrolled), following the ACTIVE document's **live channel**, so it tracks
  strokes at rAF rate (the second live subscriber ever, after the
  rebuilder); the **3D View** hosts the THREE canvas with the build readout
  in its status strip.

Positions/sizes are authored defaults clamped to the live raster at boot.

### Documents: a document IS a .png

A document is exactly one sprite `.png` — the 3×2 atlas — with all metadata
in standard PNG text chunks (`lib/png-chunks.js`): `Title`, `Creation Time`,
`Software`, and `sprite-machine:transforms` (written only when
non-identity). The pixels alone are already a complete document (tile size
derives from the dimensions), so **Save, Export and drop-import converge on
a single format**: File → Export downloads the saved bytes verbatim,
dropping any exported PNG back restores it losslessly (title included — the
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
Rename…, so any open window of that document retitles along), plus a
read-only cluster of sample icons; double-click opens (samples as fresh
untitled copies, stored docs into their existing window if one is open),
selecting an icon deactivates the application (a press in the icon layer is
a press on the Finder) and arms the desktop-focused File → Open, and every
open doc's icon wears the kit's `open` ghost. Icon art is generated **from
the document itself**: the FRONT tile drawn into 32×32 → data URI,
regenerated on every save (empty front tile ⇒ a generic document glyph),
declared `color` so selection darkens instead of inverting. Windoid/icon
layout, Show Grid, and the open SAVED documents (each window's geometry +
edited face, and which was active) persist in one versioned localStorage
key (`shell/desktop-state.js`, v2 — a v1 blob migrates shallowly), restored
at boot and snapshotted on change/exit; untitled windows deliberately don't
survive a reload (no autosave — explicit Save is the contract). The
documents themselves live in IndexedDB.

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
   lattice line and must line up across faces (the author's job — the editor
   guides help).
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
round-trip) that the drawing editor depends on. `test/guides.test.mjs` pins the
editor's cross-axis alignment guides (and that `VIEW_IMAGE_AXES` can't drift from
the projections it's probed from). `test/rect.test.mjs` pins the rect tool's
rounded-rectangle rasterization (radius clamp, convex corners, per-row symmetry) and
the Shift square-lock. `test/fill.test.mjs` pins the fill tool's flood + replace
primitives (4-connectivity, contiguous vs. global scope, transparent-as-a-color,
the no-op guards, and a full-tile flood that can't overflow the stack).
`test/palette.test.mjs` pins the editor's
256-color palette: 256 entries, all distinct, valid `#rrggbb`, `packed`
derived from `css`, and the exact set of within-wedge-tolerance color pairs (the
six saturated system-vs-cube overlaps included) so the wedge-safety note can't drift.
`test/brush.test.mjs` pins the pencil primitives (Bresenham continuity, footprint
anchoring, the transparent-idempotence rule). `test/png-chunks.test.mjs` pins
the document format's chunk surgery (round-trip, CRC against the published
IEND reference, splice position, replace semantics, unknown-chunk
passthrough).

The **app-state layer** (`src/state/`) is pure JS with the same treatment:
`test/store.test.mjs` (the observable store: by-reference values, silent no-op
patches), `test/session.test.mjs` (tool/ink semantics, MRU recency promotion,
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
snapshot copy-in/copy-out, the bound, load-boundary clearing), and
`test/params.test.mjs` (the whole `?param` dev-hook surface, typed).

Beyond that pipeline integration, the pure modules also have direct unit suites:
`test/carve.test.mjs` (vox/unvox round-trip, `extractSurface` masks + counts,
`reconcileDims`, `placeView`, plane-union, and a `projectInto`↔`project` drift
guard), `test/colorize.test.mjs` (the mirror-fill / relaxation / dominant-body
fallback tiers, on all three axes), `test/ingest.test.mjs`
(`applyTransform`/`flip` + the `ingestSprite` throw path), and
`test/t-junction.test.mjs` (multi-vertex edge splits with area + colour/normal
preservation), and `test/color.test.mjs` (the shared `rgbKey`/`distinctColors`
helpers — big-endian 24-bit keying, first-seen dedup, and the deliberately looser
`alpha===0`-only skip vs. ingest's `alpha>=128`). `test/mesh.test.mjs` loads THREE to check `voxelMesh` welds
watertight, centres X/Z, and leaves Y as authored, plus the shared vertex-color
linearizer cache; `test/diag.test.mjs` exercises the `?diag=1` watertightness
self-check on closed vs. open surfaces.

```
src/lib/
  constants.js    default mirror (all-on) / world-size + DB16 pencil palette + Hilbert-laid xterm-256 palette (pure)
  color.js        shared color helpers: hexToRgb, rgbKey (24-bit dedup), distinctColors (pure)
  views.js        6 view defs + the face vocabulary (keys/normals/index/axis) all derive from FACE_NORMAL; projections, front-edge meta
  atlas.js        slice a 3x2 sheet <-> face tiles: blitTile write-back, cellOf, validateSheet (pure)
  ingest.js       sprite -> occupancy/color arrays (full tile, no crop), place, reorient
  carve.js        dim reconciliation, visual-hull AND, surface extraction
  colorize.js     depth-aware first-hit surface coloring + palette snap
  faces.js        surface voxels -> quads: greedy-merged or culled (pure)
  guides.js       editor alignment guides: per-face cross-axis extent (pure)
  rect.js         editor rect tool: rounded-rectangle rasterization, per-row runs (pure)
  fill.js         editor fill tool: contiguous flood + global color replace (pure)
  brush.js        editor pencil primitives: writeTexel / stampBrush / strokeLine (Bresenham) (pure)
  pipeline.js     ingest -> carve -> colorize  (pure; Node-testable)
  t-junction.js   lattice-exact T-junction repair for merged+wedge meshes (pure)
  mesh-util.js    shared vertex-color linearizer + mesh finishing (THREE)
  mesh.js         quads -> merged, vertex-colored THREE.Mesh    (voxel mode; THREE)
  wedge-mesh.js   voxel solid + additive 45° wedges             (low-poly mode; THREE)
  sprite-data.js  built-in samples (as atlases) + grid->ImageData helper
  png-chunks.js   PNG chunk surgery: parse + tEXt/iTXt read/replace, CRC32 — the document format (pure)
  diag.js         geometry watertightness self-check (dev only; ?diag=1)
src/state/        the app-state layer (pure JS, zero deps beyond lib/, Node-tested)
  store.js            createStore(): get / patch / subscribe — values BY REFERENCE, silent no-op patches
  store-controller.js the Lit bridges: StoreController (store change -> host.requestUpdate) and
                      ActiveDocController (workspace + active-doc structural changes, re-wired
                      across activation switches)
  doc.js              the canonical document (atlas + sliced views + tile geometry) with TWO channels:
                      change (structural) and live (stroke-rate, rAF-coalesced blit-then-notify);
                      owns applyTileEdit / drain / dropLive / loadAtlas / resizeTiles / replaceAllTiles
                      / restoreTile / restoreAtlas (the undo paths). A FACTORY — one instance per
                      open document (no singleton)
  workspace.js        the OPEN documents: DocContexts (own doc + history + face + fileId/name/dirty),
                      activeKey (the kit's vf-activate mirrored in), untitled naming, per-context
                      dirty tracking, the stored flows (openStored/save/duplicate/rename/export),
                      and followActive() — the follow-the-active-document primitive
  session.js          editor session (app-level): tool, ink, MRU recency, per-tool options, picker
                      flag — one palette, one ink, however many documents are open
  prefs.js            lowpoly / autoRotate (the render toggles; Settings… writes them)
  build.js            dims / voxels / tris / warnings / error — written by the rebuilder, read by the status line
  files.js            the document LIBRARY: listing + availability + per-document storage ops
                      (save/load/rename/remove/export, each taking an explicit doc + identity) —
                      browser deps (storage, PNG codec, icon art) injected
  shell.js            appActive + icon selection + showGrid (the menus, the focus gating and the
                      boot restore share one truth; the windoids are permanent — no flags)
  history.js          bounded undo/redo: tile-gesture + whole-atlas snapshot entries over the doc's
                      restores. A FACTORY — one instance per open document (no singleton)
  derive.js           pure selectors: editorViewModel(doc, face) -> { tile, mirrorBehind, guides, wasDerived }
src/storage/
  db.js           the IndexedDB promise wrapper (one `docs` store) the files slice takes by injection
src/scene/
  stage.js        renderer, camera + orbit controls, lights, ground, framing, on-demand render loop, resize
  rebuilder.js    the pipeline's ONLY consumer: follows the ACTIVE document (change+live channels,
                  re-wired per activation) + prefs -> buildVoxels -> mesh swap -> build stats;
                  a window switch re-frames the camera (a new subject)
src/shell/        the desktop's behavior modules (imperative wiring over the index.html skeleton)
  windows.js      the two window regimes: windoid visibility (appActive <-> hidden; non-closeable), and
                  the document-window reconciler (template clone per context, stagger/restore,
                  title sync, close-box routing); the vf-activate wire into shell.appActive +
                  workspace.activeKey; boot clamp
  menus.js        vf-menu-select -> workspace/file actions on the ACTIVE document; the two-role
                  focus gating + checkmark sync; every dialog flow (About / Settings / Open /
                  name prompt / Properties / unsaved-changes / storage notice); the quit cascade
  icons.js        the icon layer: sample cluster + one vf-icon per saved doc, generated front-tile art,
                  open/rename wiring, open ghosts, the Finder wire (icon presses deactivate; the
                  selection feeds the shell slice for the desktop-focused File → Open)
  desktop-state.js  windoid/icon layout + Show Grid + the open saved docs (geometry, face, active)
                  in one versioned localStorage key (v2; v1 migrates)
src/
  main.js         the composition root: parse params -> seed stores -> fit desktop + cursor -> shell wiring
                  -> stage + rebuilder -> boot documents (session restore or sample)
  boot/params.js  URL-param parsing -> one typed boot object (pure, Node-tested)
  loaders.js      every way a sheet enters (sample / file / blank): decode + validateSheet -> a FRESH
                  workspace context | build.setError; a dropped PNG's Title/transforms chunks
                  restore its identity
  drop-target.js  whole-app drag & drop + overlay -> loaders -> the new window surfaces
  shortcuts.js    document-level B/R/G/I/E -> session actions, gated on appActive (menu key
                  equivalents are the kit's; Esc/Shift are gesture-scoped and live in the canvas)
  components/     all Lit, standard SHADOW DOM (mostly `:host { display: contents }`) — see "UI layer" below
    sm-editor.js       CONNECTED container: a document window's body, one per open document — face
                       picker + artwork well + Colors dialog over ITS DocContext (`ctx`, assigned by
                       the reconciler pre-append); memoizes the per-face view model (face /
                       views-identity / geometry), feeds canvas gesture commits to ITS history
    sm-draw-canvas.js  leaf: the pixel-canvas subsystem — working buffer (+ImageData view, by reference),
                       pencil/rect/fill gestures, integer-scale layout, overlay layers, gesture-scoped keys,
                       per-gesture undo capture (sm-commit)
    draw-overlays.js   pure canvas painters for the guide hairlines / texel grid / hover footprint /
                       rect drag preview
    sm-face-picker.js, sm-tool-strip.js, sm-color-wells.js, sm-tool-options.js, sm-color-picker.js
                       presentational leaves: props down, bubbling sm-* events up, no store imports
    sm-options-bar.js, sm-tools-panel.js, sm-atlas-view.js, sm-status-line.js
                       connected chrome: the options strip (blank while the desktop is focused;
                       bounds from the active document) / the Tools palette body / the live
                       full-atlas view (follows the active document) / the windows' status
                       readouts (tile = per-window ctx; atlas = active doc; build = build slice)
    ui-bits.js         shared caption + warning-row template helpers (+ the warn row's styles,
                       a css export its consumers compose into their own `static styles`)
    base-styles.js     the shared border-box reset every component composes first (box-sizing
                       doesn't inherit across shadow boundaries)
  image-io.js     File/URL/bytes <-> ImageData codecs, PNG downloads, generated icon art (browser)
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
selection + Show Grid); `doc` (the canonical document) and `history`
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
border-box reset, which does not inherit across shadow boundaries). Hosts that
are pure containers dissolve with `:host { display: contents }`, so the
flattened box tree is exactly what the classed markup lays out;
`<sm-tool-options>` and `<sm-options-bar>` carry real boxes (they ARE the
options area and its strip). Leaf events are dispatched on the host element
itself — the host lives in the parent's tree, so they reach the container
without `composed`. `style.css` keeps only the page's share: the palette
tokens (custom properties inherit into every shadow tree), the reset, the
black ground behind the desktop bezel, the 3D viewport's fill rules, and the
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
_silently_ on the change channel — guides and onion-skin recompute only on a
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
- **Export** — the merged mesh is glTF-ready (`GLTFExporter`) for use in other
  engines / animation.
