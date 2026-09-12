// Sprite Editor windows: four utility windoids and one document window per open
// document.
//
// - The windoids come from windows.html and are appended hidden. They are shown
//   while the Sprite Editor is front, and the 3D Sprite Atlas also needs
//   prefs.showRing. Hiding keeps them mounted, so canvas identity survives.
// - Document windows are reconciled from the workspace. A new context clones
//   #tpl-document-window. A closed context removes its window.
// - Placement comes from layout.js on the live raster at init, on each open and
//   on Arrange Windows. Nothing is restored from a prior session.

import { VfWindow } from 'vintage-frames';
import markup from './windows.html?raw';
import { shell, SPRITE_EDITOR } from '../../state/shell.js';
import { prefs } from '../../state/prefs.js';
import { ring } from '../../state/ring.js';
import { workspace, followActive } from '../../state/workspace.js';
import { cascadeFrom, cascadeSlot } from '../../shell/layout.js';
import { cloneWindow, parseWindows } from '../../shell/windows.js';
import {
  FRAME_BANDS,
  initialPlacement,
  ringHeightFor,
  RING_MIN_WIDTH,
  spriteHeightFor,
  SPRITE_WIDTH,
  STAGE_MIN_HEIGHT,
  STAGE_MIN_WIDTH,
  zoomedBox,
} from './layout.js';

/** Windoid ids (markup id `win-<id>`). `ring` is the toggleable 3D Sprite Atlas. */
const WINDOIDS = ['tools', 'sprite', 'stage', 'ring'];

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 * @param {ReturnType<typeof import('../../shell/windows.js').initWindows>} windows
 * @param {{onDocumentClose(key: string): void}} opts
 *   onDocumentClose: the dirty-checking close for a context key.
 */
