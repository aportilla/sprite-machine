// Workspace slice: the open documents, one DocContext each. activeKey names
// the active document window's context.
//
// - One context per stored document (openStored). A stored document is a
//   catalog item and its bytes (state/sheets.js). Its context's name follows
//   the item's, so a rename in the Finder reaches the open window.
// - activeKey mirrors the desktop's vf-activate. Only setActive writes it,
//   from apps/sprite-editor/windows.js. Programmatic activation goes through
//   the kit's bringToFront.
// - Dirty tracking: a live stroke, a structural doc change or a ring setting
//   change marks a context dirty. A wholesale load marks it clean.
// - ctx.face and ctx.layer are the face and layer the window edits. They are
//   UI state, so a switch never dirties. A structural change clamps the layer
//   to the layer count.
// - ctx.selection is its own store for the marquee (`bounds`), the rect tool's
//   drag box (`rect`) and whether the marquee's first operation has run
//   (`lifted`, which settles the all-faces option for its life). The first two
//   change at pointer-move rate, so they stay out of the workspace store.

import { copyName } from 'vintage-frames/shell/pure';
import { createStore } from './store.js';
import { createDoc } from './doc.js';
import { createHistory } from './history.js';
import { createRingSettings } from './ring-settings.js';
import { sheets as sheetsSingleton } from './sheets.js';
import { SPRITE } from './kinds.js';
import { UNTITLED } from './names.js';
import { sheetLayers } from '../lib/sheet-shape.js';

/**
 * @typedef {{
 *   key: string,
 *   doc: ReturnType<typeof createDoc>,
 *   history: ReturnType<typeof createHistory>,
 *   face: string,
 *   layer: number,
 *   fileId: string|null,
 *   name: string,
 *   dirty: boolean,
 *   selection: ReturnType<typeof createStore<{bounds: SelectionBounds|null, rect: SelectionBounds|null, lifted: boolean}>>,
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
 * What the workspace asks of the shell's catalog: its listing, an item, a
 * rename and its change signal.
 * @typedef {{
 *   get(): import('vintage-frames/shell/pure').CatalogState,
 *   item(id: string|null|undefined): import('vintage-frames/shell/pure').Item|null,
 *   rename(id: string, name: string): Promise<boolean>,
 *   subscribe(fn: () => void): () => void,
 * }} WorkspaceCatalog
 */

/**
 * @param {{
 *   sheets?: ReturnType<typeof import('./sheets.js').createSheets>,
 *   catalog?: WorkspaceCatalog|null,
 *   createDoc?: () => ReturnType<typeof createDoc>,
 *   createHistory?: (doc: any) => ReturnType<typeof createHistory>,
 * }} [deps]  Overrides for tests. The catalog is passed here or through init().
 */
