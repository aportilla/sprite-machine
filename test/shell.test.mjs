// Node-runnable tests for the shell slice (state/shell.js): the desktop
// pattern's setter semantics — the Desktop Patterns panel's Set and the boot
// restore both go through it. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createShell, DEFAULT_DESKTOP_PATTERN } from '../src/state/shell.js';

test('the desktop pattern boots on the classic dither', () => {
  assert.equal(DEFAULT_DESKTOP_PATTERN, 'gray-50');
  assert.equal(createShell().get().desktopPattern, DEFAULT_DESKTOP_PATTERN);
});

test('setDesktopPattern: stored as given (trimmed), silent when unchanged, empty is the default', () => {
  const s = createShell();
  let fired = 0;
  s.subscribe(() => fired++);
  s.setDesktopPattern('bricks');
  assert.equal(s.get().desktopPattern, 'bricks');
  assert.equal(fired, 1);
  s.setDesktopPattern('bricks');
  assert.equal(fired, 1, 'a same-value write is a silent no-op');
  // A custom pattern is the kit's sixteen-hex-digit grammar, kept verbatim
  // but for the trim — the slice doesn't validate (the wire does, on the
  // boot restore; the panel only ever sets library names).
  s.setDesktopPattern('  DD77DD77DD77DD77 ');
  assert.equal(s.get().desktopPattern, 'DD77DD77DD77DD77');
  s.setDesktopPattern('');
  assert.equal(s.get().desktopPattern, DEFAULT_DESKTOP_PATTERN, 'empty → the default');
  assert.equal(fired, 3);
});

test('the pattern rides alongside the focus model, not through it', () => {
  const s = createShell();
  s.setDesktopPattern('waves');
  s.setAppActive(true);
  s.setIconSelection(['doc:1']);
  assert.equal(s.get().desktopPattern, 'waves');
  assert.equal(s.get().appActive, true);
});
