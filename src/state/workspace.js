// Workspace slice: the open documents, one DocContext each. activeKey names
// the active document window's context.
//
// - One context per stored document (openStored).
// - activeKey mirrors the desktop's vf-activate. Only setActive writes it,
//   from apps/sprite-editor/windows.js. Programmatic activation goes through
//   the kit's bringToFront.
// - Dirty tracking: a live stroke, a structural doc change or a ring setting
//   change marks a context dirty. A wholesale load marks it clean.
// - ctx.selection is its own store for the marquee (`bounds`) and the rect
//   tool's drag box (`rect`). Both change at pointer-move rate, so they stay
//   out of the workspace store.

import { createStore } from './store.js';
import { createDoc } from './doc.js';
import { createHistory } from './history.js';
import { createRingSettings } from './ring-settings.js';
import { files as filesSingleton, UNTITLED, copyName } from './files.js';

/**
 * @typedef {{
 *   key: string,
 *   doc: ReturnType<typeof createDoc>,
 *   history: ReturnType<typeof createHistory>,
 *   face: string,
 *   fileId: string|null,
 *   name: string,
 *   dirty: boolean,
 *   selection: ReturnType<typeof createStore<{bounds: SelectionBounds|null, rect: SelectionBounds|null}>>,
 *   ring: ReturnType<typeof createRingSettings>,
 * }} DocContext
 */
/** A selection rectangle in tile texels, inclusive. It may extend past the
 *  tile. The rect tool's drag box has the same shape.
 *  @typedef {{x0:number,y0:number,x1:number,y1:number}} SelectionBounds */

const sameBounds = (a, b) =>
  a === b ||
  (!!a && !!b && a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1);
/** @param {SelectionBounds|null} b  A copy of the caller's box, or null. */
const copyBounds = (b) => (b ? { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 } : null);

/**
 * @param {{
 *   files?: ReturnType<typeof import('./files.js').createFiles>,
 *   createDoc?: () => ReturnType<typeof createDoc>,
 *   createHistory?: (doc: any) => ReturnType<typeof createHistory>,
 * }} [deps]  Overrides for tests.
 */
