# Plan: exact pixels and the Color Palette windoid

**Status:** built and committed 2026-09-13, steps 1 to 6, gates green. The
user has looked at the Color Palette; the exact-pixel seams (step 3) are not
yet eyeballed. Every decision taken as recommended, 2026-09-13 (§7), then the windoid revised
the same day on a second ask (§3.5 to §3.7, decisions 6, 9, 12, 14 and 15),
with the height floor at two rows and the placed size at five columns by three
rows. Not released. The second ask: _"make the color pallete be 2 axis
resizable, the swatches should be squares, and we'll show a vertical scrollbar and the bottom
status bar where we'll put the label 'Color Palette' … we'll calculate a
dynamic 'grid' for the document colors based on the windoid width"_, and _"we
can put the color palette int the bottom left - sharing 'arrange' space with
the sprite atlas below the document window"_. The first ask:
_"on some privacy browsers (like helium) we have a bug where we're not able to
properly read the colors in the document, which leads to bugs with our wedge
geometry calculation due to the canvas pixel farbling protections. rather than
using 'closeness' heuristics to work around the issue, is there a way of
reading the colors directly from the png that would let us reliably get the
currently used color palette in the document? in particular, i'd like to add a
new 'color palette' view windoid that the user can activate, which would be a
narrow tall scrolling windoid positioned just below the tools windoid by our
'arrange' action."_

The short version: yes. A PNG's pixels are a zlib stream of filtered scan
lines, and decoding them is byte arithmetic that never touches a canvas. The
document already lives in memory as exact bytes; the noise gets in at exactly
two seams in `src/image-io.js`, the decode on open and the encode on save,
both of which go through a canvas. The engine gets a pure PNG decoder and a
browser entry, the app decodes and encodes through it, and every pixel the app
holds is then the file's. The palette is not read from the PNG separately.
It is a scan of the sheet the editor holds, which is exact from the decode on,
and it feeds a new **Color Palette** windoid: a grid of swatches docked at the
bottom left beside the 3D Sprite Atlas strip, toggled from the View menu like
the strip.

## 1. Analysis

### 1.1 What Helium does

Helium adds deterministic, origin-bound noise to canvas readback: per its
fingerprinting-resistance notes, `getImageData` and `toDataURL` are noised, in
smooth regions on one channel and in busy regions on all three, with alpha
jittered by ±1. Brave's farbling covers `getImageData`, `toDataURL`, `toBlob`
and `OffscreenCanvas.convertToBlob`. Whether Helium also noises `toBlob` is
not documented; the plan removes that call regardless. The noise is stable
within a session and origin, which is why the earlier console probe read a
solid fill back non-uniform but identical across two reads.

### 1.2 Where it gets in

The document's canonical pixels are an `ImageData` held by reference in the doc
slice. Every tool writes exact bytes into the working buffer, the eyedropper
samples that buffer, the display goes out through `putImageData` and
`drawImage`, and the engine reads `gviews` from the same bytes and bakes the
skin as bytes. Nothing on the edit path reads a canvas back. Two seams do:

- **Decode.** `bitmapToImageData` (`createImageBitmap`, `drawImage`,
  `getImageData`) is behind `bytesToImageData`, which is `files.decodeAtlas`
  (every open of a stored document), `loaders.loadFile` (a drop) and the
  Finder's paste of an outside image, and behind `urlToImageData`, which
  decodes the Car sample at seeding and in File → New…. `fileToImageData` has
  no caller.
- **Encode.** `imageDataToBlob` (`putImageData`, `canvas.toBlob`) is behind
  `imageDataToPngBytes`, which is `files.encodeAtlas`: every Save, Duplicate,
  first save, the Finder's re-encode of a pasted image, and Download of a
  dirty document.

Two more reads are renders, not documents: the icon renderer's `getImageData`
over the icon's GL render, and `canvasToPngBytes` (`toBlob`) for the sprite
atlas export. Noise of ±1 in a render is invisible, and the icon's coverage
threshold absorbs the alpha jitter. They stay as they are (§8).

### 1.3 What it breaks

