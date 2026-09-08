# Plan: folders — the Finder's filing system for the desktop's documents

**Status:** proposed 2026-09-07, revised the same day for **vintage-frames
0.7.0**, and **BUILT the same evening** — steps 0–6 below as written, the
§5 recommendations taken (no delete yet, geometry not persisted, nesting
on, Arrange re-places folder windows, Select All in, the path prefix); the
as-built passage is README §Folders. The ask: _"we have a 'desktop' in our app, but we
don't have folders … can we implement a finder like folder system so that
document files can be organized into named folders?"_ — with a 32×32 folder
icon (`~/Desktop/FOLDER.png`, pure 1-bit: 110 black px, 575 white, the rest
transparent; the ink in rows 7–31, one transparent column at the right).

The short version: a folder is a **named container in the library**, drawn
as an icon; opening it opens a **Finder window** whose body is a field of
icons; a document is filed by **dragging its icon** — onto a folder's icon,
into a folder's open window, out of a window onto the desktop, window to
window, one icon or a whole selection — and the page decides what every
drop means. The first draft of this plan (on 0.6.2) had to ship filing one
way, under a page-side release listener, and wait on two kit asks for the
rest. **0.7.0 ships both** (`docs/FINDER.md` in the kit is the recipe, its
`demo/examples.ts` the specimen): the drag is the classic dotted outline
over everything with `vf-drag-start` / `vf-drag` / a cancelable `vf-drop` /
`vf-drag-cancel`, a `target` attribute for the destination's inversion, the
selection travelling as a set, a `vf-icon-field` container with the Finder's
rubber band, `placementAt()` on the desktop, a window and a scroll area,
and a window re-measuring its rails under a moved icon by itself. So the
plan has no bridge and no "one way first": every gesture lands in one
step, and the app's share is the catalog, the windows, the menus and the
meaning of a drop — exactly the division the kit's doc draws.

The app is on 0.6.2 (`package.json` `^0.6.2`, `node_modules` 0.6.2); 0.7.0
is published. Step 0 is the bump.

## 1. What the Finder did (the model we copy)

- A folder is an icon; double-clicking it opens a window titled with its
  name, its header line reading _N items_, its body a white field of icons
  with scroll rails.
- File → New Folder makes _untitled folder_ in the front Finder window (the
  desktop if none), its name selected for typing.
- Dragging an icon onto a folder icon files it; the folder inverts while
  the drag is over it. Dragging into a folder's open window files it where
  it lands. Dragging out of a window onto the desktop, or into another
  window, moves it back or across. A drag showed a **dotted outline** of
  the icon (of every selected icon) over everything, the icons themselves
  staying put until the drop; Escape cancelled it.
- A drag on a window's or the desktop's background was the **rubber band**;
  Shift-click extended a selection; Select All selected the front window's.
- Folders nest; a folder could not be put into itself.
- Opening a Finder window brought the Finder forward — the application's
  palettes hid.
- The disk remembered every icon's position in its folder and every folder
  window's box.

Everything above but the last line and the delete path (the Trash, §5) is
in scope. One departure, stated where it applies: folder windows place
fresh each open, as every window here does.

## 2. The design

### 2.1 The model: a folder is catalog structure, not document content

A document IS its PNG, and the record's other fields are cache. Folder
membership is neither: it is where the file _sits_, the HFS catalog's
business, and a downloaded PNG carries none of it (a dropped one lands on
the desktop). So it lives beside the documents in **IndexedDB**, never in a
chunk and never in localStorage:

- `storage/db.js`: **`DB_VERSION` 2**, a second object store **`folders`**
  (keyPath `id`; a record `{id, name, parent, createdAt, modifiedAt}`,
  `parent` a folder id or `null` — the desktop is the root and has no
  record). `onupgradeneeded` creates it; the `docs` store is untouched. The
  storage surface gains `listFolders / putFolder / removeFolder`; the Node
  stub in `test/helpers.mjs` (`memStorage`) grows a second map. (A version
  bump means `onblocked` fires with another tab open on the old schema —
  the existing rejection path degrades to _Save unavailable_; acceptable,
  noted. The open handler also closes on `versionchange` so THIS tab never
  blocks a newer one.)
