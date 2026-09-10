// Node-runnable tests for the workspace slice — the OPEN documents: contexts
// (own doc + history + face + selection + identity), untitled naming,
// per-context dirty tracking off the doc's two channels, the activation
// mirror, the stored-document flows (openStored / save / duplicate / rename /
// remove) against the real files slice over an in-memory storage stub, and
// the followActive primitive.
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDoc } from '../src/state/doc.js';
import { createFiles, UNTITLED, TRASH } from '../src/state/files.js';
import { createWorkspace, followActive } from '../src/state/workspace.js';
import { fakeScheduler, memStorage, encodeAtlas, decodeAtlas } from './helpers.mjs';

const sheet = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });

// --- harness -----------------------------------------------------------------

function makeWorld() {
  const storage = memStorage();
  let t = 1000;
  let n = 0;
  const files = createFiles({
    storage,
    encodeAtlas,
    decodeAtlas,
    makeIcon: async () => 'data:icon',
    now: () => t++,
    newId: () => `id-${++n}`,
  });
  /** @type {Map<any, ReturnType<typeof fakeScheduler>>} doc -> its scheduler */
  const schedulers = new Map();
  const ws = createWorkspace({
    files,
    createDoc: () => {
      const frames = fakeScheduler();
      const doc = createDoc(frames);
      schedulers.set(doc, frames);
      return doc;
    },
  });
  /** Crank a context's pending live frame. */
  const frame = (ctx) => schedulers.get(ctx.doc).frame();
  return { ws, files, storage, frame };
}

/** Open a context loaded with a blank 3×2 sheet of 2×2 tiles. */
function openLoaded(ws, init) {
  const ctx = ws.open(init);
  ctx.doc.loadAtlas(sheet(6, 4));
  return ctx;
}

const stroke = (ctx) => {
  const tile = { width: 2, height: 2, data: new Uint8ClampedArray(16) };
  tile.data[3] = 255;
  ctx.doc.applyTileEdit('front', tile);
};

// --- contexts & naming ---------------------------------------------------------

test('open creates independent contexts; untitled names count up and refill', () => {
  const { ws } = makeWorld();
  const a = openLoaded(ws);
  const b = openLoaded(ws);
  const c = openLoaded(ws);
  assert.equal(a.name, UNTITLED);
  assert.equal(b.name, `${UNTITLED} 2`);
  assert.equal(c.name, `${UNTITLED} 3`);
  assert.notEqual(a.doc, b.doc, 'each context owns its own doc');
  assert.notEqual(a.history, b.history, 'and its own history');
  ws.close(b.key);
  const d = openLoaded(ws);
  assert.equal(d.name, `${UNTITLED} 2`, 'a closed name is free again');
});

test('a named open (sample, dropped file) takes that name', () => {
  const { ws } = makeWorld();
  const ctx = openLoaded(ws, { name: 'Car' });
  assert.equal(ctx.name, 'Car');
  assert.equal(ctx.fileId, null, 'named, still untitled identity');
});

test('setFace is per-context', () => {
  const { ws } = makeWorld();
  const a = openLoaded(ws);
  const b = openLoaded(ws);
  ws.setFace(a.key, 'top');
  assert.equal(a.face, 'top');
  assert.equal(b.face, 'left');
});

test('setSelection is per-context, on the context’s OWN store; a rect drag rides beside it', () => {
  const { ws } = makeWorld();
  const a = openLoaded(ws);
  const b = openLoaded(ws);
  assert.equal(a.selection.get().bounds, null, 'no selection at birth');
  assert.equal(a.selection.get().rect, null, 'no drag at birth');
  const box = { x0: 2, y0: 3, x1: 7, y1: 9 };
  ws.setSelection(a.key, box);
  assert.deepEqual(a.selection.get().bounds, box);
  assert.equal(b.selection.get().bounds, null, 'the other context is untouched');
  const drag = { x0: 1, y0: 1, x1: 4, y1: 4 };
  ws.setRectDrag(a.key, drag);
  assert.deepEqual(a.selection.get().rect, drag);
  assert.deepEqual(a.selection.get().bounds, box, 'the drag leaves the selection alone');
  ws.setSelection(a.key, null);
  assert.equal(a.selection.get().bounds, null);
});

// --- dirty tracking --------------------------------------------------------------

