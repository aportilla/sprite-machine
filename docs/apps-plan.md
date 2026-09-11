# Plan: three applications, one menu bar — the apps formalized

**Status:** proposed 2026-09-11, on the ask: _"formalize our 'apps' … we
have 3 apps, the 'Finder', the 'Text Viewer', and the 'Sprite Editor'. Each
should have its own 'menu', as in classic System 7. Right now we just have
one menu serving all three. … each app defined using a normalized pattern
within its own directory … Rather than the fixed 'apple logo' in the top
left of the main menu, that position will be our 'Sprite Machine' menu item,
which serves the same role and will be present for all apps."_ **Built
2026-09-11**, every step of §4 and every recommendation of §6 as stated
(the user's eye pending on the lists in §4): `src/apps/` with the three
directories and the registry, `shell/menu-bar.js` the bar's owner,
`shell/menus.js` dissolved, `shell.frontApp` beside `appActive`, Empty
Trash… in the Finder's Special menu, the Text Viewer's Quit and Edit menu,
Arrange Windows in all three View menus; README §Three applications, one
menu bar and §Menu bar are the spec as built. One addition beyond the
plan: `windows.addPanel` re-reads the active window after registering a
panel's application, so the front application is right whichever order an
owner appends, adopts and raises in. The decisions in §6 are the user's;
the steps in §4 assumed the recommendations where nothing was decided.

The short version: **the menu bar belongs to the front application, and the
front application is a reading of the desktop's active window** — a
document window means the Sprite Editor, a text window the Text Viewer, a
folder window, the Desktop Patterns panel or nothing at all the Finder. The
leftmost menu, **Sprite Machine**, is the Apple menu's seat and role: one
menu, in every application, with About…, Desktop Patterns and whatever else
is the machine's rather than an application's. To its right the bar holds
**the front application's menus and no other's**: the Finder's File / Edit /
View / Special, the Sprite Editor's File / Edit / Tools / View, the Text
Viewer's File / Edit / View — swapped on every change of the active window,
the same moments the windoids hide and return today. The clock keeps the
bar's right end. Each application is **one directory under `src/apps/`**
holding its menus as markup and one module that wires them, on one shape,
so a fourth application is a fourth directory. Nothing in the kit is asked
for (§5): the bar already takes menus coming and going, and a menu that
leaves the bar takes its key equivalents with it — which is what retires
most of today's role gating. One test-visible change and a handful of
follow-ups fall out of putting every command where System 7 put it (§6).

## 1. What System 7 did (the model we copy)

- **The menu bar was the front application's.** The Apple menu sat at the
  left in every application — About _the front application_…, then the
  desk accessories and, in 7.5, the control panels; the application's own
  menus followed; and at the right end the **Application menu** (the
  front application's small icon) listed the running ones and switched
  between them, with 7.5's clock to its left. Switching applications —
  clicking one of its windows, the desktop, or picking it from the
  Application menu — **replaced the menus** between the Apple menu and
  the Application menu wholesale: the Finder's File / Edit / View / Label /
  Special gave way to MacPaint's File / Edit / Goodies / Font / FontSize /
  Style, or TeachText's File / Edit.
- **The Finder's menus:** File (New Folder ⌘N, Open ⌘O, Print, Close
  Window ⌘W, Get Info ⌘I, Sharing…, Duplicate ⌘D, Make Alias, Put Away ⌘Y,
  Find… ⌘F, Find Again ⌘G, Page Setup…, Print Window…), Edit (Undo, Cut,
  Copy, Paste, Clear, Select All, Show Clipboard — over an icon's name
  being typed), View (by Small Icon, by Icon, by Name, …), Label, Special
  (Clean Up Window, Empty Trash…, Eject Disk, Erase Disk…, Restart, Shut
  Down). The Finder had **no Quit**.
- **TeachText's menus:** File (New, Open…, Close, Save, Save As…, Page
  Setup…, Print…, Quit) and Edit (Undo, Cut, Copy, Paste, Clear, Select
  All). A read-me opened read-only: Copy and Select All live, the rest
  grey.
