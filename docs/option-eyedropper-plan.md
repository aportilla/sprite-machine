# Plan: Show the eyedropper while Option is held

**Status:** steps 1 to 3 built 2026-09-17, gates green, not committed. The
eye checks in step 2 are not yet confirmed. Every decision was made
2026-09-17 as recommended (§6), on _"Let's proceed with the plan - except
for the cursor changes - which we'll do later after a VF update. Your recs
are good."_ Step 4 waits on kit ask #18 and a vintage-frames release. The
ask: _"in our
editor view - using the option modifier allows us to temporarily be in
eyedropper mode to pick a color. i'd like to provide visual feedback for that
mode. can we update the 'tool' windoid active tool state to show the
eyedropper tool selected while the option key is held down? also - can we
use the eyedropper icon as our cursor when in this tool mode? we should use
the eyedropper icon as cursor whenever in eyedropper mode - not just when
entering it ephemerally via option-click."_

The short version: while Option is held over the Sprite Editor, the Tools
palette inverts the eyedropper's cell in place of the chosen tool's, and the
canvas's hover preview becomes the eyedropper's ants. Releasing Option brings
both back. The chosen tool never changes, so a selection stays up and the
options strip holds still. Steps 1 to 3 need nothing from the kit. Step 4
makes the pointer the eyedropper whenever a press would sample, with the
chosen eyedropper or with Option. It needs the kit's cursor to accept a kind
the app names. The art stays in the app. The engine does not change.

## 1. The model we copy

- **MacPaint's tool palette.** The inverted cell is the tool the next press
  uses.
- **The Mac's pointer.** The arrow, the I-beam and the crosshair each say
  what a press will do there. The kit's cursor follows the same rule
  (`data-vf-cursor` claims).
- **Photoshop's Option eyedropper on the Mac.** With a painting tool, Option
  samples, and the pointer is the eyedropper while the key is down.
- **The in-app precedents:**
  - the Option-sample in `<sm-draw-canvas>`: a primary press with `altKey`
    samples with any tool, and a right press with Option still erases;
  - the eyedropper's hover preview: ants around the texel under the pointer;
  - `session.gesture`, which the layer keys and the Edit menu already wait
    on while a drag is in progress;
  - the canvas's cursor claims: the crosshair, and the arrow over a
    selection with the selection tool.

## 2. The design

### 2.1 The rule

One pure rule, in a new `src/lib/tools.js`:

```js
springTool(tool, option, dragging); // the tool the next primary press uses
```

It returns `'eyedropper'` while Option is held and no drag is in progress,
else `tool`. A drag keeps the tool it started with, because the stroke,
rect or move goes on with that tool whatever the key does (decision 1). With
the eyedropper chosen the rule always returns it.

The press itself doesn't change: it still reads `e.altKey`, the truth at the
press. The rule is for what the screen shows, so a stale key state can
mislead the palette for a moment but can never change what a click does.

### 2.2 The Option key

The session gains `option: boolean`, false at boot, and `setOption(v)`.
`store.patch` skips an unchanged value, so a repeating key-down costs
nothing.

The Sprite Editor's `index.js` keeps it current, with its `on()` helper
(which now takes listener options) and teardown, after the Edit menu's
clipboard gate:

- **The gate.** It is set only while the Sprite Editor is front
  (`shell.appActive`), no text field has focus (the clipboard gate's
  `textFocused`) and no modal is open (`modalOpen()`, which covers the
  Colors dialog). Option in a field types a character there. Clearing is
  never gated.
- **Every key event** (window, capture phase) re-reads it: an `Alt` key-down
  sets it, an `Alt` key-up clears it, and any other key reads `altKey`.
- **Every pointer move and press** (window, capture phase, passive) reads
  `altKey`. This catches a key-up that was lost and an Option already held
  when the pointer comes back.
- **A window blur** and a hidden page clear it, since the key-up is lost
  when Option is released in another program.
- **The Sprite Editor going to the back** clears it (a `shell` subscription).

### 2.3 The Tools palette

`<sm-tools-panel>` passes both tools to the strip:

