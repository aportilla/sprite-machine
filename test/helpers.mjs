// Shared stubs for the app's test suites. Not a test file: node --test runs
// *.test.mjs only.
import { crc32 } from 'sprite-machine';

/** A manual requestAnimationFrame stand-in. frame() runs the pending callbacks. */
export function fakeScheduler() {
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
    get size() {
      return pending.size;
    },
  };
}

/**
 * What the app asks of the shell's catalog (vintage-frames/shell), over an
 * in-memory listing with the Trash volume first and counting ids. Like the
 * kit's: a create in the Trash is refused, a rename or update bumps
 * modifiedAt, and a change notifies. `items` is exposed for edits.
 */
export function stubCatalog(...items) {
  let n = 0;
  let t = 1000;
  const trash = {
    id: 'trash',
    name: 'Trash',
    kind: 'trash',
    parent: null,
    createdAt: 0,
    modifiedAt: 0,
  };
  const state = { available: true, items: [trash, ...items] };
  const listeners = new Set();
  const changed = () => {
    state.items = [...state.items];
    for (const fn of [...listeners]) fn(state);
  };
  const item = (id) => state.items.find((i) => i.id === id) ?? null;
  const inTrash = (id) => {
    for (let at = id; at != null; at = item(at)?.parent ?? null)
      if (at === 'trash') return true;
    return false;
  };
  return {
    state,
    get: () => state,
    item,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async create({
      name = 'untitled',
      kind = 'folder',
      parent = null,
      data,
      at,
      left,
      top,
    } = {}) {
      if (inTrash(parent)) return null;
      const time = at ?? t++;
      const made = {
        id: `id-${++n}`,
        name,
        kind,
        parent,
        createdAt: time,
        modifiedAt: time,
      };
      if (data !== undefined) made.data = data;
      if (left != null && top != null) Object.assign(made, { left, top });
      state.items.push(made);
      changed();
      return made;
    },
    async update(id, data) {
      const i = state.items.findIndex((x) => x.id === id);
      if (i < 0) return false;
      state.items[i] = { ...state.items[i], data, modifiedAt: t++ };
      changed();
      return true;
    },
    async rename(id, name) {
      const i = state.items.findIndex((x) => x.id === id);
      if (i < 0 || state.items[i].name === name) return false;
      state.items[i] = { ...state.items[i], name, modifiedAt: t++ };
      changed();
      return true;
    },
    /** Take items out, as Empty Trash does. */
    drop(...ids) {
      state.items = state.items.filter((x) => !ids.includes(x.id));
      changed();
    },
  };
}

/** A sheet store (state/sheets.js) over a Map, exposed as `map`. */
export function memSheetStore() {
  const map = new Map();
  return {
    map,
    get: async (id) => map.get(id),
    put: async (r) => map.set(r.id, r),
    remove: async (id) => map.delete(id),
  };
}

/** The PNG signature bytes. */
export const SIG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/** One PNG chunk as bytes: length, type, data, CRC. */
export function chunk(type, data) {
  const out = new Uint8Array(8 + data.length + 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * Codec stub encoder. Writes a minimal PNG whose IDAT holds the width, height
 * and raw pixels.
 */
export async function encodeAtlas(img) {
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

/**
 * Codec stub decoder, the inverse of encodeAtlas. Walks the chunks for IDAT,
 * whose offset moves once text chunks are added.
 */
export async function decodeAtlas(bytes) {
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
