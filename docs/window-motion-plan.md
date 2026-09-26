# Plan: window motion

**Status:** drafted 2026-09-26. Every decision taken 2026-09-26 as
recommended (§7). Steps 1 to 8 landed 2026-09-26 and shipped as app
v0.3.24; the engine is unchanged. Every eye check in §8 is open. The ask: _"we have a new vintage
frames version: vintage-frames@0.12.3 please update our deps... then look
into the new mechanism for animating the document window open and close into
and out of icons... write up a plan for how best to use the new vintage
frames component interfaces to compose them into an authentic seeming desktop
environment"_

The short version: 0.12.3 gives a window two motions and an icon one
measurement. `vf-window.show({ from })` and `hide({ to })` run the Finder's
zoom rects between any viewport box and the window's frame. `outline-drag`
moves a window as a dotted outline and writes it once on release.
`vf-icon.cellRect()` is the box to hand them. The kit knows nothing about
icons and files, so the work here is deciding which windows come out of which
icon, when, and what the icon shows meanwhile. The engine does not change,
and nothing is asked of the kit.

"Zoom rects" is the kit's name for the open and close motion. It has nothing
to do with a window's zoom box (`vf-zoom`), which this plan leaves alone.

## 1. The model we copy

- **The Finder's zoom rects.** Opening a folder drew dotted rectangles
  growing from its icon out to the window's frame, and the window drew when
  they arrived. Closing it drew them back into the icon. An application's own
  windows appeared and went at once; the Window Manager drew no rects. This
  plan extends the Finder's folder behavior to every window that shows a
  file, which is what the ask is for: a document window comes out of its icon
  and goes back into it.
- **Windows dragged as an outline.** DragWindow moved a dotted outline of the
  window while the window stayed put, and moved the window once on release.
  Every window dragged this way, floating windows included.
- **One thing at a time.** The Finder opened a selection of several items in
  turn, each window's rects finishing before the next began.
- **Floating windows and dialogs never zoomed.** Palettes hid and showed at
  once with their application, and a dialog appeared where it was going to
  be.

## 2. What the kit gives (0.12.3)

From the kit's SPEC §5 (`vf-window`, `vf-icon`) and FINDER.md §Opening:

- **`win.show({ from })`**, a `Promise<boolean>`. Clears `hidden`. With
  `from`, a box in viewport CSS px, it runs 14 dotted rects from the box
  toward the window's border box, four on screen at a time, 17 ms a step, and
  the window paints after the eighteenth step (306 ms). Until then it
  matches `:state(opening)`: laid out, focusable and a hit target, painting
  nothing. Writes to its box in the same task land before the rects measure.
  It raises and activates nothing. On a window already on screen it blanks
  the window for the run, so an open that finds its window raises it
  instead.
- **`win.hide({ to })`**, a `Promise<boolean>`. Reads the frame at the call,
  sets `hidden`, and runs the same rects in toward the box. Removing the
  window straight after leaves them running on the desktop. A `hide()` on a
  window still opening cancels the opening and hides at once.
- **For both**: a press anywhere or Escape finishes the rects, and the press
  lands. Without a box, under `prefers-reduced-motion`, or with no
  `vf-desktop` on the window's path, the window shows or hides at once and
  the promise resolves `false`.
- **`icon.cellRect()`**: the 32×32 art cell's viewport box whatever the icon
  wears (`open`, `selected`), or `null` while the icon isn't rendered.
- **`outline-drag`** on a `movable` window: the title-bar drag moves an
  outline, clamped where the window can land, and the release writes the box
  once (one `vf-placement-change`). Escape or a cancelled pointer writes
  nothing.
- **The cadence**, exported: `WINDOW_RECT_STEPS` (14),
  `WINDOW_RECTS_VISIBLE` (4), `WINDOW_RECT_STEP_MS` (17),
  `WINDOW_RECT_RATIO` and `windowRectFraction(k)`. The kit calls them
  provisional.

## 3. What we have