```js
.tool=${s.tool}
.shown=${springTool(s.tool, s.option, s.gesture)}
```

`<sm-tool-strip>` gains `shown`. The inverted cell and `aria-pressed` follow
`shown`. The pick guard still compares against `tool`. Without that split, an
Option-click on the eyedropper cell would be taken for a click on the
current tool and pick nothing. Any cell pressed with Option picks its tool,
as today, and the palette shows the new tool once Option is released.

The Tools menu's checkmark and the options strip stay on the chosen tool
(decision 2).

### 2.4 The canvas

`<sm-editor>` passes `.option=${s.option}`. The canvas does not take the
spring tool as its `tool`, because a `tool` change drops the selection,
cancels a rect drag and ends a stroke. It keeps `tool` and adds:

```js
get #sampling() {
  return springTool(this.tool, this.option, this.#dragging) === 'eyedropper';
}
```

The canvas reads its own `#dragging`, which is exact at every pointer event.
The palette reads `session.gesture`, which the same handlers report.

- `#drawCursor` tests `#sampling` first, in place of
  `this.tool === 'eyedropper'`, so a held Option shows the one-texel ants
  over the pencil's footprint or the eraser's ants. A right-button stroke or
  rect drag is a drag, so it keeps the erase ants.
- `#cursorAntsUp` counts `#sampling`, so the ticker runs for those ants.
- `updated()` redraws the cursor layer when `option` changes, so the preview
  swaps with the pointer still.
- The press is unchanged (§2.1).

What an Option-click does is unchanged. A painted texel sets the ink, and
with the eraser chosen, switches to the pencil. An empty texel selects the
eraser. Once Option is released, the palette shows the resulting tool.

### 2.5 The cursor (step 4)

**The kind.** The canvas claims `data-vf-cursor="eyedropper"` while
`#sampling`. The kit re-reads a claim when its attribute changes, so a still
pointer swaps when Option goes down. The existing claims keep their rules.
One method works out the claim from the state, in place of today's four
scattered `#setCursorClaim` calls:

| State                                 | Claim        |
| ------------------------------------- | ------------ |
| a selection move in progress          | `arrow`      |
| `#sampling`                           | `eyedropper` |
| the selection tool over the selection | `arrow`      |
| otherwise                             | `crosshair`  |

