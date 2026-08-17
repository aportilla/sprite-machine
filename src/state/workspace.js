// ---------------------------------------------------------------------------
// `workspace` slice — the OPEN documents. Each open document is a
// DocContext: its own canonical doc (state/doc.js, the two-channel
// contract), its own bounded undo history, its stored identity
// (fileId/name/dirty), and its per-window view state (which face the editor
// shows). The slice holds the contexts BY REFERENCE (store idiom) plus
// `activeKey` — which document window is the desktop's active one.
//
// ONE DOCUMENT = ONE WINDOW: contexts are created by the open paths (File →
// New, a sample or stored doc, a dropped PNG — loaders.js / openStored) and
// disposed by close. Opening an already-open stored doc never makes a second
// context — the caller activates the existing window instead (System 7: one
// window per document).
//
// ACTIVATION MIRRORS THE KIT: the desktop's vf-activate event is the truth,
// and shell/windows.js writes it here via setActive — nothing else does.
// Programmatic activation goes through the window layer (bringToFront), so
// the event remains the single writer and the mirror can never disagree
// with the pixels.
//
// DIRTY TRACKING rides each context's doc channels (the wiring the files
// slice used to own): any live stroke or structural change marks the
// context dirty; a wholesale load — the context's birth, or a stored open —
// marks it clean. Identity never auto-resets: a context is born from
// exactly one load, so "a new sheet arrived in an existing doc" stopped
// being a thing the tracker has to disambiguate.
// ---------------------------------------------------------------------------

import { createStore } from './store.js';
import { createDoc } from './doc.js';
import { createHistory } from './history.js';
import { files as filesSingleton, UNTITLED } from './files.js';

/**
 * @typedef {{
 *   key: string,
 *   doc: ReturnType<typeof createDoc>,
 *   history: ReturnType<typeof createHistory>,
 *   face: string,
 *   fileId: string|null,
 *   name: string,
 *   dirty: boolean,
 *   hooks: object|null,
 * }} DocContext
 */

/**
 * @param {{
 *   files?: ReturnType<typeof import('./files.js').createFiles>,
 *   createDoc?: () => ReturnType<typeof createDoc>,
 *   createHistory?: (doc: any) => ReturnType<typeof createHistory>,
 * }} [deps]  Injectable for Node tests (a files stub, a doc with a fake
 *   frame scheduler); the app singleton takes the real ones.
 */
