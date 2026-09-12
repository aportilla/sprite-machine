import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Build constants for the About box (shell/menu-bar.js, declared in
// src/env.d.ts): package.json's version and HEAD's commit date. The date is
// formatted here ("Aug 24, 2026") so no runtime locale or timezone changes it.
// Without git it falls back to today.
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
function buildDate() {
  let ymd = '';
  try {
    ymd = execFileSync('git', ['log', '-1', '--format=%cs'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // no git: use today
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (m) return `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
  const t = new Date();
  return `${MONTHS[t.getMonth()]} ${t.getDate()}, ${t.getFullYear()}`;
}

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_DATE__: JSON.stringify(buildDate()),
  },
  server: {
    host: true,
    open: false,
  },
  build: {
    target: 'es2022',
  },
});
