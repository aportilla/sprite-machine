# Manual smoke test — the desktop shell

The automated surfaces cover most of the app (`npm test` for every pure
contract, `tools/drive.mjs` for 116 trusted-input checks, `tools/capture.sh`
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
      About…/Settings…/Quit and File → New stay enabled; File → Open…
      enables the moment you select a desktop icon (and then opens that
      icon — note the kit currently drops the selection if you _click_ the
      menu bar, so use ⌘O; an open kit ask).
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

- [ ] **New windows stagger**: File → New a few times — each untitled
      (untitled, untitled 2, …) opens offset down-right, active, its 3D
      view empty.
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
      with its own Save / Don't Save / Cancel; Cancel mid-walk keeps the
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
- [ ] **Show Grid** (⌘G): texel lattice appears at canvas scales ≥ 4; shrink
      the document window until the scale drops below 4 — the lattice
      disappears rather than swamping the art.
- [ ] **One cursor, everywhere**: over the pixel canvas only the kit's drawn
      crosshair shows (no native crosshair beneath it), and the tool cells
      show only the kit's arrow (no native hand). Open the Colors dialog
      (⌘K or the ink swatch) — the drawn arrow stays visible over the
      dialog and its swatches, not swallowed by the modal.

## File flows

- [ ] **Save prompt Cancel**: File → Save on an untitled doc, then Cancel —
      nothing saved, still untitled.
- [ ] **Unsaved-changes alert, all three ways**: draw a stroke, File →
      Close: _Cancel_ keeps everything; _Don't Save_ closes the window;
      _Save_ prompts (untitled) then closes.
- [ ] **Rename…** (menu) and **in-place icon rename** (select icon, press
      Return) land the same name everywhere: icon label, window title, Open
      dialog — including a window that's open while its icon is renamed.
- [ ] **Export round-trip**: File → Export downloads `«name».png`; drop the
      file back onto the desktop — a NEW window opens with pixels AND title
      restored (the metadata lives in the PNG's text chunks).
- [ ] **beforeunload guard**: with unsaved changes in ANY open document,
      reload the tab — the browser warns.

## Desktop state (localStorage)

- [ ] Open two saved documents, drag their windows and an icon, resize the
      3D View, toggle Show Grid, then reload — both
      documents reopen in their windows (the one that was active is active
      again, each on its edited face), and the layout comes back. An
      untitled document deliberately does NOT survive the reload.
- [ ] `?fresh=1` boots the authored default layout regardless, and doesn't
      clobber the saved one.

## Odds and ends

- [ ] **Settings…**: smooth slopes / auto rotate toggle live; the 3D view
      reacts immediately.
- [ ] **Menu key equivalents off-Mac**: Ctrl stands in for ⌘.
- [ ] **Private window**: open in an Incognito/private window where
      IndexedDB misbehaves — Save raises the "Storage Unavailable" notice
      and everything else still works.
- [ ] **Undo depth**: ~50 gestures; an all-tiles replace and a tile resize
      both undo as single steps.
