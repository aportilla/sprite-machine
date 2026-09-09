# Plan: workspaces — the engine as an npm package, the app on GitHub Pages

**Status:** proposed 2026-09-09, on the user's choice of the workspaces
approach over a separate repository, and **BUILT the same day** as
written, steps P and 0–4 — the name `sprite-machine`, the MIT license and
the `^0.185.0` peer range taken as proposed (§6); step 5, the publish, is
the user's hands. The as-built passages are the root README's run block
and §Architecture, and the package's own README. One deviation: the
`?diag=1` probe reads `computeDiag` through the barrel's static import
rather than a dynamic one — a dynamic import of a module the bundle
already holds moves nothing, and Vite said so. The ask: _"i've got a
project where i want to keep my 3d assets source of truth as our 2d sprite
machine images — and use our 3d model exporter headlessly on app startup
to generate the 3d model assets used in the app. can we break out an async
headless utility that will do this? … is our project configured such that
i could publish that utility to npm?"_ — and, the same day, _"i do want
to publish our GUI app as well — potentially just as a github pages static
site."_

The short version: **one repository, two packages.** The pipeline, the
mesher and the file formats — everything under `src/lib/` that is the
product rather than the editor — move to `packages/core` and publish to
npm as **`sprite-machine`** (the name is free; so is `sprite-machine-core`,
§6.1), with `three` a peer dependency and one new entry, `buildModel` →
`modelToGlb`, that a Node script or a three.js app calls with a sheet's
pixels. The desktop app stays at the root, private, and imports the engine
by its package name through the workspace link — one `npm test`, one
commit per change, no two-repo dance. The app publishes as a **GitHub
Pages project site** from a workflow mirroring the kit's, at
`https://aportilla.github.io/sprite-machine/`, with no change to the build
(§3). The Pages half is independent of the workspace half and can ship
first.

## 1. What is already true

- **The chain runs in Node.** Slice the atlas, carve, mesh, bake the skin,
  encode it, write the glb: `test/gltf.test.mjs` does exactly that on a
  sprite, THREE core, `mergeVertices` and `ShapeUtils` included, no DOM.
  `scene/model-export.js` only reads buffers off the mesh and applies the
  scale; `wedgeMesh` already takes a `worldSize`.
- **The one gap is decoding a PNG's pixels.** The app decodes through
  `createImageBitmap` and a canvas (`image-io.js`); the repo has an
  encoder (`lib/png-encode.js`) and a chunk reader (`lib/png-chunks.js`)
  but no decoder, and the Node suites use a synthetic PNG stub
  (`test/helpers.mjs`). A headless path needs a real one — any foreign 3×2
  sheet is a legal document, and an Aseprite export is usually an indexed
  PNG — so the Node entry takes `pngjs` (no dependencies of its own).
- **Nothing is configured to publish.** `private: true`; no `exports`,
  `files` or `bin`; `lit`, `vintage-frames` and `three` all in
  `dependencies`; a DOM `tsconfig`; `lib/sprite-data.js` importing a PNG
  through Vite; and `package.json`'s `version` doubling as the About
  box's, so a library release and an app release would be one ritual.
- **Nothing in the build is asynchronous by nature.** The pure chain is
  synchronous; only a browser's decode is async. The Node entry stays
  synchronous too, and a consumer that wants it off the main thread wraps
  it in a worker or a child process — the consumer's call, not the API's.
- **Pages needs no build change.** `vite.config.js` already builds with
  `base: './'`, so every emitted URL is relative and the bundle serves from
  `/sprite-machine/` as it does from `/`. The one root-absolute path in
  the tree is `index.html`'s `<script src="/src/main.js">`, which Vite
  rewrites at build. There is no client-side router: `?file=` and the
  `#Cube` fragment are read by the page, so a static host serves them.

## 2. The shape

### 2.1 The layout

```
sprite-machine/                the workspace root IS the app (private)
  package.json                 "workspaces": ["packages/*"]; the app's deps + scripts
  index.html  vite.config.js  src/  test/  tools/  docs/   unchanged in role
  packages/core/               published as `sprite-machine`
    package.json               exports, bin, files, peer three, dep pngjs
    README.md                  the technique, the API, the CLI
    tsconfig.json              lib ES2022 alone — no DOM, by construction
    src/                       the modules of §2.2, index.js the barrel,
                               model.js + node.js the two new files
    bin/sprite-machine.mjs     the CLI
    test/                      the moved suites + their helpers
```

