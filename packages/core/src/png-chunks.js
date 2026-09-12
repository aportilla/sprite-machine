// PNG chunk reading and writing. A document is one .png with its metadata in
// text chunks.
//
// A PNG is an 8-byte signature and a chunk list. Each chunk is
//   length (4, big-endian) | type (4, ASCII) | data | crc (4, over type + data).
// Text chunks are written right after IHDR, before the first IDAT. The writer
// uses tEXt when the text is Latin-1 and uncompressed iTXt (UTF-8) otherwise.
// Compressed text chunks (zTXt, compressed iTXt) pass through undecoded.

/** The 8-byte PNG signature. */
export const PNG_SIGNATURE = Uint8Array.of(
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a
);

/** @param {Uint8Array} bytes */
export function isPng(bytes) {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

// CRC32 lookup table for the PNG polynomial.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC32 of a byte range (PNG runs it over type + data). @param {Uint8Array} bytes */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const readU32 = (b, i) =>
  ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

const typeAt = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);

/**
 * Parse the chunk list. Each entry's `data` is a subarray of `bytes`, `offset`
 * is the chunk's start and `end` is one past its CRC. Throws on a bad
 * signature or a truncated chunk.
 *
 * @param {Uint8Array} bytes
 * @returns {{type:string, data:Uint8Array, offset:number, end:number}[]}
 */
export function readChunks(bytes) {
  if (!isPng(bytes)) throw new Error('png-chunks: not a PNG (bad signature)');
  const chunks = [];
  let i = PNG_SIGNATURE.length;
  while (i < bytes.length) {
    if (i + 8 > bytes.length) throw new Error('png-chunks: truncated chunk header');
    const length = readU32(bytes, i);
    const end = i + 8 + length + 4;
    if (end > bytes.length) throw new Error('png-chunks: truncated chunk data');
    const type = typeAt(bytes, i + 4);
    chunks.push({ type, data: bytes.subarray(i + 8, i + 8 + length), offset: i, end });
    i = end;
    if (type === 'IEND') break;
  }
  return chunks;
}

// Text codecs.
const latin1Encodable = (s) => {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0xff) return false;
  return true;
};
const latin1Bytes = (s) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};
const latin1String = (b) => {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};
const utf8Bytes = (s) => new TextEncoder().encode(s);
const utf8String = (b) => new TextDecoder().decode(b);

/** Serialize one chunk: length | type | data | crc(type+data).
 *  @param {string} type  @param {Uint8Array} data */
export function buildChunk(type, data) {
  const out = new Uint8Array(8 + data.length + 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A tEXt chunk: keyword | 0 | Latin-1 text. */
function buildTextChunk(keyword, text) {
  const kw = latin1Bytes(keyword);
  const tx = latin1Bytes(text);
  const data = new Uint8Array(kw.length + 1 + tx.length);
  data.set(kw, 0);
  data.set(tx, kw.length + 1);
  return buildChunk('tEXt', data);
}

/** An uncompressed iTXt chunk: keyword | 0 | 0 | 0 | lang | 0 | xlat | 0 | UTF-8 text. */
function buildItxtChunk(keyword, text) {
  const kw = latin1Bytes(keyword);
  const tx = utf8Bytes(text);
  const data = new Uint8Array(kw.length + 5 + tx.length);
  data.set(kw, 0);
  // The five bytes after the keyword stay zero: its NUL, the compression flag
  // and method, and the NULs ending the empty language tag and translated keyword.
  data.set(tx, kw.length + 5);
  return buildChunk('iTXt', data);
}

// Decode a text chunk to {keyword, text}, or null when it is compressed.
function decodeTextChunk(chunk) {
  const d = chunk.data;
  const nul = d.indexOf(0);
  if (nul < 0) return null;
  const keyword = latin1String(d.subarray(0, nul));
  if (chunk.type === 'tEXt') {
    return { keyword, text: latin1String(d.subarray(nul + 1)) };
  }
  // iTXt: compressionFlag(1) compressionMethod(1) lang\0 translated\0 text
  const flag = d[nul + 1];
  if (flag !== 0) return null; // compressed
  let i = nul + 3;
  while (i < d.length && d[i] !== 0) i++; // language tag
  i++;
  while (i < d.length && d[i] !== 0) i++; // translated keyword
  i++;
  return { keyword, text: utf8String(d.subarray(i)) };
}

/**
 * Every decodable text chunk as `{keyword: text}`, including chunks after
 * IDAT. A later duplicate keyword wins.
 *
 * @param {Uint8Array} bytes
 * @returns {Record<string, string>}
 */
export function readTextChunks(bytes) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const chunk of readChunks(bytes)) {
    if (chunk.type !== 'tEXt' && chunk.type !== 'iTXt') continue;
    const decoded = decodeTextChunk(chunk);
    if (decoded) out[decoded.keyword] = decoded.text;
  }
  return out;
}

/**
 * Return a new file with `entries` written as text chunks. Existing text
 * chunks with those keywords are removed, the new chunks go right after IHDR
 * in key order, and every other chunk is copied byte for byte. A null or
 * undefined value only removes the keyword.
 *
 * @param {Uint8Array} bytes
 * @param {Record<string, string|null|undefined>} entries
 * @returns {Uint8Array}
 */
export function setTextChunks(bytes, entries) {
  const chunks = readChunks(bytes);
  const replaced = new Set(Object.keys(entries));

  /** @type {Uint8Array[]} output chunks, in order */
  const parts = [];
  const fresh = [];
  for (const [keyword, text] of Object.entries(entries)) {
    if (text == null) continue;
    if (!keyword.length || keyword.length > 79) {
      throw new Error(`png-chunks: keyword must be 1–79 bytes ("${keyword}")`);
    }
    fresh.push(
      latin1Encodable(text)
        ? buildTextChunk(keyword, text)
        : buildItxtChunk(keyword, text)
    );
  }

  for (const chunk of chunks) {
    if (chunk.type === 'tEXt' || chunk.type === 'iTXt') {
      const decoded = decodeTextChunk(chunk);
      if (decoded && replaced.has(decoded.keyword)) continue; // superseded
    }
    parts.push(bytes.subarray(chunk.offset, chunk.end));
    if (chunk.type === 'IHDR') parts.push(...fresh.splice(0));
  }
  if (fresh.length) throw new Error('png-chunks: no IHDR to splice after');

  let total = PNG_SIGNATURE.length;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  out.set(PNG_SIGNATURE, 0);
  let at = PNG_SIGNATURE.length;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
