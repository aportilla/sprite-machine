import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  planBackup,
  readManifest,
  backupFilename,
  BACKUP_FORMAT,
  BACKUP_VERSION,
} from '../src/state/backup.js';
import { TRASH } from '../src/state/files.js';

const doc = (id, name, folder, createdAt) => ({
  id,
  name,
  folder,
  createdAt,
  modifiedAt: createdAt + 1,
  icon: null,
  w: 6,
  h: 4,
  size: 100,
});

// The Trash row leads state.folders, as the files slice always gives it.
const state = () => ({
  available: true,
  folders: [
    { id: TRASH, name: 'Trash', parent: null, createdAt: 0, modifiedAt: 0 },
    { id: 'f1', name: 'Vehicles', parent: null, createdAt: 10, modifiedAt: 10 },
    { id: 'f2', name: 'Big Rigs', parent: 'f1', createdAt: 11, modifiedAt: 11 },
    { id: 'f3', name: 'Gone', parent: 'nowhere', createdAt: 12, modifiedAt: 12 },
  ],
  list: [
    doc('d1', 'Car', null, 1),
    doc('d2', 'car', null, 2),
    doc('d3', 'Truck', 'f2', 3),
    doc('d4', 'Old Car', TRASH, 4),
  ],
  texts: [
    {
      id: 't1',
      name: 'Read Me',
      folder: null,
      builtin: 'read-me',
      createdAt: 5,
      modifiedAt: 5,
      size: 20,
    },
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

test('planBackup writes every item into the manifest, the Trash by id alone', () => {
  const { manifest } = planBackup(state(), { app: '0.3.16', date: new Date(0) });
  assert.equal(manifest.format, BACKUP_FORMAT);
  assert.equal(manifest.v, BACKUP_VERSION);
  assert.equal(manifest.app, '0.3.16');
  assert.equal(manifest.exportedAt, '1970-01-01T00:00:00.000Z');

  assert.deepEqual(
    manifest.folders.map((f) => [f.id, f.name, f.parent, f.path]),
    [
      ['f1', 'Vehicles', null, 'vehicles/'],
      ['f2', 'Big Rigs', 'f1', 'vehicles/big-rigs/'],
      ['f3', 'Gone', null, 'gone/'],
    ],
    'the Trash has no row of its own'
  );
  assert.deepEqual(
    manifest.docs.map((r) => [r.id, r.name, r.folder, r.path]),
    [
      ['d4', 'Old Car', TRASH, 'trash/old-car.png'],
      ['d3', 'Truck', 'f2', 'vehicles/big-rigs/truck.png'],
      ['d1', 'Car', null, 'car.png'],
      ['d2', 'car', null, 'car-2.png'],
    ]
  );
  assert.deepEqual(manifest.docs[0].createdAt, 4);
  assert.deepEqual(manifest.docs[0].modifiedAt, 5);
  assert.deepEqual(
    manifest.texts.map((t) => [t.id, t.name, t.builtin, t.path]),
    [['t1', 'Read Me', 'read-me', 'read-me.txt']]
  );
});

test('readManifest round-trips a planned manifest', () => {
  const { manifest } = planBackup(state(), { app: '0.3.16' });
  assert.deepEqual(readManifest(JSON.stringify(manifest)), manifest);
});

test('readManifest normalizes what it accepts and throws on what it cannot use', () => {
  const rows = { folders: [], docs: [], texts: [] };
  const read = readManifest(
    JSON.stringify({
      ...rows,
      format: BACKUP_FORMAT,
      v: 1,
      texts: [{ id: 't1', name: 'Read Me', path: 'read-me.txt' }],
    })
  );
  assert.deepEqual(read.texts[0], {
    id: 't1',
    name: 'Read Me',
    folder: null,
    createdAt: 0,
    modifiedAt: 0,
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

test('backupFilename names the day', () => {
  assert.equal(
    backupFilename(new Date(2026, 8, 17, 9, 30)),
    'sprite-machine-backup-2026-09-17.zip'
  );
});
