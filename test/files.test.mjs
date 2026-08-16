// Node-runnable tests for the files slice: save/open/duplicate/rename/remove
// against an in-memory storage stub, the PNG-chunk metadata round-trip, dirty
// tracking off the doc's two channels, and graceful degradation when storage
// is absent or broken.
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDoc } from '../src/state/doc.js';
import { createFiles, docFilename, SOFTWARE, UNTITLED } from '../src/state/files.js';
import { crc32, readTextChunks } from '../src/lib/png-chunks.js';

// --- stubs -------------------------------------------------------------------

function fakeScheduler() {
  let next = 1;
  const pending = new Map();
  return {
    schedule: (fn) => {
      const id = next++;
      pending.set(id, fn);
      return id;
    },
    cancel: (id) => pending.delete(id),
    frame() {
      const fns = [...pending.values()];
      pending.clear();
      for (const fn of fns) fn();
    },
  };
}

// An in-memory stand-in for storage/db.js — same surface, Map-backed.
function memStorage() {
  const map = new Map();
  return {
    map,
    list: async () => [...map.values()],
    get: async (id) => map.get(id),
    put: async (r) => map.set(r.id, r),
    remove: async (id) => map.delete(id),
  };
}

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

// The codec stub: "encoding" wraps the atlas as a minimal synthetic PNG whose
// IDAT carries the raw pixels + dims, so decode is the exact inverse and the
// slice's real chunk-splicing runs against real chunk structure.
function chunk(type, data) {
  const out = new Uint8Array(8 + data.length + 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
const SIG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

async function encodeAtlas(img) {
  const payload = new Uint8Array(8 + img.data.length);
  new DataView(payload.buffer).setUint32(0, img.width);
  new DataView(payload.buffer).setUint32(4, img.height);
  payload.set(img.data, 8);
  const parts = [
    SIG,
    chunk('IHDR', new Uint8Array(13)),
    chunk('IDAT', payload),
    chunk('IEND', new Uint8Array(0)),
  ];
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function decodeAtlas(bytes) {
  // Walk the chunk list for IDAT (offsets differ once text chunks are in).
  let i = SIG.length;
  while (i < bytes.length) {
    const len = new DataView(bytes.buffer, bytes.byteOffset + i).getUint32(0);
    const type = String.fromCharCode(
      bytes[i + 4],
      bytes[i + 5],
      bytes[i + 6],
      bytes[i + 7]
    );
    if (type === 'IDAT') {
      const d = bytes.subarray(i + 8, i + 8 + len);
      const dv = new DataView(d.buffer, d.byteOffset);
      const w = dv.getUint32(0);
      const h = dv.getUint32(4);
      return { width: w, height: h, data: new Uint8ClampedArray(d.subarray(8)) };
    }
    i += 8 + len + 4;
  }
  throw new Error('no IDAT');
}

// --- harness -----------------------------------------------------------------

function makeWorld({ storage = memStorage(), icon = 'data:icon' } = {}) {
  const frames = fakeScheduler();
  const doc = createDoc(frames);
  let t = 1000;
  let n = 0;
  const files = createFiles({
    storage,
    doc,
    encodeAtlas,
    decodeAtlas,
    makeIcon: async () => icon,
    now: () => t++,
    newId: () => `id-${++n}`,
  });
  doc.loadAtlas(sheet(6, 4)); // a 3×2 atlas of 2×2 tiles, fresh untitled
  return { files, doc, frames, storage };
}

const stroke = (doc, files) => {
  // A live edit: silent tile write + a flushed live frame → dirty.
  const tile = { width: 2, height: 2, data: new Uint8ClampedArray(16) };
  tile.data[3] = 255;
  doc.applyTileEdit('front', tile);
};

// --- identity & naming -------------------------------------------------------

test('docFilename slugifies', () => {
  assert.equal(docFilename('Cargo Ship'), 'cargo-ship.png');
  assert.equal(docFilename('  Héllo!! World  '), 'h-llo-world.png');
  assert.equal(docFilename(''), 'untitled.png');
});

test('a wholesale load resets identity to a clean untitled', () => {
  const { files, doc } = makeWorld();
  assert.equal(files.get().currentId, null);
  assert.equal(files.get().currentName, UNTITLED);
  assert.equal(files.get().dirty, false);
  files.adoptUntitled('Car');
  assert.equal(files.get().currentName, 'Car');
  assert.equal(files.get().currentId, null, 'adopting a name keeps it untitled');
  doc.loadAtlas(sheet(6, 4));
  assert.equal(files.get().currentName, UNTITLED, 'a new load re-unstitles');
});

// --- dirty tracking ----------------------------------------------------------

test('live strokes and structural edits mark dirty; a load marks clean', () => {
  const { files, doc, frames } = makeWorld();
  assert.equal(files.get().dirty, false);
  stroke(doc, files);
  frames.frame();
  assert.equal(files.get().dirty, true, 'a live flush dirties');
  doc.loadAtlas(sheet(6, 4));
  assert.equal(files.get().dirty, false, 'a fresh load cleans');
  doc.resizeTiles(3, 3);
  assert.equal(files.get().dirty, true, 'a structural resize dirties');
});

// --- save / open -------------------------------------------------------------

test('saveCurrent persists PNG bytes with the metadata chunks', async () => {
  const { files, storage, doc, frames } = makeWorld();
  stroke(doc, frames);
  const id = await files.saveCurrent('Cargo Ship');
  assert.equal(id, 'id-1');
  const s = files.get();
  assert.equal(s.currentId, 'id-1');
  assert.equal(s.currentName, 'Cargo Ship');
  assert.equal(s.dirty, false, 'a save cleans');
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
  stroke(doc, files); // pending — its frame never cranked
  await files.saveCurrent('X');
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

test('a saved doc saves silently in place; createdAt survives, modifiedAt moves', async () => {
  const { files, storage, doc, frames } = makeWorld();
  await files.saveCurrent('Ship');
  const first = storage.map.get('id-1');
  stroke(doc, frames);
  frames.frame();
  await files.saveCurrent();
  const second = storage.map.get('id-1');
  assert.equal(storage.map.size, 1, 'same record, no duplicate');
  assert.equal(second.name, 'Ship');
  assert.equal(second.createdAt, first.createdAt);
  assert.ok(second.modifiedAt > first.modifiedAt);
});

test('non-identity transforms round-trip through the chunk', async () => {
  const { files, doc, storage } = makeWorld();
  doc.loadAtlas(sheet(6, 4), { front: { rot: 1 } });
  await files.saveCurrent('T');
  const meta = readTextChunks(storage.map.get('id-1').png);
  assert.equal(meta['sprite-machine:transforms'], '{"front":{"rot":1}}');

  // Open it back: the transforms land in the doc.
  doc.loadAtlas(sheet(6, 4)); // wipe
  assert.deepEqual(doc.get().transforms, {});
  await files.open('id-1');
  assert.deepEqual(doc.get().transforms, { front: { rot: 1 } });
});

test('open restores pixels, name and a clean identity', async () => {
  const { files, doc, frames } = makeWorld();
  stroke(doc, frames);
  frames.frame();
  await files.saveCurrent('Cargo Ship');
  doc.loadAtlas(sheet(6, 4)); // something else, untitled
  assert.equal(files.get().currentId, null);

  const ok = await files.open('id-1');
  assert.equal(ok, true);
  assert.equal(files.get().currentId, 'id-1');
  assert.equal(files.get().currentName, 'Cargo Ship');
  assert.equal(files.get().dirty, false);
  // The stroked texel came back through the codec.
  assert.equal(doc.get().atlasImage.data[(0 * 6 + 2) * 4 + 3], 255);
});

test('open of a missing id resolves false and touches nothing', async () => {
  const { files } = makeWorld();
  files.adoptUntitled('Keep');
  assert.equal(await files.open('nope'), false);
  assert.equal(files.get().currentName, 'Keep');
});

// --- duplicate / rename / remove / close ------------------------------------

test('duplicate saves "«name» copy" as a new doc and opens it', async () => {
  const { files, storage } = makeWorld();
  await files.saveCurrent('Ship');
  await files.duplicate();
  const s = files.get();
  assert.equal(s.currentId, 'id-2');
  assert.equal(s.currentName, 'Ship copy');
  assert.equal(storage.map.size, 2);
  assert.equal(readTextChunks(storage.map.get('id-2').png).Title, 'Ship copy');
});

test('rename rewrites the Title chunk and the cache field', async () => {
  const { files, storage } = makeWorld();
  await files.saveCurrent('Old');
  await files.rename('New');
  assert.equal(files.get().currentName, 'New');
  const rec = storage.map.get('id-1');
  assert.equal(rec.name, 'New');
  assert.equal(readTextChunks(rec.png).Title, 'New');
  assert.equal(files.get().list[0].name, 'New');
});

test('renameById renames a NON-open doc without touching the open identity', async () => {
  const { files, storage, doc } = makeWorld();
  await files.saveCurrent('First');
  doc.loadAtlas(sheet(6, 4));
  files.adoptUntitled('Working');
  await files.renameById('id-1', 'Renamed');
  assert.equal(storage.map.get('id-1').name, 'Renamed');
  assert.equal(readTextChunks(storage.map.get('id-1').png).Title, 'Renamed');
  assert.equal(files.get().currentName, 'Working', 'the open untitled doc is untouched');
});

test('rename of an untitled doc just takes the display name', async () => {
  const { files, storage } = makeWorld();
  await files.rename('Nameless');
  assert.equal(files.get().currentName, 'Nameless');
  assert.equal(storage.map.size, 0);
});

test('remove deletes the record; the open doc reverts to untitled identity', async () => {
  const { files, storage } = makeWorld();
  await files.saveCurrent('Doomed');
  await files.remove('id-1');
  assert.equal(storage.map.size, 0);
  assert.equal(files.get().currentId, null);
  assert.equal(files.get().list.length, 0);
});

test('close resets to a clean untitled identity', async () => {
  const { files, doc, frames } = makeWorld();
  await files.saveCurrent('Ship');
  stroke(doc, frames);
  frames.frame();
  files.close();
  const s = files.get();
  assert.equal(s.currentId, null);
  assert.equal(s.currentName, UNTITLED);
  assert.equal(s.dirty, false);
});

// --- export ------------------------------------------------------------------

test('export hands back the saved bytes verbatim when clean', async () => {
  const { files, storage } = makeWorld();
  await files.saveCurrent('Ship');
  const { bytes, name } = await files.exportCurrent();
  assert.equal(name, 'Ship');
  assert.deepEqual(bytes, storage.map.get('id-1').png);
});

test('export re-encodes when dirty, chunks included', async () => {
  const { files, doc, frames, storage } = makeWorld();
  await files.saveCurrent('Ship');
  stroke(doc, frames);
  frames.frame();
  const { bytes } = await files.exportCurrent();
  assert.notDeepEqual(bytes, storage.map.get('id-1').png, 'not the stale stored bytes');
  const img = await decodeAtlas(bytes);
  assert.equal(img.data[(0 * 6 + 2) * 4 + 3], 255, 'the new stroke is in the export');
  assert.equal(readTextChunks(bytes).Title, 'Ship');
});

test('an untitled export encodes fresh with its display name', async () => {
  const { files } = makeWorld();
  files.adoptUntitled('Car');
  const { bytes, name } = await files.exportCurrent();
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

  const doc = createDoc(fakeScheduler());
  const none = createFiles({ storage: null, doc, encodeAtlas, decodeAtlas });
  await none.refresh();
  assert.equal(none.get().available, false);
});

test('the listing sorts by creation order', async () => {
  const { files, doc } = makeWorld();
  await files.saveCurrent('B');
  doc.loadAtlas(sheet(6, 4));
  await files.saveCurrent('A');
  assert.deepEqual(
    files.get().list.map((r) => r.name),
    ['B', 'A']
  );
});
