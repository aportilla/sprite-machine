import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readTextChunks } from 'sprite-machine';
import { createDoc } from '../src/state/doc.js';
import { createSheets, SOFTWARE } from '../src/state/sheets.js';
import {
  fakeScheduler,
  memSheetStore,
  stubCatalog,
  encodeAtlas,
  decodeAtlas,
} from './helpers.mjs';

const sheet = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });

function makeWorld() {
  const store = memSheetStore();
  const catalog = stubCatalog({
    id: 'f',
    name: 'Ships',
    kind: 'folder',
    parent: null,
    createdAt: 0,
    modifiedAt: 0,
  });
  let t = 5000;
  const sheets = createSheets({
    store,
    catalog,
    encodeAtlas,
    decodeAtlas,
    makeIcon: async () => 'data:icon',
    iconFromBytes: async () => 'data:bytes-icon',
    now: () => t++,
  });
  return { store, catalog, sheets };
}

const loadedDoc = () => {
  const doc = createDoc(fakeScheduler());
  doc.loadAtlas(sheet(6, 4), {});
  return doc;
};

test('a first save makes the item with its icon and size, then the bytes under its id; a later save updates both in place', async () => {
  const { store, catalog, sheets } = makeWorld();
  const doc = loadedDoc();
  const res = await sheets.save(doc, { name: 'Car', parent: 'f' });
  const item = catalog.item(res.id);
  assert.deepEqual([item.kind, item.name, item.parent], ['sprite', 'Car', 'f']);
  const png = store.map.get(res.id).png;
  assert.deepEqual(item.data, { icon: 'data:icon', size: png.byteLength });
  const chunks = readTextChunks(png);
  assert.equal(chunks.Title, 'Car');
  assert.equal(chunks.Software, SOFTWARE);

  const again = await sheets.save(doc, { fileId: res.id, name: 'Car' });
  assert.equal(again.id, res.id);
  assert.equal(catalog.get().items.filter((i) => i.kind === 'sprite').length, 1);
  assert.equal(
    readTextChunks(store.map.get(res.id).png)['Creation Time'],
    chunks['Creation Time'],
    'a save in place keeps the creation time'
  );
});

test('a save into the Trash lands on the desktop; an empty doc saves nothing', async () => {
  const { catalog, sheets } = makeWorld();
  const res = await sheets.save(loadedDoc(), { name: 'Copy', parent: 'trash' });
  assert.equal(catalog.item(res.id).parent, null);
  assert.equal(await sheets.save(createDoc(fakeScheduler()), { name: 'Nothing' }), null);
});

test('load reads the pixels and chunks back under the item’s name; a missing item is null, missing bytes throw', async () => {
  const { store, catalog, sheets } = makeWorld();
  const doc = createDoc(fakeScheduler());
  doc.loadAtlas(sheet(6, 8), {}, { layers: 2, names: ['Body', 'Wheels'] });
  const { id } = await sheets.save(doc, { name: 'Car' });
  await catalog.rename(id, 'Truck');
  const back = await sheets.load(id);
  assert.equal(back.name, 'Truck', 'the catalog’s name, not the stale Title');
  assert.deepEqual(back.names, ['Body', 'Wheels']);
  assert.equal(back.image.height, 8);
  assert.equal(await sheets.load('nope'), null);
  store.map.delete(id);
  await assert.rejects(sheets.load(id));
});

test('bytesOf and a clean export carry the item’s current name as their Title; a dirty export encodes afresh', async () => {
  const { catalog, sheets } = makeWorld();
  const doc = loadedDoc();
  const { id } = await sheets.save(doc, { name: 'Car' });
  await catalog.rename(id, 'Racer');
  assert.equal(readTextChunks(await sheets.bytesOf(id)).Title, 'Racer');
  const clean = await sheets.exportBytes(doc, { fileId: id, name: 'Racer' });
  assert.equal(clean.name, 'Racer');
  assert.equal(readTextChunks(clean.bytes).Title, 'Racer');
  const dirty = await sheets.exportBytes(doc, { fileId: id, name: 'Draft', dirty: true });
  assert.equal(readTextChunks(dirty.bytes).Title, 'Draft');
  assert.equal(await sheets.bytesOf('nope'), null);
});

test('storeBytes keeps a sheet’s bytes as they came, named by the caller, its Title, or the fallback; it refuses an image that isn’t a sheet and bytes that don’t decode', async () => {
  const { store, catalog, sheets } = makeWorld();
  const titled = await sheets.bytesOf(
    (await sheets.save(loadedDoc(), { name: 'Car' })).id
  );
  const a = await sheets.storeBytes(titled, { parent: 'f', fallback: 'dropped' });
  assert.equal(a.item.name, 'Car');
  assert.equal(a.titled, true);
  assert.equal(a.item.parent, 'f');
  assert.deepEqual(a.item.data, { icon: 'data:bytes-icon', size: titled.byteLength });
  assert.equal(store.map.get(a.item.id).png, titled, 'stored as it came');

  const bare = await encodeAtlas(sheet(6, 4));
  const b = await sheets.storeBytes(bare, { fallback: 'untitled 2' });
  assert.equal(b.item.name, 'untitled 2');
  assert.equal(b.titled, false);

  assert.deepEqual(await sheets.storeBytes(await encodeAtlas(sheet(5, 5))), {
    refused: { width: 5, height: 5 },
  });
  assert.deepEqual(await sheets.storeBytes(new Uint8Array(3)), { refused: null });
  assert.equal(catalog.get().items.filter((i) => i.kind === 'sprite').length, 3);
});

test('copy gives the copy’s item the bytes with its own Title and Creation Time; remove drops them', async () => {
  const { store, catalog, sheets } = makeWorld();
  const { id } = await sheets.save(loadedDoc(), { name: 'Car' });
  const to = await catalog.create({ kind: 'sprite', name: 'Car copy', at: 9999 });
  await sheets.copy(catalog.item(id), to);
  const chunks = readTextChunks(store.map.get(to.id).png);
  assert.equal(chunks.Title, 'Car copy');
  assert.equal(chunks['Creation Time'], new Date(9999).toISOString());
  await sheets.remove(to.id);
  assert.equal(store.map.has(to.id), false);
});
