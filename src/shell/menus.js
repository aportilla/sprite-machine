// ---------------------------------------------------------------------------
// Menu + dialog wiring for the desktop shell: vf-menu-select → store/file
// actions, checkmark + enabled sync, and every dialog flow (About, Open, the
// shared name prompt, Properties, the unsaved-changes alert, the
// storage-unavailable notice). Behavior only — the markup lives in
// index.html, the aesthetics in the kit. (Settings… is parked: the render
// toggles moved to the 3D View's controls strip, and the emptied item sits
// disabled in the markup until it has contents again.)
//
// MULTI-DOCUMENT GRAMMAR: File actions target the ACTIVE workspace context;
// New / Open / a drop always open a NEW window (opening never discards
// anything — the dirty check moved entirely to the close paths); opening an
// already-open stored doc activates its existing window. Quit walks every
// open document, one unsaved-changes alert per dirty one.
//
// The DIRTY CHECK has one funnel: `confirmDiscard(ctx, next)` — run `next`
// now if that document is clean, else raise the Save / Don't Save / Cancel
// alert (activating its window first, so the question points at what the
// user sees) and run it (after a save, or without one) only when the user
// chooses.
//
// Menu key equivalents are the KIT's (`shortcut` on vf-menu-item + the bar's
// `shortcuts` grant); a shortcut lands here as an ordinary vf-menu-select.
// Because those fire app-wide, every action guards on "no modal open" — a
// pointer can't reach a menu under a modal, so the guard only ever blocks
// re-entrant shortcuts (⌘S inside the save prompt).
// ---------------------------------------------------------------------------

import { session } from '../state/session.js';
import { build } from '../state/build.js';
import { shell } from '../state/shell.js';
import { files, UNTITLED, docFilename } from '../state/files.js';
import { workspace, followActive } from '../state/workspace.js';
import { TILE_MIN, TILE_MAX } from '../lib/atlas.js';
import { SAMPLES } from '../lib/sprite-data.js';
import { loadSample, loadBlank } from '../loaders.js';
import { downloadPngBytes } from '../image-io.js';

/**
 * @param {import('vintage-frames').VfDesktop} desktop
 * @param {ReturnType<typeof import('./windows.js').initWindows>} windows
 */
