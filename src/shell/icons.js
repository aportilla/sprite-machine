// ---------------------------------------------------------------------------
// The desktop icon layer: one renameable icon per SAVED document, reconciled
// from the files slice — and nothing else (the built-in defaults are seeded
// into the library at the first-ever boot, so they're ordinary rows here,
// not a special cluster). Icon art is generated from the document itself —
// the FRONT tile drawn into 32×32 (image-io.js) — so every icon declares the
// kit's `color` treatment (selection darkens instead of inverting).
// Double-click opens (dirty-checked through the shell actions); the open
// document's icon wears the kit's `open` ghost.
//
// Positions are `left`/`top` properties in system px — never CSS — so a drag
// writes back through the same declaration and desktop-state.js can persist
// them. PLACEMENT is the windows' regime in the ICONS' frame — the whole
// desktop below the menu bar (icons are the Finder's furniture; the options
// strip is application chrome, hidden whenever the desktop takes focus, so
// it reserves nothing above an icon): the default column derives from the
// live raster (shell/layout.js iconDefault — it wraps on a short raster), a
// saved position (a previous session's drag) wins, clamped on-raster at
// boot, and a browser resize re-pins every icon relatively
// (onDesktopResized below).
// ---------------------------------------------------------------------------

import { snapSys, systemPxQuantum } from 'vintage-frames';
import { genericDocIconDataUri } from '../image-io.js';
import { files } from '../state/files.js';
import { shell } from '../state/shell.js';
import { workspace } from '../state/workspace.js';
import { iconDefault, pinOf, pinTo, ICON_CELL, MENU_BAR } from './layout.js';

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 * @param {{ actions: {openDoc(id: string): void},
 *           savedPos?: (key: string) => {left:number, top:number}|null,
 *           fresh?: boolean }} opts
 */
