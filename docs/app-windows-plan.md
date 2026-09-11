# Plan: every application owns its windows

**Status:** proposed 2026-09-11, on the ask: _"it looks like this change was
made to shell - handling text viewer app specific behavior via
expandedTextBox? … shouldn't this be handled by the app itself? we're
trying to isolate app specific behaviors in the app code here"_ — and then
_"let's plan the full move. Write up an .md doc detailing how we'll give
each app control of its own windows"_. **Built 2026-09-11**, every step of §4 on
every decision of §6 (the user's eye pending on the lists in §4), in the
working tree, uncommitted. The trigger was 439f4d4 (the Text Viewer's zoom
box, on `main`, unpushed), which put the Text Viewer's reading column in
`shell/layout.js` and its toggle in `shell/windows.js`; step 2 moved both
out, fixing it forward. The user decided
all eight of §6 the same day: the zoom boxes each application's own,
window markup into each application, the icon layer into the Finder, a
shared starting corner, one shared frame, 439f4d4 fixed forward, the
names as recommended, and the tests' home left to Claude's judgement
(taken as recommended). CLAUDE.md gained the rule the same day, ahead of
the move, and its as-built names with step 7. Five departures from the
text below, each small: (1) a folder window and a read-me place through
ONE shell primitive, `cascadedBox` (`shell/layout.js` — WINDOW_ORIGIN's
cascade placed on a raster), each application calling it with its own
size and count, so neither application's `layout.js` holds a placement
function (the Text Viewer's holds its column alone); (2)
`initialPlacement` reads WINDOW_ORIGIN for the doc box's corner and takes
no Tools-box argument — the palette's size had no other use there, the
numbers are unchanged and the tests' calls follow; (3) the manager has
three small things §3.2 did not list — `layoutChanged()`, for an owner's
own change that is no placement (a derived size re-fit, a palette shown,
a zoom), and `parseWindows` / `cloneWindow`, the markup parse and the
importNode + upgrade recipe every application's windows go through; (4)
the 3D View's floor (`STAGE_MIN_WIDTH` / `STAGE_MIN_HEIGHT`) moved with
the Sprite Editor's geometry into its `layout.js`; (5) the Sprite Machine
menu names Desktop Patterns to open its panel through the registry
(§3.7's own call), the one application the shell names besides the Finder
as the front-application default.

The short version: **the shell keeps the window manager; each application
owns its windows.** The apps plan gave every application its menus and its
commands and deliberately left the windows where they were
([apps-plan.md](apps-plan.md) §3.7: "the windows and windoids and their
placement" do not change), so today every application's windows live in
`src/shell/`: the Sprite Editor's document windows and windoids in
`shell/windows.js`, the Finder's folder windows and icon layer in
`shell/folders.js` and `shell/icons.js`, the Text Viewer's read-mes in
`shell/texts.js`, the Desktop Patterns panel in `shell/patterns.js`, and
all four applications' geometry in `shell/layout.js`. After this plan an
application's directory holds its windows' markup, their lifecycle, their
placement and sizes, what their close and zoom boxes mean and when its
palettes show; `src/shell/` holds only what every window obeys whoever owns
it — adoption, the front-application reading, the browser-resize rule,
Arrange Windows as a composition, the clamp — and the geometry primitives
those rules are built from. One rule sorts every line: **primitives in the
shell, choices in the application.** Nothing visible changes, and nothing
is asked of the kit.

## 1. What System 7 did (the model we copy)

- **The Window Manager ran every window and knew nothing about any of
  them.** An application made its windows from its own `WIND` resources —
  the bounds, the kind, the title, whether there was a close box — with
  `GetNewWindow`. `FindWindow` told it which part of which window a click
  hit; `DragWindow` and `GrowWindow` ran the gesture inside limits the
  application passed; `TrackGoAway` and `TrackBox` tracked a press in the
  close or zoom box and reported whether it was released inside. What that
  meant was the **application's** to decide: whether to ask "Save
  changes?" first, and what size "zoomed" was — the zoom box moved a
  window between the user's rectangle and a standard one, and the standard
  one was the application's to compute, from its document and the screen.
- **Activation and suspension were the application's events.** The Window
  Manager highlighted the front window; the application got the activate
  event and redrew its own controls. When another application came forward
  it got a suspend event and **hid its own floating windows**, and showed
  them again on resume.
- **The desktop and its icons were the Finder's.** The Finder drew the
  icons and opened the folder windows; no other application touched
  either, and no application's window knew a folder window existed.

Mapped here: the kit is the Window Manager's mechanics; the shell is the
page's share of it — the rules the kit leaves to the page that no single
application owns; and each application is an application.

## 2. Where the code stands

### 2.1 Every application's windows, in the shell

- **The Sprite Editor.** Much of `shell/windows.js` (1,197 lines): the four
  windoids — placed off `initialPlacement`, the 3D View floored, the Full
  Sprite View's size derived (`fitSprite`), the 3D Sprite Atlas's height
  derived and declared as a size rect (`fitRing`) and re-placed when it
  changes behind a hidden strip, all four on screen only while the Sprite
  Editor is front (`syncUtility`), the strip's close box its toggle's
  uncheck; the document-window reconciler over the workspace
  (`createDocWindow`, `syncDocs`, the cascade into the first free slot);
  the document zoom box and ⌘J's zoom half (`zoomToggle`, `zoomActive`);
  `arranged()`'s three loose readings, every one of them the documents' or
  the strip's; the resize policy's two special cases (`floorOf` /
  `policyOf`); the `workspace.activeKey` mirror inside the activation wire;
  and the close routing, which calls back into the application through
  `windows.onDocumentClose`, injected by `apps/sprite-editor`. In
  `shell/layout.js`: `initialPlacement`, the doc box's cascade room and
  `DOC_MIN`, `zoomedBox`, `TOOLS_BOX` / `TOOL_CELL`, `STAGE_STRIP`, the
  Sprite View's and the strip's arithmetic (`SPRITE_*`, `ATLAS_GRID`,
  `spriteHeightFor`, `RING_*`, `ringHeightFor`, …) and `WINDOW_FRAME`'s
  two widened bands, sized to its rail. In `index.html`: the four windoids
  and `#tpl-document-window`. In `state/shell.js`: `WINDOW_IDS`. In
  `main.js`: the drop target's `windows.activateContext`. And four
  components take their numbers from `shell/layout.js` (`sm-tool-strip`,
  `sm-atlas-view`, `sm-atlas-controls`, `sm-ring-controls`).
- **The Finder.** `shell/folders.js` — the folder windows: their
  lifecycle, the item-count header and the Trash mark, the field's extent,
  the remembered pins — and `shell/icons.js` — the icon layer: the
  desktop's field and every folder window's, the drag and filing, the
  field's press test, the selection the Edit menu reads. In
  `shell/layout.js`: `folderBox`, `folderViewport`, `fieldExtent`,
  `iconGridDefault`, `iconDefault`, `trashDefault`, `FOLDER_*`, `ICON_*`,
  `ICON_FRAME`. In `index.html`: `#tpl-folder-window` and the desktop's
  `#desktop-icons` field. `apps/finder` reaches both modules through
  `deps.folders` and `deps.icons`.
- **The Text Viewer.** `shell/texts.js` — the read-me windows and the
  prose selection's reading and writing — and, since 439f4d4, the reading
  column in `shell/layout.js` (`expandedTextBox`, `TEXT_EXPAND_PAD`,
  `TEXT_EXPAND_MAX_WIDTH`, `EXPAND_NEAR`) and its toggle in
  `shell/windows.js` (`expandToggle`, the pre-expand memory, the resize
  rule's keep-expanded branch), written as a panel option but described in
  text-window terms. Its placement borrows the Finder's `folderBox`. In
  `index.html`: `#tpl-text-window`. `apps/text-viewer` reaches it through
  `deps.texts`.
- **Desktop Patterns.** The panel half of `shell/patterns.js` — open,
  close, the adoption, `centeredBox` — and `#tpl-patterns-window`. The
  module's other half, the wire that paints `shell.desktopPattern` onto
  the desktop and validates the boot restore, is the desktop's and stays.

### 2.2 What the shell does that is nobody's

`shell/windows.js` also holds what no application owns, and that is the
window manager this plan keeps: panel adoption (`addPanel` /
`removePanel`, each panel with its placement, its application and a
remembered pin); the front-application reading (`vf-activate` →
`shell.setFrontApp`); the bezel press (a press on the desktop host is the
Finder's); the browser-resize rule (the nine-slice pin for every window,
the unrounded-pin cache, the oversize shrink); Arrange Windows and
`arranged()`; the clamp (`clampedBox`); and the layout signal
(`onLayout`). In `shell/layout.js`: `TOP_RESERVE`, `MENU_BAR`, the cascade
(`cascadeFrom`, `cascadeSlot`, the step and the slot count),
`centeredBox`, the pin (`pinOf`, `pinTo`, `isPin`, `BAND`, the frames) and
`nearBox`.

### 2.3 The couplings the move has to cut

- **The Finder places its windows off the Sprite Editor's palette.**
  `folderBox` — and the Text Viewer, which borrows it — cascades from the
  doc box's corner, `EDGE + TOOLS_BOX.width + EDGE` across and
  `TOP_RESERVE + GAP` down: the Tools palette's width decides where a
  folder window opens.
- **One frame, sized to one application's furniture.** `WINDOW_FRAME`'s
  top band is the Full Sprite View's height plus its gaps and its right
  band the rail column, and every window re-pins in it — folder windows
  too, whose pins are stored in the desktop-state blob in that frame's
  terms.
- **The icon layer reaches into two applications' windows**: folder
  windows' fields (`folders.fields`, `fit`, `viewportOf`, `onWillClose`,
  `folderOf`) and text windows' open state (`texts.open`, `isOpen`,
  `onChange`). And it is created before the menu bar because the Finder
  needs it at init (`deps.icons`), so the Finder cannot own the folder
  windows while the layer stays in the shell, short of the shell importing
  an application.
- **The activation's order carries a behavior.** The wire writes
  `workspace.activeKey` before `shell.setFrontApp`, and the 3D Sprite
  Atlas depends on it: a document switch arriving from another application
  lands while the strip is still hidden, so a height change re-places it
  rather than re-fitting a strip nobody can see (the comment above
  `fitRing`).
- **Two calls back into applications**: `windows.onDocumentClose`,
  injected by the Sprite Editor, and `services.patterns.open()` in the
  Sprite Machine menu.

## 3. The design

### 3.1 The split

- **The kit** — `vf-desktop`, `vf-window` — is the Window Manager's
  mechanics: stacking, activation, the drag, the grow box within a size
  rect, the close and zoom boxes' clicks reported on the window
  (`vf-close`, `vf-zoom`). Unchanged.
- **The shell** — `shell/windows.js` and `shell/layout.js` — is the window
  manager: adoption, the front-application reading, the bezel press, the
  resize rule, Arrange Windows and `arranged()` as compositions, the
  clamp, the layout signal; and the desktop's landmarks and geometry
  primitives.
- **An application** — `src/apps/<id>/` — owns its windows' markup,
  lifecycle, content, placement and sizes; what its close and zoom boxes
  mean; when its palettes show; and how its windows arrange as a group.

The test for which side a line belongs on: shell code that names an
application, a kind of window, or a number derived from one application's
art is in the wrong place. A cascade, a pin, a centered box and "is this
box near that one" are primitives and stay; which cascade, which size and
which box "zoomed" is are choices and move.

### 3.2 Adoption: one call for every window

Every window — windoid, document, folder, read-me, panel — enters the
manager the same way, with its owner's declarations, the page-side half of
a `WIND` resource:

```js
windows.adopt(win, {
  app: TEXT_VIEWER, // the owner: the front-application reading
  place: (w, h) => box, // where it goes on a raster (optional)
  pin: null, // a remembered pin to re-express at the open instead
  policy: (box) => ({ size, min }), // the resize rule's policy (optional)
  keep: (w, h) => box, // a box held across a resize (optional)
  item: `text:${id}`, // the catalog item it shows (optional)
});
windows.release(win); // then the owner removes the node
```

- **`place`** is today's `boxFor`: applied at adoption (unless `pin`),
  re-applied by Arrange, read by `arranged()`. A window adopted without one
  is arranged by its owner's group (§3.4).
- **`policy`** defaults to today's: a resizable window floors at the kit's
  grow floor, a fixed-size one resolves at its live size. The 3D View's
  floor and the strip's mixed box become the Sprite Editor's declarations
  instead of the manager's special cases.
- **`keep`** is 439f4d4's keep-expanded branch, generalized: while the
  window sits near `keep` on the raster being left (`nearBox`), a resize
  writes `keep` on the new raster instead of pinning. The Text Viewer
  declares its reading column; nothing else needs one yet.
- **`item`** is the item's icon key (`doc:`, `folder:`, `text:`), and lets
  the manager say whether a window showing that item is open
  (`windows.isOpen(key)`) and signal when that changes
  (`windows.onWindows`) — the icon layer's open ghost for folders and text
  files, with no reach into the Text Viewer.

For the gestures an application runs itself the manager exposes
primitives, not rules: `write(win, box)` (a placement's write — snapped,
the pin record dropped, the layout signal told), `clamped(win, box)` (the
boot clamp's arithmetic), `pinOf(win)` and `fromPin(win, pin)` (a window's
pin where it sits; a pin re-expressed on the live raster and clamped — the
folder reopen's path, and the read-me's restore), `placed(win)` (its
`place` on the live raster, clamped), and the signals `onLayout`,
`onWindows`, `onRaster(before, after)` and `beforeFront(fn)`. `addPanel`,
`removePanel`, `windowPin`, the document windows' special case in the
activation wire and `windows.onDocumentClose` all go.

### 3.3 Activation

The front-application reading becomes one lookup,
`adopted.get(win)?.app ?? FINDER`. The Sprite Editor's
`workspace.activeKey` mirror leaves the wire, and the order it relies on
stays: the manager calls every `beforeFront` listener with the newly
active window, or null, **before** it writes `shell.setFrontApp`, and the
Sprite Editor's listener is the one that writes `workspace.setActive`.
`adopt` re-reads the active window, as `addPanel` does now, so an owner
may append, adopt and raise in any order.

The windoids' visibility becomes the Sprite Editor's own subscription to
`shell.frontApp` — suspend and resume: it hides its palettes when another
application comes forward and shows them when it returns, the strip
behind `prefs.showRing` as well.

### 3.4 Arrange Windows, composed

Arrange Windows stays the one command in every View menu, and the manager
stops knowing any application's rules for it. Windows adopted with `place`
are the manager's to arrange and to read, as panels are now. An
application whose windows arrange as a group registers the group —
`windows.arrangeWith(app, { arrange, arranged })` — and the manager's
`arrange()` runs every group and places every `place`-adopted window,
while `arranged()` asks every group and checks every visible
`place`-adopted window against its target. The Sprite Editor is the one
group: the windoids on the rail and the dock, the documents cascaded in
stacking order, and its three loose readings — the cascade's permutation,
the active document zoomed from its slot, the strip's width — which are
its rules, not the desktop's. Registering a group tells the layout
signal, so every View menu's ⌘J re-derives.

### 3.5 Close and zoom are the owner's

The kit fires `vf-close` and `vf-zoom` on the window; the owner listens on
its own windows and decides, and nothing is routed through the manager.

- **Close.** A document window's close box runs the Sprite Editor's dirty
  check directly; the strip's is `prefs.setShowRing(false)`; a folder
  window, a read-me and the panel remove themselves, as they do now.
- **Zoom.** The Sprite Editor's — the vacancy from the held top-left, the
  recorded size, ⌘J's zoom half — moves whole into `apps/sprite-editor`.
  The Text Viewer's — the reading column, the state read at the click by
  nearness, the pre-expand box kept as a pin, its placement as the
  fallback — moves into `apps/text-viewer`, and `keep` is all it asks of
  the manager. Two applications, two meanings of "zoomed", and the manager
  holds neither (§6.1).

### 3.6 The desktop's geometry

`shell/layout.js` shrinks to the desktop's landmarks and primitives:

- **Landmarks.** `MENU_BAR`; `TOP_RESERVE`, the menu bar plus the options
  strip's band, below which every window's title bar stays whoever is
  front; and one new one, **`WINDOW_ORIGIN`** — where an application's
  first window opens, today's doc-box corner at (52, 64) — stated by the
  desktop and read by the three applications that cascade from it, so a
  document, a folder window and a read-me still open on the same corner
  without the Finder reading the Sprite Editor's palette (§6.4).
- **Primitives.** The cascade (`cascadeFrom`, `cascadeSlot`, the step, the
  slot count), `centeredBox`, the pin (`pinOf`, `pinTo`, `isPin`, `BAND`,
  the `Frame` type), and `nearBox` with a tolerance of the desktop's own,
  `NEAR` — past a lattice snap, short of a real move — no longer derived
  from the text pad.
- **The window frame.** One frame for every window, as now. Its two
  widened bands are the Sprite Editor's furniture, so the Sprite Editor
  declares them at init (`windows.setFrameBands({ top, right })`), and
  every stored folder pin means what it meant (§6.5).

Each application gets a `layout.js` for its choices: the Sprite Editor's
`initialPlacement`, doc box, `zoomedBox`, windoid sizes and the atlas
DITL; the Finder's folder box (the shell's cascade from `WINDOW_ORIGIN`),
viewport, field extent, both icon lattices, the Trash's corner and the
icons' frame; the Text Viewer's placement (the same cascade, its own call
rather than the Finder's function) and its reading column. Desktop
Patterns needs none: its placement is the shell's `centeredBox`.

### 3.7 An application's directory

```
src/apps/<id>/
  index.js       the definition and init: menus, commands, the wiring of its windows
  menus.html     its menus (unchanged)
  windows.html   its windows' markup: templates, and the Sprite Editor's windoids (§6.2)
  windows.js     its windows: lifecycle, adoption, close and zoom, its arrangement
  layout.js      its geometry, pure, Node-tested where it has rules
```

- **The Sprite Editor.** `windows.js`: the windoids (appended hidden at
  init, placed, fitted, shown and hidden with the application, the strip's
  toggle), the document reconciler, the zoom and ⌘J's two halves, its
  arrangement group, its `beforeFront` mirror. Its actions gain
  `showDocument(key)` — today's `activateContext` — for the drop target
  and the Finder's opens.
- **The Finder.** `windows.js`: the folder windows. `icons.js`: the icon
  layer, moved whole (§6.3). A text file's double-click calls the Text
  Viewer's `open` and a document's the Sprite Editor's `openDoc`, both
  through `deps.apps` at pick time; the text ghost reads
  `windows.isOpen`; the icons' re-pin listens to `windows.onRaster`; the
  desktop state's readers (`iconPos`, `windowPin`) arrive in `deps`, and
  `positions()` and `pins()` go back to `main.js` for the snapshot as
  actions.
- **The Text Viewer.** `windows.js`: today's `shell/texts.js`, plus its
  zoom. `layout.js`: its placement and the column. Its actions gain
  `open(id)`.
- **Desktop Patterns.** `windows.js`: the panel. Its actions gain
  `open()`, which the Sprite Machine menu calls through the registry.

### 3.8 What the shell hands each application

`deps` loses `folders`, `texts`, `patterns` and `icons` — each is an
application's own now — and gains the desktop state's two readers for the
Finder. What remains is `desktop`, `windows` (the manager), `ring`,
`model`, the shared dialogs, `modalOpen` and `apps`.

`main.js` gets shorter: the manager; the desktop pattern's wire (what
stays of `shell/patterns.js`, as `shell/desktop-pattern.js`); the ring
follower and the model export; the menu bar, which initializes the four
applications and with them every application window and the Finder's
icon layer; the clock; the resize (`windows.onDesktopResized` alone — the
icon layer listens); the snapshot (`dstate.start` reading the Finder's
`positions` and `pins`); the URL state; and the scene.

### 3.9 The hazards, and how each is met

- **The activation order** — `beforeFront` (§3.3), not a second
  `vf-activate` listener, which would run after the manager's and let the
  strip see itself shown mid-switch.
- **The windoids' first paint** — appended with `hidden` set,
  synchronously inside `main.js`'s top level, before the first frame; a
  boot still shows the Finder's bar and no windoid.
- **The 3D View's canvas** — `createStage` finds `#viewport` in a windoid
  the Sprite Editor now appends, so the scene must be built after the menu
  bar, as it already is.
- **The Finder before the Text Viewer** — the registry initializes the
  Finder first; its icon layer reads text ghosts off the manager at
  wire-up and calls the Text Viewer only at a pick, the apps plan's rule
  for `deps.apps`.
- **HMR** — each application's `dispose` releases and removes its
  windows, windoids included (the same teardown rebuilds the stage), and
  `main.js` disposes the menu bar before the manager, the reverse of
  today.
- **Stored pins** — one frame with the same bands, so a pin stored before
  the move re-expresses exactly as it would have.

### 3.10 What does not change

Every window's placement, size and resize behavior; Arrange Windows and
its readings; both zoom boxes; the front-application reading and the
swap; the close paths; the menus; the desktop-state blob and every stored
pin and position; the options strip and the desktop's icon field in
`index.html` — in-flow bands of the desktop's skeleton, not windows, the
strip's band being `TOP_RESERVE`; the dialogs in `index.html` (the apps
plan's follow-up stands); the kit; the engine.

## 4. Steps

Each lands green (`npm test`, `npm run lint`, `npm run typecheck`, `npm run
build`) and shippable alone; the look and the wiring are the eye's
([TESTING.md](TESTING.md)). The smallest applications go first, so the
manager's API is proven before the Sprite Editor leans on it.

1. **The manager's adoption API.** `adopt` / `release` with every field of
   §3.2, the primitives and the signals; the three panel owners switched
   from `addPanel` in the same commit. Document windows and windoids stay
   the module's own for now. Nothing visible changes. Eye: a folder
   window, a read-me and the panel still open, arrange, re-pin on a
   browser resize and swap the bar.
2. **The Text Viewer** — the pilot, and 439f4d4 fixed forward.
   `shell/texts.js` → `apps/text-viewer/windows.js`; `#tpl-text-window` →
   `apps/text-viewer/windows.html`; the column and the placement →
   `apps/text-viewer/layout.js`; the zoom toggle out of `shell/windows.js`
   into the application, `keep` its one declaration; `nearBox` on `NEAR`;
   `deps.texts` gone; the icon layer opens a text through the Text
   Viewer's action and reads the ghost off `windows.isOpen`. Eye: a
   read-me opens, expands, restores, keeps its column across a browser
   resize and closes, and its icon's ghost comes and goes.
3. **Desktop Patterns.** The panel → `apps/desktop-patterns/windows.js`
   and `windows.html`; `shell/patterns.js` → `shell/desktop-pattern.js`,
   the wire alone; the Sprite Machine menu opens the panel through the
   registry. Eye: the panel from every bar, Set, its close box, Arrange
   re-centering it.
4. **The Finder.** `shell/folders.js` and `shell/icons.js` →
   `apps/finder/windows.js` and `apps/finder/icons.js`;
   `#tpl-folder-window` → its `windows.html`; its geometry →
   `apps/finder/layout.js`, the folder box cascading from `WINDOW_ORIGIN`;
   the desktop state's readers through `deps` and the snapshot's back
   through its actions; the icons' re-pin on `windows.onRaster`. Eye: a
   folder window reopening where it was, from a pin stored before the
   step; filing by drag in and out; the rubber band; Copy and Paste; New
   Folder's rename box; the Trash and Empty Trash….
5. **The Sprite Editor's geometry** — a pure move. Its half of
   `shell/layout.js` → `apps/sprite-editor/layout.js`, the four
   components' imports following, the frame's bands declared at its init.
   Nothing visible changes.
6. **The Sprite Editor's windows.** The windoids (their markup →
   `apps/sprite-editor/windows.html`), the document reconciler
   (`#tpl-document-window` with it), the zoom and ⌘J's halves, the close
   routing without the injection, the arrangement group, the
   `beforeFront` mirror, the policies; `WINDOW_IDS` leaves
   `state/shell.js`; the drop target calls `showDocument`. Eye, the long
   list: a boot to the About box with no windoid on screen; a document
   open bringing the rail and the palette; the strip from the menu and
   from its close box; a tile resize with the strip shown and hidden; a
   document switch from the Finder with the strip shown; both zoom boxes
   and ⌘J's two halves; Arrange from every application; a browser resize
   with everything open; Quit over a dirty document; a dropped PNG.
7. **The shell finished, and the docs.** `shell/windows.js` re-headed as
   the manager, naming no application but the Finder as the default;
   README's Architecture tree, §Windows' `shell/layout.js` pointers and
   §Text files; `apps-plan.md` §3.7's pointer; `state/shell.js`'s header;
   CLAUDE.md's §Applications and the shell (the rule landed 2026-09-11,
   ahead of the move) brought to the as-built names, its "not there yet"
   bullet retired; this plan's status line.

