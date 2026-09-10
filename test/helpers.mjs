// Shared stubs for the app's Node suites — the pieces several files used to
// carry a copy of (the engine's suites have their own, in the package). Not a
// test: `node --test test/*.test.mjs` matches *.test.mjs alone, so this
// module is only ever imported.
import { crc32 } from 'sprite-machine';

/** A hand-cranked frame scheduler standing in for requestAnimationFrame: `frame()` runs every pending callback once, `size` counts them. */
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

/** An in-memory stand-in for storage/db.js — the same async surface over three Maps (the docs as `map`, the folders as `folders`, the text files as `texts`), exposed for the assertions. */
export function memStorage() {
  const map = new Map();
  const folders = new Map();
  const texts = new Map();
  return {
    map,
    folders,
    texts,
    list: async () => [...map.values()],
    get: async (id) => map.get(id),
    put: async (r) => map.set(r.id, r),
    remove: async (id) => map.delete(id),
    listFolders: async () => [...folders.values()],
    putFolder: async (r) => folders.set(r.id, r),
    removeFolder: async (id) => folders.delete(id),
    listTexts: async () => [...texts.values()],
    getText: async (id) => texts.get(id),
    putText: async (r) => texts.set(r.id, r),
    removeText: async (id) => texts.delete(id),
  };
}

/** The PNG signature bytes. */
export const SIG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/** One PNG chunk — length, type, data, CRC — as bytes. */
export function chunk(type, data) {
  const out = new Uint8Array(8 + data.length + 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** The codec stub's encoder: wraps an atlas as a minimal synthetic PNG whose IDAT carries the raw pixels + dims, so the slices' real chunk-splicing runs against real chunk structure. */
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

/** The codec stub's decoder — the exact inverse of encodeAtlas, walking the chunk list for IDAT (its offset moves once text chunks are in). */
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
