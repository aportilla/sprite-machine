// ---------------------------------------------------------------------------
// Desktop state in localStorage — tiny, synchronous at boot, exactly what
// it's good at (the documents themselves live in IndexedDB). One versioned
// JSON key: per-window hidden/top/left/width/height, per-icon position, the
// Show Grid toggle, and the last open doc id.
//
// Restore happens at boot before first paint (main.js reads `saved` and
// windows.js/icons.js apply it); writes are snapshot-on-exit plus a debounce
// on any store change or desktop gesture — snapshotting is cheap and loses
// nothing that matters. `?fresh=1` disables BOTH directions, so a capture
// neither reads nor clobbers a real session's layout.
// ---------------------------------------------------------------------------

import { shell, WINDOW_IDS } from '../state/shell.js';
import { files } from '../state/files.js';

const KEY = 'sprite-machine:desktop';
const VERSION = 1;
const WRITE_DEBOUNCE_MS = 400;

function load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return parsed?.v === VERSION ? parsed : null;
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
     * Start persisting. `windows` is the shell id → vf-window map,
     * `iconsRoot` the icon layer (positions are read off the live elements
     * at snapshot time — the properties ARE the truth after any drag).
     */
    start({ windows, iconsRoot }) {
      if (fresh) return () => {};

      function snapshot() {
        const sh = shell.get();
        /** @type {Record<string, object>} */
        const w = {};
        for (const id of WINDOW_IDS) {
          const el = windows[id];
          w[id] = {
            hidden: !sh.windows[id],
            top: el.top,
            left: el.left,
            width: el.width,
            height: el.height,
          };
        }
        /** @type {Record<string, {left:number, top:number}>} */
        const icons = {};
        for (const icon of iconsRoot.querySelectorAll('vf-icon[data-key]')) {
          icons[icon.dataset.key] = { left: icon.left, top: icon.top };
        }
        return {
          v: VERSION,
          windows: w,
          icons,
          showGrid: sh.showGrid,
          lastDocId: files.get().currentId,
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

      // Store changes (visibility, grid, open doc) and desktop gestures
      // (window/icon drags and resizes end in a pointerup) both schedule a
      // write; leaving the page flushes one synchronously.
      const unsubs = [shell.subscribe(writeSoon), files.subscribe(writeSoon)];
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
