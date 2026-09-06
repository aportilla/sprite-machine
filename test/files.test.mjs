// Node-runnable tests for the files slice — the document LIBRARY:
// save/load/rename/remove/export against an in-memory storage stub, the
// PNG-chunk metadata round-trip, and graceful degradation when storage is
// absent or broken. Per-document identity and dirty state live in the
// workspace (workspace.test.mjs); every operation here takes an explicit doc
// + identity.
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDoc } from '../src/state/doc.js';
import { createFiles, docFilename, SOFTWARE } from '../src/state/files.js';
import { readTextChunks } from '../src/lib/png-chunks.js';
import { fakeScheduler, memStorage, encodeAtlas, decodeAtlas } from './helpers.mjs';

// A broken storage (private-mode IndexedDB): every call rejects.
const brokenStorage = () => ({
  list: async () => {
    throw new Error('nope');
  },
  get: async () => {
    throw new Error('nope');
  },
  put: async () => {
    throw new Error('nope');
  },
  remove: async () => {
    throw new Error('nope');
  },
});

const sheet = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });

// --- harness -----------------------------------------------------------------

function makeWorld({ storage = memStorage(), icon = 'data:icon' } = {}) {
  const frames = fakeScheduler();
  const doc = createDoc(frames);
  let t = 1000;
  let n = 0;
  const files = createFiles({
    storage,
    encodeAtlas,
    decodeAtlas,
    makeIcon: async () => icon,
    now: () => t++,
    newId: () => `id-${++n}`,
  });
  doc.loadAtlas(sheet(6, 4)); // a 3×2 atlas of 2×2 tiles
  return { files, doc, frames, storage };
}

const stroke = (doc) => {
  // A live edit: silent tile write (drain folds it in).
  const tile = { width: 2, height: 2, data: new Uint8ClampedArray(16) };
  tile.data[3] = 255;
  doc.applyTileEdit('front', tile);
};

// --- naming --------------------------------------------------------------------

test('docFilename slugifies', () => {
  assert.equal(docFilename('Cargo Ship'), 'cargo-ship.png');
  assert.equal(docFilename('  Héllo!! World  '), 'h-llo-world.png');
  assert.equal(docFilename(''), 'untitled.png');
});

// --- save / load ----------------------------------------------------------------

test('save persists PNG bytes with the metadata chunks and returns the identity', async () => {
  const { files, storage, doc } = makeWorld();
  const res = await files.save(doc, { name: 'Cargo Ship' });
  assert.deepEqual(res, { id: 'id-1', name: 'Cargo Ship' });
  const s = files.get();
  assert.equal(s.list.length, 1);
  assert.equal(s.list[0].name, 'Cargo Ship');
  assert.equal(s.list[0].icon, 'data:icon');
  assert.equal(s.list[0].w, 6);
  assert.equal(s.list[0].h, 4);

  const rec = storage.map.get('id-1');
  const meta = readTextChunks(rec.png);
  assert.equal(meta.Title, 'Cargo Ship');
  assert.equal(meta.Software, SOFTWARE);
  assert.ok(meta['Creation Time']);
  assert.equal(
    meta['sprite-machine:transforms'],
    undefined,
    'identity transforms stay unwritten'
  );
});

test('a save folds the pending live stroke in first (drain-before-consume)', async () => {
  const { files, doc, storage } = makeWorld();
  stroke(doc); // pending — its frame never cranked
  await files.save(doc, { name: 'X' });
  const rec = storage.map.get('id-1');
  const img = await decodeAtlas(rec.png);
  // FRONT is tile (col 1, row 0) of 2×2 tiles: the stroke's texel (0,0) with
  // alpha 255 lands at sheet (2,0) → index (0*6+2)*4+3.
  assert.equal(
    img.data[(0 * 6 + 2) * 4 + 3],
    255,
    'the un-flushed stroke was drained into the save'
  );
});

test('a save with a fileId lands in place; createdAt survives, modifiedAt moves', async () => {
  const { files, storage, doc, frames } = makeWorld();
  const first = await files.save(doc, { name: 'Ship' });
  const rec1 = storage.map.get(first.id);
  stroke(doc);
  frames.frame();
  await files.save(doc, { fileId: first.id, name: 'Ship' });
  const rec2 = storage.map.get(first.id);
  assert.equal(storage.map.size, 1, 'same record, no duplicate');
  assert.equal(rec2.name, 'Ship');
  assert.equal(rec2.createdAt, rec1.createdAt);
  assert.ok(rec2.modifiedAt > rec1.modifiedAt);
});

