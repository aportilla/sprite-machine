// ---------------------------------------------------------------------------
// Window plumbing for the desktop shell — two kinds of window, two regimes:
//
//   UTILITY WINDOIDS (Tools palette, Full Sprite View, 3D View): static
//   markup in index.html, permanent chrome — no close box (closable is set
//   false here) and no menu toggle; visibility = appActive alone (a desktop
//   click hides the palettes, clicking back into a document returns them).
//   They hide, never unmount — canvas identity survives.
//
//   DOCUMENT WINDOWS: one per open document, reconciled from the workspace
//   slice (the syncDocIcons pattern lifted to windows): a context appearing
//   clones the #tpl-document-window template — its <sm-editor> and tile
//   status line take the context BEFORE the append — staggers/restores its
//   position, and appends it as a DIRECT CHILD of the desktop (the stacking
//   manager only sees direct vf-window children; appending is also what
//   makes the kit activate it — opening a window brings the application
//   forward). A context closing removes its window outright: a document
//   window's visibility IS its existence.
//
// PLACEMENT comes from shell/layout.js (pure): the smart arrangement is
// computed from the live raster at boot (windoids) and per document open
// (the default box, staggered) — saved geometry always wins over it, and
// everything clamps onto the raster's lattice. When the raster RESIZES
// (main.js re-fits it per browser-resize event and calls onDesktopResized),
// every window keeps its relative top/left pin — left a plain fraction of
// the raster width, top of the open space below the options strip — live
// and un-debounced, deliberately WITHOUT the boot clamp: reversibility
// over visibility (see onDesktopResized).
//
// APP ACTIVATION has one writer: the desktop's vf-activate event (the kit
// fires it on every change of active document-tier window, null included)
// lands here and is mirrored into BOTH truths — shell.appActive (the
// boolean the chrome gates on) and workspace.activeKey (which document).
// Deactivation is interaction-only, and the PAGE owns the press test (the
// kit's 0.4.0 position: only the page knows which presses mean "the
// Finder"): a press on the desktop's bare dither — wired here — or in the
// icon layer (shell/icons.js) routes through desktop.clearActive(); the
// kit adds its own null when the last document window leaves. The mirrors
// initialize by READING the kit's truth (desktop.activeWindow — null on a
// fresh boot, so a dialog-greeted boot is desktop-focused), never from a
// constant; opening any document window activates through the kit (hidden
// windows included — ?hide=document captures keep their windoids that way).
//
// Close boxes never hide windows directly: the windoids have no close box
// at all, and a document window's close routes through the injected
// dirty-checking flow (menus.js) — the workspace does the removing.
// ---------------------------------------------------------------------------

import { snapSys, systemPxQuantum, VfWindow } from 'vintage-frames';
import { shell, WINDOW_IDS } from '../state/shell.js';
import { workspace, followActive } from '../state/workspace.js';
import {
  initialPlacement,
  pinOf,
  pinTo,
  spriteHeightFor,
  SPRITE_WIDTH,
  TOP_RESERVE,
} from './layout.js';

// Each additional open document window offsets down-right by one step from
// the smart default box, System 7 style.
const STAGGER = 24;

// The 3D View windoid's size floor, in system px — the kit's own grow floor
// is a general 80×54, under which this windoid degenerates. Applied to every
// geometry that lands on it: boot (smart placement or a saved layout from
// before this floor existed) and the grow box (via vf-resize below).
// WIDTH: the controls strip across its top (sm-stage-controls — the rotate /
// smooth checkboxes) must never be clipped: its measured content width, 159
// (8 pad + the two checkboxes 61 + 68 + the 14 gap + 8 pad) + the frame's
// 1px borders, rounded up a hair — if the strip's contents change,
// re-measure and re-pin. HEIGHT: the fixed chrome (12 dot bar + 2 borders +
// 24 strip + 15 status = 53) plus enough canvas to still read as a view.
const STAGE_MIN_WIDTH = 164;
const STAGE_MIN_HEIGHT = 160;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * Clamp a window's authored/restored position onto the live raster, on the
 * same k-system-px lattice a drag lands on (system7web's centerWindow rule,
 * minus the centering — authored positions are kept, just pulled on-canvas).
 * A RESIZABLE window's size clamps to the open area first: bigger than it,
 * the grow-box corner is unreachable at ANY position (the title bar can't
 * leave the raster upward), so a saved geometry from a larger screen shrinks
 * to a workable box.
 */