export function initMenus(desktop, windows) {
  const $ = (sel) => {
    const el = desktop.querySelector(sel);
    if (!el) throw new Error(`shell/menus: missing element ${sel}`);
    return /** @type {any} */ (el);
  };

  /** @type {(() => void)[]} */
  const teardown = [];
  const on = (el, type, fn) => {
    el.addEventListener(type, fn);
    teardown.push(() => el.removeEventListener(type, fn));
  };
  const menuDetail = (e) => /** @type {CustomEvent} */ (e).detail;

  // A shortcut-triggered action must not fire under an open modal (the
  // Colors picker lives in shadow DOM, so it's checked via its session flag).
  const modalOpen = () =>
    session.get().pickerOpen || !!desktop.querySelector('vf-dialog[open]');

  // --- dialogs ----------------------------------------------------------------
  const dlgAbout = $('#dlg-about');
  const dlgOpen = $('#dlg-open');
  const dlgName = $('#dlg-name');
  const dlgProps = $('#dlg-props');
  const dlgUnsaved = $('#dlg-unsaved');
  const dlgStorage = $('#dlg-storage');

  on($('#btn-about-ok'), 'click', () => dlgAbout.close());
  on($('#btn-storage-ok'), 'click', () => dlgStorage.close());
  on($('#btn-props-ok'), 'click', () => dlgProps.close());

  // The one name-prompt dialog, two uses (first save / rename): resolves the
  // committed name, or null on Cancel/Escape — the vf-close event is the
  // single resolution point, so no path can resolve twice.
  const nameField = $('#name-field');
  const btnNameOk = $('#btn-name-ok');
  let namePending = null; // { resolve, value } while the dialog is up
  function promptName(heading, initial, okLabel) {
    dlgName.heading = heading;
    nameField.value = initial;
    btnNameOk.textContent = okLabel;
    dlgName.show();
    nameField.focus();
    return new Promise((resolve) => {
      namePending = { resolve, value: null };
    });
  }
  on(btnNameOk, 'click', () => {
    const v = String(nameField.value ?? '').trim();
    if (!v) return; // an empty name is refused, like the icon rename
    if (namePending) namePending.value = v;
    dlgName.close();
  });
  on($('#btn-name-cancel'), 'click', () => dlgName.close());
  on(nameField, 'keydown', (e) => {
    if (e.key === 'Enter') btnNameOk.click();
  });
  on(dlgName, 'vf-close', () => {
    const p = namePending;
    namePending = null;
    p?.resolve(p.value);
  });

  // The unsaved-changes alert. `discardPending` holds the context asked
  // about and the action the user was attempting; each button takes it
  // before closing (vf-close only clears a leftover — the Escape path).
  const unsavedMsg = $('#unsaved-msg');
  let discardPending = null; // { ctx, next }
  function confirmDiscard(ctx, next) {
    if (!ctx || !ctx.dirty) {
      next();
      return;
    }
    // Point the question at what the user sees: the asked-about document's
    // window comes forward first (the System 7 quit cascade's behavior).
    windows.activateContext(ctx.key);
    discardPending = { ctx, next };
    unsavedMsg.textContent = `Save changes to “${ctx.name}” before closing?`;
    dlgUnsaved.show();
  }
  on($('#btn-unsaved-dont'), 'click', () => {
    const p = discardPending;
    discardPending = null;
    dlgUnsaved.close();
    p?.next();
  });
  on($('#btn-unsaved-cancel'), 'click', () => {
    discardPending = null;
    dlgUnsaved.close();
  });
  on($('#btn-unsaved-save'), 'click', () => {
    const p = discardPending;
    discardPending = null;
    dlgUnsaved.close();
    if (p) saveThen(p.ctx, p.next);
  });
  on(dlgUnsaved, 'vf-close', () => {
    discardPending = null;
  });

  // --- save / open flows ------------------------------------------------------
  // Save a context, then run `next`. An untitled doc prompts for its name
  // first; a Cancel there cancels the whole chain (System 7 semantics).
  async function saveThen(ctx, next) {
    if (!files.get().available) {
      dlgStorage.show();
      return;
    }
    try {
      if (ctx.fileId) {
        await workspace.save(ctx.key);
      } else {
        const initial = ctx.name;
        const name = await promptName(
          'Save',
          initial === UNTITLED || /^untitled \d+$/.test(initial) ? '' : initial,
          'Save'
        );
        if (name == null) return;
        await workspace.save(ctx.key, name);
      }
      next?.();
    } catch (err) {
      build.setError(`Save failed: ${err.message}`);
    }
  }

  // Opening NEVER discards: a sample is always a fresh untitled window, a
  // stored doc opens once and re-activates thereafter.
  const openSample = async (i) => {
    const ctx = await loadSample(SAMPLES[i]);
    if (ctx) windows.activateContext(ctx.key);
  };

  const openDoc = async (id) => {
    try {
      const res = await workspace.openStored(id);
      if (res) windows.activateContext(res.ctx.key);
    } catch (err) {
      build.setError(`Couldn't open the document: ${err.message}`);
    }
  };

  const newDocument = () => {
    const ctx = loadBlank();
    if (ctx) windows.activateContext(ctx.key);
  };

  // Close one document (dirty-checked). The window goes with the context;
  // closing the last one deactivates the application via the kit (no
  // document window left to hold active).
  const closeContext = (ctx) =>
    confirmDiscard(ctx, () => {
      workspace.close(ctx.key);
    });

  // Quit: the System 7 cascade — every open document in turn, one
  // unsaved-changes alert per dirty one (its window brought forward as it's
  // asked about); Cancel anywhere aborts the rest. A completed quit leaves
  // the bare desktop, the windoid arrangement intact.
  const quit = () => {
    const ctxs = workspace.get().contexts;
    if (!ctxs.length) return;
    const ctx = workspace.active() ?? ctxs[ctxs.length - 1];
    confirmDiscard(ctx, () => {
      workspace.close(ctx.key);
      quit();
    });
  };

  // Finder grammar for Open: with the desktop focused, Open acts on the
  // selected icon (the gate below disables it with none selected).
  const openSelection = () => {
    for (const key of shell.get().iconSelection) {
      if (key.startsWith('sample:')) {
        const name = key.slice('sample:'.length);
        const i = SAMPLES.findIndex((s) => s.name === name);
        if (i >= 0) openSample(i);
      } else if (key.startsWith('doc:')) {
        openDoc(key.slice('doc:'.length));
      }
    }
  };

  // --- the Open dialog --------------------------------------------------------
  const openList = $('#open-list');
  const listItem = (value, text) => {
    const item = document.createElement('vf-list-item');
    item.value = value;
    item.textContent = text;
    return item;
  };
  function showOpenDialog() {
    const rows = [];
    SAMPLES.forEach((s, i) => rows.push(listItem(`sample:${i}`, `${s.name} (sample)`)));
    for (const r of files.get().list) {
      const when = new Date(r.modifiedAt).toLocaleDateString();
      rows.push(listItem(`doc:${r.id}`, `${r.name} — ${r.w}×${r.h}px, ${when}`));
    }
    openList.replaceChildren(...rows);
    dlgOpen.show();
  }
  function actOnOpenPick() {
    const v = openList.value;
    if (!v) return;
    dlgOpen.close();
    if (v.startsWith('sample:')) openSample(+v.slice('sample:'.length));
    else openDoc(v.slice('doc:'.length));
  }
  on($('#btn-open-ok'), 'click', actOnOpenPick);
  on($('#btn-open-cancel'), 'click', () => dlgOpen.close());
  on(openList, 'dblclick', actOnOpenPick);

  // --- the Properties dialog --------------------------------------------------
  // Reads the ACTIVE document; re-syncs while open on any workspace change or
  // structural change of the active doc (followActive re-wires the latter).
  const propsName = $('#props-name');
  const propsDims = $('#props-dims');
  const propsTile = $('#props-tile');
  propsTile.min = TILE_MIN;
  propsTile.max = TILE_MAX;
  const syncProps = () => {
    if (!dlgProps.open) return;
    const ctx = workspace.active();
    const d = ctx?.doc.get();
    propsName.textContent = ctx?.name ?? '';
    propsDims.textContent = d?.atlasImage
      ? `${d.atlasImage.width}px × ${d.atlasImage.height}px`
      : '—';
    propsTile.value = String(d?.tileW || 0);
  };
  teardown.push(
    workspace.subscribe(syncProps),
    followActive(workspace, (ctx) => (ctx ? ctx.doc.subscribe(syncProps) : undefined))
  );
  on(propsTile, 'vf-change', (e) => {
    const ctx = workspace.active();
    if (!ctx) return;
    const n = e.detail.valueAsNumber;
    if (Number.isFinite(n) && n !== ctx.doc.get().tileW) {
      // The relocated tile stepper: a square, centered, undoable resize —
      // on the active document, in its own history.
      ctx.history.withAtlasSnapshot(() => ctx.doc.resizeTiles(n, n));
    }
  });

  // --- menus ------------------------------------------------------------------
  on($('#menu-app'), 'vf-menu-select', (e) => {
    if (modalOpen()) return;
    // No 'settings' case: the item sits disabled in the markup (parked — see
    // the file header), and a disabled item never fires by kit contract.
    switch (menuDetail(e).value) {
      case 'about':
        dlgAbout.show();
        break;
      case 'quit':
        quit();
        break;
    }
  });

  on($('#menu-file'), 'vf-menu-select', (e) => {
    if (modalOpen()) return;
    const active = () => workspace.active();
    switch (menuDetail(e).value) {
      case 'new':
        newDocument();
        break;
      case 'open':
        // Two grammars, one item: the application's Open… (the listing
        // dialog) while a document is focused; the Finder's Open (act on the
        // selected icons) while the desktop is.
        if (shell.get().appActive) showOpenDialog();
        else openSelection();
        break;
      case 'close': {
        const ctx = active();
        if (ctx) closeContext(ctx);
        break;
      }
      case 'save': {
        const ctx = active();
        if (ctx) saveThen(ctx, null);
        break;
      }
      case 'duplicate': {
        const ctx = active();
        if (!ctx) break;
        if (!files.get().available) dlgStorage.show();
        else
          workspace
            .duplicate(ctx.key)
            // The copy opens in its own window, System 7's Finder-Duplicate
            // reading — the original window stays put.
            .then((id) => (id ? openDoc(id) : null))
            .catch((err) => build.setError(`Duplicate failed: ${err.message}`));
        break;
      }
      case 'rename': {
        const ctx = active();
        if (!ctx) break;
        promptName('Rename', ctx.name, 'Rename').then((name) => {
          if (name != null) {
            workspace
              .rename(ctx.key, name)
              .catch((err) => build.setError(`Rename failed: ${err.message}`));
          }
        });
        break;
      }
      case 'export': {
        const ctx = active();
        if (!ctx) break;
        workspace
          .exportOf(ctx.key)
          .then(({ bytes, name }) => downloadPngBytes(bytes, docFilename(name)))
          .catch((err) => build.setError(`Export failed: ${err.message}`));
        break;
      }
      case 'properties':
        dlgProps.show();
        syncProps();
        break;
    }
  });

  on($('#menu-edit'), 'vf-menu-select', (e) => {
    if (modalOpen()) return;
    switch (menuDetail(e).value) {
      case 'undo':
        workspace.active()?.history.undo();
        break;
      case 'redo':
        workspace.active()?.history.redo();
        break;
      case 'pick-color':
        session.openPicker();
        break;
    }
  });

  on($('#menu-tools'), 'vf-menu-select', (e) => {
    if (modalOpen()) return;
    const v = menuDetail(e).value;
    if (v.startsWith('tool-'))
      session.setTool(/** @type {any} */ (v.slice('tool-'.length)));
  });

  on($('#menu-view'), 'vf-menu-select', (e) => {
    if (modalOpen()) return;
    if (menuDetail(e).value === 'show-grid') shell.setShowGrid(!shell.get().showGrid);
  });

  // --- checkmark + enabled sync ----------------------------------------------
  // Undo/Redo render disabled until the ACTIVE document's history has
  // something — which also hands their key strokes back to the browser (a
  // disabled item's shortcut deliberately never fires, so ⌘Z in a text field
  // stays native undo) — and, like every document-scoped item, while the
  // desktop is focused. followActive re-wires the history subscription as
  // activation moves between windows.
  const itemUndo = $('vf-menu-item[value="undo"]');
  const itemRedo = $('vf-menu-item[value="redo"]');
  const syncEdit = () => {
    const appActive = shell.get().appActive;
    const h = workspace.active()?.history.get();
    itemUndo.disabled = !appActive || !h?.canUndo;
    itemRedo.disabled = !appActive || !h?.canRedo;
  };
  teardown.push(
    shell.subscribe(syncEdit),
    followActive(workspace, (ctx) => (ctx ? ctx.history.subscribe(syncEdit) : undefined)),
    workspace.subscribe(syncEdit)
  );
  syncEdit();

  // --- focus gating ------------------------------------------------------------
  // Two roles share one menu bar (the single-application affordance): with
  // the desktop focused, every document-scoped item greys out. About / Quit /
  // New stay — they're app-level (the parked Settings… is disabled in the
  // markup in both roles) — and Open switches to the
  // Finder grammar above: enabled iff a desktop icon is selected. Disabling
  // an item also parks its key equivalent (the kit never fires a disabled
  // item's shortcut), so ⌘O/⌘S/⌘K/⌘G gate with their menus; the bare-letter
  // tool keys get the same guard in src/shortcuts.js.
  const DOC_SCOPED = [
    'close',
    'save',
    'duplicate',
    'rename',
    'export',
    'properties',
    'pick-color',
    'tool-pencil',
    'tool-rect',
    'tool-fill',
    'tool-eraser',
    'tool-eyedropper',
    'show-grid',
  ];
  const docItems = DOC_SCOPED.map((v) => $(`vf-menu-item[value="${v}"]`));
  const itemOpen = $('vf-menu-item[value="open"]');
  const syncGate = () => {
    const s = shell.get();
    for (const item of docItems) item.disabled = !s.appActive;
    itemOpen.disabled = !s.appActive && s.iconSelection.length === 0;
  };
  teardown.push(shell.subscribe(syncGate));
  syncGate();

  const itemGrid = $('vf-menu-item[value="show-grid"]');
  const syncView = () => {
    itemGrid.checked = !!shell.get().showGrid;
  };
  teardown.push(shell.subscribe(syncView));
  syncView();

  // The Tools menu mirrors the sticky tool modes — exactly one item checked,
  // off the same session truth the tool strip and the B/R/G/E/I keys write.
  const toolItems = ['pencil', 'rect', 'fill', 'eraser', 'eyedropper'].map((t) => [
    t,
    $(`vf-menu-item[value="tool-${t}"]`),
  ]);
  const syncTools = () => {
    for (const [t, item] of toolItems) item.checked = session.get().tool === t;
  };
  teardown.push(session.subscribe(syncTools));
  syncTools();

  // A document window's close box routes through the same dirty check.
  windows.onDocumentClose = (key) => {
    const ctx = workspace.byKey(key);
    if (ctx) closeContext(ctx);
  };

  return {
    actions: { confirmDiscard, openSample, openDoc, closeContext, saveThen },
    dispose() {
      for (const fn of teardown) fn();
    },
  };
}
