# Plan: onto vintage-frames/shell

**Status:** drafted 2026-10-01. Decisions 1 to 4 taken (§8). Steps 1 to 5
landed 2026-10-01 and shipped as app v0.4.0 on 2026-10-02; the engine is
unchanged. The eye checks (§7) are open. Delete this plan when they close.
The ask: _"please update to the latest Vintage Frames npm version, converting
to use the new shell. you can see the ../vintage-frames source for recent
commits and you may also observe this same upgrade having been done to
../system-online"_

The short version: vintage-frames 0.15.0 ships `vintage-frames/shell`, the
window manager, menu bar, catalog, stock Finder and saved session that grew
here and went to the kit by way of system-online. This repo keeps its four
applications and gives up `src/shell/`, the Finder's icons, windows and
lattice, the document library (`state/files.js`), the desktop state and the
session restore. A document becomes a catalog item of the Sprite Editor's
kind, its PNG bytes in the Sprite Editor's own store. The engine does not
change.

The kit's plans already decided this site's part (Adam, 2026-10-01;
vintage-frames `docs/SHELL-PLAN.md` § Decided and `docs/SHELL-DIALOGS-PLAN.md`
§ Decisions): documents are a kind with their bytes in the application's
store, keyed by item id; positions live on the items; the selection survives
an application switch; Desktop Patterns and the Text Viewer stay here; every
dialog moves into its application's `dialogs`; the silent failures get
authored alerts. The kit plan's "nothing stored is migrated" does not hold
here: the library and the session are converted once (§4.9, decision 3).

## 1. The model we copy

System 7's split, which this repo already follows: the Finder owns the
desktop and the files, each application owns its windows and dialogs, and
the Process Manager puts the front application's menus on the bar. What
moves is where the mechanics live. The kit now draws, places, saves and
files; the applications here say what their items are and what their
windows hold.

## 2. What the kit gives (0.15.0)

From the kit's `docs/SHELL.md`:

- `createShell(desktop, { apps, fit, state, services })` runs the
  applications, swaps the front application's menus onto the bar after the
  page's system menu, puts the clock in the bar's `end` slot, fits the
  raster to the viewport, and boots: reads the catalog, seeds it once,
  reopens the last session's windows deepest first, then starts saving.
- `defineApp({ id, name, menus, dialogs, kinds, init(ctx) })`. `ctx` holds
  the window manager, its menus and dialogs (`menu`, `item`, `dialog`,
  `ask`, `hold`), `gate`, `onFront`, `typing`, `modalOpen`, `systemItem`,
  `apps`, `catalog`, `services`, `state`, `on` and `onDispose`.
- The window manager: `open`, `adopt`, `close`, `requestClose`, `setItem`,
  palettes (shown while their application is front and a predicate holds),
  `place`, `pin`, `policy`, `keep`, a `close` hook, `setFrameBands`,
  `arrangeWith`, `beforeFront`, `onFront`, `onLayout`, `onWindows`,
  `onRaster`. Placement is this session's pin, the saved pin, then `place`.
  A window closes into its item's icon. A window showing a catalog item
  follows its renames and closes when the item is removed.
- The catalog: items `{ id, name, kind, parent, left, top, createdAt,
modifiedAt, data }`, the Trash as a volume, IndexedDB storage, a seed run
  once per storage. A kind gives `art`, `open`, `size`, `copy`, `onRemove`,
  `claim` (a pasted or dropped file) and `export` (the system clipboard).
- The stock Finder: icons, folder windows, filing, Clean Up, Open, New
  Folder, Close, Copy, Paste, Select All, Arrange Windows, Empty Trash…, its
  own alerts, `addCommand` and `alertWith` for a site's additions.
- `localStorageState(key, { extra })`: window pins and depths by item, the
  active item, the desktop pattern, and the site's own keys. `?fresh=1`
  neither reads nor writes.
- Dialogs: `vf-dialog.returnValue`, a `<form method="dialog">` that closes
  with the submitting button's `value`, and Return in a form's field
  pressing the ringed button.
- `window-top` on `vf-desktop` deepens the windows' area below the bar, for
  the options strip.
