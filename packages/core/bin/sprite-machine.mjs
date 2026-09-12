#!/usr/bin/env node
// CLI over sprite-machine/node: writes one glb per sprite sheet (see USAGE)
// and prints each file's path, name and size. Exits 1 on the first failure.

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { readSheet, sheetToGlb } from '../src/node.js';

const USAGE = `usage: sprite-machine build <sheet.png>... --out <dir> [--voxels-per-meter N] [--unlit]

  build   write one <name>.glb per sheet into --out (the Title chunk's name,
          else the file's); --voxels-per-meter is the reader's scale (10: a
          40-voxel car is 4 m long); --unlit writes KHR_materials_unlit.
`;

function fail(message) {
  process.stderr.write(`sprite-machine: ${message}\n`);
  process.exit(1);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', short: 'o' },
    'voxels-per-meter': { type: 'string' },
    unlit: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help || positionals.length === 0) {
  process.stdout.write(USAGE);
  process.exit(values.help ? 0 : 1);
}

const [command, ...sheets] = positionals;
if (command !== 'build') fail(`unknown command "${command}"\n\n${USAGE}`);
if (sheets.length === 0) fail('no sheets given.');
if (!values.out) fail('--out <dir> is required.');

let voxelsPerMeter;
if (values['voxels-per-meter'] !== undefined) {
  voxelsPerMeter = Number(values['voxels-per-meter']);
  if (!Number.isFinite(voxelsPerMeter) || voxelsPerMeter <= 0)
    fail(
      `--voxels-per-meter must be a positive number, got "${values['voxels-per-meter']}".`
    );
}

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const generator = `sprite-machine ${pkg.version}`;

mkdirSync(values.out, { recursive: true });
for (const file of sheets) {
  let bytes;
  try {
    bytes = new Uint8Array(readFileSync(file));
  } catch (err) {
    fail(`cannot read ${file}: ${err.message}`);
  }
  let name;
  let glb;
  try {
    name = readSheet(bytes).name ?? basename(file, extname(file));
    glb = sheetToGlb(bytes, { name, voxelsPerMeter, unlit: values.unlit, generator });
  } catch (err) {
    fail(`${file}: ${err.message}`);
  }
  const out = join(values.out, `${name}.glb`);
  writeFileSync(out, glb);
  process.stdout.write(`${out}\t${name}\t${glb.length} bytes\n`);
}
