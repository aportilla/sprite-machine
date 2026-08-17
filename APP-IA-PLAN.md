# Application IA plan

> **Status: IMPLEMENTED** (all four phases, August 2026). The README's
> [The desktop](README.md#the-desktop) section absorbed this spec; the
> "Multi-document" known-limitation bullet is gone. Deviations chosen in
> implementation: **Quit is the cascade from day one** (Phase 2's interim
> single-doc Quit never shipped separately); the pointer-driven
> desktop-focused File → Open is **⌘O only** for now — kit ask #5 below
> (vf-icon deselects on a menu-bar press) blocks the mouse path, and the
> icon double-click remains primary; the window reconciler clones its
> template via `document.importNode` + `customElements.upgrade` (a bare
> clone lives in the template's inert document, where an assigned `ctx`
> misses `connectedCallback`); and each freshly created document window is
> `bringToFront`-ed at creation so the desktop's light-DOM order settles at
> open time — deferring it to the user's next press re-inserted windoid
> nodes mid-gesture and swallowed that click. Kit asks #2–#3 shipped in the
> published vintage-frames 0.4.0 as designed; **#1's opt-in attribute did
> not survive the kit's review** — the published position is that the
> desktop never decides which presses mean "the Finder" (its furniture is
> slotted light DOM, so only the page knows), so the PAGE owns the press
> test: `shell/windows.js` routes `pointerdown` with `target === desktop`
> (the bare dither, by shadow retargeting) through `clearActive()`, the
> icon layer its own presses — one path for every Finder press. #4 needed
> no kit change (the windoid composition held and is now pinned by its
> verify suite); #5 remains open.
>
> The sequel to [DESKTOP-UX-PLAN.md](DESKTOP-UX-PLAN.md)
> (shipped August 2026). That plan made the app a System 7 virtual desktop;
> this one makes it behave like a System 7 **application** living on that
> desktop: utility windows that belong to the app, a real focus model where
> clicking the desktop deactivates the app, focus-gated menus, and multiple
> documents open at once.

Three requests, one model:

1. The **3D View** and **Full Sprite View** become **utility windows**
   (windoids), joining the Tools palette in the floating tier.
2. **Clicking the desktop deactivates the document window** and **hides the
   utility windows**; menu items that need a document grey out (New survives;
   Open survives when a desktop icon is selected).
3. **Multiple documents** open at once, each in its own document window; the
   utility windows serve the **active** document only.

---

## 1. The model: one machine, two roles

On a real System 7 machine the desktop belongs to the **Finder**. Clicking
the desktop switches applications: the app's windows lose their stripes, its
**utility windows hide** (the HIG palette rule — palettes belong to the
application, not the screen), and the menu bar becomes the Finder's. Clicking
one of the app's windows switches back, and the palettes reappear where they
were.

Sprite Machine has exactly one application, so we keep **one menu bar for
both roles** and grey items instead of swapping menus — that's the "single
application" affordance. The whole plan reduces to one derived boolean and
one identity:

- **`appActive`** — is any document window the active window? Clicking the
  desktop background or a desktop icon makes this **false** ("you're in the
  Finder"); clicking a document window — or opening one — makes it true.
- **The active document** — which document window is active. Every
  document-scoped surface (3D View, Sprite View, options strip, the File/Edit
  menus, undo) reads this one identity.

Everything below is these two truths, wired outward.

| Surface                               | `appActive == true`                 | `appActive == false` (desktop focused)     |
| ------------------------------------- | ----------------------------------- | ------------------------------------------ |
| Document windows                      | one active (striped), rest plain    | all plain (no stripes, inert widgets)      |
| Tools palette / 3D View / Sprite View | visible per their View-menu toggles | **hidden** (toggles remembered, not lost)  |
| Options strip                         | active tool's name + options        | **blank band** (structural chrome remains) |
| Menus                                 | full grammar (today's)              | Finder grammar (§2.3)                      |
| B/R/G/E/I bare-letter tool keys       | live                                | inert                                      |

---

## 2. Target UX spec

### 2.1 Window tiers

The four windows redistribute into System 7's two tiers:

| Window               | Today                      | Target                                                    |
| -------------------- | -------------------------- | --------------------------------------------------------- |
| Document window(s)   | document tier, one, static | document tier, **one per open document**, dynamic (§2.4)  |
| Tools palette        | `variant="utility"`        | unchanged                                                 |
| **3D View**          | document tier              | **`variant="utility"`**, keeps `resizable` + status strip |
| **Full Sprite View** | document tier              | **`variant="utility"`**, keeps `resizable` + status strip |

Consequences of the reclassification, all inherited from the kit's utility
tier for free:

- The two views **float above every document window** and restack only among
  themselves (three windoids in the floating band).
- **Clicking them never deactivates the document window** — which also fixes
  a live annoyance: today a click into the 3D View steals the document
  window's active state mid-session.
- Their close boxes keep routing through the shell slice; the **View menu
  toggles keep working** and now read as "open while the app is active."
- Their title bars become the 11px windoid bar. The headings ("3D View",
  "Full Sprite View") must fit the windoid title treatment — check, and
  shorten to "Sprite View" if needed.

**Kit audit required (§3.1):** the windoid variant must compose with
`resizable` (grow box) and the `status` slot — the Tools palette uses
neither, so this pairing is unproven in the kit.

### 2.2 Focus: activation and deactivation

**What deactivates the app** (→ `appActive = false`):

- `pointerdown` on the **desktop background** proper.
- `pointerdown` in the **icon layer** — selecting an icon IS working in the
  Finder. (A double-click then opens the document, which re-activates.)

**What must NOT deactivate the app:** the menu bar, the options strip, any
dialog, and the utility windows (kit guarantee already). This falls out
naturally: deactivation triggers only on the two surfaces above, never on
"anything that isn't a window."

**What re-activates:** `pointerdown`/`focusin` in any document window (the
kit's existing raise path), and programmatic opens — File → New, an icon
double-click, the Open flow — which end in `bringToFront(win)` and therefore
activate.

**Utility visibility becomes a product of two truths:**

```
utility window on screen  =  wanted (View-menu toggle)  &&  appActive
```

The `wanted` flags are today's `shell.windows` booleans and keep persisting;
`appActive` is transient session state (boots `true` — the boot document
window is slotted/created last and starts active, exactly as today). A
deactivate therefore never _loses_ the user's palette arrangement — clicking
back into a document restores exactly the windoids that were up, where they
were.

**The options strip** goes inert with the app: while `appActive` is false it
renders as the empty white band (no tool name, no controls). The band itself
stays — it's structural chrome the window clamp reserves space under — only
its content clears.

### 2.3 Menu gating

One funnel (`syncMenus()` in `shell/menus.js`, extending the existing
checkmark/enabled sync) reads `appActive`, the icon selection, and the active
document's history/dirty state, and writes `disabled`/`checked` on every
item. The kit already suppresses a disabled item's key equivalent, so gating
the items gates ⌘S/⌘Z/⌘K/⌘G etc. for free; the bare-letter tool keys get the
same guard inside `src/shortcuts.js` (they're ours, not the kit's).

| Menu item                                                         | App active                    | Desktop focused                                                                                       |
| ----------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| About…, Settings…, Quit                                           | enabled                       | **enabled** (app-level; Quit already means "to the bare desktop")                                     |
| File → New                                                        | enabled                       | **enabled** — opens a new untitled document window                                                    |
| File → Open… ⌘O                                                   | enabled — the Open **dialog** | **enabled iff a desktop icon is selected** — opens the selection (Finder grammar); disabled with none |
| File → Close / Save / Duplicate / Rename… / Export… / Properties… | enabled (today's rules)       | **disabled**                                                                                          |
| Edit → Undo / Redo                                                | history-gated (today)         | **disabled**                                                                                          |
| Edit → Pick Color… ⌘K                                             | enabled                       | **disabled**                                                                                          |
| Tools → the five tool modes                                       | enabled, one checked          | **disabled** (checkmark still shown)                                                                  |
| Tools → Tools Palette                                             | enabled, checkmarked          | **disabled** (palette is hidden with the app; the toggle would lie)                                   |
| View → 3D View / Sprite View                                      | enabled, checkmarked          | **disabled** (same reason)                                                                            |
| View → Show Grid ⌘G                                               | enabled                       | **disabled**                                                                                          |

**Open…'s two grammars** are the deliberate System 7 read of this app's dual
role: with a document focused it's the application's Open… (the listing
dialog, as today); with the desktop focused it's the Finder's Open (act on
the selected icon, disabled without a selection). ⌘O follows whichever
grammar is live. With multiple icons selected, open them all (each into its
own window once §2.4 lands; until then, the first selected, dirty-checked).

Not in scope but noted as a natural extension of the Finder grammar:
desktop-focused Duplicate/Rename acting on the selected icon. The request
was New + Open only; the funnel makes adding these later a two-line change.

### 2.4 Multiple documents

**One window per open document**, each holding its own `<sm-editor>`; the
document tier becomes dynamic. The System 7 grammar, clause by clause:

- **File → New** opens a new untitled window — it does not replace anything.
  Untitled names count up: `untitled`, `untitled 2`, `untitled 3` (gaps
  refill when windows close; match the Finder's copy-naming spirit, keep it
  simple).
- **Opening a saved document that's already open activates its existing
  window** — never a second window for the same stored doc. Samples and
  dropped files always open fresh windows (they're fresh untitled copies —
  identity-less by design).
- **A dropped PNG opens a new window** (today it replaces the current doc).
  The drop target stays whole-app.
- **New windows stagger**: the authored default position, offset ~24px
  right+down per already-open document window, clamped to the raster.
- **File → Close / the close box** closes the **active** window
  (dirty-checked, as today). The kit already re-asserts the next topmost
  document window as active when one leaves the DOM; when the **last** one
  closes, the app deactivates — desktop focus, gated menus, hidden palettes.
  This replaces today's odd residue where closing the document window left
  the 3D/Sprite views showing an orphaned document.
- **Quit** walks every open document, raising the unsaved-changes alert
  **once per dirty document** (System 7's sequential cascade); Cancel at any
  point aborts the rest. A completed quit leaves the bare desktop with the
  View toggles intact (an improvement on today's `hideAll`, which forgets
  them).
- **File → Duplicate** saves the copy and opens it in a **new window**,
  activated, leaving the original window in place (today it re-identifies
  the current window as the copy — the multi-window reading is truer to the
  Finder's Duplicate).
- **Save / Rename… / Export… / Properties…** act on the active document.
- **The utility windows serve the active document only**: the 3D View and
  Sprite View re-target on every activation change (§3.3); the options strip
  and Tools palette were never per-document (tool, ink, MRU stay app-level —
  one palette, one ink, System 7 style). The **face selection moves
  per-document** — each window remembers which face it's editing.
- **Window titles** are each document's name; each document window's status
  strip reads its own tile size.
- **Desktop icons**: every open saved document's icon wears the `open`
  ghost (a set now, not a single id).
- **Dirty safety net**: `beforeunload` warns if **any** open document is
  dirty. Untitled windows do **not** survive a reload — persistence reopens
  saved documents only (autosave stays a non-goal; persisting unsaved pixels
  through localStorage would be autosave through the back door).

---

## 3. Architecture

### 3.1 Kit asks (vintage-frames)

The kit's desktop already owns z-order, the single-active invariant, and the
utility tier. Three genuinely new primitives, one audit:

1. **Desktop-background deactivation** — a `pointerdown` whose target is the
   desktop itself (shadow retargeting makes "target === the desktop host"
   exactly the background test — every slotted child arrives as itself)
   clears `active` from the whole document tier. **Zero active windows
   becomes a legal state.** Suggest gating behind an opt-in attribute (e.g.
   `<vf-desktop deactivate-on-background>`) so system7web and other
   consumers keep the current always-one-active behavior.
2. **An activation event** — `vf-activate` on the desktop, detail
   `{ window: VfWindow | null }`, fired from the `_setActive` funnel whenever
   the active document-tier window changes (including → `null`). Without it
   the app would be reduced to MutationObservers on `active` attributes.
3. **`desktop.activeWindow`** (getter) and **`desktop.clearActive()`**
   (method) — the read and the programmatic write. `clearActive()` is what
   the app's icon layer calls (the layer is app markup; the kit can't know
   its clicks mean "the Finder").
   - Nuance: `_syncActive` (the slotchange re-assert) must **preserve** the
     zero-active state — removing a background window while the app is
     deactivated must not promote a survivor to active.
4. **Windoid audit** — `variant="utility"` composed with `resizable` (grow
   box) and the `status` slot. The variant CSS restyles the title bar and
   widgets; the grow box and status strip rules look orthogonal but the
   combination has never been rendered. Fix whatever falls out; publish.
5. **Menu-bar presses must not clear the icon selection** _(found in
   implementation)_ — `vf-icon`'s outside-press listener deselects on ANY
   press outside the icon, the menu bar included, so a pointer-driven
   File → Open can never act on a selection (the selection dies on the way
   to the menu). System 7's Finder kept the selection while a menu was
   pulled. Until the kit exempts `vf-menu-bar` presses (and arguably open
   `vf-dialog`s), the ⌘O key equivalent is the working pointer-free path
   and the icon double-click the primary one.

### 3.2 The workspace: per-document contexts

The state layer already builds every slice from a factory
(`createDoc`, `createHistory(doc)`, `createFiles`, …) — the singletons are
one line each. Multi-doc is therefore **routing, not rewriting**: the
pipeline, the doc's two-channel contract, and the editor internals don't
change.

**A `DocContext`** is the per-document bundle, created by a factory in a new
`state/workspace.js`:

```
{ key,            // window instance id (stable for the window's lifetime)
  doc,            // createDoc() — the canonical document, two channels
  history,        // createHistory(doc) — per-document undo
  fileId,         // string | null — stored identity (null = untitled)
  name, dirty,    // display identity + dirty flag (today's files fields)
  face }          // which face this window is editing (moves out of session)
```

**The `workspace` slice** holds `contexts` (ordered, by reference — store
idiom) and `activeKey`, with actions: `openBlank()`, `openSample()`,
`openStored(fileId)` (activates the existing context if one has that
`fileId`), `activate(key)`, `close(key)`, plus the untitled-naming counter.
`appActive` is `activeKey != null`; the `vf-activate` handler in
`shell/windows.js` is its **single writer** (mapping window → context key,
`null` → `null`).

**The `files` slice splits.** The app-level half — `available`, `list`, the
storage/encode/decode/icon dependencies — becomes a `library` slice. The
per-document half — `currentId`/`currentName`/`dirty` and the
dirty-tracking subscriptions on the doc's channels — moves into the
context (a small per-context tracker wired at context creation, torn down on
close). Save/duplicate/rename/export become library operations **taking a
context**. `desktop-state`'s `lastDocId` generalizes (§3.5).

**`session` slims**: `face` leaves (per-context now); tool, ink, MRU,
per-tool options, pickerOpen stay app-level. `build` stays a singleton — the
one 3D View shows the one active document, and the rebuilder is its only
writer.

### 3.3 Follow-the-active-document services

Everything that today imports the `doc`/`history` singletons re-routes one
of two ways:

**Bound to their own context** (a property handed in at creation, exactly
like the editor's constants today):

- `sm-editor` / `sm-draw-canvas` — each window's editor gets its context;
  gesture commits feed `context.history`; the face picker reads/writes
  `context.face`. The README's "ONE element, forever" invariant becomes
  "one element **per document**, for the document's lifetime" — what that
  invariant actually protected (canvas identity across hide/show) still
  holds, because document windows now **close by disposal**, never by
  hiding, and the utility windows keep the hide-don't-unmount contract.
- `sm-status-line kind="tile"` — reads its window's context.

**Following the active context** (subscribe to `workspace`, re-wire doc
subscriptions on activation change):

- **`scene/rebuilder.js`** — unsubscribes from the outgoing doc's channels,
  subscribes to the incoming one's, rebuilds. A switch re-frames the camera
  (treat it like a fresh sheet — per-document camera memory is a
  nice-to-have we deliberately skip; note it as an accepted trade).
- **`sm-atlas-view`** — same pattern; it stays the live channel's second
  subscriber, now of whichever doc is active.
- **`shell/menus.js`** — every File/Edit action targets
  `workspace.active()`; the Edit-menu undo/redo sync reads the active
  context's history; `confirmDiscard` takes a context.
- **`sm-options-bar`** — needs only `appActive` (blank band when false).
- **`main.js`'s `beforeunload`** — any context dirty.

`loaders.js` re-targets: `loadSample`/`loadBlank`/the drop path load **into
a context** the workspace hands them (always a fresh one) instead of writing
the singleton.

### 3.4 Dynamic document windows

`index.html` keeps the three utility windows, the menu bar, strip, icons and
dialogs static; the static `#win-document` is replaced by a
`<template id="tpl-document-window">` (a `vf-window` wrapping `sm-editor` +
tile status line). `shell/windows.js` grows a reconciler — the
`syncDocIcons` pattern lifted to windows: subscribe to `workspace`, create a
window per context (append as a **direct child of the desktop** — its
stacking manager only sees direct children), remove on close, sync each
title from its context's name. Per-window wiring at creation: clamp +
stagger placement, the editor's context property, `vf-close` → the
dirty-checking close flow for **that** context. The recent "canvases survive
the desktop's DOM re-order" work is what makes dynamic append/remove safe
around the kit's focus-order node moves.

The `shell` slice keeps `windows: {tools, sprite, stage}` as the utility
`wanted` flags (the `document` entry retires — document visibility is
existence now) and keeps `showGrid` **app-level** (a mode preference like
the tool, not a per-window view option — one truth for the menu checkmark).

HMR note: contexts live in the workspace singleton and survive a hot reload;
the window reconciler rebuilds the DOM from workspace state on re-init —
which is the same code path as boot restore, so HMR exercises it for free.

### 3.5 Persistence (desktop-state v2)

One versioned key, bumped to `v: 2`:

```
{ v: 2,
  utility: { tools|sprite|stage: { wanted, top, left, width, height } },
  docs:    [ { fileId, top, left, width, height, face } ],   // saved docs only
  activeFileId,                                              // whom to activate last
  icons, showGrid }                                          // unchanged
```

Boot restore: reopen each listed `fileId` that still exists in the library
(vanished ones drop silently), restore geometry + face, activate
`activeFileId`'s window last. Untitled windows are deliberately absent
(§2.4). A `v: 1` blob migrates shallowly — utility geometry and icons carry
over, `lastDocId` becomes `docs: [{fileId: lastDocId}]` — or is simply
dropped; the cost is one session's layout, and the migration must not grow
beyond ten lines.

### 3.6 Boot, dev hooks, and capture determinism

- `?sample` / the boot document open as **the one boot context**, exactly
  today's flow; the editor dev hooks (`?edit`, `?cursor`, `?pick`,
  `?palette`, `?rect`, `?fill`, `?tile`) all target the boot context's
  editor.
- `?hide=document` keeps working for captures: the boot document window is
  created **hidden but active** — `appActive` is store truth written only by
  activation events, and a capture never clicks, so the utility windows
  stay up. (Deactivation is interaction-only; boot always seeds
  `appActive = true` with the boot context.)
- `?fresh=1` boots one sample context, no restore — byte-determinism of the
  capture baselines is preserved (they will all need re-blessing once for
  the windoid title bars).

---

## 4. What deliberately does not change

- The pipeline (`lib/`), the doc's two-channel contract, drain-before-consume,
  the editor leaves, the save/export/drop **document-is-a-PNG** format.
- Explicit Save as the contract; no autosave, no untitled persistence.
- Tool / ink / MRU / per-tool options as **app-level** session state.
- One THREE stage, one canvas, one rebuilder — retargeted, not multiplied.
- The kit owns every aesthetic; the page and shell modules stay behavior +
  layout only.

---

## 5. Phases

Each phase lands green (tests + typecheck + lint + capture/drive) and is
independently shippable.

### Phase 1 — kit features (vintage-frames)

- [ ] Background-click deactivation behind an opt-in desktop attribute;
      zero-active as a legal, preserved state (§3.1.1, §3.1.3 nuance).
- [ ] `vf-activate` event + `activeWindow` getter + `clearActive()`.
- [ ] Windoid audit: `variant="utility"` × `resizable` × status slot.
- [ ] Publish; bump the dependency here.

### Phase 2 — utility tiers + focus + menu gating (still single-doc)

- [ ] Flip `#win-sprite` / `#win-stage` to `variant="utility"` in
      `index.html`; re-bless capture baselines.
- [ ] `shell` slice: add `appActive`; `windows.js` wires `vf-activate` →
      `appActive`, icon-layer pointerdown → `clearActive()`, and utility
      `hidden = !(wanted && appActive)`.
- [ ] Options strip blanks when `appActive` is false.
- [ ] `syncMenus()` gating per §2.3, including selection-aware Open… (icon
      selection tracked into the shell slice by `icons.js` via `vf-select`)
      and the `shortcuts.js` guard on B/R/G/E/I.
- [ ] Quit stops clearing the utility `wanted` flags (it closes the
      document; deactivation hides the palettes).
- [ ] drive.mjs: desktop-click deactivation scenario (stripes off, windoids
      hidden, menu items disabled, icon-select enables Open, reopen restores
      windoids).

### Phase 3 — multiple documents

- [ ] `state/workspace.js` (contexts + activeKey + untitled naming) with a
      Node suite; `session` loses `face`; `files` splits into `library` +
      per-context identity (suites updated).
- [ ] Document-window template + reconciler in `windows.js`; stagger +
      clamp; per-window close routing; title sync.
- [ ] `sm-editor` / tile status line take a context property; rebuilder and
      `sm-atlas-view` follow the active context; menus/loaders/drop
      re-target per §3.3.
- [ ] Quit cascade; multi-ghost icons; `beforeunload` over all contexts.
- [ ] desktop-state v2 + migration; boot restore of the open set.
- [ ] drive.mjs: two-document scenario (New twice, draw in each, switch by
      click — utilities and undo follow; open-already-open activates; close
      to zero → Finder mode).

### Phase 4 — docs + residue

- [ ] README: "The desktop" section rewritten around the two-role model;
      delete the Multi-document known-limitation; note the Duplicate and
      Quit behavior changes.
- [ ] `docs/SMOKE-TEST.md`: deactivation feel, windoid drags across two
      documents, the quit cascade.
- [ ] This plan gets its **Status: IMPLEMENTED** header with deviations
      recorded, like its predecessor.

---

## 6. Decisions taken (so implementation doesn't relitigate)

1. **One menu bar, greyed — never swapped.** The single-app affordance.
2. **About / Settings / Quit / New stay enabled always**; everything
   document-scoped gates on `appActive`; Open… is dual-grammar (§2.3).
3. **Utility `wanted` flags are app-level and survive deactivation** — the
   View menu records intent; `appActive` gates reality.
4. **Tool/ink/MRU/options/showGrid app-level; face per-document.**
5. **Untitled windows don't survive reload** — explicit Save stays the
   contract.
6. **Opening an already-open saved doc activates its window** — one window
   per stored identity.
7. **Duplicate opens the copy in a new window** (behavior change, recorded
   in the README).
8. **Camera re-frames on document switch** — no per-document camera memory
   (accepted trade, same spirit as the tile-resize float note).
9. **Closing a document window disposes it** (context + editor); utility
   windows keep hide-don't-unmount. "One element forever" is re-scoped to
   the document's lifetime.
10. **Deactivation is interaction-only truth in the store** — boot and
    programmatic opens seed/write it; captures stay deterministic.
