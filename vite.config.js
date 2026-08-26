import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The About box's two BUILD facts (src/shell/menus.js writes them into the
// dialog; src/env.d.ts declares them for tsc): the version is package.json's,
// and the date is HEAD's commit date — the date of the code that is running,
// so every build of one commit says the same thing (capture.sh's byte
// determinism holds across runs) — formatted HERE, in Node, as System 7's own
// short form ("Aug 24, 2026"), so the page ships a plain string that no
// runtime locale or timezone can move. Without git (a tarball build) the date
// falls back to today's. Read once per server start / build.
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
    // no git, no repo: fall through to today
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
