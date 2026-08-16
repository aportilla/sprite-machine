// ---------------------------------------------------------------------------
// Menu + dialog wiring for the desktop shell: vf-menu-select → store/file
// actions, checkmark + enabled sync, and every dialog flow (About, Settings,
// Open, the shared name prompt, Properties, the unsaved-changes alert, the
// storage-unavailable notice). Behavior only — the markup lives in
// index.html, the aesthetics in the kit.
//
// The DIRTY CHECK has one funnel: `confirmDiscard(next)` — run `next` now if
// the document is clean, else raise the Save / Don't Save / Cancel alert and
// run it (after a save, or without one) only when the user chooses. Every
// destructive path (New, Open, Close, Quit, an icon double-click) routes
// through it via the returned `actions`.
//
// Menu key equivalents are the KIT's (`shortcut` on vf-menu-item + the bar's
// `shortcuts` grant); a shortcut lands here as an ordinary vf-menu-select.
// Because those fire app-wide, every action guards on "no modal open" — a
// pointer can't reach a menu under a modal, so the guard only ever blocks
// re-entrant shortcuts (⌘S inside the save prompt).
// ---------------------------------------------------------------------------

import { session } from '../state/session.js';
import { doc } from '../state/doc.js';
import { prefs } from '../state/prefs.js';
import { build } from '../state/build.js';
import { shell } from '../state/shell.js';
import { files, UNTITLED, docFilename } from '../state/files.js';
import { history } from '../state/history.js';
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
  const dlgSettings = $('#dlg-settings');
  const dlgOpen = $('#dlg-open');
  const dlgName = $('#dlg-name');
  const dlgProps = $('#dlg-props');
  const dlgUnsaved = $('#dlg-unsaved');
  const dlgStorage = $('#dlg-storage');

  on($('#btn-about-ok'), 'click', () => dlgAbout.close());
  on($('#btn-settings-ok'), 'click', () => dlgSettings.close());
  on($('#btn-storage-ok'), 'click', () => dlgStorage.close());
  on($('#btn-props-ok'), 'click', () => dlgProps.close());

  // Settings ↔ prefs (live both ways: the dialog can stay open).
  const setLowpoly = $('#set-lowpoly');
  const setRotate = $('#set-rotate');
  const syncSettings = () => {
    setLowpoly.checked = !!prefs.get().lowpoly;
    setRotate.checked = !!prefs.get().autoRotate;
  };
  on(setLowpoly, 'vf-change', (e) => prefs.setLowpoly(e.detail.checked));
  on(setRotate, 'vf-change', (e) => prefs.setAutoRotate(e.detail.checked));
  teardown.push(prefs.subscribe(syncSettings));
  syncSettings();

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

  // The unsaved-changes alert. `discardNext` holds the action the user was
  // attempting; each button takes it before closing (vf-close only clears a
  // leftover — the Escape path).
  const unsavedMsg = $('#unsaved-msg');
  let discardNext = null;
  function confirmDiscard(next) {
    if (!files.get().dirty) {
      next();
      return;
    }
    discardNext = next;
    unsavedMsg.textContent = `Save changes to “${files.get().currentName}” before closing?`;
    dlgUnsaved.show();
  }
  on($('#btn-unsaved-dont'), 'click', () => {
    const next = discardNext;
    discardNext = null;
    dlgUnsaved.close();
    next?.();
  });
  on($('#btn-unsaved-cancel'), 'click', () => {
    discardNext = null;
    dlgUnsaved.close();
  });
  on($('#btn-unsaved-save'), 'click', () => {
    const next = discardNext;
    discardNext = null;
    dlgUnsaved.close();
    saveThen(next);
  });
  on(dlgUnsaved, 'vf-close', () => {
    discardNext = null;
  });

  // --- save / open flows ------------------------------------------------------
  // Save, then run `next`. An untitled doc prompts for its name first; a
  // Cancel there cancels the whole chain (System 7 semantics).
  async function saveThen(next) {
    if (!files.get().available) {
      dlgStorage.show();
      return;
    }
    try {
      if (files.get().currentId) {
        await files.saveCurrent();
      } else {
        const initial = files.get().currentName;
        const name = await promptName(
          'Save',
          initial === UNTITLED ? '' : initial,
          'Save'
        );
        if (name == null) return;
        await files.saveCurrent(name);
      }
      next?.();
    } catch (err) {
      build.setError(`Save failed: ${err.message}`);
    }
  }

  const openSample = (i) =>
    confirmDiscard(async () => {
      await loadSample(SAMPLES[i]);
      windows.showDocument();
    });

  const openDoc = (id) =>
    confirmDiscard(async () => {
      try {
        if (await files.open(id)) windows.showDocument();
      } catch (err) {
        build.setError(`Couldn't open the document: ${err.message}`);
      }
    });

  const closeDocument = () =>
    confirmDiscard(() => {
      files.close();
      shell.setWindowVisible('document', false);
    });

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
  const propsName = $('#props-name');
  const propsDims = $('#props-dims');
  const propsTile = $('#props-tile');
  propsTile.min = TILE_MIN;
  propsTile.max = TILE_MAX;
  const syncProps = () => {
    if (!dlgProps.open) return;
    const d = doc.get();
    propsName.textContent = files.get().currentName;
    propsDims.textContent = d.atlasImage
      ? `${d.atlasImage.width}px × ${d.atlasImage.height}px`
      : '—';
    propsTile.value = String(d.tileW || 0);
  };
  teardown.push(doc.subscribe(syncProps), files.subscribe(syncProps));
  on(propsTile, 'vf-change', (e) => {
    const n = e.detail.valueAsNumber;
    if (Number.isFinite(n) && n !== doc.get().tileW) {
      // The relocated tile stepper: a square, centered, undoable resize.
      history.withAtlasSnapshot(() => doc.resizeTiles(n, n));
    }
  });

  // --- menus ------------------------------------------------------------------
  on($('#menu-app'), 'vf-menu-select', (e) => {
    if (modalOpen()) return;
    switch (menuDetail(e).value) {
      case 'about':
        dlgAbout.show();
        break;
      case 'settings':
        syncSettings();
        dlgSettings.show();
        break;
      case 'quit':
        confirmDiscard(() => {
          files.close();
          shell.hideAll();
        });
        break;
    }
  });

  on($('#menu-file'), 'vf-menu-select', (e) => {
    if (modalOpen()) return;
    switch (menuDetail(e).value) {
      case 'new':
        confirmDiscard(() => {
          loadBlank();
          windows.showDocument();
        });
        break;
      case 'open':
        showOpenDialog();
        break;
      case 'close':
        closeDocument();
        break;
      case 'save':
        saveThen(null);
        break;
      case 'duplicate':
        if (!files.get().available) dlgStorage.show();
        else
          files
            .duplicate()
            .catch((err) => build.setError(`Duplicate failed: ${err.message}`));
        break;
      case 'rename':
        promptName('Rename', files.get().currentName, 'Rename').then((name) => {
          if (name != null) {
            files
              .rename(name)
              .catch((err) => build.setError(`Rename failed: ${err.message}`));
          }
        });
        break;
      case 'export':
        files
          .exportCurrent()
          .then(({ bytes, name }) => downloadPngBytes(bytes, docFilename(name)))
          .catch((err) => build.setError(`Export failed: ${err.message}`));
        break;
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
        history.undo();
        break;
      case 'redo':
        history.redo();
        break;
      case 'pick-color':
        session.openPicker();
        break;
    }
  });

  on($('#menu-tools'), 'vf-menu-select', (e) => {
    if (modalOpen()) return;
    const v = menuDetail(e).value;
    if (v === 'view-tools') shell.toggleWindow('tools');
    else if (v.startsWith('tool-'))
      session.setTool(/** @type {any} */ (v.slice('tool-'.length)));
  });

  on($('#menu-view'), 'vf-menu-select', (e) => {
    if (modalOpen()) return;
    switch (menuDetail(e).value) {
      case 'view-stage':
        shell.toggleWindow('stage');
        break;
      case 'view-sprite':
        shell.toggleWindow('sprite');
        break;
      case 'show-grid':
        shell.setShowGrid(!shell.get().showGrid);
        break;
    }
  });

  // --- checkmark + enabled sync ----------------------------------------------
  // Undo/Redo render disabled until the history has something — which also
  // hands their key strokes back to the browser (a disabled item's shortcut
  // deliberately never fires, so ⌘Z in a text field stays native undo).
  const itemUndo = $('vf-menu-item[value="undo"]');
  const itemRedo = $('vf-menu-item[value="redo"]');
  const syncEdit = () => {
    itemUndo.disabled = !history.get().canUndo;
    itemRedo.disabled = !history.get().canRedo;
  };
  teardown.push(history.subscribe(syncEdit));
  syncEdit();

  const itemStage = $('vf-menu-item[value="view-stage"]');
  const itemSprite = $('vf-menu-item[value="view-sprite"]');
  const itemTools = $('vf-menu-item[value="view-tools"]');
  const itemGrid = $('vf-menu-item[value="show-grid"]');
  const syncView = () => {
    const s = shell.get();
    itemStage.checked = !!s.windows.stage;
    itemSprite.checked = !!s.windows.sprite;
    itemTools.checked = !!s.windows.tools;
    itemGrid.checked = !!s.showGrid;
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

  // The document window's close box routes through the same dirty check.
  windows.onDocumentClose = closeDocument;

  return {
    actions: { confirmDiscard, openSample, openDoc, closeDocument, saveThen },
    dispose() {
      for (const fn of teardown) fn();
    },
  };
}
