# Testing policy

**Status:** standing policy, Sep 10 2026. It replaces the four-layer setup
of Sep 5 (a driven browser smoke, golden screenshots, a manual checklist
and unit tests), retired as more friction than protection: the screenshots
failed on every intended change of the look, and the drive had to change
in nearly half of all commits.

- **Unit tests only, and only for pure logic.** `npm test` runs the
  engine's suite (`packages/core/test`: the pipeline, the meshes, the file
  formats — the published package, so it stays dense) and the app's
  (`test/`: the rasterizers, undo, the document / workspace / files
  contracts, the resize rule).
- **No browser tests.** No driven journeys, no screenshot comparisons, and
  nothing that asserts markup, layout numbers, copy, constants or anything
  vintage-frames renders — the kit has its own suite. The look and the
  wiring are verified by eye. `tools/capture.sh` takes a screenshot when
  one helps; it is never a pass/fail check.
- **The gates** are `npm test`, `npm run lint`, `npm run typecheck` and
  `npm run build`: Node only, seconds, no dev server. CI runs all four
  before every Pages deploy (`.github/workflows/pages.yml`).
- **The default for a change is no new test.** A new pure function with
  rules gets a unit test on its contract — the rules, the edge cases, the
  round-trip — never its constants or defaults. Beyond that, ask the user
  to look. No one-off verification scripts.
- Commit messages and comments never report test counts, and never claim
  a test pins something unless it does.