export function clampWindow(desktop, win) {
  const k = systemPxQuantum(win);
  const down = (v) => Math.floor(v / k) * k;
  const up = (v) => Math.ceil(v / k) * k;
  const minTop = up(TOP_RESERVE);
  if (win.resizable) {
    if (Number.isFinite(win.width)) win.width = Math.min(win.width, down(desktop.width));
    if (Number.isFinite(win.height))
      win.height = Math.min(win.height, down(Math.max(0, desktop.height - minTop)));
  }
  const w = win.width ?? 0;
  const h = win.height ?? 0;
  win.left = clamp(snapSys(win.left ?? 0, win), 0, Math.max(0, down(desktop.width - w)));
  win.top = clamp(
    snapSys(win.top ?? minTop, win),
    minTop,
    Math.max(minTop, down(desktop.height - h))
  );
}

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 * @param {{saved?: object|null, hide?: string[]}} [opts]
 *   saved: the restored desktop state (utility geometry applied before the
 *   clamp; per-fileId document geometry applied as those docs open); hide:
 *   window ids to hide at boot (?hide= dev hook — 'document' hides the
 *   document windows, which stay ACTIVE, so the utility windows survive for
 *   captures that need them alone; a windoid id keeps that windoid out of
 *   frame for the whole session — the only way to hide one, there being no
 *   runtime toggle).
 */