- A doc record gains **`folder`** (a folder id, or `null`/absent = the
  desktop) — the one record field that is neither chunk nor cache. `save`
  keeps an existing record's `folder` (it already fetches `prev` for
  `createdAt`); a NEW record takes it from the identity (`{folder}` in the
  save options, `null` by default: a first save lands on the desktop; a
  Duplicate passes the original's, so the copy lands beside it, as the
  Finder's did). `renameById` spreads the record and keeps it for free.
- `state/files.js` (the library layer, still pure and Node-tested): the
  store gains `folders` (sorted like `list`, by `createdAt` then id) and
  every `list` row gains `folder`. New actions: `createFolder({name,
parent})` → `{id, name}`; `renameFolder(id, name)`; `moveDoc(id, folder)`;
  `moveFolder(id, parent)` — refused (a no-op, resolving false) when the
  target is the folder itself or inside it; `removeFolder(id)` — the slice
  has it for the Trash's day (§5), nothing in cut 1 calls it. Pure
  selectors beside them, exported for the shell and the tests:
  `childrenOf(state, folder)` → `{docs, folders}`, `isInside(state, id,
ancestor)`, `nextFolderName(state, parent)` — _untitled folder_,
  _untitled folder 2_, … over the names in that folder (the workspace's
  untitled rule; names otherwise collide freely, as document names do
  today — `?file=` still resolves by name across every folder, most
  recently modified first).
- **Nesting comes free** and stays on: a folder's icon renders in its
  parent's container like a document's, opens its own window, and the only
  extra rule is the cycle check on a move. Nothing in the UI knows a depth.

Icon **positions** stay where they are — the desktop-state blob's `icons`
map, keyed `doc:<id>` and now `folder:<id>` (keys are opaque there; no
version bump). A position is _within the item's current container_, in
whole system px — the desktop's are screen coordinates from the raster's
corner (unchanged: the desktop field is filled, not placed, §2.3), a
window's from its scrolled plane's origin. A drop between containers
writes the new coordinates onto the same key (the icon element is
re-parented, its key rides along). One rule the snapshot needs that it
lacks today: `snapshot()` rebuilds `icons` from the LIVE elements, and an
icon in a closed folder window is not live — so the writer merges the map
it last wrote under the live one (`{...known, ...live}`), or a closed
folder would forget its arrangement on the next write. The elements it
reads come from every container under the desktop element, not the desktop
field alone.

### 2.2 The folder icon

`src/assets/folder.png` (the user's art, beside the application icon; the
tool glyphs and face cubes keep their own folders). A `vf-icon` per folder,
`selectable movable editable`, **no `color`**: the art is a 1-bit mask, so
the kit's selection inversion is exact, the **`target`** inversion (the
destination under a drag) is the same treatment on the art alone, and the
kit's derived **open ghost** — outline held, interior dithered — is the
classic open folder, drawn from this one file while the folder's window is
on screen (`icon.open` follows `folders.isOpen(id)`, the way a document
icon's follows its window). It carries `data-folder="<id>"` (the recipe's
marker: what the drop's hit test looks for) beside the layer's
`data-key="folder:<id>"`. Rename in place converges on
`files.renameFolder`; the window's title follows through the listing. The
kit renders `large` only — no 16×16 art is needed until a small-icon view
wants one (§7).

### 2.3 The desktop field: `vf-icon-field`

`index.html`'s `<div id="desktop-icons" role="listbox">` becomes
**`<vf-icon-field id="desktop-icons" label="Desktop" fill-width
fill-height>`** — the kit's own container for a field of icons (0.7.0),
**filled, not placed**: it stays static, so its icons keep anchoring to the
desktop's raster and every saved position means what it meant (a placed
field would move the origin under the menu bar and shift every stored
coordinate by 20). Filled, it has a surface to press, which is what the
**rubber band** needs — a drag on the bare desktop selects what the
rectangle touches, Shift toggles, Escape cancels, the kit's marquee at the
field's own level under the windows — and it owns the `listbox` role
through internals. The id stays (desktop-state's root, the drive's
`#desktop-icons vf-icon` selector). It sits where the div sits (after the
windoids, before the dialogs; the windows are out of flow, the dialogs in
the top layer, so the field's box is the raster below the menu bar and the
options strip, clipped by the screen).