The app stays at the root rather than moving to `packages/app`: `npm run
dev`, `tools/`, the goldens and every path in `docs/` keep meaning what
they mean, and the root package is a workspace member in all but name.

### 2.2 The sort: what is the product

`src/lib/` today mixes the engine with the editor. The line is what a
consumer of the model needs — and it is already drawn in the import graph:
no engine module imports an editor module, and `constants.js` is the one
file with a foot on each side.

**To `packages/core/src/`** (the engine): `ingest`, `carve`, `colorize`,
`pipeline`, `views`, `faces`, `atlas` (whole — slicing and validating are
the entry, and `resizeAtlas` is a legitimate headless operation),
`regions`, `t-junction`, `skin`, `mesh-util`, `wedge-mesh`, `png-chunks`,
`png-encode`, `gltf`, `diag`, and `constants` reduced to `DEFAULT_MIRROR`
and `DEFAULT_WORLD_SIZE`.

**Staying in `src/lib/`** (the editor): `rect`, `fill`, `select`, `brush`,
`ants`, `edges`, `color`, `zip`, `ring` (pure, but its only consumer is a
GL renderer; it moves the day a headless atlas render exists — §6.4),
`sprite-data` (a Vite PNG import and `new ImageData`), and a new
`palette.js` holding `PENCIL_PALETTE` and `PALETTE_168` out of
`constants.js`, importing `packRGBA` from the package.

**The tests follow their modules.** To `packages/core/test/`: `ingest`,
`carve`, `colorize`, `pipeline`, `views`, `atlas`, `regions`,
`t-junction`, `skin`, `wedge-mesh`, `png-chunks`, `png-encode`, `gltf`,
`diag`. The rest stay. `test/helpers.mjs` splits by use: the sprite
builders (`img`, `fill`, `C`) and the mesh probes (`oddEdges`,
`hasTJunction`) go with the engine's suites; `fakeScheduler`,
`memStorage` and the codec stub stay, the stub's `chunk` taking `crc32`
from the package. The drive's three readers (PNG chunks, glb from the
package; zip from the app) are the same readers at a new path — the
policy's "imports nothing from `src/` but the readers" holds unchanged.

**Every move is a `git mv`** so history follows each file.

### 2.3 The package

`packages/core/package.json`:

- `"name": "sprite-machine"`, `"version": "0.1.0"`, `"type": "module"`,
  the root's `engines`. The root renames to `sprite-machine-app` (a
  workspace and its root cannot share a name); nothing reads the root's
  name — `vite.config.js` reads its `version`, which stays the About
  box's.
- `"exports": { ".": "./src/index.js", "./node": "./src/node.js" }` — the
  barrel and the Node adapter, nothing deeper. The barrel is **explicit**
  `export { … } from` lines, not `export *`: `views.js` and `carve.js`
  both export `FACE_KEYS` today (carve re-exports it), and two star
  exports of one name silently export neither. The re-export goes.
- `"bin": { "sprite-machine": "./bin/sprite-machine.mjs" }`,
  `"files": ["src", "bin", "README.md"]` — no build step; the sources
  are the package, JSDoc-typed as they are. Emitting `.d.ts` from the
  JSDoc on `prepack` (`tsc --declaration --emitDeclarationOnly`, the kit's
  `tsconfig.build.json` pattern) is a follow-up, not a blocker.
- `"peerDependencies": { "three": "^0.185.0" }` — the version the suites
  run on; widen when a wider range has been run. A three.js app already
  has three; a Node consumer gets it installed as a peer (npm 7+).
- `"dependencies": { "pngjs": "^7" }` — imported by `./node` alone, so a
  browser bundle of `.` never sees it.
- `"license"` and a `LICENSE` file, the kit's as the pattern — a published
  package declares one; the root has none today (§6.2).
- `tsconfig.json` with `"lib": ["ES2022"]` and no DOM: a `document` or an
  `ImageData` in the engine fails `typecheck`, which is the boundary's
  enforcement. If three's typings drag DOM names in past `skipLibCheck`,
  a one-file `dom-shim.d.ts` declaring them `any` keeps the wall up.

