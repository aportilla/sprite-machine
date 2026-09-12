# Plan: the top-right lattice and Clean Up

**Status:** proposed 2026-09-12, the four decisions answered the same day
(§6) and **BUILT** as written. The same day the user asked for the
Finder's _walk_ — one icon at a time, each outline travelling to its cell
— which was kit ask #16, not app code; it **SHIPPED in vintage-frames
0.10.0** the same day as `vf-icon-field.dragIcons`, and Clean Up walks on
it (§7). The ask: _"on classic macs, new file icons
on the desktop were layed out from the top right corner, not the left
side. Could you replicate the default icon placement heuristics? Also add
a 'Clean Up Window' command to the finder special menu and a 'Clean Up
Desktop' command for when the finder is active but no window is
focused... these command snap the icons to a nearest grid placement"_.

The short version: the desktop's default lattice turns around — a column
down the **right** edge from just below the menu bar, folding into further
columns to the **left** — and the Finder's Special menu gains the one
contextual item System 7 had there, **Clean Up Window** with a folder
window front and **Clean Up Desktop** without, which snaps every icon in
that container onto the container's own lattice, each to the nearest free
cell. The two share one piece of arithmetic: a **lattice** — cell (0,0),
the step per column and row, how many of each fit, and which way the cells
fill — from which the default placement reads slot _n_ and Clean Up reads
the nearest cell. README §Desktop icons & state and §The Finder's menus
are the as-built passages.

## 1. What the Finder did (the model we copy)

- **Icons on the desktop went to the top right.** A mounted volume landed
  under the menu bar at the right edge; the next one under it; the column
  filled downward and then folded into a second column to its left. The
  Trash sat in the bottom-right corner, in that same first column. The
  left of the screen was left clear — that is where windows opened.
- **Inside a window** icons filled the other way: a row from the top-left
  corner, wrapping down at the window's width. That is what this app
  already does (`folderLattice`), and it does not change.
- **Special → Clean Up** aligned the icons of the front container to the
  invisible grid every icon was placed on, each icon moving to the cell
  nearest where it already sat — an alignment, never a re-flow: the
  arrangement the user made survived, only its slop went. The item named
  its object: _Clean Up Window_ with a Finder window frontmost, _Clean Up
  Desktop_ with none. (System 7 also had _Clean Up by Name_ and _Clean Up
  Selection_ under modifier keys — a follow-up at most, §7.)
- No key equivalent, as System 7's Special menu gave none.

## 2. The design

### 2.1 One lattice, two readers

`apps/finder/layout.js` gains a `Lattice` — pure, no DOM, as everything in
that file is:

```text
{ left, top,      // cell (0,0)'s top-left
  dx, dy,         // the step per column (NEGATIVE leftward) and per row
  cols, rows,     // how many of each the container holds (may be Infinity)
  down }          // true: the cells FILL a column at a time, else a row
```

- `desktopLattice(w, h)` — cell (0,0) at the raster's top right,
  `ICON_EDGE` (16) in from the right edge and the same 16 below the
  **menu bar** (top = 36, decision 2); `dx` −80 and `dy` 72, the pitches
  the desktop and the folder windows already share; `cols` the columns
  whose cell still starts on the raster, `rows` those that fit above the
  bottom edge's own 16 inset; `down` true.
- `folderLattice(innerWidth)` — the window's, unchanged in every number:
  the 16 inset, +80 across, 72 down, `cols` at the plane's width, `rows`
  Infinity (the plane scrolls), `down` false.
- `latticeSlot(grid, n)` — where item _n_ goes with nothing saying
  otherwise. This is `iconDefault` / `iconGridDefault` folded into one:
  the icon layer's `nextFree` walks slots through it exactly as before,
  so a new document, a new folder, a paste and a drop onto a folder icon
  all take the first free cell of the container's lattice with no change
  to how they ask for it.
- `cleanUp(grid, positions)` — §2.3.

`trashDefault` is untouched: the bottom-right corner, the same 16 inset,
the one icon whose default is not the lattice's next free cell. It is now
the **bottom of the same column** the lattice fills from the top, which is
exactly where System 7 kept it.

### 2.2 What turns around, and what does not

