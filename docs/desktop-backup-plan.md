# Plan: back up the desktop, restore it from a dropped zip

**Status:** drafted 2026-09-17, every decision made the same day as
recommended (§6), all seven steps built the same day, gates green, eye checks
open. The ask: _"I'd like to add a feature for downloading the entire desktop state as a
.zip file. This does NOT have to include open docs and window positions - it's
just about the files and folders. And the corresponding feature to recieve a
dropped .zip file containing a desktop state to restore it. The user should be
given the option to REPLACE their current state or MERGE the dropped desktop
state."_

The short version: one command writes every document, folder and text file in
the library into a zip whose paths mirror the folder tree, with a `desktop.json`
manifest beside them for the names, times and ids the paths cannot carry.
Dropping that zip on the desktop asks whether to add it or replace what is
there, then writes the records straight into IndexedDB and refreshes the
listing. Window geometry and the desktop pattern stay out.

## 1. Where it stands

Most of the parts exist.

- `src/lib/zip.js` is a store-only ZIP writer and reader, already shipped for
  File → Export Sprite Atlas… (`zipStore`). `zipEntries` reads a stored
  archive back and has no production caller yet; it throws on a deflated entry,
  and both sides refuse a name outside printable ASCII.
- `src/storage/db.js` holds the three object stores (`docs`, `folders`,
  `texts`). `src/state/files.js` owns their record shapes and every operation
  on them, and takes its browser dependencies through `init()`, so it runs and
  is tested under Node against `memStorage` (`test/helpers.mjs`).
- A document record already carries its own metadata twice: the PNG's Title,
  Creation Time, Software, `sprite-machine:transforms`, `sprite-machine:ring`
  and `sprite-machine:layers` chunks, plus the record's cached `name`, `icon`,
  `w` and `h`. The chunks win on disagreement (`files.load`), so a document's
  PNG is very nearly a portable file already.
- A text record stores either `text` or `builtin`, a key into the texts the app
  ships. `refresh()` drops a row whose key the app does not ship.
- The Trash is a folder with no record, id `'trash'` (`TRASH`). Deleting is a
  move into it.
- `src/drop-target.js` already takes a whole-page drop and hands the file to
  `loadFile`, which opens it as a sprite sheet. The overlay reads "Drop a
  sprite sheet to load".
- `downloadBlob` is in `src/image-io.js`. The atlas export shows the shape a
  zip download takes: build the bytes, then one `downloadBlob` per gesture.
- The Finder's destructive command already has its pattern: Special → Empty
  Trash… counts the subtree, writes the count into a plain `vf-dialog`
  (`#dlg-empty-trash` in `index.html`), and acts on OK through
  `workspace.emptyTrash()`, which untethers open contexts whose document is gone
  (`forgetStored`).
- The icon layer reconciles from the files slice: an item it has no saved
  position for takes the next free lattice cell, and a document row with no
  cached icon falls back to `genericDocIconDataUri()`. `apps/finder/windows.js`
  closes a folder window when its record disappears.

What is missing: a whole-library read, a whole-library write, the archive
format, and the two commands.

## 2. The model we copy

System 7 backs up a disk, not a window. The Finder copies a volume's files and
folders as a tree; the open windows, their positions and the desktop pattern
live in the desktop database and stay behind. Restoring is dragging that tree
back onto a disk, and the alert asks the one question the act cannot answer for
you: does this go alongside what is here, or over it?

That is exactly the shape of this ask. The archive is the file tree. Replace is
"erase and restore"; Merge is "copy these in". Nothing about the geometry of
the desk travels.

## 3. The design

### 3.1 The archive

```
sprite-machine-backup-2026-09-17.zip
  desktop.json          the manifest
  car.png               a document on the desktop
  read-me.txt           a text file on the desktop
  vehicles/             a folder (a zero-length directory entry)
  vehicles/truck.png
  trash/                the Trash
  trash/old-car.png
```

Paths mirror the tree so the archive is worth unzipping on its own: the PNGs
are the same document files File → Download writes, chunks and all, and a text
file is its text in UTF-8. Every folder gets a zero-length entry ending in `/`,
so an empty folder survives an unzip too. The Trash is `trash/`.

Path segments are `slugOf(name)` (already used by `docFilename`), which keeps
them inside the printable ASCII the zip writer allows. A collision inside one
container takes `-2`, `-3`, … Names are therefore lossy in the path and exact
in the manifest.

### 3.2 The manifest

`desktop.json`, one object:

```json
{
  "format": "sprite-machine-desktop",
  "v": 1,
  "app": "0.3.16",
  "exportedAt": "2026-09-17T09:12:00.000Z",
  "folders": [
    {
      "id": "…",
      "name": "Vehicles",
      "parent": null,
      "createdAt": 1757000000000,
      "modifiedAt": 1757000000000,
      "path": "vehicles/"
    }
  ],
  "docs": [
    {
      "id": "…",
      "name": "Car",
      "folder": null,
      "createdAt": 1757000000000,
      "modifiedAt": 1757000000000,
      "path": "car.png"
    }
  ],
  "texts": [
    {
      "id": "…",
      "name": "Read Me",
      "folder": null,
      "builtin": "read-me",
      "createdAt": 1757000000000,
      "modifiedAt": 1757000000000,
      "path": "read-me.txt"
    }
  ]
}
```

- `parent` and `folder` are a folder id, `"trash"`, or null for the desktop.
  Ids are the records' own, so a backup restored over the same profile lands
  its icons where they were: the positions in localStorage are keyed
  `doc:<id>`.
- `builtin` names one of the texts the app ships. The text is written into the
  zip anyway, for reading; on import a known key is re-linked and the file's
  text is dropped, an unknown key keeps the text.
- `icon`, `w`, `h` and `size` are caches and are not in the manifest. They are
  rebuilt on import from the document's own bytes.
- `v: 1`. A higher `v` is refused with an alert naming the version, not
  guessed at.

### 3.3 Writing it

Special → Back Up All Files… (no dialog; it is not destructive):

1. Read the listing (`files.get()`), plan the paths and the manifest
   (`state/backup.js` `planBackup`, pure).
2. For each document `files.bytesOf(id)`, for each text file `files.textOf(id)`.
   A row whose record has gone is left out of both zip and manifest.
3. `zipStore` the manifest first, then the entries in `descendantsOf` order
   (parents before children).
4. `downloadBlob` the bytes as `application/zip`, named by `backupFilename`.

The item is disabled while storage is unavailable or the library is empty.

### 3.4 Reading it

`src/drop-target.js` grows a second route: a dropped file whose name ends
`.zip` (or whose type is `application/zip`) goes to `onArchive` instead of
`loadFile`, and the overlay's line covers both. `main.js` wires `onArchive` to
the Finder's new action, so the Finder owns every question about files and
folders, as it does for paste.

The Finder's handler:

1. Refuses while a modal is open, and shows `#dlg-storage` when storage is
   unavailable.
2. Reads the zip (`lib/zip.js`), takes `desktop.json`, validates it
   (`readManifest`), and pairs each row with its entry's bytes. A zip with no
   manifest, a foreign `format`, a newer `v` or unparseable JSON shows the
   alert in §3.6 and stops.
3. Shows the Restore dialog with the counts, and acts on the button.

### 3.5 Replace and Merge

One dialog, `#dlg-restore-backup`, whose paragraph is written at show:

> "sprite-machine-backup-2026-09-17.zip" holds 12 sprites, 3 folders and 2
> text files, saved 17 Sep 2026. Add them to the desktop, or replace the 20
> items on it, the Trash included?

Buttons: `Cancel`, `Replace`, `Add` (default). Then
`workspace.importArchive(archive, { mode })`, a wrapper over
`files.importArchive` in the shape of `workspace.emptyTrash()`, so open
documents whose record is removed lose their stored identity and go dirty
rather than vanish.

`files.importArchive(archive, { mode })`, in one pass, then one `refresh()`:

|                  | Replace                                                  | Add (merge)                                     |
| ---------------- | -------------------------------------------------------- | ----------------------------------------------- |
| Existing records | every doc, text and folder removed first, Trash included | untouched                                       |
| Ids              | the manifest's, kept                                     | fresh (`newId()`), parents and folders remapped |
| Names            | as in the manifest                                       | as in the manifest, duplicates allowed          |
| Times            | the manifest's                                           | the manifest's                                  |
| Trash            | restored into the Trash                                  | restored into the Trash                         |

Per document: `decodeAtlas` the bytes, check the shape (`sheetShape`), render
the icon (a new `iconFromBytes` dependency, wired in `main.js` from the icon
renderer `files.init` already uses), then `put` the record with the archive's
PNG bytes unchanged. A document that does not decode, or whose shape is not a
sheet, is skipped and counted; the count is reported once at the end.

Every document is read before anything is removed, and an archive nothing came
through from leaves the library alone. Both keep the one irreversible command
from emptying the desktop and putting nothing back.

Merge keeps the manifest's times deliberately: the listing sorts by
`createdAt`, so a merged-in library interleaves with what is there by age
instead of piling up at the end.

### 3.6 Alerts