test('the birth load leaves a context clean; strokes and structure dirty it', () => {
  const { ws, frame } = makeWorld();
  const ctx = openLoaded(ws);
  assert.equal(ctx.dirty, false, 'clean at birth');
  stroke(ctx);
  frame(ctx);
  assert.equal(ctx.dirty, true, 'a live flush dirties');
  ctx.dirty = false;
  ctx.doc.resizeTiles(3, 3);
  assert.equal(ctx.dirty, true, 'a structural resize dirties');
});

test('dirty is per-context, and anyDirty sees across all of them', () => {
  const { ws, frame } = makeWorld();
  const a = openLoaded(ws);
  const b = openLoaded(ws);
  assert.equal(ws.anyDirty(), false);
  stroke(b);
  frame(b);
  assert.equal(a.dirty, false);
  assert.equal(b.dirty, true);
  assert.equal(ws.anyDirty(), true);
});

test('close disposes the tracker: later doc changes touch nothing', () => {
  const { ws, frame } = makeWorld();
  const ctx = openLoaded(ws);
  ws.close(ctx.key);
  assert.equal(ws.get().contexts.length, 0);
  stroke(ctx);
  frame(ctx);
  assert.equal(ctx.dirty, false, 'the disposed tracker no longer marks');
});

// --- activation mirror ------------------------------------------------------------

test('setActive mirrors a key or null; closing the active context clears it', () => {
  const { ws } = makeWorld();
  const a = openLoaded(ws);
  const b = openLoaded(ws);
  ws.setActive(a.key);
  assert.equal(ws.active(), a);
  ws.setActive(b.key);
  assert.equal(ws.active(), b);
  ws.setActive(null);
  assert.equal(ws.active(), null, 'null = the desktop is focused');
  ws.setActive('bogus');
  assert.equal(ws.active(), null, 'an unknown key reads as none');
  ws.setActive(b.key);
  ws.close(b.key);
  assert.equal(ws.get().activeKey, null, 'an active close leaves no holder');
  assert.equal(ws.byKey(a.key), a, 'the survivor context remains');
});

// --- stored flows ------------------------------------------------------------------

test('save gives an untitled context its stored identity and cleans it', async () => {
  const { ws, frame, storage } = makeWorld();
  const ctx = openLoaded(ws);
  stroke(ctx);
  frame(ctx);
  const id = await ws.save(ctx.key, 'Cargo Ship');
  assert.equal(id, 'id-1');
  assert.equal(ctx.fileId, 'id-1');
  assert.equal(ctx.name, 'Cargo Ship');
  assert.equal(ctx.dirty, false, 'a save cleans');
  assert.equal(storage.map.size, 1);
});

test('a saved context saves silently in place', async () => {
  const { ws, frame, storage } = makeWorld();
  const ctx = openLoaded(ws);
  await ws.save(ctx.key, 'Ship');
  stroke(ctx);
  frame(ctx);
  await ws.save(ctx.key);
  assert.equal(storage.map.size, 1, 'no duplicate record');
  assert.equal(ctx.dirty, false);
});

test('openStored loads a fresh context; a second open returns the existing one', async () => {
  const { ws, frame } = makeWorld();
  const orig = openLoaded(ws);
  stroke(orig);
  frame(orig);
  await ws.save(orig.key, 'Ship');
  ws.close(orig.key);

  const first = await ws.openStored('id-1');
  assert.equal(first.existed, false);
  assert.equal(first.ctx.fileId, 'id-1');
  assert.equal(first.ctx.name, 'Ship');
  assert.equal(first.ctx.dirty, false, 'a stored open lands clean');
  assert.equal(
    first.ctx.doc.get().atlasImage.data[(0 * 6 + 2) * 4 + 3],
    255,
    'pixels restored'
  );

  const second = await ws.openStored('id-1');
  assert.equal(second.existed, true);
  assert.equal(second.ctx, first.ctx, 'one window per stored document');
  assert.equal(ws.get().contexts.length, 1);

  assert.equal(await ws.openStored('nope'), null);
});

