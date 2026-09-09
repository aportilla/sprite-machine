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

Three headless-Chrome tools verify what Node can't, all against a running dev
server:

```bash
tools/capture.sh shot 'http://localhost:5173/?sample=car' /tmp/shot.png
tools/capture.sh dom  'http://localhost:5173/?diag=1'   # light-DOM shell + title
tools/goldens.sh check                                  # the look, against docs/goldens/
node tools/drive.mjs                                    # the user journeys, on trusted input
```

`capture.sh` shows what the app **looks** like, and its shots are
byte-deterministic — fixed window size, DSF 1, a virtual time budget, a fresh
profile per run, the model at rest, `?now=` whenever the clock is in frame —
so `cmp` between two runs is a real regression check. `goldens.sh` holds eight
such shots under `docs/goldens/`: every "does it look right" question lives
there as pixels, and a golden changes only in a commit that changed the look
on purpose. `drive.mjs` covers what no screenshot can — about ninety checks
over thirty journeys, driving the desktop over the DevTools Protocol with real
trusted input, probing through shadow roots, exiting non-zero on any failure.
Its waits are on **the app's own readiness contract**, never a pause:
`main.js` marks the root `data-sm-boot="ready"` once the boot chain has
landed, and every wait after an input is on the outcome the next check reads.
The residue is a manual checklist, `docs/SMOKE-TEST.md`. What gets a test is
[Testing](#testing).

The app is a **System 7 virtual desktop**, drawn end to end with the
[`vintage-frames`](https://github.com/aportilla/vintage-frames) web component
kit: a menu bar, an options strip, one movable **document window per open
document**, and floating **utility windoids** serving whichever document is
active — the **Tools palette**, the **Full Sprite View** (the face picker over
the whole atlas as a live, clickable face-tile grid) and the **3D View**, plus
the toggleable **3D Sprite Atlas** (the model rendered orthographically from a
ring of angles, the rotation set an engine consumes, and what File → Export
Sprite Atlas… saves). Documents live as **files on the desktop**, saved in the
browser and reopened by double-clicking their icons, with **folders** to file
them in and the **Trash** to delete them by. Clicking the desktop is
"switching to the Finder": the application deactivates, its windoids hide, and
the menus fall back to the desktop's grammar. See
[The desktop](#the-desktop).

The first-ever boot **seeds two starter documents** (Car, Cube) as ordinary
saved files. They are created once and never come back: the profile records
the seeding (a `seeded` flag written only once every built-in is stored), and
that record, not the mere presence of state, suppresses it — so a first boot
cut short by a reload finishes seeding on the next one, nothing doubled, while
deleting or emptying later never resurrects them.

Every load **boots to the About box** (see [The About box](#the-about-box)).
OK it, or click outside it, and the bare desktop is yours — unless the URL
names a saved document (**`?file=Cube`**, or the bare fragment **`#Cube`**;
case-insensitive, most-recently-modified on a collision), which opens that
file on its remembered edited face. A prior session's open windows
deliberately don't reopen — the URL, not localStorage, says what a load shows
— and **no application window's geometry comes back either**: every session
places the windoids, and every open places its document window, fresh from the
live raster (see [Windows](#windows)). The Finder's furniture is what
restores: the desktop icons, and a folder window's box as its nine-slice pin.
The URL keeps itself true — opening, saving or switching to a saved document
**mirrors its name into the fragment** (`replaceState`; an untitled document
clears it), so a plain reload restores what's on screen. The same built-ins
live on as **templates in File → New…**, and you can drop your own **3×2
sprite sheet** PNG anywhere on the window.

**Smooth slopes** (low-poly additive 45° wedges) are **always on** — no
toggle, and the planar merge too; the one control in the 3D View's strip is
**rotate**, the auto-spin, **off every load**. Sprites are hard pixel art —
every texel fully opaque or fully transparent — and every face with no view of
its own is mirror-filled from its opposite at render time. The **face picker**
switches which of the six you're editing; a mirror-derived face reads empty,
an honest view of the sheet.

## Input: a 3×2 atlas

One sheet, six tiles, in this fixed layout (empty cells are fine — they fall
back to mirroring):

```
LEFT   FRONT  TOP
RIGHT  BACK   BOTTOM
```

The **tile size is auto-derived** from the image dimensions and the grid (a
120×80 sheet ⇒ 40×40 tiles). Each tile is a **literal slice of the voxel
lattice** — a pixel's position inside its tile _is_ its position in the
object, so tiles are read at full size (**no auto-crop**) and must be
**registered across faces**: a FRONT pixel only becomes solid where the SIDE
covers its row and the TOP covers its column. Use **square tiles** (a cubic
lattice); the editor's onion-skin helps you line pixels up.

**Tile orientation** (world: `+x` right, `+y` up, `+z` = front toward camera) —
draw each tile this way for a zero-transform ingest:

| Tile         | Draw as…                                                | Front points | Size           |
| ------------ | ------------------------------------------------------- | ------------ | -------------- |
| FRONT / BACK | head-on / from behind, upright                          | —            | width × height |
| RIGHT        | the right side                                          | right        | depth × height |
| LEFT         | the left side                                           | left         | depth × height |
| TOP          | plan view, width horizontal                             | top edge     | width × depth  |
| BOTTOM       | plan from below (car rolled sideways, not end-over-end) | top edge     | width × depth  |

Check each tile against the **Front points** column, using the faded
onion-skin of the mirrored opposite behind the canvas. Per-tile `rot`/`flip`
transforms exist in the pipeline for sheets that don't follow the convention.

## Drawing editor

The **document window** holds the drawing surface, the full-bleed white
artwork well, and the 3D View rebuilds live as you draw. The tools live in the
floating **Tools palette**, their options in the **options strip** under the
menu bar, the tile size behind Edit → Tile Size…. Edits write straight
back into the current sheet, so Save persists exactly what you see, the Full
Sprite View tracks every stroke at frame rate, and the model rebuilds
(rAF-debounced) with no camera jump.

- **Canvas layout** — the canvas fills the well, its height CSS-driven (flex,
  no JS pin), drawn on the kit's **virtual system-pixel grid**: the texel size
  is the largest whole count of system px that fits, so a texel is a whole
  count of device px at any density or zoom. The layers ride a **placed
  `vf-container`** whose box `#layout()` states in whole system px, centered
  by arithmetic — no flex centering, no measured correction — so it lands on
  the pixel lattice by construction. The canvas is **1-bit but for the art**:
  its paper is the kit's **12% dither** (`gray-12`), declared as the
  container's `pattern` and never inherited, since a bare `vf-container`
  paints the desktop's own pattern, smeared (kit ask #6). The dither is the
  transparency indicator, so **white art** reads as a clear patch in the dots.
  Nothing is drawn over the art — no grid lines — and the sprite is the only
  color on the canvas.
- **Tools** — a column of **22×19** cells: **selection `S`** first (MacPaint's
  palette led with it), then **pencil `B`**, **rect `R`**, **fill `G`**,
  **eraser `E`**, **eyedropper `I`**; the selected cell inverts. Each cell is
  exactly one **22×19 1-bit pixel-art icon**, the app's own art through
  **`vf-img`** at 1:1, the inverted cell's white glyph a CSS `invert` of the
  same file — exact because the art is pure black, and there is no icon
  library. The cell IS the icon (`TOOL_CELL`, from which `TOOLS_BOX` derives),
  and it **picks on the press**, not the click: System 7's tool palettes act
  on mouse-down. That is feel, not a bridge.
- **The options strip** is a kit-drawn band (`pattern="white" rule="bottom"`,
  the menu bar's anatomy) holding the **current-ink swatch** plus the tool's
  options. No tool-name caption: the inverted cell and the Tools menu's
  checkmark already say which tool is live. **Every label is plain ink** — no
  `dim` anywhere, dim being the disabled look — and **the cells are walled**
  by the kit's dotted `<vf-separator vertical>` under one grammar: a rule
  stands between **different things**, never between a control and its own
  readout.
- **Pencil** — a **tip-shape popup** (`circle` / `square`; circle every load)
  and a **tip-size slider** stamp an **N-texel tip**: the circle is the disc
  inscribed in the N×N box, the square the whole box. One pure primitive says
  which texels a shape covers (`brushRows`), read by the stamp, the stroke and
  the hover preview alike, so what you see is what you paint. The pencil
  **previews the tip filled with the active ink** as you hover; under a
  **right button** — the momentary erase — it wears the **erase treatment**.
- **Rect** — a **corner-radius stepper** (`0` = sharp) and a **readout** of
  the drag, `0 × 0` between drags so nothing shifts when one begins. A drag
  previews the exact filled texels at full opacity, no outline; a
  **right-drag** erases; **release** commits, and **Esc** or a tool switch
  cancels with nothing written. **Shift** locks the box square, toggleable
  mid-drag. Corners round with a **convex** quarter-circle arc, so even
  `radius: 1` clips the corner texel. Pure and Node-tested (`lib/rect.js`),
  shared by preview and commit.
- **Fill** — **contiguous** (on by default) keeps a click a **4-connected
  flood**; off, it becomes a **whole-face recolor** of every texel matching
  the clicked color, and **on all faces** (enabled only then) extends that
  across the atlas. Transparency is a first-class "color": clicking empty
  space targets transparent, a **right-click** fills _to_ transparent.
- **Selection** (`S`) is MacPaint's selection rectangle. **Drag a box** and it
  takes the **marching ants** — a 1-system-px black/white dashed border on the
  outermost texels, on its own topmost layer so no hover painter can wipe it,
  still under reduce-motion, and **1-bit by construction**: a clockwise pixel
  walk emitted as black and white **runs on whole system px**
  (`lib/ants.js`), never a dashed stroke, whose dashes would anti-alias to
  gray. **Drag inside** and the pixels **move**, leaving transparency behind
  (the sprite's "white" IS transparency); **Shift** constrains to the dominant
  axis. **Transparent texels inside the selection are not pixels and never
  travel**: a moved selection overwrites only where it is painted, so art
  under its empty texels shows through untouched — the lasso's most useful
  property, for free. Click outside, press **Esc**, or pick another tool and
  it **drops** where it sits. A click with no drag makes no selection and
  never flashes a one-texel box: a press is a click until the pointer crosses
  the OS's drag threshold or another texel, and from then on a marquee running
  anchor to corner inclusive, so **one texel** is the smallest selection. Push
  the float off the canvas and what's off-tile at the drop is gone (Undo has
  it). Each **move gesture is one undo step**; a marquee writes nothing. The
  selection **dies with the working buffer** — any structural change drops it,
  its pixels already in the document — and each **document window holds its
  own**. A move edits **this face alone** today, which can break the carve's
  registration; the **registered move** is the planned follow-up, beside
  `#applyMove` in `sm-draw-canvas.js`. Under the hood it is base + float
  (`lib/select.js`): the texels are lifted **once** on the first move press
  and every offset composites in place, so a drag across the sprite and back
  never smears what it crossed.
- **Undo** — a gesture (stroke, rect, fill, move) undoes as one step, an
  all-faces replace or tile resize as one whole-sheet step; bounded history,
  ~50 entries, cleared on a document load.
- **Eraser** (`E`) is a formal _tool_ mode, not a "transparent color" in the
  wells: a pencil that writes **transparency**, with its **own tip size and
  shape**, the two tools' settings deliberately independent. Its footprint is
  the **erase treatment**: the selection's **marching ants** around the texels
  the tip would clear, **no fill** inside (transparency can't be previewed)
  and no outline — **the ring is the tip's own outline**, so a circle eraser's
  ants ring the disc. Every erase wears it: the eraser's hover and stroke, a
  right-button pencil stroke, the rect's right-drag. **Picking any color while
  the eraser is held returns to the pencil**: a pick means "paint with this".
  A **right-click** is the momentary erase with any tool; the eraser cell is
  the sticky one.
- **Eyedropper** (`I`) is sticky too: every click samples the clicked texel —
  a painted texel's color becomes the **ink**, **empty space hands you the
  eraser** — with the ants ringing the texel it would sample. Hold **Alt** for
  a momentary sample that doesn't leave the current tool.
- **The current-ink swatch** sits in the strip for **every tool but the
  eraser** and **clicked** opens the **Colors dialog**: a System 7 movable
  modal over the 21×8 grid of **168 distinct named** swatches, a **hover
  readout line**, a **preview swatch** of the pending selection beside a **hex
  field**, Cancel / OK. No "recent colors" row and no used-color marking. The
  readout names the hovered color, and at rest the pending one — a typed color
  no swatch holds reading **"Custom"** — so the row always names what OK would
  commit. The field takes **manual hex** (3- or 6-digit, _any_ color); only
  **OK** or **Enter** commits, and while the text isn't valid hex **OK is
  disabled**. The palette is **value-banded hue rows** in `PALETTE_168`, every
  entry carrying the **human color name** the readout shows. **Wedge-safety
  caveat:** eight same-hue value pairs fall _within_ the wedge merge tolerance
  (`sameMat`, `TOL2 = 12²`), so a staircase of two such shades can auto-smooth
  into a wedge; **no gray pair merges**. No test pins it.
- **Face picker** — six **cube-view icons** over a radio row in the **Full
  Sprite View's** header switch which face the **active document's** window
  edits (each document keeps its own), as mirror pairs so you can flip between
  a pair for reference; a pick is an ordinary **click**. Each icon is a
  **21×26 1-bit** isometric cube, rendered and styled inside
  `sm-face-picker.js` alone: the three quads the view shows fill **solid
  black**, their hidden opposites draw a thin **sliver** along the silhouette
  edge they hide behind, and the **checked** face takes a **50% black
  dither**. Left/right is the **object's own** handedness (stage-left): `left`
  is the cube's lower-**right** quad, the way a car facing you shows its left
  flank on your right. A **mirror-derived** face opens with an **empty
  canvas** and a faded **onion-skin** of its opposite behind it; it becomes
  its own art only once you change a pixel, and erasing it fully reverts it.
- **Tile size** — **Edit → Tile Size…** puts up one **square-tile number
  field** over Cancel / OK, and **OK alone** (Return, by the dialog grammar)
  retiles the atlas, to any integer **1–64** (the ceiling keeps the live
  per-stroke carve tractable). Stepping or typing in the box moves nothing
  behind it — the Colors dialog's pending model, not the Export Sprite
  Atlas dialog's live one — and Cancel leaves the sheet as it was. Tiles are
  **locked square**, so every resize is **registration-preserving**, and the
  resize **keeps the art centered**, the odd texel of an odd step alternating
  ends so repeated resizes can't drift it off-center. Centering the vertical
  axis means a ground-rested sprite
  **floats up off the shadow plane** as the tile grows (an accepted trade).
  Square is the **only registering shape**: a 3×2 atlas shares its depth axis
  between the side tile's width and the top tile's height. The pure
  `resizeAtlas` (`lib/atlas.js`) still **defaults to origin-anchored** for the
  pipeline and still accepts an asymmetric pair (the `?tile=WxH` hook, which
  **warns** and shears) so the shear path stays testable.

There is **no auto ground-rest**: an object sits at whatever Y you paint it,
and to help you register a face against its neighbours the editor draws a
**faded onion-skin** of the opposite face behind the canvas.

**Dev hooks** let the headless tools reach what they can't click; the full set
is parsed in `src/boot/params.js`. Two carry rules of their own:
`?sample=<index|name>` opens a built-in as an untitled from in-memory data,
skipping the seeding and the `?file`/dialog boot alike (the deterministic path
`drive.mjs` drives), and **`?fresh=1`** boots with **storage ignored** — no
state restore, no `?file`, no saved-doc icons (the bare desktop with the Trash
alone in its corner), no seeding, no About greet, no state writes. The rest
place a window, a face, a resize or a tool's gesture on screen at mount, the
selection's ants standing at **phase 0** so a shot stays byte-identical and a
mount fill or float writing no undo entry.

---

## The desktop

The shell is a full System 7 virtual desktop: `index.html` is one
`<vf-desktop>` skeleton (menu bar, options strip, the utility windoids,
dialogs, the icon layer, plus a `<template>` the document windows clone from)
fitted to the viewport at boot, with the kit's page-drawn cursor on top. The
page sets **layout only** — every aesthetic is the kit's.

### One machine, two roles

On a real System 7 machine the desktop belonged to the **Finder**: clicking it
switched applications — the app's windows lost their stripes and its palettes
hid. Sprite Machine has exactly one application, so both roles share one menu
bar and one boolean decides everything: **is a document window the desktop's
active window?**

- **Clicking the desktop background or a desktop icon deactivates the
  application** — the PAGE owns the press test, the kit's furniture being
  slotted light DOM, so only the page knows which presses mean "the Finder".
  Every document window goes plain, the windoids **hide**, the options strip
  hides with them, the bare-letter tool keys go inert, and the menus drop to
  the **Finder grammar** — About / Desktop Patterns / Quit / New… / Open stay
  enabled,
  and Open reads the selection (see [Menu bar](#menu-bar)). The selection
  **survives the trip to the menu bar**, since a press on the application's
  chrome is no press on the desktop; the kit's `vf-icon` would clear on it, so
  `shell/icons.js` re-selects across that press — a page-side bridge until the
  kit exempts its own chrome (kit ask #5). Everything document-scoped greys
  out, and a disabled item's key equivalent never fires (the kit's contract),
  so ⌘S/⌘Z/⌘K gate with their menus.
- **Clicking any document window — or opening one — reactivates**: the
  windoids come back exactly where they were, aimed at the newly active
  document, and the activation **clears the Finder selection** (double-click,
  bare Open and ⌘O alike): the highlight names what the next Finder action
  acts on, and the application is forward now.
- **Panels are the Finder's windows.** `appActive` is "a **document** window
  is the desktop's active window", not "any window is", so a panel holding
  active mirrors as the desktop-focused state exactly like none: opening the
  Desktop Patterns panel or a folder window deactivates the application, and
  closing it hands active to the topmost document window.
- Closing the last document window leaves the same state: a bare desktop whose
  windoid arrangement survives for the next open. **Boot begins here too**:
  until the first document window opens nothing has activated, so an
  About-greeted load shows the Finder grammar with the windoids hidden. A
  windoid is on screen _because_ a document window is, never before.

### Documents are windows

**One document = one window.** File → New…, the Open flow and a dropped PNG
each open a **new** window (staggered System 7 style); nothing ever loads over
an open document — the unsaved-changes question lives entirely on the close
paths. Opening an already-open stored document just activates its window.
Untitled names count up. Each window carries its own editor, edited face and
bounded undo history; the tool and ink stay app-level (one palette, one ink).
The windoids and the Edit menu always serve the **active** document, so
switching windows re-targets the 3D View (the camera re-frames — a window
switch is a new subject), the Full Sprite View, the strip's clamp bounds and
the Undo/Redo enablement.

### Menu bar

- **Sprite Machine** — _About…_ (also the boot greeting), _Desktop
  Patterns_ (a window, not a dialog, so no ellipsis), _Empty Trash…_ (greyed
  while the Trash is empty, no key equivalent), _Quit_ (the System 7 cascade:
  every open document in turn, one unsaved-changes alert per dirty one with
  its window brought forward as it's asked about, Cancel anywhere aborting the
  rest). All four are live in both roles.
- **File** — _New…_ (an Empty Document at a chosen square tile size — the
  field is live for Empty only, a template's art having a native size — or a
  built-in template as a fresh untitled copy), _New Folder_ (a **Finder
  command**: it brings the Finder forward, as a desktop click would, and makes
  _untitled folder_ in the front folder window else on the desktop, its name
  selected for typing; no key equivalent, System 7's ⌘N being the browser's;
  greyed while the Finder's front window is the Trash's), _Open…_ ⌘O (**two
  grammars, one item, the label its readout**: _Open…_ raises the saved-docs
  listing, each filed row carrying its folder path and a trashed document no
  row at all; with an icon selected it relabels to a bare _Open_ and opens
  that icon at once, the ellipsis being System 7's promise of a dialog),
  _Close_ ⌃W (the active document, dirty-checked — or, in the Finder role,
  the front folder window; Control, not ⌘, since the browser owns ⌘W — see
  the key equivalents note below), _Save_ ⌘S (an untitled's first save
  prompts for a name), _Duplicate_ ⌘D, _Rename…_, _Download_ ⇧⌘E (the
  document `.png` verbatim — the downloaded atlas IS the source format, hence
  Download rather than Export, and no ellipsis: it acts immediately), and the
  two exports.
- **Export 3D Model…** writes the model as **one glTF 2.0 binary** from the
  app's own writer (`lib/gltf.js`; three's `GLTFExporter` encodes a texture
  through a canvas readback, which a privacy browser perturbs, so the skin
  goes in from bytes): one primitive of welded positions, per-face normals,
  UVs and index, the **skin** as an embedded PNG behind a **`NEAREST`**
  sampler — the hard texel is part of the file — under a metallic-roughness
  material or, on request, `KHR_materials_unlit`. The dialog takes a **Scale**
  in **voxels per meter** and a **Lighting** popup over live readouts. The
  origin is the **lattice floor's center**, the atlas export's anchor, so a
  model and its sprite sheet share one origin; Y up, the winding CCW, and
  every engine's first-party importer reads it as it lands — the reason the
  color is a texture at all.
- **Export Sprite Atlas…** puts the atlas windoid's four settings up as a form
  bound to the same slice its strip edits, so a change here moves the strip
  behind the modal at once and Cancel reverts nothing: **the strip IS the
  preview**. **Export** saves exactly the pixels the strip shows as **one
  zip**, two siblings by name: the **sheet PNG**, carrying a
  **`sprite-machine:ring`** chunk with the settings, the frame size, the yaw
  list and the engine **anchor**; and the **TexturePacker JSON**, the hash
  shape Phaser, PixiJS and the Godot / Unity importers load by filename pair —
  a frame per view in yaw order carrying the anchor as its normalized
  **`pivot`**. The zip is **stored** and written by the app's own sixty-line
  primitive (`lib/zip.js`), no dependency; a zip because a browser gives **one
  download per gesture** and the export is a pair. Both exports are enabled
  whenever a model exists, the windoid shown or not.
- **Edit** — _Undo_ ⌘Z / _Redo_ ⇧⌘Z (the ACTIVE document's history; disabled
  until it has something, which hands the key back to a focused field's native
  undo), _Pick Color…_ ⌘K, and _Tile Size…_ (the active
  document's square tile size behind a modal that commits on OK alone — the
  one property that is an edit; see [Drawing editor](#drawing-editor)).
  **Tools** lists the six sticky
  modes with the active one checkmarked — the same session truth the tool
  strip and the S/B/R/G/E/I keys write, so a pick from any of the three moves
  all three.
- **View** — _Arrange Windows_ ⌘J **leads the menu**: **one item, one label,
  two commands under a state rule**, and which one is a reading of the
  windows, never of what was pressed last. With anything on screen off its
  placement it is the **arrange**, the boot placement re-run on the
  **current** raster, every document window cascaded in stacking order. With
  everything already where the placement puts it, it is the **zoom**, the
  active window through the zoom box's own toggle — so repeats of ⌘J toggle
  the focused document between its slot and the vacancy while nothing else
  moves. The test is what's on screen: every visible window's live box against
  the box its placement would write (`arranged()`); hidden windows don't
  count, nor the atlas strip's width, nor which document sits on which slot.
  Only the item's **value** turns with the state; the **label never does** —
  the zoom is a variant of arranging, not a second command to announce.
  Greyed with no document window open, and, arranged, in the Finder role.

  Then, after a separator, _3D Sprite Atlas_ (a checkmark toggle, **off every
  load**; the windoid's close box is the same uncheck, MacPaint's palettes
  closing from their box and coming back from the menu; document-scoped, so it
  greys with the desktop focused). Then, after a second separator, the **open
  document windows**, one item each (System 7's Window-menu idiom): each reads
  its document's name, the **active** one is checked, the order is **creation
  order**, and a pick brings that window forward through the same activation
  funnel a title-bar click takes. Nothing of it is in the markup —
  `shell/menus.js` reconciles the section off the workspace, and with no
  document window open it is absent, separator included.

  And **no _Fullscreen_ item**, on purpose: the Fullscreen API reserves
  **Esc** for its own exit, beyond the page's reach, so the editor's Esc
  bindings die in it, and Chrome's top layer puts the fullscreened page over
  the kit's page-drawn cursor.

- **The clock** — System 7.5's menu bar clock at the bar's right end, ticking
  on the minute; **pressing it** shows the **date** for three seconds. It's
  chrome, not a menu: a press keeps the Finder selection, never deactivates
  the application, and takes no focus.

Key equivalents are the kit's own (Ctrl stands in for ⌘ off-Mac). ⌘N/⌘W stay
unassigned on purpose — the browser owns them before the page sees them.
Close answers **⌃W** instead, the Control key alone (the kit's ⌃ never
stands in for ⌘): it is the one W chord a Mac browser leaves to the page,
⌥W typing ∑. The trade is off-Mac, where Ctrl+W is the browser's own Close
Tab, reserved — the item shows the key there and never fires. A
disabled item claims nothing, so with no document open ⌘J falls through to
off-Mac browsers' own Downloads, exactly as a greyed Undo leaves ⌘Z to a
focused field's native undo. The bare-letter tool keys live in
`src/shortcuts.js`; the kit deliberately never matches an unmodified printable
key, which is what lets the Tools menu _display_ those letters without
double-firing them.

### Windows

Two tiers, two regimes — plus the **panel windows** on demand, document tier
but not documents: the Desktop Patterns control panel and the folder windows.

- **Document windows**: one per open document, cloned from a template by the
  reconciler in `shell/windows.js` — created on open (the doc box, cascaded
  into the first free slot, never a remembered position), removed on close
  (existence IS visibility). Each is `movable resizable zoomable`; its title
  is its document's name, its `status` strip names the face it's editing, and
  its `<sm-editor>` lives exactly as long as the document is open. The title
  bar's **zoom box** is a stateless toggle with the top-left held both ways —
  a zoom never moves a window, only its far edges: one click grows it right
  and down to the vacant middle's edges and records the size it grew from, and
  a click on a window already there returns exactly that size (a session
  truth). **⌘J's zoom half is this toggle**, and because a zoomed window's far
  edges are struts of the nine-slice pin, a browser resize keeps it zoomed.
- **Utility windoids**: the **Tools palette**, the **Full Sprite View** and
  the **3D View** — static markup, **permanently open**, no close box and no
  menu toggle, on screen whenever the application is active — plus the **3D
  Sprite Atlas**, the one toggleable windoid. They float above every document
  window, never take the active state (clicking the 3D View can't deactivate
  the window you're drawing in), and hide as a set when the application
  deactivates. A control in a windoid acts on the ordinary **click** unless
  mouse-down is the authentic feel (the Tools palette's cells, the Sprite
  View's face tiles); **no press-driven bridges anywhere** — raising a windoid
  re-inserts its node, and the kit does that in a task after the press's click
  has landed. Every windoid's controls strip is the window's **header**, a
  white band over a 1px rule outside the scroll area, its `header-height`
  authored in `index.html` at the same number `shell/layout.js` carries.
- **The Full Sprite View** carries the **face picker** in its header (a placed
  `vf-container` declaring `pattern="white"`, since a bare one would inherit
  the desktop's — kit ask #6's bridge) over the **atlas grid**, its body: a
  3×2 `vf-grid`, one live canvas per face drawn nearest-neighbor, frameless,
  every cell on the **`gray-12`** paper the draw canvas wears. The grid
  follows the ACTIVE document's **live channel**, tracking strokes at rAF
  rate, and it is a **picking surface**: pressing a tile selects that face,
  the radios and the edit canvas following, and the selected tile is
  **stroked in black ink** — the chrome is 1-bit end to end, the sprite art
  the only color in it. It is a **fixed-size picture frame**, movable but not
  resizable: its width the grid block's, its height derived through the active
  tile's ratio plus the chrome, so the grid exactly fills the body at boot and
  across document switches and tile resizes.
- **The 3D View** carries one checkbox in its header — **rotate**, the
  auto-spin, **off every load** — over the THREE canvas in a **kit pattern
  well**: the renderer clears **transparent**, no scene background, so the
  model and its shadow composite over the 1-bit pattern, one paper under every
  view of the art. Its status strip reads the model's **triangle count** (the
  Finder's "N items" idiom, live with every rebuild); the count alone, and no
  build error or warning ever takes the line.

**The 3D Sprite Atlas** ("ring" is the feature's code name in the source) is
the active document's model rendered **orthographically** from a ring of
evenly stepped yaws at one elevation, as a **row of tiles**: one cell per
view, each the tile at 1:1, butted, no rules between, on one sheet of kit
paper running across the whole body. Its header is a **DITL** of four labeled
number fields — `views` (1–16, a 360/n step), `elev` (0–90°), `from` (the
first yaw, 0–359°) and `size` (the tile's edge, 2–255) — placed against the
header's own corner in whole system px the kit writes as live `calc()`. That
arithmetic IS the header's height and the windoid's width floor: derivations,
not measurements.

- **Defaults**: four views at a 90° step, 45° up, from the front, 64 px tiles,
  white paper. **Yaw runs front → right → back → left** (yaw 0 puts the camera
  on `+z`). **The frame is the tile**, and what fills it is the lattice's
  envelope, not the content's: the footprint's bounding circle swept up the
  height — the same at every yaw — is fit to the tile's edge, so the whole
  voxel box fits at every angle and the frame never changes between angles,
  strokes or offsets (a sprite can't jitter in an animation). The model is
  centered on the lattice, whose floor's center lands on the **same row in
  every frame** — the engine anchor the export writes out. The **lights ride
  with the camera**: in an engine the camera and the sun are fixed and the
  object turns, so every angle is lit the same way; no ground, no shadow. No
  antialiasing anywhere in the copy chain, and the renderer clears
  transparent, so the margin is paper in the windoid and transparency in the
  file.
- **The paper** is the ring slice's `paper` setting (`white` / `black` /
  `gray`) — which **nothing in the UI writes**: the intent is that the app
  pick it from the sheet's own content one day rather than ask, and the export
  clears transparent whatever it says. It is the Sprite View's pattern grammar
  moved to the body: a `vf-container pattern` under the grid, filling the
  body's width so it spans the scroll plane past the last tile, the grid's
  `--vf-surface` cleared and each cell a bare `vf-stack` — the bridge for kit
  ask #11.
- **The settings are the document's**: every open document carries its own
  store of the four, a change **dirties the document** like a stroke, **Save
  writes them into the PNG** as a `sprite-machine:ring` chunk (the paper, a
  viewing choice, never), and every open path restores them, so a document
  reopens with the ring it was saved with and a chunkless PNG opens at the
  defaults. The strip, the Export dialog and the renderer read the **active**
  document's through one façade, so a switch brings the windoid to that
  document's tile height. It has its **own THREE world on an offscreen
  canvas**, made lazily and fed the rebuilder's mesh through one `onMesh`
  seam, rendering the strip into **one sheet canvas** the cells slice and
  Export encodes verbatim — and only while shown.
- It is **toggleable** (View → 3D Sprite Atlas shows it, its close box hides
  it, one flag both ways) and is the **classic scrolling document window
  turned windoid**, the rail on its bottom edge. Its **height is a
  derivation** re-fit as the tile size changes with the **top-left held**, and
  behind a **hidden** strip a change **re-runs the placement** instead of
  holding a box nobody can see. It is **declared to the grow box as the kit's
  size rect**, so it **resizes horizontally alone**; its **width is the
  user's**, seeded with the natural row and floored at the strip, and a row
  that outgrows it **scrolls under the rail** while the header holds still.
  The placement **docks it on the bottom margin, left-aligned with the
  document window** and — only while shown — takes its band out of the
  vacancy, so a fresh open, Arrange and the zoom box land clear of it;
  toggling it on never moves an existing window (System 7 didn't rearrange
  your windows when you showed a palette — Arrange does).

Positions and sizes come from a **smart placement** computed against the live
raster (`shell/layout.js`, pure): the Tools palette top-left; the Full Sprite
View over the 3D View as a right-hand rail, one column, both right-flush at
the same width; and the document window **top-left aligned beside the Tools
palette**, filling the vacant middle but for the **cascade room** at the right
and bottom — so each further document window opens at the **same size**,
**cascaded** down-right into the first slot no open window holds (five slots,
a closed or dragged-away window giving its slot back, a full cascade wrapping
onto the first).

That placement is the **only** source of an application window's geometry —
**nothing about a windoid or a document window persists across sessions**. A
browser is resized and reopened on another monitor all the time, so a prior
session's top/left is no truth worth re-asserting over a raster that may be
nothing like the one it was dragged on. Within a session, what you drag is
yours, until the page reloads or **View → Arrange Windows** re-runs the
placement on the raster as it is now. (The Finder's furniture is the
exception: the desktop icons, and the folder windows' boxes as pins.)

When the **browser window resizes**, the raster re-fits and **one rule moves
every window**, placed or dragged alike — the **nine-slice pin**
(`pinOf`/`pinTo`). The open space below the options strip is cut by a **ring
of outer bands** — 100 system px at the left and bottom, widened at the top
and right to hold the rail — around a **middle that grows and shrinks**. Each
window edge keeps its place in its slice: an edge in a band is a **strut**
(its offset from that raster edge holds), an edge in the middle a **spring**
(its fraction of the middle holds). So a window tucked against the right edge
stays tucked, one wholly inside a corner never moves, one spanning the middle
**breathes**, and one hanging off an edge keeps hanging by the same amount.
Because the bands hold the furniture, every **placed windoid is all struts**
and the placement is a **fixed point** of the rule: a resize lands the rail
exactly where Arrange Windows would. A document window is content, not
furniture: its top-left is a strut pair, its far edges spring with the
vacancy. A **fixed-size** window resolves its edges through an **anchor
rule** — a lone strut holds, opposite struts keep the near edge, two springs
keep the center — and a resizable one floors its size the same way. The
**unrounded pin is the per-window truth** between events, re-derived only when
something else has moved or resized the window, since re-reading it from the
just-snapped geometry ratchets windows down the screen across a long resize
drag. Deliberately **no position clamp** on this path — a window near an edge
may hang partly off a shrunk raster, and that's the point: the same pin maps
back exactly, so growing back returns it whole. Sizes get exactly **one
intervention**: a resizable window bigger than the open area shrinks to fit,
and the shrink never touches the pin.

### Desktop Patterns

**Sprite Machine → Desktop Patterns** opens System 7.5's control panel — the
composition of the original (the **preview well** across the top, the chooser
under it, **Set Desktop Pattern** along the bottom) with the classic scrollbar
replaced by a **grid of every pattern the kit ships**: the 38 standard
MacPaint fills in palette order as a 13×3 grid of 16px cells, a cell being two
repeats of its 8×8 pattern the way MacPaint's own pattern bar showed them.
Every fill is the kit's own — `vf-container pattern="…"` boxes at declared
sizes — so the rasters are exact and 1-bit at every density.

The semantics are the Colors dialog's: opening seeds the **pending** pattern
from the desktop's current one; **clicking** a cell selects it — the well
previews it and a ring marks the cell (1px black over the edge, 1px white
inside, so it reads on `black` and `white` alike) — while the desktop stays as
it was; only **Set Desktop Pattern** commits, through the shell slice's one
setter, and the close box discards a selection never set. The pattern is the
**one desktop setting that persists** (`?fresh=1` boots the dither), restored
before the desktop's first render, a corrupt value ignored through the kit's
own `parsePattern`. The window is a fixed-size `vf-window` (no grow box, no
zoom box; its body a `vf-stack pad="12"`, since a window body carries no inset
of its own and this is the one window whose content wants one) cloned per open
and **removed by its close box** — a second pick just brings it forward, one
panel ever — centered by `centeredBox` and **adopted as a panel**, so Arrange
re-centers it and a resize re-pins it like every window. It is the Finder's
window: see [One machine, two roles](#one-machine-two-roles).

### Folders

The Finder's filing system, on vintage-frames 0.7.0 (its `docs/FINDER.md` is
the recipe; the plan is [docs/folders-plan.md](docs/folders-plan.md)). A
**folder is catalog structure, not document content**: where a file _sits_ is
the catalog's business, and a downloaded PNG carries none of it, so a folder
is a record of its own in IndexedDB's second store (`folders`: id, name,
parent, timestamps — the desktop is the root and has no record) and a
document's membership is one field on its record, `folder` — never a chunk,
never localStorage. Folders **nest** freely; the one rule is that a folder
cannot be put into itself or a descendant. A document whose folder record is
gone reads as the desktop's, so nothing vanishes into an orphaned id. The icon
is the app's own 32×32 1-bit art, a `vf-icon` with no `color`, so the kit's
selection inversion, its **`target`** inversion (the destination under a drag)
and its derived **open ghost** are exact treatments of that one file.

- **The desktop's icons sit in a `vf-icon-field`**, **filled, not placed**: it
  stays static, so its icons keep anchoring to the desktop's raster and every
  saved position means what it meant; filled, it has a surface to press, which
  is what the **rubber band** needs — a drag on the bare desktop selects what
  the rectangle touches, Shift toggles, Escape cancels — and a press anywhere
  in it is a press on the Finder. The selection is one per screen, so
  `shell.iconSelection` names icons in any container.
- **A folder window** is the Finder's: a document-tier window — striped bar,
  close box, `movable resizable scrollbars="both"` — cloned per open and
  removed by its close box. Its header is the folder's **item count** (`N
items`, plain ink, off the model) over the Finder's **double rule** — black,
  white, black — made of two kit rules and no stylesheet. Its body is one
  **placed `vf-icon-field`** at the plane's origin, so the window's
  `placementAt()` and the field's coordinates agree, sized to the folder's
  **extent** — the viewport at least, grown to hold every icon — which IS the
  scroll range. It is **adopted by `shell/windows.js` as a panel**, placed
  fresh by `folderBox` (the doc box's corner stepped down-right per folder
  window already open), re-placed by Arrange Windows and re-pinned by a
  browser resize.
- **Its box persists** — the Finder remembered every folder window's rect, and
  so does this app, the one window it remembers — **in relative terms**: not
  the box but its **nine-slice pin**, read off the live window at every
  desktop-state snapshot and, at a close, remembered for the session, stored
  beside its icon under the same `folder:<id>` key. The next open re-expresses
  it on whatever raster the browser has by then and pulls it on-raster like
  every placement, so **a reopened folder window lands exactly where a browser
  resize would have carried it had it stayed open** — a box saved on a wide
  monitor never comes back hanging off a narrow one. A first open, or a stored
  record that is not a pin (`isPin`), takes the fresh placement. Arrange
  Windows still sends every folder window to its cascade slot: the arrangement
  is the reset, and what is on screen is what is remembered. Nothing else
  persists — not the scroll, and not that it was open. No zoom box yet.
- **The icon layer is a reconciler over containers**: the desktop's field for
  the items whose container is the desktop, plus one field per open folder
  window for that folder's children — folders first, then documents, in
  listing order. **Positions persist by item**, each in its **current
  container's** coordinates, and a saved position wins over the lattice; a new
  item, or one filed with no landing, takes the container's **first free
  cell**. The layer remembers a closed window's positions for the session, so
  a closed folder never forgets its arrangement. Only the desktop's icons
  re-pin on a browser resize; a window's travel with it.
- **Filing is the drag**, and the drag is the kit's: a movable icon drags as
  the classic **dotted outline** over everything — windows, palettes, the menu
  bar — the icon staying put, **every selected icon of its field travelling as
  one**, Escape cancelling; the kit reports the drag and a cancelable drop,
  and **the page decides what the drop means**. Three destinations, hit-tested
  with `elementsFromPoint`: onto a **folder icon** files the set into it at
  the next free cells; into a **folder window** it did not come from, or out
  onto the **desktop**, files it there, each member where its own outline was
  let go. Each cancels the kit's default and moves the **model** — a move is
  catalog, not content: the bytes, the name and the modified time all stand.
  Under a drag the folder icon under the pointer wears `target`, never for a
  folder over itself or a descendant, where the drop is refused. Nothing about
  the gesture is drawn, measured or clamped by the page.
- **Duplicate** lands the copy beside the original, in its folder; a first
  **Save** lands on the desktop, as does a dropped PNG's. `?file=` resolves by
  name across every folder but the Trash. **Not yet**: no small-icon view, no
  zoom box, no Clean Up, no Put Away, and the Finder's two alerts (a name too
  long, a folder into itself) are silent refusals.

### The Trash

The Finder's delete (the plan is [docs/trash-plan.md](docs/trash-plan.md)):
**the Trash is a folder** — the one folder with no record. The files slice
leads every listing with a synthetic row for it (the id `trash`; the store
holds the row before any listing and keeps it with none, so the Trash is on
the desktop whether or not there is a library), and from there every folder
path serves it unchanged: a document whose `folder` is the Trash's sits in it,
its window is a folder window, its desktop-state keys are the folder keys.
Four things it refuses, each a silent no-op: a rename, a move, a removal, and
a folder made inside it.

- **Deleting is the drag** — there is no Delete key and no Delete command, as
  System 7 had none: an icon dragged onto the can, or into its open window, is
  filed there through the folders' own drop, a folder going in with its
  subtree. A move is catalog, not content, and nothing is destroyed until the
  Trash is emptied, so a trashed item comes back by dragging it out. The Trash
  itself is never filed.
- **The icon** is the user's 32×32 1-bit art, two cans: the plain one while
  the Trash holds nothing, the bulging one with anything in it, swapped by the
  reconciler off the listing. `selectable movable`, not `editable`; its
  default place is the raster's **bottom-right corner**, the one icon whose
  default is not the lattice's next free cell — and a corner icon is two
  struts, so it stays in the corner across a resize.
- **Its window** is a folder window — _Trash_, _N items_, the lattice, its box
  persisting as its pin; a trashed folder's icon inside opens its own window
  with its contents intact. Both wear the Finder's **"in the Trash" mark**: a
  small 12×12 1-bit trash glyph at the head of the count line, the count
  stepping right to make room, present exactly while the folder is trashed.
- **Sprite Machine → Empty Trash…** — in the application's menu rather than
  System 7's Special menu for now (a Special menu earns its place the day
  Clean Up gives it a second item) — raises the Finder's alert in the unsaved
  box's anatomy, naming N items and the K they use, over Cancel and a default
  OK. OK removes every document and folder under the Trash from IndexedDB
  (`files.emptyTrash`, the one destructive operation in the app), and the
  listing's refresh does the rest: the icons go, the count reads 0 items, the
  can flattens, a trashed folder's open window closes. The seeding's record
  stands, so an emptied Car or Cube never comes back.
- **Open documents.** Trashing one is allowed — it is a move; the window
  stays, Save saves in place, and its icon wears the open ghost (System 7
  refused a file in use because the application held it open; here a window
  holds pixels, not a lock). Emptying with one inside **reverts its window to
  an unsaved document, dirty**: the pixels and the name stay, the stored
  identity goes, and the URL mirror clears with it.
- **The library looks past the Trash**: the Open dialog lists no trashed
  document and `?file=` resolves none (the Finder's Trash was invisible to
  Standard File) — the way to one is its icon in the Trash's window.
  `?fresh=1` shows the Trash and nothing else; it is furniture, so the goldens
  carry it in their corner. Not yet: Put Away ⌘Y (the record does not remember
  where a trashed item came from) and the "in use" alert.

### The About box

**Sprite Machine → About…** — and every load the URL gives no document to
open: the classic launch splash, System 7's About box on the plain dBoxProc
frame (no bar, no close box; OK, Escape, or a **click anywhere outside the
box** dismisses it onto whatever was there — at boot, the bare desktop in the
Finder role, nothing opened and nothing activated). The click-away is the
kit's own **`light-dismiss`**, an opt-in the markup states on this one dialog:
a splash dismisses on a click away, while System 7's modal boxes refused an
outside click, and every question dialog here still does — a stray click must
never answer "Save changes?". The kit consumes the click, so nothing beneath
reacts.

The application's **32×32 icon** sits beside three lines — **Sprite Machine**,
**version N** with the date beside it, and **created by Adam Portilla** — over
a two-paragraph blurb whose **Vintage Frames** is a real link to the kit's
[npm page](https://www.npmjs.com/package/vintage-frames), opened in a new tab
so the app and any unsaved document stay put. A default OK **holds the focus
as the box opens**, so Return OKs the splash: the kit's dialog grammar
(vintage-frames 0.6.2 — kit ask #12) is that a `vf-dialog` opens on a slotted
`autofocus`, else its first text field, else its default button, and **Return
anywhere in a box fires the default button**, a focused link following itself
instead. The same grammar runs every dialog here, so a value typed into
Tile Size… and Returned is committed and OK'd in one stroke. The version and
the date are **build facts, never markup** — `vite.config.js` defines them
from package.json's `version` and HEAD's commit date, so every build of one
commit says the same thing and a capture stays byte-identical — and
`shell/menus.js` writes them into the box's two empty spans at wire-up.
Bumping `version` is the whole release ritual.

### Documents: a document IS a .png

A document is exactly one sprite `.png` — the 3×2 atlas — with all metadata in
standard PNG text chunks (`lib/png-chunks.js`): `Title`, `Creation Time`,
`Software`, `sprite-machine:transforms` (written only when non-identity) and
`sprite-machine:ring`, the **3D Sprite Atlas's settings** (always written,
since a setting's default is the writing version's choice rather than an
identity). The pixels alone are already a complete document — tile size
derives from the dimensions — so **Save, Download and drop-import converge on
a single format**: Download writes the saved bytes verbatim, dropping any
downloaded PNG back restores it losslessly, and any foreign 3×2 sheet is a
legal, if anonymous, document at the default ring. A chunk-stripping optimizer
costs the name, the timestamps and the ring settings only.

Storage is IndexedDB (`storage/db.js`, version 2: a `docs` store — the PNG
bytes plus rebuildable listing caches, where the chunk wins on any
disagreement, plus the one field that is neither chunk nor cache, `folder` —
and a `folders` store), driven by the `files` slice: the pure LIBRARY layer,
listing, availability, the folder tree and its selectors, and the per-document
storage operations, each taking an explicit doc + identity. Which documents
are open, and their dirty state, is the workspace's. Explicit Save is the
contract, with a `beforeunload` guard over ANY dirty open document as the
safety net. Where IndexedDB is broken (private windows), Save raises an
explanatory dialog and everything else still works.

### Desktop icons & state

Every saved doc gets a `vf-icon` (`selectable movable editable` — Return
renames in place, converging on the same action as File → Rename…, so any open
window retitles along), and so does every folder and the **Trash**, the one
icon that is no saved item. The built-ins are **seeded at the first-ever
boot** through the same save path as ⌘S and are ordinary mutable documents
from then on; the seeding runs while the profile carries **no record of having
seeded** — the `seeded` flag, written only after the last built-in is stored,
so an interrupted boot seeds again next time, skipping what is already stored
by name. Double-click opens (into the existing window if one is open,
deselecting the icon as the application takes focus); selecting an icon
deactivates the application and aims File → Open at the selection; every open
doc's icon wears the kit's `open` ghost. Icon art is generated **from the
document itself**: the FRONT tile, **trimmed to its content's bounding box**,
drawn into 32×32 → data URI, regenerated on every save, declared `color` so
selection darkens instead of inverting.

Icon **placement is the windows' regime in the icons' own frame** — the whole
desktop below the **menu bar**, since icons are the Finder's furniture and the
options strip is application chrome: the default lattice derives from the live
raster (the classic left-edge column below the Tools band, folding into
further columns on a short raster), a saved position wins, pulled on-raster at
boot, and on a **browser resize** every icon keeps its **nine-slice pin** in
the same stroke as the windows, in `ICON_FRAME` — uniform 100px bands, since
no application furniture lives in the Finder's frame. An icon dragged into a
corner stays there, and the same no-clamp reversibility means a
shrink-then-grow round-trips every icon exactly home.

Icon layout, the **folder windows' pins**, the open SAVED documents' edited
faces (and which was active) and the **desktop pattern** persist in one
versioned localStorage key (`shell/desktop-state.js`, v3 — a v1 or v2 blob
migrates shallowly, the window geometry those versions persisted simply
dropped), beside the **`seeded` flag**, snapshotted on change/exit. **No
application window's geometry is in it**: the persistence layer sees the
Finder's windows alone, and those as pins, never boxes. Icons restore at boot;
the per-document entries are deliberately NOT reopened then — what a load
shows is the URL's call — they hand a saved doc its remembered edited face
whenever it IS opened. Untitled windows don't survive a reload either way (no
autosave). The documents themselves live in IndexedDB.

---

## The technique: multi-view visual-hull voxelization

Given orthographic pixel sprites of an object's faces, we reconstruct a voxel
solid and color its surface. Chosen over three alternatives (textured box,
sprite-stacking, mesh boolean-extrude) because it's the only one that yields a
genuine solid that self-occludes, casts a true blocky shadow, and stays crisp
at any angle — 1 pixel = 1 voxel = 1 cube.

1. **Ingest** — each sprite is read at native resolution into occupancy +
   packed-RGB typed arrays at **full tile size (no crop)**. A tile is a
   literal slice of the lattice, so texel (u,v) maps 1:1 to a fixed lattice
   line and must line up across faces.
2. **Reconcile dims** — one integer resolution per axis comes straight from
   the tile size: `front → W×H`, `side → D×H`, `top → W×D`. Views are placed
   at **identity position** — no re-centering, no bottom-anchor — so a pixel
   stays where it was painted. Well-formed sheets use **square tiles**, depth
   reading as a width in the side view but a height in the top view; a
   mismatched sheet takes the max per axis, places from the origin, and
   **warns**.
3. **Carve** — a voxel is solid iff it lands inside the silhouette of
   **every** provided view: for axis-aligned orthographic sprites, a boolean
   **AND of extruded masks**, no camera matrices and no CSG. Opposite views
   project to the same plane, so three orthogonal views fully constrain the
   shape and the extra three only add color.
4. **Surface extract** — keep only voxels with ≥1 exposed face; record a 6-bit
   exposure mask per voxel.
5. **Color** — the part most likely to look wrong. Each exposed face is
   colored by the view that **actually sees it first** along its axis
   (depth-aware first-hit), snapped to the sprite palette — which is what
   stops the naive "stamp one sprite pixel down the whole depth ray" smear.
   Faces no view can see fall through a principled chain: mirrored opposite →
   neighbor average → dominant body color.
6. **Mesh** — exposed faces (interior culled) are merged **on occupancy
   alone** into coplanar **regions** (`lib/regions.js`): a plane's exposed
   faces, and the gable caps of the wedge blocks ending on it, traced as one
   polygon on the lattice with every straight run one edge, holes included,
   and triangulated by earcut — so a flat wall is two triangles instead of
   one-per-texel and the wall beside a windshield has one straight diagonal
   edge.

   The color rides a **texture, the skin** (`lib/skin.js`), not the geometry.
   A region whose cells cross a color boundary carries a **chart**: its
   bounding box as texels, one per cell, with every texel the cells don't
   cover flooded from the nearest one, so a fragment on the region's edge
   never reads a neighbour and bilinear filtering gets no bleed. A region of
   one color — every one-color wall, and every wedge, one material by its
   gate — points at that color's **swatch**, a 1×1 chart in a strip. The skin
   is therefore only the crossing regions plus the strip, its size bounded by
   their boxes and never by the grid, packed deterministically onto a
   power-of-two sheet, sampled **nearest** with no mipmaps, and built straight
   from bytes as a `DataTexture` — never a canvas, so a privacy browser's
   farble can't touch it. UVs are an affine read of each triangle's lattice
   positions, taken _after_ the T-junction repair.

   The triangle count is the bonus; the reason for a texture is the **shape of
   the export**: the default materials in Unity, Godot and Unreal ignore
   vertex colors — each needs a custom shader, a toggle or a material-graph
   node — while a mesh with a `map` renders in every engine's default material
   as it lands. (A vertex-colored merge could only join faces of one color, so
   a painted wall shattered into a rect per color region: the Car went
   **1784 → 900** triangles when the merge stopped looking at color, and
   **900 → 244** when the wedges merged into slope blocks.) Emitted into one
   `BufferGeometry` as `MeshStandardMaterial({ map, flatShading })` — one draw
   call, real shadows, and `flatShading` separates top from sides for free.

### Render modes

One, always: the **low-poly** mesh — the visual-hull voxel solid,
greedy-meshed, with 45° wedges added over same-surface staircases — is what
the 3D View, the 3D Sprite Atlas and the export all render. There is no
plain-voxel builder any more.

### Low-poly (additive wedges)

The low-poly mesh keeps the voxel solid and **adds 45° wedges** into concave
unit-step notches — a staircase of same-surface voxels becomes a smooth ramp
(windshield, roof, wheel arch). It's **additive only**: wedges fill notches,
so they can never punch a hole or eat the object, and a shape with no
staircase gets none and stays sharp. Every vertex lands on the integer
lattice, so the result welds **watertight**.

**The planar merge**: the scan fires per notch cell, but the geometry is
emitted per **plane**. A **slope is one quad per block** — the wedge cells of
one 45° plane, one orientation and one intercept, greedy-merged on one color.
And the **gable caps fold into the walls**: a block's end caps are half-cells
of the plane they lie on, and every plane's exposed faces and caps are traced
together as one **region** polygon, so the wall beside a windshield has one
straight diagonal edge and nothing pins a vertex on the slope. Per cell the
Car read **900** triangles; per plane, **244** — the same 236 wedge cells in
20 blocks, watertight. The T-junction repair stays as the safety net and reads
45° edges too.

Whether a wedge fires is a **strict same-material test on the two faces it
would merge** — the corner's **riser** and **tread**. Same color on both ⇒ the
corner ramps; different ⇒ it stays a crisp step. Nothing else is consulted,
which hands the author exact, local control: to smooth a slope, paint both
faces it joins the same color (so the top-view art over a windshield must
match the glass down to its foot); to keep an edge sharp — a roof/window seam,
a tyre/body join — paint them differently and it can never round. The
strictness is the triangle count's too: opening the gate to match the
occupancy merge was measured on the Car and **loses**, 900 → 1092, more wedges
being more gable caps and more split base faces. See `lib/wedge-mesh.js`.

### Missing faces

Not every face has to be drawn. **Mirror-fill is always on for all three
axes:** a surface face with no view of its own takes its color from the
mirrored opposite view, so a half-drawn sheet still colors every face — the
built-in **Cube** ships only LEFT/FRONT/TOP, the **Car** draws every face but
RIGHT. Mirroring is a _coloring_ step; an axis with no view at all is simply
unconstrained for carving — the shape fills to the bounding box and warns.

### Coordinate conventions

World: `+x` right, `+y` up, `+z` toward the camera/front. In a **side (left)**
sprite the object's front is the left column; in a **top** sprite the front is
the top row. See `src/lib/views.js` for all six projection mappings.

---

## Architecture

The whole grid pipeline is **pure typed-array code — no THREE, no DOM**, the
app-state layer (`src/state/`) is pure JS, and the desktop's arithmetic
(`shell/layout.js`) is a pure module — all of it Node-tested (`npm test` over
`test/*.test.mjs`, about two hundred cases), densest where a bug would be
silent and expensive: the visual-hull carve and coloring, the wedge mesh's
watertightness and its gate, the region trace, the skin's bake and its UV
read, the rasterizers, the document format, the document and library
contracts, and the layout rules. The state slices get a few behavior tests
each, never the store's discipline per setter; the layout tests pin
relationships between exported values, never a number against a literal.

### Testing

The policy — what earns a test, what never does, and the decision to make for
every enhancement — is [docs/TESTING.md](docs/TESTING.md), and it is binding;
this is its summary. Four layers, each doing the one thing it is cheapest at:
**Node unit tests** for the pure code above; **`tools/drive.mjs`**, an
integration smoke of user journeys, where a check exists only when it crosses
a boundary a unit cannot — IndexedDB, trusted input, the real canvas, the menu
wiring, a reload — and names an outcome of the app's own; **golden
screenshots** (`tools/goldens.sh`) for the look; and **`docs/SMOKE-TEST.md`**
for what none of the above can reach — chorded and right-button drags, feel,
the cursor, browser zoom, a dropped file.

The rules. **Never assert the kit**: no check reads a `[part=…]` rect to
assert on it, counts `vf-*` elements, reads a `--vf-*` property, pins
`resizable` / `header-height` / a size rect, or asserts a drag's delta or DOM
order after a raise — locating a kit control through its part to drive it is
fine. **The drive re-derives nothing**: it imports nothing from `src/` but the
PNG chunk, zip and glb readers, and checks that the app applied its
arithmetic. **One home per fact**: no constant pinned against a literal, no
default parameter, no dev-only URL hook, no guard that a retired feature stays
absent, no literal UI copy. **The store's discipline is tested once**, in
`test/store.test.mjs`. **A precondition is not a check**: a helper that cannot
find its target throws. **No check per feature by default**: a change ships
with a test when it adds a risk the gates do not cover, and commit messages do
not report check or test counts.

```
src/lib/      the domain — pure, no THREE and no DOM but for the mesh: the pipeline
              (ingest → carve → colorize), the mesher (regions, wedge-mesh, t-junction,
              skin, mesh-util), the atlas's geometry (ring), the editor's rasterizers
              (rect, fill, select, brush, ants), the file formats (png-chunks, zip,
              png-encode, gltf), the vocabularies (views, faces, atlas, color, constants
              — PALETTE_168 among them) and the built-in sprites
src/state/    the app-state layer, pure JS and Node-tested: store + the Lit bridges; doc
              (two channels) and history, FACTORIES one per open document; workspace (the
              open documents as DocContexts, activeKey, the stored flows); files (the
              library, the folder tree, the Trash); session, prefs, build, shell; and the
              atlas's per-document settings behind an active-document façade (ring)
src/storage/  the IndexedDB wrapper (v2: `docs`, whose `folder` is its one non-chunk
              field, and `folders`), injected into the files slice
src/scene/    stage (renderer, camera, lights, framing, on-demand loop); rebuilder, the
              pipeline's ONLY consumer, handing every mesh out through the onMesh seam;
              the atlas's offscreen world and its follower; the glb export's subject
src/shell/    the desktop's behavior over the index.html skeleton: layout (ALL the window
              and icon arithmetic, pure and Node-tested — the placement, the cascade, the
              derived sizes and DITLs, pinOf / pinTo / isPin), windows (the two regimes,
              the resize rule, arrange / arranged / zoomActive, the panel adoption), menus
              (actions, the two-role gating, every dialog flow), icons (the reconciler,
              the Finder wire, filing), folders, desktop-state, url-state, clock, patterns
src/          main (the composition root), boot/params, loaders (+ seedDefaultDocs),
              drop-target, shortcuts, image-io, and components/ — all Lit and shadow DOM
              but for sm-color-picker: sm-editor over sm-draw-canvas and draw-overlays,
              the dumb leaves, and the connected chrome
src/assets/   the app's own raster art, every piece through vf-img at 1:1: the six 22×19
              tool icons, the 21×26 face cubes and the selected dither, the 32×32
              application icon, the folder, the Trash's two cans and its 12×12 mark
```

### UI layer: Lit + a hand-rolled store

The chrome is `lit`, the library `vintage-frames` itself is built on (one
deduped copy), in **three layers with dependency arrows only pointing down**:
presentation (`components/` + `scene/` + `shell/`) → app state (`state/`) →
domain (`lib/`, with `storage/` a leaf the files slice takes by injection, so
it stays Node-testable). The state mechanism is a ~40-line observable store.
**Connected** components read slices and call named actions, and the `shell/`
modules wire the desktop's skeleton to the same slices; the editor **leaves**
are dumb — props down, bubbling `sm-*` events up, no store imports — so store
coupling stays visible and greppable. Every component is a **standard
shadow-DOM Lit element** over a shared `baseStyles`. The one deliberate
exception is `<sm-color-picker>`, which renders into its **light DOM**: the
kit's page-drawn cursor keeps itself above a modal by watching a
`vf-dialog`'s `open` flip through a MutationObserver on the light DOM alone,
so a shadow-rooted dialog would open above the cursor art. The same discipline
applies inside shadow roots that state a cursor of their own:
`applyCursor()`'s `* { cursor: none }` blanket can't pierce a shadow root, so
those declarations read `var(--vf-cursor, …)` first. `style.css` keeps only
the page's share — the palette tokens, the reset, the ground behind the bezel,
the light-DOM dialog host, the 3D viewport's fill rules and the drop overlay.

**The two-speed state system** is the correctness core. Store state is what
templates read; everything the canvas hot paths touch is a plain `#private`
field in `<sm-draw-canvas>`, so a pencil drag can never schedule a re-render
at pointer-move rate. Each document's doc formalizes the split with **two
channels**: `subscribe` (structural — load, resize, replace-all, undo restore,
driving templates, dirty tracking and menu sync) and `onLive` (stroke-rate,
rAF-coalesced, whose only subscribers are the mesh rebuilder and the Full
Sprite View). A live stroke lands via `applyTileEdit`, which stores the
working buffer **by reference** _silently_ on the change channel — the
onion-skin recomputes only on a face switch or structural change, never
mid-stroke — and every canonical-atlas consumer (save, export, resize,
replace-all, an undo snapshot) folds the pending stroke in first through the
one `drain()` guard. Canvas backing stores are sized imperatively in
`updated()`, never bound in a template; user-editable `vf-*` values are
controlled bindings with `live()`, so a re-render can't skip a re-sync after
typing.

**One element per document, for the document's lifetime:** each window's
`<sm-editor>` is created with it — the reconciler assigns its DocContext
before the append, via `document.importNode`, so the assignment lands before
`connectedCallback` wires the doc subscription — and lives until the document
closes. The desktop's raise-driven DOM re-orders disconnect/reconnect it
without loss, and the brush state lives in the app-level session slice. A face
swap, tile resize, replace or undo is just a store action; the canvas resets
its working buffer only when the tile's IDENTITY changes.

## Known limitations & next steps

- **Concavity** — a visual hull is a convex-ish over-approximation along each
  axis (the gap between wheels fills into a skirt). An opt-in per-column
  **depth channel** would subtract single-axis notches; the color rule already
  handles depth.
- **Low-poly scope** — wedges are **additive only**: a convex staircase still
  steps, and where two ridges meet at a true 3-D corner it degrades to a step.
  The T-junctions the merge leaves are stitched out by a lattice-exact repair
  pass, so the result stays watertight (a regression test asserts zero
  boundary edges).
- **Perf** — culling + the planar merge keep it to one draw call and a handful
  of triangles, the color one small texture rebaked per rebuild and disposed
  with the mesh, and the render loop only redraws on change. The carve is a
  synchronous O(n³) walk, so the tile stepper is capped at **64**; to lift
  that, move `buildVoxels` to a Web Worker — it is pure typed-array code, and
  `scene/rebuilder.js` is its only caller.
- **Autosave** — a deliberate non-goal: explicit Save is the contract, with
  the `beforeunload` guard as the net; untitled windows don't survive a reload
  for the same reason.
- **The registered move** — the selection tool's next step, and the one that
  makes it a 3D tool: a move "on all faces" that keeps the atlas in
  registration, since a marquee on one face is a slab of voxels — a FRONT
  rect's columns on TOP/BOTTOM, its rows on LEFT/RIGHT, its mirror on BACK.
  Controlled by a session checkbox, the fill tool's "on all faces" idiom.
- **Export follow-ups** — the skin beside the model as a PNG for an engine
  that wants it separately, and a word for Unity users: its texture importer
  generates mipmaps regardless of the sampler, and a mipmapped chart bleeds
  its neighbours at distance, so mipmaps go off on the texture the way any
  pixel-art texture is imported there. For the sprite atlas: a drop shadow
  (consistent across the ring under the camera-relative key), elevation
  presets for isometric engines, and per-frame padding. File → Download stays
  the source path, the document `.png` verbatim.
