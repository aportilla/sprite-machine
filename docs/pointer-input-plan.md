# Plan: mouse, finger and pen

**Status:** drafted 2026-09-18. Every decision taken 2026-09-19 as
recommended (§7). vintage-frames **0.12.2** ships kit asks #19 and #20, so the
app is on `^0.12.2` and §4.1's bridge, `lib/tap.js` and its test were never
written. Steps 2 to 6 landed 2026-09-19; the eye checks on the iPad are open,
and decision 8 (#21) waits on them. The
ask: _"when i load sprite machine in mobile safari on an ipad - i'm unable to
double tap on an icon to open a document... could you look at our touch
handling to see what we're missing? i'd like to have robust mouse/finger/pen
support for whatever display the user is using."_

The short version: most of the desktop already works under a finger, because
the kit was written on pointer events and made its touch calls deliberately —
the menus, the window drag, the grow box, the rails, the drawn cursor. Three
things are not: **an icon opens on `dblclick` alone**, which is why a document
cannot be opened on an iPad; **an icon starts moving after one system px**, so
a finger tap jiggles it off its cell; and **the pixel canvas does not own its
pointer**, so a second finger during a stroke joins it. Beyond the three, the
touch-only gaps are commands that exist as a key and nowhere else.

The split falls unevenly (§3): the blocking bug is wholly the kit's, and the
volume of the work is ours. The engine does not change.

## 1. The model we copy

- **System 7 had one instrument.** One mouse, one button, and press / drag /
  release / double-click. There is no classic precedent for a finger, so the
  rule is the later Apple one and the kit's own: **the instrument never
  changes what a control means.** A tap is a click, a double-tap is a
  double-click, a drag is a drag. No gesture exists on one instrument alone.
- **A missing modifier is a menu item, not a hidden gesture.** Where a key or
  a second button is the only route to a command, the fix is the command in a
  menu — where System 7 put it — not a long-press or a two-finger tap that
  nothing on screen mentions.
- **The kit's existing touch calls stand.** `cursor.ts` hides the drawn
  pointer for a finger; `menu-press.ts` classifies a quick in-place tap as
  click-to-open and hit-tests by coordinates because touch captures
  implicitly; `vf-icon-field` leaves `touch-action` alone so a drag on a
  window's background pans it, and calls the rubber band a mouse and pen
  gesture. Each is a decision, and none is reopened here.
- **The app never reaches into a shadow root.** The bridge below reads
  `event.composedPath()` — the event's own path, the same thing
  `apps/finder/icons.js` already reads for its chrome workaround — and
  dispatches the kit's own events.

## 2. What we have

Measured against vintage-frames 0.12.1, the version installed when this was
written. 0.12.2 closes §2.1 and §2.2.

| Surface                         | Where                                    | Mouse | Finger                                  | Pen                    |
| ------------------------------- | ---------------------------------------- | ----- | --------------------------------------- | ---------------------- |
| Menu bar, menus, `vf-select`    | `menu-press.ts`                          | ✓     | ✓ tap opens, tap picks                  | ✓                      |
| Window: front, move, resize     | `vf-window.ts:209`, `drag.ts`            | ✓     | ✓ `touch-action: none` on a movable bar | ✓                      |
| Window: close, zoom             | click                                    | ✓     | ✓                                       | ✓                      |
| Scroll rails and viewports      | `styles/recipes/scroll-rail.ts:92,106`   | ✓     | ✓ flick pans, rail drags                | ✓                      |
| Dialogs, fields, buttons        | kit                                      | ✓     | ✓ 16 px text, no iOS zoom               | ✓                      |
| Icon: select, rename            | `vf-icon.ts:1935`                        | ✓     | ✓                                       | ✓                      |
| **Icon: open**                  | `vf-icon.ts:1727,2000` — `dblclick` only | ✓     | **✗**                                   | **✗**                  |
| Icon: move, file                | `drag.ts:74`, `vf-icon.ts:1154`          | ✓     | ~ moves after one system px             | ~                      |
| Icon: multi-select              | Shift/⌘ press, or the field's band       | ✓     | ✗ by design                             | ✓                      |
| Pixel canvas: draw              | `sm-draw-canvas.js:153,1424`             | ✓     | ~ a second finger joins the stroke      | ~                      |
| Pixel canvas: erase             | right button                             | ✓     | ✗ (the Eraser tool covers it)           | ✗                      |
| Pixel canvas: hover preview     | `pointermove`                            | ✓     | n/a                                     | ✓ on a hovering Pencil |
| Tools palette, face tiles       | pointerdown pick                         | ✓     | ✓                                       | ✓                      |
| Color Palette, Full Sprite View | pointerdown pick inside a scroller       | ✓     | ~ a pan picks on the way past           | ~                      |
| 3D View                         | `OrbitControls`                          | ✓     | ✓ one finger orbits, two dolly          | ✓                      |
| Drawn cursor                    | `cursor.ts:410`                          | ✓     | ✓ hides                                 | ✓                      |

The three defects, in full:

### 2.1 An icon opens on `dblclick` alone

`vf-icon` emits `vf-open` from one handler, bound to `dblclick`
(`vf-icon.ts:1727`, `#onDoubleClick` at 2000). Its only other route is the
keyboard's ⌘O / ⌘↓ (2114–2122), which needs a hardware keyboard. The Finder
wires `vf-open` to every open there is — a document, a folder, the Trash, a
read-me (`apps/finder/icons.js:237,246,255`) — and its File menu has no Open
item. So on an iPad with no keyboard, **nothing on the desktop can be
opened.**

Two mechanisms keep the `dblclick` from arriving, and both are in play at
once on a Finder icon, which is `movable`:

- WebKit synthesizes a click from a tap, but not dependably a `dblclick` from
  a double-tap; the gesture is the platform's zoom.
- For a movable icon the kit takes pointer capture and calls
  `preventDefault()` on the `pointerdown` (`drag.ts:86–88`), which in WebKit
  suppresses the synthesized mouse sequence the `dblclick` would come from.

Which one bites does not change the fix: the open gesture has to be
classified from pointer events, not taken from `dblclick`.

### 2.2 A drag starts at one system px

`#onDragStep` begins the gesture the moment the snapped position differs from
the origin by a single system px (`vf-icon.ts:1154–1160`). On an iPad a
system px is 1.5 CSS px (§2.4) and a finger never lands still, so an ordinary
tap becomes a drag: the icon leaves its lattice cell by a pixel or two, the
armed rename is called off, and `vf-drag-start` / `vf-drop` run for a gesture
nobody made. Over a session the desktop drifts out of line. It also makes the
open gesture harder to state, since the first tap of a pair will usually have
"dragged".

### 2.3 The pixel canvas does not own its pointer

`sm-draw-canvas` guards the rect drag and the selection drag by `pointerId`
(`:1464`, `:1492`, `:1508`, `:1530`), but the pencil and eraser path does not
(`:1477–1485`). A second finger landing during a stroke runs `#beginGesture()`
again, which **overwrites the undo snapshot** — one Undo then reverts only
what was drawn after the second touch — and `#onPointerMove` (`:1524`) strokes
from whichever pointer moved, through one shared `#prev`, so the two fingers
draw lines to each other. The release ends the stroke on whichever finger
lifts first. A mouse user with a drawing tablet can hit this too.

### 2.4 The desktop on an iPad

The kit derives `--vf-scale` from the display: `round(96/72 × dpr) / dpr`, so
an iPad's dpr 2 gives **1.5 CSS px per system px** (`scale.ts:12–39`).
`fitWithin` then gives roughly a 776 × 640 raster in landscape on an 11" iPad
and 536 × 1040 in portrait — the portrait raster is the compact Mac's own
size, which should suit the desktop well. `vite.config.js` already serves on
the LAN (`server.host: true`), so the iPad can reach a dev server, and Pages
serves the released build.

Hit targets follow from that scale: an icon cell is 96 CSS px and a tool cell
is comfortable, but a window's close and zoom boxes are 11 system px — **16.5
CSS px** — and a rail arrow is about 22. Whether that is workable is a
judgement only the device can make (decision 8).

### 2.5 What only a key or a second button can do

| Act                       | Today                 | On an iPad                               |
| ------------------------- | --------------------- | ---------------------------------------- |
| Open an icon              | double-click, ⌘O / ⌘↓ | **nothing** — §2.1, and no File → Open   |
| Clear the selection       | Delete / Backspace    | **nothing** — no menu item               |
| Drop the selection        | Esc                   | ✓ a tap outside it drops it              |
| Cancel a drag mid-gesture | Esc                   | ✗ — lift, then Undo                      |
| Erase with any tool       | right button          | ✓ the Eraser tool                        |
| Sample with any tool      | Option                | ✓ the Eyedropper tool                    |
| Square / axis lock        | Shift                 | ✗ — no equivalent                        |
| Pick a layer, pick a tool | digits, letters       | ✓ the Layer and Tools menus              |
| Multi-select icons        | Shift/⌘, the band     | ✗ — Edit → Select All is the whole field |

Two of these are worth a menu item (decisions 3 and 4). The rest are
refinements or already covered.

## 3. Who owns what

Editing the kit from here is out by CLAUDE.md, so the only question is which
side a piece falls on. The test: **does a second application built on
vintage-frames hit the same thing?** If it does, it is the kit's, and what we
write here is an ask.

| Piece                                              | Owner                    | Why                                                                                                                                                                                    |
| -------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The icon's open gesture (§2.1)                     | **kit** — ask #19        | `vf-open` comes from one `dblclick` handler inside `vf-icon`'s shadow root. Every kit consumer with icons is unopenable on a tablet.                                                   |
| The icon's drag threshold (§2.2)                   | **kit** — ask #20        | The drag begins inside `DragController`; nothing fires before the kit has decided, so there is no seam for the app to widen.                                                           |
| Window widget and rail arrow sizes (§2.4)          | **kit** — ask #21, held  | The kit's own geometry, and the art's. Only a measurement on the device justifies the ask (decision 8).                                                                                |
| Menus, title-bar drag, grow box, rails, the cursor | **kit**, already done    | Listed in §1. Not reopened.                                                                                                                                                            |
| The rubber band under a finger                     | **kit**, already decided | `vf-icon-field` states it is a mouse and pen gesture so a finger can pan a folder window. Decision 10 leaves it.                                                                       |
| The canvas's pointer ownership (§2.3)              | **app**                  | Our component, our bug. The rect and select paths in the same file already guard by `pointerId`.                                                                                       |
| Palm rejection and the pen                         | **app**                  | The canvas decides what a press on it means.                                                                                                                                           |
| Pick on press vs release in the palettes           | **app**                  | The Color Palette's cells are kit `vf-swatch`es, but pick-on-`pointerdown` is a behavior the app bound on top of them for the MacPaint feel. We added it; we own its touch refinement. |
| File → Open, Edit → Clear                          | **app**                  | Menus are per-application by the project's own rule (`src/apps/<id>/menus.html`).                                                                                                      |
| The raster and the scale on a tablet               | **app**                  | `main.js` calls `fitWithin`; the kit only supplies the scale.                                                                                                                          |
| The words                                          | **app**                  | README, SPEC, the read-me.                                                                                                                                                             |

Two judgement calls sit on the line, and both are deliberate:

- **The bridge is app code doing a kit's job.** §4.1's tap-pair detector in
  `apps/finder/icons.js` belongs in `vf-icon`. It goes in the app anyway
  because otherwise the iPad stays unopenable until a kit release, and the
  same file already carries kit ask #5's bridge. It is written to be deleted
  (decision 1) and it dispatches the kit's own `vf-open` rather than
  inventing an app route.
- **`lib/tap.js` is a generic rule living in the app.** A time-and-distance
  tap classifier is the kit's kind of thing. It sits here because the bridge
  needs it now — deliberate, temporary duplication. Its numbers go into ask
  #19 so both ends agree on them, and when #19 ships the module goes with the
  bridge: `press-pick.js` wants a slop-on-release rule, not a pair, and keeps
  its own.

So: the blocking bug is wholly the kit's, and five of the six app steps (§8)
are ours regardless of when the kit moves.

## 4. The design

### 4.1 The tap pair — the kit's, shipped

**Not built.** vintage-frames 0.12.2 shipped kit ask #19 before this step ran,
so `vf-icon` classifies the tap pair itself (`TAP_PAIR_MS` 500,
`TAP_PAIR_SLOP_PX` 24, on the second release) and the mouse keeps `dblclick`.
The interim bridge, `src/lib/tap.js` and `test/tap.test.mjs` were never
written, and §6's test went with them. The numbers the kit chose are the ones
the ask carried. What follows is the design as drafted.

A pure classifier, `src/lib/tap.js`, holds the rule and nothing else:

```js
createTapPair({ withinMs = 500, slopPx = 24 }); // → { press(id, x, y, t) → boolean, reset() }
```

`press` records a press and returns true when it is the second of a pair on
the same target: within `withinMs` of the first and no further than `slopPx`
from it, in CSS px. Anything else starts a new pair. It is time and distance
only — no DOM, no events — so it is a unit-testable rule (§6), and the same
numbers go into the ask.

In `apps/finder/icons.js`, one document-level `pointerdown` listener per
field owns a classifier per icon key. It runs only for
`event.pointerType !== 'mouse'`, so the mouse keeps the kit's `dblclick`
untouched, and it skips a press whose `composedPath()` holds an `<input>` —
the open rename box, where a double-tap selects a word. On a pair it
dispatches `vf-open` on the icon, which is the kit's own event, so
`wireDoc` / `wireFolder` / `wireText` run exactly as they do for a mouse and
nothing else in the app learns a new route.

If WebKit also delivers a `dblclick` for the same double-tap, the icon opens
twice — and every open in the app is idempotent (`workspace.openStored`
returns the live context and raises its window; a folder and a text file
raise theirs), so the second is a raise. No suppression flag is needed, and
none is added.

Both the bridge and `lib/tap.js` are deleted the day the kit ships the
gesture (§3, §5).

### 4.2 One pointer per stroke — app

`sm-draw-canvas` gains `#strokePointer`, handled exactly as `#rectPointer`
and `#selPointer` are: the pencil/eraser press claims it and ignores a press
while one is held; `#onPointerMove` strokes only for the owner; `#pointerUp`
and `#pointerCancel` end the stroke only for the owner and release the
capture. Nothing else in the file changes, and the mouse sees no difference —
a mouse never had two pointers.

### 4.3 The pen — app

Apple Pencil arrives as `pointerType === 'pen'` with the same press / drag /
release, so drawing already works. Two things are worth doing and one is not:

- **Palm rejection.** While a `pen` pointer is down on the canvas, a `touch`
  press on it is ignored, and so is one within a short grace after the pen
  lifts. Resting a hand on the glass to draw is the whole point of a pen.
- **Hover.** An M2 iPad Pro reports the Pencil's hover as a `pointermove`
  with no buttons, which is already what draws the canvas's footprint
  preview. Nothing to build; an eye check confirms it.
- **Pressure and tilt are not mapped.** The brush writes whole texels from a
  size and a shape that the options strip states. A pressure-varying 1-bit
  pixel brush would make the same stroke land differently twice, which is the
  opposite of what a pixel tool is for (decision 6).

### 4.4 A pick that survives a pan — app

The Tools palette, the Color Palette and the Full Sprite View pick on
`pointerdown` — the MacPaint feel, and not negotiable for a mouse. Two of the
three sit inside a scroller, so under a finger the pan that reaches a swatch
picks whatever it started on.

`src/components/press-pick.js` (DOM, beside its users) wraps the rule: for
`mouse` and `pen` it picks on the press, unchanged; for `touch` it holds the
press and picks on the release, if the pointer stayed within the same slop
the tap pair uses. The Tools palette does not scroll, so it could keep the
press either way; it takes the same helper so the three read alike.

### 4.5 The two menu items — app

- **Finder, File → Open ⌘O**, above New Sprite, acting on the icon selection —
  the System 7 item, with System 7's key. It is not the retired "Open…"
  dialog (Sep 9 2026); it opens what is already selected, and it is the
  insurance that the desktop is never unopenable again.
- **Sprite Editor, Edit → Clear**, under Select All, doing what Delete does
  over a selection and greyed when there is none.

### 4.6 The words — app

- README: the shortcut table's "Double-click" row becomes "Double-click or
  double-tap"; §Finder's open bullet the same; a short **On a tablet**
  passage under §The desktop saying what a finger does and what wants a
  keyboard, in the README's plain language — no "pointer type", no "coarse".
- `src/texts/read-me.txt`: the same sentence, so every profile sees it.
- SPEC: an Input section stating the one rule (§1) and the tap pair's
  numbers; the Finder's File menu and the Sprite Editor's Edit menu.
- Header comments: `lib/tap.js`, `components/press-pick.js`, the canvas's
  pointer note, `apps/finder/icons.js`'s bridge note naming the kit ask.

## 5. Kit asks

**#19 and #20 shipped in vintage-frames 0.12.2 (2026-09-18) before the ask doc
was written, so `docs/kit-asks-pointer.md` does not exist.** #21 is held on
decision 8. The two shipped asks, as they stood:

- **#19 — `vf-icon` opens on a tap pair, not `dblclick` alone.** **Shipped.** The open
  gesture is classified from the icon's own pointer events (the press pair:
  same icon, inside a window, inside a slop) so it survives a pointer whose
  press was `preventDefault()`ed for the drag and a platform that reserves
  double-tap for zoom. `dblclick` stays for the mouse. The ask carries §4.1's
  numbers. This is the blocking one: until it ships, `apps/finder/icons.js`
  carries the bridge, the way it has carried kit ask #5's.