test('the ring settings are the context’s: a change dirties it, a save writes them, a stored open restores them clean; an unseeded context has the defaults', async () => {
  const { ws } = makeWorld();
  const ctx = openLoaded(ws);
  assert.equal(ctx.ring.get().views, 4, 'born at the defaults');
  assert.equal(ctx.dirty, false);
  ctx.ring.setViews(8);
  ctx.ring.setSize(100);
  assert.equal(ctx.dirty, true, 'an atlas setting is document content');
  await ws.save(ctx.key, 'Ring');
  assert.equal(ctx.dirty, false);
  ws.close(ctx.key);

  const { ctx: back } = await ws.openStored('id-1');
  assert.deepEqual(back.ring.get(), { ...ctx.ring.get() });
  assert.equal(back.dirty, false, 'the restored settings are birth state, not a change');
  assert.equal(openLoaded(ws).ring.get().views, 4, 'another context has its own');
});

test('duplicate stores "«name» copy", counts a repeat the Mac’s way, and leaves the context untouched', async () => {
  const { ws, storage } = makeWorld();
  const ctx = openLoaded(ws);
  await ws.save(ctx.key, 'Ship');
  const copyId = await ws.duplicate(ctx.key);
  assert.equal(copyId, 'id-2');
  assert.equal(ctx.fileId, 'id-1', 'the original context keeps its identity');
  assert.equal(storage.map.get('id-2').name, 'Ship copy');
  const again = await ws.duplicate(ctx.key);
  assert.equal(storage.map.get(again).name, 'Ship copy 2', 'never a second "Ship copy"');
});

test('rename: untitled takes the display name; saved rewrites the store and every open context follows', async () => {
  const { ws, storage } = makeWorld();
  const untitled = openLoaded(ws);
  await ws.rename(untitled.key, 'Nameless');
  assert.equal(untitled.name, 'Nameless');
  assert.equal(storage.map.size, 0);

  const saved = openLoaded(ws);
  await ws.save(saved.key, 'Old');
  await ws.rename(saved.key, 'New');
  assert.equal(saved.name, 'New');
  assert.equal(storage.map.get('id-1').name, 'New');

  await ws.renameStored('id-1', 'Newer');
  assert.equal(saved.name, 'Newer', 'the icon rename path follows into the context');
});

test('removeStored reverts an open context to an untitled identity, dirty', async () => {
  const { ws, storage } = makeWorld();
  const ctx = openLoaded(ws);
  await ws.save(ctx.key, 'Doomed');
  assert.equal(ctx.dirty, false);
  await ws.removeStored('id-1');
  assert.equal(storage.map.size, 0);
  assert.equal(ctx.fileId, null);
  assert.equal(ctx.name, 'Doomed', 'the pixels and name stay open');
  assert.equal(ctx.dirty, true, 'and nothing stored backs them: a Close must ask');
});

test('emptyTrash removes what the Trash holds and reverts every open context holding one of them, dirty; the rest stand', async () => {
  const { ws, files, storage } = makeWorld();
  const trashed = openLoaded(ws);
  const kept = openLoaded(ws);
  await ws.save(trashed.key, 'Trashed');
  await ws.save(kept.key, 'Kept');
  await files.moveDoc(trashed.fileId, TRASH);
  const removed = await ws.emptyTrash();
  assert.deepEqual(removed.docs, ['id-1']);
  assert.deepEqual([...storage.map.keys()], ['id-2']);
  assert.equal(trashed.fileId, null);
  assert.equal(trashed.dirty, true);
  assert.equal(trashed.name, 'Trashed');
  assert.equal(kept.fileId, 'id-2');
  assert.equal(kept.dirty, false);
});

// --- followActive -----------------------------------------------------------------

test('followActive wires the active context, tears down across switches', () => {
  const { ws } = makeWorld();
  const a = openLoaded(ws);
  const b = openLoaded(ws);
  /** @type {string[]} */
  const log = [];
  const stop = followActive(ws, (ctx) => {
    log.push(`wire:${ctx ? ctx.key : 'null'}`);
    return () => log.push(`down:${ctx ? ctx.key : 'null'}`);
  });
  assert.deepEqual(log, ['wire:null'], 'the initial state wires immediately');
  ws.setActive(a.key);
  ws.setActive(a.key); // idempotent — same key never re-wires
  ws.setActive(b.key);
  ws.close(b.key); // the active close drops the holder
  stop();
  assert.deepEqual(log, [
    'wire:null',
    'down:null',
    `wire:${a.key}`,
    `down:${a.key}`,
    `wire:${b.key}`,
    `down:${b.key}`,
    'wire:null',
    'down:null',
  ]);
});