export function initEditorWindows(desktop, windows, { onDocumentClose }) {
  /** @type {(() => void)[]} */
  const unsubs = [];
  const host = parseWindows(markup);
  const tpl = /** @type {HTMLTemplateElement} */ (
    host.querySelector('#tpl-document-window')
  );

  // Widen the frame's top and right bands for the rail before any window re-pins.
  windows.setFrameBands(FRAME_BANDS);

  // Utility windoids
  /** @type {Record<string, VfWindow>} */
  const byId = {};
  const authored = /** @type {VfWindow[]} */ ([
    ...host.querySelectorAll(':scope > vf-window'),
  ]);
  for (const win of authored) byId[win.id.slice('win-'.length)] = win;
  for (const id of WINDOIDS) {
    // Hidden from the first frame. syncUtility shows them.
    byId[id].hidden = true;
    // closable defaults to true and markup can't set a boolean attribute false.
    // The 3D Sprite Atlas keeps its close box.
    if (id !== 'ring') byId[id].closable = false;
  }
  // The 3D View's grow-box floor. The ring's size rect is set in fitRing.
  byId.stage.minWidth = STAGE_MIN_WIDTH;
  byId.stage.minHeight = STAGE_MIN_HEIGHT;
  // Markup order is stacking order. The Tools palette is last, so it is on top.
  desktop.append(...authored);
  // Resize policies for the re-pin. Windoids without one keep their live size.
  // Floors belong in the policy: a floor applied after the re-pin reads as a
  // touch and makes the pin drift.
  /** @type {Record<string, (cur: {width: number, height: number}) => import('../../shell/layout.js').Policy>} */
  const policies = {
    stage: () => ({ min: { width: STAGE_MIN_WIDTH, height: STAGE_MIN_HEIGHT } }),
    ring: (cur) => ({ size: { height: cur.height }, min: { width: RING_MIN_WIDTH } }),
  };
  for (const id of WINDOIDS) {
    windows.adopt(byId[id], { app: SPRITE_EDITOR, policy: policies[id] ?? null });
  }

  // The strip's settings default to the active document's. A window being opened
  // passes its own document's, since the open activates that document.
  const ringShown = () => prefs.get().showRing;
  /** @param {{views: number, size: number}} [r]  the strip's settings */
  const smartLayout = (r = ring.get()) =>
    initialPlacement(desktop.width, desktop.height, {
      ringViews: r.views,
      ringSize: r.size,
      ringShown: ringShown(),
    });

  // Full Sprite View: fixed size. The height fits the 3×2 tile grid at the active
  // document's tile ratio, or square with no document open.
  const spriteRatio = () => {
    const s = workspace.active()?.doc.get();
    return s && s.tileW > 0 && s.tileH > 0 ? s.tileH / s.tileW : undefined;
  };
  const fitSprite = () => {
    byId.sprite.width = SPRITE_WIDTH;
    byId.sprite.height = spriteHeightFor(SPRITE_WIDTH, spriteRatio());
  };
  // 3D Sprite Atlas: the height is ringHeightFor(size), locked on the grow box by
  // min-height = max-height, so only the width resizes. The size rect bounds only
  // the drag, so floorRingWidth covers programmatic writes. fitRing keeps the
  // top-left, so a larger tile grows the window downward.
  const floorRingWidth = () => {
    if ((byId.ring.width ?? 0) < RING_MIN_WIDTH) byId.ring.width = RING_MIN_WIDTH;
  };
  /** Sets the grow box's size rect for a strip of height h. */
  const declareRingRect = (h) => {
    byId.ring.minWidth = RING_MIN_WIDTH;
    byId.ring.minHeight = h;
    byId.ring.maxHeight = h;
  };
  const fitRing = () => {
    const h = ringHeightFor(ring.get().size);
    byId.ring.height = h;
    declareRingRect(h);
    floorRingWidth();
  };

  // windoidBox computes a windoid's target box without writing it. placeWindoid
  // writes it, and arranged() compares windows against the same boxes.
  const windoidBox = (id, smart) => {
    const win = byId[id];
    const sm = smart[id];
    const g = { left: sm.left, top: sm.top, width: win.width, height: win.height };
    if ('width' in sm && win.resizable) {
      g.width = sm.width;
      g.height = sm.height;
    }
    if (id === 'stage') {
      g.width = Math.max(g.width ?? 0, STAGE_MIN_WIDTH);
      g.height = Math.max(g.height ?? 0, STAGE_MIN_HEIGHT);
    }
    if (id === 'sprite') {
      g.width = SPRITE_WIDTH;
      g.height = spriteHeightFor(SPRITE_WIDTH, spriteRatio());
    }
    if (id === 'ring') {
      g.height = ringHeightFor(ring.get().size);
      g.width = Math.max(g.width ?? 0, RING_MIN_WIDTH);
    }
    return windows.clamped(win, g);
  };
  const placeWindoid = (id, smart) => {
    windows.write(byId[id], windoidBox(id, smart));
    if (id === 'ring') declareRingRect(ringHeightFor(ring.get().size));
  };
  const placeUtility = () => {
    const smart = smartLayout();
    for (const id of WINDOIDS) placeWindoid(id, smart);
  };
  // A document window's box at cascade slot `slot` of the current doc box.
  const docBox = (win, smart, slot) => {
    const d = smart.doc;
    return windows.clamped(win, {
      ...cascadeSlot(d, slot),
      width: d.width,
      height: d.height,
    });
  };
  const placeDoc = (win, slot) => windows.write(win, docBox(win, smartLayout(), slot));
  placeUtility();

  // A document switch, tile resize or load can change the tile ratio. Re-fit the
  // Sprite View's height, writing only when it changes.
  unsubs.push(
    followActive(workspace, (ctx) => {
      if (!ctx) return;
      const refit = () => {
        if ((byId.sprite.height ?? 0) !== spriteHeightFor(SPRITE_WIDTH, spriteRatio())) {
          fitSprite();
          windows.layoutChanged();
        }
      };
      const un = ctx.doc.subscribe(refit);
      refit();
      return un;
    })
  );

  // A tile size change moves the ring's height. A hidden strip is re-placed, so it
  // shows docked at the new height.
  unsubs.push(
    ring.subscribe(() => {
      if ((byId.ring.height ?? 0) !== ringHeightFor(ring.get().size)) {
        if (byId.ring.hidden) placeWindoid('ring', smartLayout());
        else fitRing();
      }
      // The placement's inputs changed even if the window did not.
      windows.layoutChanged();
    })
  );

  // Windoid visibility: shown while the Sprite Editor is front. The 3D Sprite
  // Atlas also needs prefs.showRing, and comes to the front when it appears.
  let ringWasShown = false;
  const syncUtility = () => {
    const { appActive } = shell.get();
    for (const id of WINDOIDS) {
      const shown = appActive && (id !== 'ring' || ringShown());
      byId[id].hidden = !shown;
    }
    const ringNow = !byId.ring.hidden;
    if (ringNow && !ringWasShown) desktop.bringToFront(byId.ring);
    ringWasShown = ringNow;
    // Visibility changes arranged(), and the strip's changes the doc box.
    windows.layoutChanged();
  };
  unsubs.push(shell.subscribe(syncUtility), prefs.subscribe(syncUtility));
  syncUtility();

  // Document windows
  /** @type {Map<string, VfWindow>} ctx key -> window */
  const byKey = new Map();
  const keyOf = (win) => {
    for (const [key, w] of byKey) if (w === win) return key;
    return null;
  };
  // Mirror the active window into workspace.activeKey: a document window's key,
  // or null. beforeFront runs before the front application changes, so a hidden
  // strip sees a document switch first. Wired before the reconciler, whose opens
  // activate.
  unsubs.push(windows.beforeFront((win) => workspace.setActive(win ? keyOf(win) : null)));

  function createDocWindow(ctx) {
    const win = cloneWindow(tpl);
    win.id = `win-doc-${ctx.key}`;
    win.heading = ctx.name;
    // The doc box for the current raster and this document's ring settings,
    // cascaded into the first free slot.
    const d = smartLayout(ctx.ring.get()).doc;
    const occupied = [...byKey.values()].map((w) => ({
      left: w.left ?? 0,
      top: w.top ?? 0,
    }));
    const g = { ...cascadeFrom(d, occupied), width: d.width, height: d.height };
    win.left = g.left;
    win.top = g.top;
    win.width = g.width;
    win.height = g.height;
    // Set ctx before the append: the components wire their document in
    // connectedCallback.
    /** @type {any} */ (win.querySelector('sm-editor')).ctx = ctx;
    /** @type {any} */ (win.querySelector('sm-status-line')).ctx = ctx;
    desktop.append(win); // the kit stacks only direct vf-window children
    byKey.set(ctx.key, win);
    windows.adopt(win, { app: SPRITE_EDITOR });
    // Clamp after the append: clamped() reads the lattice from a connected element.
    windows.write(win, windows.clamped(win, g));
    // Appending after the windoids leaves DOM order out of step with z-order.
    // bringToFront syncs it and activates the window, which brings the Sprite
    // Editor forward.
    desktop.bringToFront(win);
  }

  const syncDocs = () => {
    const contexts = workspace.get().contexts;
    const live = new Set(contexts.map((c) => c.key));
    for (const [key, win] of byKey) {
      if (!live.has(key)) {
        windows.release(win);
        win.remove(); // the kit updates the active window
        byKey.delete(key);
      }
    }
    for (const ctx of contexts) {
      if (!byKey.has(ctx.key)) createDocWindow(ctx);
      const win = byKey.get(ctx.key);
      if (win.heading !== ctx.name) win.heading = ctx.name;
    }
    windows.layoutChanged();
  };
  unsubs.push(workspace.subscribe(syncDocs));
  syncDocs(); // HMR: rebuild windows for contexts that survived the reload

  // Close boxes. Dialog closes and other applications' windows are ignored.
  const onClose = (e) => {
    const t = e.target;
    if (!(t instanceof VfWindow)) return;
    if (t === byId.ring) {
      prefs.setShowRing(false);
      return;
    }
    const key = keyOf(t);
    if (key != null) onDocumentClose(key);
  };
  desktop.addEventListener('vf-close', onClose);

  // Zoom box on document windows: toggles between zoomedBox and the recorded
  // pre-zoom size, keeping the top-left. With nothing recorded it restores the doc
  // box size. The state test survives a raster resize because the zoomed far edges
  // are struts of the nine-slice pin. A size write fires no vf-resize. The manager
  // reads it as a touch on the next raster resize.
  /** Pre-zoom sizes by window. */
  const zoomMemory = new WeakMap();
  /** The zoomed box for `win` at its current top-left. Used by the toggle and
   *  by arranged(). */
  const zoomBoxFor = (win) =>
    zoomedBox(
      desktop.width,
      desktop.height,
      { left: win.left ?? 0, top: win.top ?? 0 },
      { ringShown: ringShown(), ringSize: ring.get().size }
    );
  /** The zoom toggle, shared by the zoom box and ⌘J (zoomActive). */
  const zoomToggle = (win) => {
    const z = zoomBoxFor(win);
    if (win.width === z.width && win.height === z.height) {
      const back = zoomMemory.get(win) ?? smartLayout().doc;
      zoomMemory.delete(win);
      win.width = back.width;
      win.height = back.height;
    } else {
      zoomMemory.set(win, { width: win.width, height: win.height });
      win.width = z.width;
      win.height = z.height;
    }
    windows.layoutChanged();
  };
  const onZoom = (e) => {
    const win = e.target;
    if (win instanceof VfWindow && keyOf(win) != null) zoomToggle(win);
  };
  desktop.addEventListener('vf-zoom', onZoom);

  // Arrange Windows group.
  // - arrange() re-runs the placement on the current raster: the windoids,
  //   hidden ones included, and every document window cascaded in stacking
  //   order. Nothing activates or restacks.
  // - arranged() checks each visible window against the boxes arrange() writes.
  //   It ignores the ring strip's width. Document windows may fill the first n
  //   cascade slots in any order, so a raise alone doesn't unarrange them. The
  //   active document window may be zoomed from its slot, so ⌘J keeps toggling
  //   its zoom.
  /** The document windows in stacking order, bottom-most first. */
  const docWindows = () =>
    [...desktop.querySelectorAll(':scope > vf-window')]
      .map((el) => /** @type {VfWindow} */ (el))
      .filter((win) => keyOf(win) != null);
  /** Whether `win` matches every finite key of `g`, except those in `skip`. */
  const at = (win, g, skip = []) =>
    ['left', 'top', 'width', 'height'].every(
      (k) => skip.includes(k) || !Number.isFinite(g[k]) || (win[k] ?? 0) === g[k]
    );
  unsubs.push(
    windows.arrangeWith(SPRITE_EDITOR, {
      arrange() {
        placeUtility();
        let slot = 0;
        for (const win of docWindows()) placeDoc(win, slot++);
      },
      arranged() {
        const smart = smartLayout();
        for (const id of WINDOIDS) {
          const win = byId[id];
          if (win.hidden) continue;
          if (!at(win, windoidBox(id, smart), id === 'ring' ? ['width'] : [])) {
            return false;
          }
        }
        // Each visible document window claims a distinct slot among the first n,
        // where n counts hidden windows too.
        const docs = docWindows();
        const activeKey = workspace.get().activeKey;
        const activeWin = activeKey != null ? (byKey.get(activeKey) ?? null) : null;
        /** @type {({left: number, top: number, width?: number, height?: number} | null)[]} */
        const pool = docs.map((win, i) => docBox(win, smart, i));
        for (const win of docs) {
          if (win.hidden) continue;
          const z = win === activeWin ? zoomBoxFor(win) : null;
          const i = pool.findIndex(
            (g) =>
              g != null &&
              win.left === g.left &&
              win.top === g.top &&
              ((win.width === g.width && win.height === g.height) ||
                (z != null && win.width === z.width && win.height === z.height))
          );
          if (i < 0) return false;
          pool[i] = null;
        }
        return true;
      },
    })
  );

  return {
    /** Brings a document window to the front, which also activates the Sprite
     *  Editor. */
    showDocument(key) {
      const win = byKey.get(key);
      if (win) desktop.bringToFront(win);
    },
    /** ⌘J once everything is arranged: toggles zoom on the active document
     *  window, if any. */
    zoomActive() {
      const key = workspace.get().activeKey;
      const win = key != null ? byKey.get(key) : null;
      if (win) zoomToggle(win);
    },
    dispose() {
      for (const u of unsubs) u();
      desktop.removeEventListener('vf-close', onClose);
      desktop.removeEventListener('vf-zoom', onZoom);
      // HMR: the next init rebuilds every window, so release and remove them all.
      for (const win of byKey.values()) {
        windows.release(win);
        win.remove();
      }
      byKey.clear();
      for (const win of authored) {
        windows.release(win);
        win.remove();
      }
    },
  };
}
