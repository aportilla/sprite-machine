import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  itemsOf,
  planBackup,
  readManifest,
  backupFilename,
  BACKUP_FORMAT,
  BACKUP_VERSION,
} from '../src/state/backup.js';

const item = (id, name, kind, parent, createdAt, extra = {}) => ({
  id,
  name,
  kind,
  parent,
  createdAt,
  modifiedAt: createdAt + 1,
  ...extra,
});

// The Trash volume leads the listing, as the catalog gives it.
const state = () => ({
  available: true,
  items: [
    item('trash', 'Trash', 'trash', null, 0),
    item('d1', 'Car', 'sprite', null, 1, { left: 900, top: 36 }),
    item('d2', 'car', 'sprite', null, 2),
    item('d3', 'Truck', 'sprite', 'f2', 3),
    item('d4', 'Old Car', 'sprite', 'trash', 4),
    item('t1', 'Read Me', 'text', null, 5, { data: { builtin: 'read-me' } }),
    item('f1', 'Vehicles', 'folder', null, 10, { left: 820, top: 36 }),
    item('f2', 'Big Rigs', 'folder', 'f1', 11),
    item('f3', 'Gone', 'folder', 'nowhere', 12),
  ],
});

test('planBackup mirrors the tree, parents first, and slugs a collision', () => {
  const { entries } = planBackup(state());
  assert.deepEqual(
    entries.map((e) => e.path),
    [
      'trash/',
      'trash/old-car.png',
      'vehicles/',
      'vehicles/big-rigs/',
      'vehicles/big-rigs/truck.png',
      'gone/',
      'car.png',
      'car-2.png',
      'read-me.txt',
    ]
  );
  assert.deepEqual(
    entries.map((e) => e.kind),
    ['dir', 'doc', 'dir', 'dir', 'doc', 'dir', 'doc', 'doc', 'text'],
    'a folder with a dangling parent is on the desktop, not left out'
  );
});

test('planBackup writes every item into the manifest with its place, the Trash by id alone', () => {
  const { manifest } = planBackup(state(), { app: '0.3.16', date: new Date(0) });
  assert.equal(manifest.format, BACKUP_FORMAT);
  assert.equal(manifest.v, BACKUP_VERSION);
  assert.equal(manifest.app, '0.3.16');
  assert.equal(manifest.exportedAt, '1970-01-01T00:00:00.000Z');

  assert.deepEqual(
    manifest.folders.map((f) => [f.id, f.name, f.parent, f.path, f.left ?? null]),
    [
      ['f1', 'Vehicles', null, 'vehicles/', 820],
      ['f2', 'Big Rigs', 'f1', 'vehicles/big-rigs/', null],
      ['f3', 'Gone', null, 'gone/', null],
    ],
    'the Trash has no row of its own'
  );
  assert.deepEqual(
    manifest.docs.map((r) => [r.id, r.name, r.folder, r.path]),
    [
      ['d4', 'Old Car', 'trash', 'trash/old-car.png'],
      ['d3', 'Truck', 'f2', 'vehicles/big-rigs/truck.png'],
      ['d1', 'Car', null, 'car.png'],
      ['d2', 'car', null, 'car-2.png'],
    ]
  );
  assert.deepEqual(
    [manifest.docs[2].left, manifest.docs[2].top, 'left' in manifest.docs[3]],
    [900, 36, false]
  );
  assert.deepEqual([manifest.docs[0].createdAt, manifest.docs[0].modifiedAt], [4, 5]);
  assert.deepEqual(
    manifest.texts.map((t) => [t.id, t.name, t.builtin, t.path]),
    [['t1', 'Read Me', 'read-me', 'read-me.txt']]
  );
});

test('readManifest round-trips a planned manifest', () => {
  const { manifest } = planBackup(state(), { app: '0.3.16' });
  assert.deepEqual(readManifest(JSON.stringify(manifest)), manifest);
});

test('readManifest normalizes what it accepts, places included, and throws on what it cannot use', () => {
  const rows = { folders: [], docs: [], texts: [] };
  const read = readManifest(
    JSON.stringify({
      ...rows,
      format: BACKUP_FORMAT,
      v: 1,
      texts: [{ id: 't1', name: 'Read Me', path: 'read-me.txt', left: 'x', top: 3 }],
    })
  );
  assert.deepEqual(read.texts[0], {
    id: 't1',
    name: 'Read Me',
    createdAt: 0,
    modifiedAt: 0,
    folder: null,
    builtin: null,
    path: 'read-me.txt',
  });
  assert.equal(read.app, '');
  assert.equal(read.exportedAt, null);

  const bad = (obj) => () => readManifest(JSON.stringify(obj));
  assert.throws(() => readManifest('{not json'));
  assert.throws(bad({ ...rows }), 'no format');
  assert.throws(bad({ ...rows, format: 'something-else', v: 1 }));
  assert.throws(bad({ ...rows, format: BACKUP_FORMAT }), 'no version');
  assert.throws(
    bad({ ...rows, format: BACKUP_FORMAT, v: BACKUP_VERSION + 1 }),
    'a newer backup'
  );
  assert.throws(bad({ format: BACKUP_FORMAT, v: 1, docs: [] }), 'missing arrays');
  assert.throws(
    bad({ ...rows, format: BACKUP_FORMAT, v: 1, docs: [{ id: 'd1', name: 'Car' }] }),
    'a row with no path'
  );
});

/** A read archive of the planned state, each doc with bytes and each text with its words. */
const archive = () => {
  const { manifest } = planBackup(state());
  return {
    folders: manifest.folders,
    docs: manifest.docs.map((r) => ({ ...r, bytes: new Uint8Array(1) })),
    texts: manifest.texts.map((t) => ({ ...t, text: 'old words' })),
  };
};

test('itemsOf makes the archive’s items with its ids and containers; a document reads its data or is skipped; places only for Replace', () => {
  const docs = new Map([
    ['d1', { icon: 'data:a', size: 10 }],
    ['d3', { icon: null, size: 20 }],
    ['d4', { icon: null, size: 30 }],
  ]);
  const replace = itemsOf(archive(), { docs, shipsText: () => true, places: true });
  assert.equal(replace.skipped, 1, 'd2 did not read as a sheet');
  assert.deepEqual(
    replace.items.map((i) => [i.id, i.kind, i.parent]),
    [
      ['f1', 'folder', null],
      ['f2', 'folder', 'f1'],
      ['f3', 'folder', null],
      ['d4', 'sprite', 'trash'],
      ['d3', 'sprite', 'f2'],
      ['d1', 'sprite', null],
      ['t1', 'text', null],
    ]
  );
  const car = replace.items.find((i) => i.id === 'd1');
  assert.deepEqual(
    [car.left, car.top, car.data],
    [900, 36, { icon: 'data:a', size: 10 }]
  );
  assert.deepEqual(replace.items.at(-1).data, { builtin: 'read-me' });

  const add = itemsOf(archive(), { docs, shipsText: () => false, places: false });
  assert.equal('left' in add.items.find((i) => i.id === 'd1'), false);
  assert.deepEqual(
    add.items.at(-1).data,
    { text: 'old words' },
    'an unshipped built-in keeps its words'
  );
});

test('backupFilename names the day', () => {
  assert.equal(
    backupFilename(new Date(2026, 8, 17, 9, 30)),
    'sprite-machine-backup-2026-09-17.zip'
  );
});