One consequence for the press test: a press on the dither now lands on the
field, not the desktop host, so `windows.js`'s `target === desktop` rule
covers the bezel alone. The icon layer's root listener already routes
every press in the root through `clearActive()` — the field IS the
Finder's surface, so that one listener is the whole desktop half of the
test (the recipe's own: a press whose path holds the field and no icon).

### 2.4 The folder window: the Finder's window, a panel

One `vf-window` per open folder, cloned from a new `#tpl-folder-window` in
`index.html` — `heading` the folder's name, `movable resizable closable`,
**`scrollbars="both"`** (the Finder's rails; the corner cell takes the grow
box), an authored default box (the Patterns panel's idiom: the markup
states the size, the placement takes it as input — 320 wide, tall enough
for two rows of the lattice under the header; whole numbers, eyeballed), a
**header** (`slot="header"`) holding one `vf-label` — _N items_, the
Finder's header line, plain ink (never `dim`), placed at the header's
corner, `header-height` authored and mirrored by a `FOLDER_STRIP` in
`shell/layout.js` the drive pins it against, the ring strip's rule — and a
body that is one **placed `vf-icon-field`** at `top="0" left="0"`, the
folder's name as its `label`, sized to the folder's **extent**: the body's
viewport at least (so the band reaches every visible px), grown to hold
every icon plus the lattice's gutter — re-derived at open, on a grow box
commit and on every filing into it. Placed at the plane's origin, the
field's coordinates and the window's `placementAt()` agree, and a field
past the viewport IS the scroll range (the kit sizes its plane to placed
content; the rails follow a moved icon by themselves — 0.7.0). White
paper, the Finder's — the body's default, no bridge needed (kit ask #6
bites bare containers only).

A new `shell/folders.js` owns the lifecycle, the `patterns.js` shape
generalized to many: `open(id)` (a second open brings the window forward),
`close(id)` (the close box — existence IS visibility, the node removed),
`isOpen(id)`, `fieldFor(id)` (the field element, for the icon layer),
`folderOf(win)` (the id a window shows, for the drop's hit test),
`onChange(fn)` (a window opened or closed), a `files` subscription that
retitles on a rename, re-counts the header, and closes the window of a
folder that vanished. Every folder window is **adopted by `windows.js` as
a panel** (`addPanel` with a pure placement; `removePanel` on close), so a
browser resize re-pins it by the nine-slice rule and View → Arrange
Windows re-places it — the Desktop Patterns panel's contract exactly, one
`Map` already built for many. The placement, `folderBox(desktopW,
desktopH, size, n)` in `layout.js`: the doc box's top-left stepped
down-right by `CASCADE_STEP` per folder window already open at the moment
of opening (`n` captured at open, a session truth), clamped by
`clampedBox`. **Nothing about the window persists** — not its box, not its
scroll — the windows' principle (a browser reopens on another monitor all
the time); the Finder remembered both, and §5 lists it as the decision it
is. No zoom box in cut 1 (`onZoom` serves document windows alone; a zoom
that did nothing is worse than none) — §7.

**It is the Finder's window.** Holding the desktop's active state, a panel
mirrors as the desktop-focused role (`applyActive`: a document window
active, not any window), so clicking into a folder window deactivates the
application — the windoids hide, the options strip goes, the
document-scoped items grey, exactly what a System 7 Finder window did to
the front application — and closing it hands active to the topmost
document window, the application back where it was. Boot with a folder
window open? Never: nothing about windows persists.

### 2.5 Containers: the icon layer generalized

`shell/icons.js` today renders `files.get().list` into the one root. It
becomes a reconciler over **roots**: the desktop field for the folder
`null`, plus one field per open folder window (from `folders.fieldFor`,
re-run on `folders.onChange`). One `sync()` walks every root: the items
whose `folder` is the root's — documents AND child folders — get an icon
there, an icon whose item moved away is removed (and re-created in its new
root if that root is on screen), the art, label, open ghost and rename
wiring shared across both kinds (`makeIcon` already takes the key and
label; a `kind` decides the art — the generated front tile or the folder
file — the `color` flag and the `data-folder` marker). The document icons'
code is untouched but for the root parameter.

- **Default lattice per root.** The desktop keeps `iconDefault` (the
  left-edge column below the Tools band). A window gets a new pure
  `iconGridDefault(slot, innerWidth)` in `layout.js`: rows from the
  plane's origin — a 16 inset, 80 across, 72 down (the desktop's pitch;
  the kit's specimen uses 64) — wrapping at the window's inner width as it
  stands when the icon first renders (a saved position wins from then on).
  Both stay in system px, the icons' own unit; inside a window there is no
  boot clamp (the rails reach anything placed past the viewport).
- **Selection is one field per container, one selection per screen.** The
  kit clears a selection on any press outside an icon, across the whole
  document, so selecting in a folder window drops the desktop's — the
  Finder's one-selection-at-a-time, free. `readSelection` and the
  chrome-press bridge (kit ask #5: 0.7.0's outside listener still clears on
  a menu-bar press, verified — the bridge stays) query `vf-icon[data-key]`
  under the whole desktop element — a folder window's icons are light-DOM
  descendants of it — so `shell.iconSelection` names icons in any
  container, keys unique across the library. The desktop root's press
  still routes through `clearActive()`; a press in a folder window needs
  nothing — the window activates itself, and a panel active IS the Finder
  role.
- **Re-pin on resize** stays the desktop root's alone: a window's icons
  are in its coordinates and travel with it.
- **`?fresh=1`** renders no icon and no folder window (storage untouched,
  as today); the drive's `docIcons` filter (`doc:` keys) is unaffected by
  folder keys.

### 2.6 Filing: the drag

The gesture is the kit's, the meaning the page's — `docs/FINDER.md`'s
"Dragging and filing" section applied to this catalog, one listener each
on the desktop element for `vf-drag`, `vf-drag-cancel` and `vf-drop` (every
icon's events bubble and compose up to it, whichever container it sits in;
the outline draws on the desktop's own surface, so a folder window is
under it):

- **The hit test** — `under(clientX, clientY, icons)` in `icons.js`:
  `document.elementsFromPoint`, the travelling icons skipped (a follower
  can be under the pointer; the outline is never a hit), then the first
  `vf-icon[data-folder]` in the stack → that folder; the first `vf-window`
  that `folders.folderOf` knows → that folder window; else the desktop.
- **The highlight** — on every `vf-drag`, the folder icon under the pointer
  wears `target` (the kit's inversion with no selection semantics), the
  previous one cleared; `vf-drag-cancel` and the drop clear it. A folder
  never targets itself (it is among the travellers) — and a drop of a
  folder onto its own open window, or into a descendant's, is the cycle
  `files.moveFolder` refuses: the drop is cancelled and nothing moves (the
  Finder raised an alert here; silent in cut 1, §7).
- **The drop**, `preventDefault()` whenever the page files (the kit then
  writes nothing) — three destinations, each landing measured from the
  event's `x`/`y` (the leader's outline origin in viewport px) and every
  member's own box translated by the same delta, converted into the
  destination's own coordinates with its `placementAt()`:
  1. **onto a folder icon** (not one of the travellers): every member →
     `files.moveDoc` / `files.moveFolder` into it; its position key
     dropped, so the folder's lattice assigns the next free cells at the
     next render (the folder open or not);
  2. **into a folder window** the members did not come from: filed into
     that folder, each placed at `win.placementAt(landing)` on its plane,
     floored at the origin (a member let go partly past the plane's edge
     lands on it, not under it);
  3. **out onto the desktop** from a window (the stack holds no folder
     window, the members came from one): filed to the root, each at
     `desktop.placementAt(landing)`, floored at the icons' own frame — on
     the raster, below the menu bar, the boot clamp's arithmetic reused.
     Otherwise the drop is in the container the members came from and the
     kit's default action moves them — the group clamped whole in its
     container, the arrangement kept — with nothing for the page to write:
     positions are read off the elements at snapshot time as today, and the
     release's `pointerup` schedules the write.
- `file(icon, folder, at)` moves the icon in the DOM (or removes it, the
  destination root not being on screen) and the item in the model, in that
  order, and refreshes both windows' counts and the destination field's
  extent. Every selected icon travels (the kit reports the set as
  `detail.icons`, the dragged one first — a press on an unselected icon
  makes it the selection first), so shift-selected and banded siblings
  file together, the Finder's picture of it.

Nothing about the drag is drawn, measured or clamped by the page: the
outline, its dashes over the dither, the group's outlines, Escape, the
`target` treatment and the rails' re-measure are the kit's (0.7.0).

### 2.7 Menus and dialogs

- **File → New Folder**, after _New…_, no key equivalent (System 7's ⌘N is
  the browser's; ⇧⌘N opens an incognito window). It is a **Finder
  command**, so it brings the Finder forward first (`desktop.clearActive()`
  — the windoids hide, as a desktop press would) and creates in the
  **active folder window** if one holds the desktop's active state, else
  on the desktop (the Finder's rule), named by `nextFolderName`; once its
  icon renders, `setSelected(true)` and `icon.startEditing()` (the kit's
  public route) — the Finder's name-selected-for-typing; Return commits
  through `vf-change` → `files.renameFolder`, Escape keeps _untitled
  folder_. With storage unavailable it raises the storage notice, like
  Save.
- **File → Open / Open…** keeps its grammar. `openSelection` dispatches on
  the key: `doc:` opens the document, `folder:` opens the folder window.
  With a folder window active and an icon inside it selected, the item
  reads _Open_ and acts on that icon (a panel active is the Finder role,
  the gate already reads it). A double-click, ⌘O and ⌘↓ on a folder icon
  arrive as the kit's `vf-open` like a document's.
- **File → Close** closes the **active folder window** too — the Finder's
  Close closed the front Finder window: the item is live when a document
  window or a folder window is active (today it is document-scoped), and
  the handler dispatches on which.
- **Edit → Select All ⌘A**: every icon in the front field — the active
  folder window's, else the desktop's — through `setSelected(true)`, so
  `vf-select` reports it. Finder-role only (greyed with the application
  active, so ⌘A falls through to a focused field's own select-all); the
  README reserved ⌘A for exactly this. Small; cut 1 or the first
  follow-up, the user's call.
- **The Open dialog** keeps one row per document and shows a filed
  document's **path** in its row — `Vehicles ▸ Car — 120×80px, date` —
  nested folders joined with the same glyph; the desktop's rows read as
  today. (The first draft grouped rows under disabled caption rows — a
  disabled row is greyed, and a greyed line reads as a disabled document
  here; the prefix says the same thing in plain ink.) Folders themselves
  are not pickable there — the dialog opens documents; a folder opens from
  its icon.
- **Duplicate** lands beside the original (§2.1). **Rename…** stays the
  document's; a folder renames in place. **Properties…** unchanged. The
  View menu's window tail lists documents only — a folder window is the
  Finder's, and the Finder's windows come forward from their icons.

### 2.8 Persistence, boot, migration

- **IndexedDB v2** (§2.1). A v1 database upgrades in place: the `docs`
  store's records lack `folder`, which reads as the desktop — no data
  migration.
- **The blob** is v3 still: `icons` gains `folder:` keys and the merge
  rule; `migrateDesktopState` is untouched (its test too).
- **Boot**: `files.refresh()` lists both stores before the icons render;
  the seeding saves Car and Cube with no folder (the desktop); `?file=`
  resolves by name as today; the About greet, `?fresh`, `?sample`, the
  READY mark — unchanged. No folder window reopens at boot (§2.4).
- **A private window**: the folders store degrades with the docs store —
  _Save unavailable_, no icons, no folders; New Folder raises the storage
  notice like Save does.

### 2.9 What does not change

The document format (no chunk), Download and the drop-import round trip,
the URL mirror, the workspace and the editor, the windoids and their
placement, the windows' no-persisted-geometry principle, the seeding, the
Tools and View menus. Every window rule folder windows obey is the
Patterns panel's, already built; every gesture is the kit's.

## 3. Steps

Each lands green (`npm test`, `npm run typecheck`, `npm run lint`,
`node tools/drive.mjs`, `tools/goldens.sh check`) and shippable alone.

0. **The bump.** `vintage-frames` `^0.7.0` in `package.json`, `npm
install`; the gates re-run as they stand — the goldens boot `?fresh`
   with no icon on screen, so a pixel that moves is the bump's own
   re-bless class; the drive's S22 (the Finder selection) and S28 (the
   icon re-pin) are the two that touch `vf-icon`. `docs/kit-asks-icon-drag-drop.md`
   gets its SHIPPED note. (After a kit bump, check which port the dev
   server is on and that it serves the new kit — a long-running server
   keeps serving the old one.)
1. **The field.** `#desktop-icons` → `vf-icon-field fill-width
fill-height` (the rubber band and multi-select arrive with it); the
   press-test note in `windows.js`'s comment; the README's Desktop icons
   passage. Nothing else moves — the icons' coordinates are unchanged.
2. **The model.** `db.js` v2 + the folders store and surface;
   `helpers.mjs`'s stub; `files.js`'s `folders`, the row's `folder`, the
   six actions and three selectors; `save`/`duplicate` carrying `folder`.
   Unit tests in `files.test.mjs`: the folder ops over the stub, a saved
   record keeping its folder across a save and a rename, the cycle refusal,
   the untitled counting. (`workspace.duplicate` reads the original's
   folder off the listing.)
3. **The icon and New Folder.** `folder.png` into `src/assets/`;
   `icons.js` reconciling both kinds into the desktop root; `iconDefault`
   shared by both; folder rename in place; `shell.iconSelection` and the
   chrome-press bridge reading the whole desktop; `openSelection`
   dispatching on the key. New Folder in `index.html` + `menus.js`
   (desktop only until step 4), the Finder-forward + name-selected rename.
   The blob's merge rule.
4. **The window.** `#tpl-folder-window`; `shell/folders.js`; `folderBox`,
   `iconGridDefault`, `FOLDER_STRIP` in `layout.js` (+ layout tests pinning
   the lattice's wrap and the cascade's step, relationships not literals);
   `windows.js` untouched but for what `addPanel` already does; the roots
   in `icons.js`; the field's extent; the open ghost; New Folder's
   active-window rule; File → Close on a folder window; the header count;
   `main.js` wiring folders between windows and icons.
5. **Filing.** The three listeners on the desktop, `under`, `file`, the
   `target` highlight, the cycle refusal, the counts and extents — every
   direction at once. The drive journey (§6). SMOKE-TEST's drag items.
6. **Dialogs, Select All, docs.** The Open listing's paths; Duplicate
   beside the original; Edit → Select All; README's Documents / Desktop
   icons / Menu bar / Windows / Architecture passages; `index.html`'s
   comments.

## 4. Kit asks

**None open for this feature.** #13 (the outline drag with a cancelable
`vf-drop`, `target`, the selection travelling) and #14 (a window
re-measuring under a moved icon) shipped in 0.7.0 — see
[kit-asks-icon-drag-drop.md](kit-asks-icon-drag-drop.md). #5 (the icon
selection surviving a press on the application's chrome) is still open
and still bridged in `icons.js`; the bridge widens to every container with
no change in mechanism. #6 (a bare container's pattern leak) does not bite
here: the folder window's body is the kit's own white paper.

## 5. Decisions for the user

1. **No delete, and the Trash next.** Nothing deletes a document today
   (`files.remove` exists; no menu, no icon), and folders inherit that: a
   folder made by mistake is permanent in cut 1. The Finder's answer is the
   **Trash** — an icon at the bottom right, drag to it, Special → Empty
   Trash with a count in the question — and with the drag now the kit's it
   is a folder with a menu command: cheap. Recommendation: cut 1 without
   delete, the Trash as the first follow-up (§7). The alternative, a
   Finder-role _Delete_ command on the selection, is quicker and not
   System 7.
2. **Folder window geometry: not persisted.** The Finder remembered every
   folder window's box; the app's principle is that no window geometry
   survives a session. Recommendation: hold the principle — the icon
   positions inside persist, the box places fresh — and revisit if it
   grates.
3. **Nesting: on.** It is free in the model and the container abstraction;
   the only cost is the cycle check. Recommendation: on.
4. **Arrange Windows re-places folder windows.** As a panel, a folder
   window is part of `arranged()` and `arrange()` like the Patterns panel —
   a dragged folder window turns the ⌘J item to _arrange_ and Arrange sends
   it back to its cascade slot. Consistent; a purist would say the
   application's Arrange should leave the Finder's windows alone.
   Recommendation: consistent, unless it grates.
5. **Select All in cut 1 or after.** One handler and one menu item; ⌘A is
   reserved for it. Recommendation: in.
6. **The Open dialog's rows.** A path prefix (recommended) or the earlier
   draft's caption rows.

## 6. Tests, by the rules

- **Unit** (`files.test.mjs`, `layout.test.mjs`): the folder ops and
  selectors over the stub; a record's folder surviving save and rename;
  the cycle refusal; `iconGridDefault`'s wrap and `folderBox`'s step as
  relationships. Nothing per setter, nothing against a literal.
- **Drive**: one journey, the boundaries a unit cannot cross — New Folder
  (a `folder:` icon appears, its rename box open), a name typed and
  Returned (the icon and, once opened, the window's title carry it), the
  Car's icon dragged onto it with trusted input (the Car's record carries
  the folder; the folder window's field holds its icon; the header's
  count reads the field's), a reload (the IndexedDB round trip: the
  folder, the filing and the icon's position restore; File → Open lists
  the Car's row). No check per menu item, no copy asserted, no kit
  mechanics (the outline, the band, the rails, the drag's delta, the
  inversion).
- **Goldens**: none — folders need storage, and the goldens boot `?fresh`.
- **SMOKE-TEST**: the drag's feel (the outline over windows and the menu
  bar, the folder inverting under it, Escape putting it down), a rubber
  band on the desktop and in a window (Shift toggling), a banded group
  dragged as a set into a folder and landing in its arrangement, out of a
  window to the desktop, window to window, a folder into a folder and the
  refusal of a folder into itself, the open ghost on a folder's icon while
  its window is up, clicking a folder window hiding the windoids and its
  close box bringing them back.

## 7. Follow-ups, in the order they earn their place

- **The Trash** (§5.1): the icon, Special → Empty Trash, the question with
  its count; a folder emptied recursively; an open document whose file is
  trashed reverting to untitled (`workspace.removeStored` already does
  that half).
- **The Finder's two alerts** — _That name is too long_ and _A folder
  can't be put into itself_ — as `vf-dialog frame="plain"` boxes with the
  app's own 32×32 caution art (the kit ships no alert; `vf-name-too-long`
  and the refused move are the triggers). Silent in cut 1.
