# sprite machine

Turn low-resolution pixel-art **face sprites** (top / front / side / …) into a
real, rotatable **Three.js 3D object** — the chunky look is baked into the
geometry, not faked by a shader.

![voxel car from a 3×2 pixel atlas](docs/car.png)

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # both packages' unit suites (node --test)
npm run typecheck  # tsc checkJs over src/ (JSDoc types)
npm run lint       # prettier --check .   (npm run format to fix)
npm run build      # static bundle in dist/
```

The **engine** — the pipeline, the mesher and the file formats — is its own
npm package, **`sprite-machine`** (`packages/core`, this repository's second
workspace; its [README](packages/core/README.md) is the API), with `three` a
peer dependency and one headless entry: `buildModel` hands back the
THREE.Mesh at one unit per voxel, `modelToGlb` writes the glb File → Export
3D Model… writes, `sprite-machine/node` adds `readSheet` / `sheetToGlb` over
a document PNG's bytes, and `npx sprite-machine build` does it from a shell.
The app imports the engine by name through the workspace link, so a change
to the engine and to its consumer land in one commit, and
`npm publish -w packages/core` releases the engine alone. The app itself
deploys to **GitHub Pages** on every push to `main`
(`.github/workflows/pages.yml`): <https://aportilla.github.io/sprite-machine/>.

The gates are Node-only — `npm test`, `npm run lint`, `npm run typecheck`,
`npm run build` — and the Pages workflow runs all four before it deploys, so
a broken push never ships. There are **no browser tests**: the look and the
wiring are checked by eye. One headless-Chrome helper shoots a running dev
server when a picture helps, never as a pass/fail check:

```bash
tools/capture.sh shot 'http://localhost:5173/?sample=car' /tmp/shot.png
tools/capture.sh dom  'http://localhost:5173/?diag=1'   # light-DOM shell + title
```

What gets a test is [Testing](#testing).

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
them in and the **Trash** to delete them by — beside the **read-me text
files** the app ships, opened into TeachText's window (see
[Text files](#text-files)). Clicking the desktop is
"switching to the Finder": the Sprite Editor deactivates, its windoids hide,
and the menu bar becomes the Finder's — one bar, the front application's,
as System 7's was. See [The desktop](#the-desktop).

The first-ever boot **seeds two starter documents** (Car, Cube) as ordinary
saved files. They are created once and never come back: the profile records
the seeding (a `seeded` flag written only once every built-in is stored), and
that record, not the mere presence of state, suppresses it — so a first boot
cut short by a reload finishes seeding on the next one, nothing doubled, while
deleting or emptying later never resurrects them. The **built-in text files**
(`src/texts/` — the Read Me and Keyboard Shortcuts) seed the same way on a
record of their own, `seededTexts`, since they arrived after every profile's
first record was written. Both records stay **one-shot**, so a built-in added
to the app after a profile's first boot does not arrive on its next one: the
Finder's **Special → Restore Default Files** stores whatever the library is
missing, and is the only route by which an existing profile — or one whose
owner deleted a built-in — gets it (see [Menu bar](#menu-bar)).

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
  is the largest whole count of system px that fits **the tile plus a texel of
  edge hint on each side**, so a texel is a whole count of device px at any
  density or zoom. The layers ride a **placed
  `vf-container`** whose box `#layout()` states in whole system px, and the
  hints' frame is a second one a texel bigger all round; the **outer** box is
  what centers, by arithmetic — no flex centering, no measured correction — so
  both land on the pixel lattice by construction. The canvas is **1-bit but
  for the art**:
  its paper is the kit's **12% dither** (`gray-12`), declared as the
  container's `pattern` and never inherited, since a bare `vf-container`
  paints the desktop's own pattern, smeared (kit ask #6). The dither is the
  transparency indicator, so **white art** reads as a clear patch in the dots.
  Nothing is drawn over the art — no grid lines — and the sprite is the only
  color on the canvas.
