// ---------------------------------------------------------------------------
// Desktop state in localStorage — tiny, synchronous at boot, exactly what
// it's good at (the documents themselves live in IndexedDB). One versioned
// JSON key, v3: per-icon position and per-open-SAVED-document edited face
// (untitled windows are deliberately absent — no autosave, explicit Save is
// the contract) plus which document was active, and the DESKTOP PATTERN
// (the Desktop Patterns panel's setting — System 7 kept it in the System
// file; here it's the one desktop setting that persists). An older v3 blob
// may still carry the retired `showGrid` flag (it parses fine and drops on
// the next write) or lack `pattern` (it reads null — the dither).
//
// WINDOW GEOMETRY IS NOT HERE — not the windoids', not the document
// windows'. A browser is resized and reopened on another monitor all the
// time, so a prior session's top/left is no truth worth re-asserting over a
// raster that may be nothing like the one it was dragged on: every boot
// places the windoids from the live raster and every document open lands
// its window on the doc box, cascaded (shell/layout.js, applied by
// shell/windows.js — this module never sees a window). Icons are different:
// they're the Finder's furniture, arranged by hand and expected to stay put
// (icons.js pulls a saved position on-raster at boot and re-pins it across
// browser resizes).
//
// Restore happens at boot before first paint (main.js reads `saved`;
// icons.js applies positions). The `docs` entries are NOT reopened at boot —
// what a load shows is the URL's call (?file=<name>, else the About box;
// main.js) — they hand a saved doc its remembered edited face when
// it IS opened. Writes are snapshot-on-exit plus a debounce on any store
// change or desktop gesture — snapshotting is cheap and loses nothing that
// matters. `?fresh=1` disables BOTH directions, so a capture neither reads
// nor clobbers a real session's state. Older blobs migrate shallowly: icons
// carry over (v1's `lastDocId` becomes the one docs entry), and the window
// geometry v1/v2 persisted is simply dropped.
// ---------------------------------------------------------------------------

import { files } from '../state/files.js';
import { shell } from '../state/shell.js';
import { workspace } from '../state/workspace.js';

const KEY = 'sprite-machine:desktop';
const VERSION = 3;
const WRITE_DEBOUNCE_MS = 400;

/** A docs entry carries identity + edited face only — never geometry. */
function docEntry(d) {
  return { fileId: d.fileId, face: d.face ?? null };
}

function migrate(parsed) {
  if (parsed?.v === VERSION) return parsed;
  if (parsed?.v === 2) {
    return {
      v: VERSION,
      docs: (parsed.docs ?? []).filter((d) => d && d.fileId).map(docEntry),
      activeFileId: parsed.activeFileId ?? null,
      icons: parsed.icons ?? {},
    };
  }
  if (parsed?.v === 1) {
    return {
      v: VERSION,
      docs: parsed.lastDocId ? [docEntry({ fileId: parsed.lastDocId })] : [],
      activeFileId: parsed.lastDocId ?? null,
      icons: parsed.icons ?? {},
    };
  }
  return null;
}

function load() {
  try {
    return migrate(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
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

    /** A saved icon position by key ("doc:<id>"), or null. (A stale blob
     *  may still carry retired "sample:*" entries; they simply never match
     *  an icon again.) */
    iconPos(key) {
      const p = saved?.icons?.[key];
      return Number.isFinite(p?.left) && Number.isFinite(p?.top) ? p : null;
    },

    /** The saved desktop pattern (a kit name or sixteen hex digits, as the
     *  panel set it), or null — a blob from before the setting, or a
     *  fresh boot. Validated by the wire (shell/patterns.js), not here. */
    desktopPattern() {
      const p = saved?.pattern;
      return typeof p === 'string' && p.trim() ? p : null;
    },

    /**
     * Start persisting. `iconsRoot` is the icon layer (positions are read
     * off the live elements at snapshot time — the properties ARE the truth
     * after any drag). The windows are deliberately not an input: nothing
     * about them persists.
     */
    start({ iconsRoot }) {
      if (fresh) return () => {};

      function snapshot() {
        // Open SAVED documents only: the edited face off each context.
        // Untitleds have nothing to reopen.
        const docs = [];
        for (const ctx of workspace.get().contexts) {
          if (!ctx.fileId) continue;
          docs.push(docEntry(ctx));
        }
        /** @type {Record<string, {left:number, top:number}>} */
        const icons = {};
        for (const icon of iconsRoot.querySelectorAll('vf-icon[data-key]')) {
          icons[icon.dataset.key] = { left: icon.left, top: icon.top };
        }
        return {
          v: VERSION,
          docs,
          activeFileId: workspace.active()?.fileId ?? null,
          icons,
          pattern: shell.get().desktopPattern,
        };
      }

      const write = () => {
        try {
          localStorage.setItem(KEY, JSON.stringify(snapshot()));
        } catch {
          // Quota/private-mode failures cost only icon memory.
        }
      };

      let timer = 0;
      const writeSoon = () => {
        clearTimeout(timer);
        timer = setTimeout(write, WRITE_DEBOUNCE_MS);
      };

      // Store changes (the open set, faces, the desktop pattern — the shell
      // slice's other flips schedule a harmless extra snapshot), desktop
      // gestures (icon drags end in a pointerup), and browser resizes
      // (every icon re-pins to the new raster) all schedule a write;
      // leaving the page flushes one synchronously.
      const unsubs = [
        files.subscribe(writeSoon),
        workspace.subscribe(writeSoon),
        shell.subscribe(writeSoon),
      ];
      const onPointerUp = () => writeSoon();
      const onHide = () => {
        if (document.visibilityState === 'hidden') write();
      };
      document.addEventListener('pointerup', onPointerUp);
      document.addEventListener('visibilitychange', onHide);
      window.addEventListener('resize', writeSoon);
      window.addEventListener('beforeunload', write);

      return () => {
        clearTimeout(timer);
        for (const u of unsubs) u();
        document.removeEventListener('pointerup', onPointerUp);
        document.removeEventListener('visibilitychange', onHide);
        window.removeEventListener('resize', writeSoon);
        window.removeEventListener('beforeunload', write);
      };
    },
  };
}