- **#20 — a movement threshold before an icon leaves its place.** **Shipped**
  as `DRAG_SLOP_PX` 4 and `DRAG_SLOP_COARSE_PX` 10 CSS px. A drag
  begins after a stated slop rather than at the first system px
  (`vf-icon.ts:1154`), wider for a coarse pointer, so a tap selects and a
  drag drags. The app has no clean bridge for this one and waits.
- **#21 — coarse-pointer hit insets**, held back until the device says it is
  needed. The window widgets and rail arrows are 16.5 and 22 CSS px at an
  iPad's scale (§2.4, decision 8). It is the kit's geometry, and the ask
  should carry a measurement rather than a guess.

## 6. Tests

**None.** The one new pure rule was `createTapPair`, and the kit shipped the
gesture instead, so by `docs/TESTING.md` the default holds: no new test. What
landed is wiring and look, checked by eye on the device. The test that would
have been written, on `createTapPair`:

- Two presses inside the window and the slop are a pair; the third press is
  not (a pair does not chain).
- A second press past the window, or past the slop, is not a pair and becomes
  the new first.
- A press on a different id never pairs with another id's.
- `reset()` forgets the pending first press.

No test asserts the numbers as such — the rules and the edges, not the
constants.

## 7. Decisions

All ten taken 2026-09-19, each as recommended. 1 was overtaken by the kit
release: no bridge and no `lib/tap.js`, since 0.12.2 ships the gesture. 8 stays
a defer — the measurement waits on the iPad.

