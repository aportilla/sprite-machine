import { test } from 'node:test';
import assert from 'node:assert/strict';

import { migrateDesktopState } from '../src/shell/desktop-state.js';

const v3 = (extra = {}) => ({
  v: 3,
  docs: [],
  activeFileId: null,
  icons: { 'doc:a': { left: 16, top: 60 } },
  pattern: 'gray-50',
  ...extra,
});

test('a v3 blob keeps its fields; `seeded` reads as stated', () => {
  const kept = migrateDesktopState(v3({ seeded: true }));
  assert.equal(kept.seeded, true);
  assert.equal(kept.pattern, 'gray-50');
  assert.deepEqual(kept.icons, { 'doc:a': { left: 16, top: 60 } });
  assert.equal(
    migrateDesktopState(v3({ seeded: false })).seeded,
    false,
    'an interrupted first boot leaves false — the next boot seeds'
  );
});

test('a v3 blob from before the flag reads as SEEDED (its existence had already decided that)', () => {
  assert.equal(migrateDesktopState(v3()).seeded, true);
  assert.equal(migrateDesktopState(v3({ seeded: undefined })).seeded, true);
  assert.equal(
    migrateDesktopState(v3({ seeded: null })).seeded,
    true,
    'only false is false'
  );
});

test('the text files’ record reads the other way: only a stated true counts, so a blob from before them seeds them once', () => {
  assert.equal(migrateDesktopState(v3({ seeded: true })).seededTexts, false);
  assert.equal(migrateDesktopState(v3({ seededTexts: true })).seededTexts, true);
  assert.equal(migrateDesktopState(v3({ seededTexts: 'yes' })).seededTexts, false);
});

test('v1 and v2 blobs migrate shallowly and read as seeded (their window geometry drops); nothing usable → null', () => {
  const two = migrateDesktopState({
    v: 2,
    docs: [
      { fileId: 'x', face: 'top', win: { left: 1, top: 2, width: 3, height: 4 } },
      null,
    ],
    activeFileId: 'x',
    icons: { 'doc:x': { left: 1, top: 2 } },
    windows: { tools: { left: 0, top: 0 } },
  });
  assert.deepEqual(two, {
    v: 3,
    docs: [{ fileId: 'x', face: 'top', layer: null }],
    activeFileId: 'x',
    icons: { 'doc:x': { left: 1, top: 2 } },
    seeded: true,
    seededTexts: false,
  });
  const one = migrateDesktopState({ v: 1, lastDocId: 'y', icons: {} });
  assert.deepEqual(one, {
    v: 3,
    docs: [{ fileId: 'y', face: null, layer: null }],
    activeFileId: 'y',
    icons: {},
    seeded: true,
    seededTexts: false,
  });
  assert.equal(migrateDesktopState(null), null);
  assert.equal(migrateDesktopState({}), null);
  assert.equal(migrateDesktopState({ v: 99 }), null);
  assert.equal(migrateDesktopState('garbage'), null);
});
