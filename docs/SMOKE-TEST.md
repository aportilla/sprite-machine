# Manual smoke test

The automated gates cover most of the app: `npm test` for the pure
contracts, `tools/drive.mjs` for the user journeys on trusted input,
`tools/goldens.sh` for the look. This is the residue — gestures headless
Chrome runs unreliably (chorded and right-button drags wedge its renderer),
feel, the cursor, browser zoom, and the one input no script can give it (a
dropped file). Run against `npm run dev` in a normal browser,
`http://localhost:5173/`. Twenty-two items; a run is about ten minutes.

## Gestures the drive cannot make

- [ ] **Rect + Shift**: R, drag a wide box, press Shift mid-drag — the
      preview snaps to a square anchored at the start corner; release Shift
      — it un-snaps; commit while held — a square lands. The strip's
      readout re-fits with the preview.
- [ ] **Shift constrains a move**: S, marquee a region, drag the float
      diagonally, press Shift — it snaps to the dominant axis; release — it
      follows freely again.
- [ ] **Right-button erases**: right-drag a rect over painted art — the
      preview is the marching ants around the box, no fill inside it, no
      halo around it; release erases the box (at a nonzero radius the ring
      stays the box while the release spares the corners). Right-click with
      the pencil erases under the tip, the footprint wearing the ants while
      the button is down and the ink fill back the moment it comes up;
      right-click with fill deletes the clicked region.
- [ ] **A dropped PNG**: File → Download the Car, then drop the file onto
      the desktop — a NEW window opens with pixels AND title restored (the
      metadata lives in the PNG's text chunks); drop any foreign 3×2 sheet —
      it opens as an anonymous document.
- [ ] **Esc mid-gesture**: Esc mid-marquee cancels it; Esc mid-move puts
      the float back where it was grabbed.

## Feel

- [ ] **The palette acts on mouse DOWN**: press a tool cell and hold — the
      cell inverts and the Tools menu's checkmark moves before the button
      comes up (MacPaint's feel); releasing changes nothing more. The Sprite
      View's face tiles share it. Every other windoid control (the face
      picker's radios, the rotate checkbox) acts on the release.
- [ ] **The cursor flips**: over the canvas only the kit's drawn crosshair
      (no native one beneath it); the arrow inside a selection and
      throughout a move, the crosshair back on drop; the arrow over the
      tool cells (no native hand); the drawn arrow stays visible over the
      Colors dialog and its swatches, not swallowed by the modal.
- [ ] **Marching ants**: S, drag a box — the dashes march briskly and
      continuously with one seam at the start corner; they stay up while
      you hover, move with the float, clip at the canvas edge when the
      float is pushed off, and re-fit when the document window shrinks.
      With the OS "reduce motion" on they stand still.
- [ ] **Hover previews**: the pencil shows its footprint filled with the
      live ink (the disc, or the box with `square` picked) under the
      crosshair; the eraser the ants around its footprint's OWN outline (a
      5 px circle rings the disc — one px thin, its steps joined
      diagonally, one seam at the top row's left end), following the size
      slider live and clipping at the edge; the eyedropper the same ring
      around the one texel it would sample. Nothing translucent anywhere
      on the canvas but the art.
- [ ] **The menu bar clock**: the time in Chicago at the bar's right end,
      ticking over a minute boundary; press it (mouse DOWN) — the date
      (`8/24/26`, no leading zeros) for about three seconds, then the
      time; a second press returns it early. Neither press moves focus,
      deactivates the app, or clears a selected desktop icon.
- [ ] **The About box's link**: hover "Vintage Frames" — the arrow stays
      the arrow; click it — the kit's npm page opens in a NEW tab, the app
      untouched behind it; Tab from OK reaches it with a dotted ring.
- [ ] **The 3D View**: check **rotate** — the model spins at once; uncheck
      — it stops where it is; orbit it by hand. The Car's windshield and
      wheel arches ramp (the wedge pass is always on, nothing to switch).
      The header's rotate row sits on whole pixels under the dot bar.
- [ ] **The skin**: `?sample=car`, orbit it — every color sits where it
      did, the edges hard: no bilinear smear at a chart's edge, no seam of
      the neighbouring color along a rectangle boundary (the gutter's
      job), the wedges the body's color, the shadow unchanged. View → 3D
      Sprite Atlas at the default four views: the frames as they were.
      Then a stroke in a fresh color: it lands on the model at once (the
      skin rebakes per rebuild) while the triangle count holds — a recolor
      is the skin's, not the geometry's; only a silhouette change moves it.

## Browser zoom and displays

- [ ] **Crisp at any scale**: zoom the browser to 200% and to 50%, and on a
      2× display — every texel a whole count of device px; the tool icons
      and the face cubes pixel-sharp; the ants pure black and white at
      every phase; the strip's dotted walls one px on and one off with no
      gray; every rule one system px; the canvas paper's dots whole and
      sharp; the 3D Sprite Atlas's tiles a whole count of device px, never
      a resample.
- [ ] **The paper is the canvas's own**: set a different desktop pattern —
      the canvas paper (the 12% dither) does not change, and neither do
      the Sprite View's cells or the 3D well.

## Documents and state

- [ ] **The quit cascade with three documents**: one clean and two dirty —
      Sprite Machine → Quit walks each dirty window forward with its own
      Yes / No / Cancel; Cancel mid-walk keeps the remaining windows; a
      completed quit leaves the bare desktop, and the next open restores
      the windoid arrangement.
- [ ] **Unsaved changes, all three ways**: draw a stroke, File → Close:
      Cancel keeps everything; No closes; Yes prompts (untitled) then
      closes. Save prompt Cancel on an untitled: nothing saved, still
      untitled.
- [ ] **Rename, both ways**: File → Rename… and an in-place icon rename
      (select the icon, Return) land the same name everywhere — the icon,
      the window title, the Open dialog — including a window that is open
      while its icon is renamed.
- [ ] **Per-window selections and the readout**: two documents with a
      selection each — switching windows leaves both up, ants marching in
      the inactive one; the strip's readout follows the active window; Esc
      drops only the active window's; picking another tool drops both.
- [ ] **beforeunload**: with unsaved changes in any open document, reload
      the tab — the browser warns.
- [ ] **A private window**: with IndexedDB unavailable, Save raises the
      storage notice and everything else still works.
- [ ] **A resized, reopened browser**: drag the windoids somewhere odd,
      resize the browser (or move it to another monitor) and reload —
      every window re-derives its place for the new viewport, nothing
      hangs off-screen; only the icons and the desktop pattern come back
      where they were.
