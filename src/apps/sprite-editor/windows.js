// ---------------------------------------------------------------------------
// The SPRITE EDITOR's windows (docs/app-windows-plan.md) — two kinds, two
// regimes, both the application's own: the window manager (shell/windows.js)
// runs them like every window and knows nothing about them but what they
// declare at adoption.
//
//   UTILITY WINDOIDS (Tools palette, Full Sprite View, 3D View, 3D Sprite
//   Atlas): authored bare in windows.html beside this file, parsed at the
//   application's init and appended to the desktop HIDDEN — before the
//   first frame, so a boot shows the Finder's bar and no windoid. They are
//   the application's PALETTES, System 7's floating windows: on screen
//   exactly while the application is front — hidden when another comes
//   forward, shown again when it returns (suspend and resume: syncUtility
//   below, off shell.appActive, the Sprite Editor front). The first three
//   are permanent chrome — no close box (closable is set false here) and no
//   menu toggle. The 3D Sprite Atlas is the one TOGGLEABLE windoid: it
//   keeps the kit's close box, and its visibility is the application front
//   AND prefs.showRing — View → 3D Sprite Atlas flips the flag, the close
//   box (routed below) clears it, and a show brings it to the front of the
//   windoid band (a palette you asked for comes up on top). Its HEIGHT is a
//   derivation like the Sprite View's size (fitRing: ringHeightFor(size),
//   re-fit as the tile size changes and DECLARED to the grow box as the
//   kit's size rect, min-height = max-height — so it resizes on the
//   horizontal axis alone); its WIDTH is the user's, seeded by the
//   placement, moved by the grow box, floored at the strip (the rect's
//   min-width; the cell row scrolls under the kit's rail past it —
//   docs/ring-size-plan.md). They hide, never unmount — canvas identity
//   survives.
//
//   DOCUMENT WINDOWS: one per open document, reconciled from the workspace
//   slice (the icon layer's reconciler lifted to windows): a context
//   appearing clones #tpl-document-window (windows.html) — its <sm-editor>
//   and tile status line take the context BEFORE the append — places it
//   (the doc box, cascaded), appends it as a DIRECT CHILD of the desktop
//   (the kit's stacking manager only sees direct vf-window children),
//   adopts it as the Sprite Editor's, and brings it forward (the kit
//   activates it — opening a window brings the application forward). A
//   context closing removes its window outright: a document window's
//   visibility IS its existence.
//
// PLACEMENT is the application's (layout.js beside this file, pure), and
// ONLY from there: the smart arrangement computed from the live raster at
// boot (the windoids) and per document open (the doc box, cascaded into
// the first free slot), then clamped onto the raster's lattice (the
// manager's clamp). Nothing about these windows is restored from a prior
// session — a browser is resized and reopened on another monitor all the
// time, so a remembered top/left is no truth worth re-asserting over a
// raster that may be nothing like the one it was dragged on. Within a
// session, what you drag is yours: the windoids keep their arrangement
// across deactivation and across close-to-zero, and View → Arrange Windows
// re-runs the whole placement on the current raster — this application's
// ARRANGEMENT GROUP (below), which the manager composes with every other
// window's. A browser resize moves them by the manager's one rule, the
// nine-slice pin, in the windows' frame whose top and right bands this
// application widens to hold its rail (layout.js FRAME_BANDS, declared at
// init) — the placed windoids all struts, so a resize lands them exactly
// where Arrange would, the hidden ones behind a boot dialog coming up
// right when the first document opens; the 3D View floors at its own size
// and the strip is a mixed box, the two POLICIES declared at adoption.
//
// WHICH DOCUMENT IS ACTIVE is this module's mirror, workspace.activeKey,
// written from the manager's beforeFront — ahead of the front application,
// so a document switch arriving from another application lands while the
// strip is still hidden (fitRing's comment). The front application itself
// is the manager's reading: every window here is adopted as the Sprite
// Editor's.
//
// Close boxes never hide windows directly: the permanent windoids have no
// close box at all, the 3D Sprite Atlas's is its toggle's uncheck, and a
// document window's routes through the application's dirty-checking close
// (index.js's closeContext, handed in) — the workspace does the removing.
// The document window's ZOOM BOX, and ⌘J's two halves, are below.
// ---------------------------------------------------------------------------

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