- **Edge hints** — the four neighbouring faces' art, a texel deep, just
  outside the canvas's edges: editing FRONT, the **front-most painted pixel of
  the side view** runs down the left and right edges and the TOP tile's nose
  row lies across the top, so a roof line, a bumper or a wheel arch can be
  lined up across faces by eye. Which face meets which edge, which of its lines
  the strip reads and whether that line runs backwards are **derived, not
  authored** — probed from the projection convention itself (`lib/edges.js`
  off `VIEW_IMAGE_AXES`), and symmetric across the cube's twelve edges. Each
  strip is a **first hit**: from the seam it walks **inward** to the first
  painted texel, since sprites carry margins inside their tiles and the
  outermost line is nearly always empty — the pipeline's own depth-aware
  first-hit idiom. Registration is about the axis two faces **share**, so how
  deep the evidence sits doesn't bear on it. A neighbour with no art of its own
  contributes its **mirrored opposite**, what the model actually renders; the
  four **corners stay empty**, a corner being a lattice edge no single face
  owns. The strips sit on the **canvas's own texel lattice** — no gap, no
  separator, since a hairline would put them half a texel out of register — on
  the artwork well's **white**, so the dithered rectangle is still exactly the
  drawable area. They are **full opacity**, unlike the onion-skin's fade: a
  strip is outside the canvas and can't be mistaken for the art. Nothing
  samples or paints there, and a stroke can never move one — a face's four
  neighbours are the four faces other than it and its opposite, a set closed
  under opposites, so the frame is change-channel state and costs the stroke
  nothing.
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
  `resizeAtlas` (the engine's `atlas.js`) still **defaults to origin-anchored** for the
  pipeline and still accepts an asymmetric pair, which **warns** and shears.

There is **no auto ground-rest**: an object sits at whatever Y you paint it.
Registration gets two aids, and they answer different questions: the **faded
onion-skin** of the opposite face **behind** the canvas — where is the art on
the other side of the object? — and the **edge hints** just **outside** it —
what does the art wrap into when it leaves this edge?

**Dev hooks**, parsed in `src/boot/params.js`: `?sample=<index|name>` opens a
built-in as an untitled from in-memory data, skipping the seeding and the
`?file`/dialog boot alike, with `?edit=<face>` choosing its face;
**`?fresh=1`** boots with **storage ignored** — no state restore, no `?file`,
no saved-doc icons (the bare desktop with the Trash alone in its corner), no
seeding, no About greet, no state writes; and `?flat=1`, `?diag=1` and
`?cam=<preset>` are the mesh and camera debug flags.

---

## The desktop

The shell is a full System 7 virtual desktop: `index.html` is one
`<vf-desktop>` skeleton (the menu bar, the options strip, the desktop's icon
field and the dialogs) fitted to the viewport at boot, with the kit's
page-drawn cursor on top; every window is its application's, authored in the
application's own directory and appended at its init or its open (see
[Windows](#windows)). The page sets **layout only** — every aesthetic is the
kit's.

### Three applications, one menu bar

On a real System 7 machine the menu bar belonged to the **front
application**: the Apple menu sat at the left in every one, the application's
own menus followed, and switching applications — clicking one of its windows,
or the desktop, which was the Finder's — replaced those menus wholesale, the
Finder's File / Edit / View / Special giving way to MacPaint's or TeachText's.
Sprite Machine is four applications, and the bar is the front one's (the
plan is [docs/apps-plan.md](docs/apps-plan.md)):

- **The Finder** — the desktop and its icons, the folder windows; the drag,
  the rubber band, Copy / Paste, New Folder, Empty Trash…. The desktop's
  application and the default: it is front whenever nothing is active.
- **The Sprite Editor** — the document windows, the four windoids, the
  options strip, the tool keys and every command over a document.
- **The Text Viewer** — the read-me windows, TeachText's seat (see
  [Text files](#text-files)).
- **Desktop Patterns** — the control panel, an application of its own, a
  desk accessory's seat (see [Desktop Patterns](#desktop-patterns)).

**The front application is a reading of the desktop's active window**, made
in the one place the activation lands (the window manager's wire,
`shell/windows.js`, into `shell.frontApp`): an active window means the
application its owner declared when it adopted the window (`windows.adopt`'s
`app` — a **document window** says the Sprite Editor, a folder window the
Finder, a text window the Text Viewer, the control panel Desktop Patterns);
**no active window** means the Finder. `appActive` — "is the Sprite Editor
front" — is written in the same patch, so the windoids, the options strip
and the tool keys read exactly what they always read.

- **Clicking the desktop background or a desktop icon brings the Finder
  forward** — the PAGE owns the press test, the kit's furniture being slotted
  light DOM, so only the page knows which presses mean "the Finder". Every
  document window goes plain, the windoids **hide**, the options strip hides
  with them, the bare-letter tool keys go inert, and the bar **swaps** to the
  Finder's menus (see [Menu bar](#menu-bar)). The icon selection **survives
  the trip to the menu bar**, since a press on the bar is no press on the
  desktop; the kit's `vf-icon` would clear on it, so the Finder's icon
  layer (`apps/finder/icons.js`) re-selects across that press — a
  page-side bridge until the kit exempts its own chrome (kit ask #5).
- **Clicking any document window — or opening one — brings the Sprite Editor
  forward**: the windoids come back exactly where they were, aimed at the
  newly active document, the bar swaps to the editor's menus, and the
  activation **clears the Finder selection** (an icon's double-click and
  File → New… alike): the highlight names what the next Finder action acts
  on, and the editor is forward now.
- **Panels are other applications' windows.** A folder window holding
  active is the Finder's turn, a text window the Text Viewer's, the control
  panel Desktop Patterns'. Opening one deactivates the Sprite Editor
  exactly as the desktop click does, and closing it hands active to the
  topmost document window, which brings the editor back.
- Closing the last document window leaves the Finder front over a bare
  desktop whose windoid arrangement survives for the next open. **Boot
  begins here too**: until the first document window opens nothing has
  activated, so an About-greeted load shows the Finder's bar with the
  windoids hidden. A windoid is on screen _because_ a document window is,
  never before.

**Each application is one directory under `src/apps/`** — `finder`,
`sprite-editor`, `text-viewer`, `desktop-patterns` — holding its menus as
markup (`menus.html`, a fragment of `vf-menu` elements, imported whole), its
windows (see [Windows](#windows)) and one module on one shape:
an id, a name, the fragment, and `init({ menus, deps })`, which binds
behavior to the parsed nodes and returns the application's public verbs and
its teardown. `src/apps/index.js` lists the four in the bar's order; a
fifth application is a fifth directory and one entry. The bar's owner,
`shell/menu-bar.js`, parses each fragment once into live nodes, slots the
front application's between the Sprite Machine menu and the clock, and on
every change of the front application **lifts the outgoing menus out and
inserts the incoming ones** — nodes moved, never rebuilt, so an item's state
survives the trip. The kit takes menus coming and going, and **a detached
menu claims no key**: an item's key equivalent is a document listener added
on connect and removed on disconnect, so the Sprite Editor's ⌘S is inert in
the Finder with no `disabled` written anywhere — the Finder's own ⌘S doing
nothing, as on a Mac — and ⌘C over a read-me's prose copies the prose,
never a lit icon, since the Finder's Copy is off the bar then. A menu is
addressed by its `data-menu` and an item by its `value`, within the
application's own nodes: every application holds a `close` and an
`arrange`, and only the front one's is ever connected, so no key is ever
contested. Cross-application calls go through the registry's actions at pick
time: the Finder's New… raises the Sprite Editor's New box, an icon's
double-click opens through the editor's `openDoc` (a text file's through the
Text Viewer's `open`), and the Sprite Machine menu opens the control panel
through Desktop Patterns' `open`. The dialogs stay in `index.html`, the
desktop's top layer; only their handlers moved.

### Documents are windows

**One document = one window.** File → New…, a document icon's double-click
and a dropped PNG each open a **new** window (staggered System 7 style);
nothing ever loads over an open document — the unsaved-changes question lives
entirely on the close paths. Opening an already-open stored document just activates its window.
Untitled names count up. Each window carries its own editor, edited face and
bounded undo history; the tool and ink stay app-level (one palette, one ink).
The windoids and the Edit menu always serve the **active** document, so
switching windows re-targets the 3D View (the camera re-frames — a window
switch is a new subject), the Full Sprite View, the strip's clamp bounds and
the Undo/Redo enablement.

### Menu bar

The leftmost menu, **Sprite Machine**, is the Apple menu's seat and role:
one menu, in every application, holding what is the machine's rather than
an application's — _About…_ (also the boot greeting) and _Desktop Patterns_
(a window, not a dialog, so no ellipsis — the Apple menu's Control Panels;
the panel is an application of its own, so opening it brings Desktop
Patterns forward). Its title is the text for now; the kit's `label` slot
takes a 16×16 glyph the day one is drawn, the Apple menu's picture, with the
text kept as the accessible name. To its right sit **the front application's
menus and no other's**, and the **clock** keeps the bar's right end through
every swap:

```
Finder            │ Sprite Machine  File  Edit  View  Special              10:42 │
Sprite Editor     │ Sprite Machine  File  Edit  Tools  View                10:42 │
Text Viewer       │ Sprite Machine  File  Edit  View                       10:42 │
Desktop Patterns  │ Sprite Machine  File  View                             10:42 │
```

**The Finder's menus** — the bare desktop or a folder window front:

- **File** — _New…_ ⌃N (the one New — always a **document**, through the
  Sprite Editor's New box: the Finder's way to make one, as a double-click
  is its way to open one; System 7's Finder made no documents, but this
  machine's is the one document application), _New Folder_ (makes _untitled
  folder_ in the front folder window else on the desktop, its name selected
  for typing; no key equivalent; greyed while the front window is the
  Trash's or a trashed folder's), then, after a rule, _Close_ ⌃W (the front
  folder window; greyed with the bare desktop front). No Quit: the Finder
  had none.
- **Edit** — _Copy_ ⌘C, _Paste_ ⌘V, _Select All_ ⌘A, the commands over the
  icons (see [Copy and Paste](#folders)), each with its own reading — Copy
  a selected icon that is not the Trash, Paste a front container that
  accepts one — and all three greyed while any text field has focus, so an
  icon's rename box or a dialog's field keeps its native ⌘C / ⌘V / ⌘A. No
  Undo, Cut or Clear, greyed or otherwise: the Finder had no Cut of files,
  and the Trash is the Finder's undo.
- **View** — _Arrange Windows_ ⌘J, the arrange alone (the Sprite Editor's
  item below carries the rule), greyed while the screen already is the
  arrangement. No window tail: System 7's Finder listed no windows, and the
  way back to an open document is its window's click, or its icon.
- **Special** — _Empty Trash…_ (see [The Trash](#the-trash)), greyed while
  the Trash is empty; then, after a rule, _Restore Default Files_, which
  stores the built-in documents and read-me text files the library is
  **missing** — the route by which a profile that has already booted gets a
  built-in the app gained since, or one it deleted, the seeding itself being
  a one-shot (see [Desktop icons & state](#desktop-icons--state)). Additive
  and **by name**: a built-in already in the library is left exactly as it
  stands, renamed, filed, painted over or trashed, so picking it twice
  doubles nothing and overwrites nothing. No ellipsis — there is no question
  to ask — and it is greyed while nothing is missing, the Trash counting as
  the library (a trashed Read Me is still a Read Me; the way back to it is
  to drag it out). Neither item has a key equivalent, as System 7's Special
  menu gave none. Clean Up joins them one day.

**The Sprite Editor's menus** — a document window front. Every item is
document-scoped by construction, so none needs a role gate:

- **File** — _New…_ ⌃N (classic Photoshop's New box: a **Name** across the
  top, seeded with the next untitled name and following the template popup
  until typed in, over the **Settings** group — the template, Empty Document or
  a built-in, and the square tile size, live for Empty only since a
  template's art has a native size — with OK over Cancel at the right, OK
  greyed while the name is blank; the document opens unsaved under that
  name, so its first Save prompts with it — and there is **one New**: it
  always makes a **document**, from either application, never a folder.
  Its key is Control's, ⌃N, on Close's reasoning: the browser owns ⌘N. And
  where System 7 could spend its ⌘N on the Finder's New Folder, this
  machine spends its New on the document), then, after a rule, _Close_ ⌃W
  (the active document, dirty-checked; Control, not ⌘, since the browser
  owns ⌘W — see the key equivalents note below), _Save_ ⌘S (an untitled's
  first save prompts for a name), _Duplicate_ ⌘D, _Rename…_, _Download_
  ⇧⌘E (the document `.png` verbatim — the downloaded atlas IS the source
  format, hence Download rather than Export, and no ellipsis: it acts
  immediately), the two exports, and _Quit_ ⌃Q (the System 7 cascade: every
  open document in turn, one unsaved-changes alert per dirty one with its
  window brought forward as it's asked about, Cancel anywhere aborting the
  rest; always live here, the editor being front only with a document open
  — the route from the Finder is a click on any document window first, as
  it was on a Mac).
- **Export 3D Model…** writes the model as **one glTF 2.0 binary** from the
  engine's own writer (`gltf.js`, through its `modelToGlb` — the headless
  path and the menu are one function; three's `GLTFExporter` encodes a texture
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
  undo), then, after a rule, _Copy_ ⌘C / _Paste_ ⌘V / _Select All_ ⌘A —
  **greyed placeholders**, waiting for the selection tool's pixel clipboard
  (the Finder's Edit menu holds the live three over the icons; the same
  labels read the front application's command, one bar, System 7's own
  model), and greyed they claim no key, so a dialog's field keeps its native
  ⌘C / ⌘V / ⌘A. Then, after a rule, _Pick Color…_ ⌘K and _Tile Size…_ (the
  active document's square tile size behind a modal that commits on OK
  alone — the one property that is an edit; see
  [Drawing editor](#drawing-editor)). No Cut and no Clear yet.
- **Tools** lists the six sticky modes with the active one checkmarked — the
  same session truth the tool strip and the S/B/R/G/E/I keys write, so a
  pick from any of the three moves all three.
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
  the zoom is a variant of arranging, not a second command to announce. The
  Finder's and the Text Viewer's ⌘J items carry the arrange alone, greyed
  while the screen is arranged, so ⌘J means the same thing wherever you are.

  Then, after a separator, _3D Sprite Atlas_ (a checkmark toggle, **off every
  load**; the windoid's close box is the same uncheck, MacPaint's palettes
  closing from their box and coming back from the menu). Then, after a second
  separator, the **open document windows**, one item each (System 7's
  Window-menu idiom): each reads its document's name, the **active** one is
  checked, the order is **creation order**, and a pick brings that window
  forward through the same activation funnel a title-bar click takes.
  Nothing of it is in the markup — `apps/sprite-editor` reconciles the
  section off the workspace, and with no document window open it is absent,
  separator included. The tail is the Sprite Editor's alone: System 7's
  Finder and TeachText listed no windows.

  And **no _Fullscreen_ item**, on purpose: the Fullscreen API reserves
  **Esc** for its own exit, beyond the page's reach, so the editor's Esc
  bindings die in it, and Chrome's top layer puts the fullscreened page over
  the kit's page-drawn cursor.

**The Text Viewer's menus** — a text window front, what TeachText's bar
showed over a read-only document:

- **File** — _Close_ ⌃W (the front read-me) and _Quit_ ⌃Q (every text window
  in turn, TeachText's Quit; nothing asks, a read-me being read-only).
- **Edit** — _Copy_ ⌘C (the prose the mouse selected, to the system
  clipboard; greyed while the selection is empty or lies outside a text
  window) and _Select All_ ⌘A (the whole text), the two commands TeachText
  left live on a read-only file.
- **View** — _Arrange Windows_ ⌘J, the arrange alone, greyed while the screen
  is arranged.

**Desktop Patterns' menus** — the control panel front, a desk accessory's
bar:

- **File** — _Close_ ⌃W and _Quit_ ⌃Q, one panel ever, so both close it (a
  selection never set is discarded, the close box's path).
- **View** — _Arrange Windows_ ⌘J, the arrange alone, greyed while the screen
  is arranged. No Edit: the panel holds no text field, and its choosing is
  the mouse's.

**The clock** — System 7.5's menu bar clock at the bar's right end, ticking
on the minute; **pressing it** shows the **date** for three seconds. It's
chrome, not a menu: a press keeps the Finder selection, never deactivates
the application, and takes no focus.

Key equivalents are the kit's own (Ctrl stands in for ⌘ off-Mac). ⌘N/⌘W/⌘Q
stay unassigned on purpose — the browser owns them before the page sees
them. New, Close and Quit answer **⌃N**, **⌃W** and **⌃Q** instead, the
Control key alone (the kit's ⌃ never stands in for ⌘): ⌃W is the one W
chord a Mac browser leaves to the page, ⌥W typing ∑, and ⌃N is N's. The
trade is off-Mac, where Ctrl+W
and Ctrl+N are the browser's own Close Tab and New Window, reserved — the
items show the keys there and never fire. A key equivalent is the **front
application's**: a menu off the bar claims nothing, so ⌘S in the Finder
does nothing, as it did on a Mac, and the bar flashes the menu a fired
command lives in. A disabled item claims nothing either, so with the
screen arranged the Finder's ⌘J falls through to off-Mac browsers' own
Downloads, exactly as a greyed Undo leaves ⌘Z to a focused field's native
undo. The bare-letter tool keys live in `src/shortcuts.js`; the kit
deliberately never matches an unmodified printable key, which is what lets
the Tools menu _display_ those letters without double-firing them.

### Windows

**Every application owns its windows; the shell runs them** (the plan is
[docs/app-windows-plan.md](docs/app-windows-plan.md)). An application's
directory holds its windows' markup (`windows.html` — templates, and the
Sprite Editor's windoids), their lifecycle and what their close and zoom
boxes mean (`windows.js`), and their placement and sizes (`layout.js`,
pure). The **window manager**, `shell/windows.js`, holds only what every
window obeys, whoever owns it: every window enters through one call,
`windows.adopt`, with its owner's declarations — its application, its
placement, a remembered pin, its resize policy, a box it keeps across a
resize, the catalog item it shows; the front application is read off the
active window; one resize rule re-pins every window; and Arrange Windows is
a composition — each application's group, arranged by its own rules, plus
every window with a placement of its own. The desktop's landmarks and
geometry primitives are `shell/layout.js`: the menu bar's and the options
strip's bands, **`WINDOW_ORIGIN`** (the corner a document window, a folder
window and a read-me all open on), the cascade, the nearness test and the
nine-slice pin.

The Sprite Editor's windows come in two tiers, two regimes; the other
applications' — the Desktop Patterns control panel, the folder windows and
the text windows — are document tier but not documents.

- **Document windows**: one per open document, cloned from a template by the
  Sprite Editor's reconciler (`apps/sprite-editor/windows.js`) — created on
  open (the doc box, cascaded into the first free slot, never a remembered
  position), removed on close (existence IS visibility). Each is `movable
resizable zoomable`; its title
  is its document's name, its `status` strip names the face it's editing, and
  its `<sm-editor>` lives exactly as long as the document is open. The title
  bar's **zoom box** is a stateless toggle with the top-left held both ways —
  a zoom never moves a window, only its far edges: one click grows it right
  and down to the vacant middle's edges and records the size it grew from, and
  a click on a window already there returns exactly that size (a session
  truth). **⌘J's zoom half is this toggle**, and because a zoomed window's far
  edges are struts of the nine-slice pin, a browser resize keeps it zoomed.
- **Utility windoids**: the **Tools palette**, the **Full Sprite View** and
  the **3D View** — the Sprite Editor's own markup, appended hidden at its
  init, **permanently open**, no close box and no menu toggle, on screen
  whenever the application is front (System 7's suspend and resume: another
  application coming forward hides them, its return shows them) — plus the **3D
  Sprite Atlas**, the one toggleable windoid. They float above every document
  window, never take the active state (clicking the 3D View can't deactivate
  the window you're drawing in), and hide as a set when the application
  deactivates. A control in a windoid acts on the ordinary **click** unless
  mouse-down is the authentic feel (the Tools palette's cells, the Sprite
  View's face tiles); **no press-driven bridges anywhere** — raising a windoid
  re-inserts its node, and the kit does that in a task after the press's click
  has landed. Every windoid's controls strip is the window's **header**, a
  white band over a 1px rule outside the scroll area, its `header-height`
  authored in the Sprite Editor's `windows.html` at the same number its
  `layout.js` carries.
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

The Sprite Editor's positions and sizes come from a **smart placement**
computed against the live raster (`apps/sprite-editor/layout.js`, pure): the
Tools palette top-left; the Full Sprite View over the 3D View as a
right-hand rail, one column, both right-flush at the same width; and the
document window on the desktop's `WINDOW_ORIGIN`, **top-left aligned beside
the Tools palette**, filling the vacant middle but for the **cascade room** at the right
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
and right to hold the rail (the Sprite Editor declares the two at its init;
one frame for every window) — around a **middle that grows and shrinks**. Each
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
panel ever — **adopted by the window manager** with the shell's `centeredBox`
as its placement, so Arrange re-centers it and a resize re-pins it like every
window. It is **an application's window, its own**
(`apps/desktop-patterns/windows.js`): Desktop Patterns is the fourth
application,
a desk accessory's seat, so the panel holding active swaps the bar to its
File / View, and its File → Close or Quit closes it — see
[Three applications, one menu bar](#three-applications-one-menu-bar) and
[Menu bar](#menu-bar).

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
  scroll range. It is the Finder's own (`apps/finder/windows.js`), **adopted
  by the window manager** with its placement — the shell's `cascadedBox`,
  the desktop's `WINDOW_ORIGIN` stepped down-right per folder window already
  open — re-placed by Arrange Windows and re-pinned by a browser resize.
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
- **The icon layer is a reconciler over containers** (the Finder's,
  `apps/finder/icons.js`): the desktop's field for
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
- **Copy and Paste** (the plan is
  [docs/clipboard-plan.md](docs/clipboard-plan.md)) is Mac OS X's Finder
  grammar, deliberately — System 7 copied no file with ⌘C/⌘V — over one
  Clipboard, **the system's**: what Paste does is decided at the pick by
  reading it, never by remembering what the app last copied. **Copy** takes
  the selected icons — documents, folders and text files, in any container,
  the Trash never among them, a trashed item fine — as references into the catalog on
  an in-app clipboard slice (`state/clipboard.js`, session-only), and hands
  the system clipboard what it can carry: the copied **names as text**, one
  per line (what the Mac's Finder pastes into a text editor, and the token
  the paste matches), plus, for exactly one document, its **stored PNG** —
  the file on disk, so another application pastes the sheet; an open
  window's unsaved strokes don't travel (Duplicate is the window's copy).
  The selection stays lit. **Paste** lands in the Finder's front folder
  window, else on the desktop, each copy at the container's next free cell
  and the pasted icons selected; **refused for the Trash** or a folder
  inside it (a paste into the Trash is a delete by copy). When the system
  clipboard's text is the text the app wrote, the slice's items paste from
  the store — chunks and subtrees intact, since the system clipboard
  sanitizes a PNG (Chrome decodes and re-encodes it, so no text chunk
  survives the trip) and can't carry a folder at all: a document copies as
  a **new file** (new id, fresh times, a fresh `Title` and `Creation Time`
  spliced into the bytes, no decode), a folder **with its whole subtree**
  from a snapshot taken before anything is written, so a folder pasted into
  itself lands one copy inside it. Only the top-level pasted item is ever
  renamed: the name **as is** where nothing in the container holds it,
  _«name» copy_ beside the original, _«name» copy 2_, _3_, … while those are
  taken — the Mac's counting, and **Duplicate ⌘D counts the same way** (a
  second Duplicate of the Car is _Car copy 2_). A reference whose record
  has since been emptied from the Trash simply skips. Nothing here is
  undoable — the Trash is the Finder's undo. **Select All** ⌘A selects
  every icon in the front window's field, else the desktop's.
- **A picture pasted from outside becomes a file** — pixels copied in an
  image editor, a browser's Copy Image, a screenshot: an `image/png` on the
  system clipboard the app did not write is **validated before anything is
  written** against the document format's shape (`lib/sheet-shape.js`: a
  3×2 atlas of square tiles, `W = 3·t`, `H = 2·t`, `t` from 1 to 64 —
  stricter than the drop on purpose, a paste being "file this" rather than
  "open this"), then stored as a **new document in the front container**
  through the seeding's own save path, its bytes normalized to the document
  format and its chunks read first as a dropped file's are (a surviving
  `Title` names it; else it is _untitled_, counted over the container's
  documents, and lands selected with its **rename box open** — New Folder's
  idiom). No window opens. Anything else raises the **paste alert** — the
  rule and the image's own dimensions — and nothing lands. Two routes, one
  path: ⌘V and the menu pick read the clipboard through the Async Clipboard
  API (Chrome asks once, _see text and images copied to the clipboard_;
  Safari and Firefox show a Paste button for content copied elsewhere); the
  browser's own Edit → Paste from its menu bar arrives as a `paste` event
  with no keydown, and is the **only route that carries a copied file** —
  a `.png` copied in the Mac's Finder reaches the page as
  `clipboardData.files`, which the API's `read()` never exposes, so a
  copied _file_ pressed in with ⌘V does not arrive; the drop is the way for
  files. Every system clipboard failure is **silent**: no secure context,
  a denied permission or Safari past the gesture leaves the in-app copy
  standing, and a paste that can't read the system clipboard pastes the
  slice's items as they stand; a ⌘V with nothing to paste does nothing.
- **Duplicate** lands the copy beside the original, in its folder, named by
  the paste's counting; a first
  **Save** lands on the desktop, as does a dropped PNG's. `?file=` resolves by
  name across every folder but the Trash. **Not yet**: no small-icon view, no
  zoom box, no Clean Up, no Put Away, no Cut, and the Finder's two alerts (a
  name too long, a folder into itself) are silent refusals.

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
- **Special → Empty Trash…** — the Finder's Special menu, where System 7 kept
  it, one item until Clean Up joins it (it sat in the Sprite Machine menu
  while one bar served every role; emptying the Trash from the Sprite Editor
  means a desktop click first, as on a Mac) — raises the Finder's alert in
  the unsaved box's anatomy, naming N items and the K they use, over Cancel
  and a default OK. OK removes every document and folder under the Trash
  from IndexedDB
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
- **The library looks past the Trash**: `?file=` resolves no trashed
  document (the Finder's Trash was invisible to Standard File) — the way to
  one is its icon in the Trash's window.
  `?fresh=1` shows the Trash and nothing else, since it is furniture. Not
  yet: Put Away ⌘Y (the record does not remember
  where a trashed item came from) and the "in use" alert.

### Text files

The how-to documentation lives on the desktop as **text files** — System 7's
read-me documents, each wearing TeachText's **newspaper icon** (the user's
32×32 1-bit art, `src/assets/text-file.png`, so the kit's selection
inversion and open ghost are exact) — and opens into **TeachText's window**.
A first pass, deliberately: **plain text, display only**.

- **A text file is its text**, the way a document is its PNG: a record of
  its own in IndexedDB's third store (`texts`: id, name, the text,
  timestamps, `folder`), the third kind of catalog item beside documents and
  folders. It files exactly as a document does — the same `folder` field,
  so the drag moves it into a folder or the Trash, a folder copies and
  lifts it with the rest, Empty Trash… counts it (its K is the text's
  bytes) and removes it — and its icon is `selectable movable editable`:
  Return renames it in place, and any open window retitles along. Copy and
  Paste carry it as a reference like a document (a copy is a new file,
  named by the same counting); its name alone reaches the system clipboard.
  No `?file=` for it, no Duplicate, no Download: the application's File
  menu serves documents.
- **The built-ins ship with the app**: `src/texts/` holds each read-me as
  a `.txt`, imported whole, and `TEXTS` lists them with the names their
  icons wear — **Read Me**, the tour of the machine, and **Keyboard
  Shortcuts**, every key equivalent by application beside the mouse
  modifiers and the ⌃W/⌘W story. They seed like Car and Cube — ordinary
  stored files from then on, renamed, filed or trashed for good — on their
  own `seededTexts` record, written once. To add one, drop a `.txt` in and
  list it; since that record is a one-shot, an existing profile takes the
  new file from **Special → Restore Default Files**, never from a boot. Not
  yet: a revision to a file already seeded reaches no existing profile (the
  restore is by name and leaves a file that is there alone — a versioned
  re-seed is still the follow-up), a dropped or pasted `.txt` (only PNGs
  arrive today), and any editing.
- **The window** (the Text Viewer's `apps/text-viewer/windows.js`, cloned
  from `#tpl-text-window` in its `windows.html`) is the classic read-me's: a document-tier window — striped bar, close box, zoom
  box, `movable resizable zoomable scrollbars="vertical"`, the kit's rail
  on the frame's right edge with the grow box in its corner cell —
  TeachText wrapped its text to the window's width and scrolled it up and
  down only. The body is
  the file's text in **one kit paragraph on the body face** (Geneva, the
  reading face), verbatim: the page's one text-flow rule keeps the file's
  line breaks and blank lines and wraps its long lines at the window, a
  word longer than the window breaking rather than widening the plane; the
  inset is a stack's pad, 4 over and under and 6 each side, for the eye.
  The mouse selects and copies the text as prose; there is no insertion
  point. The open **loads the text first** (an IndexedDB read, so the open
  is async like a document's) and the window appears with its content; a
  second open brings the existing window forward; the listing drives its
  title, and a file emptied from the Trash closes it.
- **It is the Text Viewer's window.** Opening a read-me on System 7
  switched you to TeachText: its palettes hid and the menu bar became
  TeachText's. Here the window is **adopted as the Text Viewer's**
  (`windows.adopt`'s `app`), so holding the desktop's active state makes
  the Text Viewer the front application — the windoids hide, the strip
  goes, and the bar swaps to its menus: File with _Close_ ⌃W (this window)
  and _Quit_ ⌃Q (every text window in turn), Edit with _Copy_ ⌘C and
  _Select All_ ⌘A over the prose, View with _Arrange Windows_ (see
  [Menu bar](#menu-bar)); closing hands active back to the topmost document
  window. It is placed fresh at every open — the shell's cascade from the
  desktop's `WINDOW_ORIGIN`, stepped per text window already open —
  re-placed by Arrange Windows and re-pinned by a browser resize like every
  window, and **nothing about it persists**: not its box, not its scroll,
  not that it was open.
- **The zoom box expands it to a reading column**: the whole desktop below
  the menu bar, **20 in from every edge** but **never wider than 520**,
  centered — the height of any screen, never the width of a wide one
  (`expandedTextBox` in `apps/text-viewer/layout.js`). A second click puts
  it back **where it was**, and which way a click goes is **read at the
  click**,
  never kept: a window whose every edge sits within 10 of the column is
  expanded — a nudge or a lattice snap still counts — so it restores, and
  any other expands. What it had is remembered as its **nine-slice pin**,
  the folder windows' discipline, so the restore lands where a browser
  resize would have carried it; with nothing remembered — a window grown
  by hand onto the column — it takes its placement, the authored 440 × 320
  at the slot it opened on. A browser resize keeps an expanded window
  expanded, and Arrange Windows sends it home like every window. The zoom
  box is the Text Viewer's own: its one declaration to the window manager
  is the column as the box the window keeps across a resize. The document
  window's zoom box is the other kind, the Sprite Editor's: top-left held,
  grown to the vacancy (see [Windows](#windows)).

### The About box

**Sprite Machine → About…** — and every load the URL gives no document to
open: the classic launch splash, System 7's About box on the plain dBoxProc
frame (no bar, no close box; OK, Escape, or a **click anywhere outside the
box** dismisses it onto whatever was there — at boot, the bare desktop with
the Finder front, nothing opened and nothing activated). The click-away is the
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
instead. A field it opens on is focused but **not selected**, so a seeded
name — the New box's, the save prompt's — waits with the caret at its end
until the kit selects what it focuses (kit ask #15); the app doesn't reach
into the field's shadow root for it. The same grammar runs every dialog here,
so a value typed into Tile Size… and Returned is committed and OK'd in one
stroke. The version and
the date are **build facts, never markup** — `vite.config.js` defines them
from package.json's `version` and HEAD's commit date, so every build of one
commit says the same thing — and
`shell/menu-bar.js` writes them into the box's two empty spans at wire-up.
Bumping `version` is the whole release ritual.

### Documents: a document IS a .png

A document is exactly one sprite `.png` — the 3×2 atlas — with all metadata in
standard PNG text chunks (the engine's `png-chunks.js`): `Title`, `Creation Time`,
`Software`, `sprite-machine:transforms` (written only when non-identity) and
`sprite-machine:ring`, the **3D Sprite Atlas's settings** (always written,
since a setting's default is the writing version's choice rather than an
identity). The pixels alone are already a complete document — tile size
derives from the dimensions — so **Save, Download, drop-import and a pasted
picture converge on a single format**: Download writes the saved bytes
verbatim, dropping any downloaded PNG back restores it losslessly, and any
foreign 3×2 sheet is a legal, if anonymous, document at the default ring. A
chunk-stripping optimizer costs the name, the timestamps and the ring
settings only — and the system clipboard is one: a PNG copied out through
Edit → Copy and pasted back in arrives chunkless (the browser re-encodes it),
so it lands as _untitled_ at the default ring, while a copy and paste **within
the app** rides the catalog and keeps everything (see
[Folders](#folders)).

Storage is IndexedDB (`storage/db.js`: a `docs` store — the PNG bytes plus
rebuildable listing caches, where the chunk wins on any disagreement, plus
the one field that is neither chunk nor cache, `folder` — a `folders` store,
and a `texts` store for the read-me files; the schema is that list of
stores, not a version number — a profile opens at whatever version it holds,
and a store it lacks is added by reopening one version up), driven by the
`files` slice: the pure LIBRARY layer, listing, availability, the folder tree
and its selectors, and the per-document storage operations, each taking an
explicit doc + identity, with the text files' beside them. Which documents
are open, and their dirty state, is the workspace's. Explicit Save is the
contract, with a `beforeunload` guard over ANY dirty open document as the
safety net. Where IndexedDB is broken (private windows), Save raises an
explanatory dialog and everything else still works.

### Desktop icons & state

Every saved doc gets a `vf-icon` (`selectable movable editable` — Return
renames in place, converging on the same action as File → Rename…, so any open
window retitles along), and so does every folder, every text file and the
**Trash**, the one icon that is no saved item. The built-ins are **seeded at the first-ever
boot** through the same save path as ⌘S and are ordinary mutable documents
from then on; the seeding runs while the profile carries **no record of having
seeded** — the `seeded` flag, written only after the last built-in is stored,
so an interrupted boot seeds again next time, skipping what is already stored
by name. That record is never rewritten, so **the Finder's Special → Restore
Default Files is the only way a built-in reaches a profile twice**: it stores
the built-in documents and text files whose names are nowhere in the library
and touches nothing else, which is how a deleted Car comes back and how a
read-me added to the app after a profile existed reaches it at all. **Double-click opens** — the only way into a stored document, the
desktop being the file browser (into the existing window if one is open,
deselecting the icon as the application takes focus); selecting an icon
deactivates the application, and the highlight names what the next Finder
action — a drag, a rename — acts on; every open doc's icon wears the kit's
`open` ghost. Icon art is generated **from the document itself**: **the model**,
not the sheet — rendered orthographically at the **three-quarter view** (35°
round from the front, so the front face reads larger than the flank, and 45°
up: higher than the 3D View's framing) into 32×32 → data
URI, declared `color` so selection darkens instead of inverting. **The frame is
the model's, not the lattice's** (`lib/icon.js`, the one place this parts
company with the 3D Sprite Atlas): the tight projected bounding box of the
geometry, so a two-voxel cube painted in the middle of a 64 tile fills its icon
exactly as a 64-voxel ship does, and the tile size never enters it. **Smooth
inside, inked outside**: the model is rendered **supersampled** (3 px per icon
px, no GL antialiasing) and **box-filtered down** — premultiplied, so an edge
takes its color from the model and not from the clear — so the geometry's own
edges land as coverage rather than a point sample's hit or miss; then the
**silhouette is inked** as a System 7 icon's is — every pixel the model covers
by half or more goes opaque in its own color, and a **one-pixel black outline**
runs around that coverage (four-connected, the thin line a 1-bit icon draws on
a diagonal), so the art reads as an object on any desktop pattern. The outline
lies outside the model, so the fit leaves it room: the model spans 30 of the
32 px. Both passes are pure (`lib/icon.js`), over the engine's own headless
`buildModel` on a third offscreen GL context, made on the first icon
(`scene/icon-renderer.js`, lighting the model through the atlas renderer's
rig, `scene/rig.js`). It is
rendered **once per save and cached on the record**, so a boot pays for no
icon and a document that has never been saved since the render changed keeps
the art its last save made. A document with **nothing painted** has no model
to draw, and so does every document where WebGL is out of reach: the generic
System 7 document glyph stands in.

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
   alone** into coplanar **regions** (`regions.js`): a plane's exposed
   faces, and the gable caps of the wedge blocks ending on it, traced as one
   polygon on the lattice with every straight run one edge, holes included,
   and triangulated by earcut — so a flat wall is two triangles instead of
   one-per-texel and the wall beside a windshield has one straight diagonal
   edge.

   The color rides a **texture, the skin** (`skin.js`), not the geometry.
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
being more gable caps and more split base faces. See the engine's
`wedge-mesh.js`.

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
the top row. See the engine's `views.js` for all six projection mappings.

---

## Architecture

The whole grid pipeline is **pure typed-array code — no THREE, no DOM**, the
app-state layer (`src/state/`) is pure JS, and the window and icon arithmetic
(the desktop's `shell/layout.js`, each application's `layout.js`) is pure — all
of it Node-tested (`npm test` over
both packages' `test/*.test.mjs`), densest where a bug would be
silent and expensive: the visual-hull carve and coloring, the wedge mesh's
watertightness and its gate, the region trace, the skin's bake and its UV
read, the rasterizers, the document format, the document and library
contracts, and the resize rule. The state slices get a few behavior tests
each, never the store's discipline per setter; the layout tests cover the
resize rule, the cascade's slots and the nearness reading (the shell's), the
placement as the rule's fixed point (the Sprite Editor's) and the icons' frame
(the Finder's), never where a window goes.

### Testing

The policy is [docs/TESTING.md](docs/TESTING.md), and it is binding: **unit
tests only, and only for pure logic** — the engine's suite dense, since it is
the published package, and the app's covering its pure rules — and **no
browser tests**: no driven journeys, no screenshot comparisons, nothing that
asserts markup, layout numbers, copy or what vintage-frames renders. The look
and the wiring are verified by eye. The gates — test, lint, typecheck, build —
run in seconds with no browser, and CI runs them before every deploy. The
default for a change is no new test.

```
packages/core/  THE ENGINE, published as `sprite-machine` — pure, no DOM, THREE only
                for the mesh, typechecked with no DOM lib so the wall holds by
                construction: the pipeline (ingest → carve → colorize), the mesher
                (regions, wedge-mesh, t-junction, skin, mesh-util), the atlas's
                slicing and resizing (atlas), the file formats (png-chunks, png-encode,
                gltf), the vocabularies (views, faces, constants), the mesh probe
                (diag), the headless entry (model: buildModel → modelToGlb) and the
                Node adapter (node: readSheet / sheetToGlb over pngjs) behind an
                explicit barrel (index); its tests beside it, its own README the API,
                bin/ the CLI
src/lib/      the editor's domain — pure, no THREE and no DOM: the atlas's ring geometry
              (ring), the rasterizers (rect, fill, select, brush, ants), the edge hints
              (edges, probed off the engine's views), the document format's shape rule
              (sheet-shape — what a paste validates), the zip writer, the color helpers
              and the two palettes (palette — PALETTE_168 among them), and the
              built-in sprites
src/texts/    the built-in TEXT FILES — the read-me documents, one .txt each, imported
              whole (?raw) and listed by the index with the names their icons wear;
              seeded once per profile like the samples
src/apps/     the four APPLICATIONS, one directory each on one shape — finder,
              sprite-editor, text-viewer, desktop-patterns: its menus as a vf-menu
              fragment (menus.html, imported whole), the module that wires them (index —
              every dialog flow, every gate, the application's public verbs), and its
              windows: their markup (windows.html — templates, and the Sprite Editor's
              windoids), their lifecycle, adoption, close and zoom boxes (windows.js)
              and their geometry (layout.js, pure and Node-tested), the Finder's icon
              layer (icons.js) beside its folder windows — and the registry (index) in
              the bar's order
src/state/    the app-state layer, pure JS and Node-tested: store + the Lit bridges; doc
              (two channels) and history, FACTORIES one per open document; workspace (the
              open documents as DocContexts, activeKey, the stored flows); files (the
              library, the folder tree, the Trash, the text files, the copies); clipboard (the in-app
              half of Copy / Paste: catalog references keyed to what the system
              clipboard was handed, and pasteSource); session, prefs, build, shell; and
              the atlas's per-document settings behind an active-document façade (ring)
src/storage/  the IndexedDB wrapper (`docs`, whose `folder` is its one non-chunk field,
              `folders`, and `texts` — a missing store is added one version up),
              injected into the files slice
src/scene/    stage (renderer, camera, lights, framing, on-demand loop); rebuilder, the
              pipeline's ONLY consumer, handing every mesh out through the onMesh seam;
              the atlas's offscreen world and its follower; the glb export's subject
src/shell/    what every application shares, over the index.html skeleton: layout (the
              desktop's geometry, pure and Node-tested — the landmarks and WINDOW_ORIGIN,
              the cascade, the centered and cascaded boxes, the nearness test, the
              windows' frame, pinOf / pinTo / isPin), windows (the window manager:
              adoption, the front-application reading, the resize rule, Arrange Windows
              as a composition, the markup parse every application's windows go
              through), menu-bar (the Sprite Machine menu, the shared dialogs, the parse
              of each application's fragment and the swap), desktop-pattern (the
              pattern's wire), desktop-state, url-state, clock
src/          main (the composition root), boot/params, loaders (+ seedDefaultDocs),
              drop-target, shortcuts, image-io, and components/ — all Lit and shadow DOM
              but for sm-color-picker: sm-editor over sm-draw-canvas and draw-overlays,
              the dumb leaves, and the connected chrome
src/assets/   the app's own raster art, every piece through vf-img at 1:1: the six 22×19
              tool icons, the 21×26 face cubes and the selected dither, the 32×32
              application icon, the folder, the text file's newspaper, the Trash's two
              cans and its 12×12 mark
```

### UI layer: Lit + a hand-rolled store

The chrome is `lit`, the library `vintage-frames` itself is built on (one
deduped copy), in **three layers with dependency arrows only pointing down**:
presentation (`components/` + `scene/` + `shell/`) → app state (`state/`) →
domain (the `sprite-machine` package and the editor's `lib/`, with `storage/`
a leaf the files slice takes by injection, so it stays Node-testable). The state mechanism is a ~40-line observable store.
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