The wedge gate was the symptom that showed. On a noised sheet, everything that
compares pixels exactly misbehaves, and a save writes the noise into the file:

- **Round trips drift.** Open on Helium loads a sheet off by ±1 per channel.
  Save writes those bytes, through a second noised call if `toBlob` is
  covered. Each open and save random-walks the art.
- **Alpha.** The app's invariant is hard pixels, alpha 0 or 255. A jitter to 1
  makes a transparent texel count as painted for `isBlank`, `contentBounds`,
  `keyAt` and the Full Sprite View's derived-face rule, so a mirror-derived
  face stops being derived. The carve's threshold of 128 keeps the model
  right, which hides the damage.
- **Fill.** The flood and the recolor match exactly (`lib/fill.js`). A flat
  region reads as dozens of near-colors, so a flood stops after a few texels
  and "every texel matching" recolors a scatter.
- **The eyedropper** picks the noised value, the Colors dialog reads Custom,
  and a stroke in the "same" color adds a near-duplicate to the palette.
- **The engine** splits `buildPalette` into near-duplicates and snaps to them,
  and the wedge gate needs `sameMat`'s tolerance to see one material.
- **The Car** is decoded at seeding, so a Helium profile's stored Car is noised
  from first boot.

### 1.4 Reading the PNG directly

A PNG is the chunk list the engine already walks (`png-chunks.js`): IHDR, then
the IDAT chunks, whose concatenation is one zlib stream, then IEND. Inflated,
the stream is scan lines, each led by a filter byte (None, Sub, Up, Average or
Paeth) over the samples the color type and bit depth define. Decoding is
inflate, unfilter and sample expansion, and the result is the file's bytes.
The engine already encodes this format (`png-encode.js`, stored deflate) and
decodes it in Node (`node.js`, over pngjs). The options for the browser:

- **A pure decoder in the engine** (recommended). The parse, unfilter and
  expansion are pure typed-array code, testable under Node against the
  engine's own encoder and against pngjs. Inflate comes from
  `DecompressionStream('deflate')`, in every current browser and in Node 18
  and later, typed in the Node globals the engine's typecheck already loads.
  The engine's root entry stays dependency-free and DOM-free, and the
  README's listed next step, a `sprite-machine/browser` adapter, lands as a
  real decoder rather than one over `createImageBitmap`.
- **pngjs in the browser.** Its browser build carries a zlib port and Buffer.
  The wrong shape for the root entry's "earcut alone".
- **WebCodecs `ImageDecoder` and `VideoFrame.copyTo`.** No Safari, an
  undocumented surface a privacy fork can noise next, and the browser's color
  management applies. Rejected.
- **WebGL upload and `readPixels`.** Farbled in Brave. Rejected.
- **Wider tolerances.** What the ask rules out. The tolerance in `sameMat`
  stays for the engine's sake (§7 decision 5), but the app stops needing it.

One side effect is a feature: a canvas decode color-manages a foreign PNG
that carries `gAMA` or `iCCP`, so its sample values change on the way in. The
pure decoder returns what the file holds. The app writes neither chunk, so its
own files are unchanged either way.

The answer to the question, then, is not to read the palette from the PNG
beside the pixels. That would make two sources of truth, a right palette over
wrong pixels. Decoding the document exactly makes the sheet the source, and the
palette is a scan of it (§3.4).

## 2. The model we copy

The floating palettes of the era: SuperPaint and Color MacPaint's color
palette, and the Swatches palette Photoshop 2.5 gave every later program. A
column of color wells, the current color marked, a click makes it the current
color. MacPaint's pattern palette picks on mouse-down, and the in-app Tools
palette follows it. The in-app precedents: the 3D Sprite Atlas for a
toggleable windoid with a close box and a checked View item, the Tools palette
for a column of cells and its place on the left, the Colors dialog for the
swatch grid recipe, and Desktop Patterns for the ring around the selected cell.

## 3. The design

### 3.1 The engine: `png-decode.js`

A new module in the root entry, pure:

```js
parsePng(bytes); // { width, height, bitDepth, colorType, interlace,
//   palette, trns, idat }
unfilterPng(header, raw); // { width, height, data }   RGBA8, row 0 on top
decodePng(bytes, inflate); // Promise of the same, inflate: (zlib) => bytes | Promise
```