export function initWindows(desktop, { saved = null, hide = [] } = {}) {
  /** @type {(() => void)[]} */
  const unsubs = [];

  // --- utility windoids: smart placement -> boot restore -> clamp -------------
  /** @type {Record<string, VfWindow>} shell id -> element */
  const byId = {};
  for (const id of WINDOW_IDS) {
    byId[id] = /** @type {VfWindow} */ (desktop.querySelector(`#win-${id}`));
  }
  // The smart arrangement, computed from the live raster (shell/layout.js):
  // Tools top-left, the sprite/stage rail right. The Tools palette's
  // content-hugging size stays authored in index.html and feeds the math.
  const smartLayout = () =>
    initialPlacement(desktop.width, desktop.height, {
      width: byId.tools.width ?? 0,
      height: byId.tools.height ?? 0,
    });
  const smart = smartLayout();

  // --- the Full Sprite View's fixed size ---------------------------------------
  // The windoid is a fixed-size picture frame — no grow box (not `resizable`
  // in the markup): its width is the atlas grid block's (SPRITE_WIDTH) and
  // its height is DERIVED so the 3×2 face-tile grid exactly fills the body
  // below the picker strip — no margins. The ratio is the ACTIVE document's
  // own TILE (square for every square-tile sheet — it only differs under
  // the ?tile=WxH shear hook), defaulting to square before a document is
  // open.
  const spriteRatio = () => {
    const s = workspace.active()?.doc.get();
    return s && s.tileW > 0 && s.tileH > 0 ? s.tileH / s.tileW : undefined;
  };
  const fitSprite = () => {
    byId.sprite.width = SPRITE_WIDTH;
    byId.sprite.height = spriteHeightFor(SPRITE_WIDTH, spriteRatio());
  };
  for (const id of WINDOW_IDS) {
    // Non-closeable by design: the windoids are permanent chrome, on screen
    // whenever the application is. `closable` defaults true and markup can't
    // express the off state (a boolean attribute), so it's set here.
    byId[id].closable = false;
    const sm = smart[id];
    byId[id].left = sm.left;
    byId[id].top = sm.top;
    if ('width' in sm && byId[id].resizable) {
      byId[id].width = sm.width;
      byId[id].height = sm.height;
    }
    const s = saved?.utility?.[id];
    if (s) {
      if (Number.isFinite(s.left)) byId[id].left = s.left;
      if (Number.isFinite(s.top)) byId[id].top = s.top;
      if (Number.isFinite(s.width) && byId[id].resizable) byId[id].width = s.width;
      if (Number.isFinite(s.height) && byId[id].resizable) byId[id].height = s.height;
    }
    if (id === 'stage') {
      byId[id].width = Math.max(byId[id].width ?? 0, STAGE_MIN_WIDTH);
      byId[id].height = Math.max(byId[id].height ?? 0, STAGE_MIN_HEIGHT);
    }
    // The sprite windoid's size is never authored/restored truth — it is
    // always the fixed derivation (a saved size can't land on it anyway:
    // the restore above guards on `resizable`).
    if (id === 'sprite') fitSprite();
    clampWindow(desktop, byId[id]);
  }
  // The grow box enforces only the kit's general 80×54 floor, so a drag could
  // shrink the 3D View under its own floor: re-floor on every vf-resize. The
  // kit fires it after the shrunken box has been applied but the correction
  // lands in the same microtask batch — before the next paint — so the drag
  // simply stops at the floor.
  const onStageResize = () => {
    if ((byId.stage.width ?? 0) < STAGE_MIN_WIDTH) byId.stage.width = STAGE_MIN_WIDTH;
    if ((byId.stage.height ?? 0) < STAGE_MIN_HEIGHT) byId.stage.height = STAGE_MIN_HEIGHT;
  };
  byId.stage.addEventListener('vf-resize', onStageResize);
  unsubs.push(() => byId.stage.removeEventListener('vf-resize', onStageResize));

  // A document switch or a structural doc change (a tile resize, a load) can
  // change the atlas ratio: re-derive the sprite windoid's height. Guarded on
  // the computed size so the steady state (every square-tile atlas shares
  // 2:3) writes nothing.
  unsubs.push(
    followActive(workspace, (ctx) => {
      if (!ctx) return;
      const refit = () => {
        if ((byId.sprite.height ?? 0) !== spriteHeightFor(SPRITE_WIDTH, spriteRatio()))
          fitSprite();
      };
      const un = ctx.doc.subscribe(refit);
      refit();
      return un;
    })
  );

  const hiddenAtBoot = new Set(hide.filter((id) => id !== 'document'));
  const hideDocs = hide.includes('document');

  // --- utility visibility: appActive -> hidden ---------------------------------
  // A windoid belongs to the application, so it is on screen exactly while
  // the app is active (?hide= keeps one out of frame for captures).
  const syncUtility = () => {
    const { appActive } = shell.get();
    for (const id of WINDOW_IDS) byId[id].hidden = !appActive || hiddenAtBoot.has(id);
  };
  unsubs.push(shell.subscribe(syncUtility));
  syncUtility();

  // --- document windows: the reconciler ----------------------------------------
  const tpl = /** @type {HTMLTemplateElement} */ (
    document.getElementById('tpl-document-window')
  );
  /** @type {Map<string, {win: VfWindow, editor: HTMLElement}>} ctx key -> parts */
  const byKey = new Map();
  /** Saved per-document geometry from a previous session, by fileId. */
  const savedDocGeom = new Map(
    (saved?.docs ?? []).filter((d) => d && d.fileId).map((d) => [d.fileId, d])
  );
  let staggerSlot = 0; // counts creations, so reopening cascades on

  function createDocWindow(ctx) {
    // importNode, NOT cloneNode: template content lives in an inert
    // ownerDocument, and a bare clone stays there — where
    // customElements.upgrade() silently no-ops (wrong document), leaving the
    // editor un-upgraded until append and the ctx assignment a dead own
    // property at connectedCallback time.
    const win = /** @type {VfWindow} */ (
      document.importNode(
        /** @type {HTMLTemplateElement} */ (tpl).content.firstElementChild,
        true
      )
    );
    win.id = `win-doc-${ctx.key}`;
    win.setAttribute('heading', ctx.name);
    // The default box is the smart placement's vacant-middle fill, computed
    // against the CURRENT raster (the desktop may have resized since boot),
    // staggered per creation.
    const d = smartLayout().doc;
    const g = savedDocGeom.get(ctx.fileId ?? '') ?? {
      left: d.left + STAGGER * staggerSlot,
      top: d.top + STAGGER * staggerSlot,
      width: d.width,
      height: d.height,
    };
    staggerSlot = (staggerSlot + 1) % 8; // wrap before a cascade walks off-raster
    for (const k of ['left', 'top', 'width', 'height']) {
      if (Number.isFinite(g[k])) win.setAttribute(k, String(g[k]));
    }
    // Upgrade the clone NOW: a template clone's custom elements are inert
    // until they hit the document, and a property set on an un-upgraded
    // element is captured by Lit and restored only at the FIRST UPDATE —
    // after connectedCallback, where the editor wires its per-context doc
    // subscription. Upgrading first makes `.ctx` an ordinary property set,
    // so the connectedCallback contract ("ctx before the append") holds.
    customElements.upgrade(win);
    // The context lands on the editor and the tile readout BEFORE the append
    // — their doc wiring runs at connectedCallback.
    const editor = /** @type {HTMLElement} */ (win.querySelector('sm-editor'));
    /** @type {any} */ (editor).ctx = ctx;
    const status = win.querySelector('sm-status-line');
    /** @type {any} */ (status).ctx = ctx;
    if (hideDocs) win.hidden = true;
    desktop.append(win); // upgrades + slots in; the kit activates the newcomer
    clampWindow(desktop, win);
    byKey.set(ctx.key, { win, editor });
    // Settle the light-DOM order NOW (no pointer gesture is in flight at a
    // programmatic open): a document window appended after the static
    // windoids leaves DOM order ≠ z-order, and the kit's deferred sync would
    // otherwise run at the END of the user's next press — re-inserting the
    // windoid nodes mid-gesture, which cancels the click being made (a
    // palette press would swallow). bringToFront also makes the newcomer the
    // active window through the kit's one funnel.
    desktop.bringToFront(win);
  }

  const syncDocs = () => {
    const contexts = workspace.get().contexts;
    const live = new Set(contexts.map((c) => c.key));
    for (const [key, rec] of byKey) {
      if (!live.has(key)) {
        rec.win.remove(); // existence IS visibility; the kit re-asserts active
        byKey.delete(key);
      }
    }
    for (const ctx of contexts) {
      if (!byKey.has(ctx.key)) createDocWindow(ctx);
      const rec = byKey.get(ctx.key);
      if (rec.win.heading !== ctx.name) rec.win.heading = ctx.name;
    }
  };
  unsubs.push(workspace.subscribe(syncDocs));
  syncDocs(); // HMR: rebuild windows for contexts that survived the reload

  // --- app activation: desktop -> the two mirrors -------------------------------
  // This wire is the single writer of both appActive (the boolean) and
  // workspace.activeKey (which document): desktop.activeWindow read once at
  // wire-up, then vf-activate (a document-tier window, or null) per change.
  const keyOf = (win) => {
    for (const [key, rec] of byKey) if (rec.win === win) return key;
    return null;
  };
  const applyActive = (win) => {
    workspace.setActive(win ? keyOf(win) : null);
    shell.setAppActive(!!win);
  };
  const onActivate = (e) => applyActive(/** @type {CustomEvent} */ (e).detail.window);
  desktop.addEventListener('vf-activate', onActivate);
  unsubs.push(() => desktop.removeEventListener('vf-activate', onActivate));
  // A mirror initializes by reading its source, never from a constant:
  // whatever the desktop already holds active — null on a fresh boot
  // (desktop-focused until a document window opens), or the window the
  // syncDocs rebuild above activated before this listener attached (an HMR
  // re-init) — lands through the same funnel the events use.
  applyActive(desktop.activeWindow);

  // --- deactivation: the page's press test --------------------------------------
  // The kit deliberately never decides which presses mean "the Finder" (its
  // furniture is slotted light DOM — only the page knows); the page owns the
  // test and routes the hits through clearActive(). A press on the desktop's
  // own surface (the dither, the bezel) is exactly `target === desktop`:
  // this listener sits on the host, so a press inside its shadow tree
  // retargets to the host itself, while a press in any slotted child — a
  // window, the menu bar, the options strip, a dialog, the icon layer —
  // arrives as that child and misses the test. The icon layer's own "this
  // press is the Finder" case lives in shell/icons.js, calling the same
  // clearActive().
  const onDesktopPress = (e) => {
    if (e.target === desktop) desktop.clearActive();
  };
  desktop.addEventListener('pointerdown', onDesktopPress);
  unsubs.push(() => desktop.removeEventListener('pointerdown', onDesktopPress));

  // --- close boxes ------------------------------------------------------------
  // A window's close box fires vf-close on the window itself (dialog closes
  // have a non-window target and pass through). Only document windows carry
  // one — the windoids are non-closeable — and it routes through the
  // dirty-checking flow menus.js injects.
  /** Per-window relative pin across raster resizes: the unrounded fraction
   *  plus the top/left this path last applied (a mismatch there means
   *  someone moved the window, so its pin re-derives) — and, for resizable
   *  windows, the TRUE size plus the size this path last applied, the same
   *  discipline for the oversize shrink. See onDesktopResized. */
  const pins = new WeakMap();

  const api = {
    byId,
    /** Injected by menus.js: the dirty-checking close flow, per context key. */
    onDocumentClose: null,
    /** Un-hide a document window and make it the active one (which also
     *  reactivates the application — bringToFront fires vf-activate). */
    activateContext(key) {
      const rec = byKey.get(key);
      if (!rec) return;
      rec.win.hidden = false;
      desktop.bringToFront(rec.win);
    },
    /** The window element a context lives in (persistence reads geometry off
     *  it), or null. */
    winFor(key) {
      return byKey.get(key)?.win ?? null;
    },
    /** The editor element a context lives in (the boot dev hooks land on the
     *  boot document's), or null. */
    editorFor(key) {
      return byKey.get(key)?.editor ?? null;
    },
    /** The raster changed size (a browser resize / zoom re-fit — main.js
     *  calls this right after fitWithin, per event, un-debounced: the raster
     *  re-fits live, so the windows track it in the same stroke). Every
     *  window — windoid and document alike — keeps its relative pin
     *  (shell/layout.js: left as a plain fraction of the raster width, top
     *  of the open space below the options strip — the fixed chrome band
     *  is the pin's y = 0 line, so a window tucked under the strip stays
     *  tucked under it). Deliberately NO position clamp and no visibility
     *  guarantee: a clamp at the
     *  small size rewrites the fraction and turns grow-back into a drift, so
     *  a window near an edge just hangs partly off a shrunk raster and
     *  returns whole; the bare snap keeps the chrome on the system-px
     *  lattice.
     *
     *  SIZES get exactly one intervention: a resizable window BIGGER than
     *  the open area shrinks to fit it. Hanging off is recoverable by a
     *  drag; bigger-than-the-area is not — the title bar can't leave the
     *  raster upward, so the grow-box corner would be unreachable at any
     *  position. The shrink follows the pin's own reversibility discipline
     *  (below): the TRUE size is the per-window truth, and growing the
     *  raster back restores it exactly. (The fixed-size Sprite View is not
     *  resizable, so it only re-pins.)
     *
     *  The UNROUNDED fraction is the per-window truth between events (the
     *  `pins` cache), re-derived only when the window has moved since this
     *  path last placed it (a drag, a restore, a fresh window) — likewise
     *  the true size, re-derived only when the window was resized since
     *  this path last sized it. Re-deriving
     *  it every event from the just-snapped position ratchets — the
     *  lattice's round-half-up walked windows down the screen across a long
     *  resize drag, one notch per odd landing, never back up. */
    onDesktopResized(before) {
      const after = { width: desktop.width, height: desktop.height };
      if (before.width === after.width && before.height === after.height) return;
      const wins = [
        ...WINDOW_IDS.map((id) => byId[id]),
        ...[...byKey.values()].map((rec) => rec.win),
      ];
      for (const win of wins) {
        const cur = { left: win.left ?? 0, top: win.top ?? 0 };
        let rec = pins.get(win);
        if (!rec || rec.left !== cur.left || rec.top !== cur.top) {
          rec = { ...rec, pin: pinOf(cur, before) };
        }
        const pos = pinTo(rec.pin, after);
        win.left = snapSys(pos.left, win);
        win.top = snapSys(pos.top, win);
        const next = { pin: rec.pin, left: win.left, top: win.top };
        if (win.resizable) {
          // The oversize shrink (see the doc comment): floor-snapped onto
          // the window's lattice so the clamped edge lands on the device
          // grid; an in-bounds size passes through untouched (no re-snap —
          // the write below is then the value already there, a Lit no-op).
          const k = systemPxQuantum(win);
          const minTop = Math.ceil(TOP_RESERVE / k) * k;
          const maxW = Math.floor(after.width / k) * k;
          const maxH = Math.floor(Math.max(0, after.height - minTop) / k) * k;
          const curW = win.width ?? 0;
          const curH = win.height ?? 0;
          const trueW = rec.appliedW === curW ? rec.trueW : curW;
          const trueH = rec.appliedH === curH ? rec.trueH : curH;
          win.width = Math.min(trueW, maxW);
          win.height = Math.min(trueH, maxH);
          Object.assign(next, {
            trueW,
            trueH,
            appliedW: win.width,
            appliedH: win.height,
          });
        }
        pins.set(win, next);
      }
    },
    /** Deactivate the application programmatically (nothing calls this on
     *  the happy paths — closing the last window deactivates via the kit —
     *  but the hook stays for symmetry with clearActive()). */
    deactivate() {
      desktop.clearActive();
    },
    dispose() {
      for (const u of unsubs) u();
      desktop.removeEventListener('vf-close', onClose);
      // HMR: leave the windows standing — the re-init's syncDocs adopts…
      // it cannot: the fresh Map starts empty and would double them. Remove
      // and let the next init rebuild from the surviving workspace state.
      for (const [, rec] of byKey) rec.win.remove();
      byKey.clear();
    },
  };

  const onClose = (e) => {
    const t = e.target;
    if (!(t instanceof VfWindow)) return;
    const key = keyOf(t);
    if (key != null) api.onDocumentClose?.(key);
  };
  desktop.addEventListener('vf-close', onClose);

  return api;
}