- Element fixes from 0.14.1: a press on the menu bar, a menu or a dialog
  keeps the icon selection; a hidden window never holds the active state;
  window drags and icon drops stop below the bar; `vf-window.sizeLimits` and
  `windowChrome()`; `vf-placement-change` is public; an unpatterned box no
  longer paints an inherited pattern.

## 3. Where things go

| Here                                                                                | Becomes                                                                                                                                                 |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shell/windows.js`                                                              | the kit's window manager                                                                                                                                |
| `src/shell/menu-bar.js`                                                             | `createShell`'s bar; the About box moves to `src/about.js`, the page's                                                                                  |
| `src/shell/clock.js`                                                                | the kit's clock                                                                                                                                         |
| `src/shell/desktop-pattern.js`, `state/shell.js`                                    | `desktop.pattern`, saved by the shell; `windows.front` and `ctx.onFront`                                                                                |
| `src/shell/desktop-state.js`, `src/boot/restore.js`                                 | `localStorageState` and the shell's boot, with `greet`, `showRing` and `docs` (each document's face and layer) as extra keys                            |
| `src/shell/layout.js`                                                               | the kit's geometry; the Sprite Editor keeps its own top and cascade numbers (§4.4)                                                                      |
| `src/apps/index.js`                                                                 | the `apps` list in `main.js`                                                                                                                            |
| `src/apps/finder/icons.js`, `windows.js`, `layout.js`, `menus.html`, `windows.html` | the stock Finder                                                                                                                                        |
| `src/apps/finder/index.js`, `backup.js`                                             | `finder()` configured: art, seed, Storage Unavailable, New Sprite, Restore Default Files, Back Up All Files…, Restore from Backup…                      |
| `src/state/files.js`                                                                | the catalog; `state/kinds.js` (the `sprite` and `text` kinds' data); the Sprite Editor's sheet store                                                    |
| `src/storage/db.js`                                                                 | the kit's `indexedDbStorage` for the catalog; the old database's `docs` store as the sheet store, its `folders` and `texts` read once by the conversion |
| `src/loaders.js` seeding and restore-defaults                                       | `state/defaults.js`, over the catalog                                                                                                                   |
| `src/state/clipboard.js` (the Finder's half)                                        | the stock Finder's Copy and Paste; the pixel half stays                                                                                                 |
| `src/drop-target.js`                                                                | the Finder's drop through the kinds' `claim`; a zip goes to Restore; the overlay stays                                                                  |
| dialogs in `index.html`                                                             | each application's `dialogs.html`                                                                                                                       |

## 4. Design

### 4.1 Boot

`main.js` starts the shell:

```js
const state = localStorageState('sprite-machine:session', {
  extra: { greet: true, showRing: false, docs: {} },
  fresh: devBoot,
});
const shell = createShell(desktop, {
  apps: [
    finder({ storage, readLibrary }),
    spriteEditor({ sheetStore, icons }),
    textViewer(),
    desktopPatterns(),
  ],
  fit: 'viewport',
  state,
  services: { ring: ringFollow, model: modelExport },
});
```

The scene, rebuilder and icon renderer are built as now, the stage after the
Sprite Editor's windows exist. The dev boots (`?sample`, `?fresh`) open the
sample at once and read and write no session; `?fresh` also gives the Finder
no storage. Otherwise `shell.ready` runs `?file` (a stored document by name,
in front) and the greeting when no window reopened. Before the state is made,
the old desktop state is converted into the session's own key once (§4.9).

### 4.2 Documents are a kind

Kind `sprite`, registered by the Sprite Editor.

- **The item** holds the name and `data: { icon, size }`: the model render's
  data URI (the icon is synchronous art) and the PNG's byte length, for
  Empty Trash's alert.
- **The bytes** stay in the Sprite Editor's sheet store: the `docs` store of
  the IndexedDB database `sprite-machine`, records `{ id, png }` keyed by
  item id, where every stored document's bytes already are. The catalog
  lives in a database of its own, `sprite-machine-catalog`.
  `open` loads them; `copy` copies them; `onRemove` drops them; `export` is
  the PNG with its Title chunk set to the item's name; `claim` takes a
  pasted or dropped PNG that is a sheet and stores it where it landed,
  named by its Title chunk, else the next untitled name with the rename box
  open. An image that isn't a sheet gets the Sprite Editor's alert.
- **The name** is the catalog's. A rename in the Finder is a catalog rename,
  so the bytes keep their old Title until they leave: Download, Copy and
  Back Up write the item's name into them.
- **Save** writes the bytes, then the item: `create` at a first save,
  `update` after. Duplicate saves a new item beside the original.
- **A document window** is adopted with its item (the file id, or none while
  untitled), the Sprite Editor's dirty-checked close as its `close` hook,
  and `setItem` at a first save. It closes into its icon through the kit.
  The workspace context follows a catalog rename. Empty Trash's `onRemove`
  takes the item off an open window first, so the window stays and its
  document goes untitled and dirty, as now.

### 4.3 Text files are a kind

Kind `text`, the Text Viewer's: `data` holds a built-in's key or the text
itself, as system-online's. Windows open through `windows.open`, close into
their icon, and follow renames through the kit. The zoom box keeps its
reading column.

### 4.4 The Sprite Editor's windows

- **The windoids are palettes.** Tools, Full Sprite View, 3D View and Color
  Palette are `palette: true`; the 3D Sprite Atlas is `palette: () =>