- **A key equivalent was the front application's** — ⌘S in the Finder did
  nothing, since the Finder's menus held no ⌘S — and the bar flashed the
  menu the command lived in.

This machine already speaks most of this: the desktop click deactivates
the application and the windoids hide (README §One machine, two roles); a
text window is "another application's window"; the Sprite Machine menu
holds About… and Desktop Patterns in both roles. What it lacks is the
**swap**: one bar's five menus serve every role, and the role is expressed
by greying — a document-scoped item disabled in the Finder role, a
Finder-role item disabled in the application role, Close reading three
sources to know what it closes. And the Apple menu's seat is taken by a
text title today, which the ask keeps: the position is the **Sprite
Machine** menu's, the role the Apple menu's.

## 2. Where the code stands

### 2.1 The three applications, implicit

- **The Sprite Editor** — the document windows (`shell/windows.js`'s
  reconciler over the workspace), the four windoids, the options strip,
  the tool keys, and every document-scoped menu item. Its state is
  `shell.appActive`: "a document window is the desktop's active window".
- **The Finder** — the desktop's icon field, the folder windows
  (`shell/folders.js`), the Desktop Patterns panel (`shell/patterns.js`),
  the drag, the rubber band, Copy / Paste / Select All, New Folder, Empty
  Trash…. Its state is `!appActive` — "no document window is active".
- **The Text Viewer** — the text windows (`shell/texts.js`), TeachText's
  read-me windows, panels of the window layer. It has **no state of its
  own**: a text window front reads as the Finder role, which is why File →
  Close consults `texts.activeText()` beside `folders.activeFolder()`, and
  why ⌘C over prose selected in a read-me copies a selected _icon_ instead
  when one happens to be lit — the Finder's Copy is live, and the kit's
  key equivalent claims the stroke before the browser's native copy.

### 2.2 The menu bar, one for all

`index.html` authors one `<vf-menu-bar shortcuts>` with five menus — Sprite
Machine, File, Edit, Tools, View — and the clock; `shell/menus.js` (1,400
lines) wires every item, every dialog flow and every gate. The gates are
the role, spelled as `disabled`:

- `DOC_SCOPED` — sixteen items greyed while `!appActive` (Save, Duplicate,
  Rename…, Download, the exports, Pick Color…, Tile Size…, the ring toggle,
  the six tools).
- The Finder-role items — New Folder, Copy, Paste, Select All — greyed
  while `appActive`, plus their own readings (the selection, the front
  container, a focused text control).
- Close — live with a document window OR a folder window OR a text window
  active; Quit — live while any document is open, in either role; Arrange
  Windows — greyed arranged in the Finder role; the View menu's window
  tail — live in both roles as the way back to the application.

