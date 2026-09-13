import { test } from 'node:test';
import assert from 'node:assert/strict';

import { glbFromModel, glbParts, glbViewBytes } from '../src/gltf.js';
import { encodePng } from '../src/png-encode.js';
import { buildVoxels } from '../src/pipeline.js';
import { wedgeMesh } from '../src/wedge-mesh.js';
import { img, fill } from './helpers.mjs';

const quad = () => ({
  name: 'quad',
  position: new Float32Array([0, 0, 0, 2, 0, 0, 2, 1, 0, 0, 1, 0]),
  normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
  uv: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
  index: new Uint16Array([0, 1, 2, 0, 2, 3]),
});
const png = () =>
  encodePng({ width: 2, height: 2, data: new Uint8Array(16).map((_, i) => i * 16) });

test('glbFromModel → glbParts: the framing, four aligned views and the PNG verbatim, positions scaled with their bounds, the NEAREST sampler', () => {
  const image = png();
  const glb = glbFromModel({
    ...quad(),
    scale: 0.5,
    image: { bytes: image },
    generator: 'test',
  });
  const v = new DataView(glb.buffer);
  assert.equal(v.getUint32(0, true), 0x46546c67, 'the magic');
  assert.equal(v.getUint32(4, true), 2, 'version 2');
  assert.equal(v.getUint32(8, true), glb.length, 'the header states the length');
  assert.equal(glb.length % 4, 0, 'the file is 4-aligned');
  const parts = glbParts(glb);
  const { json, bin } = parts;
  assert.equal(json.asset.version, '2.0');
  assert.equal(json.asset.generator, 'test');
  const prim = json.meshes[0].primitives[0];
  assert.deepEqual(Object.keys(prim.attributes).sort(), [
    'NORMAL',
    'POSITION',
    'TEXCOORD_0',
  ]);
  for (const bv of json.bufferViews)
    assert.equal(bv.byteOffset % 4, 0, 'a 4-aligned view');
  assert.equal(json.buffers[0].byteLength, bin.length);
  // Scaled positions and their bounds.
  const pos = json.accessors[prim.attributes.POSITION];
  assert.equal(pos.count, 4);
  assert.deepEqual(pos.min, [0, 0, 0]);
  assert.deepEqual(pos.max, [1, 0.5, 0]);
  const stored = glbViewBytes(parts, pos.bufferView);
  assert.equal(
    new Float32Array(stored.slice().buffer)[3],
    1,
    'x of the second vertex, scaled'
  );
  // Index: six unsigned shorts.
  const idx = json.accessors[prim.indices];
  assert.equal(idx.componentType, 5123);
  assert.equal(idx.count, 6);
  // The PNG bytes verbatim, with a nearest, clamped sampler.
  assert.deepEqual(glbViewBytes(parts, json.images[0].bufferView), image);
  assert.equal(json.images[0].mimeType, 'image/png');
  assert.deepEqual(json.samplers[0], {
    magFilter: 9728,
    minFilter: 9728,
    wrapS: 33071,
    wrapT: 33071,
  });
  const mat = json.materials[0].pbrMetallicRoughness;
  assert.equal(mat.baseColorTexture.index, 0);
  assert.deepEqual([mat.metallicFactor, mat.roughnessFactor], [0, 1]);
  assert.equal(json.extensionsUsed, undefined, 'lit: no extension');
  // Unlit: the extension is declared and set on the material.
  const unlit = glbParts(
    glbFromModel({ ...quad(), image: { bytes: image }, unlit: true })
  ).json;
  assert.deepEqual(unlit.extensionsUsed, ['KHR_materials_unlit']);
  assert.deepEqual(unlit.materials[0].extensions, { KHR_materials_unlit: {} });
  // No image: a flat base color and no texture.
  const flat = glbParts(
    glbFromModel({ ...quad(), image: null, color: [0.5, 0.25, 0] })
  ).json;
  assert.deepEqual(
    flat.materials[0].pbrMetallicRoughness.baseColorFactor,
    [0.5, 0.25, 0, 1]
  );
  assert.equal(flat.textures, undefined);
});

test('a wedge mesh exports whole: its welded vertices and index verbatim, the skin the embedded image', () => {
  const built = wedgeMesh(
    buildVoxels({
      front: img(['RRRR', 'RRRR', 'BBBB', 'BBBB']),
      right: fill(4, 4, 'T'),
      top: fill(4, 4, 'T'),
    })
  );
  const geo = built.geometry;
  const skin = encodePng(built.skin);
  const parts = glbParts(
    glbFromModel({
      name: 'wall',
      position: geo.position,
      normal: geo.normal,
      uv: geo.uv,
      index: geo.index,
      image: { bytes: skin },
    })
  );
  const prim = parts.json.meshes[0].primitives[0];
  assert.equal(
    parts.json.accessors[prim.attributes.POSITION].count,
    geo.position.length / 3
  );
  assert.equal(parts.json.accessors[prim.indices].count, geo.index.length);
  assert.deepEqual(
    new Uint16Array(
      glbViewBytes(parts, parts.json.accessors[prim.indices].bufferView).slice().buffer
    ),
    Uint16Array.from(geo.index)
  );
  assert.deepEqual(glbViewBytes(parts, parts.json.images[0].bufferView), skin);
});
