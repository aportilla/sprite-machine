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
  missingBuiltins,
  builtinLinks,
} from '../src/state/files.js';
import { readTextChunks } from 'sprite-machine';
import { fakeScheduler, memStorage, encodeAtlas, decodeAtlas } from './helpers.mjs';

// A storage whose every call rejects.
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

// Harness

function makeWorld({
  storage = memStorage(),
  icon = 'data:icon',
  builtinText = undefined,
  iconFromBytes = undefined,
} = {}) {
  const frames = fakeScheduler();
  const doc = createDoc(frames);
  let t = 1000;
  let n = 0;
  const files = createFiles({
    storage,
    encodeAtlas,
    decodeAtlas,
    makeIcon: async () => icon,
    iconFromBytes,
    builtinText,
    now: () => t++,
    newId: () => `id-${++n}`,
  });
  doc.loadAtlas(sheet(6, 4)); // a 3×2 atlas of 2×2 tiles
  return { files, doc, frames, storage };
}

const stroke = (doc) => {
  // A live edit, pending until the next frame or drain.
  const tile = { width: 2, height: 2, data: new Uint8ClampedArray(16) };
  tile.data[3] = 255;
  doc.applyTileEdit(0, 'front', tile);
};

// Naming

test('docFilename slugifies', () => {
  assert.equal(docFilename('Cargo Ship'), 'cargo-ship.png');
  assert.equal(docFilename('  Héllo!! World  '), 'h-llo-world.png');
  assert.equal(docFilename(''), 'untitled.png');
});

// Save and load

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
  stroke(doc); // no frame has run
  await files.save(doc, { name: 'X' });
  const rec = storage.map.get('id-1');
  const img = await decodeAtlas(rec.png);
  // Front's texel (0,0) is sheet pixel (2,0).
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

