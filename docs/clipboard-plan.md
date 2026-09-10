# Plan: Copy and Paste — files and folders in the Finder, PNGs across the system clipboard

**Status:** proposed 2026-09-10, on two asks in one session: _"can we use
cmd-c and cmd-v to do proper copy and paste of document files and folders
when interacting with our finder windows and desktop view?"_ and, on the
first answer, _"we do want system clipboard btw - so the user can copy a
png in or out. although on paste IN - we'll want to validate whether it's
a valid sprite machine format and throw up an alert dialog and reject the
paste."_ **Built 2026-09-10**, steps 1–4 in one cut, on §5's
recommendations where the user had not decided (the system's truth,
§5.2; the shape rule in the app's `lib/` and the drop unchanged, §5.3;
`copyName` for Duplicate, §5.4; the rename box, §5.5; Select All in,
§5.6; no application-role copy, §5.7; silent failures, §5.8). README
§Folders is the as-built. Pending the user's eye: Safari's write after the
blink (§2.7), the Chrome permission prompt, the alert's copy.

The short version: **Edit → Copy ⌘C and Paste ⌘V, live in the Finder
role.** Copy takes the selected icons — documents and folders, in any
container — and puts them on the clipboard; Paste lands copies in the
Finder's front folder window, else on the desktop, each at its next free
cell, the pasted icons selected. **The system clipboard is the truth of
what is current**, and it carries what it can: a copied document goes out
as its PNG (so another application pastes the sprite sheet), any copy goes
out as its names as text (what the Mac's Finder pastes into a text editor),
and a PNG copied anywhere else comes in as a new document — **if it is a
sprite sheet**: a 3×2 atlas of square tiles, 1–64 px a tile. Anything else
raises an alert and nothing lands. The rich payload the system clipboard
cannot carry — a folder with its subtree, a set of several icons, a
document's bytes with its chunks intact — rides an in-app clipboard keyed
to what was written, so a paste after a copy elsewhere pastes the
elsewhere. Neither Cut nor Clear: the Finder had no Cut of files, and the
selection tool's own Cut/Copy/Paste over pixels
([selection-tool-plan.md](selection-tool-plan.md) §follow-ups) takes the
same two items in the application role the day it lands — one Edit menu,
the forward role's command under one label, System 7's own model.

Nothing in the kit is asked for (§4). The one snag — a live key equivalent
does not know a text field has focus — the page answers from the focus
events' own composed path, the idiom `src/shortcuts.js` already uses.

## 1. What the Finder did (the model we copy)

- **System 7's Finder never copied a file with ⌘C/⌘V.** Its Edit menu
  held Undo, Cut, Copy, Paste, Clear, Select All — and Cut/Copy/Paste acted
  on the icon name being typed, TextEdit's own. A file was copied by
  Duplicate ⌘D (beside the original, _«name» copy_), by dragging it to
  another disk, or by Option-dragging it. Select All selected the front
  window's icons. The Clipboard was one, system-wide, and Show Clipboard
  let you look at it.
- **Mac OS X's Finder** is the model here: Copy on a selection, Paste into
  the front window or the desktop, the copies landing at free cells,
  selected, _«name» copy_ when the paste lands beside the original, the
  name as is anywhere else; a folder copied whole with its contents;
  pasting into a text editor pastes the file names. No Cut (until much
  later, and never as the Mac's own grammar).
- **MacPaint's Copy** put a picture on the Clipboard, and any application
  could paste it. A picture copied in one program and pasted into the
  Finder made nothing — the Finder took files, not pictures. This plan
  departs there, on the user's ask: a picture pasted into this Finder
  becomes a file, because the picture IS the file format (README
  §Documents: a document is exactly one PNG).

This machine's own grammar, already: ⌃N / ⌃W / ⌃Q where the browser owns
the ⌘ chord (README §Menu bar). ⌘C, ⌘V and ⌘X reach the page — the browser
takes none of them before a keydown — and Ctrl stands in off the Mac (the
kit's rule), where Ctrl+C/V are the page's too. So the keys are ours.

## 2. The design

### 2.1 The Edit menu: two roles, one label

`index.html`'s Edit menu becomes System 7's order: Undo ⌘Z, Redo ⇧⌘Z, a
rule, **Copy ⌘C**, **Paste ⌘V**, a rule, Pick Color… ⌘K, Tile Size….
(Select All ⌘A beside them if §5.6 says so; no Cut, no Clear.) Both new
items are **Finder-role commands**: live while a document window is _not_
the desktop's active window (`!shell.appActive` — the desktop, a folder
window or the Desktop Patterns panel front) and greyed in the application
role, where the same two labels wait for the selection tool's pixel
clipboard. A greyed item claims no key (the kit's contract), so in the
application role ⌘C/⌘V fall through to the browser as they do today —
nothing changes on the canvas, and a document window's text field keeps
its native copy and paste. The finer gate is §2.6.

### 2.2 One clipboard, two payloads

The Mac had one Clipboard. So does this app, and it is the **system's**:
what Paste does is decided by reading the system clipboard at the pick,
never by remembering what the app last copied. Two consequences drive the
design:

- **What the system clipboard can carry is limited.** The Async Clipboard
  API writes one item with a few well-known types — `image/png`,
  `text/plain`, `text/html` — and Chrome documents that it **sanitizes
  images**: a PNG is decoded and re-encoded on the way in and on the way
  out, so a document's text chunks (Title, ring, transforms) do not
  survive the trip, and a folder or a set of files has no representation
  at all. Assume every browser strips the chunks.
- **So the rich payload rides beside it, in the app**: a `clipboard` slice
  (`src/state/clipboard.js`, pure, the store's shape) holding the copied
  **items** — `{kind: 'doc'|'folder', id}[]`, references into the catalog,
  never bytes — and the **text** the app wrote to the system clipboard for
  them. At paste, the system clipboard is read; **if its text is the text
  the slice wrote, the slice's items are what is current** and they paste
  from the store, chunks and subtrees intact; if instead it holds an image
  the app did not write, that image is the paste (§2.5); anything else is
  nothing to paste. The slice is session-only, never persisted, and a
  reference to an item that has since been emptied from the Trash simply
  skips — the Finder's own reading of a stale Clipboard.

The pure rule `pasteSource(slice, system)` → `'items' | 'image' | 'none'`
is the slice's one selector and its one test (§6): the slice's text
matching the system's text wins; else an image wins; else none. Where the
system clipboard cannot be read at all (§2.7) the slice's items are
trusted as they stand — the in-app half never depends on the system half.

### 2.3 Copy

Edit → Copy, or ⌘C, in the Finder role with at least one icon selected:

- **The set** is every selected icon on the screen — the kit holds one
  selection across containers (`shell/icons.js` header: "one per screen")
  — read live off the DOM the way the layer already reads it
  (`allIcons().filter(icon => icon.selected)`), mapped to the layer's keys
  (`doc:<id>` / `folder:<id>`). **The Trash is never copied**: it is
  furniture, and a set that swept it up copies the rest (the `canFile`
  reading, applied to a copy). A trashed item copies fine — the Mac lets
  you copy out of the Trash. The icon layer exposes `selection()` for
  this: the keys, in the layer's order (folders first, then documents,
  the reconciler's own).
- **The slice records** `{items, text}`; the selection stays lit (Copy
  never clears a selection).
- **The system clipboard gets one item** with two representations:
  `text/plain` — the copied names, one per line, in the set's order (what
  the Mac's Finder gives a text editor; also the token of §2.2) — and,
  **when the set is exactly one document**, `image/png` — its **stored
  bytes** (the record's `png`; the Finder copies the file on disk, so an
  open window's unsaved strokes do not travel — Duplicate ⌘D remains the
  window's copy). A folder, or several items, go out as their names
  alone. Written through `navigator.clipboard.write([new
ClipboardItem({...})])`; the write's failure is silent (§2.7): the
  in-app copy has already happened, and nothing outside this page can be
  told otherwise.
- A copy **from the application role** — a document window active — is
  not this feature's: Copy is greyed there until the selection tool's
  Copy exists (§7).

### 2.4 Paste of files and folders

Edit → Paste, or ⌘V, in the Finder role, when the read of §2.2 says the
slice's items are current:

- **Where**: the Finder's front folder window (`folders.activeFolder()`),
  else the desktop — New Folder's rule. **Refused for the Trash** or a
  folder inside it (`isTrashed`): a paste into the Trash is a delete by
  copy, nonsense; the item is greyed there (§2.6) and the slice refuses
  regardless, the New Folder discipline.
- **The model** — two new actions on `state/files.js`, the catalog's own
  business, Node-tested:
  - **`copyDoc(id, {folder, name})`** → `{id, name}` | null. Reads the
    record, mints a new id and a fresh `createdAt` / `modifiedAt`, splices
    a new `Title` and `Creation Time` into the bytes (`setTextChunks`,
    `renameById`'s own shape — a copy is a new file, and the chunk wins
    over the record on any disagreement, so the chunk must say so), keeps
    the icon cache, `w`/`h` and `size`, stores it under `folder`, one
    `refresh()`. No doc instance, no decode, no re-encode: the bytes are
    the document.
  - **`copyFolder(id, {parent, name})`** → `{id, name}` | null. Walks the
    subtree (`descendantsOf`, a **snapshot taken before anything is
    written**, so a folder pasted into itself is well-defined: a copy of
    it lands inside it, the Mac's own behavior), creates the folder
    records top-down mapping old ids to new, copies every document into
    its new parent with **its name unchanged** — only the top-level pasted
    item is ever renamed — one `refresh()` at the end. Refused (null) for
    the Trash as the source (never copied) or a trashed target.
  - **`copyName(state, folder, name)`**, a pure selector: the name the
    paste gives an item landing in `folder`. **`«name» copy`** when an
    item of that name already sits there (the original beside it), and
    `«name» copy 2`, `… copy 3` while those are taken too — the Mac's
    counting; the name **as is** when nothing there holds it. Applies to
    documents and folders alike, over the container's documents or its
    folders respectively. **Duplicate ⌘D adopts it** (§5.4): today
    `workspace.duplicate` writes `«name» copy` unconditionally, so a
    second Duplicate of the Car makes a second _Car copy_; one rule for
    both is the point.
- **The wire** (`shell/menus.js`, the `'paste'` case): for each item in
  the slice's order, the copy action for its kind into the target with
  `copyName`'s name; a reference whose record is gone skips silently. The
  new records land in the listing, the reconciler renders their icons in
  the target's root, and — with no saved position, no pending landing and
  nothing remembered for a fresh key — each takes **the container's next
  free cell** (`makeIcon`'s fallback), exactly where a New Folder lands.
  Nothing to write in the icon layer for placement. Then the layer
  **selects the pasted icons** (a new `select(keys)`: `setSelected(true)`
  on each, the rest cleared — the kit's public route, so `vf-select`
  reports it), the Finder's reading of a paste; a paste into a window
  scrolls nothing. Storage unavailable raises the Save notice
  (`dlgStorage`), as New Folder does; a failure lands on the build slice
  like every file op.
- **Not undoable.** Nothing in the Finder is; the Trash is its undo, and
  a pasted copy drags there like anything.
- An **open document's icon** pastes its stored bytes (§2.3). The copy is
  a closed file; nothing opens.

### 2.5 Paste of a PNG from outside

The user's second ask. When the read of §2.2 finds an image the app did
not write — pixels copied in an image editor, a browser's _Copy Image_,
anything that lands `image/png` on the clipboard:

- **Validate first, before anything is written**: the bytes decode
  (`bytesToImageData`, the drop's decoder) and the sheet's **shape** is
  checked against the document format — **`W = 3·t`, `H = 2·t`, `t` an
  integer from `TILE_MIN` (1) to `TILE_MAX` (64)** — a 3×2 atlas of square
  tiles, the shape every editor-authored document has (README §Tile size:
  "tiles are locked square") and the only registering one. A pure
  `sheetShape(width, height)` → `{tile}` | `{reason}` in `src/lib/`
  (§5.3 weighs the engine as its home). This is **stricter than the
  drop**, deliberately: `validateSheet` (the engine's `atlas.js`) checks
  only that a buffer is well-formed, and `deriveTileSize` divides whatever
  it gets, so a dropped 640×480 photo opens today as a sheet of
  213⅓×240 "tiles" and the pipeline warns; a paste is a file landing in
  the catalog, and the catalog takes documents. (Whether the drop should
  take the same rule is §5.3.)
- **Rejected**: the **alert** — `#dlg-paste`, the Empty Trash box's
  anatomy (`vf-dialog frame="plain"`, the message in the display face
  across the top, one **OK** group placed by its bottom-right corner, OK
  the default, Escape as OK — the About box's one-button shape; no icon,
  the caution mark being the trash plan's open follow-up, §5.8 there) —
  its message written at show: _The clipboard image isn't a sprite sheet:
  a sheet is a 3 × 2 atlas of square tiles, from 3 × 2 to 192 × 128
  pixels. This image is 640 × 480._ Copy by eye. Nothing lands, nothing
  is written, the selection stands. An image that will not decode at all
  raises the same box with its first sentence alone.
- **Accepted**: a **new document in the front container** (the desktop
  or the front folder window, §2.4's rule, the Trash refused), stored
  through the seeding's own path — `createDoc()` + `loadAtlas(image,
transforms)` + `files.save(doc, {name, folder, ring})` — so the bytes
  are normalized to the document format (8-bit RGBA, the chunks written
  fresh) whatever the source PNG was. The chunks are read first exactly
  as `loadFile` reads a dropped file's: a surviving `Title` names it, a
  `sprite-machine:transforms` chunk reorients it, a `sprite-machine:ring`
  chunk sets its ring — best effort, since the browser has very likely
  stripped them. With no Title the name is **`untitled`**, counted over
  the container's documents (`nextDocName(state, folder)`, the twin of
  `nextFolderName`), and the icon lands selected with **its rename box
  open** — New Folder's name-selected-for-typing, the one Finder idiom
  for an arrival that needs a name (§5.5). No window opens: a paste is
  "file this", a drop is "open this" (the drop stays as it is).
- **The routes.** ⌘V and the menu pick are **one path**: the Paste item
  claims the key (the kit's contract), its handler reads the clipboard
  through `navigator.clipboard.read()` and dispatches on `pasteSource`.
  A second, cheaper route joins it: a **`paste` event** listener on the
  document — the browser's own Edit → Paste from its menu bar fires it
  with no keydown, and it is the **only route that carries a copied
  file** (a `.png` copied in the Mac's Finder arrives as
  `clipboardData.files`, which `read()` never exposes). Same validate,
  same alert, same file; ignored in the application role and whenever a
  text control has focus (the field's own paste). A copied _file_
  pressed in with ⌘V does not arrive — the claimed key never fires the
  event — and the drop is the way for files; §2.7 says so plainly.

### 2.6 The gate

`syncGate`'s two new readings, re-run on every trigger the gate already
has plus the ones named:

- **Copy** is live ⇔ the Finder role, **and at least one selected icon
  that is not the Trash** (the layer's `selection()`, re-read on the
  desktop's `vf-select` — bubbling, composed — and on every activation
  change, since the activation clears the selection), **and no text
  control has focus**.
- **Paste** is live ⇔ the Finder role, **and the front container accepts
  a paste** (not the Trash, not inside it — `isTrashed(files.get(),
folders.activeFolder())`, New Folder's reading), **and no text control
  has focus**. Not "and the clipboard holds something": the system
  clipboard cannot be read without a pick (§2.7), so Paste is live
  whenever the Finder can take one and what it pastes is decided at the
  pick — a ⌘V with nothing to paste does nothing, silently.
- **The text-focus reading** is the snag and its answer. The kit's key
  equivalents (`vf-menu-item.ts` `#onDocKeydown`) check `defaultPrevented`,
  `disabled`, the grant and the match — never where the stroke landed —
  so an enabled Copy would claim ⌘C typed into an icon's **rename box**
  (the icon is selected while it renames, so the item would be live) or
  into a dialog's field, and the field's native copy or paste would be
  lost. The kit reports nothing about a rename in progress (`_editing` is
  private, no event, no state), and the page does not reach into shadow
  roots. But **focus events are composed**: a `focusin` / `focusout` pair
  on the document reads `e.composedPath()[0]` — the `<input>` inside the
  kit's shadow root, or whatever took focus — and the gate greys both
  items while the innermost focused element is an `INPUT` or `TEXTAREA`.
  That is `src/shortcuts.js`'s exact idiom for the tool keys ("the kit's
  fields host their `<input>` in shadow DOM, so check the COMPOSED path's
  innermost target"), stated once and covering every field: the rename
  box, the New box's Name, the tile stepper, the export forms. Greyed,
  the items claim nothing and the field keeps its keys — the same
  mechanism that hands ⌘Z to a field when Undo is grey.
- **Under a modal** the handler's `modalOpen()` guard returns early as
  every action's does; with the focus reading above, a modal's field is
  already covered, and a modal without one (the alerts) swallows a stray
  ⌘V harmlessly, as ⌘S is swallowed today.

### 2.7 Browsers and their clipboard rules

What the page can and cannot do, so nothing here is a surprise on the
first build:

- **Secure context.** `navigator.clipboard` exists on https and on
  localhost — GitHub Pages and `npm run dev` — and not over plain http on
  a LAN address. Absent, the system half is **silently off**: Copy still
  copies in-app, Paste pastes the slice's items, and a PNG can neither
  come nor go. `ClipboardItem` missing (an old browser) reads the same.
- **Writing** needs a user gesture, and browsers grant one for a window
  after a keydown or a click — five seconds in Chrome and Firefox. The
  kit's menu blink runs the handler a few hundred milliseconds after the
  stroke, inside that. **Safari** has been stricter about clipboard calls
  outside the gesture's own task; the first build **verifies Safari by
  eye**, and if it refuses, the fallback is the silent one above (the
  in-app copy stands) and a kit ask for an unblinked activation is the
  question to write then — not a page-side bridge.
- **Reading** is permission-gated, by the browser's own UI, once: Chrome
  asks _see text and images copied to the clipboard_ the first time and
  remembers; Safari and Firefox read silently what the page itself wrote
  and show a **Paste** button near the pointer for content copied
  elsewhere, one click. Denied or dismissed, `read()` rejects, and the
  paste **falls back to the slice's items as they stand** (§2.2) — so an
  in-app paste never depends on a permission. A single `read()` per
  paste; nothing polls the clipboard and nothing reads it at a copy.
- **Sanitizing.** Chrome re-encodes PNGs through the clipboard both ways;
  every image that comes in is treated as chunkless and every PNG that
  goes out may return chunkless. The design depends on neither surviving
  (§2.2, §2.5). Chrome 104+ also offers **web custom formats** (`web
application/x-sprite-machine`), a raw, unsanitized representation — the
  lossless round trip for Chrome-family browsers, a follow-up (§7).
- **What `read()` returns** is the well-known types only — `image/png`,
  `text/plain`, `text/html` — and never a copied **file**: a `.png`
  copied in the Mac's Finder reaches the page only through a `paste`
  event's `clipboardData.files`, which the claimed ⌘V never fires
  (§2.5). Pixels copied in an editor, a browser's Copy Image, a
  screenshot on the clipboard all arrive as `image/png`; a copied file
  comes in by the drop, or by the browser's own Edit → Paste. Stated in
  the README, since it will be asked.

### 2.8 What does not change

The document format and its chunks, IndexedDB's schema, the desktop-state
blob, the drag and drop filing, the drop import and its leniency (unless
§5.3), the windows, the windoids, Duplicate's placement beside the
original (its naming, §5.4), the Trash's rules, the File / Tools / View
menus, the engine (unless §5.3).

## 3. Steps

Each lands green (`npm test`, `npm run lint`, `npm run typecheck`, `npm run
build`) and shippable alone.

1. **The model.** `files.js`: `copyDoc`, `copyFolder`, `copyName`,
   `nextDocName`; `workspace.duplicate` on `copyName` (§5.4).
   `test/files.test.mjs`: the copy contracts (§6). `src/lib/sheet-shape.js`
   and its test. `src/state/clipboard.js` and `pasteSource`, one test.
2. **The menu, in-app.** `index.html`: Copy and Paste, the rules, the
   comments; `menus.js`: the two cases over the slice alone (no system
   clipboard yet), the gate's three readings, the focus pair;
   `icons.js`: `selection()`, `select(keys)`. The user eyeballs: Copy grey
   with nothing selected and with a rename box open; ⌘C then ⌘V into a
   folder window — the copies at free cells, selected, _Car copy_ beside
   the Car and _Car_ in an empty folder; a folder with its contents; a
   paste refused in the Trash's window; a second Duplicate of the Car
   reading _Car copy 2_.
3. **The system clipboard.** `menus.js`: the write at Copy (names, and
   the PNG for one document), the `read()` at Paste over `pasteSource`,
   the `paste` event route, the validated import, the alert `#dlg-paste`
   in `index.html`. The user eyeballs: a copied Car pasted into an image
   editor as its sheet, and into a text editor as _Car_; a sheet copied
   from an editor landing as _untitled_ with its rename box open; a
   photo raising the alert with its dimensions; the Chrome permission
   prompt once; Safari's write (§2.7).
4. **Docs.** README: §Menu bar's Edit bullet (the order, the two roles),
   a Copy and Paste passage in §Folders (with the Trash's refusal), a
   sentence in §Documents (Save, Download, drop and paste converge on one
   format; what the clipboard strips), the copied-file caveat, the
   Architecture list (`state/clipboard.js`, `lib/sheet-shape.js`);
   `selection-tool-plan.md`'s Edit-menu bullet pointed here (the items
   exist, greyed in the application role, waiting for the pixel
   clipboard); this plan's status line.

## 4. Kit asks

**None required.** The key equivalents, the selection, `setSelected`, the
composed events and the dialog anatomy are all shipped kit. Two things
could become asks after the first build, and are not written until then:
a **rename-in-progress signal** on `vf-icon` (`vf-edit-start` /
`vf-edit-end`, or an `editing` state — the `vf-select` analogue), should
the focus reading of §2.6 turn out to miss a case; and an **unblinked
activation** for a key equivalent, should Safari refuse the clipboard call
after the blink (§2.7).

## 5. Decisions for the user

1. **The anachronism.** System 7 copied no file with ⌘C/⌘V (§1); this is
   Mac OS X's Finder, and a pasted picture becoming a file is nobody's
   Finder. Asked for; recorded so the README can say it is deliberate.
   **Decided 2026-09-10: in.**
2. **One clipboard, the system's, as the truth of what is current**
   (§2.2), read at every paste — one Chrome permission prompt the first
   time, ever, and a Paste button in Safari / Firefox for content copied
   elsewhere. The alternative — the in-app clipboard wins while it holds
   something, the system read only when it is empty — never prompts for an
   in-app paste but pastes a stale in-app copy after a copy made elsewhere,
   and cannot know it. A middle way — trust the in-app clipboard until the
   window loses focus, read the system only after a focus trip — avoids
   the prompt in the in-app flow at the cost of a small state machine.
   Recommendation: the system's truth, plainly; the middle way if the
   first-paste prompt grates.
3. **Where the shape rule lives, and whether the drop takes it.**
   `sheetShape` in the app's `lib/` (no engine release) or in the engine's
   `atlas.js` beside `clampTile` (the format's home; an additive export, a
   patch bump, and the CLI's `readSheet` could refuse the same shapes one
   day). And the drop: today any image opens (§2.5) and the pipeline warns
   about non-square tiles; giving the drop the paste's rule and the same
   alert makes one ingest grammar, and closes the door on the deliberately
   lenient foreign-sheet path README §Documents promises ("any foreign 3×2
   sheet is a legal, if anonymous, document"). Recommendation: the app's
   `lib/`, and the drop unchanged in this cut.
4. **`copyName` for Duplicate too** (§2.4): _Car copy_, then _Car copy 2_,
   the Mac's counting, in place of today's unconditional _«name» copy_.
   One rule for the two copies. Recommendation: in.
5. **A pasted picture's name and arrival** (§2.5): _untitled_ counted over
   the container, selected, its rename box open — New Folder's idiom — or
   the New box's Name field first (a prompt before the file lands: more
   ceremony, and the New box makes windows, not files). Recommendation:
   the rename box.
6. **Select All ⌘A** — every icon in the front field, Finder-role only,
   greyed in the application role so ⌘A stays a field's own — was planned
   with the folders ([folders-plan.md](folders-plan.md) §2.7) and not
   built; it is the same gate and one handler, and Copy of a whole window
   wants it. Recommendation: in this cut.
7. **A copy from the application role** — ⌘C with a document window
   active and no pixel selection, meaning "the whole document as a PNG to
   the clipboard" — is handy for moving a sheet into another editor and
   not MacPaint's (Copy was grey with no selection). File → Download is
   the source path today. Recommendation: not now; the selection tool's
   plan owns the Edit menu in that role.
8. **Silent failures**: a system write that fails (§2.7) says nothing,
   since the in-app copy succeeded; a ⌘V with nothing to paste does
   nothing; the alert is for a picture that is not a sheet, as asked. The
   alternative — an alert for an empty or text-only clipboard, _There is
   nothing to paste_ — is one more box. Recommendation: silent.

## 6. Tests, by the rules

[TESTING.md](TESTING.md): a new pure function with rules earns a unit
test on its contract; the wiring, the look and the kit's mechanics earn
nothing and are the eye's. No browser test — the clipboard API, the
permission UI, the menu and the alert are all by eye.

- **`files.test.mjs`**: `copyDoc` makes a new record with new ids and
  times, the Title and Creation Time chunks rewritten, the bytes'
  pixels the same, in the asked folder, the original untouched;
  `copyFolder` copies a folder with a nested folder and documents at both
  levels into another parent, the ids remapped and the nesting kept,
  names inside unchanged, and a folder into itself lands a copy inside
  it; both refuse the Trash and a trashed target; `copyName` — the name as
  is in an empty container, _copy_ beside the original, _copy 2_ beside
  those; `nextDocName` counts over the container alone.
- **`workspace.test.mjs`**: the existing Duplicate test reads `copyName`'s
  result (one adjustment, if §5.4).
- **`sheet-shape.test.mjs`**: the shape rule — 120×80 → 40; 6×4 → 2;
  192×128 → 64; 195×130, 120×81, 121×80, 0×0 refused, each with a reason.
- **`clipboard.test.mjs`**: `pasteSource` — a matching text picks the
  items, a foreign image picks the image, a foreign text or an empty read
  picks none, an unreadable system falls back to the items.
- Not the menu, not the gate, not the alert's copy, not the kit's
  clipboard behavior, not Safari.

## 7. Follow-ups, in the order they earn their place

- **The pixel clipboard** in the application role
  ([selection-tool-plan.md](selection-tool-plan.md)): Cut / Copy / Paste /
  Clear over the marquee, the same two items reading the other role; a
  PNG on the system clipboard pasted onto a face as a floating selection
  (MacPaint's paste) — then a copied sheet goes in either way.
- **A lossless system round trip** where the browser allows it: the web
  custom format (`web application/x-sprite-machine`, Chrome 104+) written
  beside `image/png` with the bytes verbatim, read back in preference to
  the sanitized image, so a document survives Chrome's clipboard with its
  chunks — the name, the ring, the transforms.
- **The caution icon** for the alerts, the trash plan's open item, this
  box included.
- **Put Away ⌘Y**, **Clean Up**, the **Special menu** — the trash plan's
  list, unchanged by this.

## 8. Files touched

`index.html` (the Edit menu, the alert), `src/state/files.js`,
`src/state/clipboard.js` (new), `src/state/workspace.js` (Duplicate's
name), `src/lib/sheet-shape.js` (new), `src/shell/menus.js`,
`src/shell/icons.js`, `test/files.test.mjs`, `test/workspace.test.mjs`,
`test/sheet-shape.test.mjs` (new), `test/clipboard.test.mjs` (new),
`README.md`, `docs/selection-tool-plan.md` (the pointer). The engine is
untouched unless §5.3 puts the shape rule there — then `packages/core`
takes an additive patch and its own test.

The release, when it ships: a visible app change, so the root version
takes a **patch** (`npm version patch`); the engine bumps only under §5.3.
