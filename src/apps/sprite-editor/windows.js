// Sprite Editor windows: five utility windoids and one document window per open
// document, over the kit's window manager (vintage-frames/shell).
//
// - The windoids are copies of windows.html's and the Sprite Editor's palettes:
//   shown while it is front, the 3D Sprite Atlas also while its pref holds.
//   Hiding keeps them mounted, so canvas identity survives. Each is adopted
//   with an item of its own (windoid:<id>), so the session saves its box and
//   the next load opens it there; without one it takes its placement.
// - Document windows are reconciled from the workspace. A new context gets a
//   copy of the document window, adopted with its document's catalog item, at
//   this session's box for it, else the saved one, else the cascade. Its close
//   box runs the dirty-checked close. A closed context's window closes into
//   the document's icon. showDocument's `from` grows a window just opened out
//   of its icon. The window manager runs the zoom box (zoomedBox).
// - Placement comes from layout.js on the live raster at init, on each open and
//   on Arrange Windows.

import { cascadeFrom, cascadeSlot, nearBox } from 'vintage-frames/shell';
import { prefs } from '../../state/prefs.js';
import { ring, RING_PAPERS } from '../../state/ring.js';
import { workspace, followActive } from '../../state/workspace.js';
import {
  FRAME_BANDS,
  initialPlacement,
  paletteFit,
  PALETTE_MIN_HEIGHT,
  PALETTE_MIN_WIDTH,
  paletteStatus,
  ringHeightFor,
  RING_MIN_WIDTH,
  spriteHeightFor,
  SPRITE_WIDTH,
  STAGE_MIN_HEIGHT,
  STAGE_MIN_WIDTH,
  zoomedBox,
} from './layout.js';

/** @typedef {import('vintage-frames').VfWindow} VfWindow */

/** Windoid ids (their windows.html data-window names), in stacking order, the
 *  Tools palette on top. */
const WINDOIDS = ['sprite', 'stage', 'ring', 'palette', 'tools'];
/** The axes of a windoid's size that are the user's, which arranged() ignores. */
const USER_AXES = { ring: ['width'], palette: ['width', 'height'] };

/** A box from a window area's raster: its right and bottom edges. */
const rasterOf = (area) => ({ w: area.left + area.width, h: area.top + area.height });

/**
 * @param {import('vintage-frames/shell').AppContext} ctx
 * @param {string} app  the Sprite Editor's id
 * @param {{onDocumentClose(key: string): Promise<void>}} opts
 *   onDocumentClose: the dirty-checking close for a context key, settled once
 *   it has closed or been cancelled.
 */
