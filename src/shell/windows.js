// Window manager: adoption, the front application, the resize rule and
// Arrange Windows. Applications own their windows (src/apps/<id>/windows.js)
// and declare them here through adopt().
//
// - adopt() takes the window's app, placement (`place`), saved pin (`pin`),
//   resize policy, kept box (`keep`) and catalog item (`item`). The owner
//   appends the node, and calls release() before removing it.
// - shell.frontApp follows the desktop's vf-activate event: the active window's
//   app, or the Finder when none is active. beforeFront listeners run first.
// - On a raster resize every adopted window is re-pinned with the nine-slice
//   pin (shell/layout.js pinOf/pinTo); onRaster passes the change on.
// - arrange() runs each app's arrangement group and re-applies every `place`;
//   arranged() reports whether the screen already matches.

import { snapSys, systemPxQuantum, VfWindow } from 'vintage-frames';
import { shell, FINDER } from '../state/shell.js';
import { nearBox, pinOf, pinTo, TOP_RESERVE, windowFrame } from './layout.js';

// vf-window's grow floor (MIN_WIDTH × MIN_HEIGHT). The kit does not export it.
const KIT_MIN_WIDTH = 80;
const KIT_MIN_HEIGHT = 54;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** A window's live box, with an undeclared edge read as 0.
 *  @param {VfWindow} win */
const boxOf = (win) => ({
  left: win.left ?? 0,
  top: win.top ?? 0,
  width: win.width ?? 0,
  height: win.height ?? 0,
});

/**
 * The box a placement would write for `g` on `win`. The position snaps to the
 * window's system-px lattice and is clamped onto the raster below TOP_RESERVE.
 * A resizable window's size is first capped at the open area, so its grow box
 * stays reachable.
 * @param {import('vintage-frames').VfDesktop} desktop
 * @param {VfWindow} win
 * @param {{left?: number, top?: number, width?: number, height?: number}} g
 */
export function clampedBox(desktop, win, g) {
  const k = systemPxQuantum(win);
  const down = (v) => Math.floor(v / k) * k;
  const up = (v) => Math.ceil(v / k) * k;
  const minTop = up(TOP_RESERVE);
  let { width, height } = g;
  if (win.resizable) {
    if (Number.isFinite(width)) width = Math.min(width, down(desktop.width));
    if (Number.isFinite(height))
      height = Math.min(height, down(Math.max(0, desktop.height - minTop)));
  }
  const w = width ?? 0;
  const h = height ?? 0;
  const left = clamp(snapSys(g.left ?? 0, win), 0, Math.max(0, down(desktop.width - w)));
  const top = clamp(
    snapSys(g.top ?? minTop, win),
    minTop,
    Math.max(minTop, down(desktop.height - h))
  );
  return { left, top, width, height };
}

/**
 * Parses an application's windows.html into a host element of this document,
 * with every custom element upgraded so a window takes properties before it
 * is appended. Template content stays inert until cloneWindow.
 * @param {string} html
 * @returns {HTMLElement}
 */
export function parseWindows(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  customElements.upgrade(host);
  return host;
}

/**
 * A window cloned from its template and upgraded, ready for properties.
 * importNode, not cloneNode: customElements.upgrade() is a no-op on nodes
 * still owned by the template's document. On an un-upgraded element, Lit
 * applies a property only at its first update, after connectedCallback.
 * @param {HTMLTemplateElement} tpl
 * @returns {VfWindow}
 */