export function createWorkspace(deps = {}) {
  const sheets = deps.sheets ?? sheetsSingleton;
  let catalog = deps.catalog ?? null;
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

  /** Each saved context takes its item's name. */
  const followNames = () => {
    let moved = false;
    for (const c of store.get().contexts) {
      const name = c.fileId ? catalog?.item(c.fileId)?.name : null;
      if (name != null && c.name !== name) {
        c.name = name;
        moved = true;
      }
    }
    if (moved) touch();
  };
  let unfollow = catalog ? catalog.subscribe(followNames) : () => {};

  const api = {
    store,
    get: store.get,
    subscribe: store.subscribe,

    /** Sets the catalog after construction, and follows its renames.
     *  @param {WorkspaceCatalog} realCatalog */
    init(realCatalog) {
      unfollow();
      catalog = realCatalog;
      unfollow = catalog.subscribe(followNames);
    },

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
     * @param {{name?: string, fileId?: string|null, face?: string, layer?: number,
     *          ring?: Partial<import('./ring-settings.js').RingSettings>|null}} [init]
     * @returns {DocContext}
     */
    open({ name, fileId = null, face = 'left', layer = 0, ring = null } = {}) {
      const doc = makeDoc();
      /** @type {DocContext} */
      const ctx = {
        key: `d${nextKey++}`,
        doc,
        history: makeHistory(doc),
        face,
        layer,
        fileId,
        name: name ?? this.nextUntitledName(),
        dirty: false,
        selection: createStore({
          bounds: /** @type {SelectionBounds|null} */ (null),
          rect: /** @type {SelectionBounds|null} */ (null),
          lifted: false,
        }),
        ring: createRingSettings(ring),
      };
      let lastSheet = doc.get().sheet;
      const unsubs = [
        // A new sheet leaves the context clean, any other change dirties it, and
        // either can shrink the layer count under ctx.layer.
        doc.subscribe((s) => {
          const dirty = s.sheet === lastSheet;
          lastSheet = s.sheet;
          const layer = Math.max(0, Math.min(ctx.layer, s.layers.length - 1));
          if (ctx.dirty === dirty && ctx.layer === layer) return;
          ctx.dirty = dirty;
          ctx.layer = layer;
          touch();
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
      const rec = await sheets.load(id);
      if (!rec) return null;
      // Another open of the same document finished during the load.
      const raced = this.byFileId(id);
      if (raced) return { ctx: raced, existed: true };
      const ctx = this.open({ name: rec.name, fileId: id, ring: rec.ring });
      ctx.doc.loadAtlas(rec.image, rec.transforms, {
        layers: sheetLayers(rec.image.width, rec.image.height),
        names: rec.names,
      });
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

    /** Which layer this window edits, clamped to the document's layers.
     *  @param {string} key  @param {number} layer */
    setLayer(key, layer) {
      const ctx = byKey(key);
      if (!ctx) return;
      const top = Math.max(0, ctx.doc.get().layers.length - 1);
      const next = Math.max(0, Math.min(top, Math.floor(Number(layer)) || 0));
      if (ctx.layer === next) return;
      ctx.layer = next;
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
      const patch = { bounds: copyBounds(bounds) };
      if (!bounds) patch.lifted = false; // the option is open again
      ctx.selection.patch(patch);
    },

    /**
     * Mark that a selection's first operation has run, which settles the
     * all-faces option for its life. Dropping the selection clears it.
     * @param {string} key  @param {boolean} v
     */
    setSelectionLifted(key, v) {
      const ctx = byKey(key);
      if (!ctx || ctx.selection.get().lifted === !!v) return;
      ctx.selection.patch({ lifted: !!v });
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
     * Save a context. An untitled context takes `name` and lands on the
     * desktop. A saved one saves in place. Resolves the stored id, or null
     * when the doc holds nothing.
     * @param {string} key  @param {string} [name]
     */
    async save(key, name) {
      const ctx = byKey(key);
      if (!ctx) return null;
      const res = await sheets.save(ctx.doc, {
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
     *  context, named by the catalog's copyName ("Car copy", "Car copy 2").
     *  The context is unchanged. Resolves the copy's stored id. */
    async duplicate(key) {
      const ctx = byKey(key);
      if (!ctx || !catalog) return null;
      const parent = (ctx.fileId ? catalog.item(ctx.fileId)?.parent : null) ?? null;
      const res = await sheets.save(ctx.doc, {
        fileId: null,
        name: copyName(catalog.get(), parent, `${ctx.name} copy`, SPRITE),
        ring: ctx.ring.get(),
        parent,
      });
      return res ? res.id : null;
    },

    /** Rename a context. A saved one renames its item, and every open context
     *  holding it follows. An untitled one takes the display name. */
    async rename(key, name) {
      const ctx = byKey(key);
      if (!ctx) return;
      if (ctx.fileId && catalog) {
        await catalog.rename(ctx.fileId, name);
        followNames();
      } else {
        ctx.name = name;
        touch();
      }
    },

    /** Clear the stored identity of every open context holding one of `ids`:
     *  their items went (Empty Trash, a restore). Each keeps its pixels and
     *  name and is marked dirty.
     *  @param {Iterable<string>} ids */
    forget(ids) {
      const gone = new Set(ids);
      let moved = false;
      for (const c of store.get().contexts) {
        if (c.fileId == null || !gone.has(c.fileId)) continue;
        c.fileId = null;
        c.dirty = true;
        moved = true;
      }
      if (moved) touch();
    },

    /** The bytes File → Download saves for a context. */
    async exportOf(key) {
      const ctx = byKey(key);
      if (!ctx) return null;
      return sheets.exportBytes(ctx.doc, {
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
