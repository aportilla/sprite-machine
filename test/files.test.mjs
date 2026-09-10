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
import {
  createFiles,
  docFilename,
  SOFTWARE,
  UNTITLED_FOLDER,
  TRASH,
  childrenOf,
  itemCount,
  isInside,
  isTrashed,
  descendantsOf,
  folderPath,
  nextFolderName,
  nextDocName,
  copyName,
} from '../src/state/files.js';
import { readTextChunks } from 'sprite-machine';
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
  assert.equal(s.list[0].size, rec.png.byteLength, 'the row caches the record’s size');
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

test('the ring settings round-trip through their chunk when passed; a save without them writes none, and a load reads none as null', async () => {
  const { files, doc, storage } = makeWorld();
  const ring = { views: 8, elevation: 30, offset: 45, size: 100, paper: 'black' };
  await files.save(doc, { name: 'R', ring });
  const meta = readTextChunks(storage.map.get('id-1').png);
  assert.equal(
    meta['sprite-machine:ring'],
    '{"views":8,"elevation":30,"offset":45,"size":100}'
  );
  assert.deepEqual((await files.load('id-1')).ring, {
    views: 8,
    elevation: 30,
    offset: 45,
    size: 100,
  });

  await files.save(doc, { fileId: 'id-1', name: 'R' });
  assert.equal(
    readTextChunks(storage.map.get('id-1').png)['sprite-machine:ring'],
    undefined,
    'a save without settings removes the chunk (replace semantics)'
  );
  assert.equal((await files.load('id-1')).ring, null);
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

// --- folders ------------------------------------------------------------------

test('folders: created names count up per container, a document files in and out, a rename lands in place', async () => {
  const { files, storage, doc } = makeWorld();
  await files.refresh();
  const a = await files.createFolder();
  const b = await files.createFolder();
  assert.equal(a.name, UNTITLED_FOLDER);
  assert.equal(b.name, `${UNTITLED_FOLDER} 2`);
  // A container's count is its own: inside `a` the first name is free again.
  assert.equal(nextFolderName(files.get(), a.id), UNTITLED_FOLDER);
  await files.renameFolder(a.id, 'Vehicles');
  assert.equal(storage.folders.get(a.id).name, 'Vehicles');

  const { id } = await files.save(doc, { name: 'Car' });
  assert.equal(files.get().list[0].folder, null, 'a first save lands on the desktop');
  assert.equal(await files.moveDoc(id, a.id), true);
  assert.equal(files.get().list[0].folder, a.id);
  assert.deepEqual(
    childrenOf(files.get(), a.id).docs.map((r) => r.name),
    ['Car']
  );
  assert.equal(childrenOf(files.get(), null).docs.length, 0);
  assert.equal(await files.moveDoc(id, a.id), false, 'already there: nothing moves');
  assert.equal(await files.moveDoc(id, null), true, 'and back out to the desktop');
  assert.equal(files.get().list[0].folder, null);
});

test('a record keeps its folder across an in-place save and a rename; a new record takes the identity’s', async () => {
  const { files, storage, doc, frames } = makeWorld();
  await files.refresh();
  const f = await files.createFolder({ name: 'F' });
  const { id } = await files.save(doc, { name: 'Ship', folder: f.id });
  assert.equal(storage.map.get(id).folder, f.id);
  stroke(doc);
  frames.frame();
  await files.save(doc, { fileId: id, name: 'Ship', folder: null });
  assert.equal(storage.map.get(id).folder, f.id, 'a save never moves a file');
  await files.renameById(id, 'Boat');
  assert.equal(storage.map.get(id).folder, f.id, 'nor does a rename');
});

test('moveFolder nests, and refuses a folder into itself or a descendant; the tree selectors read the result', async () => {
  const { files } = makeWorld();
  await files.refresh();
  const a = await files.createFolder({ name: 'A' });
  const b = await files.createFolder({ name: 'B' });
  const c = await files.createFolder({ name: 'C' });
  assert.equal(await files.moveFolder(b.id, a.id), true);
  assert.equal(await files.moveFolder(c.id, b.id), true);
  const st = files.get();
  assert.equal(isInside(st, c.id, a.id), true);
  assert.equal(isInside(st, a.id, c.id), false);
  assert.equal(isInside(st, a.id, a.id), false, 'a folder is not inside itself');
  assert.deepEqual(folderPath(st, c.id), ['A', 'B', 'C']);
  assert.deepEqual(folderPath(st, null), []);
  assert.deepEqual(
    childrenOf(st, null).folders.map((f) => f.name),
    ['Trash', 'A'],
    'the desktop’s folders: the Trash, then the stored ones'
  );
  assert.equal(await files.moveFolder(a.id, a.id), false, 'into itself');
  assert.equal(await files.moveFolder(a.id, c.id), false, 'into a descendant');
  assert.equal(files.get().folders.find((f) => f.id === a.id).parent, null);
  assert.equal(await files.moveFolder(c.id, null), true, 'out to the desktop');
  assert.deepEqual(folderPath(files.get(), c.id), ['C']);
});

test('removeFolder lifts its children into its container; an orphaned folder id reads as the desktop', async () => {
  const { files, storage, doc } = makeWorld();
  await files.refresh();
  const a = await files.createFolder({ name: 'A' });
  const b = await files.createFolder({ name: 'B', parent: a.id });
  const { id } = await files.save(doc, { name: 'Car', folder: b.id });
  await files.removeFolder(b.id);
  let st = files.get();
  assert.equal(storage.folders.size, 1, 'B’s record is gone');
  assert.equal(st.list[0].folder, a.id, 'the document lifted into B’s container');
  // A record pointing at a folder that is gone (a stale write) shows on the
  // desktop rather than nowhere.
  await storage.put({ ...storage.map.get(id), folder: 'gone' });
  await files.refresh();
  st = files.get();
  assert.deepEqual(
    childrenOf(st, null).docs.map((r) => r.name),
    ['Car']
  );
  assert.deepEqual(folderPath(st, 'gone'), []);
});

// --- the Trash ----------------------------------------------------------------

test('the Trash is listed without a record, refuses a rename, a move, a removal and a folder made inside it; emptying removes its whole subtree and nothing else', async () => {
  const { files, storage, doc } = makeWorld();
  assert.equal(files.get().folders[0]?.id, TRASH, 'on the desktop before any listing');
  await files.refresh();
  assert.equal(files.get().folders[0]?.id, TRASH, 'and first in every listing');
  assert.equal(storage.folders.size, 0, 'never stored');

  await files.renameFolder(TRASH, 'Bin');
  assert.equal(await files.moveFolder(TRASH, null), false);
  await files.removeFolder(TRASH);
  assert.equal(await files.createFolder({ parent: TRASH }), null);
  assert.equal(files.get().folders[0].name, 'Trash');
  assert.equal(storage.folders.size, 0, 'nothing of the Trash reached storage');

  const keep = await files.createFolder({ name: 'Keep' });
  const kept = await files.save(doc, { name: 'Kept', folder: keep.id });
  const gone = await files.createFolder({ name: 'Gone' });
  const nested = await files.createFolder({ name: 'Nested', parent: gone.id });
  const deep = await files.save(doc, { name: 'Deep', folder: nested.id });
  const loose = await files.save(doc, { name: 'Loose' });
  assert.equal(
    await files.moveFolder(gone.id, TRASH),
    true,
    'a folder files into it whole'
  );
  assert.equal(await files.moveDoc(loose.id, TRASH), true);
  let st = files.get();
  assert.equal(isTrashed(st, nested.id), true, 'inside a trashed folder is trashed');
  assert.equal(isTrashed(st, keep.id), false);
  assert.equal(isTrashed(st, null), false);
  assert.equal(await files.createFolder({ parent: nested.id }), null, 'nor made there');
  const d = descendantsOf(st, TRASH);
  assert.deepEqual(d.docs.map((r) => r.name).sort(), ['Deep', 'Loose']);
  assert.deepEqual(
    d.folders.map((f) => f.name),
    ['Gone', 'Nested'],
    'parents before their children'
  );

  const removed = await files.emptyTrash();
  assert.deepEqual(removed.docs.sort(), [deep.id, loose.id].sort());
  assert.deepEqual(removed.folders, [gone.id, nested.id]);
  st = files.get();
  assert.deepEqual([...storage.map.keys()], [kept.id], 'the kept document alone');
  assert.deepEqual([...storage.folders.keys()], [keep.id], 'the kept folder alone');
  assert.equal(st.folders[0].id, TRASH, 'the Trash stands, empty');
  assert.equal(
    childrenOf(st, TRASH).docs.length + childrenOf(st, TRASH).folders.length,
    0
  );
});

// --- text files ------------------------------------------------------------------

test('a text file is its text: it lists, files, renames, copies with the counting, lifts out of a removed folder, travels in a copied folder, and empties with the Trash', async () => {
  const { files, storage } = makeWorld();
  await files.refresh();
  const made = await files.createText({ name: 'Read Me', text: 'Hello.\n\nBye.' });
  assert.equal(await files.textOf(made.id), 'Hello.\n\nBye.');
  assert.equal(
    files.get().texts[0].size,
    12,
    'the row carries the byte length, not the text'
  );
  assert.equal('text' in files.get().texts[0], false);
  assert.deepEqual(
    childrenOf(files.get(), null).texts.map((t) => t.name),
    ['Read Me']
  );

  await files.renameText(made.id, 'Read Me First');
  assert.equal(files.textRec(made.id).name, 'Read Me First');
  assert.equal(await files.textOf(made.id), 'Hello.\n\nBye.', 'a rename keeps the text');

  const box = await files.createFolder({ name: 'Box' });
  assert.equal(await files.moveText(made.id, box.id), true);
  assert.equal(await files.moveText(made.id, box.id), false, 'already there');
  assert.equal(childrenOf(files.get(), box.id).texts.length, 1);
  assert.equal(itemCount(files.get(), box.id), 1);

  const copy = await files.copyText(made.id, { folder: box.id });
  assert.equal(copy.name, 'Read Me First copy', 'counted beside the original');
  assert.equal(await files.textOf(copy.id), 'Hello.\n\nBye.');
  assert.equal(
    await files.copyText(made.id, { folder: TRASH }),
    null,
    'never into the Trash'
  );
  assert.equal(await files.createText({ name: 'x', text: '', folder: TRASH }), null);

  const boxCopy = await files.copyFolder(box.id, { parent: null });
  assert.equal(
    childrenOf(files.get(), boxCopy.id).texts.length,
    2,
    'a folder copies its text files with it'
  );

  await files.removeFolder(box.id);
  assert.deepEqual(
    childrenOf(files.get(), null)
      .texts.map((t) => t.name)
      .sort(),
    ['Read Me First', 'Read Me First copy'],
    'lifted onto the desktop'
  );

  assert.equal(await files.moveText(made.id, TRASH), true);
  assert.equal(await files.moveFolder(boxCopy.id, TRASH), true);
  assert.equal(itemCount(files.get(), TRASH), 2);
  const d = descendantsOf(files.get(), TRASH);
  assert.equal(d.texts.length, 3, 'the loose one and the two in the trashed folder');
  const removed = await files.emptyTrash();
  assert.equal(removed.texts.length, 3);
  assert.deepEqual([...storage.texts.keys()], [copy.id], 'the copy on the desktop alone');
  assert.equal(await files.textOf(made.id), null);
});

// --- copies (Copy / Paste, Duplicate) -------------------------------------------

test('copyName: the name as is in an empty container, "copy" beside the original, "copy 2" beside those — counted from the base', async () => {
  const { files, doc } = makeWorld();
  await files.refresh();
  const f = await files.createFolder({ name: 'Vehicles' });
  await files.save(doc, { name: 'Car' });
  let st = files.get();
  assert.equal(copyName(st, f.id, 'Car'), 'Car', 'nothing in the folder holds it');
  assert.equal(copyName(st, null, 'Car'), 'Car copy', 'beside the original');
  await files.save(doc, { name: 'Car copy' });
  st = files.get();
  assert.equal(copyName(st, null, 'Car'), 'Car copy 2');
  assert.equal(
    copyName(st, null, 'Car copy'),
    'Car copy 2',
    'a copy of a copy counts the base'
  );
  await files.save(doc, { name: 'Car copy 2' });
  assert.equal(copyName(files.get(), null, 'Car copy 2'), 'Car copy 3');
  // Folders count over the container's folders, never its documents.
  assert.equal(copyName(files.get(), null, 'Car', 'folder'), 'Car');
  assert.equal(copyName(files.get(), null, 'Vehicles', 'folder'), 'Vehicles copy');
});

test('nextDocName counts over the container’s documents alone', async () => {
  const { files, doc } = makeWorld();
  await files.refresh();
  const f = await files.createFolder({ name: 'F' });
  assert.equal(nextDocName(files.get(), null), 'untitled');
  await files.save(doc, { name: 'untitled' });
  await files.save(doc, { name: 'untitled 2' });
  assert.equal(nextDocName(files.get(), null), 'untitled 3');
  assert.equal(nextDocName(files.get(), f.id), 'untitled', 'a folder counts its own');
});

test('copyDoc makes a new record with new id and times, the Title and Creation Time rewritten, the pixels the same, in the asked folder; the original stands', async () => {
  const { files, storage, doc, frames } = makeWorld();
  await files.refresh();
  stroke(doc);
  frames.frame();
  const orig = await files.save(doc, {
    name: 'Car',
    ring: { views: 8, elevation: 30, offset: 0, size: 64, paper: 'white' },
  });
  const f = await files.createFolder({ name: 'F' });
  const before = storage.map.get(orig.id);

  const copy = await files.copyDoc(orig.id, { folder: f.id });
  assert.equal(copy.name, 'Car', 'as is: nothing in F holds it');
  assert.notEqual(copy.id, orig.id);
  const rec = storage.map.get(copy.id);
  assert.equal(rec.folder, f.id);
  assert.ok(rec.createdAt > before.createdAt, 'a copy is a new file');
  assert.equal(rec.createdAt, rec.modifiedAt);
  assert.equal(rec.icon, before.icon, 'the icon cache carries over');
  assert.equal(rec.w, before.w);
  const meta = readTextChunks(rec.png);
  assert.equal(meta.Title, 'Car');
  assert.notEqual(meta['Creation Time'], readTextChunks(before.png)['Creation Time']);
  assert.equal(
    meta['sprite-machine:ring'],
    readTextChunks(before.png)['sprite-machine:ring'],
    'the other chunks travel'
  );
  const img = await decodeAtlas(rec.png);
  assert.equal(img.data[(0 * 6 + 2) * 4 + 3], 255, 'the pixels are the same');
  assert.deepEqual(storage.map.get(orig.id), before, 'the original is untouched');

  const beside = await files.copyDoc(orig.id, { folder: null });
  assert.equal(beside.name, 'Car copy', 'beside the original');
  assert.equal(readTextChunks(storage.map.get(beside.id).png).Title, 'Car copy');
  assert.equal(await files.copyDoc('nope', {}), null, 'a source that is gone');
});

test('copyFolder copies a folder with a nested folder and documents at both levels, ids remapped, nesting kept, names inside unchanged; a folder into itself lands a copy inside it', async () => {
  const { files, storage, doc } = makeWorld();
  await files.refresh();
  const a = await files.createFolder({ name: 'A' });
  const b = await files.createFolder({ name: 'B', parent: a.id });
  const top = await files.save(doc, { name: 'Top', folder: a.id });
  const deep = await files.save(doc, { name: 'Deep', folder: b.id });
  const dest = await files.createFolder({ name: 'Dest' });

  const copy = await files.copyFolder(a.id, { parent: dest.id });
  assert.equal(copy.name, 'A');
  assert.notEqual(copy.id, a.id);
  let st = files.get();
  const kids = childrenOf(st, copy.id);
  assert.deepEqual(
    kids.folders.map((f) => f.name),
    ['B']
  );
  assert.deepEqual(
    kids.docs.map((r) => r.name),
    ['Top']
  );
  const b2 = kids.folders[0];
  assert.notEqual(b2.id, b.id, 'remapped');
  assert.deepEqual(
    childrenOf(st, b2.id).docs.map((r) => r.name),
    ['Deep']
  );
  assert.notEqual(kids.docs[0].id, top.id);
  assert.equal(storage.map.size, 4, 'two new documents');
  assert.equal(storage.folders.size, 5, 'two new folders');
  assert.deepEqual(
    childrenOf(st, a.id).docs.map((r) => r.id),
    [top.id],
    'the original tree stands'
  );
  assert.deepEqual(
    childrenOf(st, b.id).docs.map((r) => r.id),
    [deep.id]
  );

  // Into itself: the snapshot precedes the writes, so one copy lands inside.
  const inner = await files.copyFolder(a.id, { parent: a.id });
  st = files.get();
  assert.equal(inner.name, 'A', 'A holds no folder named A');
  assert.equal(folderPath(st, inner.id).join('/'), 'A/A');
  assert.deepEqual(
    childrenOf(st, inner.id).folders.map((f) => f.name),
    ['B']
  );
  assert.equal(descendantsOf(st, inner.id).docs.length, 2);
  const again = await files.copyFolder(a.id, { parent: null });
  assert.equal(again.name, 'A copy', 'beside the original');
  assert.equal(await files.copyFolder('nope', {}), null);
});

test('copies refuse the Trash: as a source, and as a target or inside it', async () => {
  const { files, doc } = makeWorld();
  await files.refresh();
  const { id } = await files.save(doc, { name: 'Car' });
  const f = await files.createFolder({ name: 'F' });
  await files.moveFolder(f.id, TRASH);
  assert.equal(await files.copyFolder(TRASH, { parent: null }), null);
  assert.equal(await files.copyDoc(id, { folder: TRASH }), null);
  assert.equal(await files.copyDoc(id, { folder: f.id }), null, 'inside the Trash');
  assert.equal(await files.copyFolder(f.id, { parent: TRASH }), null);
  const out = await files.copyFolder(f.id, { parent: null });
  assert.equal(out.name, 'F', 'a trashed item copies OUT fine');
  assert.equal(files.get().list.length, 1, 'nothing else was written');
});

test('bytesOf hands back the stored bytes, null for a missing id', async () => {
  const { files, storage, doc } = makeWorld();
  const { id } = await files.save(doc, { name: 'Car' });
  assert.deepEqual(await files.bytesOf(id), storage.map.get(id).png);
  assert.equal(await files.bytesOf('nope'), null);
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