1. **Where the open gesture lives.** Recommended: kit ask #19 **and** the
   interim bridge in `apps/finder/icons.js` (§4.1), deleted the day the kit
   ships it — the precedent kit ask #5 set. The alternatives: the ask alone,
   which leaves the iPad unable to open anything until a kit release; or the
   bridge as the permanent answer, which puts a gesture the kit owns in the
   app forever.
2. **What counts as a tap pair.** Recommended: 500 ms and 24 CSS px, on
   `pointerType !== 'mouse'` only. 500 ms is the usual double-click window
   and comfortably under the kit's 800 ms rename delay, so the second tap
   still lands before a rename can open; 24 CSS px is a finger's honest
   wobble at an icon's 96 px cell. The alternative reuses `RENAME_DELAY_MS`
   (800 ms), which is generous enough that two deliberate separate taps on
   the same icon would open it.
3. **Finder → File → Open ⌘O.** Recommended: yes, on the selection (§4.5).
   It is the System 7 item, it gives touch a second route that cannot break,
   and it does not reopen the retired Open… dialog. The alternative relies on
   the tap pair alone and keeps the File menu as it is.
4. **Sprite Editor → Edit → Clear.** Recommended: yes. Delete over a
   selection is otherwise unreachable without a keyboard, and Clear is where
   System 7 put it. The alternative leaves it to the keyboard.