export function initEditorWindows(ctx, app, { onDocumentClose }) {
  const { desktop, windows } = ctx;
  const savedPin = (item) => ctx.state?.pin(item) ?? null;

  // Widen the frame's bands for the docked windoids before any window re-pins.
  windows.setFrameBands(FRAME_BANDS);

  // Utility windoids
  /** @type {Record<string, VfWindow>} */
  const byId = {};
  for (const id of WINDOIDS) {
    byId[id] = ctx.window(id);
    // Hidden from the first frame. The window manager shows them.
    byId[id].hidden = true;
  }
  // The 3D View's and the Color Palette's grow-box floors. The ring's size rect
  // is set in fitRing.
  byId.stage.minWidth = STAGE_MIN_WIDTH;
  byId.stage.minHeight = STAGE_MIN_HEIGHT;
  byId.palette.minWidth = PALETTE_MIN_WIDTH;
  byId.palette.minHeight = PALETTE_MIN_HEIGHT;
  desktop.append(...WINDOIDS.map((id) => byId[id]));
  // Resize policies for the re-pin. Windoids without one keep their live size.
  // Floors belong in the policy: a floor applied after the re-pin reads as a
  // touch and makes the pin drift.
  /** @type {Record<string, (cur: {width: number, height: number}) => import('vintage-frames/shell').Policy>} */
  const policies = {
    stage: () => ({ min: { width: STAGE_MIN_WIDTH, height: STAGE_MIN_HEIGHT } }),
    ring: (cur) => ({ size: { height: cur.height }, min: { width: RING_MIN_WIDTH } }),
    palette: (cur) => ({ size: { width: cur.width, height: cur.height } }),
  };
  const paletteView =
    /** @type {import('../../components/sm-palette-view.js').SmPaletteView} */ (
      byId.palette.querySelector('sm-palette-view')
    );
  // Boxes held across a browser resize while the windoid sits at them. The 3D
  // View follows its placement, so it stays square and refits a short raster.
  // The Color Palette's rows refit the new raster's height.
  /** @type {Record<string, (area: import('vintage-frames/shell').Box) => import('vintage-frames/shell').Box>} */
  const keeps = {
    stage: (area) => {
      const { w, h } = rasterOf(area);
      return initialPlacement(w, h).stage;
    },
    palette: (area) => {
      const { w, h } = rasterOf(area);
      return initialPlacement(w, h, { paletteCount: paletteView.count }).palette;
    },
  };
  /** @type {Record<string, import('vintage-frames/shell').Pin | null>} */
  const windoidPins = {};
  for (const id of WINDOIDS) windoidPins[id] = savedPin(`windoid:${id}`);
  // Full Sprite View: fixed size. The height fits the tile row at the active
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
  // top-left, so a larger tile grows the window downward, except that the clamp
  // slides a strip docked at the bottom up instead of letting it overhang.
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
    const win = byId.ring;
    const h = ringHeightFor(ring.get().size);
    win.top = windows.clamped(win, {
      left: win.left ?? 0,
      top: win.top ?? 0,
      width: win.width ?? 0,
      height: h,
    }).top;
    win.height = h;
    declareRingRect(h);
    floorRingWidth();
  };
  // The strip's body is its paper setting, under the tiles and past the last.
  const paintRing = () => {
    byId.ring.pattern = RING_PAPERS[ring.get().paper];
  };
  paintRing();

  // The Color Palette's size is the user's, and its policy holds the live one
  // across a resize, so its saved size is read back from the pin before the
  // adopt, snapped to whole cells.
  if (windoidPins.palette) {
    const box = windows.fromPin(byId.palette, windoidPins.palette, {
      min: { width: PALETTE_MIN_WIDTH, height: PALETTE_MIN_HEIGHT },
    });
    const fit = paletteFit(box.width, box.height);
    byId.palette.width = fit.width;
    byId.palette.height = fit.height;
  }
  // The Full Sprite View's and the 3D Sprite Atlas's sizes are derived, and
  // their policies hold the live one, so both are written before the adopt: a
  // policy read from an undeclared size pins a saved box to its far edge.
  fitSprite();
  fitRing();
  const ringShown = () => prefs.get().showRing;
  for (const id of WINDOIDS) {
    windows.adopt(byId[id], {
      app,
      item: `windoid:${id}`,
      palette: id === 'ring' ? ringShown : true,
      policy: policies[id] ?? null,
      keep: keeps[id] ?? null,
      pin: windoidPins[id],
      // The 3D Sprite Atlas's close box clears its pref. It is never closed.
      close: id === 'ring' ? () => prefs.setShowRing(false) : null,
    });
  }
  // Color Palette: a grow snaps back on release to the whole cells it shows. The
  // window hears the commit before the desktop does, so the shell's layout
  // signal reads the snapped size.
  ctx.on(byId.palette, 'vf-resize', (e) => {
    if (!(/** @type {CustomEvent} */ (e).detail?.commit)) return;
    const win = byId.palette;
    const fit = paletteFit(win.width ?? 0, win.height ?? 0);
    win.width = fit.width;
    win.height = fit.height;
  });
  // The status label counts the swatches, and empties below the width that shows
  // the count whole. An empty label stays slotted, so the kit keeps the strip.
  // Arrange and a browser resize write the size without a vf-resize, so the
  // window's box is observed.
  const paletteLabel = /** @type {HTMLElement} */ (
    byId.palette.querySelector('[slot="status"]')
  );
  const fitPaletteLabel = () => {
    paletteLabel.textContent = paletteStatus(byId.palette.width ?? 0, paletteView.count);
  };
  ctx.on(byId.palette, 'sm-palette-count', fitPaletteLabel);
  const paletteObserver = new ResizeObserver(fitPaletteLabel);
  paletteObserver.observe(byId.palette);
  ctx.onDispose(() => paletteObserver.disconnect());
  fitPaletteLabel();

  // The strip's settings default to the active document's. A window being opened
  // passes its own document's, since the open activates that document.
  /** @param {{views: number, size: number}} [r]  the strip's settings
   *  @param {number} [paletteCount]  the Color Palette's swatches */
  const smartLayout = (r = ring.get(), paletteCount = paletteView.count) =>
    initialPlacement(desktop.width, desktop.height, {
      ringViews: r.views,
      ringSize: r.size,
      ringShown: ringShown(),
      paletteCount,
    });

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
  // A windoid with a saved box keeps it; the rest take their placement. The 3D
  // Sprite Atlas's height is derived either way, and its grow box with it.
  const openingLayout = smartLayout();
  for (const id of WINDOIDS) {
    if (!windoidPins[id]) placeWindoid(id, openingLayout);
  }

  // The Color Palette's placed rows follow the active document's swatch count. A
  // palette near its placed box for the last count moves to the new count's.
  let paletteCount = paletteView.count;
  ctx.on(byId.palette, 'sm-palette-count', () => {
    const was = paletteCount;
    paletteCount = paletteView.count;
    const win = byId.palette;
    const cur = {
      left: win.left ?? 0,
      top: win.top ?? 0,
      width: win.width ?? 0,
      height: win.height ?? 0,
    };
    const placed = windoidBox('palette', smartLayout(ring.get(), was));
    const box = { ...placed, width: placed.width ?? 0, height: placed.height ?? 0 };
    if (nearBox(cur, box)) {
      placeWindoid('palette', smartLayout());
    }
  });

  // A document switch, tile resize or load can change the tile ratio. Re-fit the
  // Sprite View's height, writing only when it changes.
  ctx.onDispose(
    followActive(workspace, (active) => {
      if (!active) return;
      const refit = () => {
        if ((byId.sprite.height ?? 0) !== spriteHeightFor(SPRITE_WIDTH, spriteRatio())) {
          fitSprite();
          windows.layoutChanged();
        }
      };
      const un = active.doc.subscribe(refit);
      refit();
      return un;
    })
  );

  // A tile size change moves the ring's height. A hidden strip is re-placed, so it
  // shows docked at the new height.
  ctx.onDispose(
    ring.subscribe(() => {
      paintRing();
      if ((byId.ring.height ?? 0) !== ringHeightFor(ring.get().size)) {
        if (byId.ring.hidden) placeWindoid('ring', smartLayout());
        else fitRing();
      }
      // The placement's inputs changed even if the window did not.
      windows.layoutChanged();
    })
  );

  // The 3D Sprite Atlas shows and hides with its pref, which also moves the doc
  // box, so the layout's inputs change either way.
  ctx.onDispose(
    prefs.subscribe(() => {
      windows.palettesChanged();
      windows.layoutChanged();
    })
  );

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
  ctx.onDispose(
    windows.beforeFront((win) => workspace.setActive(win ? keyOf(win) : null))
  );

  /** A document window's zoomed box: its top-left kept, on the window area.
   *  @param {import('vintage-frames/shell').Box} area
   *  @param {{left: number, top: number}} pos */
  const docZoom = (area, pos) => {
    const { w, h } = rasterOf(area);
    return zoomedBox(w, h, pos, { ringShown: ringShown(), ringSize: ring.get().size });
  };

  /** @param {import('../../state/workspace.js').DocContext} doc */
  function createDocWindow(doc) {
    const win = ctx.window('document');
    win.id = `win-doc-${doc.key}`;
    win.heading = doc.name;
    // The doc box for the current raster and this document's ring settings,
    // cascaded into the first free slot.
    const d = smartLayout(doc.ring.get()).doc;
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
    /** @type {any} */ (win.querySelector('sm-editor')).ctx = doc;
    /** @type {any} */ (win.querySelector('sm-status-line')).ctx = doc;
    desktop.append(win); // the kit stacks only direct vf-window children
    byKey.set(doc.key, win);
    // This session's box, else the saved one, else the cascade. adopt() writes
    // a pin itself.
    const item = doc.fileId;
    const pin = item ? (windows.rememberedPin(item) ?? savedPin(item)) : null;
    windows.adopt(win, {
      app,
      item,
      pin,
      zoom: docZoom,
      close: async (w) => {
        const key = keyOf(w);
        if (key != null) await onDocumentClose(key);
      },
    });
    // Clamp after the append: clamped() reads the lattice from a connected element.
    if (!pin) windows.write(win, windows.clamped(win, g));
    // Appending after the windoids leaves DOM order out of step with z-order.
    // bringToFront syncs it and activates the window, which brings the Sprite
    // Editor forward.
    desktop.bringToFront(win);
  }

  const syncDocs = () => {
    const contexts = workspace.get().contexts;
    const live = new Set(contexts.map((c) => c.key));
    // A context goes only by the user's close or Quit, so its window closes
    // into the document's icon. An untitled document has none and goes at once.
    for (const [key, win] of byKey) {
      if (live.has(key)) continue;
      byKey.delete(key);
      void windows.close(win);
    }
    for (const doc of contexts) {
      if (!byKey.has(doc.key)) createDocWindow(doc);
      const win = /** @type {VfWindow} */ (byKey.get(doc.key));
      if (win.heading !== doc.name) win.heading = doc.name;
      // A first save gives the window its item; a removed item takes it away.
      if (windows.itemOf(win) !== doc.fileId) windows.setItem(win, doc.fileId);
    }
    windows.layoutChanged();
  };
  ctx.onDispose(workspace.subscribe(syncDocs));
  syncDocs(); // HMR: rebuild windows for contexts that survived the reload

  // Arrange Windows group.
  // - arrange() re-runs the placement on the current raster: the windoids,
  //   hidden ones included, and every document window cascaded in stacking
  //   order. Nothing activates or restacks.
  // - arranged() checks each visible window against the boxes arrange() writes.
  //   It ignores the ring strip's width and the Color Palette's size. Document
  //   windows may fill the first n cascade slots in any order, so a raise alone
  //   doesn't unarrange them. The active document window may be zoomed from its
  //   slot, so ⌘J keeps toggling its zoom.
  /** The document windows in stacking order, bottom-most first. */
  const docWindows = () => windows.windowsOf(app).filter((win) => keyOf(win) != null);
  /** Whether `win` matches every finite key of `g`, except those in `skip`. */
  const at = (win, g, skip = []) =>
    ['left', 'top', 'width', 'height'].every(
      (k) => skip.includes(k) || !Number.isFinite(g[k]) || (win[k] ?? 0) === g[k]
    );
  ctx.onDispose(
    windows.arrangeWith(app, {
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
          if (!at(win, windoidBox(id, smart), USER_AXES[id])) return false;
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
          const z =
            win === activeWin
              ? windows.clamped(
                  win,
                  docZoom(windows.area, { left: win.left ?? 0, top: win.top ?? 0 })
                )
              : null;
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
     *  Editor. `from` grows a window made this task out of that box; a window
     *  already on screen is only raised.
     *  @param {string} key
     *  @param {{from?: import('vintage-frames').VfViewportBox | null}} [opts] */
    showDocument(key, { from = null } = {}) {
      const win = byKey.get(key);
      if (!win) return;
      desktop.bringToFront(win);
      if (from) void win.show({ from });
    },
    /** A document window, or null. @param {string} key */
    windowOf(key) {
      return byKey.get(key) ?? null;
    },
    /** A document window's editor, or null.
     *  @returns {import('../../components/sm-editor.js').SmEditor|null} */
    editor(key) {
      return /** @type {any} */ (byKey.get(key)?.querySelector('sm-editor') ?? null);
    },
    /** ⌘J once everything is arranged: toggles zoom on the active document
     *  window, if any. */
    zoomActive() {
      const key = workspace.get().activeKey;
      const win = key != null ? byKey.get(key) : null;
      if (win) windows.zoom(win);
    },
  };
}