| Window           | Owner                              | Opens                                                                        | Closes                                                                    |
| ---------------- | ---------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Folder, Trash    | `apps/finder/windows.js`           | icon `vf-open`, File → Open, restore                                         | close box, ⌃W, record gone (Empty Trash), HMR                             |
| Read-me          | `apps/text-viewer/windows.js`      | icon `vf-open`, restore                                                      | close box, ⌃W, Quit, record gone, HMR                                     |
| Document         | `apps/sprite-editor/windows.js`    | icon `vf-open` → `openDoc`; New, a dropped PNG, Duplicate, `?file=`, restore | close box and ⌃W → `closeContext` (dirty-checked) → `syncDocs`; Quit; HMR |
| Desktop Patterns | `apps/desktop-patterns/windows.js` | the Sprite Machine menu                                                      | close box, ⌃W, Quit                                                       |
| Windoids         | `apps/sprite-editor/windows.js`    | the Sprite Editor comes front                                                | it leaves the front; the atlas strip's close box                          |

- Every close is `windows.release(win); win.remove()`, at once.
- The Finder's reconciler derives each icon's `open` ghost from the model:
  a document's from its context (`workspace.byFileId`), a read-me's from
  `windows.isOpen`, a folder's from `folders.isOpen`. All three go false the
  moment the window goes.
- `openSelection` opens several icons `OPEN_BEAT_MS` (140 ms) apart.
- Every window is `movable`; none is `outline-drag`.
- A document window is made by the workspace reconciler (`syncDocs` →
  `createDocWindow`), not by `openDoc`, so the open that knows the icon is
  not the code that makes the window.

## 4. Who owns what

| Piece                                                               | Owner                       | Why                                                        |
| ------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------- |
| The rects, the outline, their cadence, interruption, reduced motion | kit, shipped                | Not reopened.                                              |
| Hide before release and removal (`windows.dismiss`)                 | shell                       | An ordering rule every owner shares; names no application. |
| Which icon a file's window opens from and closes into (`iconBox`)   | Finder                      | Icons are the Finder's.                                    |
| When the ghost clears (`holdGhost`)                                 | Finder                      | The reconciler owns `icon.open`.                           |
| Whether an open or a close zooms, and from what box                 | each owner                  | What a window's open and close mean is its application's.  |
| The beat between several opens                                      | Finder                      | `openSelection` is the Finder's.                           |
| `outline-drag`                                                      | each owner's `windows.html` | Markup.                                                    |

The Text Viewer and the Sprite Editor reach `iconBox` and `holdGhost` through
`deps.apps[FINDER]`, read at each call. The shell learns nothing about icons.

## 5. The design

### 5.1 Outline drag

`outline-drag` beside every `movable` in the four `windows.html`: folder
windows, read-me windows, Desktop Patterns, document windows and the five
windoids (decision 7). Nothing else changes. The shell already notifies
layout a task after `pointerup` (`shell/windows.js` `onRelease`), which now
reads the one write the release makes; a cancelled drag writes nothing and
the notify finds nothing changed. The clamp is the kit's, the same one the
live drag uses.

### 5.2 `windows.dismiss(win, to)`

One call for every close in every owner:

```js
/** Closes a window into `to`, a viewport box, or at once without one, then
 *  releases and removes it. hide() reads the frame, so it runs first.
 *  Resolves when the zoom rects are done. */
dismiss(win, to = null) {
  const landed = win.hide({ to });
  release(win);
  win.remove();
  return landed;
}
```

It replaces the `release` + `remove` pair in the four owners, the HMR
disposes and Desktop Patterns included (those pass no box), and `release`
leaves the manager's API.

### 5.3 The Finder's two actions

