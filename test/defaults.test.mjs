import { test } from 'node:test';
import assert from 'node:assert/strict';

import { missingDefaults, restoreDefaults } from '../src/state/defaults.js';
import { stubCatalog } from './helpers.mjs';

const SAMPLES = [{ name: 'Cube' }, { name: 'Car' }];
const TEXTS = [
  { key: 'read-me', name: 'Read Me' },
  { key: 'keys', name: 'Keyboard Shortcuts' },
];

const sprite = (id, name, parent = null) => ({
  id,
  name,
  kind: 'sprite',
  parent,
  createdAt: 1,
  modifiedAt: 1,
});
const text = (id, name, builtin, parent = null) => ({
  id,
  name,
  kind: 'text',
  parent,
  createdAt: 1,
  modifiedAt: 1,
  data: { builtin },
});

test('a sample is present by its name, a text by its key; trashed ones count, a renamed text counts, a renamed sample does not', () => {
  const st = stubCatalog(
    sprite('a', 'Cube', 'trash'),
    sprite('b', 'My Car'),
    text('c', 'Renamed', 'read-me', 'trash')
  ).get();
  const missing = missingDefaults(st, SAMPLES, TEXTS);
  assert.deepEqual(
    missing.docs.map((s) => s.name),
    ['Car']
  );
  assert.deepEqual(
    missing.texts.map((t) => t.key),
    ['keys']
  );
  assert.deepEqual(missingDefaults(st, [], []), { docs: [], texts: [] });
});

test('restoreDefaults stores the missing samples, then the texts by key, on the desktop in order; a failed sample is skipped', async () => {
  const catalog = stubCatalog(sprite('a', 'Cube'));
  const stored = [];
  await restoreDefaults(catalog, [...SAMPLES, { name: 'Broken' }], TEXTS, {
    storeSample: async (s, at) => {
      if (s.name === 'Broken') throw new Error('no pixels');
      stored.push([s.name, at]);
    },
    now: () => 100,
  });
  assert.deepEqual(stored, [['Car', 100]]);
  const texts = catalog.get().items.filter((i) => i.kind === 'text');
  assert.deepEqual(
    texts.map((t) => [t.name, t.parent, t.data, t.createdAt]),
    [
      ['Read Me', null, { builtin: 'read-me' }, 102],
      ['Keyboard Shortcuts', null, { builtin: 'keys' }, 103],
    ]
  );
  await restoreDefaults(catalog, [], TEXTS, {
    storeSample: async () => {},
    now: () => 200,
  });
  assert.equal(
    catalog.get().items.filter((i) => i.kind === 'text').length,
    2,
    'nothing twice'
  );
});
