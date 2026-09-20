# sprite-machine

Turns a 3×2 sheet of pixel-art face sprites (left / front / top over right /
back / bottom) into a low-poly, textured model: indexed triangle buffers and
a skin bitmap, or a glTF 2.0 binary. One pixel is one voxel. 45° and 1:2
wedges smooth every same-colour staircase, and the colour comes from a
nearest-sampled skin texture.

This is the engine behind [Sprite Machine](https://aportilla.github.io/sprite-machine/),
the desktop app that draws these sheets. It runs at a build step, at a
server's startup, or in the browser.

```bash
npm install sprite-machine
```

The package depends on `earcut` alone. Requires Node 20.19+ or 22.12+.

## The API

```js
import { buildModel, modelToGlb } from 'sprite-machine';

// sheet: {width, height, data}, an ImageData or the same shape
const model = buildModel(sheet, { transforms, layers });
//   → { geometry, skin, color, triangles, dims, warnings, unitsPerVoxel: 1 }
//     geometry is { position, normal, uv, index, bounds }: Float32 xyz per
//     vertex at one unit per voxel, centered on X and Z, unit normals, uv
//     pairs in [0, 1], a Uint32 CCW triangle index and the bounds. skin is
//     the texture, { width, height, data }, sRGB RGBA with row 0 at v = 0.
//     transforms is the per-view reorientation (optional). layers is the
//     sheet's block count (optional, 1 by default; see Layers).

const glb = modelToGlb(model, { name: 'car', voxelsPerMeter: 10 });
//   → Uint8Array: one node, one mesh, one primitive, the skin embedded as
//     a PNG behind a NEAREST sampler. unlit: true adds KHR_materials_unlit.
```

Both functions are synchronous and pure. `buildModel` throws on an invalid
sheet or a sheet with no painted view in any layer. To build off the main
thread, call them from a worker or a child process.

### In three.js

Two routes. `sprite-machine/three` turns the model into a `THREE.Mesh`, with
`three` installed beside the engine:

```js
import { toMesh, toGeometry, skinTexture } from 'sprite-machine/three';

const mesh = toMesh(model); // a flat-shaded MeshStandardMaterial over the skin
const geo = toGeometry(model.geometry); // a BufferGeometry with its bounds
const map = skinTexture(model.skin); // a DataTexture, nearest, sRGB, flipY false
```

Or write the glb and load it with `GLTFLoader`, which reads the sampler, the
sRGB texture, the unlit extension and the node name. Every other engine loads
the glb. `three` is an optional peer (0.152 or later), and the root entry
never imports it.

### In Node: a document PNG in

```js
import { readSheet, sheetToGlb } from 'sprite-machine/node';

// The engine's PNG decoder reads the pixels, over zlib. The Title,
// sprite-machine:transforms and sprite-machine:layers chunks are read as the
// app reads them.
const { image, name, transforms, layers } = readSheet(bytes);
const glb = sheetToGlb(bytes, { voxelsPerMeter: 10 }); // readSheet, buildModel, modelToGlb
```

`readSheet` also returns `chunks`, every text chunk verbatim. `layers` is the
layer names, or null. `sheetToGlb` builds as many layers as the chunk names
when that count divides the sheet's height into whole blocks, and one layer
otherwise. It takes an optional `name`, which overrides the Title chunk. With
neither, the name is `'sprite'`.

### In a browser

```js
import { readSheet, decodePng, encodePng } from 'sprite-machine/browser';
import { buildModel, layerCount } from 'sprite-machine';

const sheet = await readSheet(bytes); // the Node entry's result
const model = buildModel(sheet.image, {
  transforms: sheet.transforms,
  layers: layerCount(sheet.image.height, sheet.layers) ?? 1,
});

const { width, height, data } = await decodePng(bytes); // 8-bit RGBA, row 0 on top
const png = await encodePng({ width, height, data }); // a Uint8Array, deflated
```

The browser entry inflates and deflates with `DecompressionStream` and
`CompressionStream`, with no canvas, so the pixels are exactly the file's: a
privacy browser can noise a canvas read, and a canvas color-manages a PNG with
a `gAMA` or `iCCP` chunk. Its functions are async, and `inflate` and `deflate`
are exported too.

The decoder reads every color type and bit depth the PNG spec defines, and
Adam7. A sample of another depth scales to 8 bits as `floor(v · 255 / max + 0.5)`,
and a pixel matching the `tRNS` color key reads as 0, 0, 0, 0. The root entry
exports it as `decodePng(bytes, inflate)`, beside its halves `parsePng` and
`unfilterPng`. The root's `encodePng(img)` is synchronous and writes stored
deflate blocks. `pngScanlines` and `pngFromZlib` are its halves.

### The CLI

```
npx sprite-machine build sprites/*.png --out models/ [--voxels-per-meter 10] [--unlit]
```

Writes one `<name>.glb` per sheet, named from the Title chunk or else the
file name, and prints a line per file. The first failure exits non-zero.

## The sheet

One PNG with six tiles in a fixed layout. Empty tiles are allowed: a face
with no view of its own is mirror-filled from its opposite.

```
LEFT   FRONT  TOP
RIGHT  BACK   BOTTOM
```

The tile size derives from the image (a 120×80 sheet has 40×40 tiles). Use
square tiles. A tile is a slice of the voxel lattice, so a pixel's position
in its tile is its position in the object. The faces must be **registered**:
a FRONT pixel is solid only where the SIDE covers its row and the TOP covers
its column. Every texel must be fully opaque or fully transparent.

World axes: `+x` right, `+y` up, `+z` toward the front. Draw each tile as its
face is seen from outside: FRONT and BACK head-on and upright, RIGHT and LEFT
as side views with the front pointing right and left, and TOP and BOTTOM from
above and below with the front at the top edge. Per-tile `rot` / `flipX` /
`flipY` transforms handle sheets that don't follow the convention.

The model's origin is the centre of the lattice floor, Y up, with CCW
winding. `voxelsPerMeter` sets the glb's scale: at 10, a 40-voxel car is
4 m long.

### Layers

A sheet can stack several blocks of the six tiles, one under another at one
tile size: `3t × 2tN` for `N` layers, the first on top. Each layer carves its
own hull and the model is their union, so it can hold concave shapes a single
hull fills in, such as a body on separate wheels. Where two layers hold the
same voxel, the later layer colours its faces. A layer with views on one plane
only is one voxel deep, on the face of the lattice those views look at: a
front-only layer lies on the front plane.

```js
const model = buildModel(sheet, { layers: 2 });
```

Without `layers`, a sheet is one block. A document PNG names its blocks in a
`sprite-machine:layers` text chunk, `{"layers":[{"name":"Body"},{"name":"Wheels"}]}`,
whose length is the layer count. The parts are exported too: `sliceLayers`,
`buildLayeredVoxels`, `unionVoxels`, `LAYERS_CHUNK`, `layersChunk`,
`parseLayersChunk`, `layerCount` and `LAYER_MAX` (8, the app's cap, which the
chunk parser also holds to). `unionVoxels(results, { only: k })` keeps the
union's lattice and builds layer `k` alone, where it sits in the whole model.

## The technique: multi-view visual-hull voxelization

1. **Ingest**: each tile at native size into occupancy and packed-RGB
   arrays. No auto-crop, so the views stay registered.
2. **Reconcile dims**: one integer resolution per axis from the tile size
   (`front → W×H`, `side → D×H`, `top → W×D`), views placed at identity.
3. **Carve**: a voxel is solid iff it is inside every provided view's
   silhouette (a boolean AND of extruded masks).
4. **Surface**: keep the voxels with an exposed face, as six-bit masks.
5. **Colour**: each exposed face takes the colour its facing view paints at
   that voxel, snapped to the sprite's palette. A view paints every face along
   its line, not only the first, so a wall inside a notch takes the art in
   front of it. A face its own view leaves blank falls back to the mirrored
   opposite, then the neighbour average, then the dominant body colour. The
   carve keeps a voxel only where every plane group covers it, so every face
   whose axis has a view traces back to a painted texel.
6. **Mesh**: exposed faces merge on occupancy alone into coplanar regions (holes
   included), triangulated by earcut. Wedges fill every concave notch whose
   covered faces share a material: a 45° wedge fills a one-by-one step, and
   a 1:2 wedge fills a two-by-one step, the notch and the cell beside it.
   Each slope plane is traced per colour into one polygon per region, so a
   tapered slope is one triangle or trapezoid, and its gable caps fold into the
   walls. Where slopes meet at a corner, the gap their caps leave is filled from
   its rim — the caps around it plus the solid faces between them: one triangle
   for three rim points, two for four, split on the diagonal raised across the
   gap, so the planes carry their pitch around the corner like a hip roof,
   whatever pitches meet. A lattice-exact T-junction repair keeps the mesh
   watertight. The colour is a skin: a chart per multi-colour region and a
   swatch per colour, packed deterministically onto a power-of-two texture and
   sampled nearest.

With layers, steps 1 to 5 run once per layer. The union ORs the solids in the
largest lattice, extracts its surface again, and gives each exposed face the
colour the last layer holding its voxel gave it. Step 6 meshes the union.

The wedge gate is local. A riser and its tread painted the same colour get a
ramp at the corner. Painted differently, they keep the step. A staircase of
two-cell treads, or of two-cell risers, ramps at 1:2 where all three faces of
a step share the colour, and at 45° otherwise. A 1:2 fires on a step whose
legs stop at two cells and one, or at the end of a run beside such a step, so
a lone one-high ledge on a floor keeps a 45° ramp. A corner fill reads the same
way: its triangle needs two rim edges of one colour and takes it, so painting
the two slopes that meet differently keeps the corner square.

## License

MIT © Adam Portilla