Only the desktop's default lattice. A saved position still wins over it; a
drag still lands where it is let go; `ICON_FRAME` and the nine-slice
re-pin are unchanged — except that the default column is now a **far**
strut (it keeps its 16 from the right edge on any width) where it used to
be a near one. The row count is read off the live raster as before, so a
squat raster still folds the column instead of marching it off the bottom.

The consequence worth stating: while the **Sprite Editor** is front, its
right-hand rail (the Sprite View over the 3D View) covers that column —
as its options strip covers the top band. Both are the application's
chrome and both hide the moment the desktop takes focus, which is the
reading `ICON_FRAME` already committed to (the strip reserves nothing
above an icon) and what a System 7 window did to the icons behind it.

### 2.3 Clean Up, the arithmetic

`cleanUp(grid, positions)` returns one position per input, in input order:

1. Each icon's **ideal cell** is its current position rounded onto the
   lattice, clamped into the lattice's extent — so an icon parked past the
   last column or row is gathered back in, and nothing lands off-raster.
2. The icons are served in the lattice's own reading order (row, then
   column, then input order), each taking the **nearest free cell** to
   where it actually sits — cells are searched outward from the ideal one,
   the nearest by true pixel distance among those at the same remove.
   So two icons that round onto one cell part instead of stacking, and the
   one that was closest keeps it.
3. The cells are handed to the kit's walk as they are (§7): it resolves
   each landing as a drop's — clamped whole, snapped — so the app writes
   no position itself, and the lattice already keeps every cell below the
   menu bar.

That assignment is all of Clean Up the page owns. The kit ships no lattice
— its walk takes `{ icon, left, top }` targets and moves icons to them — so
_which_ cell each icon goes to is this function, and _how_ it gets there is
the kit's.

The Trash is cleaned up **like any icon** (decision 3). Its corner sits
between two rows of its own column — 16 up from the raster's bottom edge,
where the rows run on a pitch from the top — so the first Clean Up Desktop
nudges it up onto the last row of that column (16–66px, the raster's
leftover), and it sits on the lattice from then on.

**One thing the lattice's turn forced, found in the build:** `nextFree`
asked whether an icon sat on a cell _within half a cell_, which is a
reading of icons that are themselves on the lattice. The Trash is not —
and it now shares the default column, so on a raster whose last row lands
within 64px of the corner an 11th arriving icon was placed over the can.
The test is now whether some icon's 64px **plate overlaps the cell** at
all. For icons on the lattice the two readings are identical (both pitches,
80 and 72, are wider than the plate, so neighbours never block each other);
they differ exactly for an icon parked off it — a drag's landing, or the
Trash — where "don't put a new icon on top of that art" is what was meant
all along.

### 2.4 The menu

One item at the head of the Special menu — where System 7 kept it, above
Empty Trash… — `value="clean-up"`, its label written by the Finder's
existing `syncGate` off `folders.activeFolder()`: `Clean Up Window` when a
folder window holds the desktop's active state, `Clean Up Desktop`
otherwise (decision 1). While the Finder is front those are the only two
readings there are — a document window active means the Sprite Editor is
front, and the Finder's menus are off the bar then. The item is **never
greyed** (decision 4): picking it on a container that is already tidy
moves nothing. No key equivalent.

The pick calls `icons.cleanUp(folders.activeFolder())` — the icon layer's
new verb, which reads the container's field, computes the assignment and
writes it, then re-fits a folder window's field extent. The positions
persist by themselves: `positions()` reads the live icons at the next
snapshot.

## 3. Steps, each landing green

1. **The lattice** — `apps/finder/layout.js`: `Lattice`,
   `desktopLattice`, `folderLattice`, `latticeSlot`, `cleanUp`;
   `iconDefault` / `iconGridDefault` retired into them. `icons.js` asks
   for a grid instead of a slot function. The desktop's icons come up at
   the top right.
2. **The command** — `icons.cleanUp(folder)`, the Special menu's item,
   its label in `syncGate`, the handler.
3. **The words** — README §Desktop icons & state (the lattice's
   direction), §The Finder's menus (the Special menu), §The Trash (the
   "one item until Clean Up joins it" line), the "Not yet: … no Clean Up"
   line, and the headers of `layout.js` / `icons.js`.

