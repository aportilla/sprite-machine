// The Finder: the kit's stock Finder (vintage-frames/shell) over Sprite
// Machine's library. The Trash is its volume. Its seed converts the library
// this app kept before the catalog, or stores the default files on a profile
// without one. File gains New Sprite, and Special gains Restore Default Files,
// then Back Up All Files… and Restore from Backup… (backup.js). Its dialogs
// are this app's (dialogs.html): Storage Unavailable answers the stock one
// with a notice that names Download.

import { finder as stockFinder, TRASH } from 'vintage-frames/shell';
import dialogs from './dialogs.html?raw';
import folderArt from '../../assets/folder.png';
import trashArt from '../../assets/trash.png';
import trashFullArt from '../../assets/trash-full.png';
import trashMarkArt from '../../assets/trash-indicator.png';
import { genericDocIconDataUri } from '../../image-io.js';
import { missingDefaults, restoreDefaults } from '../../state/defaults.js';
import { itemsFromLibrary, legacyIcons, trashPosition } from '../../state/legacy.js';
import { SAMPLES } from '../../lib/sprite-data.js';
import { TEXTS } from '../../texts/index.js';
import { storeSample } from '../../loaders.js';
import { alert } from '../windows.js';
import { initBackup } from './backup.js';

/**
 * @param {{storage: import('vintage-frames/shell').CatalogStorage | null,
 *          readLibrary: () => Promise<{docs: any[], folders: any[], texts: any[]}>}} io
 *   storage: where the catalog is kept, or null for nothing (?fresh=1).
 *   readLibrary: the library as it stood before the catalog (storage/db.js).
 */
export function finder({ storage, readLibrary }) {
  /** Store whatever default files are missing. @param {import('vintage-frames/shell').Catalog} catalog */
  const storeDefaults = (catalog) =>
    restoreDefaults(catalog, SAMPLES, TEXTS, { storeSample });

  return stockFinder({
    storage,
    art: {
      folder: folderArt,
      trash: trashArt,
      trashFull: trashFullArt,
      trashMark: trashMarkArt,
      // A document with no art of its own: the generic page.
      document: genericDocIconDataUri(),
    },
    // Run once per storage. The old library comes over with its ids, so each
    // document's bytes, still in the sheet store, line up with its item.
    seed: async (catalog) => {
      const old = await readLibrary().catch(() => null);
      const icons = legacyIcons(localStorage);
      const items = old ? itemsFromLibrary(old, icons) : [];
      if (!items.length) {
        await storeDefaults(catalog);
        return;
      }
      await catalog.import({ items }, { mode: 'replace' });
      const trash = trashPosition(icons);
      if (trash) catalog.place(new Map([[TRASH, trash]]));
    },
    dialogs,
    extend(finder, ctx) {
      const { catalog } = finder;

      finder.alertWith('storage-unavailable', () =>
        ctx.ask(ctx.dialog('storage-unavailable'))
      );

      // File → New Sprite, after Open. ⌃N: the browser takes ⌘N.
      const newSprite = finder.addCommand({
        menu: 'file',
        value: 'new',
        label: 'New Sprite',
        shortcut: '⌃N',
        run: () => ctx.apps['sprite-editor']?.newDocument(),
      });
      ctx.item('open').after(newSprite);

      finder.addCommand({
        menu: 'special',
        value: 'restore-defaults',
        label: 'Restore Default Files',
        separator: true,
        run: () => {
          storeDefaults(catalog).catch((err) => {
            void alert(
              ctx,
              ctx.dialog('alert'),
              `Restore Default Files failed: ${err.message}.`
            );
          });
        },
        // A trashed default counts as present.
        enabled: () => {
          const st = catalog.get();
          const missing = missingDefaults(st, SAMPLES, TEXTS);
          return st.available && missing.docs.length + missing.texts.length > 0;
        },
      });
      initBackup(finder, ctx);
    },
  });
}