A greyed item claims no key (the kit's contract), so the same table gates
the key equivalents. It works, and it is the one-application design the
README describes: "Sprite Machine has exactly one application, so both
roles share one menu bar and one boolean decides everything."

### 2.3 What the kit gives, read from its source (vintage-frames 0.9.0)

Three facts carry the design, and none needs a kit change:

- **The bar takes menus coming and going.** `vf-menu-bar` reads its menus
  through `queryAssignedElements` on every access and re-syncs on
  `slotchange` (`vf-menu-bar.ts` `#onSlotChange`): a menu removed while
  open closes the bar's state, a stale roving Tab stop is dropped, and the
  press-drag gesture, the arrow keys and the title hit-test all read the
  live list. A `vf-menu` and a `vf-menu-item` both re-derive their ARIA on
  reconnect — "re-parenting between the two contexts must re-evaluate it"
  is the menu's own comment — so moving menus in and out of the bar is a
  supported use.
- **A detached menu claims no keys.** `vf-menu-item`'s key-equivalent ear
  is a document `keydown` listener added in `connectedCallback` and removed
  in `disconnectedCallback`, and the handler checks
  `closest('vf-menu[shortcuts], vf-menu-bar[shortcuts]')` per event
  (`vf-menu-item.ts` `#onDocKeydown`). So the Sprite Editor's ⌘S, off the
  bar, is inert in the Finder with no `disabled` written anywhere —
  exactly the Finder's own ⌘S doing nothing. A menu merely `hidden` would
  **not** do: its items stay connected and keep claiming, and the bar's
  arrow keys would still walk into it. **Detach, never hide.**
- **A menu's title can be a picture.** `vf-menu` has a `label` slot — "e.g.
  a `vf-img` apple icon for the Apple menu"; the kit's own site shows a
  16×16 `vf-img` in it (`vintage-frames/index.html`, the standalone menu
  example) — with the `label` attribute kept as the accessible name. The
  Sprite Machine menu can wear a glyph the day the user draws one (§6.3),
  in markup alone.

## 3. The design

### 3.1 The front application

One reading, in the one place the activation already lands. `shell` gains
`frontApp`, one of three ids — `'finder'`, `'sprite-editor'`,
`'text-viewer'` (constants in `state/shell.js`, the bottom of the
dependency arrows, so `shell/` and `apps/` both import them) — written by
`shell/windows.js`'s activation wire beside `appActive`, in **one patch**,
so the two can never disagree:

- the active window is a **document window** → `sprite-editor`;
- the active window is a **panel** → the panel's own application, which its
  owner declares at adoption: `windows.addPanel(win, boxFor, pin, { app })`
  — `texts.js` says `text-viewer`, `folders.js` and `patterns.js` say
  `finder`;
- **no active window**, or a panel that declares nothing → `finder`, the
  desktop's application and the default.

`appActive` stays, as `frontApp === 'sprite-editor'`: its consumers — the
windoids' visibility, the options strip, the tool keys, the icon layer's
selection clear — read exactly what they read today and need no change. The
mirror still seeds by reading `desktop.activeWindow` at wire-up (a fresh
boot: nothing active, the Finder front) and follows `vf-activate`
thereafter, one writer.

### 3.2 The application pattern

```
src/apps/
  index.js            the registry: APPS in one order, DEFAULT_APP
  finder/
    index.js          the definition — id, name, menus, init()
    menus.html        its vf-menu fragment: File, Edit, View, Special
  sprite-editor/
    index.js
    menus.html        File, Edit, Tools, View
  text-viewer/
    index.js
    menus.html        File, Edit, View
```

One shape, every application:

```js
// src/apps/finder/index.js
import menus from './menus.html?raw';

export const finder = {
  id: 'finder', // a state/shell.js constant
  name: 'Finder', // the bar's accessible name while front; the README's word
  menus, // the fragment: the vf-menu elements this application owns
  /** Wire the application's menus. `menus` are its live vf-menu nodes,
   *  parsed once from the fragment (attached to the bar or not); `deps`
   *  the shell's services (§3.6). Returns what the shell and the other
   *  applications may call, and the teardown. */
  init({ menus, deps }) {
    /* … */
    return { actions, dispose };
  },
};
```

- **The menus are markup**, in the application's own directory, a fragment
  of `vf-menu` elements imported whole (`?raw`, the text files' idiom —
  `src/env.d.ts` gains the `*.html?raw` declaration) and parsed once by the
  bar controller into live nodes. The fragment carries the same authored
  comments the bar's markup carries today; Prettier formats it like any
  HTML. **No `id`s in a fragment**: two applications may each hold a
  `value="new"` or a `value="close"` item, so an application addresses its
  menus by `data-menu="file"` and its items by `value`, **within its own
  nodes** (`menu.querySelector('vf-menu-item[value="save"]')`), never
  through the desktop — the one item whose value turns, Arrange Windows,
  wears a `data-item="arrange"`. The values are per application: the
  Finder's `close` closes a folder window, the Sprite Editor's a document.
- **`init` binds behavior to the nodes it is handed**, attached or not: a
  `vf-menu-select` listener on each menu (the item's event bubbles to its
  menu whether or not the menu is in the document), the item syncs
  (`disabled`, `checked`, the tail), and the dialog flows the application
  owns. Property writes on a detached `vf-menu-item` are ordinary Lit
  property writes: they hold, and render on the next connect.
- **`actions`** are the application's public verbs — what another
  application or the shell calls: the Sprite Editor's `openDoc(id)` (the
  icon layer's double-click), `newDocument()` (the New box — the Finder's
  New… calls it, §6.5), `confirmDiscard`, `closeContext`, `saveThen`; the
  Text Viewer's and the Finder's, none this cut.