5. **Palm rejection on the canvas.** Recommended: yes — while a pen is down,
   a finger press on the canvas is ignored (§4.3). The alternative is nothing,
   and a resting hand draws.
6. **Pressure and tilt.** Recommended: not mapped (§4.3). A 1-bit texel brush
   wants a size you state, not one that varies with how hard you lean. Kept
   as a follow-up if the user wants it after drawing with the Pencil. The
   alternative maps pressure to the brush size now.
7. **Picks inside a scroller.** Recommended: `press-pick.js` (§4.4) — press
   for mouse and pen, release for touch, across the Tools palette, the Color
   Palette and the Full Sprite View. The mouse feel is untouched. The
   alternatives: leave it, and a pan past a swatch changes the ink; or set
   `touch-action: none` on the cells, which stops the pan altogether.
8. **Hit targets and the scale.** Recommended: **defer**, and decide after
   step 1's eye check on the actual iPad. A close box is 16.5 CSS px at the
   kit's derived scale (§2.4) and the answer is a measurement, not a guess.
   The options then are: nothing; kit ask #21 for a coarse-pointer hit inset
   that leaves the art alone; or the app forcing `--vf-scale` a rung higher
   on a coarse pointer, which halves the raster and is the one I would not
   recommend.
9. **Long-press for the second button.** Recommended: no. It would collide
   with the icon's 800 ms rename delay and with the menus' hold-to-close, and
   the Eraser tool already is the erase (§2.5). The alternative adds a hold
   on the canvas that nothing on screen mentions.
