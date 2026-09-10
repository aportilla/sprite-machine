# sprite-machine

Read `README.md` first; it is the spec. The testing policy is
`docs/TESTING.md`, and it is binding. The short form:

- Unit tests only, and only for pure logic: the engine's suite stays
  dense (it is the published package), the app's covers its pure rules.
  **No browser tests** — no driven journeys, no screenshot comparisons,
  nothing that asserts markup, layout numbers, copy, constants or what
  vintage-frames renders.
- The default for a change is **no new test**. The look and the wiring
  are verified by eye: say exactly where to look and ask the user.
  `tools/capture.sh` takes a screenshot when one helps; it is never a
  check.
- The gates are `npm test`, `npm run lint`, `npm run typecheck` and
  `npm run build` — Node only, no dev server — and CI runs them before
  every Pages deploy. No one-off verification scripts.
- Commit messages and comments never report test or check counts, and
  never claim a test pins something unless it does.
- Never edit `~/MyProjects/vintage-frames` from here. A kit behavior that
  needs changing or pinning is a kit ask (`docs/kit-asks-*.md`).
- The engine (pipeline, mesher, file formats) is `packages/core`, published
  to npm as `sprite-machine`; the app imports it by that name through the
  workspace link, and the package typechecks with no DOM lib. Engine code
  never reaches for the DOM; app code never reaches into `packages/core`
  except through its barrel. `npm test` runs both packages' suites.
- Commit messages: a one-line subject, then one or two short paragraphs
  (what, why, the decisions, tests), no counts, and the
  `Claude-Session:` trailer. Commit and push on the user's word only.

## Releasing

Two versions live here, and they are independent:

- **The app** is the root `package.json`'s `version` — the About box shows
  it beside HEAD's commit date, and every push to `main` deploys it to
  GitHub Pages (`.github/workflows/pages.yml`, the gates first). Its tags
  are `vX.Y.Z`.
- **The engine** is `packages/core/package.json`'s `version` — what
  `npm install sprite-machine` resolves. Its tags are
  `sprite-machine@X.Y.Z`. A published version is immutable: fix forward,
  never reuse a number.

Semver, pre-1.0: a fix, a doc or an additive change is a **patch**; a
breaking change (a renamed or removed export, a changed default, a moved
origin or unit) is a **minor**; `1.0.0` when the user says the API holds.
The two bump on their own evidence — an engine change with no visible app
change bumps the engine alone, and vice versa — and a session may end with
both, one, or neither.

**The routine**, in order. Every gate green first — `npm test`,
`npm run lint`, `npm run typecheck`, `npm run build` — on the very commit
being released, the feature commits already made:

```sh
# 1. The app changed visibly → bump the root version (commit + tag v0.X.Y)
npm version patch          # or minor — the table above

# 2. The engine changed → bump the package (manifest + lockfile), commit, tag
npm version patch -w packages/core --no-git-tag-version
git add package.json package-lock.json packages/core/package.json
git commit -m "sprite-machine 0.X.Y"
git tag -a sprite-machine@0.X.Y -m "sprite-machine 0.X.Y"

# 3. Push the branch and every annotated tag; Pages deploys on this push
git push --follow-tags

# 4. Publish the engine — rehearse, then for real (a 2FA code is asked for)
npm publish -w packages/core --dry-run
npm publish -w packages/core
npm view sprite-machine version
```

`npm publish` is **always the user's hands**: it prompts for a one-time
code, so run it in the user's terminal (or with the `!` prefix in a
session). Claude never publishes, and runs the bump, commit and push steps
only when asked. Release notes, if wanted, go on the tag from the GitHub
releases page.

**At the end of a session**, once a feature is done and the gates are
green, close with the release steps written out for that session — the
bump level for each version with its one-line reason, the commands above
with the real numbers filled in, and which of them have already run —
even when the answer is "nothing to release".