- **The registry** (`src/apps/index.js`) is the list in one order —
  `[finder, spriteEditor, textViewer]` — and `DEFAULT_APP = 'finder'`.
  A fourth application is a fourth directory and one entry.

### 3.3 The menu bar controller

`shell/menus.js` gives way to **`shell/menu-bar.js`** — the bar's owner —
and the three application modules (§3.2). The controller:

- **Owns the Sprite Machine menu**, still authored in `index.html` at the
  bar's left — the Apple menu's seat: _About Sprite Machine…_ (the boot
  greeting too), _Desktop Patterns_, and _Empty Trash…_ until §6.4 moves
  it. Live in every application; its handler and the shared dialogs (the
  About box, the storage notice, the `modalOpen()` guard every handler
  keeps) live here.
- **Parses each application's fragment once** at wire-up — into the main
  document, so the elements upgrade at once (`createContextualFragment`,
  or a plain element's `innerHTML`; not a `<template>`, whose inert
  document is why the window templates need `importNode` + `upgrade`) —
  and calls its `init` with the nodes and `deps`.
- **Slots the front application's menus** between the Sprite Machine menu
  and the clock (`clock.before(...menus)`; the clock is a slotted
  `vf-label` and stays where `style.css` puts it), and on every change of
  `shell.frontApp` **removes the outgoing application's menus and inserts
  the incoming one's** — nodes moved, never rebuilt, so an item's state
  survives the trip and a menu reads on its return exactly as it was left.
  Also writes the bar's `label` — _Finder_, _Sprite Editor_, _Text
  Viewer_ — so the menubar announces whose it is.
- **Boots the Finder's bar**: nothing is active at boot, `frontApp` reads
  `finder`, and the About box greets over the Finder's menus, as it did
  over the Finder grammar. Synchronous, in `main.js`'s top level, so the
  first paint already shows the right bar.
- **Disposes** the applications and lifts the slotted menus at HMR
  teardown; `main.js`'s composition hands it what `initMenus` takes today
  and takes back `actions.showAbout` for the boot and the Sprite Editor's
  `openDoc` for the icon layer (late-bound, as now).