export function initIcons(desktop, { actions, savedPos = () => null, fresh = false }) {
  const root = desktop.querySelector('#desktop-icons');
  /** @type {(() => void)[]} */
  const teardown = [];

  // --- the Finder wire ---------------------------------------------------------
  // A press on an icon is a press on the desktop. The page owns every "this
  // press means the Finder" decision (the kit never takes it): windows.js
  // covers the bare dither, and this covers the icon layer — both routing
  // through the same clearActive(). A double-click's open then reactivates
  // through the normal activateContext path.
  const onIconPress = () => desktop.clearActive();
  root.addEventListener('pointerdown', onIconPress);
  teardown.push(() => root.removeEventListener('pointerdown', onIconPress));

  // Selection feeds the shell slice (File → Open's Finder grammar reads it).
  // Read the PROPERTY, not the attribute — vf-select fires before Lit's
  // reflection lands. vf-select bubbles, and every selection change fires it
  // on each icon whose state moved, so re-reading the whole layer per event
  // stays exact under shift-clicks and outside-click clears alike.
  const readSelection = () =>
    shell.setIconSelection(
      [...root.querySelectorAll('vf-icon[data-key]')]
        .filter((icon) => /** @type {any} */ (icon).selected)
        .map((icon) => /** @type {HTMLElement} */ (icon).dataset.key)
    );
  root.addEventListener('vf-select', readSelection);
  teardown.push(() => root.removeEventListener('vf-select', readSelection));

  // A press on the APPLICATION'S CHROME keeps the Finder selection. The
  // kit's vf-icon clears itself on ANY outside pointerdown — the menu bar
  // included — so a pointer-driven File → Open would lose its selection on
  // the way to the menu and grey out as the panel dropped (kit ask #5,
  // APP-IA-PLAN.md §3.1; ⌘O was the only working path). System 7's Finder
  // kept the selection while a menu was pulled: the menu bar, a dropped
  // menu and a modal dialog are the application's surfaces, not the
  // desktop's, so a press on them says nothing about what's selected. The
  // page bridges it with two capture listeners AROUND the kit's own: one on
  // the document — registered here at wire-up, so it precedes every icon's
  // outside listener (those attach on selection, and same-target listeners
  // fire in registration order) — snapshots the icons the press is about to
  // clear; one on the desktop (later in the same dispatch — the icons' have
  // run by then, the chrome is slotted in the desktop) re-selects them, so
  // the selection and the Open gate are back before the menu bar's own
  // handler even drops the panel. Setting `selected` is the kit's documented
  // programmatic route; it re-arms the icon's outside listener. Remove this
  // bridge once the kit exempts its own chrome.
  const CHROME = 'vf-menu-bar, vf-menu, vf-dialog';
  /** @type {any[]} the icons a chrome press is clearing mid-dispatch */
  let held = [];
  const onChromePress = (e) => {
    held = e.composedPath().some((n) => n instanceof Element && n.matches(CHROME))
      ? [...root.querySelectorAll('vf-icon[data-key]')].filter(
          (icon) => /** @type {any} */ (icon).selected
        )
      : [];
  };
  const restoreSelection = () => {
    if (!held.length) return;
    for (const icon of held) icon.selected = true;
    held = [];
    readSelection();
  };
  document.addEventListener('pointerdown', onChromePress, true);
  desktop.addEventListener('pointerdown', restoreSelection, true);
  teardown.push(
    () => document.removeEventListener('pointerdown', onChromePress, true),
    () => desktop.removeEventListener('pointerdown', restoreSelection, true)
  );

  function makeIcon(key, label, slot, { editable = false } = {}) {
    const icon = /** @type {any} */ (document.createElement('vf-icon'));
    icon.dataset.key = key;
    icon.label = label;
    icon.width = 64;
    icon.selectable = true;
    icon.movable = true;
    icon.editable = editable;
    icon.color = true; // generated color art: selection darkens, not inverts
    root.append(icon); // appended first: the snap below reads the live scale
    const pos = savedPos(key) ?? iconDefault(slot, desktop.height);
    // The boot clamp, the windows' discipline (windows.js clampWindow): a
    // position saved on a larger raster pulls back on-screen — an off-raster
    // icon has nothing to grab, so it would be unreachable at any drag — and
    // lands on the same k-system-px lattice a drag lands on. The frame is
    // the ICON's: the whole desktop below the menu bar.
    const k = systemPxQuantum(icon);
    const down = (v) => Math.floor(v / k) * k;
    const minTop = Math.ceil(MENU_BAR / k) * k;
    icon.left = clamp(
      snapSys(pos.left, icon),
      0,
      Math.max(0, down(desktop.width - ICON_CELL))
    );
    icon.top = clamp(
      snapSys(pos.top, icon),
      minTop,
      Math.max(minTop, down(desktop.height - ICON_CELL))
    );
    return icon;
  }

  // Swap (or install) an icon's 32×32 art. The vf-img wrapper is created
  // once; later syncs only touch the img src when it actually changed.
  function setIconArt(icon, dataUri) {
    let img = icon.querySelector('vf-img > img');
    if (!img) {
      const wrap = document.createElement('vf-img');
      wrap.slot = 'large';
      wrap.width = 32;
      wrap.height = 32;
      img = document.createElement('img');
      img.alt = '';
      wrap.append(img);
      icon.append(wrap);
    }
    if (img.getAttribute('src') !== dataUri) img.src = dataUri;
  }

  // --- saved-document icons ---------------------------------------------------
  // Reconciled from the files listing; skipped entirely under ?fresh=1 so a
  // capture on a machine with saved docs stays deterministic (a ?fresh boot
  // therefore shows a bare desktop — no icon is anything but a saved doc).
  function syncDocIcons() {
    const state = files.get();
    const wanted = new Set(state.list.map((r) => `doc:${r.id}`));
    for (const el of root.querySelectorAll('vf-icon[data-key^="doc:"]')) {
      if (!wanted.has(/** @type {HTMLElement} */ (el).dataset.key)) el.remove();
    }
    state.list.forEach((r, i) => {
      const key = `doc:${r.id}`;
      let icon = /** @type {any} */ (
        root.querySelector(`vf-icon[data-key="${CSS.escape(key)}"]`)
      );
      if (!icon) {
        icon = makeIcon(key, r.name, i, { editable: true });
        icon.addEventListener('vf-open', () => actions.openDoc(r.id));
        // In-place rename commits through the same workspace action the File
        // menu's Rename uses — the two paths converge, and any open window
        // of this document retitles along.
        icon.addEventListener('vf-change', (e) => {
          const detail = /** @type {CustomEvent} */ (e).detail;
          workspace.renameStored(r.id, detail.label).catch(() => {
            icon.label = detail.previous; // storage refused — restore
          });
        });
      }
      if (icon.label !== r.name) icon.label = r.name;
      setIconArt(icon, r.icon ?? genericDocIconDataUri());
      // The kit's `open` ghost marks every stored doc with a window open.
      icon.open = !!workspace.byFileId(r.id);
    });
    // A reconcile can remove a selected icon (a doc deleted elsewhere) —
    // re-read so the shell's selection never names a vanished key.
    readSelection();
  }
  if (!fresh) {
    // The listing drives which icons exist; the workspace drives the open
    // ghosts (windows opening and closing move them).
    teardown.push(files.subscribe(syncDocIcons), workspace.subscribe(syncDocIcons));
    syncDocIcons();
  }

  /** Per-icon relative pin across raster resizes: the unrounded fraction
   *  plus the top/left this path last applied (a mismatch there means
   *  someone dragged the icon — or it is new — so its pin re-derives). The
   *  same truth-cache discipline as the windows' (windows.js
   *  onDesktopResized), for the same reason: re-deriving the fraction each
   *  event from the just-snapped position ratchets. */
  const pins = new WeakMap();

  return {
    /** The raster changed size (main.js calls this in the same stroke as
     *  the windows' re-pin, per resize event, un-debounced). Every icon
     *  keeps its relative pin — left as a plain fraction of the raster
     *  width, top of the space below the MENU BAR (the icons' frame; the
     *  options strip is no chrome of theirs). Deliberately NO clamp, like
     *  the windows: the same fraction always maps back exactly, so growing
     *  back returns every icon whole — and unlike a window an icon's left
     *  edge stays a fraction INSIDE the raster, so at worst a sliver of its
     *  plate hangs off the right, still grabbable. */
    onDesktopResized(before) {
      const after = { width: desktop.width, height: desktop.height };
      if (before.width === after.width && before.height === after.height) return;
      for (const el of root.querySelectorAll('vf-icon[data-key]')) {
        const icon = /** @type {any} */ (el);
        const cur = { left: icon.left ?? 0, top: icon.top ?? 0 };
        let rec = pins.get(icon);
        if (!rec || rec.left !== cur.left || rec.top !== cur.top) {
          rec = { pin: pinOf(cur, before, MENU_BAR) };
        }
        const pos = pinTo(rec.pin, after, MENU_BAR);
        icon.left = snapSys(pos.left, icon);
        icon.top = snapSys(pos.top, icon);
        pins.set(icon, { pin: rec.pin, left: icon.left, top: icon.top });
      }
    },
    dispose() {
      for (const fn of teardown) fn();
      // Remove the rendered icons so an HMR re-init rebuilds them with fresh
      // listeners instead of stacking stale ones.
      root.replaceChildren();
      shell.setIconSelection([]);
    },
  };
}
