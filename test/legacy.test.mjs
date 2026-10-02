import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LEGACY_DESKTOP_KEY,
  convertSession,
  itemsFromLibrary,
  legacyIcons,
  readDesktopState,
  sessionFromDesktopState,
  trashPosition,
} from '../src/state/legacy.js';

/** A valid nine-slice pin. */
const PIN = {
  x: [
    { kind: 'near', v: 16 },
    { kind: 'far', v: 200 },
  ],
  y: [
    { kind: 'near', v: 40 },
    { kind: 'far', v: 120 },
  ],
};

const v4 = (extra = {}) => ({
  v: 4,
  docs: [{ fileId: 'a', face: 'top', layer: 1 }],
  active: 'doc:a',
  icons: { 'doc:a': { left: 16, top: 60 }, 'folder:trash': { left: 900, top: 600 } },
  windows: {
    'doc:a': { pin: PIN, z: 2 },
    'folder:f': { pin: PIN, z: 0 },
    'text:t': { pin: PIN },
    'windoid:tools': { pin: PIN },
    'folder:bad': { pin: { left: 1 } },
    nonsense: { pin: PIN, z: 1 },
  },
  showRing: true,
  pattern: 'bricks',
  greet: false,
  seeded: true,
  seededTexts: true,
  ...extra,
});

test('a v4 blob becomes a session: windows by item with their application, pin and depth; a windoid keeps its key; bad entries drop', () => {
  const s = sessionFromDesktopState(v4());
  assert.deepEqual(s.windows, {
    a: { app: 'sprite-editor', pin: PIN, z: 2 },
    f: { app: 'finder', pin: PIN, z: 0 },
    t: { app: 'text-viewer', pin: PIN },
    'windoid:tools': { app: 'sprite-editor', pin: PIN },
  });
  assert.equal(s.v, 1);
  assert.equal(s.active, 'a');
  assert.equal(s.pattern, 'bricks');
});

test('the extras carry Show at startup, the 3D Sprite Atlas and each open document’s face and layer', () => {
  assert.deepEqual(sessionFromDesktopState(v4()).extra, {
    greet: false,
    showRing: true,
    docs: { a: { face: 'top', layer: 1 } },
  });
  const plain = sessionFromDesktopState(
    v4({ greet: undefined, showRing: undefined, docs: [null, { face: 'x' }] })
  );
  assert.deepEqual(plain.extra, { greet: true, showRing: false, docs: {} });
});

test('a v3 blob’s bare pins become boxes without a depth, so the first boot opens nothing, and its active document comes through', () => {
  const s = sessionFromDesktopState({
    v: 3,
    docs: [],
    activeFileId: 'x',
    icons: {},
    windows: { 'folder:f': PIN, 'folder:bad': { left: 1, top: 2 } },
  });
  assert.deepEqual(s.windows, { f: { app: 'finder', pin: PIN } });
  assert.equal(s.active, 'x');
});

test('v1 and v2 blobs keep their document and positions but no window; anything else reads as none', () => {
  const one = readDesktopState({
    v: 1,
    lastDocId: 'y',
    icons: { 'doc:y': { left: 1, top: 2 } },
  });
  assert.equal(one.active, 'doc:y');
  assert.deepEqual(one.docs, [{ fileId: 'y' }]);
  assert.deepEqual(one.windows, {});
  const two = sessionFromDesktopState({
    v: 2,
    docs: [{ fileId: 'x', face: 'top' }],
    activeFileId: 'x',
    windows: { tools: { left: 0 } },
  });
  assert.deepEqual(two.windows, {});
  assert.deepEqual(two.extra.docs, { x: { face: 'top', layer: null } });
  for (const bad of [null, {}, { v: 99 }, 'garbage']) {
    assert.equal(sessionFromDesktopState(bad), null);
  }
});

test('the library’s records become items with their ids, names, times and containers, at their saved positions; a sheet stored since is no record of it', () => {
  const png = new Uint8Array(42);
  const items = itemsFromLibrary(
    {
      folders: [{ id: 'f', name: 'Ships', parent: null, createdAt: 1, modifiedAt: 2 }],
      docs: [
        {
          id: 'd',
          name: 'Car',
          folder: 'f',
          createdAt: 3,
          modifiedAt: 4,
          icon: 'data:icon',
          png,
        },
        { id: 'gone', name: 'Old', folder: 'trash', createdAt: 5, modifiedAt: 5, png },
        { name: 'no id' },
        { id: 'since', png },
      ],
      texts: [
        {
          id: 'r',
          name: 'Read Me',
          builtin: 'read-me',
          folder: null,
          createdAt: 6,
          modifiedAt: 6,
        },
        { id: 'n', name: 'Notes', text: 'hello', createdAt: 7, modifiedAt: 7 },
      ],
    },
    {
      'folder:f': { left: 900, top: 40 },
      'doc:d': { left: 16, top: 16 },
      'text:r': { left: 'x' },
    }
  );
  assert.deepEqual(items, [
    {
      id: 'f',
      name: 'Ships',
      kind: 'folder',
      parent: null,
      createdAt: 1,
      modifiedAt: 2,
      left: 900,
      top: 40,
    },
    {
      id: 'd',
      name: 'Car',
      kind: 'sprite',
      parent: 'f',
      createdAt: 3,
      modifiedAt: 4,
      data: { icon: 'data:icon', size: 42 },
      left: 16,
      top: 16,
    },
    {
      id: 'gone',
      name: 'Old',
      kind: 'sprite',
      parent: 'trash',
      createdAt: 5,
      modifiedAt: 5,
      data: { icon: null, size: 42 },
    },
    {
      id: 'r',
      name: 'Read Me',
      kind: 'text',
      parent: null,
      createdAt: 6,
      modifiedAt: 6,
      data: { builtin: 'read-me' },
    },
    {
      id: 'n',
      name: 'Notes',
      kind: 'text',
      parent: null,
      createdAt: 7,
      modifiedAt: 7,
      data: { text: 'hello' },
    },
  ]);
  assert.deepEqual(itemsFromLibrary({}), []);
});

test('the Trash’s position is read from its folder key', () => {
  assert.deepEqual(trashPosition(v4().icons), { left: 900, top: 600 });
  assert.equal(trashPosition({}), null);
});

/** A localStorage stand-in. */
const kv = (entries = {}) => {
  const map = new Map(Object.entries(entries));
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
};

test('convertSession writes the session once, under its own key, and leaves the old blob', () => {
  const store = kv({ [LEGACY_DESKTOP_KEY]: JSON.stringify(v4()) });
  assert.equal(convertSession(store, 'session'), true);
  assert.equal(JSON.parse(store.getItem('session')).active, 'a');
  assert.ok(store.getItem(LEGACY_DESKTOP_KEY), 'the old blob stays');
  store.setItem('session', '{"v":1}');
  assert.equal(
    convertSession(store, 'session'),
    false,
    'a session already there is kept'
  );
  assert.equal(store.getItem('session'), '{"v":1}');
  assert.equal(convertSession(kv(), 'session'), false, 'nothing old, nothing written');
  assert.equal(convertSession(kv({ [LEGACY_DESKTOP_KEY]: '{oops' }), 'session'), false);
  assert.deepEqual(legacyIcons(store)['doc:a'], { left: 16, top: 60 });
  assert.deepEqual(legacyIcons(kv()), {});
});