It runs from `#drawCursor` (each hover, each redraw and the pointer's
leave), from `#notifyGesture` (a drag's start and end), from
`#dropSelection` and from `#resetWorking`. The well around the canvas and
the edge hints keep the arrow.

**The art.** `src/assets/cursors/eyedropper.png`, 18×18: the tool icon's
16×16 glyph with its barrel filled white and a one-pixel white outline,
drawn as-is like the kit's arrow, with the hotspot on the tip at (1, 15)
(decision 3). Derived from `src/assets/tools/eyedropper.png`:

```
 0 ............ooooo.      # ink
 1 ...........oo###oo      o white
 2 ...........o#####o      . clear
 3 ........oooo#####o
 4 ........o########o
 5 ........oo######oo
 6 .......oo#o###ooo.
 7 ......oo#ooo##o...
 8 .....oo#ooo#o#o...
 9 ....oo#ooo#oooo...
10 ...oo#ooo#oo......
11 ..oo#ooo#oo.......
12 .oo#ooo#oo........
13 .o#ooo#oo.........
14 oo#oo#oo..........
15 o#o##oo...........      hotspot (1, 15)
16 oo#ooo............
17 .ooo..............
```

`src/apps/sprite-editor/cursors.js` exports the art record (`src`, `width`,
`height`, the hotspot, no `invert`), and `main.js` hands it to
`applyCursor` in the form the kit ships (§4). The ants stay under the
cursor (decision 4).

### 2.6 The words

- README: §The tools, the Option bullet (the Tools window shows the
  eyedropper while Option is held). Step 4: the eyedropper row and the
  bullet mention the pointer.
- `docs/SPEC.md`: §Drawing editor's Tools and Eyedropper bullets, with the
  rule, the mid-drag case and what stays on the chosen tool. Step 4: the
  claim table and the art.
- `src/texts/read-me.txt` and `keyboard-shortcuts.txt`: no change. "Option-click
  — Pick a color" still holds.
- The header comments of `sm-tool-strip.js` (`shown`) and `sm-draw-canvas.js`
  (`option`), and the session's field comment.

## 3. Steps, each landing green

1. **The rule and the key.** `springTool` in `src/lib/tools.js` with its
   test (§5). `option` and `setOption` in the session. The key tracking in
   `apps/sprite-editor/index.js`. Nothing reads `option` yet.
2. **The palette and the preview.** `shown` in the strip and the panel,
   `.option` through `sm-editor`, `#sampling` in the canvas. Verified by eye
   on the Car:
   - Pick the pencil and rest the pointer on the canvas. Hold Option without
     moving: the Tools window inverts the eyedropper and clears the pencil,
     and the ink footprint becomes ants around one texel. Release: both come
     back.
   - Option-click a painted pixel: the swatch takes its color, and the
     pencil is back on release. Option-click an empty spot: the eraser is
     inverted on release.
   - Start a pencil stroke, then press Option: the stroke keeps painting and
     the palette keeps the pencil. Let go of the mouse with Option still
     down: the eyedropper inverts.
   - Right-drag with Option held: it erases, with the erase ants, and the
     palette shows the pencil during the drag.
   - Selection tool with a selection up: hold Option, and the eyedropper
     inverts while the ants stay. Option-click inside samples, and the
     selection is still there on release.
   - Hold Option and press the Eraser cell: the eraser is picked and shows
     once Option is released.
   - With the eyedropper chosen, Option changes nothing.
   - Rect tool: click into the radius field and hold Option: nothing
     changes.
   - Hold Option, ⌘-Tab to another program, release, come back: the palette
     shows the chosen tool.
   - The options strip and the Tools menu's checkmark never move.
3. **The words.** §2.6 without step 4's parts, and this plan's status line.
   App patch release: a visible change to an existing feature.
4. **The cursor**, once kit ask #18 ships. The vintage-frames bump, the art
   and `cursors.js`, the `main.js` hand-off, the claim method in the
   canvas, and step 4's words. App patch release. Verified by eye:
   - Pick the eyedropper: over the canvas the pointer is the eyedropper,
     its tip on the ringed texel. Over the well and the edge hints it is the
     arrow.
   - Pencil, with the pointer still: Option swaps the crosshair for the
     eyedropper and back.
   - Selection tool: the arrow over the selection, the eyedropper there with
     Option, the arrow again during a move even with Option pressed.
   - The eyedropper reads on black art, on white art and on the dither.
   - Safari draws the same art, since it doesn't use the XOR pen.
   - At 2× and 3× scale the art stays on the system-pixel grid.

## 4. Kit asks

**#18: named cursor kinds.** `applyCursor` knows four kinds, and a
`data-vf-cursor` claim for any other name is skipped, so the walk goes on
and the arrow shows. A paint program has a cursor per tool: MacPaint's
pencil, brush and bucket, and the eyedropper here. The ask: a consumer can
add named kinds with their own art, claimed like the built-ins.

- The suggested shape: `applyCursor({ kinds: { eyedropper: art } })`, each a
  `VfCursorArt`, preloaded with the built-ins, claimed by
  `data-vf-cursor="eyedropper"` under the nearest-claim rule, and falling
  back to the arrow while its art is missing. `aria-busy` still wins. A name
  that is a built-in kind is ignored (the four options already cover them).
  The overlay's `data-kind` shows the name.
- The claim's type widens past `VfCursorKind`, or takes the registered
  names.
- The app ships its own art, so the kit ships no eyedropper.
- No app bridge: there is no claim that hides the kit's cursor, so the app
  can't draw its own, and calling `applyCursor` again with different
  crosshair art would flash the pointer and change the selection tool's
  crosshair too (decision 5).

Steps 1 to 3 need nothing from the kit.

## 5. Tests

By `docs/TESTING.md`: the rule gets a contract test. The key tracking, the
palette, the preview and the cursor are wiring and look, checked by eye.

- `test/tools.test.mjs`, `springTool`: with Option up, every tool is
  itself; with Option held and no drag, every tool is the eyedropper; with
  Option held mid-drag, every tool is itself; the chosen eyedropper stays
  the eyedropper in all three.

Nothing for `setOption`, a plain flag. Nothing for step 4.

## 6. Decisions

1. **Option pressed during a drag.** Recommended: the palette (and in step 4
   the pointer) keeps the drag's tool until the drag ends, then shows the
   eyedropper if Option is still down. The drag goes on with its own tool,
   so this shows what is happening. The alternative switches at once, and
   the palette shows the eyedropper over a pencil stroke still painting.
   Decided 2026-09-17: as recommended.
2. **The options strip and the Tools menu.** Recommended: both stay on the
   chosen tool. The eyedropper has no options, so a strip that followed
   Option would empty and refill with every press, and the checkmark names
   the tool you picked. The alternative has both follow the palette.
   Decided 2026-09-17: as recommended.
3. **The cursor art (step 4).** Recommended: the icon's glyph with a white
   fill and a one-pixel white outline, drawn as-is like the kit's arrow,
   18×18 with the hotspot on the tip. It reads on any art and looks the same
   in every browser. I derive it from the tool icon, and you repaint it if
   you like. The alternative is the bare glyph with the XOR pen, like the
   kit's crosshair. It inverts whatever is under it, but it needs a second,
   outlined PNG for Safari, which can't draw with the XOR pen. Decided
   2026-09-17: as recommended.
4. **The ants under the cursor (step 4).** Recommended: keep them. At large
   texel sizes the one-pixel tip doesn't make clear which texel will be
   sampled, and the ants match the eraser's preview. The alternative drops
   them once the cursor shows the tool. Decided 2026-09-17: as recommended.
5. **The kit ask's shape.** Your call as the kit's author. Recommended:
   named kinds in `applyCursor`'s options, as in §4, so the kit still
   places, snaps and layers the art. The alternative is a `none` claim that
   hides the kit's cursor over an element, with the app drawing its own
   pointer there. That is smaller for the kit, but the app would have to
   redo the lattice snapping, the scale tracking and the top-layer placement
   itself. Decided 2026-09-17: as recommended.

## 7. Follow-ups

- **Cursors for the other tools** once named kinds ship: the pencil, the
  bucket and the eraser, drawn by you.
- **`src/shortcuts.js` moves into `apps/sprite-editor/`.** It is the Sprite
  Editor's tool and layer keys, at the root.
- **A bare Alt on Windows and Linux.** Some browsers there move focus to
  their own menu bar when Alt is released alone. The plan doesn't try to
  stop that. Worth a look if it gets in the way.
- **A spring-loaded pick on the palette itself**: an Option-click on a cell
  that picks the tool only while the key is held. Not asked for.

## 8. Files touched

| File                                | What                                                         |
| ----------------------------------- | ------------------------------------------------------------ |
| `src/lib/tools.js`                  | new: `springTool`                                            |
| `test/tools.test.mjs`               | new: §5                                                      |
| `src/state/session.js`              | `option`, `setOption`                                        |
| `src/apps/sprite-editor/index.js`   | the Option tracking and its gates                            |
| `src/components/sm-tools-panel.js`  | passes `tool` and `shown`                                    |
| `src/components/sm-tool-strip.js`   | `shown` drives the inverted cell and `aria-pressed`          |
| `src/components/sm-editor.js`       | passes `.option`                                             |
| `src/components/sm-draw-canvas.js`  | `option`, `#sampling`, the preview; step 4: the claim method |
| `src/assets/cursors/eyedropper.png` | new in step 4: the cursor art                                |
| `src/apps/sprite-editor/cursors.js` | new in step 4: the art record                                |
| `src/main.js`                       | step 4: hands the art to `applyCursor`                       |
| `package.json`, `package-lock.json` | step 4: the vintage-frames version                           |
| `README.md`, `docs/SPEC.md`         | §2.6                                                         |