export function cloneWindow(tpl) {
  const win = /** @type {VfWindow} */ (
    document.importNode(/** @type {Element} */ (tpl.content.firstElementChild), true)
  );
  customElements.upgrade(win);
  return win;
}

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 */
export function initWindows(desktop) {
  /** @type {(() => void)[]} */
  const unsubs = [];
  const raster = () => ({ width: desktop.width, height: desktop.height });

  // Adopted windows and arrangement groups.
  /** @typedef {{left: number, top: number, width: number, height: number}} Box */
  /** @typedef {{
   *   app: import('../state/shell.js').AppId,
   *   place: ((w: number, h: number) => Box) | null,
   *   policy: ((cur: Box) => import('./layout.js').Policy) | null,
   *   keep: ((w: number, h: number) => Box) | null,
   *   item: string | null,
   * }} Adoption */
  /** @type {Map<VfWindow, Adoption>} */
  const adopted = new Map();
  /** An application's arrangement group (see arrangeWith).
   *  @typedef {{arrange(): void, arranged(): boolean}} Group */
  /** @type {Map<import('../state/shell.js').AppId, Group>} */
  const groups = new Map();
  /** Per-window unrounded pin and the geometry the re-pin last wrote. The pin
   *  is re-read only when that geometry no longer matches. Re-reading it from
   *  snapped geometry on every resize ratchets windows down the screen. */
  let pins = new WeakMap();
  /** The frame every window's pin is read in (see setFrameBands). */
  let frame = windowFrame();

  // Signals.
  /** Layout signal (onLayout): fires after every geometry write, drag release,
   *  grow commit and layoutChanged(). Suppressed while arrange() writes. */
  const layoutListeners = new Set();
  let holding = false;
  const notifyLayout = () => {
    if (holding) return;
    for (const fn of [...layoutListeners]) fn();
  };
  /** Window set signal (onWindows): a window with a catalog item opened or
   *  closed. */
  const windowListeners = new Set();
  const notifyWindows = () => {
    for (const fn of [...windowListeners]) fn();
  };
  /** @type {Set<(before: {width: number, height: number}, after: {width: number, height: number}) => void>} */
  const rasterListeners = new Set();
  /** @type {Set<(win: HTMLElement | null) => void>} */
  const frontListeners = new Set();

  // Placement.
  /** Writes a placement and drops the pin record, so the next resize re-reads
   *  the pin. */
  const writeBox = (win, g) => {
    win.left = snapSys(g.left, win);
    win.top = snapSys(g.top, win);
    if (Number.isFinite(g.width)) win.width = g.width;
    if (Number.isFinite(g.height)) win.height = g.height;
    pins.delete(win);
  };
  /** An adopted window's `place` on the live raster, clamped, or null. */
  const placedBox = (win) => {
    const place = adopted.get(win)?.place;
    return place ? clampedBox(desktop, win, place(desktop.width, desktop.height)) : null;
  };
  const placeAdopted = (win) => {
    const g = placedBox(win);
    if (g) writeBox(win, g);
  };
  /** The resize policy for `win` at its live box `cur`. pinTo applies it. A
   *  floor applied after the write reads as a move on the next resize, and the
   *  pin drifts. */
  const policyOf = (win, cur) => {
    const declared = adopted.get(win)?.policy;
    if (declared) return declared(cur);
    return win.resizable
      ? { min: { width: KIT_MIN_WIDTH, height: KIT_MIN_HEIGHT } }
      : { size: { width: cur.width, height: cur.height } };
  };
  /** A saved pin re-expressed on the current raster, then clamped. */
  const pinnedBox = (win, pin) =>
    clampedBox(desktop, win, pinTo(pin, raster(), frame, policyOf(win, boxOf(win))));
  /** Whether `win` sits exactly at every edge `g` states. */
  const at = (win, g) => {
    const live = boxOf(win);
    return ['left', 'top', 'width', 'height'].every(
      (k) => !Number.isFinite(g[k]) || live[k] === g[k]
    );
  };

  // Front application. beforeFront listeners run before shell.setFrontApp.
  const applyActive = (win) => {
    for (const fn of [...frontListeners]) fn(win);
    shell.setFrontApp((win && adopted.get(win)?.app) || FINDER);
  };
  const onActivate = (e) => applyActive(/** @type {CustomEvent} */ (e).detail.window);
  desktop.addEventListener('vf-activate', onActivate);
  unsubs.push(() => desktop.removeEventListener('vf-activate', onActivate));
  // Start from desktop.activeWindow, which is non-null after an HMR teardown.
  applyActive(desktop.activeWindow);

  // Deactivation. A press targeting the desktop itself (its bezel) clears the
  // active window. Presses in slotted children target the child. The Finder's
  // icon field handles its own in apps/finder/icons.js.
  const onDesktopPress = (e) => {
    if (e.target === desktop) desktop.clearActive();
  };
  desktop.addEventListener('pointerdown', onDesktopPress);
  unsubs.push(() => desktop.removeEventListener('pointerdown', onDesktopPress));

  // Resize rule.
  /** Re-pins one window from the `before` raster to `after`. See
   *  onDesktopResized. */
  const repin = (win, before, after) => {
    const cur = boxOf(win);
    // A window near its `keep` box on the old raster gets that box on the new one.
    const keep = adopted.get(win)?.keep;
    if (keep && nearBox(cur, keep(before.width, before.height))) {
      writeBox(win, keep(after.width, after.height));
      return;
    }
    let rec = pins.get(win);
    // Re-read the pin if the window has no record or has moved. A resizable
    // window whose size changed is re-read too, or its far edge would jump. A
    // fixed-size window's size is owner-derived and does not count.
    const sized =
      !!rec && win.resizable && (rec.width !== cur.width || rec.height !== cur.height);
    const moved = !rec || rec.left !== cur.left || rec.top !== cur.top || sized;
    if (moved) rec = { pin: pinOf(cur, before, frame) };
    const g = pinTo(rec.pin, after, frame, policyOf(win, cur));
    win.left = snapSys(g.left, win);
    win.top = snapSys(g.top, win);
    if (win.resizable) {
      // Cap the size at the open area, floor-snapped to the lattice, so the
      // grow box stays reachable. The pin is untouched.
      const k = systemPxQuantum(win);
      const minTop = Math.ceil(TOP_RESERVE / k) * k;
      const maxW = Math.floor(after.width / k) * k;
      const maxH = Math.floor(Math.max(0, after.height - minTop) / k) * k;
      win.width = Math.min(snapSys(g.width, win), maxW);
      win.height = Math.min(snapSys(g.height, win), maxH);
    }
    pins.set(win, {
      pin: rec.pin,
      left: win.left,
      top: win.top,
      width: win.width,
      height: win.height,
    });
  };

  // Gestures. A title-bar drag fires no event, so pointerup notifies layout a
  // task later, after the kit has updated. A grow ends with vf-resize
  // detail.commit.
  const onRelease = () => {
    setTimeout(notifyLayout, 0);
  };
  const onGrow = (e) => {
    if (/** @type {CustomEvent} */ (e).detail?.commit) notifyLayout();
  };
  desktop.addEventListener('vf-resize', onGrow);
  desktop.addEventListener('pointerup', onRelease);
  desktop.addEventListener('pointercancel', onRelease);
  unsubs.push(() => {
    desktop.removeEventListener('vf-resize', onGrow);
    desktop.removeEventListener('pointerup', onRelease);
    desktop.removeEventListener('pointercancel', onRelease);
  });

  return {
    /** Adopts a window. It must already be a slotted child of the desktop,
     *  since the clamp reads its lattice. If the window is already active, the
     *  front application is re-read.
     *  `app` is the application shown while the window is active.
     *  `place` maps a raster `(desktopW, desktopH)` to its box. adopt() and
     *  arrange() apply it. Without one the owner places the window.
     *  `pin` is a saved pin to open at instead (fromPin).
     *  `policy` is its resize policy (layout.js pinTo). The default is policyOf.
     *  `keep` is a box held across raster resizes while the window is near it.
     *  `item` is the catalog item it shows (isOpen, onWindows).
     *  @param {VfWindow} win
     *  @param {{
     *    app?: import('../state/shell.js').AppId,
     *    place?: ((w: number, h: number) => Box) | null,
     *    pin?: import('./layout.js').Pin | null,
     *    policy?: ((cur: Box) => import('./layout.js').Policy) | null,
     *    keep?: ((w: number, h: number) => Box) | null,
     *    item?: string | null,
     *  }} [opts] */
    adopt(
      win,
      {
        app = FINDER,
        place = null,
        pin = null,
        policy = null,
        keep = null,
        item = null,
      } = {}
    ) {
      adopted.set(win, { app, place, policy, keep, item });
      if (desktop.activeWindow === win) applyActive(win);
      if (pin) writeBox(win, pinnedBox(win, pin));
      else placeAdopted(win);
      if (item != null) notifyWindows();
      notifyLayout();
    },
    /** Drops a window from the manager. The owner removes the node. */
    release(win) {
      const a = adopted.get(win);
      if (!a) return;
      adopted.delete(win);
      pins.delete(win);
      if (a.item != null) notifyWindows();
      notifyLayout();
    },
    /** Writes a box for a gesture the owner runs itself (a zoom, a restore, its
     *  group's arrange), then notifies layout. See writeBox.
     *  @param {VfWindow} win
     *  @param {{left: number, top: number, width?: number, height?: number}} box */
    write(win, box) {
      writeBox(win, box);
      notifyLayout();
    },
    /** clampedBox for `win`: a placement's target, not written.
     *  @param {VfWindow} win
     *  @param {{left?: number, top?: number, width?: number, height?: number}} box */
    clamped(win, box) {
      return clampedBox(desktop, win, box);
    },
    /** The window's nine-slice pin on the current raster. An owner saves this
     *  to reopen the window on a later raster (fromPin).
     *  @param {VfWindow} win */
    pinOf(win) {
      return pinOf(boxOf(win), raster(), frame);
    },
    /** A pin re-expressed on the live raster with `win`'s resize policy, then
     *  clamped.
     *  @param {VfWindow} win
     *  @param {import('./layout.js').Pin} pin */
    fromPin(win, pin) {
      return pinnedBox(win, pin);
    },
    /** An adopted window's `place` on the live raster, clamped, or null.
     *  @param {VfWindow} win */
    placed(win) {
      return placedBox(win);
    },
    /** Whether a window showing `item` is adopted.
     *  @param {string} item */
    isOpen(item) {
      for (const a of adopted.values()) if (a.item === item) return true;
      return false;
    },
    /** Registers an application's arrangement group, for windows adopted
     *  without a `place`. Returns the unregister function.
     *  @param {import('../state/shell.js').AppId} app
     *  @param {Group} group */
    arrangeWith(app, group) {
      groups.set(app, group);
      notifyLayout();
      return () => {
        if (groups.get(app) === group) groups.delete(app);
        notifyLayout();
      };
    },
    /** View → Arrange Windows. Runs every group's arrange, then re-applies
     *  every `place`. Positions only, with no activation or restacking. */
    arrange() {
      holding = true;
      try {
        for (const group of groups.values()) group.arrange();
        for (const win of adopted.keys()) placeAdopted(win);
      } finally {
        holding = false;
      }
      notifyLayout();
    },
    /** Whether every group reports arranged and every visible window with a
     *  `place` sits at its placedBox. */
    arranged() {
      for (const group of groups.values()) if (!group.arranged()) return false;
      for (const win of adopted.keys()) {
        const g = placedBox(win);
        if (g && !win.hidden && !at(win, g)) return false;
      }
      return true;
    },
    /** Widens the shared window frame's left, top and right bands. Call it at an
     *  application's init. A saved pin is valid only in the frame it was read in.
     *  @param {{left?: number, top?: number, right?: number}} bands */
    setFrameBands(bands) {
      frame = windowFrame(bands);
      pins = new WeakMap();
    },
    /** Notifies layout of a change the owner made itself, such as a re-fit
     *  size, a palette shown or hidden, or a zoom. */
    layoutChanged() {
      notifyLayout();
    },
    /** Subscribes to the layout signal. Returns the unsubscribe. */
    onLayout(fn) {
      layoutListeners.add(fn);
      return () => {
        layoutListeners.delete(fn);
      };
    },
    /** Subscribes to windows with a catalog item opening or closing. Returns
     *  the unsubscribe. */
    onWindows(fn) {
      windowListeners.add(fn);
      return () => {
        windowListeners.delete(fn);
      };
    },
    /** Subscribes to raster resizes. `fn(before, after)` runs after every
     *  window has re-pinned. Returns the unsubscribe.
     *  @param {(before: {width: number, height: number}, after: {width: number, height: number}) => void} fn */
    onRaster(fn) {
      rasterListeners.add(fn);
      return () => {
        rasterListeners.delete(fn);
      };
    },
    /** Subscribes to activations. `fn(win)` runs with the newly active window,
     *  or null, before shell.frontApp changes, so an owner can update its own
     *  state while its palettes are still hidden. Returns the unsubscribe.
     *  @param {(win: HTMLElement | null) => void} fn */
    beforeFront(fn) {
      frontListeners.add(fn);
      return () => {
        frontListeners.delete(fn);
      };
    },
    /** Re-pins every adopted window after the raster changes size, then runs
     *  the onRaster listeners. main.js calls it after each re-fit, not debounced.
     *  There is no position clamp, so a window may hang off a shrunk raster. A
     *  clamp would rewrite the pin and windows would drift on grow-back. */
    onDesktopResized(before) {
      const after = raster();
      if (before.width === after.width && before.height === after.height) return;
      for (const win of adopted.keys()) repin(win, before, after);
      for (const fn of [...rasterListeners]) fn(before, after);
      notifyLayout();
    },
    /** Clears the active window, bringing the Finder forward. */
    deactivate() {
      desktop.clearActive();
    },
    dispose() {
      for (const u of unsubs) u();
      layoutListeners.clear();
      windowListeners.clear();
      rasterListeners.clear();
      frontListeners.clear();
      groups.clear();
      // main.js disposes the applications first, so their windows are released.
      adopted.clear();
    },
  };
}
