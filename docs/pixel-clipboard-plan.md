# Plan: Copy and Paste over the selection

**Status:** built and committed 2026-09-14, steps 1 to 4, gates green. The eye
checks in §3 are not yet confirmed. Every decision was made 2026-09-14 as
recommended (§6), on _"This is good i like the plan and your
recommendations."_ Not released. The ask: _"in our
editor, i'd like to make some enhancements to the 'select' tool,
specifically i'd like to enable copy and paste, so that pixels can be copied
from one tile or layer to another tile or layer... when pixels are
'copied'... paste is an available action, and pasting will activate the
'select' tool with the pasted pixels selectable ( and therefore moveable )
within the current editor tile."_

The short version: the Sprite Editor's Edit menu already holds Copy ⌘C,
Paste ⌘V and Select All ⌘A as greyed placeholders. They go live over the
selection. Copy takes the selection's texels and their place on the tile.
Paste switches to the selection tool and puts the pixels on the edited face
of the edited layer as a selection that is already lifted, so the first drag
moves them. They land where they were copied from when they fit the tile
there, else centered. The paste writes the pixels at once as one undo step,
as a move does, and from then on every rule of the selection tool applies.
The clipboard is app-wide, so a copy crosses faces, layers and documents.
Select All selects the whole tile, so a face copies to another layer with
⌘A, ⌘C, a layer key and ⌘V.

Steps 1 and 2 build it on the in-app clipboard alone, with Paste greyed until
a Copy. Step 3 puts the pixels on the system clipboard as a PNG and reads the
system clipboard at every paste, as the Finder does, so pixels go out to
other programs and images come in as a selection. Step 3 is built (decision
1). The engine does not change.

## 1. The model we copy

- **The Mac's Edit menu.** Undo, Cut, Copy, Paste, Clear and Select All, over
  one Clipboard that every application shares. A new Copy replaces what was
  there, and a command with nothing to act on is greyed.
- **MacPaint's paste.** The pasted picture arrives on the page as the
  selection, inside marching ants, ready to drag into place.
- **The in-app precedents:**
  - the Finder's Copy and Paste: the system clipboard read at every paste,
    the `state/clipboard.js` slice as the rich payload and the fallback, and
    the gate that greys the three items while a text control has focus;
  - the selection tool's float (`lib/select.js`): the lifted texels
    composited over a fixed base at each offset, so a drag never smears, with
    a move as one tile undo step;
  - the layer keys, which wait while a stroke or drag is in progress
    (`session.gesture`).

## 2. The design

### 2.1 The commands

The three items sit in the Sprite Editor's Edit menu between Redo and Pick
Color…, so they fire only while a document window is front. They act on the
active window's canvas: its edited face of its edited layer. Each handler
returns while a modal is open (`deps.modalOpen`), as every Sprite Editor
command does.

| Item          | Live while                                                |
| ------------- | --------------------------------------------------------- |
| Copy ⌘C       | the active window has a selection                         |
| Paste ⌘V      | step 2: the clipboard holds pixels. Step 3: always (§2.7) |
| Select All ⌘A | always                                                    |

All three are also greyed while a gesture is in progress (`session.gesture`)
and while a text control has focus, read as the Finder reads it, from
`focusin` and `focusout` on the composed path. A greyed item claims no key,
so ⌘C, ⌘V and ⌘A reach a focused field in the options strip or the 3D Sprite
Atlas's header. Copy reads the active window's `ctx.selection` store through
`followActive`. Its `bounds` change at pointer-move rate, so the sync writes
`disabled` only when it changes.

No Cut and no Clear (§7).

### 2.2 Copy

Copy takes the selection as it stands:

- **A marquee not yet moved**: `liftRect` over the canvas's working buffer at
  the marquee, which always lies inside the tile.
- **A selection that has moved, or a paste**: the float itself, whole,
  including texels a move carried off the tile (decision 2). Copy takes what
  a drag would move.

Either way the result is a copy of the bytes and their place: the top-left of
the selection's current rectangle in tile texels, which may be off the tile.
Copy changes nothing on the canvas, and the selection stays up. The clipboard
slice records it and forgets whatever it held (§2.6).

### 2.3 Paste

A paste acts on the active window when it lands:

1. **What to paste.** Step 2: the slice's pixels. Step 3: the source rule in
   §2.7.
