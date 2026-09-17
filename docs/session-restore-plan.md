# Plan: the desktop comes back as you left it

**Status:** drafted 2026-09-17, every decision made the same day (§6), all seven
steps built the same day, gates green, eye checks open. The ask: _"right now we use a #NAME url param to restore an open file on refresh...
i want to change that... we should persist our environment state ( open
windows, window positions ) live in our persisted storage so that on refresh
the user should see exactly what they were looking at before. the same open
documents with the same window positions."_

The short version: the address bar stops being the session. Every window that
can be named — a document, a folder, a text file, a windoid — saves its
nine-slice pin and its depth in the desktop blob that already holds the icon
positions, and the boot reopens them in that order instead of opening the one
document the URL named.

## 1. Where it stands

Half of this already exists.

`shell/desktop-state.js` writes one versioned JSON key to localStorage, on a
400 ms debounce plus every `pointerup`, resize, tab hide and unload. It already
holds:

- `icons`: every icon's position, keyed `doc:<id>`, `folder:<id>`, `text:<id>`.
- `windows`: **folder** window boxes as nine-slice pins (`shell/layout.js`
  `pinOf`), keyed `folder:<id>`.
- `docs`: each open saved document's `fileId`, edited face and layer, and
  `activeFileId`.
- `pattern`, `greet`, the seeding flags.

What it does not hold: document window geometry, text windows at all, windoid
geometry, the 3D Sprite Atlas toggle, and which windows were open as opposed to
merely known.

The boot ignores most of what it does hold. `main.js` `bootDocuments()` opens
exactly one document, named by `?file=` or by the `#NAME` that
`shell/url-state.js` mirrors from the active document, and uses the `docs`
entry only to restore that one document's face and layer. Folder windows are
not reopened; their saved pin is applied only when the user opens the folder
again (`apps/finder/windows.js` `savedPin`). Text windows persist nothing.
Windoids are placed from `apps/sprite-editor/layout.js` on the live raster at
every boot, and `state/prefs.js` starts at its defaults.

One piece of history matters. The v2 blob held raw per-document boxes
(`win: {left, top, width, height}`) and windoid boxes, and the v3 migration
**dropped** them. Raw boxes are wrong across a raster change: a box saved on a
wide screen lands off a narrow one. What has arrived since is the nine-slice
pin — `pinOf(box, raster, frame)` and `pinTo(pin, raster, frame, policy)` —
which the window manager already uses on every browser resize, and
`windows.adopt(win, { pin })`, which opens a window at a saved pin instead of
its placement. That is the piece that makes this work now.

## 2. The model we copy

System 7 remembers the desktop. The Finder writes the open windows, their
sizes, their positions and their scroll to the desktop database, and on the
next startup they come back the way they were left. A window is a place, not a
route; you return to the room you left, not to a document named in an address.

The in-app precedents: icon positions already survive a reload, and a folder
window already reopens at the pin it closed at. This extends the same rule to
every window.

## 3. The design

### 3.1 One key per window

Every persisted window is named by the key its icon already uses:

| Window                | Key                                             |
| --------------------- | ----------------------------------------------- |
| Document              | `doc:<fileId>`                                  |
| Folder                | `folder:<id>`                                   |
| Text file             | `text:<id>`                                     |
| Sprite Editor windoid | `windoid:<tools\|sprite\|stage\|ring\|palette>` |

An untitled document has no `fileId` and so no key: it is not saved and not
restored, as today. A document window's key is read at snapshot time, not at
adoption, so a Save As that gives an untitled context a `fileId` starts saving
that window from the next write.

### 3.2 The saved shape (v4)

`windows` widens from folder pins to every window:

```js
windows: {
  'doc:7f3a': { pin: {…}, z: 2 },     // open, third from the bottom
  'folder:home': { pin: {…}, z: 0 },
  'text:read-me': { pin: {…} },        // known box, window closed
  'windoid:tools': { pin: {…} },
}
```

`z` is the window's index among the desktop's `vf-window` children, which is
the kit's stacking order. An entry with a `z` was open at the write; an entry
without one is a remembered box for a closed window, which is what the Finder
keeps today and what makes a reopened folder land where it was.

