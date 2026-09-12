// glTF 2.0 binary (glb) writer for one textured mesh, and a reader. Typed arrays
// and a PNG in, bytes out. No THREE.
//
// The PNG bytes are stored as given, not drawn through a canvas, because privacy
// browsers perturb canvas readback.
//
// Layout (little-endian): a 12-byte header ('glTF', version 2, file length), a
// JSON chunk padded with spaces to 4 bytes, and a BIN chunk padded with zeros.
// The BIN chunk holds positions, normals, UVs, indices and the PNG, each in a
// 4-aligned bufferView. Positions are multiplied by scale here, so the accessor
// min/max are the real extent and the node has no transform. UVs pass through
// unflipped: glTF v = 0 is the image's top row, as in the skin. Winding is CCW.

const MAGIC = 0x46546c67; // 'glTF'
const VERSION = 2;
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'
const FLOAT = 5126;
const USHORT = 5123;
const UINT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const NEAREST = 9728;
const CLAMP_TO_EDGE = 33071;
const TRIANGLES = 4;

const pad4 = (n) => (n + 3) & ~3;

/**
 * The model to write. position and normal are per-vertex xyz (stage units, unit
 * length), uv per-vertex pairs in [0, 1], index three CCW vertex indices per
 * triangle. scale multiplies every position (default 1). image is the skin as an
 * encoded PNG, or null for a flat color (linear RGB 0..1). unlit adds
 * KHR_materials_unlit. generator and extras go on the asset.
 * @typedef {{
 *   name: string,
 *   position: ArrayLike<number>,
 *   normal: ArrayLike<number>,
 *   uv: ArrayLike<number>,
 *   index: ArrayLike<number>,
 *   scale?: number,
 *   image?: {bytes: Uint8Array, mimeType?: string}|null,
 *   color?: ArrayLike<number>|null,
 *   unlit?: boolean,
 *   generator?: string,
 *   extras?: object,
 * }} GlbModel
 */

/**
 * @param {GlbModel} model
 * @returns {Uint8Array} the .glb file
 */