2. **Where it lands.** `pasteOrigin(w, h, at, tileW, tileH)` in
   `lib/select.js`: the copied place when the whole float fits inside the tile
   there, else centered, rounding toward the top left, so a float larger than
   the tile sits at a negative offset (decision 3). An image from outside has
   no place and centers. A copy between layers or faces of one tile size
   lands in registration. A copy into a smaller tile lands centered and hangs
   off.
3. **The tool.** `session.setTool('select')`.
4. **The float.** The canvas drops any selection, as a click outside would,
   and installs the pasted one: the marquee at the landing rectangle, the
   float already lifted, the base a copy of the working buffer with no hole
   cleared, and a zero offset. It composites the float over the base and
   commits between `#beginGesture` and `#endGesture`, so the paste is one
   tile undo step (decision 7). Transparent float texels leave the art under
   them, as in a move. A paste that changes no byte, such as an
   all-transparent float or one pasted over the same art, writes nothing and
   records no step, so an empty mirror-derived face stays derived and the
   document stays clean.
5. **The outline.** The ants start and `sm-selection` reports the rectangle,
   so the options strip reads its `W × H`.

From there the paste is an ordinary lifted selection. A drag moves it over
the base, so the art it was pasted over comes back as it leaves, and Shift
locks the axis. Esc or a click outside drops it and keeps its pixels. A tool
switch, a face or layer switch and a structural change drop it. Texels off
the tile at the drop are lost. Undo takes back the move, then the paste. A
second ⌘V drops the first paste where it lies and pastes again on top of it.

In step 3 the read is asynchronous. A paste that resolves while a modal is
open, a gesture is in progress or no document window is active pastes
nothing.

### 2.4 Select All

Select All switches to the selection tool and selects the whole tile. The
canvas drops any selection and sets the marquee to the tile's bounds, not
lifted, with the ants started and the rectangle reported. It writes nothing.
A face copies to another layer in registration with ⌘A, ⌘C, a layer digit
and ⌘V (decision 5).

### 2.5 The canvas

`<sm-draw-canvas>` keeps the selection in private fields, so the commands
reach it through methods:

```js
copySelection(); // {float, x, y} | null: null with no selection or mid-drag
pasteFloat(float, x, y); // install the float at (x, y), lifted, as one undo step
selectAll(); // the whole tile, not lifted
```

Each does nothing during a stroke, a rect drag or a selection drag.
`<sm-editor>` forwards them to its canvas, and
`apps/sprite-editor/windows.js` returns a document window's editor from
`editor(key)`. The application's `index.js` sets the tool, computes the
landing and calls the editor. The canvas gains no store import.

One rule in the canvas changes. Today every `tool` change drops the
selection in `willUpdate`. A paste sets the tool and installs the float in
one task, and the canvas sees the new tool in its next update, after the
float is in, so today's rule would drop the paste. The drop now runs only
when the new tool is not the selection tool. No other case changes: a
selection exists only under the selection tool, so a change to that tool
never had one to drop.

For a paste, `#sel`'s lift origin is the landing, which may be off the tile.
`#startMove` lifts only when there is no float, so a pasted selection is
never lifted again. `#sel`'s comment says so.

### 2.6 The clipboard slice

`state/clipboard.js` holds one clipboard for the app, and a copy of either
kind replaces the other:

```js
{
  items: ClipboardItemRef[], // the Finder's references
  text: string, // the text written for them
  pixels: {float, x, y} | null, // the Sprite Editor's copy and its place
}
```

- `set(items, text)`, the Finder's Copy, also clears `pixels`.
- `setPixels(float, x, y)`, the Sprite Editor's Copy, clears `items` and
  `text` and keeps a copy of the float. A paste hands the canvas another copy,
  so no live buffer reaches the slice.
- The slice stays session-only.

The Finder's `pasteSource` does not change. It counts `items`, which a pixel
copy empties.

### 2.7 The system clipboard (step 3)

The Finder's model: the system clipboard is the truth at every paste, and the
slice carries what the system clipboard cannot.

**Copy** writes one `ClipboardItem` holding `image/png`: the float encoded by
`imageDataToPngBytes`, the engine's exact encoder. The item's value is the
encode's promise, so `navigator.clipboard.write` runs inside the menu pick's
task, the form Safari asks for. The slice gains `written`, false at the copy
and set true when the write resolves (`markWritten`, which ignores a write
whose copy a newer one replaced). There is no `text/plain` part, because
a text target would paste the text in place of the picture. A failed write is
silent, and the in-app copy stands.