## 5. Kit asks

**None.** The kit already reports each gesture on its window and leaves
the meaning to the page — `vf-close`'s "the consumer decides what closing
means", `vf-zoom`'s empty detail — takes windows slotted at any moment,
and keeps utility windows out of the active state. A window appended by
an application's init is simply a window appended.

## 6. Decisions for the user

All eight are decided (the user, 2026-09-11): the first seven as
recommended, the eighth left to Claude's judgement and taken as
recommended.

1. **Whose is the zoom box.** The owner's, whole, the manager contributing
   only `keep` — or one standard-state mechanism in the manager, the
   Toolbox's two rectangles, that both applications declare into. The
   document window's zoom and the read-me's differ in every rule (a held
   top-left read exactly, against a moved box read by nearness; a
   remembered size against a remembered pin; the doc box's size against
   the placement as the fallback), so one mechanism would change the
   document window's or grow a flag for each difference.
   **Decided (2026-09-11): each application's own.**
2. **Where a window's markup lives.** Each application's `windows.html`,
   imported `?raw` and parsed at its init — templates cloned by today's
   `importNode` + `upgrade` recipe, the Sprite Editor's windoids appended
   hidden — or `index.html`, as now. The apps plan kept the templates in
   the skeleton as "the desktop's plumbing, not an application's" (its
   §6.2); a window's anatomy is its `WIND` resource, and that was the
   application's. The options strip and the desktop's icon field stay in
   the skeleton either way.
   **Decided (2026-09-11): into each application's `windows.html`.**