test('the layers chunk is written on every save, round-trips through load, and survives a copy', async () => {
  const { files, doc, storage } = makeWorld();
  const chunkOf = (id) =>
    readTextChunks(storage.map.get(id).png)['sprite-machine:layers'];
  const one = await files.save(doc, { name: 'One' });
  assert.equal(chunkOf(one.id), '{"layers":[{"name":"Layer 1"}]}');

  doc.loadAtlas(sheet(6, 8), {}, { layers: 2, names: ['Body', 'Wheels'] });
  const two = await files.save(doc, { name: 'Two' });
  assert.deepEqual((await files.load(two.id)).names, ['Body', 'Wheels']);
  const copy = await files.copyDoc(two.id, { folder: null });
  assert.equal(chunkOf(copy.id), chunkOf(two.id));
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

// Rename and remove

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

// Folders

test('folders: created names count up per container, a document files in and out, a rename lands in place', async () => {
  const { files, storage, doc } = makeWorld();
  await files.refresh();
  const a = await files.createFolder();
  const b = await files.createFolder();
  assert.equal(a.name, UNTITLED_FOLDER);
  assert.equal(b.name, `${UNTITLED_FOLDER} 2`);
  // Names count per container.
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
  // A record whose folder is gone shows on the desktop.
  await storage.put({ ...storage.map.get(id), folder: 'gone' });
  await files.refresh();
  st = files.get();
  assert.deepEqual(
    childrenOf(st, null).docs.map((r) => r.name),
    ['Car']
  );
  assert.deepEqual(folderPath(st, 'gone'), []);
});

// Trash

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

// Text files

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

test('a built-in text file reads the app’s text: the row sizes it, a rename, move or copy keeps the key, and an unknown key leaves the listing', async () => {
  /** @type {Record<string, string>} */
  const shipped = { 'read-me': 'Hello.' };
  const { files, storage } = makeWorld({ builtinText: (key) => shipped[key] ?? null });
  await files.refresh();
  const made = await files.createText({ name: 'Read Me', builtin: 'read-me' });
  assert.equal('text' in storage.texts.get(made.id), false, 'no text stored');
  assert.equal(await files.textOf(made.id), 'Hello.');
  assert.equal(files.textRec(made.id).builtin, 'read-me');
  assert.equal(files.textRec(made.id).size, 6);

  shipped['read-me'] = 'Hello again.';
  await files.refresh();
  assert.equal(
    await files.textOf(made.id),
    'Hello again.',
    'a new text reaches the file'
  );
  assert.equal(files.textRec(made.id).size, 12);

  await files.renameText(made.id, 'Help');
  const box = await files.createFolder({ name: 'Box' });
  await files.moveText(made.id, box.id);
  const copy = await files.copyText(made.id, { folder: null });
  const boxCopy = await files.copyFolder(box.id, { parent: null });
  const inBoxCopy = childrenOf(files.get(), boxCopy.id).texts[0];
  for (const id of [made.id, copy.id, inBoxCopy.id]) {
    assert.equal(files.textRec(id).builtin, 'read-me');
    assert.equal(await files.textOf(id), 'Hello again.');
  }

  delete shipped['read-me'];
  await files.refresh();
  assert.equal(files.get().texts.length, 0, 'an unknown key leaves the listing');
  assert.equal(await files.textOf(made.id), null);
  assert.equal(storage.texts.size, 3, 'the records stay in storage');
});

test('builtinLinks pairs an unlinked text with the built-in its name or copy name carries; linkTexts drops the stored text; missingBuiltins goes by key', async () => {
  const shipped = { 'read-me': 'New.', keys: 'Keys.' };
  const { files, storage } = makeWorld({ builtinText: (key) => shipped[key] ?? null });
  const builtins = [
    { key: 'read-me', name: 'Read Me' },
    { key: 'keys', name: 'Keyboard Shortcuts' },
  ];
  await files.refresh();
  const old = await files.createText({ name: 'Read Me', text: 'Old.' });
  const oldCopy = await files.createText({ name: 'Read Me copy 2', text: 'Old.' });
  const renamed = await files.createText({ name: 'Help', text: 'Old.' });
  await files.createText({ name: 'Read Me First', text: 'Old.' });
  await files.createText({ name: 'Keyboard Shortcuts copy', builtin: 'keys' });

  assert.deepEqual(
    missingBuiltins(files.get(), builtins).map((b) => b.key),
    ['read-me'],
    'a copy carrying the key is present; a file by name alone is not'
  );

  const links = builtinLinks(files.get(), builtins);
  assert.deepEqual(links, [
    { id: old.id, key: 'read-me' },
    { id: oldCopy.id, key: 'read-me' },
  ]);
  await files.linkTexts(links);
  assert.equal(await files.textOf(old.id), 'New.');
  assert.equal(await files.textOf(oldCopy.id), 'New.');
  assert.equal('text' in storage.texts.get(old.id), false, 'the stored text is gone');
  assert.equal(await files.textOf(renamed.id), 'Old.', 'a renamed file keeps its text');
  assert.deepEqual(builtinLinks(files.get(), builtins), [], 'nothing left to link');

  await files.moveText(old.id, TRASH);
  await files.renameText(oldCopy.id, 'Notes');
  assert.deepEqual(
    missingBuiltins(files.get(), builtins),
    [],
    'a trashed or renamed built-in is present'
  );
  await files.emptyTrash();
  await files.removeText(oldCopy.id);
  assert.deepEqual(
    missingBuiltins(files.get(), builtins).map((b) => b.key),
    ['read-me']
  );
});

// Copies

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
  // Folder names count over the container's folders only.
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

  // The copy snapshots the tree before writing, so copying A into A makes one copy.
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

// Export

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

// Degradation

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

// Backups

/** A read archive: two folders, a document in the nested one, one on the
 *  desktop, one in the Trash, a built-in text file, and two unusable
 *  documents. */
async function archive() {
  const png = await encodeAtlas(sheet(6, 4));
  const row = (id, name, folder, extra = {}) => ({
    id,
    name,
    folder,
    createdAt: 10,
    modifiedAt: 20,
    path: `${id}.png`,
    bytes: png,
    ...extra,
  });
  return {
    folders: [
      {
        id: 'af2',
        name: 'Big Rigs',
        parent: 'af1',
        createdAt: 1,
        modifiedAt: 1,
        path: '',
      },
      {
        id: 'af1',
        name: 'Vehicles',
        parent: null,
        createdAt: 2,
        modifiedAt: 2,
        path: '',
      },
    ],
    docs: [
      row('ad1', 'Car', null),
      row('ad2', 'Truck', 'af2'),
      row('ad3', 'Old Car', TRASH),
      row('ad4', 'Wrong Shape', null, { bytes: await encodeAtlas(sheet(5, 4)) }),
      row('ad5', 'Not A PNG', null, { bytes: new Uint8Array([1, 2, 3]) }),
    ],
    texts: [
      {
        id: 'at1',
        name: 'Read Me',
        folder: null,
        builtin: 'read-me',
        text: 'stale copy',
        createdAt: 3,
        modifiedAt: 3,
        path: 'read-me.txt',
      },
      {
        id: 'at2',
        name: 'Notes',
        folder: 'af1',
        builtin: 'gone',
        text: 'kept',
        createdAt: 4,
        modifiedAt: 4,
        path: 'notes.txt',
      },
    ],
  };
}

test('importArchive merges with fresh ids, keeping names, times and nesting', async () => {
  const { files, storage } = makeWorld({
    builtinText: (key) => (key === 'read-me' ? 'Hello.' : null),
    iconFromBytes: async () => 'data:restored',
  });
  await files.refresh();
  const res = await files.importArchive(await archive(), { mode: 'merge' });
  assert.deepEqual(res, {
    docs: 3,
    folders: 2,
    texts: 2,
    skipped: 2,
    untethered: [],
  });

  const st = files.get();
  const folder = (name) => st.folders.find((f) => f.name === name);
  assert.equal(folder('Vehicles').parent, null);
  assert.equal(
    folder('Big Rigs').parent,
    folder('Vehicles').id,
    'a child folder ahead of its parent in the manifest still nests'
  );
  for (const f of ['Vehicles', 'Big Rigs']) {
    assert.ok(!['af1', 'af2'].includes(folder(f).id), 'a merge mints ids');
  }

  const doc = (name) => st.list.find((r) => r.name === name);
  assert.equal(doc('Car').folder, null);
  assert.equal(doc('Truck').folder, folder('Big Rigs').id);
  assert.equal(doc('Old Car').folder, TRASH);
  assert.equal(doc('Car').createdAt, 10, 'the archive’s times are kept');
  assert.equal(doc('Car').modifiedAt, 20);
  assert.equal(doc('Car').icon, 'data:restored');
  assert.equal(doc('Car').w, 6);
  assert.equal(doc('Car').h, 4);
  assert.equal(doc('Wrong Shape'), undefined, 'a sheet of the wrong shape is skipped');
  assert.equal(doc('Not A PNG'), undefined, 'bytes that do not decode are skipped');

  const text = (name) => st.texts.find((t) => t.name === name);
  assert.equal(text('Read Me').builtin, 'read-me');
  assert.equal(await files.textOf(text('Read Me').id), 'Hello.', 'the app’s text wins');
  assert.equal(
    'text' in storage.texts.get(text('Read Me').id),
    false,
    'a known key stores no text'
  );
  assert.equal(text('Notes').builtin, null);
  assert.equal(
    await files.textOf(text('Notes').id),
    'kept',
    'an unknown key falls back to the archived text'
  );

  // The same archive again is additive.
  await files.importArchive(await archive(), { mode: 'merge' });
  assert.equal(files.get().list.filter((r) => r.name === 'Car').length, 2);
  assert.equal(files.get().folders.filter((f) => f.name === 'Vehicles').length, 2);
});

test('importArchive replaces: the library is cleared first and the ids come back', async () => {
  const { files, doc } = makeWorld({ iconFromBytes: async () => 'data:restored' });
  await files.refresh();
  const before = await files.save(doc, { name: 'Sunk' });
  await files.createFolder({ name: 'Old Folder' });
  await files.createText({ name: 'Old Notes', text: 'x' });

  const res = await files.importArchive(await archive(), { mode: 'replace' });
  assert.deepEqual(res.untethered, [before.id], 'the sunk document is reported');

  const st = files.get();
  assert.deepEqual(
    st.list.map((r) => r.id).sort(),
    ['ad1', 'ad2', 'ad3'],
    'the archive’s own document ids'
  );
  assert.deepEqual(
    st.folders.map((f) => f.id).sort(),
    ['af1', 'af2', TRASH],
    'the archive’s own folder ids, beside the Trash row'
  );
  assert.deepEqual(
    st.texts.map((t) => t.id),
    ['at1', 'at2']
  );
  assert.equal(
    st.list.find((r) => r.id === 'ad2').folder,
    'af2',
    'nesting survives with the kept ids'
  );
  assert.equal(
    st.folders.some((f) => f.name === 'Old Folder'),
    false
  );
  assert.equal(
    st.texts.some((t) => t.name === 'Old Notes'),
    false
  );

  // A document the archive brings back under its own id is not reported as
  // untethered: restoring your own backup keeps the window tethered.
  const second = await files.importArchive(await archive(), { mode: 'replace' });
  assert.deepEqual(second.untethered, []);
});

test('a replace nothing came through from leaves the library alone', async () => {
  const { files, doc } = makeWorld();
  await files.refresh();
  const mine = await files.save(doc, { name: 'Mine' });
  const junk = {
    folders: [],
    texts: [],
    docs: [
      {
        id: 'x',
        name: 'Junk',
        folder: null,
        createdAt: 1,
        modifiedAt: 1,
        path: 'x.png',
        bytes: new Uint8Array([1, 2, 3]),
      },
    ],
  };
  const res = await files.importArchive(junk, { mode: 'replace' });
  assert.deepEqual(res, { docs: 0, folders: 0, texts: 0, skipped: 1, untethered: [] });
  assert.deepEqual(
    files.get().list.map((r) => r.id),
    [mine.id],
    'the desktop is not emptied for an archive that holds nothing usable'
  );
});

test('clearLibrary empties storage, listing or not, and reports the document ids', async () => {
  const { files, storage, doc } = makeWorld({ builtinText: () => null });
  await files.refresh();
  const made = await files.save(doc, { name: 'Car' });
  await files.createFolder({ name: 'Vehicles' });
  // A text whose key the app does not ship: stored, but never in the listing.
  await storage.putText({
    id: 'ghost',
    name: 'Ghost',
    builtin: 'nope',
    createdAt: 1,
    modifiedAt: 1,
  });
  await files.refresh();
  assert.equal(files.get().texts.length, 0);

  assert.deepEqual(await files.clearLibrary(), [made.id]);
  assert.equal(storage.map.size, 0);
  assert.equal(storage.folders.size, 0);
  assert.equal(storage.texts.size, 0, 'a record the listing leaves out goes too');
  assert.equal(files.get().list.length, 0);
  assert.deepEqual(
    files.get().folders.map((f) => f.id),
    [TRASH]
  );
});