export function createWorkspace(deps = {}) {
  const files = deps.files ?? filesSingleton;
  const makeDoc = deps.createDoc ?? (() => createDoc());
  const makeHistory = deps.createHistory ?? ((doc) => createHistory(doc));

  const store = createStore({
    /** @type {DocContext[]} in creation order */
    contexts: [],
    /** @type {string|null} the active document window's context key, or null */
    activeKey: null,
  });

  let nextKey = 1;
  /** @type {Map<string, () => void>} per-context tracker teardowns */
  const untrack = new Map();

  // Contexts are mutated in place. touch publishes a mutation by replacing the
  // array.
  const touch = () => store.patch({ contexts: [...store.get().contexts] });

  const byKey = (key) => store.get().contexts.find((c) => c.key === key) ?? null;

  const setDirty = (ctx, v) => {
    if (ctx.dirty === v) return;
    ctx.dirty = v;
    touch();
  };

  /** Clear the stored identity of every open context holding one of `ids`.
   *  Each keeps its pixels and name and is marked dirty.
   *  @param {string[]} ids */
  const forgetStored = (ids) => {
    const gone = new Set(ids);
    let moved = false;
    for (const c of store.get().contexts) {
      if (c.fileId == null || !gone.has(c.fileId)) continue;
      c.fileId = null;
      c.dirty = true;
      moved = true;
    }
    if (moved) touch();
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

    /** Whether any open document has unsaved changes. */
    anyDirty() {
      return store.get().contexts.some((c) => c.dirty);
    },

    /** The first name not open among "untitled", "untitled 2", … */
    nextUntitledName() {
      const used = new Set(store.get().contexts.map((c) => c.name));
      if (!used.has(UNTITLED)) return UNTITLED;
      for (let n = 2; ; n++) {
        const name = `${UNTITLED} ${n}`;
        if (!used.has(name)) return name;
      }
    },

    /**
     * Create a context with its doc, history and dirty tracker. The caller
     * loads pixels into `ctx.doc` next, and that load's sheet change leaves the
     * context clean. `ring` seeds the atlas settings before the tracker is
     * wired, so seeding does not mark the context dirty.
     * @param {{name?: string, fileId?: string|null, face?: string,
     *          ring?: Partial<import('./ring-settings.js').RingSettings>|null}} [init]
     * @returns {DocContext}
     */
    open({ name, fileId = null, face = 'left', ring = null } = {}) {
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
        selection: createStore({
          bounds: /** @type {SelectionBounds|null} */ (null),
          rect: /** @type {SelectionBounds|null} */ (null),
        }),
        ring: createRingSettings(ring),
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
        ctx.ring.subscribe(() => setDirty(ctx, true)),
      ];
      untrack.set(ctx.key, () => unsubs.forEach((u) => u()));
      store.patch({ contexts: [...store.get().contexts, ctx] });
      return ctx;
    },

    /**
     * Open a stored document: the existing context if one holds it, else a new
     * context loaded from storage. Resolves `{ctx, existed}`, or null when the
     * id is gone. Throws on a decode failure.
     * @param {string} id
     */
    async openStored(id) {
      const existing = this.byFileId(id);
      if (existing) return { ctx: existing, existed: true };
      const rec = await files.load(id);
      if (!rec) return null;
      const ctx = this.open({ name: rec.name, fileId: id, ring: rec.ring });
      ctx.doc.loadAtlas(rec.image, rec.transforms);
      return { ctx, existed: false };
    },

    /** Dispose a context. Closing the active context leaves activeKey null
     *  until vf-activate reports the next active window. */
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

    /** Called only by the beforeFront listener in apps/sprite-editor/windows.js.
     *  Null means no document window is active. */
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
     * Set a window's selection outline from the canvas's `sm-selection` event,
     * or null for none.
     * @param {string} key  @param {SelectionBounds|null} bounds
     */
    setSelection(key, bounds) {
      const ctx = byKey(key);
      if (!ctx) return;
      if (sameBounds(ctx.selection.get().bounds, bounds)) return;
      ctx.selection.patch({ bounds: copyBounds(bounds) });
    },

    /**
     * Set a window's rect tool drag box from the canvas's `sm-rect-drag` event,
     * or null between drags.
     * @param {string} key  @param {SelectionBounds|null} bounds
     */
    setRectDrag(key, bounds) {
      const ctx = byKey(key);
      if (!ctx) return;
      if (sameBounds(ctx.selection.get().rect, bounds)) return;
      ctx.selection.patch({ rect: copyBounds(bounds) });
    },

    /**
     * Save a context. An untitled context takes `name`. A saved one saves in
     * place. Resolves the stored id, or null when the doc holds nothing.
     * @param {string} key  @param {string} [name]
     */
    async save(key, name) {
      const ctx = byKey(key);
      if (!ctx) return null;
      const res = await files.save(ctx.doc, {
        fileId: ctx.fileId,
        name: name ?? ctx.name,
        ring: ctx.ring.get(),
      });
      if (!res) return null;
      ctx.fileId = res.id;
      ctx.name = res.name;
      ctx.dirty = false;
      touch();
      return res.id;
    },

    /** Save a copy in the original's folder, or on the desktop for an untitled
     *  context, named by files.js copyName ("Car copy", "Car copy 2"). The
     *  context is unchanged. Resolves the copy's stored id. */
    async duplicate(key) {
      const ctx = byKey(key);
      if (!ctx) return null;
      const st = files.get();
      const orig = ctx.fileId ? st.list.find((r) => r.id === ctx.fileId) : null;
      const folder = orig?.folder ?? null;
      const res = await files.save(ctx.doc, {
        fileId: null,
        name: copyName(st, folder, `${ctx.name} copy`, 'doc'),
        ring: ctx.ring.get(),
        folder,
      });
      return res ? res.id : null;
    },

    /** Rename a context. A saved one renames its stored doc (renameStored). An
     *  untitled one takes the display name. */
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

    /** Rename a stored doc by id. Open contexts holding it follow. */
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

    /** Delete a stored doc. An open context holding it keeps its pixels, loses
     *  its stored identity and is marked dirty (forgetStored). */
    async removeStored(id) {
      await files.remove(id);
      forgetStored([id]);
    },

    /** Empty the Trash (files.emptyTrash). Open contexts holding a removed
     *  document are handled as in removeStored. Resolves what was removed. */
    async emptyTrash() {
      const removed = await files.emptyTrash();
      forgetStored(removed.docs);
      return removed;
    },

    /** The bytes File → Download saves for a context. */
    async exportOf(key) {
      const ctx = byKey(key);
      if (!ctx) return null;
      return files.exportBytes(ctx.doc, {
        fileId: ctx.fileId,
        name: ctx.name,
        dirty: ctx.dirty,
        ring: ctx.ring.get(),
      });
    },
  };
  return api;
}

/**
 * Call `wire` with the active context now and on every activeKey change,
 * running the previous wiring's teardown first.
 *
 * @param {ReturnType<typeof createWorkspace>} workspace
 * @param {(ctx: DocContext|null) => (void | (() => void))} wire
 * @returns {() => void} stop following (tears the current wiring down too)
 */
export function followActive(workspace, wire) {
  let key; // undefined ≠ null, so the first apply always wires
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

export const workspace = createWorkspace();