Beside it: `active`, the key of the active window (superseding `activeFileId`),
and `showRing`, the 3D Sprite Atlas toggle. `docs` keeps the face and layer per
document, and stops being the record of what is open — `windows` is.

`migrateDesktopState` gains v3 → v4: keep `icons`, `pattern`, `greet`, the
seeding flags and `docs`; keep the v3 `windows` entries as remembered folder
boxes (no `z`, so nothing reopens on the first boot after the upgrade); map
`activeFileId` to `active: 'doc:<id>'`. v1 and v2 keep migrating shallowly as
they do.

### 3.3 Reading the geometry

The Finder already hands `dstate.start()` two readers — `positions()` for icons
and `pins()` for folder windows. The Sprite Editor and the Text Viewer gain the
same `pins()`, each returning `{ [key]: { pin, z } }` for its own windows, `z`
from the window's index among the desktop's `vf-window` children. `main.js`
merges the three into `readWindows`. Closed-this-session boxes keep coming
through without a `z`, and `desktop-state.js` already merges each write over
the last map, so a key whose window is gone keeps its box.

No shell API changes: `windows.pinOf(win)` and `windows.adopt(win, { pin })`
are the whole vocabulary, and both exist. The arrows still point one way.

### 3.4 Restoring, in `src/boot/restore.js`

A new module, called from `bootDocuments()` after the seeding, in place of the
`?file` branch. It takes the saved state and the app actions and does:

1. Collect the saved entries that have a `z`, sorted ascending.
2. For each, in that order:

   - `doc:<id>` — `workspace.openStored(id)`, then apply the `docs` entry's
     face and layer. Skip an id that is missing from the listing or trashed.
   - `folder:<id>` — the Finder's new `openFolder(id)` action.
   - `text:<id>` — the Text Viewer's `open(id)` action.

   Each open already ends in `bringToFront`, so opening bottom-up rebuilds the
   stack, and each window's box comes from its saved pin at `adopt`, not from
   the cascade.

3. Bring the `active` key's window forward last. With no saved active window,
   the top of the stack stays active, and the front application follows from
   the window manager as it does today.
4. `?file=<name>` still resolves and opens its document, after the restore and
   in front, so a shared link works on a desktop that already has windows.
5. Nothing to restore and no `?file` → the About box, unless Show at startup is
   off. Unchanged.

The windoids are not in that list. They are adopted at the Sprite Editor's init,
before the restore runs, so each takes its saved pin there
(`adopt({ pin: savedPin('windoid:'+id) })`) and falls back to
`initialPlacement` without one. Their derived sizes still apply after the pin:
the 3D Sprite Atlas's height is `ringHeightFor(size)` and the Color Palette
snaps to whole cells, so the restore writes the pin and then re-runs those fits,
exactly as a browser resize does.

`?fresh=1` and `?sample` do not restore, as they do not seed or write.

### 3.5 The address bar

`shell/url-state.js` is deleted and `initUrlState` goes with it. The boot clears
a stale `#name` with `replaceState` so an old bookmark does not keep forcing its
document open. `?file=` stays: it is documented in the README as a link into a
saved document, and `tools/capture.sh` leans on the dev params beside it.
`boot/params.js` stops reading the hash, and its tests lose those cases.

### 3.6 What is not restored

Untitled documents (their bytes are nowhere: save is explicit, and autosave is
not planned), open dialogs, the current tool, ink and selection, a folder
window's scroll, and the exact interleaving of windoids with document windows.

## 4. Steps

Each lands green on its own.

1. **v4 shape and migration.** `desktop-state.js`: the widened `windows`,
   `active`, `showRing`, and v3 → v4 in `migrateDesktopState`. Writers and
   readers still behave as today. Test: the migration (pure).
2. **The readers.** `pins()` on the Sprite Editor and the Text Viewer, the
   Finder's widened with `z`, merged in `main.js`. Nothing is restored yet;
   the blob fills up. Verified by reading localStorage.
3. **Documents.** `boot/restore.js` reopens saved document windows at their
   pins, in order, with the saved face, layer and active window. The `?file`
   branch moves behind it.
4. **Folders and text files.** The Finder gains an `openFolder` action; both
   kinds join the restore.
