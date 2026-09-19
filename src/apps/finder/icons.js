// Finder icon layer: reconciles the files slice into vf-icons in each
// container's field (#desktop-icons for the desktop, one field per open folder
// window).
//
// - Keys are doc:<id>, folder:<id> and text:<id>. The Trash is a synthetic
//   folder row.
// - Positions are the icons' left/top properties in system px, in the
//   container's coordinates. desktop-state.js persists them by key through
//   positions().
// - Filing is the kit's icon drag. A drop into another container moves the
//   model, and the reconciler re-creates the icon there.

import { prefersReducedMotion, snapSys, systemPxQuantum } from 'vintage-frames';
import folderArtUrl from '../../assets/folder.png';
import trashArtUrl from '../../assets/trash.png';
import trashFullArtUrl from '../../assets/trash-full.png';
import textArtUrl from '../../assets/text-file.png';
import { genericDocIconDataUri } from '../../image-io.js';
import { build } from '../../state/build.js';
import { files, childrenOf, isInside, itemCount, TRASH } from '../../state/files.js';
import { shell, SPRITE_EDITOR, TEXT_VIEWER } from '../../state/shell.js';
import { workspace } from '../../state/workspace.js';
import { pinOf, pinTo, MENU_BAR } from '../../shell/layout.js';
import {
  cleanUp as cleanUpOnto,
  desktopLattice,
  fillOrder,
  folderLattice,
  latticeSlot,
  trashDefault,
  ICON_CELL,
  ICON_FRAME,
} from './layout.js';

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
// The beat between opens when one command opens several icons, so their windows
// arrive one at a time down the cascade instead of all at once.
const OPEN_BEAT_MS = 140;
const DOC = 'doc:';
const FOLDER = 'folder:';
const TEXT = 'text:';

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 * @param {{ windows: ReturnType<typeof import('../../shell/windows.js').initWindows>,
 *           folders: ReturnType<typeof import('./windows.js').initFolderWindows>,
 *           apps: Record<string, Record<string, (...args: any[]) => any>>,
 *           savedPos?: (key: string) => {left:number, top:number}|null }} opts
 *   apps: the registry's actions by id, read at each open.
 */