- **`iconBox(key)`**: the item's icon's `cellRect()`. When that is `null`
  (the icon's folder window is closed), the nearest enclosing folder whose
  icon is rendered (decision 3), walking `enclosingFolders` from the item's
  container. Desktop icons are always rendered, so the walk ends in a box
  unless the record is gone (emptied from the Trash), and then `null`: the
  window hides at once.
- **`holdGhost(key, until)`**: keeps `open` set on the key's icon until every
  hold on it has settled, then re-runs the reconciler (decision 4). The
  reconciler reads `held(key) || <today's reading>`.
- Each `vf-open` handler reads the box at the gesture and passes it on:
  `openDoc(id, { from: icon.cellRect() })`, `open(id, { from })` for a
  read-me, `folders.open(id, { from })`.

### 5.4 Folders and the Trash

- `folders.open(id, { from })`: a new window, after its adopt and raise,
  calls `win.show({ from })`. A window already open is raised only, as now.
- The user's closes (close box, ⌃W) record the pin and fire `willClose` as
  now, then close through `windows.dismiss` into `iconBox(key)` and hold the
  ghost until it lands. The model's close (a record gone) and the HMR
  dispose pass no box.
- `initFolderWindows` cannot import the icon layer, which takes it as an
  argument, so it takes `iconBox` and `holdGhost` in its options, bound in
  the Finder's `index.js` and read at each close.

### 5.5 Read-mes

The same shape as folders. `texts.open(id, { from })` carries the box
through the text read and shows the window once it exists. The close box,
⌃W and Quit close into `iconBox('text:<id>')` through `deps.apps[FINDER]`;
the listing sync and dispose close at once.

### 5.6 Documents

The window is made by the reconciler, not by `openDoc`:

- `workspace.openStored` resolves `{ ctx, existed }`, and the reconciler
  appends the window inside it, synchronously. So `openDoc(id, { from })`
  passes the box to `showDocument(key, { from })` only when `existed` is
  false, and `show()` runs in a microtask of the same task, before the
  window has painted. An open that finds the document already open passes
  no box, and the window is raised, as now. (Drafted as a pending
  `openFrom` map consumed by `createDocWindow`; `existed` made it
  unnecessary.)
- `syncDocs` closes a window whose context has gone with
  `windows.dismiss(win, iconBox('doc:<fileId>'))` and holds the ghost.
  Contexts go only through `closeContext` and Quit, so every such close is
  the user's. An untitled document has no icon and hides at once; after its
  first Save it has one and closes into it.
- The dirty check runs first, so the rects start from the window's frame
  when the unsaved-changes alert is answered.
- When the last document closes, the windoids hide at once as the Sprite
  Editor leaves the front, and the document's rects run on.

### 5.7 Several opens

`openSelection`'s beat becomes one rect run, from the kit's numbers:
`(WINDOW_RECT_STEPS + WINDOW_RECTS_VISIBLE) * WINDOW_RECT_STEP_MS`, 306 ms
today (decision 5). A document or a read-me waits on IndexedDB before its
window exists, so its rects can overlap the next open's by that wait. Under
reduced motion the beat stays 0.

### 5.8 What stays at once

- Windoids, dialogs, alerts and the About box.
- Desktop Patterns: it opens from a menu, and there is no icon.
- New and New Sprite (untitled), a dropped PNG, Duplicate's copy, `?file=`,
  the session restore and an HMR rebuild (decision 2).
- A window already open: raised, never shown again.
- The zoom box and ⌘J: the size changes at once.

## 6. Kit asks

None. 0.12.3 covers every piece. Two System 7 window behaviors the kit lacks
are follow-up candidates (§10), not asks yet.

## 7. Decisions

All seven taken 2026-09-26, each as recommended.

1. **Which windows zoom.** Recommended: every window that shows a file:
   folders, the Trash, documents and read-mes. The alternative is folders
   and the Trash only, the System 7 Finder exactly; documents and read-mes
   appear and go at once, as an application's windows did.
2. **Which opens zoom.** Recommended: only an open the icon started: a
   double-click, a double-tap, File → Open. The alternative zooms any open
   of a file whose icon is on screen, so Duplicate's copy grows out of its
   new icon, and the session restore then needs its own opt-out.
3. **A close whose icon isn't shown.** Recommended: into the nearest
   enclosing folder whose icon is shown, ending at the desktop. A trashed
   document closes into the Trash. The alternative is at once, the kit's
   reading of a `null` box: a document in a closed folder closes with no
   motion while the same document on the desktop zooms.
4. **The ghost at close.** Recommended: held until the rects land, the kit's
   own recipe (FINDER.md), so the rects close into a hollow icon that then
   fills in. The alternative clears it as the window goes, as now.
5. **Several opens.** Recommended: one after another, the beat one rect run
   (306 ms). The alternative keeps 140 ms and the runs overlap, three
   windows' rects on screen together.
6. **Several closes (Quit).** Recommended: at once, each window into its own
   icon. The alternative goes front to back a run apart: the windows still
   to close stay up until their turn, and Quit's unsaved-changes alerts
   interleave with the rects.
7. **Outline drag.** Recommended: every movable window, windoids included,
   as DragWindow did. The alternatives: the document tier only, so a palette
   moves live while you place it; or none, keeping the live drag everywhere.

## 8. Steps, each landing green

1. **The bump.** Done 2026-09-26: vintage-frames `^0.12.3`, `package.json`
   and the lockfile, the four gates green. No visible change is expected.
   The kit moved the rubber band and the icon drag outline onto one shared
   pen canvas with the same recipe; by eye, drag an icon and draw a rubber
   band on the desktop and in a folder window, and both look as before.
2. **Outline drag** (§5.1). By eye: drag a document window, a folder window,
   the Read Me, Desktop Patterns and each windoid by its title bar. A dotted
   outline follows the pointer, the window stays put until the release, then
   moves once. Escape mid-drag leaves it where it was. The outline stops at
   the same edges the live drag did. View → Arrange Windows enables after a
   drag off the arrangement.
3. **Folders and the Trash** (§5.2 to §5.4). By eye: double-click a folder.
   Rects grow from its icon and the window draws; the icon goes hollow at
   once. Close it with the close box: the window goes, the rects close into
   the icon, and the icon fills in as they land. ⌃W the same. The Trash the
   same. Double-click an open folder's icon: it comes forward with no rects.
   Click during the rects: they finish and the click lands. With Reduce
   Motion on (System Settings → Accessibility → Display): everything at
   once. Reload: the restored windows appear at once.
4. **Read-mes** (§5.5). By eye: the same for the Read Me, and the Text
   Viewer's Quit with two read-mes open.
5. **Documents** (§5.6). By eye: double-click the Car. Rects from its icon,
   then the window; the windoids appear at once. Close it clean: into the
   icon. Draw a stroke, close, answer Don't Save: the rects start from where
   the window was. New…: opens and closes at once. Save it, close it: into
   its new icon. Duplicate: the copy opens at once (decision 2).
6. **Closing into a folder** (§5.3, decision 3). `enclosingFolders` in
   `state/files.js` and its test. By eye: open a document, file its icon
   into a folder whose window is closed, close the document: the rects close
   into the folder's icon. Drag an open document to the Trash and close it:
   into the Trash.
7. **Several opens** (§5.7). By eye: select three folders and press ⌘O.
   Each window's rects finish before the next begin.
8. **The words.** README §Icons: a window grows out of its icon and shrinks
   back into it; where the README and the in-app read-me say how to move a
   window, an outline follows the pointer. SPEC §Windows, §Documents are
   windows, §Folders, §The Trash and §Desktop icons & state. This plan's
   status line.

Steps 2 to 7 are one app patch: visible, additive behavior. The engine does
not change and does not bump.

## 9. Tests

By `docs/TESTING.md`. The one new pure function with rules is
`enclosingFolders(state, folder)` in `state/files.js`, so it gets a case in
`test/files.test.mjs` on its contract: innermost first, the desktop ends the
chain, a missing record ends it, a loop stops at its first repeat. It exists
only if decision 3 goes as recommended. Everything else is wiring and look,
checked by eye in §8. No test on the beat or the kit's constants.

## 10. Follow-ups

- **Option-click a close box** closes every window of the application, as
  the System 7 Finder did. The kit's `vf-close` carries `{ reason }` only, so
  the modifier has to come from the kit: a kit ask candidate.
- **⌘-drag a background window's title bar** moves it without bringing it
  forward, as DragWindow did with ⌘ held. A kit ask candidate.
- **Several closes a beat apart**, if decision 6 is revisited.
- **An icon scrolled out of its folder window's view** still has a box, so
  the rects close to where it sits outside the viewport. Clamp the box to
  the viewport if that reads wrong by eye.

## 11. Files touched

| File                                                | What                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| `package.json`, `package-lock.json`                 | vintage-frames `^0.12.3` (done)                                          |
| `src/shell/windows.js`                              | `dismiss(win, to)`                                                       |
| `src/apps/finder/icons.js`                          | `iconBox`, `holdGhost`, the ghost reading, `from` on each open, the beat |
| `src/apps/finder/windows.js`                        | `open(id, { from })`, closes through `dismiss` with the ghost held       |
| `src/apps/finder/index.js`                          | the two actions, bound into the folder windows; ⌃W into the icon         |
| `src/apps/text-viewer/windows.js`, `.../index.js`   | `open(id, { from })`, closes into the icon                               |
| `src/apps/sprite-editor/windows.js`, `.../index.js` | `showDocument(key, { from })`, `dismiss` in `syncDocs`, the options      |
| `src/apps/desktop-patterns/windows.js`              | `dismiss`, at once                                                       |
| `src/apps/*/windows.html`                           | `outline-drag`                                                           |
| `src/state/files.js`, `test/files.test.mjs`         | `enclosingFolders` and its case (decision 3)                             |
| `README.md`, `docs/SPEC.md`                         | §8 step 8; the in-app texts say nothing about moving windows             |