export function createWorkspace(deps = {}) {
  const files = deps.files ?? filesSingleton;
  const makeDoc = deps.createDoc ?? (() => createDoc());
  const makeHistory = deps.createHistory ?? ((doc) => createHistory(doc));

  const store = createStore({
    /** @type {DocContext[]} in creation order (the stagger index) */
    contexts: [],
    /** @type {string|null} the active document window's context, or null =
     *  the desktop is focused ("the Finder") */
    activeKey: null,
  });

  let nextKey = 1;
  /** @type {Map<string, () => void>} per-context tracker teardowns */
  const untrack = new Map();

  // Contexts are mutated in place (by-reference store idiom); a touch
  // publishes the mutation by replacing the array identity.
  const touch = () => store.patch({ contexts: [...store.get().contexts] });

  const byKey = (key) => store.get().contexts.find((c) => c.key === key) ?? null;

  const setDirty = (ctx, v) => {
    if (ctx.dirty === v) return;
    ctx.dirty = v;
    touch();
  };

  const api = {
    store,
    get: store.get,
    subscribe: store.subscribe,

    byKey,

    /** The open context holding a stored doc, or null. */
    byFileId(id) {
      return store.get().contexts.find((c) => c.fileId === id) ?? null;
    },

    /** The active context, or null while the desktop is focused. */
    active() {
      const { activeKey } = store.get();
      return activeKey == null ? null : byKey(activeKey);
    },

    /** Any open document with unsaved changes (the beforeunload guard). */
    anyDirty() {
      return store.get().contexts.some((c) => c.dirty);
    },

    /** The next free untitled name: "untitled", "untitled 2", … over the
     *  names currently open. */
    nextUntitledName() {
      const used = new Set(store.get().contexts.map((c) => c.name));
      if (!used.has(UNTITLED)) return UNTITLED;
      for (let n = 2; ; n++) {
        const name = `${UNTITLED} ${n}`;
        if (!used.has(name)) return name;
      }
    },

    /**
     * Create a context (doc + history + dirty tracker). The caller loads
     * pixels into `ctx.doc` right after — the load's sheet bump is what
     * leaves the newborn context clean. The window layer reconciles a
     * document window into existence from the store change.
     * @param {{name?: string, fileId?: string|null, face?: string, hooks?: object|null}} [init]
     * @returns {DocContext}
     */
    open({ name, fileId = null, face = 'left', hooks = null } = {}) {
      const doc = makeDoc();
      /** @type {DocContext} */
      const ctx = {
        key: `d${nextKey++}`,
        doc,
        history: makeHistory(doc),
        face,
        fileId,
        name: name ?? this.nextUntitledName(),
        dirty: false,
        hooks,
      };
      let lastSheet = doc.get().sheet;
      const unsubs = [
        doc.subscribe((s) => {
          if (s.sheet !== lastSheet) {
            lastSheet = s.sheet;
            setDirty(ctx, false);
          } else {
            setDirty(ctx, true);
          }
        }),
        doc.onLive(() => setDirty(ctx, true)),
      ];
      untrack.set(ctx.key, () => unsubs.forEach((u) => u()));
      store.patch({ contexts: [...store.get().contexts, ctx] });
      return ctx;
    },

    /**
     * Open a stored document: the existing context if one already holds it
     * (one window per document), else a fresh context loaded from storage.
     * Resolves `{ctx, existed}`, or null when the id is gone; throws on a
     * decode failure (the caller surfaces it).
     * @param {string} id
     */
    async openStored(id) {
      const existing = this.byFileId(id);
      if (existing) return { ctx: existing, existed: true };
      const rec = await files.load(id);
      if (!rec) return null;
      const ctx = this.open({ name: rec.name, fileId: id });
      ctx.doc.loadAtlas(rec.image, rec.transforms);
      return { ctx, existed: false };
    },

    /** Dispose a context: tracker + history down, window layer reconciles
     *  the window away. An active close leaves activeKey null until the
     *  desktop promotes a survivor (vf-activate writes the mirror back). */
    close(key) {
      const ctx = byKey(key);
      if (!ctx) return;
      untrack.get(key)?.();
      untrack.delete(key);
      ctx.history.dispose();
      const s = store.get();
      store.patch({
        contexts: s.contexts.filter((c) => c.key !== key),
        activeKey: s.activeKey === key ? null : s.activeKey,
      });
    },

    /** The activation mirror — written ONLY from the desktop's vf-activate
     *  wire (shell/windows.js). Null = the desktop is focused. */
    setActive(key) {
      store.patch({ activeKey: key != null && byKey(key) ? key : null });
    },

    /** @param {string} key  @param {string} face  Which face this window edits. */
    setFace(key, face) {
      const ctx = byKey(key);
      if (!ctx || ctx.face === face) return;
      ctx.face = face;
      touch();
    },

    /**
     * Persist a context. An untitled context takes `name` (the UI prompts
     * first) and becomes saved; a saved one saves silently in place.
     * Resolves the stored id (null when the doc holds nothing).
     * @param {string} key  @param {string} [name]
     */
    async save(key, name) {
      const ctx = byKey(key);
      if (!ctx) return null;
      const res = await files.save(ctx.doc, {
        fileId: ctx.fileId,
        name: name ?? ctx.name,
      });
      if (!res) return null;
      ctx.fileId = res.id;
      ctx.name = res.name;
      ctx.dirty = false;
      touch();
      return res.id;
    },

    /** Save a copy as "«name» copy" (the context itself is untouched);
     *  resolves the copy's stored id — the caller opens it in a new window. */
    async duplicate(key) {
      const ctx = byKey(key);
      if (!ctx) return null;
      const res = await files.save(ctx.doc, {
        fileId: null,
        name: `${ctx.name} copy`,
      });
      return res ? res.id : null;
    },

    /** Rename a context. A saved one rewrites its stored Title chunk (and
     *  every open context of that doc follows); an untitled one just takes
     *  the display name. */
    async rename(key, name) {
      const ctx = byKey(key);
      if (!ctx) return;
      if (ctx.fileId) {
        await this.renameStored(ctx.fileId, name);
      } else {
        ctx.name = name;
        touch();
      }
    },

    /** Rename a STORED doc by id (the desktop-icon path converges here);
     *  open contexts holding it follow along. */
    async renameStored(id, name) {
      await files.renameById(id, name);
      let moved = false;
      for (const c of store.get().contexts) {
        if (c.fileId === id && c.name !== name) {
          c.name = name;
          moved = true;
        }
      }
      if (moved) touch();
    },

    /** Delete a stored doc. An open context holding it reverts to an
     *  untitled identity (its pixels stay open — only the stored copy is
     *  gone). */
    async removeStored(id) {
      await files.remove(id);
      let moved = false;
      for (const c of store.get().contexts) {
        if (c.fileId === id) {
          c.fileId = null;
          moved = true;
        }
      }
      if (moved) touch();
    },

    /** The bytes File → Export downloads for a context. */
    async exportOf(key) {
      const ctx = byKey(key);
      if (!ctx) return null;
      return files.exportBytes(ctx.doc, ctx);
    },
  };
  return api;
}

/**
 * Follow the ACTIVE document across activation changes: `wire(ctx|null)` runs
 * for the current active context now and again on every change of activeKey,
 * with the previous wiring's returned teardown run first. The primitive
 * behind every follow-the-active-document consumer (the rebuilder, the
 * Sprite View, the status readouts, the Edit-menu sync).
 *
 * @param {ReturnType<typeof createWorkspace>} workspace
 * @param {(ctx: DocContext|null) => (void | (() => void))} wire
 * @returns {() => void} stop following (tears the current wiring down too)
 */
export function followActive(workspace, wire) {
  let key; // undefined ≠ null, so the initial apply always wires
  let teardown = null;
  const apply = () => {
    const k = workspace.get().activeKey;
    if (k === key) return;
    key = k;
    teardown?.();
    teardown = wire(workspace.active()) ?? null;
  };
  const unsub = workspace.subscribe(apply);
  apply();
  return () => {
    unsub();
    teardown?.();
    teardown = null;
  };
}

// The app-wide singleton (one desktop per page).
export const workspace = createWorkspace();
