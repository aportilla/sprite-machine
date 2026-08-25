# Manual smoke test — the desktop shell

The automated surfaces cover most of the app (`npm test` for every pure
contract, `tools/drive.mjs` for 188 trusted-input checks, `tools/capture.sh`
for byte-stable screenshots). This guide covers the residue: gestures and
flows that headless Chrome runs unreliably (chorded drags wedge its
renderer) or that need a human eye. Run against `npm run dev`, normal
browser, `http://localhost:5173/`.

## Focus: the two roles

- [ ] **Desktop click deactivates**: click the bare desktop dither — the
      document window's title stripes vanish, all three windoids (Tools,
      Sprite View, 3D View) disappear, the options strip hides (the dither
      runs right up to the menu bar), and B/R/G/E/I do nothing.
- [ ] **The Finder menu grammar**: while deactivated, pull each menu — only
      About…/Quit, File → New… and File → Open… stay enabled (Settings… is
      parked disabled in both roles — its contents moved to the 3D View).
      With nothing selected, Open… raises the saved-docs listing dialog.
      Select a desktop icon: the item relabels to a bare **Open** (no
      ellipsis), the icon stays highlighted while you pull the File menu (a
      press on the menu bar doesn't clear the Finder selection), and
      picking Open — or ⌘O — opens that icon directly and the app comes
      back. Click the bare desktop: the selection clears and the item reads
      Open… again.
- [ ] **Reactivation restores the arrangement**: drag the Tools palette
      somewhere odd, click the desktop (all three windoids hide), then click
      the document window — all three come back, Tools where you put it.
- [ ] **Windoids are non-closeable**: none of the three windoid bars shows a
      close box, and no menu item hides them — they're up whenever a
      document window is active.
- [ ] **Icon click is a Finder click**: a single click on any icon
      deactivates the app and selects the icon; a double-click opens it and
      the app comes back, windoids included.
- [ ] **Windoids never steal focus**: click into the 3D View or the Tools
      palette — the active document window keeps its stripes.

## Multiple documents

- [ ] **New windows stagger**: File → New… → Create (Empty Document) a few
      times — each untitled (untitled, untitled 2, …) opens offset
      down-right, active, its 3D view empty.
- [ ] **New Document templates**: in File → New…, selecting Car or Cube
      locks the tile-size field at the template's native size; Create (or a
      double-click on the row) opens a fresh untitled copy — editing it
      never touches the stored Car/Cube documents.
- [ ] **The windoids follow the active window**: with the Car and an
      untitled open, click between them — the 3D View, Sprite View, window
      title, tile-size readout, and Undo enablement all track the front
      window; the camera re-frames on each switch.
- [ ] **Per-document undo**: draw in each of two documents; ⌘Z in one never
      touches the other's pixels.
- [ ] **One window per saved doc**: double-click a saved doc's icon twice —
      the second click activates the existing window, never a duplicate;
      its icon wears the open ghost while any window holds it.
- [ ] **Duplicate opens its own window**: File → Duplicate on a saved doc —
      "«name» copy" appears as an icon AND opens in a new window; the
      original window is untouched.
- [ ] **The quit cascade**: with one clean and two dirty documents open,
      Sprite Machine → Quit — each dirty document's window comes forward
      with its own Yes / No / Cancel; Cancel mid-walk keeps the
      remaining windows; a completed quit leaves the bare desktop and the
      next open restores the windoid arrangement.
- [ ] **Close to zero**: File → Close on the last document — desktop focus,
      windoids gone, menus in the Finder grammar.

## Drawing gestures (document window)

- [ ] **Rect + Shift**: with the rect tool (R), drag a wide box, then press
      Shift mid-drag — the preview snaps to a square anchored at the start
      corner; release Shift and it un-snaps; commit while held → a square
      lands.
- [ ] **Right-drag erase**: right-drag a rect over painted art — the preview
      tints red, release erases the box. Right-click with the pencil erases
      under the tip; right-click with fill deletes the clicked region.
- [ ] **Hover previews**: pencil hover shows the exact N×N footprint filled
      with the live ink under the kit's crosshair; eraser shows the red
      treatment; eyedropper shows the 1-cell outline.
- [ ] **Texel grid (always on)**: the lattice shows at texel sizes ≥ 4
      system px; shrink the document window until the texel size drops
      below 4 — the lattice disappears rather than swamping the art.
- [ ] **One cursor, everywhere**: over the pixel canvas only the kit's drawn
      crosshair shows (no native crosshair beneath it), and the tool cells
      show only the kit's arrow (no native hand). Open the Colors dialog
      (⌘K or the ink swatch) — the drawn arrow stays visible over the
      dialog and its swatches, not swallowed by the modal.

## File flows

- [ ] **Save prompt Cancel**: File → Save on an untitled doc, then Cancel —
      nothing saved, still untitled.
- [ ] **Unsaved-changes alert, all three ways**: draw a stroke, File →
      Close (the plain-frame "Save changes to … before closing?" box — Yes
      over No at the left, Cancel bottom right): _Cancel_ keeps everything;
      _No_ closes the window; _Yes_ prompts (untitled) then closes.
- [ ] **Rename…** (menu) and **in-place icon rename** (select icon, press
      Return) land the same name everywhere: icon label, window title, Open
      dialog — including a window that's open while its icon is renamed.