### 2.4 The API

`packages/core/src/model.js`, the headless entry:

```js
import { buildModel, modelToGlb } from 'sprite-machine';

const model = buildModel(sheet, { transforms }); // sync, pure
//   sheet: {width, height, data} — the 3×2 atlas's RGBA pixels
//   → {mesh, dims, triangles, warnings}: the THREE.Mesh at ONE UNIT PER
//     VOXEL (wedgeMesh at worldSize = max(dims)), the skin its map
const glb = modelToGlb(model, { name, voxelsPerMeter, unlit, generator });
//   → Uint8Array, scale 1 / voxelsPerMeter; the app's dialog default is 10
```

`modelToGlb` is `scene/model-export.js`'s `exportGlb` body extracted —
the buffer reads, the skin's `encodePng`, the `extras` — parameterized on
the mesh's units per voxel. The app's `model-export.js` keeps the subject
and the stats readout and calls it with the stage's units, so the export
menu and the headless path are **one function**, and nothing needs to
compare them. `wedgeMesh`'s default `worldSize` stays `DEFAULT_WORLD_SIZE`
for the app's stage.

`packages/core/src/node.js`, the Node adapter (`sprite-machine/node`):

```js
import { readSheet, sheetToGlb } from 'sprite-machine/node';

const { image, name, transforms, chunks } = readSheet(bytes);
//   pngjs decodes the pixels; readTextChunks reads Title and
//   sprite-machine:transforms (the ring chunk rides along in `chunks`,
//   unparsed — a viewing setting, the app's business)
const glb = sheetToGlb(bytes, { voxelsPerMeter: 10 }); // the two above, then modelToGlb
```

The name falls back to the caller's; the transforms chunk is honored, so a
downloaded document builds the same mesh headless that it shows in the
3D View.

`packages/core/bin/sprite-machine.mjs`, the CLI (`node:util`'s
`parseArgs`, no dependency):

```
sprite-machine build sprites/*.png --out models/ [--voxels-per-meter 10] [--unlit]
```

One `<name>.glb` per sheet — the Title chunk's name, else the file's — a
line per file naming it, its triangles and its bytes, non-zero exit on the
first failure. A consumer whose "app startup" is Node runs this or calls
`sheetToGlb`; one whose startup is a three.js page calls `buildModel` on
pixels it decoded itself and uses the mesh directly — a glb would be a
round trip through bytes for nothing. A `sprite-machine/browser` adapter
over `createImageBitmap` is a follow-up (§6.4).

### 2.5 The app after the move

- Every `../lib/<engine module>.js` import becomes
  `from 'sprite-machine'`; the editor modules keep their relative paths.
  Vite resolves the workspace symlink to `packages/core/src` and serves it
  as source, with HMR, `three` resolving from the root's `node_modules`.
