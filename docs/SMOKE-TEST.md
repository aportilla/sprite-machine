# Manual smoke test — the desktop shell

The automated surfaces cover most of the app (`npm test` for every pure
contract, `tools/drive.mjs` for 83 trusted-input checks, `tools/capture.sh`
for byte-stable screenshots). This guide covers the residue: gestures and
flows that headless Chrome runs unreliably (chorded drags wedge its
renderer) or that need a human eye. Run against `npm run dev`, normal
browser, `http://localhost:5173/`.

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
- [ ] **Show Grid** (⌘G): texel lattice appears at canvas scales ≥ 4; shrink
      the document window until the scale drops below 4 — the lattice
      disappears rather than swamping the art.

## File flows

- [ ] **Save prompt Cancel**: File → Save on an untitled doc, then Cancel —
      nothing saved, still untitled.
- [ ] **Unsaved-changes alert, all three ways**: draw a stroke, File → New:
      _Cancel_ keeps everything; _Don't Save_ discards into a blank doc;
      _Save_ prompts (untitled) then proceeds.
- [ ] **Duplicate**: on a saved doc — a second icon "«name» copy" appears and
      becomes the open doc.
- [ ] **Rename…** (menu) and **in-place icon rename** (select icon, press
      Return) land the same name everywhere: icon label, window title, Open
      dialog. An empty rename is refused.
- [ ] **Export round-trip**: File → Export downloads `«name».png`; drop the
      file back onto the desktop — pixels AND title come back (the metadata
      lives in the PNG's text chunks).
- [ ] **Quit**: dirty check runs, then every window closes to the bare
      desktop; reopen via icons / View menu.
- [ ] **beforeunload guard**: with unsaved changes, reload the tab — the
      browser warns.

## Desktop state (localStorage)

- [ ] Drag a window and an icon, resize the 3D View, hide the Sprite View,
      toggle Show Grid, then reload — everything comes back where you left
      it, and the last open (saved) document reopens.
- [ ] `?fresh=1` boots the authored default layout regardless, and doesn't
      clobber the saved one.

## Odds and ends

- [ ] **Settings…**: smooth slopes / auto rotate toggle live; the 3D view
      reacts immediately.
- [ ] **Tools palette never steals focus**: click a tool — the document
      window stays the active (striped) window.
- [ ] **Menu key equivalents off-Mac**: Ctrl stands in for ⌘.
- [ ] **Private window**: open in an Incognito/private window where
      IndexedDB misbehaves — Save raises the "Storage Unavailable" notice
      and everything else still works.
- [ ] **Undo depth**: ~50 gestures; an all-tiles replace and a tile resize
      both undo as single steps.