A second plain dialog, `#dlg-restore-failed`, one OK, message written at show,
for: not a zip we can read, no manifest, a foreign format, a newer `v`, and "N
items in the backup couldn't be read" after an otherwise good import.

### 3.7 What is not in the archive

Open windows, window positions, icon positions, the active window, the edited
face and layer, the desktop pattern, the About box's Show at startup, the
seeding flags. All of it is desktop state, not files, and per the ask it stays
out. (§8 has the one case where that shows.)

### 3.8 Where the code lives

| File                         | Role                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `src/lib/zip.js`             | reading an archive that is not stored-only; directory entries                       |
| `src/state/backup.js`        | new, pure: the format constants, `planBackup`, `readManifest`, `backupFilename`     |
| `src/state/files.js`         | `importArchive`, `clearLibrary`                                                     |
| `src/state/workspace.js`     | `importArchive` wrapper (untethers open documents)                                  |
| `src/apps/finder/backup.js`  | new: build the zip from the slice, download it, read a dropped file into an archive |
| `src/apps/finder/index.js`   | the two commands, the two dialogs, the `receiveArchive` action                      |
| `src/apps/finder/menus.html` | the two Special items                                                               |
| `index.html`                 | `#dlg-restore-backup`, `#dlg-restore-failed`                                        |
| `src/drop-target.js`         | the `.zip` route, the overlay line                                                  |
| `src/main.js`                | `onArchive` → the Finder, the `iconFromBytes` dependency                            |

The engine is untouched. No app code reaches into `packages/core` except
through its published entries, as now.

## 4. Steps

Each lands with the four gates green.

1. **Read a zip we did not write.** `lib/zip.js`: an async `unzip(bytes)` that
   inflates a deflated entry through `DecompressionStream('deflate-raw')` and
   flags directory entries, leaving `zipStore` and the sync `zipEntries` as
   they are. A user who unzips a backup, edits it and re-zips it in the Finder
   gets deflate, so reading it is what makes the round trip real. Test:
   `test/zip.test.mjs` grows a deflated fixture built with `deflateRawSync`.
2. **The format, pure.** `state/backup.js` with `planBackup(state)` →
   `{ manifest, entries }` and `readManifest(json)` → the normalized archive or
   a thrown `Error`, plus `backupFilename`. Test: `test/backup.test.mjs`.
3. **The library-wide storage operations.** `files.clearLibrary`,
   `files.importArchive`, the `iconFromBytes` dependency, and the
   `workspace.importArchive` wrapper. No UI. Test: the merge and replace
   contract in `test/files.test.mjs` against `memStorage`.
4. **Back Up All Files…** The Special item, its gate, `apps/finder/backup.js`'s
   writer, the download. Eye check: the file lands with today's date in its
   name; unzipped in the Finder it shows the same tree as the desktop, the
   PNGs open in Preview, `desktop.json` reads straight.
5. **The drop.** The `.zip` route in `drop-target.js`, the overlay line,
   `receiveArchive`, the Restore dialog and the failure alert. Eye check: drop
   the file from step 4 on a desktop with other work on it; Add gives a second
   copy of everything with the folders nested as before; Replace on a fresh
   profile (`?fresh=1` first, then a reload) brings the whole desktop back,
   icons in their old places; a dropped .png still opens as a sprite sheet;
   a dropped text file or a zip of holiday photos shows the alert.
6. **Restore from Backup… from the menu** (decision 8): the Special item and a
   hidden `input[type=file]` that feeds the same handler. Eye check: the picker
   accepts `.zip` and the same dialog appears.
7. **The docs.** A short section in `README.md` (the user guide) and a line in
   `src/texts/read-me.txt`, in the plain language those two use: "sprites",
   "folders", "your desktop", no manifest and no zip internals.

## 5. Kit asks

None expected. Two things to watch while building, each an ask only if it
misbehaves:

- A three-button group in a plain `vf-dialog`: Cancel, Replace, Add, right
  aligned with the default last. If `vf-button-group origin="bottom right"`
  does not lay three out, the fallback is two dialogs (ask on the first, a
  confirm on Replace) rather than a bridge.
- Kit ask #6 (the pattern token leak) applies as ever if either dialog needs a
  `vf-container`. Neither should.

## 6. Decisions