## 4. Kit asks

None. Every position write is the kit's own `left` / `top`, and the kit
re-measures a folder window's scroll range off `vf-placement-change` by
itself.

## 5. Tests

`docs/TESTING.md`'s default is no new test, and the placement, the label
and the look are verified by eye. Two exceptions, both pure arithmetic in
`test/finder-layout.test.mjs`:

- the existing icon-pin test, **updated** — the default column is a far
  strut now, so it keeps its 16 from the **right** edge on any width;
- one new test for `cleanUp` — an off-grid set lands on cells, no two
  icons on one cell, an already-tidy set does not move.

Nothing pins the lattice's direction, the item's copy or its gate.

## 6. Decisions (answered 2026-09-12)

1. **One contextual item**, not two — _Clean Up Window_ / _Clean Up
   Desktop_, System 7's own. (The ⌘J precedent is the other way: there the
   command never changed, only its wording, so the label was fixed. Here
   the object changes, which is what the name is of.)
2. **The column starts below the menu bar** — top 36, the menu bar's 20
   plus the right edge's own 16 — not below the options strip's band.
3. **The Trash cleans up like any icon** — not left alone, not sent home.
4. **The item is never greyed** — no "already tidy" reading, and so no
   positions-changed signal in the icon layer.

## 7. Follow-ups

- **The walk — BUILT on vintage-frames 0.10.0** (the user's follow-up ask,
  the same day): Clean Up moves the icons _one at a time_, each icon's
  dotted outline travelling from where it sat to its cell before the icon
  lands — the Finder's own Clean Up. Every piece of that was the kit's and
  none of it reachable from a page, so it was **kit ask #16**
  ([kit-asks-icon-move.md](kit-asks-icon-move.md)), with nothing app-side
  in the meantime; it shipped as `vf-icon-field.dragIcons(moves)` (and
  `vf-icon.dragTo` / `moveTo` beneath it). The icon layer hands the kit
  the moves — the cells as `cleanUp` assigned them, sorted by the new
  pure `fillOrder` (down the desktop's column and on leftward, across a
  window's rows) — and the kit owns the cadence, the outline, the
  press-or-Escape finish and reduced motion. A browser resize finishes a
  walk before the icons re-pin, and the desktop state is told when the
  walk lands (`onMoved`), since no gesture ends it.
- _Clean Up by Name_ / _Clean Up Selection_ (System 7's modifier
  variants), and a re-flow that closes gaps rather than aligning in place.
- _Put Away_ ⌘Y, still open from the Trash plan.
- An automatic Clean Up on a raster that shrank past the column — today
  the nine-slice pin carries the icons instead, which is the right rule.

## 8. Files touched

| File                          | What                                                                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/apps/finder/layout.js`   | the `Lattice`, `desktopLattice`, `folderLattice`, `latticeSlot`, `cleanUp`; `iconDefault` / `iconGridDefault` retired; `ICON_COL_X` → `ICON_EDGE`, `ICON_ROW_Y0` → `ICON_TOP` |
| `src/apps/finder/icons.js`    | `gridFor` / `rootOf` / `nextFree` on the lattice (the free-cell reading now the plate's overlap, §2.3), the `cleanUp(folder)` verb, the header and the re-pin comment         |
| `src/apps/finder/menus.html`  | the Special menu's `clean-up` item                                                                                                                                            |
| `src/apps/finder/index.js`    | the pick, the label in `syncGate`, the header                                                                                                                                 |
| `test/finder-layout.test.mjs` | the far-strut column, the `cleanUp` test                                                                                                                                      |
| `README.md`                   | §Desktop icons & state, §The Finder's menus, §The Trash, the "Not yet" line                                                                                                   |
| `package.json`, lockfile      | the walk: vintage-frames `^0.9.0` → `^0.10.0`                                                                                                                                 |
| `src/shell/desktop-state.js`  | the walk: `start({ onMoved })`, a write scheduled when a gestureless move lands                                                                                               |
| `src/main.js`                 | the walk: the Finder's `onMoved` handed to the desktop state                                                                                                                  |