**Paste** waits for a pending write, reads the system clipboard once, decodes
its `image/png` with `bytesToImageData` and hardens it (below), then picks
with a pure rule beside `pasteSource`:

```js
pixelPasteSource(slice, system); // 'pixels' | 'image' | 'none'
```

- The system clipboard is unreadable (no API, or permission denied or
  dismissed): `'pixels'` when the slice holds pixels, else `'none'`.
- It holds an image that is the slice's pixels (`sameArt`): `'pixels'`. The
  paste uses the slice's exact bytes and its place.
- It holds any other image: `'image'`, pasted centered. That covers a
  picture copied in another program, a web page's Copy Image, and the
  Finder's copy of one document, whose stored sheet pastes as a selection.
- It holds no image, and the slice's write failed: `'pixels'`.
- Otherwise `'none'`. The newest copy is text: the Text Viewer's, the
  Finder's names, or another program's.

An image that does not decode counts as no image.

`sameArt(a, b)` in `lib/select.js`: the same width and height, and at every
texel either both clear (alpha below 128) or both opaque with the same RGB.
Browsers re-encode a clipboard PNG and drop a clear texel's RGB, so the rule
reads texels as the carve does.

**Hardening.** `floatFromImage(image)` in `lib/select.js` turns decoded RGBA
into a float. Alpha 128 and up becomes 255 with its RGB kept, below 128
becomes four zero bytes, and it counts the opaque texels. An outside image
can carry soft edges, and every texel in the editor is fully opaque or fully
transparent (decision 4). The app's own copy is already hard, so hardening
leaves it as it is. An image of any size pastes, and the float keeps its
texels off the tile as a moved one does.

**Paste is always live.** Nothing can read the system clipboard before a
pick, so Paste is live whenever §2.1's gates allow, as the Finder's is. A
paste with nothing to paste does nothing.

**The `paste` event.** The browser's own Edit → Paste fires a `paste` event
with no key press, and it is the only route that carries a copied file. The
Sprite Editor listens as the Finder does, while it is front, Paste is live
and no modal is open, and sends the event's `image/png` through the same
dispatch as a readable system clipboard. The kit claims ⌘V while Paste is
live, so a key press never also fires the event.

**Shared code.** The Finder's `readSystemClipboard` moves to a new
`src/system-clipboard.js` beside `image-io.js`, with `pastedPng`, its paste
event's `image/png` scan, and both applications import them.

**Browsers.**

- Chrome asks once to see copied text and images, at the first read. A
  profile that has pasted in the Finder has already granted it. Denied, an
  in-app paste still works through the unreadable branch.
- Safari and Firefox read what the page wrote without asking, and show a
  Paste button near the pointer for content copied elsewhere.
- Chrome re-encodes clipboard PNGs both ways. `sameArt` absorbs what hard art
  loses, a clear texel's RGB. If a browser changed a color on the way, the
  app's own copy would read as a foreign image and paste centered in the
  changed color. Step 3's eye checks look for that, and the web custom format
  in §7 would remove the question.
- Safari has been strict about clipboard writes after the menu blink. The
  Finder's Copy has the same open check.

**The Finder and a pixel copy.** On the system clipboard the pixel PNG is an
image like any other. The Finder's ⌘V after a pixel copy shows its paste
alert with the selection's size, or saves a new document when that size is a
sheet's, such as 3 × 2 or 6 × 4 texels (decision 6).

### 2.8 The words

- README: §Drawing editor's Selection and Undo bullets; §Menu bar's Sprite
  Editor Edit bullet; §Architecture's `src/` line (step 3); §Folders' outside
  image paste, a sentence on a pixel copy (step 3); the next steps' Selection
  and Clipboard entries.
- `src/texts/keyboard-shortcuts.txt`: ⌘C, ⌘V and ⌘A under the Sprite Editor.
  `src/texts/read-me.txt`: a sentence on copying between layers. A seeded
  copy on an existing profile keeps the old text.
- The comment over the three items in `menus.html`, and the header comments
  of `state/clipboard.js`, `lib/select.js` and `sm-draw-canvas.js`.

## 3. Steps, each landing green

1. **The rules.** `pasteOrigin` in `lib/select.js`; `pixels` and `setPixels`
   in `state/clipboard.js`, with `set` clearing `pixels`. Tests: §5. Nothing
   calls them yet.