- `parsePng` walks `readChunks`, reads IHDR, concatenates every IDAT into one
  stream, keeps PLTE and tRNS, and throws on a bad signature, a missing IHDR or
  IDAT, or a compression, filter or interlace method the spec does not define.
- `unfilterPng` undoes the five filters per scan line, over the seven Adam7
  passes when interlaced, then expands to RGBA8: color types 0, 2, 3, 4 and 6
  at bit depths 1, 2, 4, 8 and 16, the palette and its alpha for type 3, the
  tRNS color key for types 0 and 2, and a sample of another depth scaled to 8
  bits as pngjs scales it, `floor(v · 255 / max + 0.5)` (pngjs rounds a 16-bit
  sample; it does not take the high byte). It throws on a stream shorter than
  the lines need.
- `decodePng` composes them around a caller-supplied inflate, so the sync and
  async paths share one decoder: Node passes `zlib.inflateSync`, the browser
  the stream. No CRC check, as `readChunks` today.

`png-encode.js` splits its two halves for the same reason: `pngScanlines(img)`
is the filter-0 raw stream and `pngFromZlib(width, height, zlib)` assembles the
file. `encodePng` stays what it is, their composition over `zlibStored`.

### 3.2 The engine: `browser.js`, and Node over zlib

A fourth entry, `sprite-machine/browser` (decision 1):

```js
import { readSheet, decodePng, encodePng } from 'sprite-machine/browser';
```

- `inflate(bytes)` and `deflate(bytes)` run one `DecompressionStream` or
  `CompressionStream` in `'deflate'` format, which is zlib framing, through a
  writer and a reader. Streams only, no Blob or Response, so the module
  typechecks under the engine's Node globals.
- `decodePng(bytes)` is the root's over `inflate`. `encodePng(img)` is
  `pngFromZlib` over `deflate(pngScanlines(img))`, so a saved file compresses
  as a canvas encode did (decision 3). Both are async, the entry's one
  difference from the root, as `readFile` is to `readFileSync`.
- `readSheet(bytes)` returns the Node entry's shape: `image`, `name`,
  `transforms`, `layers`, `chunks`. As built, both entries read the chunks
  through one internal `sheet.js`.

`node.js` keeps `readSheet` synchronous over `zlib.inflateSync` and drops
pngjs from the dependencies (decision 2). pngjs becomes a devDependency, the
independent decoder the tests cross-check against. The CLI and the Node tests
import only `readSheet`, so nothing else moves.

The engine bump is a patch: new exports, a new entry, a dependency dropped,
every contract held.

### 3.3 The app's seams

`src/image-io.js`:

- `bytesToImageData(bytes)`: a PNG (`isPng`) decodes through the browser
  entry into an `ImageData` over the decoder's buffer, no copy. Any other
  bytes take the canvas path as today, so a dropped JPEG still opens
  (decision 4). `urlToImageData` fetches the bytes and goes the same way, so
  the samples decode exactly.
- `imageDataToPngBytes(img)` is the browser entry's `encodePng`.
  `imageDataToBlob` and `fileToImageData` go. `canvasToPngBytes` stays for the
  atlas export (§8).

`main.js`'s `files.init` deps, `loaders.js`, and the Finder's `pasteImage` call
the same names and need no change. Chrome's `toBlob` wrote no ancillary chunks
the app read, and `setTextChunks` splices the document chunks after IHDR
either way, so a file saved by the new encoder differs from an old one in
bytes and not in content. A previously saved file reopens exactly.

The wedge gate's comment in `wedge-mesh.js` changes its reason: the tolerance
absorbs antialiased foreign art, not the app's own reads.

### 3.4 The document's colors

