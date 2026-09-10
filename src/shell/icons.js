// ---------------------------------------------------------------------------
// The icon layer: one renameable icon per SAVED document and per FOLDER,
// reconciled from the files slice into its CONTAINER — the desktop's field
// (#desktop-icons, a vf-icon-field filling the screen) for the items whose
// container is the desktop, and every OPEN folder window's field
// (shell/folders.js) for that folder's children. Nothing else is an icon:
// the built-in defaults are seeded into the library at the first-ever boot,
// so they're ordinary rows here, not a special cluster. A document's art is
// generated from the document itself — the FRONT tile drawn into 32×32
// (image-io.js) — so those icons declare the kit's `color` treatment
// (selection darkens instead of inverting); a folder's is the app's own
// 1-bit art (src/assets/folder.png), whose selection, `target` and open
// ghost are the kit's exact inversions and dithers of that one file.
// Double-click opens (a document dirty-checked through the shell actions; a
// folder into its window); an open document's — and an open folder's —
// icon wears the kit's `open` ghost.
//
// Positions are `left`/`top` properties in system px — never CSS — so a
// drag writes back through the same declaration and desktop-state.js can
// persist them, BY ITEM, in the item's CURRENT container's coordinates: the
// desktop's are screen coordinates (the field is filled, not placed, so its
// icons anchor to the raster), a window's are its plane's. PLACEMENT is the
// windows' regime in the ICONS' frame — the whole desktop below the menu
// bar (icons are the Finder's furniture; the options strip is application
// chrome, hidden whenever the desktop takes focus, so it reserves nothing
// above an icon): a saved position (a previous session's drag) wins, else
// the first FREE cell of the container's lattice (shell/layout.js
// iconDefault — the classic left-edge column below the Tools band, wrapping
// on a short raster; iconGridDefault inside a window — rows from the
// plane's origin, wrapping at its width); on the desktop it is clamped
// on-raster at boot, and a browser resize re-pins every desktop icon by the
// same nine-slice rule as the windows, in the icons' own frame
// (onDesktopResized below) — a window's icons are in its coordinates and
// travel with it. The layer remembers a closed window's icon positions for
// the session (folders.onWillClose), and hands desktop-state every position
// it knows (positions()), so a closed folder never forgets its arrangement.
//
// FILING IS THE DRAG (Sep 7 2026, vintage-frames 0.7.0): a movable icon's
// drag is the kit's — the classic dotted outline over everything, the icon
// staying put, every selected icon of its field travelling as one, Escape
// cancelling — reported as vf-drag / vf-drop (cancelable) with the pointer
// and the outline's origin; the PAGE decides what a drop means (the kit's
// position on every gesture: it reports, the consumer decides). Three
// destinations, hit-tested with elementsFromPoint (the travelling icons
// skipped — the outline is never a hit): onto a FOLDER ICON files the set
// into that folder at its lattice's next free cells; into a FOLDER WINDOW
// the set came from elsewhere files it there, each member where its own
// outline was let go (the window's placementAt, held at the origin); out
// onto the DESKTOP from a window files it to the root, each where its
// outline was (the desktop's placementAt, held below the menu bar). Each
// of those cancels the default action and moves the MODEL (files.moveDoc /
// moveFolder — the icon element follows through the reconciler, landing at
// the drop's position); a drop in the container the set came from is left
// to the kit's default action, which moves the set whole. A folder is never
// filed into itself or a descendant (the slice refuses; the drop is
// cancelled and nothing moves; no highlight either). Under a drag the
// folder icon under the pointer wears the kit's `target` — the Finder's
// inverted destination.
//
// THE TRASH (Sep 9 2026) is the third kind, rendered from the files slice's
// synthetic row like any desktop folder — so a drop onto it or into its
// window IS deleting, through the paths above with nothing new — with
// three differences and one addition: its art follows its contents (the
// plain can empty, the bulging one with anything in it — src/assets/, the
// user's 1-bit art, swapped by src, so the kit's ghost and `target` are
// derivations of whichever can is up); it is not `editable` (the slice
// refuses a rename regardless); its default place is the raster's
// bottom-right corner (layout.js trashDefault), a saved position winning
// as for every icon; and it is NEVER FILED — canFile refuses any set that
// holds it, so a banded selection cannot carry it into a folder or a
// window, while a drop of it on the bare desktop is the kit's own move.
// It is furniture: on the desktop with or without a library, under ?fresh
// too (the listing is never read there, so a capture stays deterministic
// with the one icon in its corner).
// ---------------------------------------------------------------------------