2. **In-app Copy, Paste and Select All.** The canvas methods and its
   tool-change rule, `sm-editor`'s forwarding, `windows.js`'s `editor(key)`,
   and the three commands and their gates in `index.js`, over the slice
   alone. Verified by eye, on the Car (40 px tiles):
   - Layer → New Layer, then `1`. With the selection tool, drag a box around
     the front wheel on the Front face and press ⌘C. Press `2`, then ⌘V: the
     wheel appears on Layer 2's Front face in the same place, inside marching
     ants, the Tools palette shows Selection, the strip reads the box's size,
     and the 3D View shows the second wheel's voxels.
   - Drag the pasted wheel: it moves, and Layer 2's art under it comes back.
     ⌘Z undoes the move, and a second ⌘Z the paste.
   - With the pencil picked, ⌘V switches to Selection and pastes. Esc drops
     the selection and keeps the pixels.
   - Back on Layer 1, the Right face opens empty because it is
     mirror-derived. ⌘V there makes the pixels the face's own art.
   - ⌘A selects the whole Front face and ⌘C copies it. In a new Cube document
     (8 px tiles), ⌘V lands the copy centered, hanging off every edge. It
     covers the whole canvas, so a press anywhere on it starts a move: Esc
     drops it and keeps only the texels on the tile, and ⌘Z restores the
     face.
   - The Edit menu: after a reload, Paste is greyed until a Copy. Copy is
     greyed with no selection, live with one, and greyed during a drag. With
     View → 3D Sprite Atlas shown and its `size` field focused, all three
     items grey, and ⌘A selects the field's text.
3. **The system clipboard.** `floatFromImage` and `sameArt` in
   `lib/select.js`, `written` and `pixelPasteSource` in `state/clipboard.js`,
   `src/system-clipboard.js`, Copy's write, Paste's read, the `paste` event,
   and Paste always live. Tests: §5.
   Verified by eye:
   - Copy a selection, then choose File → New from Clipboard in Preview: the
     pixels at their size, with transparency.
   - Copy a small image in another program, or Copy Image on a web page, then
     ⌘V on a tile: a centered selection with hard edges.
   - Copy a selection and ⌘V on another layer: it lands in place, which shows
     the browser's round trip kept every color.
   - Chrome's permission prompt appears at most once. With it denied, an
     in-app copy still pastes.
   - In Safari, a Copy reaches Preview.
   - In the Finder, ⌘V after a pixel copy shows the paste alert with the
     selection's size. Copy the Car's icon in the Finder, open a document and
     ⌘V: the Car's sheet arrives as a centered selection.
4. **The words.** §2.8, and this plan's status line.

The app bump is a patch, a feature on menu items that already exist. The
engine does not change.

## 4. Kit asks

None. `vf-menu-item` has `disabled`, and a disabled item claims no key. If
Safari refuses the write after the menu blink, the ask the Finder's Copy
would need, an unblinked activation for a key equivalent, covers this Copy
too. It is not written until a build shows the refusal.

## 5. Tests

By `docs/TESTING.md`: the new pure rules get contract tests. The canvas
methods, the menu gates, the tool switch, the system clipboard and the
browsers are wiring, checked by eye.

Step 1:

- `test/select.test.mjs`, `pasteOrigin`: a float that fits at its place keeps
  it, including one flush with the far edges; a place that crosses an edge,
  a place with a negative coordinate, and no place all center; centering
  rounds toward the top left; a float wider or taller than the tile centers
  at a negative offset.
- `test/clipboard.test.mjs`, one clipboard: `setPixels` empties the items and
  the text, and `set` empties the pixels. The existing test's empty slice
  gains `pixels: null`.

Step 3:

- `test/select.test.mjs`, `floatFromImage`: alpha 127 is clear with all four
  bytes zero, 128 is opaque at 255 with its RGB, the opaque count matches,
  and the source is untouched. `sameArt`: equal floats match, and clear
  texels with different RGB match; a different size, one texel's color, or a
  texel clear in one and opaque in the other does not.
- `test/clipboard.test.mjs`, `pixelPasteSource`: unreadable picks the pixels,
  or none with none held; an image equal to the pixels picks the pixels; a
  different image picks the image, with pixels or items held; no image picks
  none, or the pixels when their write failed.

## 6. Decisions

