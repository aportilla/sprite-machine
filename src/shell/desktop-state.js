// Desktop state in localStorage: one versioned JSON key. Documents, folders and
// text files live in IndexedDB.
//
// - icons: positions by item key ("doc:<id>", "folder:<id>"), in the
//   coordinates of the item's current container (the desktop or a folder
//   window).
// - windows: folder window boxes as nine-slice pins (layout.js pinOf), keyed
//   like icons, so they stay on screen after a browser resize.
// - docs, activeFileId: each open saved document's edited face and layer, and
//   the active one. Documents are not reopened at boot. An entry restores the
//   face and layer when its document opens.
// - pattern: the desktop pattern.
// - greet: whether a load with no document to open shows the About box.
//   A blob without it reads true.
// - seeded, seededTexts: whether the built-in documents and text files have
//   been stored. main.js marks each only after the last item is stored, so an
//   interrupted first boot completes on the next one. A blob without seeded
//   reads as seeded. One without seededTexts reads unseeded.
//
// markSeeded, markSeededTexts and setGreet write at once, so an immediate
// reload still finds them. Other changes write after a debounce, and hiding or
// leaving the page writes at once. ?fresh=1 neither reads nor writes.

import { files } from '../state/files.js';
import { shell } from '../state/shell.js';
import { workspace } from '../state/workspace.js';
import { isPin } from './layout.js';

const KEY = 'sprite-machine:desktop';
const VERSION = 3;
const WRITE_DEBOUNCE_MS = 400;

function docEntry(d) {
  return { fileId: d.fileId, face: d.face ?? null, layer: d.layer ?? null };
}

/**
 * Migrates a parsed blob of any version to the current shape, or returns null.
 * @param {any} parsed
 */
export function migrateDesktopState(parsed) {
  if (parsed?.v === VERSION) {
    return {
      ...parsed,
      seeded: parsed.seeded !== false,
      // Only a stated true counts, so older blobs seed the text files once.
      seededTexts: parsed.seededTexts === true,
    };
  }
  if (parsed?.v === 2) {
    return {
      v: VERSION,
      docs: (parsed.docs ?? []).filter((d) => d && d.fileId).map(docEntry),
      activeFileId: parsed.activeFileId ?? null,
      icons: parsed.icons ?? {},
      seeded: true,
      seededTexts: false,
    };
  }
  if (parsed?.v === 1) {
    return {
      v: VERSION,
      docs: parsed.lastDocId ? [docEntry({ fileId: parsed.lastDocId })] : [],
      activeFileId: parsed.lastDocId ?? null,
      icons: parsed.icons ?? {},
      seeded: true,
      seededTexts: false,
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

/** @param {boolean} fresh  ?fresh=1: neither restore nor persist */
export function createDesktopState(fresh) {
  const saved = fresh ? null : load();
  let seeded = saved?.seeded === true;
  let seededTexts = saved?.seededTexts === true;
  let greet = saved?.greet !== false;
  /** The synchronous writer, once start() has set one. */
  let writeNow = () => {};

  return {
    /** The restored state, or null. */
    saved,

    /** Whether the built-in documents have been stored. */
    seeded: () => seeded,

    /** Marks the built-in documents stored and writes at once. */
    markSeeded() {
      seeded = true;
      writeNow();
    },

    /** Whether the built-in text files (src/texts/) have been stored. */
    seededTexts: () => seededTexts,

    /** Marks the built-in text files stored and writes at once. */
    markSeededTexts() {
      seededTexts = true;
      writeNow();
    },

    /** Whether a load with no document to open shows the About box. */
    greet: () => greet,

    /** Sets the About box's Show at startup and writes at once.
     *  @param {boolean} on */
    setGreet(on) {
      greet = !!on;
      writeNow();
    },

    /** A saved icon position by key ("doc:<id>", "folder:<id>"), in its
     *  container's coordinates, or null. */
    iconPos(key) {
      const p = saved?.icons?.[key];
      return Number.isFinite(p?.left) && Number.isFinite(p?.top) ? p : null;
    },

    /** A saved folder window's pin by key ("folder:<id>"), or null when
     *  missing or not a valid pin.
     *  @param {string} key
     *  @returns {import('./layout.js').Pin | null} */
    windowPin(key) {
      const p = saved?.windows?.[key];
      return isPin(p) ? p : null;
    },

    /** The saved desktop pattern, or null. shell/desktop-pattern.js validates
     *  it. */
    desktopPattern() {
      const p = saved?.pattern;
      return typeof p === 'string' && p.trim() ? p : null;
    },

    /**
     * Starts persisting and returns a stop function. readIcons and readWindows
     * are merged over the last written maps, so items in closed folder windows
     * keep their entries. A null position (an item filed away and not yet
     * rendered in its new container) removes its entry. onMoved subscribes to
     * moves that end without a pointerup, such as Clean Up.
     * @param {{readIcons: () => Record<string, {left:number, top:number}|null>,
     *          readWindows?: () => Record<string, import('./layout.js').Pin>,
     *          onMoved?: (fn: () => void) => () => void}} inputs
     */
    start({ readIcons, readWindows = () => ({}), onMoved = () => () => {} }) {
      if (fresh) return () => {};
      /** @type {Record<string, {left:number, top:number}>} */
      let known = { ...(saved?.icons ?? {}) };
      /** @type {Record<string, import('./layout.js').Pin>} */
      let knownWindows = { ...(saved?.windows ?? {}) };

      function snapshot() {
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
          seededTexts,
          greet,
        };
      }

      const write = () => {
        try {
          localStorage.setItem(KEY, JSON.stringify(snapshot()));
        } catch {
          // Ignore quota and private-mode failures.
        }
      };
      writeNow = write;

      let timer = 0;
      const writeSoon = () => {
        clearTimeout(timer);
        timer = setTimeout(write, WRITE_DEBOUNCE_MS);
      };

      const unsubs = [
        files.subscribe(writeSoon),
        workspace.subscribe(writeSoon),
        shell.subscribe(writeSoon),
        onMoved(writeSoon),
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
