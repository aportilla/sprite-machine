# Testing policy

**Status:** standing policy.

- Unit tests only, and only for pure logic. `npm test` runs the engine's
  suite (`packages/core/test`: the pipeline, the meshes, the file formats)
  and the app's (`test/`: the rasterizers, undo, the document, workspace and
  files contracts, the resize rule). The engine is the published package, so
  its suite stays dense.
- No browser tests. No driven journeys, no screenshot comparisons, and
  nothing that asserts markup, layout numbers, copy, constants or anything
  vintage-frames renders. The look and the wiring are verified by eye.
  `tools/capture.sh` takes a screenshot when one helps. It is never a
  pass/fail check.
- The gates are `npm test`, `npm run lint`, `npm run typecheck` and
  `npm run build`. They run in Node, with no dev server. CI runs all four
  before every Pages deploy (`.github/workflows/pages.yml`).
- The default for a change is no new test. A new pure function with rules
  gets a unit test on its contract (the rules, the edge cases, the
  round-trip), not on its constants or defaults. Beyond that, ask the user
  to look. No one-off verification scripts.
- Commit messages and comments never report test counts, and never claim a
  test pins something unless it does.