showRing`. Each is adopted with an item of its own (`windoid:tools`), so
  the session saves its box without a depth and the next boot passes the
  pin back at adoption.
- **The front application** is `ctx.onFront`: the options strip, the tool
  keys and the Option key follow it in place of `shell.appActive`.
- **Placement, policies, keeps, frame bands and the arrange group** keep
  their rules. Their functions take the window area (`(area) => box`)
  where they took the raster's size.
- **The top band.** `index.html` declares `window-top="56"` on the desktop,
  the bar and the options strip. The Sprite Editor's `layout.js` states the
  same 56 and its cascade step and slot count as its own numbers, since
  the kit's shell entry can't be imported under Node (kit ask 1).

### 4.5 The session

The shell saves every window's pin and depth by item, the active item and
the pattern. The extras: `greet` (the About box's Show at startup),
`showRing`, and `docs`, each stored document's face and layer, which the
Sprite Editor writes when they change and reads when it opens a document.
At boot the shell calls each application's `open({ item })`: the Finder
reopens folders, the Text Viewer texts, the Sprite Editor documents.
Untitled documents are not saved, as now.

### 4.6 The Finder

`finder({ storage, art, seed, dialogs, extend })`:

- **Art**: the folder, Trash and trash mark from `src/assets`, the generic
  document icon for an item without its own, the caution art for its
  alerts.
- **Seed**, run once per storage: the old library converted (§4.9), or, on
  a profile without one, the sample documents and the built-in text files
  (`state/defaults.js`).
- **`extend`**: File → New Sprite ⌃N after Open (decision 2); Special →
  Restore Default Files, then Back Up All Files… and Restore from Backup…;
  Storage Unavailable answered with this app's own copy, which names File →
  Download.
- **What changes on screen**: icons stay selected across an application
  switch; folder and text windows cascade from the kit's origin, 40 right
  and 20 down from the windows' area (now 52 and 8); the Finder's alerts
  are its own.

### 4.7 Dialogs

Each application authors its dialogs in `dialogs.html` as dialog-method
forms and asks them with `ctx.ask`: the Sprite Editor's New, name prompt,
Tile Size, Save Changes, Export 3D Model and Export Sprite Atlas, with
`sm-color-picker` held through `ctx.hold`; the Finder's Restore question and
alerts through its `dialogs`; one alert per application with a message
paragraph, which grows to its message once shown (system-online's `ask`).
The About box stays the page's. Every `build.setError` that today shows
nothing becomes that alert, and the build slice keeps only build results.

### 4.8 Backups

The format stays version 1 (`desktop.json` with folders, docs and texts), so
a backup made before this change restores after it. Rows gain `left` and
`top`, which Replace keeps. The writer walks the catalog and reads each
document's bytes from the sheet store, its Title set to its name. Replace
imports with the archive's ids and writes each document's bytes under its
id. Add creates the items one by one, folders first, to learn the new ids
for the bytes (kit ask 2).

### 4.9 The conversion

A document's format doesn't change, so nothing stored is dropped. Two pure
functions in `state/legacy.js`, run once:

- **The library**, as the catalog's seed. The `folders`, `docs` and `texts`
  records of the database `sprite-machine` become items with their ids,
  names, times and containers: a folder a `folder`, a document a `sprite`
  with `data: { icon, size }` from its record, a text file a `text` with its
  built-in key or its text. The Trash's id is the kit's (`trash`). Each
  item's position comes from the old desktop state's `icons` map (`doc:<id>`,
  `folder:<id>`, `text:<id>`), the Trash's through `catalog.place`. The
  items go in with `catalog.import(…, { mode: 'replace' })`, which keeps
  their ids, so the bytes in `docs` line up. A profile with no old records
  gets the defaults instead. The old records stay where they are.
- **The session.** Before `localStorageState` reads it, a blob of version 4
  (or older, through the existing `migrateDesktopState`) under
  `sprite-machine:desktop` is written as the kit's version 1 under
  `sprite-machine:session`, while that key is empty, and the old key stays:
  each window
  keyed by its item (`doc:<id>` → `<id>`, `windoid:<id>` kept) with its
  application, pin and depth, the active item, the pattern, and `greet`,
  `showRing` and `docs` as extras. The kit reads its pins in the same frame
  (the 56 band, the Sprite Editor's bands), so every window reopens where it
  was.

## 5. Kit asks

1. **Pure modules under Node.** `vintage-frames/shell` imports the elements,
   so a site's pure modules can't import the geometry (`pinOf`, `pinTo`,
   `frameOf`) or the catalog's selectors in a Node test. Ask: a DOM-free
   entry for the geometry, the catalog and the session parsing. Until then
   the Sprite Editor states its few numbers itself, and the tests that read
   placed windoids through the pin are dropped.
2. **`catalog.import` in merge mode mints ids it doesn't return,** so a kind
   whose payload is keyed by item id can't restore a merged backup. Ask:
   resolve the id map, or a kind hook for imported items. Bridge: Add
   creates items one by one.
3. **A Replace import closes the windows of items it brings back.**
   `import({ mode: 'replace' })` clears first, and the shell's follow reads
   the clear as a removal. Ask: follow once the import settles. Bridge:
   before a Replace the Sprite Editor takes the items off its document
   windows and puts back those that came back.
4. **KNOWN-BUGS #6**, the desktop pattern not saved on its own, reaches this
   site: Set Desktop Pattern followed by a reload within the page's life can
   lose it. No bridge; it is saved with the next window change or on hide.

## 6. Steps

Each lands with the four gates green.

1. **vintage-frames ^0.15.0** with the shell still this repo's. Retire the
   bridges the element fixes make dead: the icon selection bridge in
   `apps/finder/icons.js` and the `pattern="white"` covers. Eye check.
2. **Pure modules beside the old ones**: `state/kinds.js`,
   `state/defaults.js` over a catalog, `state/legacy.js` (the conversion),
   and the backup's catalog half. Unit tests on their rules.
3. **The move.** `main.js` on `createShell`; the stock Finder configured;
   the four applications as `defineApp`; the kinds; the Sprite Editor's
   windows on palettes and the kit's adoption; the session's extras. The old
   shell, Finder internals, library, desktop state and restore go, with
   their tests. Dialogs stay in `index.html`, shown by id, for this step.
   Built: the Text Viewer's reading column moved into the window area (the
   kit clamps a kept box there), which closes its open item.
4. **Dialogs.** Every dialog into its application's `dialogs.html` and
   `ctx.ask`; `sm-color-picker` held; the alerts; `build.setError` retired.
5. **Docs.** SPEC § The desktop rewritten against the kit; README where the
   user sees a change (a dropped sheet, the selection); CLAUDE.md's
   applications section, as system-online's; this plan deleted when the eye
   checks close.

## 7. Tests

By `docs/TESTING.md`:

- **New**: `kinds` (a text's data, a document's data), `defaults` (what is
  missing, what a restore stores, over a stub catalog as system-online's
  helper), `legacy` (old records to items with their ids, containers and
  positions; a version 4 blob to a kit session that the kit's reader
  accepts), `backup` (plan over a catalog state, the manifest round trip, the
  rows a Replace and an Add store), the workspace over a sheet store and a
  stub catalog (save creates then updates, rename follows, a removed item
  leaves the context untitled and dirty).
- **Gone with their modules**: `files`, `layout`, `finder-layout`, and the
  Finder half of `clipboard`. `desktop-state` stays with
  `migrateDesktopState`, which the conversion reads through.
- **Trimmed**: `sprite-editor-layout` loses its pin and frame-band cases
  (kit ask 1).
- No browser tests. The eye checks, all open:
  1. **The conversion**, on a profile from before the shell: every document,
     folder and read-me in its place, the Trash's contents in it, the windows
     that were open reopening where they were, and a document opening with
     its pixels, face and layer.
  2. **A fresh profile**: Car, Truck, Cube, Read Me and Keyboard Shortcuts on
     the desktop, and the About box greeting.
  3. **The bar**: the Finder's File (Open, New Sprite, New Folder, Close) and
     Special (Clean Up, Empty Trash…, Restore Default Files, Back Up All
     Files…, Restore from Backup…); Desktop Patterns in the Sprite Machine
     menu; the clock at the right end.
  4. **The Sprite Editor**: a document opens out of its icon with the palettes
     and the options strip; a close with unsaved changes asks Save Changes,
     and the window closes into its icon.
  5. **Its dialogs**: New… and the save prompt take Return; Tile Size, both
     exports and the Colors picker; the bar shows the Sprite Editor while one
     is open.
  6. **Drops and pastes**: a sheet PNG dropped on the desktop becomes a
     document there; an image that isn't a sheet gets the alert; an image
     pasted in the Finder becomes a document with its rename box open.
  7. **Copy, Empty Trash and rename**: a copied document pastes as "Car
     copy"; emptying the Trash under an open document leaves its window
     untitled and unsaved; a rename in the Finder retitles the open window,
     and Download names the file by it.
  8. **Backups**: Back Up, then Restore with Replace (icons where they were,
     open document windows stay) and with Add.
  9. **Resize and zoom**: a browser resize carries windows and icons and
     growing back restores them; the read-me column now starts below the
     options strip.
  10. **Desktop Patterns**: Set, then reload. KNOWN-BUGS #6: the pattern is
      written with the next window change or when the tab hides.

## 8. Decisions

Taken by Adam, 2026-10-01:

1. **A sheet dropped on the desktop** is stored where it was dropped (into a
   folder window under it), with nothing opened; over a Sprite Editor window
   nothing happens. Paste of an image does the same. As recommended.
2. **New Sprite ⌃N stays in the Finder's File menu**, after Open. As
   recommended.
3. **Stored documents are never dropped while their format holds.** The
   library and the session are converted once (§4.9), in place of the kit
   plan's "nothing stored is migrated".
4. **The app's version** is a minor, 0.4.0 (2026-10-02), as recommended: a
   dropped PNG now stores rather than opens, and an older version can't read
   the catalog.

## 9. Follow-ups

- The tests dropped by kit ask 1, once the kit has a DOM-free entry.
- Removing the old `folders` and `texts` stores once every profile has
  converted.

## 10. Files touched

- `package.json`, `package-lock.json`
- `index.html`, `src/main.js`, `src/about.js` (new), `src/style.css`
- `src/apps/finder/` (index, backup, dialogs.html; icons, windows, layout,
  menus.html, windows.html removed)
- `src/apps/sprite-editor/` (index, windows, layout, menus.html,
  windows.html, dialogs.html new, sheets.js new)
- `src/apps/text-viewer/`, `src/apps/desktop-patterns/` (index, windows,
  layout, dialogs.html)
- `src/state/kinds.js`, `defaults.js`, `legacy.js` (new); `backup.js`,
  `workspace.js`, `clipboard.js`, `build.js`, `prefs.js`; `files.js`,
  `shell.js` removed
- `src/shell/` (but `desktop-state.js`'s migration, moved to
  `state/legacy.js`) and `src/boot/restore.js` removed; `src/storage/db.js`
  reduced to the sheet store and the conversion's reads; `src/apps/index.js`,
  `src/drop-target.js`, `src/system-clipboard.js`, `src/loaders.js`
- `src/components/sm-options-bar.js`, `sm-desktop-patterns.js`,
  `sm-color-picker.js`, `src/shortcuts.js`
- `test/`: new `kinds`, `defaults`; rewritten `backup`, `workspace`,
  `clipboard`, `sprite-editor-layout`, `helpers`; removed `files`, `layout`,
  `finder-layout`, `desktop-state`
- `docs/SPEC.md`, `README.md`, `CLAUDE.md`
