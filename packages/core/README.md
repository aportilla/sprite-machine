# sprite-machine

Turn a **3×2 sheet of pixel-art face sprites** (left / front / top over
right / back / bottom) into a real, low-poly, textured **three.js mesh** —
or a **glTF 2.0 binary** any engine's importer reads. The chunky look is
carved into the geometry, not faked by a shader: 1 pixel = 1 voxel, with
45° wedges smoothing every same-colour staircase and the colour riding a
nearest-sampled skin texture.

This is the engine behind [Sprite Machine](https://aportilla.github.io/sprite-machine/),
the System 7 desktop app that draws these sheets. Keep the sheet as the
source of truth and derive the model wherever you need it — at a build
step, at a server's startup, or in the browser, straight into a scene.

```bash
npm install sprite-machine three
```

`three` is a peer dependency: the mesh is a `THREE.Mesh` and the mesher
uses three's geometry utilities. Node 20.19+ / 22.12+.

## The API

```js
import { buildModel, modelToGlb } from 'sprite-machine';

// pixels in: {width, height, data} — an ImageData, or the same shape
const model = buildModel(sheet, { transforms });
//   → { mesh, dims, triangles, warnings, unitsPerVoxel: 1 }
//     a THREE.Mesh at ONE UNIT PER VOXEL, its skin the material's map;
//     `transforms` is the document's per-view reorientation (optional)

const glb = modelToGlb(model, { name: 'car', voxelsPerMeter: 10 });
//   → Uint8Array: one node, one mesh, one primitive, the skin embedded as
//     a PNG behind a NEAREST sampler; `unlit: true` for KHR_materials_unlit
```

Both are synchronous and pure. A three.js page uses `model.mesh` directly
and never writes a file; a Node process writes the glb. To run the build
off a main thread, wrap it in a worker or a child process.

### In Node: a document PNG in

```js
import { readSheet, sheetToGlb } from 'sprite-machine/node';

const { image, name, transforms } = readSheet(bytes); // pngjs decodes; the
// Title and sprite-machine:transforms chunks are read as the app reads them
const glb = sheetToGlb(bytes, { voxelsPerMeter: 10 }); // the three calls in one
```

`sprite-machine/node` is the one entry with a decoder; the root entry takes
pixels and depends on nothing but three, so a browser bundle never sees
`pngjs`. In a browser, decode with `createImageBitmap` and a canvas and
hand `buildModel` the `ImageData`.

### The CLI

```
npx sprite-machine build sprites/*.png --out models/ [--voxels-per-meter 10] [--unlit]
```

One `<name>.glb` per sheet — the Title chunk's name, else the file's — and a
line per file. The first failure exits non-zero.

## The sheet

One PNG, six tiles in a fixed layout, empty tiles allowed (a face with no
view of its own is mirror-filled from its opposite):

```
LEFT   FRONT  TOP
RIGHT  BACK   BOTTOM
```

The tile size derives from the image (a 120×80 sheet is 40×40 tiles). Use
**square tiles**: a tile is a literal slice of the voxel lattice, so a
pixel's position inside its tile is its position in the object, and the
faces must be **registered** — a FRONT pixel is solid only where the SIDE
covers its row and the TOP covers its column. Sprites are hard pixel art:
every texel fully opaque or fully transparent.

World: `+x` right, `+y` up, `+z` toward the front. Draw FRONT and BACK
head-on and upright; RIGHT and LEFT as the sides with the front pointing
right and left; TOP and BOTTOM as plan views with the front at the top edge.
Per-tile `rot` / `flipX` / `flipY` transforms exist for sheets that don't
follow the convention.

The model's origin is the **lattice floor's centre**, Y up, winding CCW.
`voxelsPerMeter` is the reader's scale: at 10, a 40-voxel car is 4 m long.

## The technique: multi-view visual-hull voxelization

1. **Ingest** — each tile at native size into occupancy and packed-RGB
   arrays. No auto-crop: registration is the whole point.
2. **Reconcile dims** — one integer resolution per axis from the tile size
   (`front → W×H`, `side → D×H`, `top → W×D`), views placed at identity.
3. **Carve** — a voxel is solid iff it is inside every provided view's
   silhouette: a boolean AND of extruded masks.
4. **Surface** — keep the voxels with an exposed face, six-bit masks.
5. **Colour** — each exposed face takes the colour of the view that sees it
   first along its axis (depth-aware first hit), snapped to the sprite's
   palette; faces no view sees fall through mirrored opposite → neighbour
   average → dominant body colour.
6. **Mesh** — exposed faces merge on occupancy alone into coplanar regions
   (holes included), triangulated by earcut; 45° **wedges** fill every
   concave unit-step notch whose two faces share a material, one quad per
   slope block, the gable caps folded into the walls; a lattice-exact
   T-junction repair keeps it watertight. The colour is the **skin**: a
   chart per multi-colour region, a swatch per colour, packed
   deterministically onto a power-of-two sheet and sampled nearest.

The wedge gate is strict and local: paint a riser and its tread the same
colour and the corner ramps; paint them differently and it stays a crisp
step. That is the author's control over every slope.

## License

MIT © Adam Portilla
