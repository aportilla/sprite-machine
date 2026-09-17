# sprite-machine

Read `docs/SPEC.md` first; it is the spec. `README.md` is the user guide. The
testing policy is `docs/TESTING.md`, and it is binding. The short form:

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
- Comments and docs are short, dry and direct. Let the code speak for
  itself; comment only to label a section or state a non-obvious
  constraint (an ordering rule, a browser or kit workaround, a unit, an
  invariant) in a sentence or two. No justification or roads not taken,
  no history or dates, no plan or ask references, no ALL-CAPS emphasis,
  no em-dash chains, and no cute or figurative phrasing. A module header
  is a line or a few. JSDoc descriptions are a sentence at most.
- Never edit `~/MyProjects/vintage-frames` from here. A kit behavior that
  needs changing or pinning is a kit ask for the user.
- The engine (pipeline, mesher, file formats) is `packages/core`, published
  to npm as `sprite-machine`; the app imports it by that name through the
  workspace link, and the package typechecks with no DOM lib. Engine code
  never reaches for the DOM; app code never reaches into `packages/core`
  except through its published entries. `npm test` runs both packages' suites.
- Commit messages: a one-line subject, then one or two short paragraphs
  (what, why, the decisions, tests), no counts. Never a Claude trailer or
  attribution: no `Claude-Session:`, no `Co-Authored-By:`, no "Generated
  with" line. Commit and push on the user's word only.

## Applications and the shell

The desktop is four applications — the Finder, the Sprite Editor, the Text
Viewer and Desktop Patterns, one directory each under `src/apps/` — over
one shell. Keep them apart:

- **Application behavior lives in its application's directory**: its menus
  and commands (`menus.html`, `index.js`), and its windows — their markup
  (`windows.html`), lifecycle, adoption and what their close and zoom boxes
  mean (`windows.js`), and their placement and sizes (`layout.js`, pure).
  `src/shell/` holds only what every application shares: the window
  manager's rules (`shell/windows.js` — `windows.adopt`, the
  front-application reading, the resize rule, Arrange Windows composed from
  each application's group) and the desktop's geometry (`shell/layout.js` —
  the landmarks, `WINDOW_ORIGIN`, the cascade, nearness, the pin).
- **Primitives in the shell, choices in the application.** A cascade, a
  pin, a centered box or a nearness test may live in the shell; which box,
  which size and what "zoomed" means belong to the application. Shell code
  that names an application, a kind of window, or a number derived from
  one application's art is in the wrong place — and existing code that
  does it is debt to pay down, never a precedent to copy.
- **The arrows point one way**: `src/apps/` imports `src/shell/`, never the
  reverse. An application reaches the shell through generic declarations
  (`windows.adopt`, `arrangeWith`, `setFrameBands`) and signals
  (`onLayout`, `onWindows`, `onRaster`, `beforeFront`); the shell never
  calls into an application through a hook the application injected.
- **Cross-application calls** go through `deps.apps`, read at pick time,
  never at wire-up, so the order the applications initialize in never
  matters.
- Follow-ups take the same direction: the scene beside its windoids, the
  components beside their application.

A larger change starts as a plan in `docs/<topic>-plan.md`: a status line
quoting the ask, the System 7 model it copies, the design, steps that each land green, kit
asks, numbered decisions for the user with a recommendation each, tests
by the rules, follow-ups and files touched. The decisions are the user's:
record each in the plan, dated, when it is made, and keep the status line
current as steps land.

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