The swap's moments are the activation's: a press on the desktop or an icon,
a click into a folder or text window, a folder or text window opening, a
document window opening or clicked, the last window of an application
closing. Two edge readings, both the kit's own and accepted: a menu open at
the instant its application leaves the bar closes (the bar's `slotchange`),
and an item blinking at that instant cancels its blink and fires nothing
(`disconnectedCallback` cancels a pending activation) — neither can happen
from a pick, which closes the menu before its handler runs, only from a
click on a window during a blink.

### 3.4 The three menu sets

Every application: **Sprite Machine** — _About Sprite Machine…_, a rule,
_Desktop Patterns_ (and _Empty Trash…_, until §6.4).

**The Finder** — the desktop, the folder windows, the Desktop Patterns
panel:

| Menu    | Items                                                                                                                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| File    | _New…_ ⌃N (the one New — a document, through the Sprite Editor's action; §6.5), _New Folder_, a rule, _Close_ ⌃W (the front folder window or the Desktop Patterns panel; greyed with the bare desktop front) |
| Edit    | _Copy_ ⌘C, _Paste_ ⌘V, _Select All_ ⌘A — the clipboard plan's three, their own gates unchanged (the selection, the front container, a focused text control); no Undo, Cut or Clear (§6.10)                   |
| View    | _Arrange Windows_ ⌘J — the arrange alone, greyed while the screen is arranged (§6.7); _by Icon_ / _by Small Icon_ / _Clean Up_ are the folders plan's follow-ups and land here                               |
| Special | _Empty Trash…_ (§6.4), greyed while the Trash is empty; _Clean Up_ joins it one day, _Put Away_ goes to File                                                                                                 |

**The Sprite Editor** — a document window active:

| Menu  | Items                                                                                                                                                                                          |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File  | _New…_ ⌃N, a rule, _Close_ ⌃W, _Save_ ⌘S, _Duplicate_ ⌘D, _Rename…_, a rule, _Download_ ⇧⌘E, _Export 3D Model…_, _Export Sprite Atlas…_, a rule, _Quit_ ⌃Q — today's File menu less New Folder |
| Edit  | _Undo_ ⌘Z, _Redo_ ⇧⌘Z, a rule, _Copy_ ⌘C, _Paste_ ⌘V, _Select All_ ⌘A (greyed: the pixel clipboard's placeholders, §6.10), a rule, _Pick Color…_ ⌘K, _Tile Size…_                              |
| Tools | the six, the live one checked — unchanged                                                                                                                                                      |
| View  | _Arrange Windows_ ⌘J (the arrange / zoom state rule, unchanged), a rule, _3D Sprite Atlas_, a rule, the open document windows (§6.8)                                                           |

**The Text Viewer** — a text window active:

| Menu | Items                                                                                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------- |
| File | _Close_ ⌃W (the front text window), _Quit_ ⌃Q (every text window, in turn — TeachText's Quit; §6.6)               |
| Edit | _Copy_ ⌘C, _Select All_ ⌘A — over the read-me's prose (§6.9), the two TeachText left live on a read-only document |
| View | _Arrange Windows_ ⌘J (§6.7)                                                                                       |

What the bar shows, then, application by application — the Sprite Machine
title first in each, the clock at the right end throughout:

```
Finder         │ Sprite Machine  File  Edit  View  Special                 10:42 │
Sprite Editor  │ Sprite Machine  File  Edit  Tools  View                   10:42 │
Text Viewer    │ Sprite Machine  File  Edit  View                          10:42 │
```

### 3.5 The gates after the split

The role is no longer a gate; **an application's items exist only while
it is front**. What remains is each item's own reading:

- **Sprite Editor.** `DOC_SCOPED` goes: every item is document-scoped by
  construction. Undo / Redo still follow the active history; the ⌘J item
  keeps its arrange / zoom rule minus the `!appActive` clause; Close and
  Quit are always live (the application is front only with a document
  window active, so there is always something to close and something to
  quit — Quit's `contexts.length` gate goes); the exports keep their
  dialog-side model gate; the window tail keeps its reconciler.
- **Finder.** New Folder reads only the front container (the `appActive`
  clause goes); Close reads the front folder window or the panel; Copy,
  Paste and Select All keep their three readings, the `finder` term now
  true by construction; the `paste` event listener (the browser's own
  Edit → Paste) moves with them and gates on `frontApp === 'finder'` as
  well as on the item, since the Sprite Editor may take that event for the
  pixel clipboard one day. The focused-text reading (the composed-path
  `focusin` / `focusout` pair) moves with the Finder, its one reader.
- **Text Viewer.** Close and Quit are always live when front; Copy reads
  the document's `selectionchange` — live while the selection has text in
  a text window — and Select All is always live.
- **Sprite Machine.** As today: About and Desktop Patterns always; Empty
  Trash… (wherever it lives) while the Trash holds something.

The bare-letter tool keys (`src/shortcuts.js`) keep their `appActive`
guard; nothing there changes.

### 3.6 Cross-application calls, and what the shell hands each application

`deps` is what `initMenus` takes today, plus the registry's late-bound
actions: `desktop`, `windows`, `patterns`, `ring`, `model`, `folders`,
`texts`, `icons`, the shared dialogs (`showStorage`, `showAbout`,
`modalOpen`), and `apps` — the registry's actions by id, filled as each
`init` returns (an application calls through at pick time, never at
wire-up, so the order of initialization cannot bite).

- The **Finder's New…** calls the Sprite Editor's `newDocument()`; the
  **icon layer's** double-click calls its `openDoc(id)` (as `menus.actions`
  does now); `windows.onDocumentClose` is injected by the Sprite Editor
  (its dirty check); `main.js`'s boot calls the controller's `showAbout`.
- **The dirty check** (`confirmDiscard`), the save flows, the New box, the
  name prompt, the Tile Size box, the unsaved alert, the two export
  dialogs, the tools sync, the ring sync, the ⌘J rule and the window tail
  all move whole into `apps/sprite-editor/index.js` — most of today's
  `menus.js`, unchanged in body. The clipboard's three commands, the
  paste alert, the paste event, New Folder and the Finder's Close move
  into `apps/finder/index.js`. The Text Viewer's module is the smallest:
  Close, Quit, and the two Edit commands.
- **The dialog markup stays in `index.html`** this cut (§6.12): the
  dialogs are the desktop's top layer and their ids are unique; only the
  handlers move. Moving each application's boxes into its directory is a
  mechanical follow-up.

### 3.7 What does not change

The document format and its chunks, storage, the desktop-state blob, the
URL mirror, the windows and windoids and their placement, the options
strip, the tool keys, the icon layer and the drag, the Trash's rules, the
Desktop Patterns panel, every dialog's anatomy and copy, the About box,
the clock, the engine. The kit is untouched.

## 4. Steps

Each lands green (`npm test`, `npm run lint`, `npm run typecheck`, `npm run
build`) and shippable alone; the look and the wiring are the eye's
([TESTING.md](TESTING.md)).

1. **The front application.** `state/shell.js`: the three id constants,
   `frontApp` beside `appActive`, one setter writing both;
   `shell/windows.js`: `addPanel` takes `{ app }`, `applyActive` derives
   the id; `folders.js`, `texts.js`, `patterns.js` declare theirs. Nothing
   visible changes. The user eyeballs nothing new — a smoke by eye that the
   windoids still hide and return.
2. **The bar swaps.** `src/apps/` with the three directories, the fragments
   holding today's four menus split by owner (§3.4, the standing set —
   nothing added yet), `src/apps/index.js`, `shell/menu-bar.js` doing the
   parse, the slotting and the swap; `index.html`'s bar reduced to the
   Sprite Machine menu and the clock; `env.d.ts`. `shell/menus.js` stays
   one file this step, rewired to the parsed nodes through the
   controller, with `DOC_SCOPED` and the role clauses deleted (§3.5).
   The user eyeballs: the Finder's bar at boot behind the About box; the
   swap on a document open, a desktop click, a folder window click, a
   read-me open; ⌘S doing nothing with the Finder front and the Sprite
   Editor's ⌘S flashing File with a document active; ⌘C over selected
   read-me prose copying the prose with an icon lit; the clock holding the
   right end through every swap; the About box, Desktop Patterns and
   Empty Trash… from every bar.
3. **The split.** `menus.js` dissolved into `apps/sprite-editor/index.js`,
   `apps/finder/index.js`, `apps/text-viewer/index.js` and the controller's
   shared share (§3.6); `main.js`'s composition; the HMR teardown. No
   behavior moves. The user eyeballs the same list as step 2, briefly —
   this step is a move.
4. **The commands the split puts in place** (each one line in §6, each
   its own commit if the user prefers): Empty Trash… into the Finder's
   Special menu; Quit in the Text Viewer; the Text Viewer's Copy and
   Select All; Arrange Windows in the Finder's and the Text Viewer's View
   menus. The user eyeballs each where it lands.
5. **Docs.** README: the opening paragraph's "the menus fall back to the
   desktop's grammar"; §One machine, two roles rewritten as three
   applications and one bar (the front-application rule, the swap, the
   Sprite Machine menu's role); §Menu bar per application; §Text files'
   "another application's window" bullet (the Text Viewer, its menus);
   §The Trash (Empty Trash…'s home); the Architecture tree (`src/apps/`,
   `shell/menu-bar` for `menus`). The pointers: `trash-plan.md` §5.2 and
   §7 (the Special menu arrives), `clipboard-plan.md` §2.1 (the Edit menu
   is the Finder's now, the greyed placeholders the Sprite Editor's),
   `selection-tool-plan.md`'s Edit bullet; this plan's status line.

## 5. Kit asks

**None required.** The three facts of §2.3 are shipped kit: menus may come
and go from the bar, a detached item claims no key, a title may be a
picture. One thing may become an ask after the first build, and is not
written until then: if a keyboard user's focus, parked on a bar title when
the bar swaps beneath it, falls to `<body>` in a way that grates, the bar
could keep its Tab stop across a slot change — the kit's own roving-focus
business, not a page bridge.

## 6. Decisions for the user

1. **Names and ids.** _Finder_, _Sprite Editor_, _Text Viewer_ — the ask's
   names — as `finder`, `sprite-editor`, `text-viewer`, the directory
   names the same. The README's "TeachText's window" stays as prose for
   the window's look; the application is the Text Viewer. Recommendation:
   as stated.
2. **Where an application's menus are authored.** A `menus.html` fragment
   in the application's directory, imported `?raw` and parsed once
   (§3.2) — the application is self-contained, as asked — or a
   `<template id="menus-…">` per application in `index.html`, cloned
   with `importNode` + `upgrade` like the window templates, keeping every
   piece of markup in one skeleton. Recommendation: the fragment; the
   menus are the application's identity, and the window templates stay
   in `index.html` because they are the desktop's plumbing, not an
   application's.
3. **The Sprite Machine title.** The text _Sprite Machine_ (today's), or a
   16×16 1-bit glyph in the menu's `label` slot — the Apple menu's
   picture, the kit's own recipe — with the text kept as the accessible
   name. Recommendation: the text now; the glyph the day the user draws
   one, a markup change alone.
4. **Empty Trash…'s home.** The trash plan parked it in the Sprite Machine
   menu "for now — a Special menu the day Clean Up gives it a second
   item" ([trash-plan.md](trash-plan.md) §5.2), the reason being a whole
   menu added to a bar every role shared. The Finder's bar is its own
   now, and Special is where System 7 kept the command. Move it: the
   Finder's **Special → Empty Trash…**, one item until Clean Up, and the
   Sprite Machine menu holds About… and Desktop Patterns — the Apple menu's
   two kinds of thing. The trade: emptying the Trash from the Sprite
   Editor means a desktop click first, as it did on a Mac.
   Recommendation: move it.
5. **New… ⌃N in the Finder.** The standing decision (Sep 9) is one New,
   always a document, from either role. The Finder's File menu keeps the
   item and calls the Sprite Editor's New box — the Finder's way to make a
   document, as a double-click is its way to open one. System 7's Finder
   made no documents, but this machine's is the one document
   application. Recommendation: keep.
6. **Quit.** Today ⌃Q is live in both roles and walks the open documents.
   The Finder had no Quit; the Sprite Editor's File menu keeps it, and the
   route from the Finder role goes (switch to the editor — click any
   document window — and quit). The Text Viewer gets its own ⌃Q, closing
   every text window in turn, TeachText's Quit. Recommendation: as stated.
7. **Arrange Windows ⌘J** — the one command over the whole screen — in
   every application's View menu: the Sprite Editor's keeps the
   arrange / zoom rule; the Finder's and the Text Viewer's carry the
   arrange alone, greyed while `windows.arranged()` reads true (nothing to
   arrange; the zoom box is a document window's). One handler, three
   items, and ⌘J means the same thing wherever you are. The alternative
   is the Sprite Editor's alone, which loses today's Finder-role arrange
   of dragged folder windows. Recommendation: every application.
8. **The open-windows tail.** Today it is the View menu's, in both roles,
   and from the Finder it is the way back to a document. Per application
   it belongs to the Sprite Editor alone (System 7's Finder and TeachText
   listed no windows), and the ways back to an open document from the
   Finder are the window's own click — every document window stays on
   screen — a saved document's icon (which activates its open window),
   and New…. A Finder tail of open folder windows, or a Text Viewer tail
   of read-mes, is the same reconciler and cheap, but nothing System 7
   had. Recommendation: the Sprite Editor's alone.
9. **The Text Viewer's Edit menu.** _Copy_ ⌘C (the prose selection to the
   system clipboard, `navigator.clipboard.writeText`, greyed while the
   selection is empty) and _Select All_ ⌘A (a Range over the body), what
   TeachText left live on a read-only file — or no Edit menu, the two keys
   falling through to the browser's native copy and select-all, which
   already work once the Finder's Copy is off the bar. Recommendation:
   the two items; they are what the menu bar of a read-me showed, and a
   claimed key that does what the native one did costs nothing.
10. **The greyed placeholders.** The Sprite Editor's Edit menu keeps
    _Copy_ / _Paste_ / _Select All_ greyed, waiting for the selection
    tool's pixel clipboard ([clipboard-plan.md](clipboard-plan.md) §2.1,
    [selection-tool-plan.md](selection-tool-plan.md)) — or drops them
    until they work. The Finder's Edit menu holds only the three live
    commands, no greyed Undo / Cut / Clear (the strip's rule that dim
    reads as disabled). Recommendation: keep the editor's three as they
    stand; nothing greyed in the Finder's.
11. **Two applications' items sharing a key.** ⌃W is Close in all three,
    ⌃Q Quit in two, ⌃N New… in two, ⌘C / ⌘A in two, ⌘J in three — one
    node each, and only the front application's is ever connected, so no
    key is ever contested. Stated so nobody adds a `disabled` for it.
    Recommendation: none needed; recorded.
12. **The dialog markup** stays in `index.html` this cut; moving each
    application's boxes beside its menus is the follow-up (§8).
    Recommendation: stay.

## 7. Tests, by the rules

[TESTING.md](TESTING.md): a new pure function with rules earns a unit
test on its contract; wiring, look and the kit's mechanics earn nothing.
**No new test.** The front-application rule is a lookup with a default,
the registry is a list, the swap is DOM, the gates are wiring, and the
menus are markup. The existing suites must stay green, and the shell
slice's new field changes no tested contract. Every bar, every swap and
every key is the eye's, by the lists in §4.

## 8. Follow-ups, in the order they earn their place

- **The Application menu** — System 7's, at the bar's right end beside
  the clock: the front application's small icon, listing the three and
  switching between them (activating the topmost window of the chosen
  one), with Hide / Show later. Needs three 16×16 1-bit glyphs and a
  right-slotted `vf-menu`, which the bar already lays out.
- **The dialogs beside their menus** — each application's boxes into its
  directory as a second fragment, the controller slotting them into the
  desktop at wire-up; the shared About and storage boxes stay with the
  Sprite Machine menu.
- **Finder → File → Duplicate ⌘D** over the selection: `files.copyDoc` /
  `copyFolder` / `copyText` into each item's own container under
  `copyName` — Copy and Paste in place, one handler over existing
  actions.
- **The Finder's View and Special**, the folders and trash plans' lists —
  _by Icon_ / _by Small Icon_, _Clean Up_, _Put Away ⌘Y_ — each now with a
  menu to land in.
- **The Sprite Machine glyph** (§6.3), and the Application menu's, one
  batch of 16×16 art.
- **Text editing** in the Text Viewer, the day it comes, brings TeachText's
  full Edit menu — Undo, Cut, Paste, Clear — into a module already shaped
  for it.

## 9. Files touched

New: `src/apps/index.js`, `src/apps/finder/index.js`,
`src/apps/finder/menus.html`, `src/apps/sprite-editor/index.js`,
`src/apps/sprite-editor/menus.html`, `src/apps/text-viewer/index.js`,
`src/apps/text-viewer/menus.html`, `src/shell/menu-bar.js`. Changed:
`index.html` (the bar keeps the Sprite Machine menu and the clock; the
four menus leave), `src/state/shell.js`, `src/shell/windows.js`,
`src/shell/folders.js`, `src/shell/texts.js`, `src/shell/patterns.js`,
`src/main.js`, `src/env.d.ts`, `README.md`, `docs/trash-plan.md`,
`docs/clipboard-plan.md`, `docs/selection-tool-plan.md`. Removed:
`src/shell/menus.js` (dissolved, step 3). Untouched: `packages/core`,
the kit, every test.

The release, when it ships: a visible app change, so the root version
takes a **patch** (`npm version patch`); the engine does not bump.
