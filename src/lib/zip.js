// Store-only ZIP writer and reader. File → Export Sprite Atlas… uses it to
// download the sheet PNG and its TexturePacker JSON as one file.
//
// Layout (PKWARE APPNOTE, little-endian): a local header and data per entry,
// the central directory, then the end-of-central-directory record. Method 0
// (stored), with no data descriptors, extra fields, comments or ZIP64. Names are
// ASCII, so the UTF-8 flag stays clear.

/** @typedef {{name: string, bytes: Uint8Array}} ZipEntry */

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const VERSION = 20; // 2.0, the minimum version for a stored entry

// CRC-32 table (IEEE 802.3 polynomial, reflected).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 of a byte string, as zlib computes it.
 *  @param {Uint8Array} bytes  @returns {number} unsigned 32-bit */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A Date as MS-DOS time and date words: two-second resolution, years before
 *  1980 clamped to 1980.
 *  @param {Date} d  @returns {{time: number, date: number}} */
function dosDateTime(d) {
  const y = Math.max(d.getFullYear(), 1980);
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

const ascii = (s) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0x7e || c < 0x20)
      throw new Error(`zip entry name is not printable ASCII: ${s}`);
    out[i] = c;
  }
  return out;
};

/**
 * Pack entries into one stored ZIP, in the order given.
 * @param {ZipEntry[]} entries
 * @param {{date?: Date}} [opts]  modification time for every entry. A fixed date
 *   makes the output reproducible.
 * @returns {Uint8Array}
 */
export function zipStore(entries, opts = {}) {
  const { time, date } = dosDateTime(opts.date ?? new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, bytes } of entries) {
    const nameBytes = ascii(name);
    const crc = crc32(bytes);
    const local = new Uint8Array(30 + nameBytes.length + bytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, SIG_LOCAL, true);
    lv.setUint16(4, VERSION, true);
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, 0, true); // method: stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, bytes.length, true); // compressed = uncompressed
    lv.setUint32(22, bytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // extra
    local.set(nameBytes, 30);
    local.set(bytes, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, SIG_CENTRAL, true);
    cv.setUint16(4, VERSION, true); // made by
    cv.setUint16(6, VERSION, true); // needed
    cv.setUint16(8, 0, true); // flags
    cv.setUint16(10, 0, true); // method
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, bytes.length, true);
    cv.setUint32(24, bytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // extra
    cv.setUint16(32, 0, true); // comment
    cv.setUint16(34, 0, true); // disk
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, 0, true); // external attrs
    cv.setUint32(42, offset, true); // local header offset
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, SIG_END, true);
  ev.setUint16(4, 0, true); // this disk
  ev.setUint16(6, 0, true); // central directory disk
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true); // central directory offset
  ev.setUint16(20, 0, true); // comment

  const out = new Uint8Array(offset + cdSize + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Read a stored ZIP: every entry in directory order, with the CRC from its
 * header. Throws on anything but a stored, single-part archive.
 * @param {Uint8Array} zip
 * @returns {(ZipEntry & {crc: number})[]}
 */
export function zipEntries(zip) {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // The end record is the last 22 bytes unless the archive has a comment, so
  // scan back for its signature.
  let end = zip.length - 22;
  while (end >= 0 && v.getUint32(end, true) !== SIG_END) end--;
  if (end < 0) throw new Error('not a zip: no end-of-central-directory record');
  const count = v.getUint16(10 + end, true);
  let at = v.getUint32(16 + end, true);
  const entries = [];
  const text = new TextDecoder('ascii');
  for (let i = 0; i < count; i++) {
    if (v.getUint32(at, true) !== SIG_CENTRAL) throw new Error('bad central directory');
    if (v.getUint16(at + 10, true) !== 0) throw new Error('not a stored entry');
    const crc = v.getUint32(at + 16, true);
    const size = v.getUint32(at + 24, true);
    const nameLen = v.getUint16(at + 28, true);
    const extraLen = v.getUint16(at + 30, true);
    const commentLen = v.getUint16(at + 32, true);
    const local = v.getUint32(at + 42, true);
    const name = text.decode(zip.subarray(at + 46, at + 46 + nameLen));
    if (v.getUint32(local, true) !== SIG_LOCAL)
      throw new Error(`bad local header: ${name}`);
    const dataAt =
      local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    entries.push({ name, bytes: zip.slice(dataAt, dataAt + size), crc });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