3. **The icon layer.** Into the Finder with the folder windows — it
   renders into their fields, and the shell cannot keep it without
   importing an application — or left in the shell, the Finder handing it
   the folder windows through an injected interface, the
   `onDocumentClose` pattern this plan retires.
   **Decided (2026-09-11): into the Finder.**
4. **The shared origin.** `WINDOW_ORIGIN`, a desktop landmark the Sprite
   Editor's doc box, the Finder's folder box and the Text Viewer's box all
   read, with the Tools palette placed in the band left of it — or each
   application's own constant, free to drift apart.
   **Decided (2026-09-11): the shared landmark, `WINDOW_ORIGIN`.**
5. **The frame's widened bands.** Declared by the Sprite Editor at init,
   one frame for every window as now — or a frame per application, the
   Finder's and the Text Viewer's windows re-pinning in uniform bands:
   cleaner, but a folder window's resize behavior changes near the right
   and top edges, and every stored folder pin, read in the rail frame,
   lands a little differently at its next open.
   **Decided (2026-09-11): one shared frame.**
6. **439f4d4.** Unpushed on `main`. Fix it forward in step 2, or revert
   it now and rebuild the zoom box inside step 2. Pushing it before step 2
   ships the leak along with the feature; the leak is invisible.
   **Decided (2026-09-11): fix forward.**