1. **The system clipboard.** Recommended: build step 3, the Finder's model.
   Pixels go out to other programs as a PNG and images come in as a
   selection, an in-app copy still lands exactly and in place, and a paste
   after a copy elsewhere pastes the newer copy. The costs: Paste is always
   live, where the ask has it become available after a Copy; Chrome asks for
   permission once; and each paste waits on an asynchronous read. The
   alternative stops after step 2: the clipboard is in-app only, Paste is
   greyed until a Copy, a paste is synchronous and never prompts, and nothing
   crosses to or from other programs. Decided 2026-09-14: as recommended.
2. **What Copy takes from a moved selection.** Recommended: the float, whole,
   with the texels a move carried off the tile, so Copy takes what a drag
   moves. The alternative takes what the tile shows inside the rectangle,
   clipped to the tile, with the base showing through the float's
   transparent texels. Decided 2026-09-14: as recommended.
3. **Where a paste lands.** Recommended: the copied place when the float fits
   the tile there, else centered. A copy between layers or faces keeps
   registration, which the lattice depends on. The alternatives always
   center, or always land at the top left. Decided 2026-09-14: as
   recommended.
4. **Soft alpha from outside (step 3).** Recommended: alpha 128 and up is
   opaque and below is clear, the carve's threshold, so pasted art keeps
   every texel fully opaque or fully transparent. The alternative pastes the
   alpha as decoded. Decided 2026-09-14: as recommended.
5. **Select All.** Recommended: in, selecting the whole tile under the
   selection tool. Copying a face to another layer is the ask's plainest
   case, and a marquee dragged corner to corner is fiddly on a large tile.
   The alternative leaves ⌘A a greyed placeholder. Decided 2026-09-14: as
   recommended.
6. **A pixel copy pasted in the Finder (step 3).** Recommended: no change.
   The Finder treats it as any image, so it shows the paste alert, or saves
   a new document when the selection's size is a sheet's. The alternative has
   the Finder recognize the editor's copy through `sameArt` and paste
   nothing. Decided 2026-09-14: as recommended.
7. **What a paste writes.** Recommended: the pixels at once, as one undo
   step, the float composited like a moved selection. The Full Sprite View,
   the 3D View and the Color Palette show it while it floats, Esc keeps it,
   and Undo removes it. The alternative writes nothing until the selection
   drops, and Esc discards the paste. The canvas would need a second kind of
   selection, and the model would not show a paste until it is set down.
   Decided 2026-09-14: as recommended.

## 7. Follow-ups

- **Cut ⌘X and Clear** over the selection. Clear writes the selection's hole
  as a tile undo step, and Cut is Copy then Clear. The Delete key as Clear.
- **A lossless system round trip.** A web custom format
  (`web application/x-sprite-machine`, Chrome) written beside `image/png`
  with the float's bytes and its place, and read in preference to the image.
  The README lists the same step for documents.
- **A registered paste.** The selection's listed "on all faces" move, for a
  paste onto every face at once.
- **A size cap** on a pasted image, if a photograph decodes or composites
  slowly.

## 8. Files touched

| File                                                        | What                                                                                            |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/lib/select.js`                                         | `pasteOrigin`; step 3: `floatFromImage`, `sameArt`                                              |
| `src/state/clipboard.js`                                    | `pixels`, `setPixels`, `set` clearing `pixels`; step 3: `written`, `pixelPasteSource`           |
| `src/components/sm-draw-canvas.js`                          | `copySelection`, `pasteFloat`, `selectAll`; a tool change drops the selection only off the tool |
| `src/components/sm-editor.js`                               | forwards the three methods                                                                      |
| `src/apps/sprite-editor/windows.js`                         | `editor(key)`                                                                                   |
| `src/apps/sprite-editor/index.js`                           | Copy, Paste, Select All and their gates; step 3: the system write and read, the `paste` event   |
| `src/apps/sprite-editor/menus.html`                         | the comment over the three items                                                                |
| `src/system-clipboard.js`                                   | new in step 3: `readSystemClipboard` and `pastedPng`, moved from the Finder                     |
| `src/apps/finder/index.js`                                  | step 3: imports `readSystemClipboard`                                                           |
| `test/select.test.mjs`, `test/clipboard.test.mjs`           | the tests in §5                                                                                 |
| `src/texts/keyboard-shortcuts.txt`, `src/texts/read-me.txt` | the three keys, copying between layers                                                          |
| `README.md`                                                 | §Drawing editor, §Menu bar, §Folders, §Architecture, the next steps                             |
