// ---------------------------------------------------------------------------
// Desktop state in localStorage — tiny, synchronous at boot, exactly what
// it's good at (the documents themselves — and the folders they sit in —
// live in IndexedDB). One versioned JSON key, v3: per-icon position (by
// item — "doc:<id>", "folder:<id>" — in its CURRENT container's
// coordinates: the desktop's raster or a folder window's plane; which
// container is the library's business) and per-open-SAVED-document edited
// face (untitled windows are deliberately absent — no autosave, explicit
// Save is the contract) plus which document was active, and the DESKTOP PATTERN
// (the Desktop Patterns panel's setting — System 7 kept it in the System
// file; here it's the one desktop setting that persists) — and the SEEDED
// flag: whether the profile's first-ever boot has stored the built-in
// defaults (Car, Cube). An older v3 blob may still carry the retired
// `showGrid` flag (it parses fine and drops on the next write) or lack
// `pattern` (it reads null — the dither).
//
// THE SEEDED FLAG (Sep 5 2026) is the seeding's transaction record. The
// first-boot seeding used to be gated on "no desktop-state blob exists" —
// but this module writes a blob on its own schedule (a debounced snapshot
// on any store change, a synchronous one on beforeunload), so a reload that
// landed DURING the seeding's IndexedDB round-trips (a crash, a reload
// mid-boot) wrote a blob first, and the
// next boot read "prior state", never seeded, and left a profile with no
// Car and no Cube for good. Now the gate is `seeded`, which main.js sets —
// through markSeeded(), written at once, not debounced — only after every
// built-in is stored: an interrupted first boot carries `seeded: false` and
// completes on the next boot (the loader skips the built-ins already
// stored, by name, so nothing doubles), and deleting or emptying later still
// never resurrects them (the flag stays true). A blob from before the flag
// reads as seeded (migrate — under the old rule its very existence had
// already decided that), as do v1 / v2 blobs.
//
// AN APPLICATION WINDOW'S GEOMETRY IS NOT HERE — not the windoids', not the
// document windows'. A browser is resized and reopened on another monitor
// all the time, so a prior session's top/left is no truth worth
// re-asserting over a raster that may be nothing like the one it was
// dragged on: every boot places the windoids from the live raster and every
// document open lands its window on the doc box, cascaded (shell/layout.js,
// applied by shell/windows.js). The FINDER'S furniture is different —
// arranged by hand and expected to stay put: the icons (icons.js pulls a
// saved position on-raster at boot and re-pins it across browser resizes)
// and, since Sep 8 2026, the FOLDER WINDOWS' boxes — `windows`, keyed like
// their icons (`folder:<id>`) — stored not as boxes but as their nine-slice
// PINS (layout.js pinOf: relative terms — each edge a strut's offset from
// the raster's edge or a spring's fraction of its middle), read from the
// live window at every snapshot (shell/folders.js pins(), merged over the
// map last written like the icons, so a closed window's stays) and
// re-expressed by the next open on the raster it has then (folders.js,
// windows.js addPanel), so a folder window comes back on screen even when
// the browser changed shape between opens. A v3 blob from before them
// reads none; a record that is not a pin reads as none (layout.js isPin).
//
// Restore happens at boot before first paint (main.js reads `saved`;
// icons.js applies positions). The `docs` entries are NOT reopened at boot —
// what a load shows is the URL's call (?file=<name>, else the About box;
// main.js) — they hand a saved doc its remembered edited face when
// it IS opened. Writes are snapshot-on-exit plus a debounce on any store
// change or desktop gesture — snapshotting is cheap and loses nothing that
// matters. `?fresh=1` disables BOTH directions, so a ?fresh boot neither
// reads nor clobbers a real session's state. Older blobs migrate shallowly: icons
// carry over (v1's `lastDocId` becomes the one docs entry), and the window
// geometry v1/v2 persisted is simply dropped.
// ---------------------------------------------------------------------------

import { files } from '../state/files.js';
import { shell } from '../state/shell.js';
import { workspace } from '../state/workspace.js';
import { isPin } from './layout.js';

const KEY = 'sprite-machine:desktop';
const VERSION = 3;
const WRITE_DEBOUNCE_MS = 400;

/** A docs entry carries identity + edited face only — never geometry. */
function docEntry(d) {
  return { fileId: d.fileId, face: d.face ?? null };
}

/**
 * A parsed blob of any version → the current shape, or null for nothing
 * usable. Exported for its Node test: the `seeded` reading is the seeding's
 * transaction record (header) — a blob that states the flag keeps it, a
 * blob from before the flag (any version) reads as seeded.
 * @param {any} parsed
 */
export function migrateDesktopState(parsed) {
  if (parsed?.v === VERSION) return { ...parsed, seeded: parsed.seeded !== false };
  if (parsed?.v === 2) {
    return {
      v: VERSION,
      docs: (parsed.docs ?? []).filter((d) => d && d.fileId).map(docEntry),
      activeFileId: parsed.activeFileId ?? null,
      icons: parsed.icons ?? {},
      seeded: true,
    };
  }
  if (parsed?.v === 1) {
    return {
      v: VERSION,
      docs: parsed.lastDocId ? [docEntry({ fileId: parsed.lastDocId })] : [],
      activeFileId: parsed.lastDocId ?? null,
      icons: parsed.icons ?? {},
      seeded: true,
    };
  }
  return null;
}

