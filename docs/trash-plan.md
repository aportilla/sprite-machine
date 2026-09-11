# Plan: the Trash — deleting documents and folders, the Finder's way

**Status:** proposed 2026-09-09, revised the same day on the user's
answers — drag-only deletion (§5.1), Empty Trash… in the Sprite Machine
menu for now (§5.2), the library hiding the Trash (§5.5), the Trash on
every desktop, `?fresh` captures included (§5.6), an open document
reverting dirty at Empty (§5.3) — and **BUILT the same day** as written,
steps 0–4; the as-built passage is README §The Trash. The same morning
the user added the Finder's **"in the Trash" mark** — a 12×12 glyph at
the head of the count line of the Trash's window and every trashed
folder's, the count stepping right — an addendum to §2.4, built with it.
The ask: _"i'd like to add a trash folder,
and the ability to delete files and folders, and to empty the trash"_ —
with two 32×32 icons prepared by the user (`~/Desktop/Trashcan.png`, the
empty can, and `~/Desktop/Trashcan Filled.png`, the full one). Both decode
as pure 1-bit art — black ink, white fill, transparent outside and nothing
else, the folder icon's three values: the empty can is 210 black, 406
white, 408 transparent, its ink in columns 5–26; the full one 206 black,
502 white, 316 transparent, in columns 3–28 — the can's belly bulging two
columns each side, System 7's own full-Trash reading. Rows 0–31 in both
(the lid's handle at the top, the base at the bottom). So the kit's
selection inversion, its `target` inversion and its open ghost are exact
treatments of either file, as they are of the folder's.

The short version: **the Trash is a folder** — the one folder that has no
record, cannot be renamed, moved or deleted, wears its own art (two arts:
empty and full, off its contents), sits at the bottom right by default,
and can be **emptied** from the Sprite Machine menu (Empty Trash…) behind
the Finder's alert.
Deleting IS filing into it — the drag the folders feature already ships
(onto its icon, into its open window), a document or a folder, one icon or
a banded set — and nothing is destroyed until Special → Empty Trash…, so
a trashed item comes back by dragging it out. The folders plan
([folders-plan.md](folders-plan.md) §5.1, §7) named this as the first
follow-up; the kit's `docs/FINDER.md` states the shape in one line: _"The
Trash is a folder icon whose window is the Trash's; Empty Trash is a menu
command over that folder's children."_ Almost everything below is that
sentence applied to this catalog; the new code is the model's rules, one
placement, a menu, an alert and the emptying.

Nothing in the kit is asked for (§4): the drag, the highlight, the ghost,
the window and the field are 0.7.x's, already in use.

## 1. What the Finder did (the model we copy)

- The Trash was an icon at the bottom right of the desktop, movable about
  the desktop but never into a folder, never renamed. Empty, it was a plain
  can; with anything in it, the can bulged.
- Dragging any icon onto it filed the item into it; the can inverted while
  the drag was over it. Double-clicking it opened the Trash's window, a
  folder window like any other — _N items_ in the header, icons in its
  body — and a trashed folder opened from there with its contents intact.
  Dragging an item out of the Trash (or File → Put Away ⌘Y) restored it.
- Special → Empty Trash… (greyed while the Trash was empty) raised the
  alert — _The Trash contains 3 items, which use 12K of disk space. Are you
  sure you want to permanently remove these items?_ — Cancel / OK, OK the
  default — and removed everything in it, folders recursively.
- The Trash survived a restart: it was a folder on the disk. Its window's
  box and its icons' positions were remembered like any folder's.
- A file in use could not be trashed (the application held it open), and
  with the Trash window front, New Folder was greyed. There was no Delete
  key and no Delete command: the drag was the whole grammar.

Everything above but Put Away (§7) and the "in use" refusal (§5.3, where
this app has a better answer) is in scope.

## 2. The design

### 2.1 The model: the Trash is a folder with no record

The catalog already has everything but the Trash itself: a document's
`folder` field, a folder's `parent`, `moveDoc` / `moveFolder`, the
`childrenOf` / `isInside` selectors, `files.remove` (a document — unused
by any UI today) and `removeFolder` (which lifts its children rather than
deleting them; its comment reserves the recursive emptying for "the
Trash's day"). What `state/files.js` gains:

- **`TRASH`**, the reserved folder id (`'trash'`), and a **synthetic
  folder row** — `{id: TRASH, name: 'Trash', parent: null, createdAt: 0,
modifiedAt: 0}` — that the store's initial state holds and
  every `refresh()` outcome keeps first in `folders`, ahead of the stored
  records — with a listing, without one, and under `?fresh`: the Trash is
  furniture, on the desktop whether or not there is a library. It is never
  written to storage: the desktop is the root and has no record, and the Trash is the
  root's one fixed child and has none either. Because it is in `folders`,
  every consumer sees a folder: `containerOf` resolves `'trash'` (so a
  document whose `folder` is `TRASH`, or a folder whose `parent` is, sits
  in it — `containerOf` would otherwise read an unknown id as the
  desktop), `childrenOf(state, null)` lists it among the desktop's
  folders (so the icon layer renders it), `folders.open(TRASH)` finds its
  row (so its window titles itself _Trash_ and counts its children),
  `isInside` walks through it, and the desktop-state keys are the folder
  keys, `folder:trash`. With storage unavailable the Trash is the one icon
  on the desktop: nothing can be dragged into it, and Empty Trash… stays
  grey.
- **Four refusals**, each a silent no-op resolving false / null, the
  slice's own rules: `renameFolder(TRASH)`, `moveFolder(TRASH, …)`,
  `removeFolder(TRASH)`, and `createFolder({parent: TRASH})` (the Finder
  greyed New Folder with the Trash front; the menu greys it here too, the
  slice refuses regardless). Filing INTO the Trash — `moveDoc(id, TRASH)`,
  `moveFolder(id, TRASH)` — needs no change: the cycle check already
  covers a folder over itself, and the Trash is never a traveller (§2.3).
- **`descendantsOf(state, folder)`** → `{docs, folders}`, the whole
  subtree — what an emptying removes and what the alert counts — and
  **`isTrashed(state, folder)`**: is a container the Trash or inside it
  (the Open listing's and `?file`'s filter, §2.7).
- **`emptyTrash()`**: every descendant document removed
  (`storage.remove`), every descendant folder removed
  (`storage.removeFolder`), one `refresh()` after, resolving the removed
  ids. The only destructive operation in the app, and the only path that
  deletes a record with children — records are independent, so the order
  does not matter. A failure lands on the build slice like every file op.
- **`size`** on the listing row: the record's PNG byte length, a
  rebuildable cache like `w` / `h`, read off the bytes `refresh()` already
  holds (`list()` returns whole records) — the alert's _12K of disk
  space_, and nothing else reads it. No record field, no schema change.

`state/workspace.js` gains **`emptyTrash()`** — `files.emptyTrash()`, then
every open context whose `fileId` was removed reverts to an **untitled
identity and reads dirty** (§2.6); `removeStored` (the single-document
primitive, unused today) takes the same dirty rule so the two paths agree.

### 2.2 The icon: two arts, one placement, no rename

`src/assets/trash.png` and `src/assets/trash-full.png` (the user's two
files, renamed by role, beside `folder.png`). The icon layer's reconciler
(`shell/icons.js`) renders the Trash into the desktop root as a third
`kind`, `'trash'`, off the synthetic row — the folder path with three
differences and one addition:

- **The art follows the contents**: `childrenOf(st, TRASH)` empty → the
  plain can, else the full one — re-read every sync, `setArt` swapping the
  `img` src only when it changed, so the can bulges the moment a drop's
  refresh lands and flattens on Empty. The `open` ghost (the Trash's
  window on screen) and the `target` inversion (a drag over it) are the
  kit's derivations from whichever art is slotted. One thing to eyeball
  on the first build: the ghost re-deriving when the art swaps UNDER
  `open` (a drop into the Trash's open window) — a document icon's art
  already swaps under `open` on every save, so the kit very likely
  follows; if it holds the stale can, that is kit ask #15 (§4).
- **Not `editable`** (the kit never opens the rename box; the slice
  refuses a rename regardless), `selectable movable` like every icon, no
  `color`, and **`data-folder="trash"`** — the kit's own recipe marks a
  trash icon exactly as a folder, so the drop's hit test (`under`) finds
  it with no change. `wireFolder` serves it (a double-click, ⌘O and ⌘↓
  open its window; its rename half never fires).
- **Its default place is the bottom right**: `trashDefault(desktopW,
desktopH)` in `shell/layout.js` — the icon column's own inset
  (`ICON_COL_X`, 16) in from the right and bottom edges of the raster, the
  64px cell inside — the one icon whose default is not the lattice's next
  free cell; a saved position wins, as for every icon, and the boot clamp
  pulls it on-raster. Across a browser resize it keeps its nine-slice pin
  in the icons' frame like the rest, and a corner icon is two struts, so
  it stays in the corner (README §Desktop icons already promises this).
  The other icons' `nextFree` sees its cell as taken. The number is
  authored in `layout.js` with its provenance; the eye adjusts it.
- **It is never filed**: `canFile` refuses any set that holds the Trash
  (the cycle refusal's own treatment — no highlight, the drop cancelled,
  nothing moves), so a banded selection that swept the Trash up cannot
  carry it into a folder or a window; a drop of it on the bare desktop is
  the kit's default move, allowed — System 7's Trash moved about the
  desktop.

### 2.3 Trashing: the drag, as shipped

Nothing new in the drop handler. Onto the Trash's icon → `file(entries,
TRASH)` → `moveDoc` / `moveFolder` into it, the icon re-created in the
Trash's window if that is on screen; into the Trash's open window from
elsewhere → the same, each member where its outline was let go; out of the
Trash's window onto the desktop or into a folder window → the existing
paths, which IS un-trashing. A folder goes in with its subtree — its
`parent` changes and nothing inside moves, the Finder's own — and its icon
inside the Trash's window opens its own folder window as before. A move is
catalog, not content: bytes, name and modified time stand, and the whole
thing is reversible until Empty. Under a drag the can wears `target`. No
Delete key and no Delete command (§5.1): the drag is the grammar.

### 2.4 The Trash window: a folder window

`folders.open(TRASH)` — the Finder's window from `#tpl-folder-window`,
titled _Trash_, the item count in its header, its body the lattice, its
box persisting as its pin under `folder:trash`, its icons' positions by
item — with no new code in `shell/folders.js`. Two menu readings change
around it: **New Folder greys while the Trash window is the Finder's
front window** (`folders.activeFolder() === TRASH`, in `syncGate` beside
Close), and nothing else — Close closes it, Select All selects in it,
Open on a selected icon inside opens it, a trashed folder's window opens
from it. The `sync` in `folders.js` that closes the window of a folder
that vanished is what closes a trashed folder's open window at Empty —
already there.

### 2.5 Empty Trash: the menu item, the alert, the emptying

- **Empty Trash…** in the **Sprite Machine menu**, after Desktop Patterns
  and before the rule over Quit — the user's call for now (2026-09-09):
  System 7 kept it in the Finder's Special menu, which here would hold
  one command; the day Clean Up joins it, a Special menu earns its place
  and both move there (§7). _Moved 2026-09-11: the menu bar is the front
  application's now ([apps-plan.md](apps-plan.md)), the Finder's bar its
  own, and the item is the Finder's **Special → Empty Trash…** — one
  item until Clean Up joins it._ The ellipsis is the app's grammar, System 7's
  promise of a box — the alert below. Live in both roles — a Finder
  command over the catalog, like New Folder, but it opens no window and
  selects nothing, so it changes no role — and **greyed while the Trash
  has no child** (the Finder's reading; `childrenOf(st, TRASH)` empty,
  re-read on the listing), which on a virgin profile is the markup's
  `disabled`. No key equivalent (System 7 gave it none).
- **The alert**, `#dlg-empty-trash` in the dialog set: the unsaved
  box's anatomy — `vf-dialog frame="plain"`, the question in the display
  face across the top, **Cancel** and **OK** at the bottom right, OK the
  default (Return, the kit's dialog grammar), Escape as Cancel — and the
  kit's alert recipe (its showcase's Erase Disk…) if the user draws a
  32×32 caution icon: a row stack with a `vf-img` at the left; none in
  cut 1, the unsaved box having none either (§5.8). `menus.js` writes the
  message at show, like the unsaved one: _The Trash contains N items,
  which use XK of disk space. Are you sure you want to permanently remove
  these items?_ (singular: _1 item, which uses … remove it?_) — N every
  descendant, documents and folders, what OK removes; X the trashed
  documents' bytes summed, rounded up to whole K. OK closes the box and
  runs `workspace.emptyTrash()`; the refresh then removes the icons in
  the Trash's window (the reconciler), reads _0 items_, flattens the can,
  closes any trashed folder's window, and greys the item. The `modalOpen`
  guard as every action.

### 2.6 Open documents and the Trash

- **Trashing an open document is allowed** — it is a move; the window
  stays, its title stays, Save saves in place (into the Trash), and its
  icon in the Trash's window wears the open ghost. System 7 refused a
  file in use because the application held it open; here a window holds
  pixels, not a lock, and the move is reversible by the drag out.
- **Emptying with an open document inside**: the context reverts to an
  untitled identity — `fileId` null, the name kept as the display name
  (a dropped PNG's Title, the same state) — **and reads dirty**: the
  window's copy is the only one now, so Close asks _Save changes to
  "Car" before closing?_ and `beforeunload` guards it; Yes prompts for a
  name (prefilled) and stores it afresh. The URL mirror clears (an
  untitled clears it); the View menu's tail keeps the name. Without the
  dirty rule a Close would drop the last copy without a question (§5.3).
- A trashed folder with its window open keeps it open until Empty.

### 2.7 Persistence, boot, `?fresh`

- **No storage change**: no DB version bump, no new record field —
  `folder: 'trash'` is an id like any other, and reads in the Trash for
  as long as the synthetic row exists, which is every listing. A trashed
  item survives a reload, as the Finder's Trash survived a restart.
- **No blob change**: `icons['folder:trash']`, `windows['folder:trash']`,
  v3 still. An emptied item's position and pin stay in the blob as orphan
  keys, harmless — the blob already carries retired `sample:*` entries
  the same way.
- **Boot**: nothing to seed — the Trash exists the moment the listing
  does. The seeding's flag is untouched: trashing and emptying Car or
  Cube never resurrects them (README §Desktop icons, already so).
- **The library excludes the Trash**: the Open dialog lists no trashed
  document and `?file=` resolves none (`isTrashed`) — the Finder's Trash
  folder was invisible to Standard File; the way to a trashed document is
  its icon in the Trash's window (§5.5 has the zero-code alternative).
  Duplicate on a trashed open document lands beside it, in the Trash
  (the rule: beside the original); a first Save lands on the desktop.
- **`?fresh=1`** renders the Trash and nothing else: the icon layer runs
  under it now (today it is skipped wholesale), over a listing that holds
  the synthetic row alone — no storage is read, so a capture is the same
  on every machine, and the persistence stays off. The can sits in the
  corner of every capture from then on, so the **eight goldens re-bless
  once** in the shipping commit, after an eye on each diff (the atlas
  strip may cover the corner in its shot; a window over an icon is the
  desktop's stacking).

### 2.8 What does not change

The document format, IndexedDB's schema, the desktop-state blob's
version, the drag and drop machinery, `shell/folders.js`,
`shell/windows.js`, the windoids and their placement, the seeding, the
File, Edit, Tools and View menus.

## 3. Steps

Each lands green (`npm test`, `npm run typecheck`, `npm run lint`,
`node tools/drive.mjs`, `tools/goldens.sh check`) and shippable alone.

0. **The art.** `Trashcan.png` → `src/assets/trash.png`, `Trashcan
Filled.png` → `src/assets/trash-full.png`. Purity checked (above): both
   pure 1-bit, three values, 32×32.
1. **The model.** `files.js`: `TRASH`, the synthetic row in `refresh()`,
   the four refusals, `descendantsOf`, `isTrashed`, `emptyTrash`, the
   row's `size`. `workspace.js`: `emptyTrash`, `removeStored`'s dirty
   rule. `test/files.test.mjs`: one test on the Trash's rules over the
   stub (the row present without a record, the refusals, an emptying that
   removes a trashed document and a trashed folder with its nested child
   and leaves the rest — a contract); `test/workspace.test.mjs`: the
   existing `removeStored` test gains _and marks it dirty_, and
   `emptyTrash` reverting every context holding a removed file.
2. **The icon.** `layout.js` `trashDefault`; `icons.js` the `'trash'`
   kind (the art off the contents, no `editable`, `data-folder`, the
   placement, the `canFile` refusal, the layer running under `?fresh`).
   Nothing else: the drop, the window, Open on the selection and the
   persistence keys are the folder's. The user eyeballs the corner, the
   can bulging on a drop and flattening on Empty, the inversion under a
   drag, the ghost with its window up (and after a drop into that
   window, §2.2). The eight goldens re-bless in this step's commit — the
   can in the corner of each, the one thing that moved.
3. **Empty Trash.** `index.html`: the Empty Trash… item and the alert;
   `menus.js`: the select handler, the message, the two gates (Empty
   Trash… off the listing, New Folder off the Finder's front window), OK →
   `workspace.emptyTrash()`; `main.js` and the Open dialog: the
   `isTrashed` filters. The user eyeballs the menu and the alert.
4. **Journeys and docs.** The drive's S31 (§6) and S30's one adjustment;
   SMOKE-TEST's one item (and its header's count); README — the Trash's
   own passage after §Folders, §Folders' _Not yet_ bullet and its
   `?fresh` sentence rewritten, the item in §Menu bar's Sprite Machine
   bullet, a line under §Desktop icons & state, the `?fresh` hook's
   description under the dev hooks,
   the Architecture list (`files.js`, `icons.js`, `layout.js`,
   `menus.js`, `assets/`); `docs/folders-plan.md` §5.1 and §7 marked
   built, pointing here.

## 4. Kit asks

**None expected.** The drag, the cancelable drop, `target`, the open
ghost, `vf-icon-field` and `placementAt` are 0.7.0's (kit asks #13–#14,
shipped); a non-`editable` icon is the kit's own attribute. The one thing
to verify by eye rather than assume: the
`open` ghost re-deriving after the slotted art's `src` changes under it
(§2.2). If it does not, ask #15 is that sentence; nothing here would
bridge it — the can would show the stale art in its ghost until the window
closed, a blemish, not a fault.

## 5. Decisions for the user

1. **The drag is the only way to trash.** System 7 had no Delete key and
   no Delete command (⌘Delete is Mac OS 8's). The alternative — a
   Finder-role File → Move to Trash on the selection — is one handler and
   quicker with the keyboard, and not System 7. **Decided 2026-09-09: the
   drag alone.**
2. **Where Empty Trash… lives.** The Finder's Special menu would hold one
   command here; the File menu never had it. **Decided 2026-09-09: the
   Sprite Machine menu, for now** (§2.5) — a Special menu the day Clean
   Up gives it a second item (§7). _Superseded 2026-09-11: with the bar the
   front application's ([apps-plan.md](apps-plan.md) §6.4), the Finder's
   Special menu holds it, one item._
3. **An open document's fate at Empty** — the case where a document is
   trashed while its window is open, and the Trash is then emptied. The
   window keeps its pixels either way; the stored file behind it is gone.
   Three readings: (a) the window **reverts to an unsaved document and
   reads dirty** — "reverts" because no file backs it any more (the state
   a dropped PNG opens in, its title kept), "dirty" because the app marks
   it as having unsaved changes although nothing was drawn: the window's
   copy is now the only one, so Close asks _Save changes to "Car" before
   closing?_ and a reload warns (§2.6); (b) revert and stay **clean** —
   the window believes it was saved a moment ago, so Close drops the last
   copy without a question; (c) the Finder's — **refuse to empty** while
   a trashed item has a window open, with the alert _The Trash could not
   be emptied because it contains an item that is in use_, the most
   faithful, and one more alert to build. Recommendation: (a). **Open.**
4. **The K figure in the alert.** _which use 12K of disk space_ costs one
   cached number on the listing row (§2.1) and is the Finder's sentence.
   Recommendation: in.
5. **The Open dialog and `?file` exclude the Trash** (§2.7; two
   `isTrashed` filters) — or list trashed rows with the path prefix
   already built, _Trash ▸ Car — …_, for zero code. The Finder's Trash
   folder was invisible to Standard File. **Decided 2026-09-09: exclude.**
6. **The Trash under `?fresh`.** `?fresh=1` is the capture hook that
   boots with storage ignored (no saved documents, no icons, no seeding,
   no state written — the eight goldens boot so, to be byte-identical on
   any machine). The first draft kept it bare and the goldens untouched;
   the user's reading is that the Trash is always on the desktop.
   **Decided 2026-09-09: always on the desktop, `?fresh` included** —
   the layer runs under `?fresh` over the synthetic row alone, and the
   eight goldens re-bless once (§2.7, §6).
7. **New Folder greyed with the Trash front** (§2.4): System 7's, one
   line in the gate plus the slice's refusal. Recommendation: in.
8. **The caution icon.** The alert opens without one (the unsaved box's
   idiom). If the user draws a 32×32 1-bit caution mark, both boxes take
   it through the kit's alert recipe — the same day or later.
9. **Put Away ⌘Y** (§7): the Finder's way back needs the record to
   remember where a trashed item came from (`trashedFrom`, stamped by the
   move into the Trash, cleared by the move out) and a File item live on
   a selected trashed icon. Cheap, and not asked. Recommendation: the
   first follow-up.

## 6. Tests, by the rules

[TESTING.md](TESTING.md): new pure logic earns a unit test on its
contract; new browser-only wiring no journey crosses earns at most one
drive check, on the outcome; the look is the eye's; copy, markup, numbers
and kit attributes earn nothing.

- **Unit** (`files.test.mjs`, `workspace.test.mjs`): the Trash is listed
  without a record and refuses rename, move, remove and New Folder inside
  it; `emptyTrash` removes the subtree — a trashed document, a trashed
  folder, a document nested in it — and nothing else; a context holding
  an emptied file reverts to untitled and dirty. Not the art, not
  `trashDefault`'s number (one subtraction; the layout tests pin rules),
  not the menu, not the message.
- **Drive**: one journey, S31 — the plain boot's seeded desktop (S30's
  own), the Car's icon dragged onto the Trash's with the folder journey's
  drag helper (the icon by its label), Sprite Machine → Empty Trash…
  picked and OK'd, then a reload: **one check** — the Car is gone from the desktop,
  from the Trash's window and from the Open listing, and the seeding did
  not bring it back. The filing itself is S30's wiring (a folder icon is
  a folder icon), so no check on it; the open-document revert is the unit
  test's. S30's first check counts the desktop's `data-folder` icons and
  expects one — the Trash is one now, so it reads the named folder's
  icon alone (an adjustment, not a check). `bareSpot` skips every icon,
  so the corner needs nothing.
- **Goldens**: no new shot and no assertion — the eight existing ones
  re-bless once, in the shipping commit, the can in the corner of each
  (§5.6): a change to the look, verified by an eye on each diff, the
  policy's own rule for it.
- **SMOKE-TEST**: one item under Folders — _drag the Car onto the Trash:
  the can inverts under the outline and bulges once the Car lands; open
  it — the Car inside, its icon ghosted if its window is up; Sprite
  Machine → Empty Trash… names one item and its K; OK empties the window,
  flattens the can, and the Car's open window now asks to save on Close._

## 7. Follow-ups, in the order they earn their place

- **Put Away ⌘Y** (§5.9): `trashedFrom` on the record, File → Put Away
  live on a selected trashed icon (and on a desktop icon that came from a
  folder, the Finder's other use).
- **The "in use" refusal** (§5.3c), should the untitled-and-dirty reading
  grate.
- **The caution icon** (§5.8) for this alert and the unsaved one.
- **Clean Up Window / Clean Up Desktop** (folders plan §7) — into the
  Finder's **Special menu**, which arrived 2026-09-11 with the
  applications ([apps-plan.md](apps-plan.md)) holding Empty Trash… alone
  (§5.2).
- Never: Eject Disk, Erase Disk, Restart, Shut Down — no disks here, and
  Quit is the cascade.

## 8. Files touched

`src/assets/trash.png` and `src/assets/trash-full.png` (new),
`src/state/files.js`, `src/state/workspace.js`, `src/shell/layout.js`,
`src/shell/icons.js`, `src/shell/menus.js`, `src/main.js` (the `?file`
filter, §5.5), `index.html` (the Empty Trash… item, the alert),
`test/files.test.mjs`, `test/workspace.test.mjs`, `tools/drive.mjs`,
`docs/goldens/*.png` (the eight, re-blessed), `docs/SMOKE-TEST.md`,
`README.md`, `docs/folders-plan.md` (the built note).
