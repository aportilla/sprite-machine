// ---------------------------------------------------------------------------
// Desktop state in localStorage — tiny, synchronous at boot, exactly what
// it's good at (the documents themselves live in IndexedDB). One versioned
// JSON key, v2 for the multi-document world: per-windoid wanted/geometry,
// per-open-SAVED-document window geometry + edited face (untitled windows
// are deliberately absent — no autosave, explicit Save is the contract),
// which document was active, per-icon position, and the Show Grid toggle.
//
// Restore happens at boot before first paint (main.js reads `saved`;
// windows.js/icons.js apply geometry, main.js reopens the docs); writes are
// snapshot-on-exit plus a debounce on any store change or desktop gesture —
// snapshotting is cheap and loses nothing that matters. `?fresh=1` disables
// BOTH directions, so a capture neither reads nor clobbers a real session's
// layout. A v1 blob migrates shallowly: windoid geometry and icons carry
// over, `lastDocId` becomes the one docs entry.
// ---------------------------------------------------------------------------

import { shell, WINDOW_IDS } from '../state/shell.js';
import { files } from '../state/files.js';
import { workspace } from '../state/workspace.js';

const KEY = 'sprite-machine:desktop';
const VERSION = 2;
const WRITE_DEBOUNCE_MS = 400;

function migrateV1(v1) {
  const utility = {};
  for (const id of WINDOW_IDS) if (v1.windows?.[id]) utility[id] = v1.windows[id];
  const docGeom = v1.windows?.document ?? {};
  return {
    v: VERSION,
    utility,
    docs: v1.lastDocId
      ? [
          {
            fileId: v1.lastDocId,
            top: docGeom.top,
            left: docGeom.left,
            width: docGeom.width,
            height: docGeom.height,
          },
        ]
      : [],
    activeFileId: v1.lastDocId ?? null,
    icons: v1.icons ?? {},
    showGrid: !!v1.showGrid,
  };
}

function load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (parsed?.v === VERSION) return parsed;
    if (parsed?.v === 1) return migrateV1(parsed);
    return null;
  } catch {
    return null;
  }
}

/** @param {boolean} fresh  ?fresh=1 — neither restore nor persist */
export function createDesktopState(fresh) {
  const saved = fresh ? null : load();

  return {
    /** The restored state, or null (fresh boot / nothing stored / ?fresh). */
    saved,

    /** A saved icon position by key ("sample:Car" / "doc:<id>"), or null. */
    iconPos(key) {
      const p = saved?.icons?.[key];
      return Number.isFinite(p?.left) && Number.isFinite(p?.top) ? p : null;
    },

    /**
     * Start persisting. `windows` is the initWindows api (utility elements
     * by shell id + per-context window lookup), `iconsRoot` the icon layer
     * (positions are read off the live elements at snapshot time — the
     * properties ARE the truth after any drag).
     */
    start({ windows, iconsRoot }) {
      if (fresh) return () => {};

      function snapshot() {
        const sh = shell.get();
        /** @type {Record<string, object>} */
        const utility = {};
        for (const id of WINDOW_IDS) {
          const el = windows.byId[id];
          utility[id] = {
            hidden: !sh.windows[id],
            top: el.top,
            left: el.left,
            width: el.width,
            height: el.height,
          };
        }
        // Open SAVED documents only: geometry off each live window, the
        // edited face off the context. Untitleds have nothing to reopen.
        const docs = [];
        for (const ctx of workspace.get().contexts) {
          if (!ctx.fileId) continue;
          const win = windows.winFor(ctx.key);
          if (!win) continue;
          docs.push({
            fileId: ctx.fileId,
            top: win.top,
            left: win.left,
            width: win.width,
            height: win.height,
            face: ctx.face,
          });
        }
        /** @type {Record<string, {left:number, top:number}>} */
        const icons = {};
        for (const icon of iconsRoot.querySelectorAll('vf-icon[data-key]')) {
          icons[icon.dataset.key] = { left: icon.left, top: icon.top };
        }
        return {
          v: VERSION,
          utility,
          docs,
          activeFileId: workspace.active()?.fileId ?? null,
          icons,
          showGrid: sh.showGrid,
        };
      }

      const write = () => {
        try {
          localStorage.setItem(KEY, JSON.stringify(snapshot()));
        } catch {
          // Quota/private-mode failures cost only layout memory.
        }
      };

      let timer = 0;
      const writeSoon = () => {
        clearTimeout(timer);
        timer = setTimeout(write, WRITE_DEBOUNCE_MS);
      };

      // Store changes (visibility, grid, the open set, titles/faces) and
      // desktop gestures (window/icon drags and resizes end in a pointerup)
      // both schedule a write; leaving the page flushes one synchronously.
      const unsubs = [
        shell.subscribe(writeSoon),
        files.subscribe(writeSoon),
        workspace.subscribe(writeSoon),
      ];
      const onPointerUp = () => writeSoon();
      const onHide = () => {
        if (document.visibilityState === 'hidden') write();
      };
      document.addEventListener('pointerup', onPointerUp);
      document.addEventListener('visibilitychange', onHide);
      window.addEventListener('beforeunload', write);

      return () => {
        clearTimeout(timer);
        for (const u of unsubs) u();
        document.removeEventListener('pointerup', onPointerUp);
        document.removeEventListener('visibilitychange', onHide);
        window.removeEventListener('beforeunload', write);
      };
    },
  };
}