`documentColors(image)` in `src/lib/palette.js`, pure: every texel with alpha
not 0, keyed by RGB, distinct, in one fixed order. The order is a function of
the set alone, never of where the colors sit, so a swatch does not move when
the first texel of its color is erased (decision 7): grays first by lightness,
then by hue, then by lightness within a hue, the Colors dialog's own reading
order. The scan is the whole sheet, every layer and face, since the model is
their union. A `3t × 2tN` sheet at the caps is 196,608 texels, under a
millisecond, and it runs once per live edit, which the doc coalesces to one
per frame. The list is capped at `PALETTE_VIEW_MAX` (decision 11).

### 3.5 The Color Palette windoid

`<sm-palette-view>` is the body, following the active document like
`sm-atlas-view`: `followActive` wires the doc's structural and live channels,
each notification rescans, and the component re-renders only when the ordered
list or the window's size changed, so a stroke in a color already present
builds no DOM. The scan runs only while `prefs.showPalette` is on, and turning
it on rescans.

- **The grid** is the Colors dialog's recipe, a `vf-grid frameless collapse`
  of `vf-swatch` cells, square at `PALETTE_CELL` (19) (decision 6).
  `paletteGrid(win.width, win.height, count)` gives the whole columns across
  the body, at least one, and the rows: enough for the swatches, and at least
  the whole rows the body holds, reserved through the grid's `rows` so the
  cells the swatches leave show empty (decision 15). A `ResizeObserver` on the
  enclosing window re-reads the size, since Arrange and the re-pin write it
  without a `vf-resize`. The size is the window's rather than the host's,
  because the kit's scroll plane is `fit-content` and would hold the host at
  the old grid's width. An outline on the grid's part draws the closing lines
  a frameless grid leaves out. The host is the scrolled plane, with no wrapper:
  `contain: inline-size`, positioned, clipped, and `paletteGrid`'s height,
  holding the grid's closing line while that fits the body and stopping one
  pixel short of it otherwise, so the lines that reach the frame, the rail's
  divider and the status strip's rule fall on them and add no scroll range.
  The grid is placed at `top="0" left="0"`. Rows past the body scroll on the vertical
  rail. Each swatch carries the hex and the palette name, when one matches,
  as its `title`.
- **The current ink**, when it is in the list, is ringed like Desktop
  Patterns' selected cell: 1px black outside, 1px white inside. A color picked
  but not yet painted marks nothing. As built, the ring is the swatch's own
  parts restyled: `::part(button)` black under the inset, and a 1px white
  outline inset on `::part(fill)`.
- **A press** sets the ink through `session.pickColor`, which already turns
  the eraser into the pencil. Cells pick on pointerdown, the Tools palette's
  rule, and the click that follows is a no-op (decision 8).
- No header. The status strip is a `vf-label` reading "Color Palette", and the
  grow box sits in the strip, so the rail runs down to the strip's rule. The
  body is the window's white paper. With no active document the windoid is
  hidden, as every windoid is.