function load() {
  try {
    return migrateDesktopState(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return null;
  }
}

/** @param {boolean} fresh  ?fresh=1 — neither restore nor persist */
export function createDesktopState(fresh) {
  const saved = fresh ? null : load();
  // The seeding's record (header): false on a brand-new profile, or one
  // whose first boot was interrupted; true once main.js marks it — or on a
  // blob from before the flag.
  let seeded = saved?.seeded === true;
  /** The synchronous writer, once start() has wired one. */
  let writeNow = () => {};

  return {
    /** The restored state, or null (fresh boot / nothing stored / ?fresh). */
    saved,

    /** Has this profile's first-ever boot stored the built-in defaults? */
    seeded: () => seeded,

    /** Record that it has — written at once, so a reload a beat later finds
     *  the record and does not seed again. */
    markSeeded() {
      seeded = true;
      writeNow();
    },

    /** A saved icon position by key ("doc:<id>", "folder:<id>"), in the
     *  item's container's coordinates, or null. (A stale blob may still
     *  carry retired "sample:*" entries; they simply never match an icon
     *  again.) */
    iconPos(key) {
      const p = saved?.icons?.[key];
      return Number.isFinite(p?.left) && Number.isFinite(p?.top) ? p : null;
    },

    /** A saved folder window's nine-slice pin by key ("folder:<id>"), or
     *  null — a blob from before them, or a record that is not a pin (a
     *  garbled one reads as none, so the open takes the fresh placement
     *  rather than throwing in pinTo).
     *  @param {string} key
     *  @returns {import('./layout.js').Pin | null} */
    windowPin(key) {
      const p = saved?.windows?.[key];
      return isPin(p) ? p : null;
    },

    /** The saved desktop pattern (a kit name or sixteen hex digits, as the
     *  panel set it), or null — a blob from before the setting, or a
     *  fresh boot. Validated by the wire (shell/patterns.js), not here. */
    desktopPattern() {
      const p = saved?.pattern;
      return typeof p === 'string' && p.trim() ? p : null;
    },

    /**
     * Start persisting. `readIcons` is the icon layer's reading of every
     * position it knows, by key (shell/icons.js positions(): the live
     * elements' — the properties ARE the truth after any drag — under the
     * ones it remembers for a closed folder window's icons, and `null` for
     * an item filed away and not yet rendered in its new container). The
     * snapshot MERGES it over the map last written — an icon in a closed
     * folder window is not live, and a closed folder must not forget its
     * arrangement on the next write — so the blob keeps a position for
     * every item it has ever seen, each in its container's own
     * coordinates. `readWindows` is the folder windows' reading of every
     * pin it knows, by the same keys (shell/folders.js pins(): the open
     * windows' read live, the closed ones' as remembered), merged the same
     * way — the header's THE FINDER'S furniture. The application's windows
     * are deliberately not an input: nothing about them persists.
     * @param {{readIcons: () => Record<string, {left:number, top:number}|null>,
     *          readWindows?: () => Record<string, import('./layout.js').Pin>}} inputs
     */
    start({ readIcons, readWindows = () => ({}) }) {
      if (fresh) return () => {};
      /** @type {Record<string, {left:number, top:number}>} */
      let known = { ...(saved?.icons ?? {}) };
      /** @type {Record<string, import('./layout.js').Pin>} */
      let knownWindows = { ...(saved?.windows ?? {}) };

      function snapshot() {
        // Open SAVED documents only: the edited face off each context.
        // Untitleds have nothing to reopen.
        const docs = [];
        for (const ctx of workspace.get().contexts) {
          if (!ctx.fileId) continue;
          docs.push(docEntry(ctx));
        }
        /** @type {Record<string, {left:number, top:number}>} */
        const icons = { ...known };
        for (const [key, p] of Object.entries(readIcons())) {
          if (p) icons[key] = { left: p.left, top: p.top };
          else delete icons[key];
        }
        known = icons;
        const windows = { ...knownWindows, ...readWindows() };
        knownWindows = windows;
        return {
          v: VERSION,
          docs,
          activeFileId: workspace.active()?.fileId ?? null,
          icons,
          windows,
          pattern: shell.get().desktopPattern,
          seeded,
        };
      }

      const write = () => {
        try {
          localStorage.setItem(KEY, JSON.stringify(snapshot()));
        } catch {
          // Quota/private-mode failures cost only icon memory.
        }
      };
      writeNow = write;

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
        writeNow = () => {};
        for (const u of unsubs) u();
        document.removeEventListener('pointerup', onPointerUp);
        document.removeEventListener('visibilitychange', onHide);
        window.removeEventListener('resize', writeSoon);
        window.removeEventListener('beforeunload', write);
      };
    },
  };
}