export function glbFromModel(model) {
  const { name, position, normal, uv, index } = model;
  const scale = model.scale ?? 1;
  const n = position.length / 3;
  if (!Number.isInteger(n) || n < 1)
    throw new Error('gltf: positions must be xyz triples');
  if (normal.length !== n * 3) throw new Error('gltf: one normal per vertex');
  if (uv.length !== n * 2) throw new Error('gltf: one uv per vertex');
  if (index.length % 3 !== 0 || index.length < 3)
    throw new Error('gltf: indices come in triangles');

  // Scaled positions and their extent.
  const pos = new Float32Array(n * 3);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n * 3; i++) {
    const v = position[i] * scale;
    pos[i] = v;
    const k = i % 3;
    if (v < min[k]) min[k] = v;
    if (v > max[k]) max[k] = v;
  }
  // Round the bounds to Float32 so they contain the stored values.
  for (let k = 0; k < 3; k++) {
    min[k] = Math.fround(min[k]);
    max[k] = Math.fround(max[k]);
  }
  const nrm = Float32Array.from(normal);
  const tex = Float32Array.from(uv);
  const wide = n > 65535;
  const idx = wide ? Uint32Array.from(index) : Uint16Array.from(index);

  // BIN chunk: each view at a 4-aligned offset.
  /** @type {{bytes: Uint8Array, target?: number}[]} */
  const views = [
    { bytes: new Uint8Array(pos.buffer), target: ARRAY_BUFFER },
    { bytes: new Uint8Array(nrm.buffer), target: ARRAY_BUFFER },
    { bytes: new Uint8Array(tex.buffer), target: ARRAY_BUFFER },
    { bytes: new Uint8Array(idx.buffer), target: ELEMENT_ARRAY_BUFFER },
  ];
  if (model.image) views.push({ bytes: model.image.bytes });
  const bufferViews = [];
  let binLength = 0;
  for (const v of views) {
    const view = { buffer: 0, byteOffset: binLength, byteLength: v.bytes.length };
    if (v.target) view.target = v.target;
    bufferViews.push(view);
    binLength += pad4(v.bytes.length);
  }
  const bin = new Uint8Array(binLength);
  views.forEach((v, i) => bin.set(v.bytes, bufferViews[i].byteOffset));

  const material = {
    name,
    pbrMetallicRoughness: {
      ...(model.image
        ? { baseColorTexture: { index: 0 } }
        : {
            baseColorFactor: Array.from(model.color ?? [1, 1, 1])
              .slice(0, 3)
              .concat(1),
          }),
      metallicFactor: 0,
      roughnessFactor: 1,
    },
  };
  if (model.unlit) material.extensions = { KHR_materials_unlit: {} };

  const json = {
    asset: {
      version: '2.0',
      ...(model.generator ? { generator: model.generator } : {}),
      ...(model.extras ? { extras: model.extras } : {}),
    },
    ...(model.unlit ? { extensionsUsed: ['KHR_materials_unlit'] } : {}),
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [
      {
        name,
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
            indices: 3,
            material: 0,
            mode: TRIANGLES,
          },
        ],
      },
    ],
    materials: [material],
    ...(model.image
      ? {
          textures: [{ sampler: 0, source: 0, name: `${name} skin` }],
          samplers: [
            {
              magFilter: NEAREST,
              minFilter: NEAREST,
              wrapS: CLAMP_TO_EDGE,
              wrapT: CLAMP_TO_EDGE,
            },
          ],
          images: [
            {
              name: `${name} skin`,
              mimeType: model.image.mimeType ?? 'image/png',
              bufferView: 4,
            },
          ],
        }
      : {}),
    accessors: [
      { bufferView: 0, componentType: FLOAT, count: n, type: 'VEC3', min, max },
      { bufferView: 1, componentType: FLOAT, count: n, type: 'VEC3' },
      { bufferView: 2, componentType: FLOAT, count: n, type: 'VEC2' },
      {
        bufferView: 3,
        componentType: wide ? UINT : USHORT,
        count: idx.length,
        type: 'SCALAR',
      },
    ],
    bufferViews,
    buffers: [{ byteLength: binLength }],
  };

  // Header, JSON chunk (space-padded), BIN chunk (zero-padded).
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = pad4(jsonBytes.length);
  const total = 12 + 8 + jsonLength + 8 + binLength;
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint32(0, MAGIC, true);
  v.setUint32(4, VERSION, true);
  v.setUint32(8, total, true);
  v.setUint32(12, jsonLength, true);
  v.setUint32(16, CHUNK_JSON, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLength);
  const binAt = 20 + jsonLength;
  v.setUint32(binAt, binLength, true);
  v.setUint32(binAt + 4, CHUNK_BIN, true);
  out.set(bin, binAt + 8);
  return out;
}

/**
 * Read a glb: its parsed JSON and its BIN chunk (a view into bytes). Throws unless
 * it is a version-2 glb with a JSON chunk first.
 * @param {Uint8Array} bytes
 * @returns {{json: any, bin: Uint8Array}}
 */
export function glbParts(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 20 || v.getUint32(0, true) !== MAGIC)
    throw new Error('not a glb: bad magic');
  if (v.getUint32(4, true) !== VERSION) throw new Error('not a glb 2');
  if (v.getUint32(8, true) !== bytes.length)
    throw new Error('glb: length disagrees with the file');
  const jsonLength = v.getUint32(12, true);
  if (v.getUint32(16, true) !== CHUNK_JSON)
    throw new Error('glb: the first chunk is not JSON');
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  let bin = new Uint8Array(0);
  const binAt = 20 + jsonLength;
  if (binAt + 8 <= bytes.length && v.getUint32(binAt + 4, true) === CHUNK_BIN) {
    const binLength = v.getUint32(binAt, true);
    bin = bytes.subarray(binAt + 8, binAt + 8 + binLength);
  }
  return { json, bin };
}

/**
 * A bufferView's bytes from a read glb.
 * @param {{json: any, bin: Uint8Array}} parts  @param {number} index
 */
export function glbViewBytes(parts, index) {
  const view = parts.json.bufferViews[index];
  return parts.bin.subarray(
    view.byteOffset ?? 0,
    (view.byteOffset ?? 0) + view.byteLength
  );
}