10. **Multi-select and the rubber band on touch.** Recommended: nothing now.
    The kit called the band a mouse and pen gesture so a finger can pan a
    folder window, and Edit → Select All covers the common case. A follow-up
    can ask for a stated touch way to extend a selection. The alternative
    asks the kit for the band under a finger and gives up the pan.

## 8. Steps, each landing green

### In the app

1. **The tap opens.** ~~`lib/tap.js`, its test, the bridge in
   `apps/finder/icons.js`, and kit ask #19 written.~~ The dependency bump to
   vintage-frames `^0.12.2` is the whole step. By eye, on the
   iPad, over the LAN dev server: double-tap a document, a folder, the Trash
   and a read-me — each opens. A single tap still only selects. A tap on the
   name of a selected icon still opens the rename box, and a double-tap
   inside that box selects a word instead of opening. On the Mac, with a
   mouse, every one of those is unchanged.
2. **One pointer per stroke.** §4.2. By eye: on the iPad, draw with one
   finger, land a second on the canvas mid-stroke, lift both — the stroke is
   one line and one Undo takes all of it back. Repeat for the eraser. On the
   Mac nothing changes.
3. **The pen.** §4.3's palm rejection. By eye: draw with the Pencil with a
   hand resting on the glass — only the Pencil draws. Hover the Pencil
   without touching — the footprint preview follows it.
