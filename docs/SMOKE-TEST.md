# Manual smoke test — the desktop shell

The automated surfaces cover most of the app (`npm test` for every pure
contract, `tools/drive.mjs` for 272 trusted-input checks, `tools/capture.sh`
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
- [ ] **Windoids are non-closeable**: none of the three permanent windoid
      bars (Tools, Sprite View, 3D View) shows a close box, and no menu
      item hides them — they're up whenever a document window is active.
      The 3D Sprite Atlas is the one exception (its own items below).
- [ ] **Icon click is a Finder click**: a single click on any icon
      deactivates the app and selects the icon; a double-click opens it and
      the app comes back, windoids included.
- [ ] **Desktop Patterns is the Finder's window**: Sprite Machine → Desktop
      Patterns (both roles) opens the control panel centered below the
      strip's band — a striped title bar with a close box, no grow box, no
      zoom box — and the application deactivates: the document window
      goes plain, the three windoids and the options strip hide, the
      document-scoped menus grey. Click the document window: it
      reactivates (windoids back) and the panel goes plain behind it;
      click the panel: the reverse. Its close box hands the application
      back (document active, windoids up). A second menu pick while it's
      open brings the same window forward — never a second panel.

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
- [ ] **Marching ants**: S, drag a box — a 1px black/white dashed border
      marches around it (briskly, continuously, one seam at the start
      corner); zoom the browser in — every px of it is pure black or pure
      white, no gray at a dash end or a corner, at any phase; it stays up
      while you hover, moves with the float, and clips at the canvas edge
      when the float is pushed off. Shrink the document window: the ants
      re-fit with the texel size.
- [ ] **The cursor flips**: the kit's crosshair outside the selection, the
      arrow inside it and throughout a move; the crosshair returns on drop
      (a frame late with the pointer still — the kit re-hit-tests on the
      next move).
- [ ] **The strip is a readout**: with S live the options strip shows no
      ink swatch and a dim `no selection`; drag a marquee — it reads
      `left, top · width × height` and the numbers track the corner as you
      drag; move the float — the position follows per texel, the size holds;
      push it off the left edge — the position goes negative; drop — back
      to `no selection`. Two documents with a selection each: the readout
      follows the ACTIVE window as you click between them.
- [ ] **Shift constrains a move**: drag the float diagonally, press Shift —
      it snaps to the dominant axis; release Shift — it follows freely
      again.
- [ ] **Transparency doesn't travel**: marquee a region with empty texels
      around a shape, drag it over other art — the other art shows through
      the empty texels; only the shape overwrites. Drop; ⌘Z puts everything
      back (and drops the selection).
- [ ] **Reduced motion**: with the OS "reduce motion" on, the ants stand
      still (phase 0); the tool otherwise behaves the same.
- [ ] **A click is no selection**: click (no drag) on the canvas — nothing
      appears (not even a one-texel flash during the press); click outside
      an existing selection — it drops; drag from outside — the old drops
      and a new marquee starts in the same gesture. Esc mid-marquee cancels
      it; Esc mid-move puts the float back where it was grabbed.
- [ ] **Esc respects a dialog**: with a selection up, ⌘K (or the swatch)
      then Esc — the Colors dialog closes, the ants stay; a second Esc on
      the canvas drops them. Drop a menu and press Esc — the menu closes
      (the selection drops too; accepted).
- [ ] **Per-window**: two documents open, a selection in each — switching
      windows leaves both up, ants marching in the inactive one; Esc drops
      only the active window's; picking another tool drops both.
- [ ] **Alt-click samples**: Alt-click a painted texel — the ink changes,
      the selection stays and the tool stays Selection; Alt-click empty
      space — the eraser is selected and the selection drops (the existing
      empty-sample rule).
- [ ] **1-bit canvas, by eye**: the canvas box sits on the kit's 50%
      dither, edge to edge (the stack container's own pattern, so it
      re-rasters crisp at any zoom and display density) — the transparency
      indicator: an empty texel reads as dither, a painted texel covers
      it, and a WHITE texel reads against the gray; no dot grid, no
      checkerboard, and no View item touches the paper. Nothing is drawn
      over the art but the extent rules, and those only with
      **View → Guides** checked — a fresh load boots them off with the
      item unchecked; the pick checks it and every open window's rules
      appear at once, a second pick clears them; the item greys with the
      desktop focused — solid black hairlines, one system px, each
      reading as a solid line through the gray: the left/top rules on the
      supported extent's near edge, the right/bottom ones one px inside
      its far edge; no lattice of grid lines, no cyan — the art is the
      only color on the canvas. On a derived face the onion-skin is a
      pale tint of the opposite face's art over the dither. And the paper
      is the CANVAS'S OWN dither, never the desktop's pattern showing
      through — a kit leak the stack's declared `pattern` bridges (kit
      ask #6): set a different desktop pattern and the canvas paper must
      not change.
- [ ] **One cursor, everywhere**: over the pixel canvas only the kit's drawn
      crosshair shows (no native crosshair beneath it), and the tool cells
      show only the kit's arrow (no native hand). Open the Colors dialog
      (⌘K or the ink swatch) — the drawn arrow stays visible over the
      dialog and its swatches, not swallowed by the modal.
- [ ] **The palette acts on mouse DOWN**: press a tool cell and hold — the
      cell inverts and the Tools menu's checkmark moves before the button
      comes up (MacPaint's palette feel); releasing changes nothing more.
      Click the Sprite View first, then press a cell — same, on the first
      press. The Sprite View's face tiles share the feel: press a tile and
      hold — the ring moves, the picker radio and the canvas switch before
      the button comes up. Every other windoid control (the face picker's
      radios, the 3D View's checkboxes) acts on the release, System 7's
      rule for buttons and checkboxes.

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
- [ ] **The parked export dialog**: File → Export 3D Model… raises its
      configurator with every form field disabled and Export inert; Cancel
      (or the close box) dismisses.
- [ ] **The export file**: with the Car open, File → Export Sprite Atlas…
      → Export saves `car-atlas.png` — `views·F × F` px (`276 × 69` at
      the defaults), transparent outside the sprite; open it — the strip's
      pixels exactly, the car centered in every frame at one size; a PNG
      chunk inspector shows its `sprite-machine:ring` text chunk naming the
      settings, the frame, the anchor and the yaw list beside `Title`
      (`Car atlas`) and `Software`. Export is live with the strip hidden
      too, and the Finder role greys it with the rest.
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
      documents** (the nine-slice pin): boot to the About box, squish the
      browser window, OK it, then File → New… → Create — the windoids and
      the document land exactly where Arrange Windows puts them on that
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
      greets with the About box (untitleds never survive).
- [ ] **`?file=<name>` / `#<name>`**: load with `?file=cube` (or `#Cube`)
      in the URL — the stored Cube opens directly, no dialog, on the edited
      face it last had (its window at the default box), and the bar
      canonicalizes to `#Cube`. An unknown name falls back to the About
      box.
- [ ] `?fresh=1` boots a bare desktop regardless (no icons),
      and doesn't clobber the saved state.
- [ ] **First-boot seeding, once only**: clear the site's data (localStorage
      and IndexedDB) and reload — Car and Cube appear as ordinary saved-doc
      icons under the About box. Rename or delete-and-redraw one,
      then reload — the change sticks; the defaults are never re-created
      while any state persists.

## Odds and ends

- [ ] **The About box, by eye**: a plain load (no `#name`) greets with it,
      centered — the bare double frame (no title bar, no close box), the
      32×32 icon crisp at 1:1 beside "Sprite Machine" (the display face)
      / "version N" (package.json's) beside the date (HEAD's commit date,
      `Aug 24, 2026` form) / "created by Adam Portilla" — those two lines
      and the two paragraphs in the body face — with "Vintage Frames"
      underlined in the same black (no blue), OK
      bottom right; behind it the desktop is in the Finder role (no
      windoids, no strip, icons where they were). Hover the link: the
      arrow stays the arrow; click it: the kit's npm page opens in a NEW
      tab and the app is untouched behind it; Tab from OK reaches it with
      a dotted ring. OK — or Escape — dismisses the box and NOTHING opens
      or activates; Sprite Machine → About… raises the same box in either
      role, over whatever is open. Click anywhere OUTSIDE the box — on a
      desktop icon, say — and it dismisses the same way: nothing opens or
      activates, the icon neither selects nor opens, and an icon selected
      BEFORE About… was picked is still selected after (the app opts this
      one dialog into the kit's light-dismiss; the question dialogs — Save
      changes?, the name prompt, New Document, Colors — keep ignoring an
      outside click).
- [ ] **Desktop Patterns, by eye**: in the panel, the well shows the
      current desktop pattern inside a 1px frame at 1:1 (the dither reads
      as the desktop's own); the 13×3 grid shows all 38 kit patterns at
      two repeats each, the last well empty, and the current one ringed
      (1px black outside, 1px white inside — visible on `black` and on
      `white` alike). Click a cell: the ring moves and the well previews,
      the desktop unchanged; Set Desktop Pattern
      repaints the desktop under every window and icon. Close without
      Set after picking another cell —
      the desktop keeps what was set, and the next open seeds from it.
      Drag the panel somewhere and resize the browser: it keeps its
      place (its center, in the middle); View → Arrange Windows
      re-centers it. Reload: the pattern persists (`?fresh=1` boots the
      dither regardless, and doesn't clobber it).
- [ ] **The menu bar clock**: the time sits at the bar's right end in
      Chicago, its baseline on the menu titles' row, ~9px of bar between
      its last glyph and the raster's edge (the corner mask clear of it);
      watch it tick over a minute boundary. Press it (mouse DOWN — it flips
      before the button comes up): the date reads `M/D/YY` (`8/24/26`, no
      leading zeros) for ~3 s, then
      the time returns; press again while the date shows — the time returns
      at once. Neither press moves focus, deactivates the app, or clears a
      selected desktop icon.
- [ ] **3D View controls strip**: the rotate / smooth checkboxes in the
      window's header (the white band under the dot bar) toggle live — the
      model stops spinning / re-meshes immediately (Settings… in the menu
      stays disabled, a parked placeholder). One click, always: click the
      Tools palette (or any other windoid) first, then a checkbox — it
      flips on that first click (the 3D View comes forward under it),
      never needs a second; Space on a focused box toggles it too.
- [ ] **Every windoid's controls are its header**: the Sprite View's six
      cube icons and radios, the 3D View's two checkboxes and the atlas's
      four fields each sit in the window's header band — white paper over
      one rule, directly under the dot bar — with the body (the face
      grid, the pattern well, the tile row) starting at the rule. Zoom
      the browser to 200%: each rule is one system px, the picker block is
      centered with a pixel of slack each side, and the checkboxes sit on
      whole pixels.
- [ ] **The 3D Sprite Atlas, by eye**: with the Car open, View → 3D Sprite
      Atlas — a windoid lands under the document window, left-aligned with
      it, on the bottom margin: a two-row strip (`views` / `elev` over
      `from` / `size`) over four 64-px tiles butted on ONE sheet of white
      paper that runs across the whole body — no rules between the tiles,
      and the paper continues past the last tile to the frame (at the
      default the row is two px narrower than the strip's floor, so two
      px of paper show there) — the
      Car from the front, its right, the back, its left, all at one size
      and centered, each tile shown 1:1 (zoom the browser: a tile is a
      whole count of device px, never a resample) — and, where a status
      strip would be, the kit's **horizontal scroll rail**: arrows on a
      bare channel (nothing to scroll), a corner cell at its right end
      with the **grow box** in it. The front view's shading reads like
      the 3D View's default framing (roof brightest), and **every angle
      is lit the same way** (the light rides with the camera — the flank
      facing you is always the lit one). The dot bar carries a close box;
      its click hides the windoid and unchecks the item; the item re-shows
      it where it was, on top of the other windoids.
- [ ] **The other papers, by URL**: no control sets the body's paper
      (white is the one paper for now), so load
      `?sample=car&ring=4,45,0,64,gray` — the whole body is the kit's dots
      dither in one sheet (no seam in the dots where one tile ends: the
      paper is the body's, not a pattern per cell; the dots run past the
      last tile and, at eight views, under the scrolled row) — and
      `…,black`: solid black under the tiles, the Car's transparent
      margins reading black. File → Export Sprite Atlas… saves transparent
      margins on any paper (open the file over a checkerboard).
- [ ] **The row scrolls, the header holds**: step `views` to 8 — the
      windoid does NOT widen; the row runs past its right edge and the
      rail comes alive (the dither trough, the thumb). Drag the thumb,
      press the arrows, wheel sideways: the tiles scroll while the
      controls strip — the window's header, its white paper and its rule
      — does not move at all. Grow the window wider than the row: the
      rail idles again, the paper running on to the right of the last
      tile (the paper is the body's, as wide as the window), the header
      spanning the window as ever. Step `views` past the window and
      scroll (on the gray paper, where the sheet is visible — the URL
      item above): the dots run under the whole row, never ending short
      of it.
- [ ] **The strip is a DITL**: zoom the browser to 200% — every caption
      (`views` / `elev` / `from` / `size`) stays crisp on whole pixels, each
      right-aligned against its field, its baseline on the field's digits'
      baseline; the four fields sit in two columns, the rule under the
      header is one system px, and on the gray paper (`?ring=4,45,0,70,gray`
      — 70 is not a multiple of the pattern's 8) the body's paper is
      1-bit, its dots in phase across every tile edge, running unbroken
      under the row.
      Nothing in the windoid is flexed: the strip is the window's header
      band (vintage-frames 0.6.1) with the controls placed in it at stated
      system px, the row and every cell are kit boxes at stated system px,
      and the paper fills the body's width (the kit's own fill, its raster
      measured by the kit).
- [ ] **Size moves the height, the grow box moves the width**: drag the
      windoid up off the bottom margin, then set `size` to 128 — the tiles
      double and the windoid grows DOWN from where it sits (its dot bar
      does not move a pixel, its width holds); 255 — the same, taller
      still (left on the margin it would grow past the raster's bottom —
      a size change never moves the bar; drag it up or Arrange); 2 — a
      row of dots, the bar still where it was. Drag the grow box
      down-right: the window widens and does NOT get taller (the height is
      the tile's); drag it far left — it stops at the strip's width, the
      fields never clipped.
- [ ] **Settings are live, both ways**: `elev` 0 — pure side views; 90 —
      plan views; `from` 45 — the ring rotates. Draw a stroke — every tile
      follows at frame rate. File → Export Sprite Atlas… reads the same
      numbers (the step and the sheet); change one there — the strip
      follows behind the modal; Cancel keeps it. The exported sheet is
      `views × size` by `size` px, its `sprite-machine:ring` chunk naming
      the size, the frame and the derived px-per-voxel scale.
- [ ] **The frame never breathes**: with the Cube open, step `from` 0 → 45
      → 90 — the cube's silhouette changes, the tiles don't; step `views`
      — same; draw on it — same.
- [ ] **Arrange makes room**: with the strip shown, View → Arrange Windows
      shortens the document window to clear it (a gap between — more at a
      bigger tile) and re-seeds the strip's width (the row, no wider than
      the space under the document); hide the strip and Arrange again —
      the document takes the height back. The zoom box stops above a
      shown strip and runs to the bottom margin with it hidden. Toggling
      the strip on never moves a window already open.
- [ ] **A resize keeps it docked**: shrink the browser — the strip stays
      on the bottom margin at the document's left, at its height, its
      width shrinking with the middle like the document's; grow it back —
      exactly home, width included. A desktop click hides it with the
      other windoids (the View item stays checked, greyed); clicking the
      document brings it back.
- [ ] **The 3D View can't degenerate**: grow-box-shrink it as far as it
      goes — the drag stops at the strip's width (both checkboxes stay
      whole) and at a height that keeps a real patch of canvas under the
      strip.
- [ ] **Private window**: open in an Incognito/private window where
      IndexedDB misbehaves — Save raises the "Storage Unavailable" notice
      and everything else still works.
- [ ] **Undo depth**: ~50 gestures; an all-faces replace and a tile resize
      both undo as single steps.