5. **Windoids and the Atlas toggle.** Saved pins at the Sprite Editor's init,
   `showRing` persisted.
6. **The address bar.** Delete `url-state.js`, clear a stale hash, drop the
   hash from `boot/params.js` and its tests.
7. **Docs.** SPEC.md §boot and §desktop state, the README's `?file=` paragraph
   and the in-app Read Me if it names the URL.

## 5. Kit asks

None expected. Pins, `adopt({ pin })`, `bringToFront` and the stacking order all
exist in vintage-frames 0.12.1.

## 6. Decisions

All nine settled 2026-09-17, each as recommended.

1. **Where the state lives.** _Decided:_ the existing localStorage blob at
   v4. It already has the write lifecycle (debounce, hide, unload) and the icon
   positions beside it. The alternative, a row in IndexedDB, buys nothing here
   and adds an async read to the boot.
2. **The hash.** _Decided:_ delete the mirror, clear a stale `#name` at boot,
   keep `?file=` as the documented deep link. Alternatives: keep the hash as a
   read-only link (two spellings of one thing), or keep the mirror (the
   session in the address bar, which is what the ask is removing).
3. **`?file=` against a restored desktop.** _Decided:_ it opens its document
   after the restore and comes to the front, adding to the session. The
   alternative — it replaces the session — makes a shared link destroy the
   recipient's desktop.
4. **Windoid geometry.** _Decided:_ restore it. A moved Tools palette that
   snaps back every reload is the same complaint as a moved icon. Arrange
   Windows is the way back to the derived layout. The alternative is to treat
   the windoids as furniture and always re-derive them.
5. **Stacking order.** _Decided:_ restore the order among document, folder
   and text windows; leave the windoids in markup order, which keeps the Tools
   palette on top. The alternative, a single interleaved order, restores a
   windoid buried under a document window, which is rarely what was meant.
6. **The 3D Sprite Atlas toggle.** _Decided:_ persist `showRing` with the
   window state. It is a window. Leave `autoRotate` and `singleLayer` at their
   defaults each load: they are view toys, not places.
7. **A document that is gone.** _Decided:_ skip it silently. It was deleted
   or trashed since; a desktop that opens without it is the honest answer, and
   an alert at boot is not.
8. **Untitled documents.** _Decided:_ leave them unrestorable, as today. The
   alternative is autosave, which SPEC.md rules out.
9. **Where the restore lives.** _Decided:_ `src/boot/restore.js`, called from
   `main.js`. `bootDocuments()` is already the longest thing in the composition
   root.

## 7. Tests

By `docs/TESTING.md`: unit tests only, for pure logic.

- `test/desktop-state.test.mjs` gains the v3 → v4 case: the widened `windows`
  survives, v3 folder entries arrive without a `z`, `activeFileId` becomes
  `active`.
- `test/params.test.mjs` loses its hash cases with the hash.
- Nothing else. The restore itself is wiring and geometry, verified by eye:
  open two documents, a folder and a read-me, move them, reload, and see the
  same screen.

## 8. Follow-ups

- The current tool, ink and per-document selection could join the session.
- A folder window's scroll position.
- The Finder's per-session `remembered` map is the saved map in miniature; once
  the saved map is live it could go.
- Close the window, forget the box: a key is kept forever today. A cap or a
  sweep of keys whose file is gone.

## 9. Files touched

- `src/shell/desktop-state.js` — v4, the migration, `showRing`, `active`.
- `src/shell/url-state.js` — deleted.
- `src/boot/restore.js` — new.
- `src/boot/params.js` — the hash goes.
- `src/main.js` — the merged readers, the restore, the cleared hash.
- `src/apps/sprite-editor/windows.js` — `pins()`, saved windoid pins.
- `src/apps/sprite-editor/index.js` — the `pins` action.
- `src/apps/text-viewer/windows.js`, `index.js` — `pins()` and its action.
- `src/apps/finder/windows.js`, `index.js` — `z` in `pins()`, an `openFolder`
  action.
- `src/state/prefs.js` — `showRing` from the saved state.
- `test/desktop-state.test.mjs`, `test/params.test.mjs`.
- `docs/SPEC.md`, `README.md`.