- [ ] **Download round-trip**: File → Download downloads `«name».png`; drop
      the file back onto the desktop — a NEW window opens with pixels AND
      title restored (the metadata lives in the PNG's text chunks).
- [ ] **Parked export dialogs**: File → Export 3D Model… and File → Export
      Sprite Atlas… each raise their configurator with every form field
      disabled and Export inert; Cancel (or the close box) dismisses.
- [ ] **beforeunload guard**: with unsaved changes in ANY open document,
      reload the tab — the browser warns.

## Desktop state (localStorage)

- [ ] Open two saved documents, drag an icon, then reload — the icon
      position comes back and the ACTIVE document reopens
      (the address bar mirrored it as `#<name>`); the other deliberately
      does not (one URL, one document — the URL says what a load shows).
- [ ] **Windows never remember**: drag all three windoids and the document
      window somewhere odd, grow-box the 3D View, then reload — every
      window is back at the authored arrangement for THIS viewport (Tools
      top-left, the document top-aligned beside it, the Sprite View over
      the 3D View as one right-hand column of equal width). Now resize the
      browser window (or move it to another monitor) and reload — the
      arrangement re-derives for the new viewport; nothing hangs off-screen.
- [ ] **A resize is an Arrange for the windoids, a proportional re-fit for
      documents** (the nine-slice pin): boot to the New Document dialog,
      squish the browser window, then Create — the windoids and the
      document land exactly where Arrange Windows puts them on that
      viewport (not a scaled-down copy of the old layout). With a document
      open, resize the browser — the rail stays right-flush and
      full-height, the document keeps its top-left and breathes with the
      middle. Drag the Tools palette into the middle of the screen and
      resize — it keeps its place proportionally (its center); drag it
      against the right edge and resize — it stays flush against the
      edge; drag the Sprite View into the bottom-right corner and resize
      — it never moves relative to that corner. Grow the browser back
      after any of these — every window is exactly where it was.
- [ ] **View → Arrange Windows**: with three documents open, drag every
      window somewhere odd and grow-box the 3D View and a document; pick
      Arrange Windows — the windoids snap back to the rail at their placed
      sizes and the documents stack as a fresh cascade, bottom-most window
      on the first slot, the active one on top; nothing changes focus.
      Shrink the browser window, pick it again — the arrangement re-derives
      for the smaller raster. From the Finder role (click the desktop) the
      item stays enabled while documents are open and re-rails the hidden
      windoids for the next open; close every document — it greys (nothing
      left to arrange).
- [ ] **New windows cascade into free slots**: File → New… four more
      times — every window the same size, each a step down-right, the
      fifth flush with the rail's inset and the bottom margin, none under
      the rail; a sixth wraps onto the first. Close the FIRST window — the
      next File → New… lands back on the vacated first slot, not further
      down the cascade.
- [ ] **The address bar follows the active document**: open/switch between
      saved documents — the fragment tracks the active one; an untitled
      window or the bare desktop clears it. With it cleared, a reload
      greets with the New Document dialog (untitleds never survive).
- [ ] **`?file=<name>` / `#<name>`**: load with `?file=cube` (or `#Cube`)
      in the URL — the stored Cube opens directly, no dialog, on the edited
      face it last had (its window at the default box), and the bar
      canonicalizes to `#Cube`. An unknown name falls back to the New
      Document dialog.
- [ ] `?fresh=1` boots a bare desktop regardless (no icons),
      and doesn't clobber the saved state.
- [ ] **First-boot seeding, once only**: clear the site's data (localStorage
      and IndexedDB) and reload — Car and Cube appear as ordinary saved-doc
      icons under the New Document dialog. Rename or delete-and-redraw one,
      then reload — the change sticks; the defaults are never re-created
      while any state persists.

## Odds and ends

- [ ] **The menu bar clock**: the time sits at the bar's right end in
      Chicago, its baseline on the menu titles' row, ~9px of bar between
      its last glyph and the raster's edge (the corner mask clear of it);
      watch it tick over a minute boundary. Press it (mouse DOWN — it flips
      before the button comes up): the date reads `M/D/YY` (`8/24/26`, no
      leading zeros) for ~3 s, then
      the time returns; press again while the date shows — the time returns
      at once. Neither press moves focus, deactivates the app, or clears a
      selected desktop icon. With a menu dropped, a press on the clock
      leaves the menu open (the bar closes only on presses outside itself —
      an open kit ask).
- [ ] **3D View controls strip**: the rotate / smooth checkboxes across the
      window's top toggle live — the model stops spinning / re-meshes
      immediately (Settings… in the menu stays disabled, a parked
      placeholder).
- [ ] **The 3D View can't degenerate**: grow-box-shrink it as far as it
      goes — the drag stops at the strip's width (both checkboxes stay
      whole) and at a height that keeps a real patch of canvas under the
      strip.
- [ ] **Menu key equivalents off-Mac**: Ctrl stands in for ⌘.
- [ ] **Private window**: open in an Incognito/private window where
      IndexedDB misbehaves — Save raises the "Storage Unavailable" notice
      and everything else still works.
- [ ] **Undo depth**: ~50 gestures; an all-faces replace and a tile resize
      both undo as single steps.