- Root scripts: `"test": "node --test test/*.test.mjs
packages/core/test/*.test.mjs"` (one process, one glob),
  `"typecheck": "tsc -p tsconfig.json && tsc -p packages/core"`; `lint`,
  `dev`, `build` unchanged (prettier's `.` covers the package). The
  package carries its own `test` and `typecheck` for a publish from its
  directory.
- CI is unchanged but for what the scripts now cover: `npm ci` installs
  the workspace, the matrix runs lint, typecheck, test and the app build.
- Publishing is the kit's ritual, on demand: bump `packages/core`'s
  version, `npm publish -w packages/core`. The app's version and the
  About box are untouched by it.

## 3. GitHub Pages

Yes, and it is the smallest piece. `.github/workflows/pages.yml`, the
kit's workflow with the app's build in it:

- On push to `main` and `workflow_dispatch`; `pages: write` and
  `id-token: write` permissions; the `pages` concurrency group with no
  cancel-in-progress (a half-finished deploy is worse than a superseded
  one).
- Checkout, Node 22, `npm ci`, `actions/configure-pages` with
  `enablement: true` — the first run switches the repository's Pages
  source to Actions, so there is no Settings click — `npm run build`,
  `upload-pages-artifact` of `dist/`, `deploy-pages`.
- No base-path plumbing: the kit's `VF_BASE` dance exists because its
  pages build is root-based; this app's is relative (§1). The site is
  `https://aportilla.github.io/sprite-machine/`.
- The About box's date is HEAD's commit date via `git log -1`, which the
  default shallow checkout carries; the version is the root
  `package.json`'s. A deploy says what a local build of that commit says.
- The dev hooks (`?sample=`, `?fresh=1`, …) ship, as they do in every
  build; they are URL parameters and harmless.
- One thing to know, not to change: every project site of one account
  shares the origin `aportilla.github.io`, so IndexedDB and localStorage
  are shared with the kit's docs site and any future one. The app's names
  are namespaced (`sprite-machine`, `sprite-machine:desktop`); a future
  site of yours that stores state should namespace its own.
- CI and Pages both run on a push to `main`; Pages is not gated on CI (the
  kit's shape). A push whose build fails leaves the previous deployment
  up.

Nothing in `tools/` changes: capture, goldens and the drive run against
the dev server.

## 4. Tests, per `docs/TESTING.md`

- **The move**: no new test. The suites move with their modules and keep
  passing; that they pass from the new paths is the check.
- **`buildModel` / `modelToGlb`**: new pure logic — one contract test: a
  sheet with a transform builds at one unit per voxel with the transform
  applied, and the glb's positions carry the `voxelsPerMeter` scale. Not
  the defaults.
- **`readSheet`**: new pure logic — one round-trip test: `encodePng`'s
  output decodes to the same pixels, and a Title chunk comes back as the
  name.
- **The CLI**: wiring over the API; nothing.
- **Pages**: nothing; the first deploy is looked at.
- README passages that change (§5, step 5); no SMOKE item, no tally.

## 5. Steps

Each step leaves `npm test`, `npm run lint`, `npm run typecheck`,
`npm run build`, the drive and the goldens green.

- **P. Pages** — independent; can go first. `pages.yml` as §3. Push,
  watch the first run enable the site, open the URL, boot to the About
  box, open the Car.
- **0. Scaffold** — root `workspaces`, the root rename, `packages/core`'s
  `package.json` and `tsconfig.json`, an empty barrel, the root scripts.
  `npm install` relinks and updates the lockfile. Nothing moves yet.
- **1. The sort** — `git mv` the engine modules and their tests (§2.2);
  split `constants.js` and `helpers.mjs`; the barrel's explicit exports;
  every app import rewritten to the package name; the drive's two readers
  likewise. The one code change is carve's `FACE_KEYS` re-export going.
- **2. `model.js`** — `buildModel` and `modelToGlb`; `model-export.js`
  calls the latter. Its test.
- **3. `node.js` and the CLI** — `readSheet`, `sheetToGlb`, `pngjs`, the
  `bin`. Its test. Run the CLI on the Car's PNG and open the glb in the
  same viewer the app's export is checked in.
- **4. Docs** — `packages/core/README.md` (the technique section, the
  API, the CLI; the root README keeps its copy, it is the spec);
  the root README's run block gains the site URL and the install line,
  its §Architecture tree shows the two homes, `docs/TESTING.md`'s layer 1
  names the second test directory.
- **5. Publish** — `license` + `LICENSE`, `npm publish -w packages/core`,
  the user's call and hands.

## 6. Decisions to confirm, and what is out of scope

1. **The name.** `sprite-machine` for the package — the brand on npm
   belongs to what people install, the way `vintage-frames` does, and it
   makes the CLI `npx sprite-machine build`. The alternative is
   `sprite-machine-core` with the root keeping its name. Both are free as
   of this writing.
2. **The license.** The root declares none. A publish needs one; the
   kit's `LICENSE` is the pattern.
3. **The three peer range.** `^0.185.0` states what is tested; widen on
   evidence.
4. **Out of scope, named**: a `sprite-machine/browser` adapter (the app's
   `image-io.js` stays the app's); a headless 3D Sprite Atlas render
   (needs a GL context — `lib/ring.js` and the ring renderer stay in the
   app until then); `.d.ts` emission; a `--check` flag over `computeDiag`;
   moving the app into `packages/app`; gating Pages on CI; a custom
   domain.