7. **Names.** `shell/windows.js` keeps its name, re-headed as the window
   manager, or becomes `shell/window-manager.js`; what stays of
   `shell/patterns.js` becomes `shell/desktop-pattern.js`. The whole tree
   already calls `shell/windows.js` the window layer.
   **Decided (2026-09-11): keep `windows.js`; rename the pattern's wire.**
8. **Where the moved tests live.** In `test/`, a file per module's rules:
   the shell's pin, cascade and nearness stay in `layout.test.mjs`; the
   Sprite Editor's placement, its tiny-raster finiteness and the placement
   as a fixed point of the frame move to `sprite-editor-layout.test.mjs`;
   the Finder's icon frame and lattice to `finder-layout.test.mjs`.
   **Decided (2026-09-11, left to Claude's judgement): as stated.**

## 7. Tests, by the rules

[TESTING.md](TESTING.md): a new pure function with rules earns a unit test
on its contract; wiring, look and the kit's mechanics earn nothing. **No
new test.** The moved pure functions keep their tests, the imports
following them (§6.8), and no contract changes. `adopt`, `keep`, the
arrangement groups and `beforeFront` are DOM wiring — the eye's, by the
lists in §4.

## 8. Follow-ups, in the order they earn their place

- **The scene beside its windoids.** The 3D View's stage and the mesh
  rebuilder are built in `main.js`; they are the Sprite Editor's, and
  would follow its windoids into its directory.
- **The document ghost off the registry.** The icon layer reads open
  documents off the workspace; document windows adopted with `item` would
  put all three kinds on one reading.
- **The components beside their application** — `sm-editor` and the
  windoids' components into `apps/sprite-editor/`.
- **The options strip** into the Sprite Editor's markup, once the skeleton
  offers an in-flow slot under the menu bar that an application can fill.
- **The dialogs beside their menus** — the apps plan's §8, unchanged.
- **Struts declared per window.** A windoid could state which of its edges
  hold — the springs-and-struts mask the resize rule is modeled on —
  instead of widening the shared frame's bands for it, which would retire
  §6.5's question.

## 9. Files touched

New: `src/apps/finder/windows.js`, `src/apps/finder/icons.js`,
`src/apps/finder/layout.js`, `src/apps/finder/windows.html`,
`src/apps/sprite-editor/windows.js`, `src/apps/sprite-editor/layout.js`,
`src/apps/sprite-editor/windows.html`, `src/apps/text-viewer/windows.js`,
`src/apps/text-viewer/layout.js`, `src/apps/text-viewer/windows.html`,
`src/apps/desktop-patterns/windows.js`,
`src/apps/desktop-patterns/windows.html`, `src/shell/desktop-pattern.js`,
`test/sprite-editor-layout.test.mjs`, `test/finder-layout.test.mjs`.
Changed: `src/shell/windows.js` (the manager alone), `src/shell/layout.js`
(the desktop's geometry alone), `src/shell/menu-bar.js` (`deps`; the
Desktop Patterns item through the registry), `src/shell/desktop-state.js`
(its comments), the four `src/apps/*/index.js`, `src/apps/index.js`,
`src/state/shell.js`, `src/main.js`, `src/drop-target.js`,
`src/components/sm-tool-strip.js`, `sm-atlas-view.js`,
`sm-atlas-controls.js` and `sm-ring-controls.js` (their imports),
`index.html` (four windoids and four templates leave),
`test/layout.test.mjs`, `README.md`, `docs/apps-plan.md`, and `CLAUDE.md`
(step 7's refresh). Removed: `src/shell/folders.js`,
`src/shell/icons.js`, `src/shell/texts.js`, `src/shell/patterns.js`.
Untouched: `packages/core`, the kit, the dialogs.

The release, when a step ships: nothing visible changes, so the app's
version has nothing to announce — a patch only if the user wants a step
deployed on its own; the engine does not bump.