/** The windoids, by id (their markup's `win-<id>`): the three permanent
 *  ones — on screen while the application is front — and the toggleable
 *  3D Sprite Atlas (`ring`: front AND prefs.showRing). */
const WINDOIDS = ['tools', 'sprite', 'stage', 'ring'];

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 * @param {ReturnType<typeof import('../../shell/windows.js').initWindows>} windows
 * @param {{onDocumentClose(key: string): void}} opts
 *   onDocumentClose: a document window's close box — the application's
 *   dirty-checking close (index.js), by context key.
 */
export function initEditorWindows(desktop, windows, { onDocumentClose }) {
  /** @type {(() => void)[]} */
  const unsubs = [];
  const host = parseWindows(markup);
  const tpl = /** @type {HTMLTemplateElement} */ (
    host.querySelector('#tpl-document-window')
  );

  // The rail's hold on the resize rule (the header): the windows' frame's
  // top and right bands, widened — declared before any window can re-pin.
  windows.setFrameBands(FRAME_BANDS);

  // --- utility windoids: appended hidden, adopted, placed --------------------------
  /** @type {Record<string, VfWindow>} id -> element */
  const byId = {};
  const authored = /** @type {VfWindow[]} */ ([
    ...host.querySelectorAll(':scope > vf-window'),
  ]);
  for (const win of authored) byId[win.id.slice('win-'.length)] = win;
  for (const id of WINDOIDS) {
    // Hidden from the first frame: a palette is on screen only while the
    // application is front (syncUtility below), and a boot is the Finder's.
    byId[id].hidden = true;
    // Non-closeable by design: the permanent windoids are on screen
    // whenever the application is. `closable` defaults true and markup
    // can't express the off state (a boolean attribute), so it's set here.
    // The 3D Sprite Atlas is the exception — its close box IS its toggle's
    // uncheck (onClose below), so the kit's default stands.
    if (id !== 'ring') byId[id].closable = false;
  }
  // The 3D View's floor, declared to its grow box as the kit's size rect:
  // the drag stops there on its own (the kit's general 80×54 would let it
  // shrink under the strip). The ring's rect rides fitRing below — its
  // height bound moves with the tile size. (Every windoid's header height
  // — its controls strip's band — is authored in the markup as
  // `header-height`, the kit's grammar; layout.js keeps the same numbers
  // for the chrome arithmetic.)
  byId.stage.minWidth = STAGE_MIN_WIDTH;
  byId.stage.minHeight = STAGE_MIN_HEIGHT;
  // Appended in the markup's order, the Tools palette last — it tops the
  // windoid band.
  desktop.append(...authored);
  // Adopted as the application's, with the resize rule's two declared
  // policies (a fixed-size windoid takes the manager's default — its live
  // size): the 3D View floors at its own size on the re-pin as on the grow
  // box, and the 3D Sprite Atlas is a MIXED box — its height a derivation
  // (fixed, resolved through the anchor rule from the pin read where the
  // window sits: docked by the placement, the bottom strut holds and the
  // top follows), its width the user's (resizable, floored at the strip).
  // A floor applied after the re-pin would read as a "touch" on the next
  // event and re-derive the pin from the floored geometry — a drift — so it
  // rides the rule itself.
  /** @type {Record<string, (cur: {width: number, height: number}) => import('../../shell/layout.js').Policy>} */
  const policies = {
    stage: () => ({ min: { width: STAGE_MIN_WIDTH, height: STAGE_MIN_HEIGHT } }),
    ring: (cur) => ({ size: { height: cur.height }, min: { width: RING_MIN_WIDTH } }),
  };
  for (const id of WINDOIDS) {
    windows.adopt(byId[id], { app: SPRITE_EDITOR, policy: policies[id] ?? null });
  }

  // The smart arrangement, computed from the live raster (layout.js): Tools
  // top-left, the sprite/stage rail right, the 3D Sprite Atlas strip docked
  // at the bottom — the doc box giving up the strip's band only while the
  // strip is SHOWN. The Tools palette's content-hugging size stays authored
  // in its markup; the placement writes its position alone. The strip's
  // inputs (its view count and tile size) are a DOCUMENT's settings: the
  // served document's by default (state/ring.js's façade), or — for the doc
  // box of a window being opened — the settings of the document it is
  // opened for, since the open activates it and the strip follows.
  const ringShown = () => prefs.get().showRing;
  /** @param {{views: number, size: number}} [r]  the strip's settings */
  const smartLayout = (r = ring.get()) =>
    initialPlacement(desktop.width, desktop.height, {
      ringViews: r.views,
      ringSize: r.size,
      ringShown: ringShown(),
    });

  // --- the Full Sprite View's fixed size ---------------------------------------
  // The windoid is a fixed-size picture frame — no grow box (not `resizable`
  // in the markup): its width is the atlas grid block's (SPRITE_WIDTH) and
  // its height is DERIVED so the 3×2 face-tile grid exactly fills the body
  // below the picker strip — no margins. The ratio is the ACTIVE document's
  // own TILE (square for every square-tile sheet — it differs only for a
  // dropped non-square one), defaulting to square before a document is
  // open.
  const spriteRatio = () => {
    const s = workspace.active()?.doc.get();
    return s && s.tileW > 0 && s.tileH > 0 ? s.tileH / s.tileW : undefined;
  };
  const fitSprite = () => {
    byId.sprite.width = SPRITE_WIDTH;
    byId.sprite.height = spriteHeightFor(SPRITE_WIDTH, spriteRatio());
  };
  // --- the 3D Sprite Atlas's derived height ---------------------------------------
  // The Sprite View's rule on ONE axis: ringHeightFor(size) tall — the
  // chrome over one row of tile-size cells — never authored truth, applied
  // at placement, re-derived as the tile size changes, and DECLARED to the
  // grow box as the kit's size rect (min-height = max-height: the axis is
  // locked, the drag moves the width alone — the kit's own Patterns-strip
  // idiom). The WIDTH is the user's: the placement seeds it (the natural
  // row, capped at the vacancy), the grow box moves it within the rect's
  // min-width — the strip's content width, RING_MIN_WIDTH (the kit's own
  // grow floor is a general 80) — and floorRingWidth guards the
  // programmatic writers the rect doesn't bound (the rect bounds the
  // gesture only). ONE writer, one anchor: fitRing writes the height and
  // nothing else. A size change never moves the top-left — the bar stays
  // where the placement or your drag put it and the BOTTOM edge is what
  // moves, a bigger tile growing the window down from where it sits (the
  // Sprite View's rule: its height moves under a document switch, and that
  // is no move). So a strip docked on the bottom margin grows past the
  // raster's bottom at a big tile — accepted, the user's call: the pin
  // keeps it hanging by the same amount across a resize (reversibility
  // over visibility, the rule's own contract), a drag or Arrange brings it
  // back. (A first cut held the bottom edge instead, growing the window up
  // with the top floored at the reserve — a second writer; retired.)
  // That is the rule for a strip ON SCREEN. The size is a document's
  // setting (state/ring-settings.js), so a change also arrives with a
  // document SWITCH — and, at boot or from another application, behind a
  // strip that is HIDDEN (the mirror below writes the active document
  // before the manager writes the front application, so the switch lands
  // here while the strip is still off screen — the boot placement having
  // run before any document existed, at the defaults). A hidden strip has
  // nothing on screen to hold, so a height change behind it RE-RUNS ITS
  // PLACEMENT instead: the show — or the boot — finds it docked at the
  // height this document's tile derives, the way a placement always would,
  // rather than hanging off the margin by a size the user never typed.
  // (Hidden by its own toggle and unchanged in size, it comes back exactly
  // where it was.)
  const floorRingWidth = () => {
    if ((byId.ring.width ?? 0) < RING_MIN_WIDTH) byId.ring.width = RING_MIN_WIDTH;
  };
  /** The rect, restated whenever the height derivation moves. (The
   *  window's header height — the controls strip, RING_STRIP — is authored
   *  in the markup as `header-height`, the kit's grammar; the chrome
   *  arithmetic ringHeightFor counts the same 63 — change one, change the
   *  other.) */
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

  // The placement is the geometry — no prior session's is consulted (see
  // the header): a windoid lands where THIS raster puts it. Run for all
  // four at init and by the arrangement group. Every placement is a TARGET
  // BOX first — computed without touching the window (the manager's
  // clamped: the boot clamp's own arithmetic) — and then written
  // (windows.write): the group's arranged() asks the same targets whether
  // an arrange would change anything, so the test and the writes can't
  // disagree.
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
    // The sprite windoid's size and the ring's height are never authored
    // truth — always the derivations (the ring's placed width stands,
    // floored).
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
  // A document window onto cascade slot `slot` of the CURRENT raster's doc
  // box, at the box's size: the arrangement group.
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

  // A document switch or a structural doc change (a tile resize, a load) can
  // change the atlas ratio: re-derive the sprite windoid's height. Guarded on
  // the computed size so the steady state (every square-tile atlas shares
  // 2:3) writes nothing. A re-fit is no placement — the pin a resize keeps
  // stays the window's — so it tells the layout signal itself.
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

  // The tile size changes the ring's height: shown, re-fit — the top-left
  // held, the bottom edge the one that moves (see fitRing); hidden,
  // re-placed (see the same comment) — guarded on the computed height so a
  // settings change that leaves it (views, elevation, offset) writes
  // nothing (the sprite refit's idiom). The view count no longer touches
  // the window — a longer row scrolls under the rail.
  unsubs.push(
    ring.subscribe(() => {
      if ((byId.ring.height ?? 0) !== ringHeightFor(ring.get().size)) {
        if (byId.ring.hidden) placeWindoid('ring', smartLayout());
        else fitRing();
      }
      // The placement's inputs moved (the strip's box, the doc box behind
      // a shown strip) whether or not the window did.
      windows.layoutChanged();
    })
  );

  // --- the palettes' visibility: the application front -> hidden -----------------------
  // A windoid belongs to the application, so it is on screen exactly while
  // the application is front — suspend and resume; the 3D Sprite Atlas
  // needs its own toggle on as well, and a show (the flag flipping it onto
  // the screen) raises it to the front of the windoid band — see the
  // header.
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
    // What is on screen changed (and, with the strip, the doc box the
    // placement would write).
    windows.layoutChanged();
  };
  unsubs.push(shell.subscribe(syncUtility), prefs.subscribe(syncUtility));
  syncUtility();

  // --- document windows: the reconciler ----------------------------------------
  /** @type {Map<string, VfWindow>} ctx key -> its window */
  const byKey = new Map();
  const keyOf = (win) => {
    for (const [key, w] of byKey) if (w === win) return key;
    return null;
  };
  // WHICH DOCUMENT IS ACTIVE (the header): the manager's first ear on every
  // activation — a document window's context key, or null for any other
  // window and for none — written before the front application is, so the
  // strip sees a switch while it is still hidden. Wired before the
  // reconciler runs, whose opens activate.
  unsubs.push(windows.beforeFront((win) => workspace.setActive(win ? keyOf(win) : null)));

  function createDocWindow(ctx) {
    const win = cloneWindow(tpl);
    win.id = `win-doc-${ctx.key}`;
    win.heading = ctx.name;
    // The box is the smart placement's vacant-middle fill, computed against
    // the CURRENT raster (the desktop may have resized since boot) and THIS
    // document's atlas settings (the strip's band, while shown, is the
    // height its tile derives — the open activates the document and the
    // strip follows it), cascaded into the first slot no open document
    // window holds — never a remembered geometry (see the header). Saved
    // and untitled documents place alike.
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
    // The context lands on the editor and the tile readout BEFORE the append
    // — their doc wiring runs at connectedCallback (the clone is upgraded
    // already, so `.ctx` is an ordinary property set; shell/windows.js
    // cloneWindow).
    /** @type {any} */ (win.querySelector('sm-editor')).ctx = ctx;
    /** @type {any} */ (win.querySelector('sm-status-line')).ctx = ctx;
    desktop.append(win); // slots in as a direct child of the desktop
    byKey.set(ctx.key, win);
    windows.adopt(win, { app: SPRITE_EDITOR });
    // The boot clamp onto the live lattice (the append first: it reads the
    // lattice off a connected element).
    windows.write(win, windows.clamped(win, g));
    // Settle the light-DOM order: a document window appended after the
    // windoids leaves DOM order ≠ z-order, and bringToFront asks the kit to
    // sync it (a task, once no pointer is down) rather than leaving it to
    // the user's next gesture. bringToFront also makes the newcomer the
    // active window through the kit's one funnel — the mirror above reads
    // its key, so the Sprite Editor comes forward on it.
    desktop.bringToFront(win);
  }

  const syncDocs = () => {
    const contexts = workspace.get().contexts;
    const live = new Set(contexts.map((c) => c.key));
    for (const [key, win] of byKey) {
      if (!live.has(key)) {
        windows.release(win);
        win.remove(); // existence IS visibility; the kit re-asserts active
        byKey.delete(key);
      }
    }
    for (const ctx of contexts) {
      if (!byKey.has(ctx.key)) createDocWindow(ctx);
      const win = byKey.get(ctx.key);
      if (win.heading !== ctx.name) win.heading = ctx.name;
    }
    windows.layoutChanged(); // the window set (a new window placed, a closed one gone)
  };
  unsubs.push(workspace.subscribe(syncDocs));
  syncDocs(); // HMR: rebuild windows for contexts that survived the reload

  // --- close boxes ------------------------------------------------------------
  // A window's close box fires vf-close on the window itself (dialog closes
  // have a non-window target and pass through; another application's
  // windows are its own to hear). A document window's routes through the
  // application's dirty-checking close; the 3D Sprite Atlas's is the View
  // menu's uncheck, one truth (prefs.showRing).
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

  // --- the zoom box -----------------------------------------------------------
  // The kit's zoom box (`zoomable` on the document-window template) fires
  // vf-zoom and leaves what zooming MEANS to the page — here, the
  // application's own meaning (a read-me's is the Text Viewer's, and
  // different in every rule): a toggle, the top-left held in both
  // directions — a zoom never moves a window, only its far edges:
  //
  //   EXPAND — the window grows right and down to the vacant middle's own
  //   edges (layout.js zoomedBox: the rail's inset gutter at the right, the
  //   bottom margin below), filling the open area from wherever its
  //   top-left sits without running under the windoid rail.
  //
  //   RESTORE — a window already AT that state (its size IS the box
  //   zoomedBox computes for its top-left on the live raster) returns to
  //   the size the expand RECORDED — what the window measured just before
  //   it grew. The memory is a session truth in a WeakMap on the element,
  //   the windoid-arrangement discipline exactly: within a session what
  //   you had is yours, and nothing about it persists (a reload still
  //   places every window fresh). With nothing recorded — a window grown
  //   BY HAND onto the exact zoomed box, an HMR-rebuilt window — the doc
  //   box's size (the placement's default for the CURRENT raster) is the
  //   fallback. A zoomed window DRAGGED elsewhere reads unzoomed at its
  //   new top-left (the state test is positional), so a further zoom
  //   re-records the zoomed size as its pre-zoom truth — the drag made
  //   that box the user's.
  //
  // The state test is arithmetic, so it survives a browser resize: a zoomed
  // window's far edges are struts of the nine-slice pin (the rail gutter,
  // the bottom band), so a re-pin holds them where a re-derived zoomedBox
  // puts them and the next click still reads "zoomed". No clamp on either
  // write: the expand fits the raster by construction (but for the DOC_MIN
  // floor on a window dragged past the vacancy — hanging off is recoverable
  // by a drag, the resize rule's own posture), and the restore leaves a
  // far-dragged window hanging rather than moving its handle. A
  // programmatic size write fires no vf-resize (the kit's value-set rule),
  // and the next raster resize re-derives this window's pin (the manager's
  // cache reads the new size as a touch).
  /** Pre-zoom sizes, per window — recorded by the expand, consumed by the
   *  restore. A WeakMap so a closed window's record dies with its node. */
  const zoomMemory = new WeakMap();
  /** The zoom box's target for `win` where it sits: the vacancy's edges
   *  from its top-left (layout.js zoomedBox). A shown 3D Sprite Atlas
   *  strip is a boundary the zoom respects (the doc box leaves it the
   *  same room). Shared by the toggle and the group's reading of a zoomed
   *  active window. */
  const zoomBoxFor = (win) =>
    zoomedBox(
      desktop.width,
      desktop.height,
      { left: win.left ?? 0, top: win.top ?? 0 },
      { ringShown: ringShown(), ringSize: ring.get().size }
    );
  /** The toggle itself — the zoom box's click and ⌘J's zoom half
   *  (zoomActive) share it. */
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

  // --- Arrange Windows: the arrangement group -------------------------------------
  // The application's windows arrange as a GROUP, by its rules — the
  // manager's arrange() runs `arrange` and its arranged() asks `arranged`,
  // beside every window adopted with a placement of its own.
  //
  //   arrange: the boot placement, re-run on the CURRENT raster — the
  //   windoids back to the rail at their placed sizes (the hidden ones
  //   too, ready for the next open), every open document window onto the
  //   doc box at its size, cascaded in STACKING order (the desktop keeps
  //   DOM order in step with z-order: bottom-most first, so the front
  //   window tops the cascade; a sixth and beyond wrap, as an open would).
  //   Positions only: nothing activates or re-stacks.
  //
  //   arranged: is every visible window of the group where that arrange
  //   would write it — the very targets it writes (windoidBox / docBox, the
  //   clamp included), so the test and the writes can't disagree?
  //   Deliberately loose in four places, each this application's rule, not
  //   the desktop's. HIDDEN windows don't count (the windoids while another
  //   application is front) — the test is what the user sees, so a hidden
  //   strip re-fit behind the Export dialog never makes the item "Arrange"
  //   over a screen that looks arranged. Nor does the 3D Sprite Atlas
  //   strip's WIDTH: content, the user's (a grow-box drag, the spring of a
  //   browser resize — layout.js's "mixed box"); an arrange still re-seeds
  //   it, but a strip at its dock at its derived height is an arranged
  //   strip whatever its width. Nor WHICH document sits on WHICH cascade
  //   slot: the documents must fill the cascade's first n slots as a set,
  //   one each, but a permutation is stacking bookkeeping — an arrange
  //   cascades in stacking order, so a raise alone (a click on the
  //   upper-left of two) would otherwise turn the item to Arrange over two
  //   windows plainly on the cascade, and the chord would SWAP them rather
  //   than zoom. And the ACTIVE document window may sit ZOOMED from its
  //   slot (the zoom box's own box for that top-left, zoomBoxFor): its zoom
  //   is part of the arranged reading, so the ⌘J item's value stays `zoom`
  //   and the next ⌘J restores that one window — an arrange there would
  //   re-cascade and swap. (index.js's ⌘J item carries the value `arrange`
  //   while the manager's arranged() reads false and `zoom` while it reads
  //   true; its label never turns.)
  /** The document windows in stacking order, bottom-most first. */
  const docWindows = () =>
    [...desktop.querySelectorAll(':scope > vf-window')]
      .map((el) => /** @type {VfWindow} */ (el))
      .filter((win) => keyOf(win) != null);
  /** Does `win` sit exactly at `g` — every key `g` states, `skip` aside? */
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
        // The documents: the cascade's first n slots (n every document
        // window, hidden ones included — each holds a slot in an arrange)
        // as a pool, every visible window claiming a distinct one — at the
        // doc box's size, or, the active window, at its zoom box's.
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
    /** Bring a document window forward — the active one, which also brings
     *  the application forward (bringToFront fires vf-activate): an open,
     *  the unsaved-changes question pointing at its window, a pick in the
     *  View menu's window tail, a dropped file. */
    showDocument(key) {
      const win = byKey.get(key);
      if (win) desktop.bringToFront(win);
    },
    /** ⌘J's other half (once everything is arranged): the ACTIVE document
     *  window through the zoom box's own toggle — from the slot it sits on
     *  to the vacancy's edges, top-left held, and back. A window zoomed
     *  from its slot still reads arranged (the group above), so the item's
     *  value stays `zoom` and repeats toggle that one window while nothing
     *  else moves. Nothing without an active document window. */
    zoomActive() {
      const key = workspace.get().activeKey;
      const win = key != null ? byKey.get(key) : null;
      if (win) zoomToggle(win);
    },
    dispose() {
      for (const u of unsubs) u();
      desktop.removeEventListener('vf-close', onClose);
      desktop.removeEventListener('vf-zoom', onZoom);
      // HMR: the next init rebuilds every window — the document windows
      // from the surviving workspace, the windoids from the markup — so
      // release and remove them all (the same teardown rebuilds the stage:
      // main.js makes it on the new #viewport).
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
