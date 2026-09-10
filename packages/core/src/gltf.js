// ---------------------------------------------------------------------------
// A glTF 2.0 BINARY writer for one textured mesh — what File → Export 3D
// Model… hands over — and its reader (the tests'). Pure:
// typed arrays and a PNG in, bytes out; no THREE (model.js reads the
// arrays off the mesh). One node, one mesh, one primitive, one
// material, one texture: the model and its skin (skin.js) sampled
// NEAREST both ways with clamped wrap — the hard texel is part of the file
// — under a metallic-roughness material (metalness 0, roughness 1, the 3D
// View's) or, asked for, the KHR_materials_unlit extension: the paint
// exact under no light.
//
// Why glb: every engine's first-party importer reads it, its material IS
// three's MeshStandardMaterial, and a browser gives one download per
// gesture — a .gltf is three files, or one inflated by base64. Why a
// writer of our own: three's GLTFExporter encodes a texture by drawing it
// into a canvas and reading it back, the readback privacy browsers
// perturb; this one takes the PNG as bytes (png-encode.js), so the skin
// lands verbatim. Its subset is small enough to own, like the zip writer.
//
// The layout (the spec's, little-endian): a 12-byte header (the magic
// 'glTF', version 2, the file's length), a JSON chunk padded with spaces to
// four bytes, a BIN chunk padded with zeros holding the positions, normals,
// UVs, indices and the PNG, each in its own 4-aligned bufferView. Positions
// are baked in the caller's units (the scale — the reader's meters per
// stage unit — applied here, so the accessor's min/max are the real extent
// and the node carries no transform). UVs pass through: glTF's v = 0 is the
// image's TOP row, and the skin's texel row 0 IS v = 0 (a DataTexture,
// flipY false), so there is nothing to flip. The winding is CCW, three's.
// ---------------------------------------------------------------------------

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
 * The model to write: `position` / `normal` / `uv` are per-vertex triples,
 * triples and pairs (stage units, unit length, [0, 1]); `index` three vertex
 * indices per triangle, CCW; `scale` a factor onto every position (1);
 * `image` the skin as an encoded PNG, or null for a flat `color` (the
 * material's base color, linear RGB 0..1); `unlit` puts KHR_materials_unlit
 * on the material; `generator` and `extras` land on the asset.
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

  // The vertex buffers — positions scaled, with their extent.
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
  // Float32 rounding: the accessor's bounds must contain the stored values.
  for (let k = 0; k < 3; k++) {
    min[k] = Math.fround(min[k]);
    max[k] = Math.fround(max[k]);
  }
  const nrm = Float32Array.from(normal);
  const tex = Float32Array.from(uv);
  const wide = n > 65535;
  const idx = wide ? Uint32Array.from(index) : Uint16Array.from(index);

  // The BIN chunk: each view at a 4-aligned offset.
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

  // The file: header, the JSON chunk (space-padded), the BIN chunk (zero-padded).
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
 * Read a glb back: its parsed JSON and its BIN chunk (a view into `bytes`).
 * The writer's mirror — the tests read the export through it.
 * Throws on anything but a version-2 glb with a JSON chunk first.
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
 * A bufferView's bytes out of a read glb (a reader convenience).
 * @param {{json: any, bin: Uint8Array}} parts  @param {number} index
 */
export function glbViewBytes(parts, index) {
  const view = parts.json.bufferViews[index];
  return parts.bin.subarray(
    view.byteOffset ?? 0,
    (view.byteOffset ?? 0) + view.byteLength
  );
}
