// Desktop state in localStorage: one versioned JSON key. Documents, folders and
// text files live in IndexedDB.
//
// - icons: positions by item key ("doc:<id>", "folder:<id>"), in the
//   coordinates of the item's current container (the desktop or a folder
//   window).
// - windows: every window's box as a nine-slice pin (layout.js pinOf), keyed
//   like icons ("doc:<id>", "folder:<id>", "text:<id>", "windoid:<id>"), so
//   they stay on screen after a browser resize. An entry with a `z` was open at
//   the write, at that depth in the stacking order. An entry without one is a
//   box alone, which boot/restore.js never opens: a window closed in an earlier
//   session, or a windoid, which its application places itself. Depth belongs
//   to the windows open at the write, so closing one drops it.
// - active: the active window's key, or null.
// - docs: each open saved document's edited face and layer, restored when the
//   document opens.
// - showRing: whether the 3D Sprite Atlas was showing.
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
//
// The boot holds every write until it has reopened the session: a write while
// restore.js is still opening windows would drop the depth of the ones it has
// not reached, and they would not reopen next time.

import { files } from '../state/files.js';
import { prefs } from '../state/prefs.js';
import { shell } from '../state/shell.js';
import { workspace } from '../state/workspace.js';
import { isPin } from './layout.js';

const KEY = 'sprite-machine:desktop';
const VERSION = 4;
const WRITE_DEBOUNCE_MS = 400;

/** A saved window: its pin, and its depth while it was open.
 *  @typedef {{pin: import('./layout.js').Pin, z?: number}} WindowEntry */

function docEntry(d) {
  return { fileId: d.fileId, face: d.face ?? null, layer: d.layer ?? null };
}

/** A window entry with a valid pin, or null.
 *  @returns {WindowEntry|null} */
function windowEntry(e) {
  if (isPin(e)) return { pin: e }; // v3 held bare pins
  if (!isPin(e?.pin)) return null;
  return Number.isInteger(e.z) ? { pin: e.pin, z: e.z } : { pin: e.pin };
}

/** Every valid window entry of a parsed map.
 *  @returns {Record<string, WindowEntry>} */
function windowEntries(windows) {
  /** @type {Record<string, WindowEntry>} */
  const out = {};
  for (const [key, e] of Object.entries(windows ?? {})) {
    const w = windowEntry(e);
    if (w) out[key] = w;
  }
  return out;
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
  // v3 held bare folder pins and named the active document. Its boxes keep
  // their windows' places; none has a depth, so the first boot after the
  // upgrade opens nothing.
  if (parsed?.v === 3) {
    return {
      v: VERSION,
      docs: (parsed.docs ?? []).filter((d) => d && d.fileId).map(docEntry),
      active: parsed.activeFileId ? `doc:${parsed.activeFileId}` : null,
      icons: parsed.icons ?? {},
      windows: windowEntries(parsed.windows),
      showRing: false,
      pattern: parsed.pattern ?? null,
      greet: parsed.greet !== false,
      seeded: parsed.seeded !== false,
      seededTexts: parsed.seededTexts === true,
    };
  }
  if (parsed?.v === 2) {
    return {
      v: VERSION,
      docs: (parsed.docs ?? []).filter((d) => d && d.fileId).map(docEntry),
      active: parsed.activeFileId ? `doc:${parsed.activeFileId}` : null,
      icons: parsed.icons ?? {},
      windows: {},
      showRing: false,
      seeded: true,
      seededTexts: false,
    };
  }
  if (parsed?.v === 1) {
    return {
      v: VERSION,
      docs: parsed.lastDocId ? [docEntry({ fileId: parsed.lastDocId })] : [],
      active: parsed.lastDocId ? `doc:${parsed.lastDocId}` : null,
      icons: parsed.icons ?? {},
      windows: {},
      showRing: false,
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
  /** Whether writes are held (see hold). */
  let held = false;
  /** The synchronous writer, once start() has set one. */
  let writeNow = () => {};

  return {
    /** The restored state, or null. */
    saved,

    /** Holds every write until release(). The boot holds while it reopens the
     *  session. */
    hold() {
      held = true;
    },

    /** Releases the hold and writes what is on screen. */
    release() {
      held = false;
      writeNow();
    },

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

    /** A saved window's pin by key ("folder:<id>", "windoid:tools"), or null
     *  when missing or not a valid pin.
     *  @param {string} key
     *  @returns {import('./layout.js').Pin | null} */
    windowPin(key) {
      return windowEntry(saved?.windows?.[key])?.pin ?? null;
    },

    /** The windows that were open, deepest first. boot/restore.js reopens them
     *  in this order.
     *  @returns {{key: string, pin: import('./layout.js').Pin}[]} */
    openWindows() {
      const out = [];
      for (const [key, e] of Object.entries(saved?.windows ?? {})) {
        const w = windowEntry(e);
        if (w && Number.isInteger(w.z)) out.push({ key, pin: w.pin, z: w.z });
      }
      out.sort((a, b) => a.z - b.z);
      return out.map(({ key, pin }) => ({ key, pin }));
    },

    /** The active window's saved key, or null. */
    activeWindow() {
      const k = saved?.active;
      return typeof k === 'string' && k ? k : null;
    },

    /** A saved document's remembered face and layer, or null.
     *  @param {string} fileId */
    docState(fileId) {
      return saved?.docs?.find((d) => d?.fileId === fileId) ?? null;
    },

    /** Whether the 3D Sprite Atlas was showing. */
    showRing() {
      return saved?.showRing === true;
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
     *
     * readWindows reports every window its application has open, with `z` its
     * depth among the desktop's windows and `active` for the active one, plus
     * any box it remembers for a window closed this session, without a `z`.
     * @param {{readIcons: () => Record<string, {left:number, top:number}|null>,
     *          readWindows?: () => Record<string, {pin: import('./layout.js').Pin,
     *                                              z?: number, active?: boolean}>,
     *          onMoved?: (fn: () => void) => () => void}} inputs
     */
    start({ readIcons, readWindows = () => ({}), onMoved = () => () => {} }) {
      if (fresh) return () => {};
      /** @type {Record<string, {left:number, top:number}>} */
      let known = { ...(saved?.icons ?? {}) };
      /** @type {Record<string, WindowEntry>} */
      let knownWindows = windowEntries(saved?.windows);

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
        // A known window keeps its box and loses its depth: only the windows
        // open at this write carry a `z`, and one of them the active flag.
        /** @type {Record<string, WindowEntry>} */
        const windows = {};
        for (const [key, e] of Object.entries(knownWindows))
          windows[key] = { pin: e.pin };
        let active = null;
        for (const [key, e] of Object.entries(readWindows())) {
          const w = windowEntry(e);
          if (!w) continue;
          windows[key] = w;
          if (e.active) active = key;
        }
        knownWindows = windows;
        return {
          v: VERSION,
          docs,
          active,
          icons,
          windows,
          showRing: prefs.get().showRing,
          pattern: shell.get().desktopPattern,
          seeded,
          seededTexts,
          greet,
        };
      }

      const write = () => {
        if (held) return;
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
        prefs.subscribe(writeSoon),
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