**All nine decided as recommended on 2026-09-17** ("That's perfect. Please
proceed with implementing the plan."). Two details the build settled, each
following from a decision rather than replacing one:

- The pure format module is `src/state/backup.js`, not `src/lib/backup.js`:
  it reads the files slice's selectors, and `src/lib/` never imports
  `src/state/`. `state/ring-settings.js` is the precedent.
- A backup re-zipped by the Finder wraps everything in a folder, so
  `readBackup` accepts one leading path prefix and skips `__MACOSX/`. That is
  decision 7's case carried through to the paths.

1. **Where the commands live and what they are called.** Recommend the Finder's
   Special menu, below a separator after Restore Default Files: **Back Up All
   Files…** and **Restore from Backup…**. Special is the volume-level menu in
   System 7 and already holds Empty Trash… and Restore Default Files.
   Alternatives: the File menu, or "Back Up Disk…" / "Restore Disk…", which is
   more System 7 but names a disk the desktop never shows.
2. **The archive's shape.** Recommend the mirrored tree plus `desktop.json`
   (§3.1): worth unzipping by hand, and the PNGs are ordinary documents. The
   alternative is flat `files/<id>.png` with everything in the manifest, which
   is simpler and opaque.
3. **The Trash.** Recommend including it, under `trash/`, restored into the
   Trash. It holds the user's files until they empty it, and a backup that
   quietly drops them is a backup that loses work. Alternative: leave the Trash
   out of the archive.
4. **Ids.** Recommend Replace keeping the manifest's ids and Merge minting
   fresh ones. Kept ids make a same-profile restore land the icons where they
   were; fresh ids make Merge always additive, so importing the same backup
   twice gives two copies instead of overwriting. Alternative: fresh ids
   always, and a restored desktop lays its icons out on the lattice.
5. **Name collisions on Merge.** Recommend names verbatim, duplicates allowed,
   and a folder in the backup always arriving as a new folder even when one of
   that name is there. Predictable, and tidying up is what the Finder is for.
   Alternatives: `copyName` ("Car copy"), or merging same-named folders.
6. **A restored document's icon.** Recommend re-rendering from the PNG on
   import. It costs one decode per document and the archive stays free of
   caches. Alternatives: carry the data URI in the manifest (fast, ships a
   cache), or leave it null and let the generic document icon stand in.
7. **Deflated archives.** Recommend reading them (step 1). Without it, a
   backup that has been through the Finder's own compress fails to load, which
   reads as a broken feature. Alternative: stored entries only, with an alert
   that says so.
8. **Restore from the menu as well as the drop.** Recommend yes (step 6): a
   drop-only command is invisible, and the picker is a hidden file input, no
   kit work. Alternative: the drop alone.
9. **Confirming Replace.** Recommend one dialog, with the count of what
   Replace removes in its text (§3.5). Alternative: a second confirm on
   Replace, the way Empty Trash… asks.

## 7. Tests

By `docs/TESTING.md`: the new pure logic gets its contract pinned, the rest is
an eye check.

- `test/zip.test.mjs`: a deflated entry reads back as its bytes; a directory
  entry is flagged and not mistaken for a file. (New rules in a pure module.)
- `test/backup.test.mjs`: `planBackup` slugs a name, suffixes a collision
  inside one container, nests a subtree, puts the Trash under `trash/`, and
  leaves nothing out; `readManifest` accepts the round trip of `planBackup`,
  and throws on a foreign format, a newer `v`, missing arrays and a row whose
  path is absent.
- `test/files.test.mjs`: `importArchive` in both modes against `memStorage`.
  Merge mints ids and remaps `parent`/`folder`, Replace keeps them and clears
  first, a trashed row lands in the Trash, an unknown `builtin` key falls back
  to the archived text, a document whose bytes do not decode is skipped and
  counted, and a replace nothing came through from leaves the library alone.
  `clearLibrary` also empties a record the listing leaves out.

Nothing on the menu items, the dialog copy, the counts wording, the overlay
line or the download itself. Those are the eye checks in §4.

## 8. Follow-ups

- Icon positions, the desktop pattern and the open windows in the manifest, as
  a separate optional section, so a backup can restore the whole desk and not
  just its files. Out of scope by the ask; the gap shows when a backup is
  restored onto another machine, where every icon takes a lattice cell.
- Back up one folder: the same writer over `descendantsOf(folder)`, reached
  from the folder's own window.
- Import a plain folder of PNGs (no manifest) as documents on the desktop.
- Progress for a large restore. Today the desktop simply refreshes when the
  import resolves.

## 9. Files touched

New: `src/state/backup.js`, `src/apps/finder/backup.js`, `test/backup.test.mjs`,
`docs/desktop-backup-plan.md`.

Changed: `src/lib/zip.js`, `src/state/files.js`, `src/state/workspace.js`,
`src/apps/finder/index.js`, `src/apps/finder/menus.html`, `src/drop-target.js`,
`src/main.js`, `index.html`, `test/zip.test.mjs`, `test/files.test.mjs`,
`README.md`, `src/texts/read-me.txt`.