`windows.html` authors it `variant="utility" movable resizable
scrollbars="vertical"`, before the Tools palette so Tools stays on top.
`windows.js` adds it to `WINDOIDS` and leaves its close box (the ring's rule).
The size rect floors both axes and caps neither (decision 12).

### 3.6 Placement and Arrange

`apps/sprite-editor/layout.js`:

```
PALETTE_MIN_WIDTH  = 2 borders + 6 inset + 59 label + 21 grow box   = 88
PALETTE_MIN_HEIGHT = two rows + 12 bar + 2 borders + 15 status      = 68
PALETTE_BOX        = five columns by three rows, with the chrome     = 116 × 88
palette.left       = WINDOW_ORIGIN.left                             (52)
palette.top        = desktopH - GAP - PALETTE_BOX.height
ring.left          = palette.left + PALETTE_BOX.width + EDGE while the Palette is shown
```

The Color Palette and the 3D Sprite Atlas strip share the bottom band under the
document window (decision 14). Both sit on the bottom margin, the Palette
left-aligned with the doc box and the strip beside it while the Palette is
shown. The strip's width is still its natural row, capped at the
room left of the rail. `bottomBand` is the taller shown windoid plus GAP, and
both the vacancy and `zoomedBox` take it off the bottom, so the doc box, its
cascade and the zoom box stay above whichever is shown. The doc box's left no
longer moves. Showing either windoid moves no open window: the ring's rule.

`FRAME_BANDS` gains a left band, `WINDOW_ORIGIN.left + PALETTE_BOX.width + EDGE

- GAP`(190), so the Palette's right edge and the strip's left edge beside it are
struts, and`windowFrame`and`setFrameBands`accept`left`. The Palette's
policy fixes both axes at the live size, so a browser resize moves it with the
bottom margin and never stretches it. `arranged()` skips its width and height,
  the user's, as it skips the ring's width. Arrange restores both.

### 3.7 Menu, prefs, close box

- `prefs.showPalette`, off at every load like `showRing` (decision 10).
- View gains _Color Palette_ after _3D Sprite Atlas_, checked while shown, no
  key equivalent (decision 9). `index.js` toggles and checks it beside the
  ring's.
- The close box clears the pref, as the ring's does. `syncUtility` shows the
  windoid while the Sprite Editor is front and the pref is on, and brings it
  to the front when it appears.

## 4. Steps, each landing green

1. **The decoder.** `png-decode.js`, the encoder split, the barrel. Tests: §6.
2. **The entries.** `browser.js`, `node.js` over zlib, the `exports` map,
   pngjs to devDependencies, the engine README (the Node section, a browser
   section, "depends on earcut alone" now true of the package). Release as a
   patch.
3. **The seams.** `image-io.js` over the browser entry, the wedge comment.
   Verified by eye: open the Car, paint, save, reopen, Download and drop the
   file back. On Helium: the eyedropper on a flat region gives the palette
   color and the Colors dialog names it, a non-contiguous fill recolors a
   whole region, and every wedge renders with `?flat` off.
4. **The colors rule.** `documentColors` and its order. Tests: §6.
5. **The windoid.** `layout.js`, `windows.html`, `windows.js`, `prefs.js`,
   `menus.html`, `index.js`, `sm-palette-view.js`, the shell's left band.
   Verified by eye: View → Color Palette; Arrange docks it at the bottom left
   with the strip beside it and the document window above both; a press sets
   the ink and rings the cell; a stroke in a new color adds a swatch; widening
   it adds columns and narrowing it removes them; empty cells fill the rest of
   the body, and no line doubles at the frame, the rail or the strip; more
   rows than fit scroll; it shortens to two rows;
   the status label shows whole at the narrowest width; ⌘J zoom stops above the
   band; a browser resize keeps it docked at its size; its close box unchecks
   the item.
6. **The words.** README (§Drawing editor, §Menu bar, §Windows, §Documents,
   §Architecture, the next steps), the Read Me text file, this plan's status
   line.

Steps 1 and 2 are the engine. Steps 3 to 6 are the app.

## 5. Kit asks

One, found 2026-09-13 and written up in `docs/scroll-area-offset-report.md`:

- **#17 The scroll area's border-floor padding.** `vf-scroll-area`'s viewport
  pads by `mod(var(--vf-scale) * 1px, 1px)`, the part of a fractional frame
  border that Chromium floored to a whole CSS px (THREE-X-DISPLAYS.md). Chrome
  152 at 2× paints that border at its full 3 device px, so the padding is extra
  and the content, flow or placed at (0,0), sits one device px (a third of a
  system px) right of and below the content region's corner. Seen in the
  Color Palette on the user's display, where the grid's lines miss the frame.
  Every scroll area carries it, the text window and the ring windoid included.
  No app bridge.

## 6. Tests

By `docs/TESTING.md`: unit tests on the new pure rules, nothing on the menu,
the look or the windoid.

Engine (`packages/core/test`):

- `png-decode`: `encodePng` then `decodePng` returns the source bytes; a
  pngjs-written file with each filter type and real compression decodes to
  what pngjs reads; fixtures from a test helper over `zlib.deflateSync` and
  `buildChunk` cover gray, gray-alpha, RGB, indexed with a palette alpha, the
  tRNS color key, bit depths 1, 2, 4 and 16, and Adam7; a truncated stream,
  a non-PNG and an undefined method each throw.
- `browser`: `readSheet` over the stream inflate equals the Node entry's
  result; `encodePng` then `decodePng` round-trips.
- `node`: the existing contract, unchanged, now over zlib.

App (`test/`):

- `palette`: `documentColors` excludes alpha 0, returns each color once, gives
  the same order for the same set laid out differently, and caps the list.
- `sprite-editor-layout`: the Color Palette and the strip share the bottom
  band, the Palette left-aligned with the doc box and the strip right of a
  shown Palette; the doc box and its zoom stay above each shown band and its
  left never moves. The placement fixed-point test re-pins the Palette at its
  size, and the strip beside a shown Palette.

## 7. Decisions

Decided 2026-09-13, with the ask "implement the plan": every recommendation.

1. **Where the decoder lives.** The engine's root entry, with a
   `sprite-machine/browser` adapter. Recommended: the engine already owns the
   format, its suite is dense, and the browser adapter is a listed next step.
   The alternative keeps a decoder in `src/` and leaves the engine as it is.
   Decided 2026-09-13: recommended.
2. **pngjs.** The Node entry decodes through the same decoder over
   `zlib.inflateSync`, and pngjs moves to devDependencies. Recommended: one
   decoder, one behavior in the CLI and the app, and a package that depends
   on earcut alone. The alternative keeps pngjs in Node and adds the decoder
   beside it. Decided 2026-09-13: recommended.
3. **The encoder's deflate.** The browser entry compresses through
   `CompressionStream`, so files stay the size a canvas encode gave.
   Recommended, since the save path is already async and stored blocks would
   make a 192×1024 sheet 786 KB in IndexedDB and in the Trash's readout. The
   alternative is the root's synchronous stored encoder. Decided 2026-09-13:
   recommended.
4. **Non-PNG images.** A dropped or pasted image that is not a PNG keeps the
   canvas path. Recommended: the README promises a PNG, and the leniency costs
   one branch. The alternative refuses anything but a PNG. Decided 2026-09-13:
   recommended.
5. **The wedge tolerance.** `sameMat` keeps its 12² tolerance. Recommended:
   the engine takes any sheet, including antialiased art from other tools, and
   the eight palette pairs within it are documented. The alternative returns
   the gate to exact equality now that the app's pixels are exact. Decided
   2026-09-13: recommended.
6. **The cell.** One column of 22×19 swatches, the Tools palette's cell, a
   39px windoid. Recommended: the two palettes read as one column and the
   doc box loses 15px. The alternative is three columns of the Colors
   dialog's 14px swatches, 55 wide and denser. Decided 2026-09-13:
   recommended. Revised 2026-09-13 on the second ask: square 19px cells, the
   Tools palette's row pitch, in as many columns as the width fits.
7. **The order.** Grays first by lightness, then hue, then lightness.
   Recommended, since a swatch then never moves under the pointer during a
   stroke. The alternative is first-seen in scan order, which moves swatches
   when a color's first texel is erased. Decided 2026-09-13: recommended, the
   hue in 30° bands centered on red.
8. **The pick.** On pointerdown, like the Tools palette's cells, with the
   click a no-op. Recommended, since the two palettes are stacked and should
   feel alike. The alternative is `vf-swatch`'s click. Decided 2026-09-13:
   recommended.
9. **The name.** _Palette_, for the View item and the heading. Recommended:
   the ask's word, and no clash with the Colors dialog. The alternatives are
   _Swatches_ and _Colors_. Decided 2026-09-13: recommended. Revised
   2026-09-13: _Color Palette_ for the View item and the heading, after the
   status label the second ask names.
10. **Persistence.** Off at every load, like the atlas strip. Recommended for
    now. The alternative stores the flag in the desktop state. Decided
    2026-09-13: recommended.
11. **The cap.** `PALETTE_VIEW_MAX` of 256 swatches. Recommended: a document
    past it is not this app's pixel art, and the cap bounds the DOM. The
    alternative is no cap. Decided 2026-09-13: recommended.
12. **Resizing.** Height only, with the grow box in the rail's corner.
    Recommended, the ring's recipe on the other axis. The alternative is a
    fixed size with no grow box. Decided 2026-09-13: recommended, with a floor
    of four cells. Revised 2026-09-13 on the second ask: both axes, with the
    status strip and the grow box in it, floored at the width that shows the
    label whole and at four rows. Revised again 2026-09-13: the height floor
    is two rows.
13. **The ink marker.** Desktop Patterns' ring on the swatch matching the ink.
    Recommended. The alternative marks nothing. Decided 2026-09-13:
    recommended.
14. **The place.** Asked for 2026-09-13: the bottom left, sharing the bottom
    band with the 3D Sprite Atlas strip under the document window, which
    replaces the column under the Tools palette. As built, the Palette is
    left-aligned with the doc box, and the strip moves right of a shown
    Palette. Its placed size, asked for 2026-09-13: exactly five columns by
    three rows.
15. **Empty cells.** Asked for 2026-09-13: _"we should always render empty
    grid cells to fill the windoid area ( so they fit within the windoid )"_.
    As built, whole rows only, so the lattice never scrolls on its own, with
    the closing lines drawn around the grid.

## 8. Follow-ups

- The sprite atlas export still encodes through `toBlob`. Reading the render
  through `readPixels` into the engine's encoder would make it exact, once a
  probe shows whether Helium noises `readPixels`. A render's ±1 is invisible.
- The icon renderer reads its GL render through `getImageData`. Same probe,
  same remedy, same low stakes.
- A Helium profile seeded before this change holds a noised Car. Trashing it
  and running Special → Restore Default Files re-seeds it exactly.
- Reorder swatches by drag, and a swatch count readout, if the grid proves
  wanting.
- The engine README's browser section could show `readSheet` feeding
  `buildModel` end to end in a page, the headless build's browser twin.

## 9. Files touched

| File                                                          | What                                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `packages/core/src/png-decode.js`                             | new: `parsePng`, `unfilterPng`, `decodePng`                                 |
| `packages/core/src/png-encode.js`                             | `pngScanlines`, `pngFromZlib`; `encodePng` composed of them                 |
| `packages/core/src/browser.js`                                | new entry: the streams, `decodePng`, `encodePng`, `readSheet`               |
| `packages/core/src/node.js`                                   | `readSheet` over zlib                                                       |
| `packages/core/src/sheet.js`                                  | new: the document chunks both entries read                                  |
| `packages/core/src/index.js`                                  | the new exports                                                             |
| `packages/core/src/wedge-mesh.js`                             | the tolerance's comment                                                     |
| `packages/core/package.json`                                  | the `./browser` export, pngjs to devDependencies, the version               |
| `packages/core/README.md`                                     | the Node and browser sections                                               |
| `packages/core/test/*`                                        | the fixture helper, `png-decode`, `browser`, `png-encode` follow-through    |
| `src/image-io.js`                                             | decode and encode through the browser entry                                 |
| `src/lib/palette.js`                                          | `documentColors`, the order, `PALETTE_VIEW_MAX`, the name lookup            |
| `src/components/sm-palette-view.js`                           | new: the windoid body                                                       |
| `src/components/sm-color-picker.js`                           | the name lookup moves to `lib/palette.js`                                   |
| `src/apps/sprite-editor/layout.js`                            | the palette box, `paletteGrid`, the bottom band, the left frame band        |
| `src/apps/sprite-editor/windows.html`                         | the windoid and its status label                                            |
| `src/apps/sprite-editor/windows.js`                           | `WINDOIDS`, the size rect, placement, zoom, `arranged`, the close box       |
| `src/apps/sprite-editor/menus.html`                           | View → Color Palette                                                        |
| `src/shell/layout.js`, `src/shell/windows.js`                 | a widenable left band                                                       |
| `src/apps/sprite-editor/index.js`                             | the toggle and its checkmark                                                |
| `src/state/prefs.js`                                          | `showPalette`                                                               |
| `src/main.js`                                                 | the component import                                                        |
| `src/texts/read-me.txt`                                       | the windoid in the tour                                                     |
| `README.md`                                                   | §Drawing editor, §Menu bar, §Windows, §Documents, §Architecture, next steps |
| `test/palette.test.mjs`, `test/sprite-editor-layout.test.mjs` | the tests in §6                                                             |