- **A _Where:_ popup in the Save prompt** — a `vf-select` of folders
  (_Desktop_ first), the Save dialog's directory popup; a first save then
  files directly. Cheap, and the one thing that makes filing not always a
  second gesture.
- **View → by Small Icon**: the field's `size` attribute is the whole
  mechanism (one attribute, written onto every icon), given a 16×16 folder
  (`ics#`, the user's art) and a 16px generated document icon in the
  `small` slot.
- **The zoom box** on folder windows: the Finder's zoom fit the window to
  its icons; `onZoom` in `windows.js` would learn a panel's zoom rule.
- **Clean Up** (Special → Clean Up Window): every icon in the front
  container back onto its lattice — `iconGridDefault` re-applied, the
  keys dropped.
- **A dropped PNG into a folder window** files the new document there at
  its first save; today a drop opens an untitled window and the folder is
  the desktop.

## 8. Files touched

`package.json` (the bump), `src/storage/db.js`, `src/state/files.js`,
`src/state/workspace.js` (duplicate), `src/shell/icons.js`,
`src/shell/folders.js` (new), `src/shell/layout.js`, `src/shell/menus.js`,
`src/shell/desktop-state.js`, `src/main.js`, `index.html` (the field, the
menu items, the template), `src/assets/folder.png`, `test/helpers.mjs`,
`test/files.test.mjs`, `test/layout.test.mjs`, `tools/drive.mjs`,
`docs/SMOKE-TEST.md`, `README.md`, and
`docs/kit-asks-icon-drag-drop.md` (the shipped note).