import { snapSys, systemPxQuantum } from 'vintage-frames';
import folderArtUrl from '../assets/folder.png';
import trashArtUrl from '../assets/trash.png';
import trashFullArtUrl from '../assets/trash-full.png';
import { genericDocIconDataUri } from '../image-io.js';
import { build } from '../state/build.js';
import { files, childrenOf, isInside, TRASH } from '../state/files.js';
import { shell } from '../state/shell.js';
import { workspace } from '../state/workspace.js';
import {
  iconDefault,
  iconGridDefault,
  trashDefault,
  pinOf,
  pinTo,
  ICON_CELL,
  ICON_FRAME,
  MENU_BAR,
} from './layout.js';

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const DOC = 'doc:';
const FOLDER = 'folder:';

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 * @param {{ actions: {openDoc(id: string): void},
 *           folders: ReturnType<typeof import('./folders.js').initFolders>,
 *           savedPos?: (key: string) => {left:number, top:number}|null }} opts
 */
export function initIcons(desktop, { actions, folders, savedPos = () => null }) {
  const desktopField = /** @type {any} */ (desktop.querySelector('#desktop-icons'));
  /** @type {(() => void)[]} */
  const teardown = [];
  const on = (el, type, fn, opts) => {
    el.addEventListener(type, fn, opts);
    teardown.push(() => el.removeEventListener(type, fn, opts));
  };

  /** Every icon in every container — the desktop field's and the open
   *  folder windows' (light-DOM descendants of the desktop element). */
  const allIcons = () =>
    /** @type {any[]} */ ([...desktop.querySelectorAll('vf-icon[data-key]')]);
  const iconsIn = (root) =>
    /** @type {any[]} */ ([...root.querySelectorAll(':scope > vf-icon[data-key]')]);
  const iconByKey = (key) =>
    /** @type {any} */ (desktop.querySelector(`vf-icon[data-key="${CSS.escape(key)}"]`));
  const keyOf = (icon) => /** @type {string} */ (icon.dataset.key);
  const posOf = (icon) => ({ left: icon.left ?? 0, top: icon.top ?? 0 });

  // --- the Finder wire ---------------------------------------------------------
  // A press in the desktop's field — the bare dither or an icon on it — is
  // a press on the Finder. The page owns every "this press means the
  // Finder" decision (the kit never takes it): windows.js covers the
  // desktop host (the bezel, now that the field takes the dither's presses),
  // and this covers the field — both routing through the same
  // clearActive(). A press in a FOLDER WINDOW needs nothing: the window
  // activates itself, and a panel active IS the Finder's turn (windows.js
  // applyActive). A double-click's open then reactivates through the
  // normal activateContext path.
  on(desktopField, 'pointerdown', () => desktop.clearActive());

  // The selection is the ICONS' own — the kit holds it, one per screen (it
  // clears on any press outside an icon, across containers), and nothing
  // mirrors it into a store: File → Open's Finder grammar was the one
  // reader, and it retired with the item (Sep 9 2026). What the highlight
  // names now is the next DRAG or rename.
  //
  // Opening moves focus INTO the application, and the ACTIVATION clears the
  // selection: the moment a document window takes active (an icon
  // double-click's vf-open, File → New… — any path that lands appActive),
  // the highlight has nothing left to name and the application is forward
  // now. Driven off the shell mirror rather than the open paths themselves,
  // so every way a window comes forward converges here. Clearing is a plain
  // property write (the kit's documented programmatic route; false detaches
  // the icon's own outside listener).
  const onAppActive = () => {
    if (!shell.get().appActive) return;
    const lit = allIcons().filter((icon) => icon.selected);
    if (!lit.length) return;
    for (const icon of lit) icon.selected = false;
  };
  teardown.push(shell.subscribe(onAppActive));

  // A press on the APPLICATION'S CHROME keeps the Finder selection. The
  // kit's vf-icon clears itself on ANY outside pointerdown — the menu bar
  // included (still so on 0.7.0) — so pulling a menu down over a selected
  // icon would drop its highlight (kit ask #5, APP-IA-PLAN.md §3.1).
  // System 7's Finder kept the selection while a menu was pulled:
  // the menu bar, a dropped menu and a modal dialog are the application's
  // surfaces, not the desktop's, so a press on them says nothing about
  // what's selected. The page bridges it with two capture listeners AROUND
  // the kit's own: one on the document — registered here at wire-up, so it
  // precedes every icon's outside listener (those attach on selection, and
  // same-target listeners fire in registration order) — snapshots the icons
  // the press is about to clear; one on the desktop (later in the same
  // dispatch — the icons' have run by then, the chrome is slotted in the
  // desktop) re-selects them, so the highlight is back before the menu bar's
  // own handler even drops the panel. Setting `selected` is the kit's
  // documented programmatic route; it re-arms the icon's outside listener.
  // Remove this bridge once the kit exempts its own chrome.
  const CHROME = 'vf-menu-bar, vf-menu, vf-dialog';
  /** @type {any[]} the icons a chrome press is clearing mid-dispatch */
  let held = [];
  on(
    document,
    'pointerdown',
    (e) => {
      held = e.composedPath().some((n) => n instanceof Element && n.matches(CHROME))
        ? allIcons().filter((icon) => icon.selected)
        : [];
    },
    true
  );
  on(
    desktop,
    'pointerdown',
    () => {
      if (!held.length) return;
      for (const icon of held) icon.selected = true;
      held = [];
    },
    true
  );

  // --- positions: the session's memory ------------------------------------------
  /** Positions of icons no longer live — a closed folder window's — by key,
   *  in their container's coordinates. @type {Map<string, {left:number, top:number}>} */
  const remembered = new Map();
  /** Items filed this session and not yet rendered in their new container:
   *  the drop's landing (`null`: the lattice's next free cell). Their saved
   *  position is the OLD container's and is never consulted.
   *  @type {Map<string, {left:number, top:number}|null>} */
  const pending = new Map();
  teardown.push(
    folders.onWillClose((_id, field) => {
      for (const icon of iconsIn(field)) remembered.set(keyOf(icon), posOf(icon));
    })
  );

  // --- the lattices --------------------------------------------------------------
  /** The container's default lattice: the desktop's raster-derived column,
   *  or a window's grid at its plane's width. */
  const latticeFor = (folder) =>
    folder == null
      ? (slot) => iconDefault(slot, desktop.height)
      : (slot) => iconGridDefault(slot, folders.viewportOf(folder)?.width ?? 0);
  /** The first lattice cell no icon in `root` sits on (within half a
   *  cell) — where a new item lands, and a filed one with no landing. */
  function nextFree(root, folder) {
    const at = latticeFor(folder);
    const taken = iconsIn(root).map(posOf);
    for (let slot = 0; slot < 4096; slot++) {
      const p = at(slot);
      const held = taken.some(
        (t) =>
          Math.abs(t.left - p.left) < ICON_CELL / 2 &&
          Math.abs(t.top - p.top) < ICON_CELL / 2
      );
      if (!held) return p;
    }
    return at(0);
  }

  /** Write a position onto an icon in its container's discipline. On the
   *  desktop, the boot clamp — the windows' (windows.js clampWindow): a
   *  position saved on a larger raster pulls back on-screen (an off-raster
   *  icon has nothing to grab, so it would be unreachable at any drag) and
   *  lands on the same k-system-px lattice a drag lands on, in the ICON's
   *  frame: the whole desktop below the menu bar. Inside a window, the
   *  plane's origin at least — the rails reach anything placed past the
   *  viewport, so nothing else clamps. */
  function place(icon, folder, pos) {
    if (folder == null) {
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
    } else {
      icon.left = snapSys(Math.max(0, pos.left), icon);
      icon.top = snapSys(Math.max(0, pos.top), icon);
    }
  }

  // --- the icons -----------------------------------------------------------------
  /** Swap (or install) an icon's 32×32 art. The vf-img wrapper is created
   *  once; later syncs only touch the img src when it actually changed. */
  function setArt(icon, src) {
    let img = icon.querySelector('vf-img > img');
    if (!img) {
      const wrap = /** @type {any} */ (document.createElement('vf-img'));
      wrap.slot = 'large';
      wrap.width = 32;
      wrap.height = 32;
      img = document.createElement('img');
      img.alt = '';
      wrap.append(img);
      icon.append(wrap);
    }
    if (img.getAttribute('src') !== src) img.src = src;
  }

  /** @param {'doc'|'folder'|'trash'} kind */
  function makeIcon(key, label, root, folder, kind) {
    const icon = /** @type {any} */ (document.createElement('vf-icon'));
    icon.dataset.key = key;
    icon.label = label;
    icon.width = 64;
    icon.selectable = true;
    icon.movable = true;
    icon.editable = kind !== 'trash'; // the Trash keeps its name
    if (kind === 'doc') {
      icon.color = true; // generated color art: selection darkens, not inverts
    } else {
      // The drop's marker (the kit's recipe): what a drag files into — a
      // folder's, and the Trash's the same way.
      icon.dataset.folder = key.slice(FOLDER.length);
    }
    root.append(icon); // appended first: the snap below reads the live scale
    // Where it lands: a filing's landing (or its next free cell), else the
    // position remembered from a window closed this session, else the
    // saved one, else the container's default — the lattice's next free
    // cell, or the Trash's corner.
    const fallback = () =>
      kind === 'trash'
        ? trashDefault(desktop.width, desktop.height)
        : nextFree(root, folder);
    const pos = pending.has(key)
      ? (pending.get(key) ?? fallback())
      : (remembered.get(key) ?? savedPos(key) ?? fallback());
    pending.delete(key);
    remembered.delete(key);
    place(icon, folder, pos);
    return icon;
  }

  function wireDoc(icon, id) {
    icon.addEventListener('vf-open', () => actions.openDoc(id));
    // In-place rename commits through the same workspace action the File
    // menu's Rename uses — the two paths converge, and any open window
    // of this document retitles along.
    icon.addEventListener('vf-change', (e) => {
      const detail = /** @type {CustomEvent} */ (e).detail;
      workspace.renameStored(id, detail.label).catch(() => {
        icon.label = detail.previous; // storage refused — restore
      });
    });
  }
  function wireFolder(icon, id) {
    icon.addEventListener('vf-open', () => folders.open(id));
    icon.addEventListener('vf-change', (e) => {
      const detail = /** @type {CustomEvent} */ (e).detail;
      files.renameFolder(id, detail.label).catch(() => {
        icon.label = detail.previous;
      });
    });
  }

  // --- the reconciler ------------------------------------------------------------
  // Every ROOT — the desktop's field for the container null, plus one field
  // per open folder window — holds exactly the icons of the items whose
  // container it is (the folders first, then the documents, each in listing
  // order): an item that moved away is removed here and re-created in its
  // new root if that root is on screen (its landing under `pending`); the
  // label, the art and the open ghost are re-read every pass. Under
  // ?fresh=1 the listing is never read (main.js), so the slice holds the
  // Trash's row alone and the desktop shows the one icon, in its corner —
  // deterministic on a machine with saved docs, as a capture needs.
  /** The Trash's can: plain while it holds nothing, bulging otherwise. */
  const trashArt = (st) => {
    const c = childrenOf(st, TRASH);
    return c.docs.length || c.folders.length ? trashFullArtUrl : trashArtUrl;
  };
  function sync() {
    const st = files.get();
    /** @type {[string|null, any][]} */
    const roots = [[null, desktopField], ...folders.fields()];
    for (const [folder, root] of roots) {
      const kids = childrenOf(st, folder);
      /** @type {Map<string, {kind: 'doc'|'folder'|'trash', rec: any}>} */
      const wanted = new Map();
      for (const f of kids.folders)
        wanted.set(`${FOLDER}${f.id}`, {
          kind: f.id === TRASH ? 'trash' : 'folder',
          rec: f,
        });
      for (const r of kids.docs) wanted.set(`${DOC}${r.id}`, { kind: 'doc', rec: r });
      for (const icon of iconsIn(root)) if (!wanted.has(keyOf(icon))) icon.remove();
      for (const [key, { kind, rec }] of wanted) {
        let icon = /** @type {any} */ (
          root.querySelector(`:scope > vf-icon[data-key="${CSS.escape(key)}"]`)
        );
        if (!icon) {
          icon = makeIcon(key, rec.name, root, folder, kind);
          if (kind === 'doc') wireDoc(icon, rec.id);
          else wireFolder(icon, rec.id);
        }
        if (icon.label !== rec.name) icon.label = rec.name;
        if (kind === 'doc') {
          setArt(icon, rec.icon ?? genericDocIconDataUri());
          // The kit's `open` ghost marks every stored doc with a window open.
          icon.open = !!workspace.byFileId(rec.id);
        } else {
          setArt(icon, kind === 'trash' ? trashArt(st) : folderArtUrl);
          icon.open = folders.isOpen(rec.id);
        }
      }
      // The field's extent follows what it holds (the plane's scroll range).
      if (folder != null) folders.fit(folder);
    }
  }
  // The listing drives which icons exist and where; the workspace drives
  // the open ghosts (windows opening and closing move them); the folder
  // windows are the roots.
  teardown.push(files.subscribe(sync), workspace.subscribe(sync), folders.onChange(sync));
  sync();

  // --- filing: the drag ----------------------------------------------------------
  /** What is under the pointer, the travelling icons skipped: a folder
   *  icon (the recipe's `data-folder`), a folder window, the desktop. */
  const under = (x, y, skip) => {
    const stack = document.elementsFromPoint(x, y).filter((el) => !skip.includes(el));
    const folderIcon = /** @type {any} */ (
      stack.find(
        (el) =>
          el.localName === 'vf-icon' &&
          /** @type {HTMLElement} */ (el).dataset.folder != null
      ) ?? null
    );
    const win = /** @type {any} */ (
      stack.find((el) => el.localName === 'vf-window' && folders.folderOf(el) != null) ??
        null
    );
    return {
      folderIcon,
      folder: folderIcon ? /** @type {string} */ (folderIcon.dataset.folder) : null,
      win,
      window: win ? folders.folderOf(win) : null,
      desktop: stack.includes(desktop),
    };
  };
  /** Can this set be filed into `folder`? Never the Trash (it is the
   *  desktop's, and a set that swept it up files nowhere), and never a
   *  folder into itself or a descendant (the slice refuses both moves;
   *  this keeps the highlight honest and the drop silent). */
  const canFile = (icons, folder) => {
    if (icons.some((icon) => icon.dataset.folder === TRASH)) return false;
    if (folder == null) return true;
    const st = files.get();
    return icons.every((icon) => {
      const f = icon.dataset.folder;
      return f == null || (f !== folder && !isInside(st, folder, f));
    });
  };
  /** @type {any} the folder icon wearing `target`, or null */
  let target = null;
  const highlight = (next) => {
    if (target === next) return;
    if (target) target.target = false;
    target = next;
    if (target) target.target = true;
  };
  /**
   * Move a set into a container: the landing (or null for the lattice's
   * next free cell) parked under each key for the reconciler, then the
   * model — the listing change re-renders each icon in its new root. An
   * item already there (a document dropped on the icon of the folder it
   * sits in) moves nothing and forgets its landing.
   * @param {{icon: any, at: {left:number, top:number}|null}[]} entries
   * @param {string|null} folder
   */
  async function file(entries, folder) {
    for (const { icon, at } of entries) {
      const key = keyOf(icon);
      pending.set(key, at);
      remembered.delete(key);
    }
    try {
      for (const { icon } of entries) {
        const key = keyOf(icon);
        const moved = key.startsWith(FOLDER)
          ? await files.moveFolder(key.slice(FOLDER.length), folder)
          : await files.moveDoc(key.slice(DOC.length), folder);
        if (!moved) pending.delete(key);
      }
    } catch (err) {
      for (const { icon } of entries) pending.delete(keyOf(icon));
      build.setError(`Filing failed: ${err.message}`);
    }
  }
  on(desktop, 'vf-drag', (e) => {
    const { clientX, clientY, icons } = /** @type {CustomEvent} */ (e).detail;
    const hit = under(clientX, clientY, icons);
    highlight(hit.folderIcon && canFile(icons, hit.folder) ? hit.folderIcon : null);
  });
  on(desktop, 'vf-drag-cancel', () => highlight(null));
  on(desktop, 'vf-drop', (e) => {
    const leader = /** @type {any} */ (e.target);
    const { clientX, clientY, x, y, icons } = /** @type {CustomEvent} */ (e).detail;
    const hit = under(clientX, clientY, icons);
    highlight(null);
    const from = folders.folderOf(leader); // null: the desktop
    // Where each member's outline was let go: its own box translated by the
    // delta the leader's x/y carry. Measured before anything moves.
    const lead = leader.getBoundingClientRect();
    const landings = icons.map((icon) => {
      const r = icon.getBoundingClientRect();
      return { icon, x: r.left + (x - lead.left), y: r.top + (y - lead.top) };
    });
    if (hit.folder != null) {
      // Onto a folder icon: into that folder at its next free cells — or,
      // refused, nowhere (the icon stays where it was).
      e.preventDefault();
      if (canFile(icons, hit.folder)) {
        file(
          landings.map(({ icon }) => ({ icon, at: null })),
          hit.folder
        );
      }
      return;
    }
    if (hit.window != null && hit.window !== from) {
      // Into a folder window from elsewhere: where each outline was let go,
      // on the window's plane, held at its origin.
      e.preventDefault();
      if (!canFile(icons, hit.window)) return;
      const win = hit.win;
      file(
        landings.map(({ icon, x: lx, y: ly }) => {
          const p = win.placementAt(lx, ly);
          return { icon, at: { left: Math.max(0, p.left), top: Math.max(0, p.top) } };
        }),
        hit.window
      );
      return;
    }
    if (hit.window == null && hit.desktop && from != null) {
      // Out onto the desktop from a window: where each outline was let go,
      // in the icons' frame — below the menu bar, on the raster.
      e.preventDefault();
      file(
        landings.map(({ icon, x: lx, y: ly }) => {
          const p = desktop.placementAt(lx, ly);
          return {
            icon,
            at: { left: Math.max(0, p.left), top: Math.max(MENU_BAR, p.top) },
          };
        }),
        null
      );
    }
    // Otherwise the drop is in the container the set came from: the kit's
    // default action moves it, whole; the positions are read off the
    // elements at the next snapshot.
  });

  /** Per-icon nine-slice pin across raster resizes: the unrounded pin plus
   *  the top/left this path last applied (a mismatch there means someone
   *  dragged the icon — or it is new — so its pin re-derives). The same
   *  truth-cache discipline as the windows' (windows.js onDesktopResized),
   *  for the same reason: re-deriving the pin each event from the
   *  just-snapped position ratchets. */
  const pins = new WeakMap();
  const CELL = { width: ICON_CELL, height: ICON_CELL };

  return {
    /** The raster changed size (main.js calls this in the same stroke as
     *  the windows' re-pin, per resize event, un-debounced). Every DESKTOP
     *  icon keeps its nine-slice pin (shell/layout.js pinOf/pinTo) in the
     *  ICON_FRAME: the desktop below the MENU BAR (the options strip is no
     *  chrome of theirs), uniform bands — no application furniture lives
     *  in the Finder's frame. The classic left-edge column is a strut (it
     *  stays at its 16px), its rows spring with the middle; an icon
     *  dragged into a corner stays in that corner. A fixed-size box — the
     *  64px cell — so its edges resolve through the anchor rule.
     *  Deliberately NO clamp, like the windows: the same pin always maps
     *  back exactly, so growing back returns every icon whole. A folder
     *  window's icons are in its coordinates and travel with it. */
    onDesktopResized(before) {
      const after = { width: desktop.width, height: desktop.height };
      if (before.width === after.width && before.height === after.height) return;
      for (const icon of iconsIn(desktopField)) {
        const cur = { ...posOf(icon), ...CELL };
        let rec = pins.get(icon);
        if (!rec || rec.left !== cur.left || rec.top !== cur.top) {
          rec = { pin: pinOf(cur, before, ICON_FRAME) };
        }
        const pos = pinTo(rec.pin, after, ICON_FRAME, { size: CELL });
        icon.left = snapSys(pos.left, icon);
        icon.top = snapSys(pos.top, icon);
        pins.set(icon, { pin: rec.pin, left: icon.left, top: icon.top });
      }
    },
    /** Every position the layer knows, by key — the live icons' (the
     *  properties ARE the truth after any drag) under the remembered ones
     *  (a closed window's), and `null` for an item filed away and not yet
     *  rendered in its new container (its old position is no longer a
     *  position). desktop-state.js merges it into the blob. */
    positions() {
      /** @type {Record<string, {left:number, top:number}|null>} */
      const out = {};
      for (const [key, p] of remembered) out[key] = p;
      for (const key of pending.keys()) out[key] = null;
      for (const icon of allIcons()) out[keyOf(icon)] = posOf(icon);
      return out;
    },
    /** Select an item's icon and open its rename box — New Folder's
     *  name-selected-for-typing (the kit's public routes). */
    startRename(key) {
      const icon = iconByKey(key);
      if (!icon) return;
      icon.setSelected(true);
      icon.startEditing();
    },
    dispose() {
      for (const fn of teardown) fn();
      highlight(null);
      // Remove the rendered icons so an HMR re-init rebuilds them with fresh
      // listeners instead of stacking stale ones (the folder windows' go
      // with their windows — folders.dispose).
      desktopField.replaceChildren();
    },
  };
}