test('a save without a fileId is always a NEW record (the duplicate path)', async () => {
  const { files, storage, doc } = makeWorld();
  await files.save(doc, { name: 'Ship' });
  const copy = await files.save(doc, { name: 'Ship copy' });
  assert.equal(copy.id, 'id-2');
  assert.equal(storage.map.size, 2);
  assert.equal(readTextChunks(storage.map.get('id-2').png).Title, 'Ship copy');
});

test('non-identity transforms round-trip through the chunk', async () => {
  const { files, doc, storage } = makeWorld();
  doc.loadAtlas(sheet(6, 4), { front: { rot: 1 } });
  await files.save(doc, { name: 'T' });
  const meta = readTextChunks(storage.map.get('id-1').png);
  assert.equal(meta['sprite-machine:transforms'], '{"front":{"rot":1}}');

  const loaded = await files.load('id-1');
  assert.deepEqual(loaded.transforms, { front: { rot: 1 } });
});

test('load hands back pixels, name and transforms; a missing id resolves null', async () => {
  const { files, doc, frames } = makeWorld();
  stroke(doc);
  frames.frame();
  await files.save(doc, { name: 'Cargo Ship' });

  const loaded = await files.load('id-1');
  assert.equal(loaded.name, 'Cargo Ship');
  assert.deepEqual(loaded.transforms, {});
  assert.equal(loaded.image.data[(0 * 6 + 2) * 4 + 3], 255, 'pixels round-trip');

  assert.equal(await files.load('nope'), null);
});

// --- rename / remove -------------------------------------------------------------

test('renameById rewrites the Title chunk and the cache field', async () => {
  const { files, storage, doc } = makeWorld();
  await files.save(doc, { name: 'Old' });
  await files.renameById('id-1', 'New');
  const rec = storage.map.get('id-1');
  assert.equal(rec.name, 'New');
  assert.equal(readTextChunks(rec.png).Title, 'New');
  assert.equal(files.get().list[0].name, 'New');
});

test('remove deletes the record and the listing row', async () => {
  const { files, storage, doc } = makeWorld();
  await files.save(doc, { name: 'Doomed' });
  await files.remove('id-1');
  assert.equal(storage.map.size, 0);
  assert.equal(files.get().list.length, 0);
});

// --- export ------------------------------------------------------------------

test('export hands back the saved bytes verbatim when clean', async () => {
  const { files, storage, doc } = makeWorld();
  const { id } = await files.save(doc, { name: 'Ship' });
  const { bytes, name } = await files.exportBytes(doc, {
    fileId: id,
    name: 'Ship',
    dirty: false,
  });
  assert.equal(name, 'Ship');
  assert.deepEqual(bytes, storage.map.get('id-1').png);
});

test('export re-encodes when dirty, chunks included', async () => {
  const { files, doc, frames, storage } = makeWorld();
  const { id } = await files.save(doc, { name: 'Ship' });
  stroke(doc);
  frames.frame();
  const { bytes } = await files.exportBytes(doc, {
    fileId: id,
    name: 'Ship',
    dirty: true,
  });
  assert.notDeepEqual(bytes, storage.map.get('id-1').png, 'not the stale stored bytes');
  const img = await decodeAtlas(bytes);
  assert.equal(img.data[(0 * 6 + 2) * 4 + 3], 255, 'the new stroke is in the export');
  assert.equal(readTextChunks(bytes).Title, 'Ship');
});

test('an untitled export encodes fresh with its display name', async () => {
  const { files, doc } = makeWorld();
  const { bytes, name } = await files.exportBytes(doc, { name: 'Car' });
  assert.equal(name, 'Car');
  assert.equal(readTextChunks(bytes).Title, 'Car');
});

// --- degradation -------------------------------------------------------------

test('refresh resolves availability: present storage true, broken false, none false', async () => {
  const good = makeWorld();
  await good.files.refresh();
  assert.equal(good.files.get().available, true);

  const bad = makeWorld({ storage: brokenStorage() });
  await bad.files.refresh();
  assert.equal(bad.files.get().available, false);

  const none = createFiles({ storage: null, encodeAtlas, decodeAtlas });
  await none.refresh();
  assert.equal(none.get().available, false);
});