4. **Picks inside a scroller.** §4.4. By eye: on the iPad, pan the Color
   Palette with a finger across several swatches — the ink does not change;
   tap one — it does. The same in the Full Sprite View. On the Mac every pick
   is still on the press.
5. **The two menu items.** §4.5. By eye: select an icon and pick File → Open;
   make a selection and pick Edit → Clear, then Undo. Both greyed with
   nothing selected.
6. **The words.** §4.6, and this plan's status line.

Steps 2 to 6 stand whatever the kit does. The app bump is a patch: a gesture
that should always have worked, two menu items and a canvas fix. The engine
does not change and does not bump.

### Waiting on the kit

- **#19 and #20 shipped** in 0.12.2. The eye checks are step 1's, plus: a tap
  on a desktop icon selects it without nudging it off its cell.
- **#21**, only if decision 8 asks for it after step 1's eye check.

## 9. Follow-ups

- **A square / axis lock without Shift**, as a toggle in the options strip
  beside the rect tool's corner radius.
- **Cancel a drag without Esc** — the classic route was to drag back to where
  you started, which works with any instrument.
- **Pressure**, if drawing with the Pencil asks for it (decision 6).
- **Extending an icon selection by touch** (decision 10).
- **Portrait on an iPad**: the raster is 536 system px wide, close to the
  compact Mac's, and the Sprite Editor's window set was placed for a wide
  desktop. Whether Arrange Windows wants a portrait arrangement is its own
  question, and step 1's eye check will say.

## 10. Files touched

Every source file here is the app's; the kit's share shipped as 0.12.2.

| App file                                                     | What                                                |
| ------------------------------------------------------------ | --------------------------------------------------- |
| `package.json`                                               | vintage-frames `^0.12.2`: the tap pair and the slop |
| `src/components/press-pick.js`                               | new: press for mouse and pen, release for touch     |
| `src/components/sm-draw-canvas.js`                           | `#strokePointer`, palm rejection, `clearSelection`  |
| `src/components/sm-editor.js`                                | the `clearSelection` forward                        |
| `src/components/sm-tool-strip.js`                            | the press-pick helper                               |
| `src/components/sm-palette-view.js`                          | the press-pick helper                               |
| `src/components/sm-atlas-view.js`                            | the press-pick helper                               |
| `src/apps/finder/menus.html`, `.../index.js`, `.../icons.js` | File → Open ⌘O on the selection, with its greying   |
| `src/apps/sprite-editor/menus.html`, `.../index.js`          | Edit → Clear, with its greying                      |
| `README.md`, `src/texts/*.txt`, `docs/SPEC.md`               | §4.6                                                |

Not written: `src/lib/tap.js`, `test/tap.test.mjs`, the Finder bridge and
`docs/kit-asks-pointer.md` — the kit shipped #19 and #20 first.