export function initIcons(desktop, { windows, folders, apps, savedPos = () => null }) {
  const desktopField = /** @type {any} */ (desktop.querySelector('#desktop-icons'));
  /** @type {(() => void)[]} */
  const teardown = [];
  const on = (el, type, fn, opts) => {
    el.addEventListener(type, fn, opts);
    teardown.push(() => el.removeEventListener(type, fn, opts));
  };

  /** Icons in every container: the desktop field and open folder windows. */
  const allIcons = () =>
    /** @type {any[]} */ ([...desktop.querySelectorAll('vf-icon[data-key]')]);
  const iconsIn = (root) =>
    /** @type {any[]} */ ([...root.querySelectorAll(':scope > vf-icon[data-key]')]);
  const iconByKey = (key) =>
    /** @type {any} */ (desktop.querySelector(`vf-icon[data-key="${CSS.escape(key)}"]`));
  const keyOf = (icon) => /** @type {string} */ (icon.dataset.key);
  const posOf = (icon) => ({ left: icon.left ?? 0, top: icon.top ?? 0 });

  // Selection
  /** @type {Set<() => void>} */
  const selectionListeners = new Set();
  /** @type {Set<() => void>} */
  const movedListeners = new Set();
  const notifySelection = () => {
    for (const fn of selectionListeners) fn();
  };
  on(desktop, 'vf-select', notifySelection);

  // A press in the desktop field makes the Finder front. shell/windows.js
  // handles the rest of the desktop host.
  on(desktopField, 'pointerdown', () => desktop.clearActive());

  // Clear the icon selection when an application window becomes active.
  const onAppActive = () => {
    if (!shell.get().appActive) return;
    const lit = allIcons().filter((icon) => icon.selected);
    if (!lit.length) return;
    for (const icon of lit) icon.selected = false;
    notifySelection();
  };
  teardown.push(shell.subscribe(onAppActive));

  // Workaround: vf-icon deselects on any outside pointerdown,
  // including presses on the menu bar, menus and dialogs. The document capture
  // listener records the selected icons. It is registered at wire-up so it runs
  // before the icons' own listeners, which attach on selection. The desktop
  // capture listener runs later in the same dispatch and re-selects them.
  const CHROME = 'vf-menu-bar, vf-menu, vf-dialog';
  /** @type {any[]} icons selected when a chrome press began */
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
      notifySelection();
    },
    true
  );

  // Positions
  /** Icon positions from folder windows closed this session, by key.
   *  @type {Map<string, {left:number, top:number}>} */
  const remembered = new Map();
  /** Items filed but not yet rendered in their new container: the drop
   *  position, or null for the next free cell. Their saved position belongs to
   *  the old container and is ignored.
   *  @type {Map<string, {left:number, top:number}|null>} */
  const pending = new Map();
  teardown.push(
    folders.onWillClose((_id, field) => {
      for (const icon of iconsIn(field)) remembered.set(keyOf(icon), posOf(icon));
    })
  );

  // Lattices
  /** A container's lattice: the desktop's, or a folder window's at its
   *  current viewport width. */
  const gridFor = (folder) =>
    folder == null
      ? desktopLattice(desktop.width, desktop.height)
      : folderLattice(folders.viewportOf(folder)?.width ?? 0);
  const rootOf = (folder) =>
    folder == null
      ? desktopField
      : (folders.fields().find(([id]) => id === folder)?.[1] ?? null);
  /** The first lattice cell no icon in `root` overlaps. A cell is taken when
   *  any icon's 64px cell covers part of it, so off-lattice icons (a dragged
   *  icon, the Trash) also block it. */
  function nextFree(root, folder) {
    const grid = gridFor(folder);
    const taken = iconsIn(root).map(posOf);
    for (let slot = 0; slot < 4096; slot++) {
      const p = latticeSlot(grid, slot);
      const held = taken.some(
        (t) =>
          Math.abs(t.left - p.left) < ICON_CELL && Math.abs(t.top - p.top) < ICON_CELL
      );
      if (!held) return p;
    }
    return latticeSlot(grid, 0);
  }

  /** Write a position onto an icon. On the desktop it is snapped and clamped
   *  on-raster below the menu bar, so a position saved on a larger raster stays
   *  reachable. In a window it is kept at or past the plane's origin. */
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

  // Icons
  /** Install or swap an icon's 32×32 art. */
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

  /** @param {'doc'|'folder'|'trash'|'text'} kind */
  function makeIcon(key, label, root, folder, kind) {
    const icon = /** @type {any} */ (document.createElement('vf-icon'));
    icon.dataset.key = key;
    icon.label = label;
    icon.width = 64;
    icon.selectable = true;
    icon.movable = true;
    icon.editable = kind !== 'trash';
    if (kind === 'doc') {
      icon.color = true; // color art: the kit darkens it on selection
    } else if (kind !== 'text') {
      // data-folder marks a drop target: folders and the Trash.
      icon.dataset.folder = key.slice(FOLDER.length);
    }
    root.append(icon); // before place(): the snap reads the live scale
    // Precedence: a pending filing, a remembered position, a saved one, then
    // the default.
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
    icon.addEventListener('vf-open', () => apps[SPRITE_EDITOR]?.openDoc(id));
    icon.addEventListener('vf-change', (e) => {
      const detail = /** @type {CustomEvent} */ (e).detail;
      workspace.renameStored(id, detail.label).catch(() => {
        icon.label = detail.previous; // storage failed: restore
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
  function wireText(icon, id) {
    icon.addEventListener('vf-open', () => apps[TEXT_VIEWER]?.open(id));
    icon.addEventListener('vf-change', (e) => {
      const detail = /** @type {CustomEvent} */ (e).detail;
      files.renameText(id, detail.label).catch(() => {
        icon.label = detail.previous;
      });
    });
  }

  // Reconciler
  // Each root holds exactly the icons of its container's items. A moved item is
  // removed and re-created in its new root if that root is open.
  const trashArt = (st) => (itemCount(st, TRASH) ? trashFullArtUrl : trashArtUrl);
  function sync() {
    const st = files.get();
    /** @type {[string|null, any][]} */
    const roots = [[null, desktopField], ...folders.fields()];
    for (const [folder, root] of roots) {
      const kids = childrenOf(st, folder);
      /** @type {Map<string, {kind: 'doc'|'folder'|'trash'|'text', rec: any}>} */
      const wanted = new Map();
      for (const f of kids.folders)
        wanted.set(`${FOLDER}${f.id}`, {
          kind: f.id === TRASH ? 'trash' : 'folder',
          rec: f,
        });
      for (const r of kids.docs) wanted.set(`${DOC}${r.id}`, { kind: 'doc', rec: r });
      for (const t of kids.texts) wanted.set(`${TEXT}${t.id}`, { kind: 'text', rec: t });
      for (const icon of iconsIn(root)) if (!wanted.has(keyOf(icon))) icon.remove();
      for (const [key, { kind, rec }] of wanted) {
        let icon = /** @type {any} */ (
          root.querySelector(`:scope > vf-icon[data-key="${CSS.escape(key)}"]`)
        );
        if (!icon) {
          icon = makeIcon(key, rec.name, root, folder, kind);
          if (kind === 'doc') wireDoc(icon, rec.id);
          else if (kind === 'text') wireText(icon, rec.id);
          else wireFolder(icon, rec.id);
        }
        if (icon.label !== rec.name) icon.label = rec.name;
        if (kind === 'doc') {
          setArt(icon, rec.icon ?? genericDocIconDataUri());
          icon.open = !!workspace.byFileId(rec.id);
        } else if (kind === 'text') {
          setArt(icon, textArtUrl);
          icon.open = windows.isOpen(key);
        } else {
          setArt(icon, kind === 'trash' ? trashArt(st) : folderArtUrl);
          icon.open = folders.isOpen(rec.id);
        }
      }
      // The field's size is the window's scroll range.
      if (folder != null) folders.fit(folder);
    }
  }
  teardown.push(
    files.subscribe(sync),
    workspace.subscribe(sync),
    folders.onChange(sync),
    windows.onWindows(sync)
  );
  sync();

  // Filing
  /** What the pointer is over, skipping the dragged icons. elementsFromPoint
   *  also returns covered elements, so the stack is read only down to the
   *  first vf-window. `win` is that window, `window` the folder it shows (null
   *  for another application's), and `desktop` is true where no window covers
   *  the point. */
  const under = (x, y, skip) => {
    const stack = document.elementsFromPoint(x, y).filter((el) => !skip.includes(el));
    const front = stack.findIndex((el) => el.localName === 'vf-window');
    const seen = front < 0 ? stack : stack.slice(0, front);
    const folderIcon = /** @type {any} */ (
      seen.find(
        (el) =>
          el.localName === 'vf-icon' &&
          /** @type {HTMLElement} */ (el).dataset.folder != null
      ) ?? null
    );
    const win = /** @type {any} */ (front < 0 ? null : stack[front]);
    return {
      folderIcon,
      folder: folderIcon ? /** @type {string} */ (folderIcon.dataset.folder) : null,
      win,
      window: win ? folders.folderOf(win) : null,
      desktop: !win && stack.includes(desktop),
    };
  };
  /** Whether a set can be filed into `folder`. A set holding the Trash never
   *  can, and a folder never goes into itself or a descendant. */
  const canFile = (icons, folder) => {
    if (icons.some((icon) => icon.dataset.folder === TRASH)) return false;
    if (folder == null) return true;
    const st = files.get();
    return icons.every((icon) => {
      const f = icon.dataset.folder;
      return f == null || (f !== folder && !isInside(st, folder, f));
    });
  };
  /** @type {any} the folder icon with `target` set, or null */
  let target = null;
  const highlight = (next) => {
    if (target === next) return;
    if (target) target.target = false;
    target = next;
    if (target) target.target = true;
  };
  /**
   * Move a set into a container. Each key's landing (null: the next free cell)
   * goes into `pending` for the reconciler, then the model is updated. An item
   * already in `folder` does not move and its landing is dropped.
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
          : key.startsWith(TEXT)
            ? await files.moveText(key.slice(TEXT.length), folder)
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
    const from = folders.folderOf(leader); // null for the desktop
    // Each member's drop point: its box offset by the leader's delta. Measured
    // before anything moves.
    const lead = leader.getBoundingClientRect();
    const landings = icons.map((icon) => {
      const r = icon.getBoundingClientRect();
      return { icon, x: r.left + (x - lead.left), y: r.top + (y - lead.top) };
    });
    if (hit.folder != null) {
      // Onto a folder icon: file into its next free cells if allowed.
      e.preventDefault();
      if (canFile(icons, hit.folder)) {
        file(
          landings.map(({ icon }) => ({ icon, at: null })),
          hit.folder
        );
      }
      return;
    }
    if (hit.win && hit.window == null) {
      // Over another application's window: nothing moves.
      e.preventDefault();
      return;
    }
    if (hit.window != null && hit.window !== from) {
      // Into a folder window from elsewhere: at each drop point on its plane.
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
    if (hit.desktop && from != null) {
      // From a window onto the desktop: at each drop point, below the menu bar.
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
    // Otherwise the drop is within the source container and the kit moves it.
  });

  /** Per-icon nine-slice pin, with the left/top this path last wrote. A
   *  mismatch means the icon was dragged or is new, so its pin is re-derived.
   *  Re-deriving from the snapped position on every event would drift. */
  const pins = new WeakMap();
  const CELL = { width: ICON_CELL, height: ICON_CELL };
  /** Re-pin every desktop icon on a raster resize, with the nine-slice pin in
   *  ICON_FRAME and the 64px cell as a fixed size. No clamp, so resizing back
   *  restores every position. */
  const repinIcons = (before, after) => {
    // dragIcons([]) finishes a Clean Up walk synchronously, so the pins read
    // the icons' final positions.
    desktopField.dragIcons([]);
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
  };
  teardown.push(windows.onRaster(repinIcons));

  return {
    /** Every known position by key: live icons over remembered ones, and null
     *  for an item filed but not yet rendered. desktop-state.js merges it. */
    positions() {
      /** @type {Record<string, {left:number, top:number}|null>} */
      const out = {};
      for (const [key, p] of remembered) out[key] = p;
      for (const key of pending.keys()) out[key] = null;
      for (const icon of allIcons()) out[keyOf(icon)] = posOf(icon);
      return out;
    },
    /** Select an item's icon and open its rename box. */
    startRename(key) {
      const icon = iconByKey(key);
      if (!icon) return;
      icon.setSelected(true);
      icon.startEditing();
    },
    /** The selected icons' keys, excluding the Trash, in listing order:
     *  folders, documents, then text files.
     *  @returns {string[]} */
    selection() {
      const lit = new Set(
        allIcons()
          .filter((icon) => icon.selected && icon.dataset.folder !== TRASH)
          .map(keyOf)
      );
      const st = files.get();
      return [
        ...st.folders.map((f) => `${FOLDER}${f.id}`),
        ...st.list.map((r) => `${DOC}${r.id}`),
        ...st.texts.map((t) => `${TEXT}${t.id}`),
      ].filter((key) => lit.has(key));
    },
    /** Open every selected icon, the route a double-click or a tap pair takes.
     *  Several open a beat apart, so their windows arrive down the cascade one
     *  at a time; one opens at once, and so do all of them under reduced
     *  motion. An icon gone by its turn is skipped.
     *  @returns {Promise<void>} */
    async openSelection() {
      const beat = prefersReducedMotion() ? 0 : OPEN_BEAT_MS;
      for (const [i, key] of this.selection().entries()) {
        if (i && beat) await new Promise((done) => setTimeout(done, beat));
        iconByKey(key)?.dispatchEvent(new CustomEvent('vf-open'));
      }
    },
    /** Make `keys` the selection and clear every other icon.
     *  @param {string[]} keys */
    select(keys) {
      const want = new Set(keys);
      for (const icon of allIcons()) icon.setSelected(want.has(keyOf(icon)));
      notifySelection();
    },
    /** Select every icon in a container's field (null: the desktop, the Trash
     *  included).
     *  @param {string|null} folder */
    selectAll(folder) {
      const root = rootOf(folder);
      if (!root) return;
      this.select(iconsIn(root).map(keyOf));
    },
    /** Move every icon of one container (null: the desktop) to the nearest
     *  free cell of its lattice. The kit's dragIcons walks them in fill order.
     *  @param {string|null} folder
     *  @returns {Promise<void>} */
    async cleanUp(folder) {
      const root = rootOf(folder);
      if (!root) return;
      const grid = gridFor(folder);
      const icons = iconsIn(root);
      const cells = cleanUpOnto(grid, icons.map(posOf));
      const moves = icons
        .map((icon, i) => ({ icon, ...cells[i] }))
        .sort((a, b) => fillOrder(grid, a, b));
      await root.dragIcons(moves);
      if (folder != null) folders.fit(folder);
      for (const fn of movedListeners) fn();
    },
    /** Icons moved without a pointer gesture (a finished Clean Up). Returns the
     *  unsubscribe. @param {() => void} fn */
    onMoved(fn) {
      movedListeners.add(fn);
      return () => {
        movedListeners.delete(fn);
      };
    },
    /** The selection changed. Also fires for the activation's clear and the
     *  chrome workaround's re-select, which come after the kit's vf-select.
     *  Returns the unsubscribe. @param {() => void} fn */
    onSelectionChange(fn) {
      selectionListeners.add(fn);
      return () => {
        selectionListeners.delete(fn);
      };
    },
    dispose() {
      for (const fn of teardown) fn();
      selectionListeners.clear();
      movedListeners.clear();
      highlight(null);
      // Remove the icons so an HMR re-init starts without stale listeners.
      // Folder windows' icons go with folders.dispose().
      desktopField.replaceChildren();
    },
  };
}
