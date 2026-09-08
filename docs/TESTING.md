# Testing policy

**Status:** standing policy, Sep 8 2026. It consolidates README §Testing,
the rules given in review since Aug 2026, and the trim recorded in
[test-trim-plan.md](test-trim-plan.md). When a change and this note
disagree, the note wins until the note is edited.

## The one rule

**Tests cover what Sprite Machine implements. They never cover what
vintage-frames implements, and never how vintage-frames renders.**

The kit has its own suite (`npm test` in `~/MyProjects/vintage-frames`).
A test here that would fail because the kit changed a pixel, a part
rect, a metric, a rule or a default is a kit test in the wrong
repository: it is not written, and when found it is deleted. If a kit
behavior needs pinning, that is a kit ask (`docs/kit-asks-*.md`), and the
kit pins it there.

"How the kit renders" includes anything the app assembles purely from kit
primitives — a double rule from a container's `rule="bottom"` and a
header's own rule, a strip from a container and separators, a header
height, a label's baseline. The markup and the numbers in `layout.js`
are the spec; the eye verifies them; no assertion restates them.

## The four layers

Each layer does the one thing it is cheapest at. Nothing is covered twice.

1. **Node unit tests** (`npm test`, `test/*.test.mjs`) — pure code where
   bugs are silent and expensive: the pipeline (ingest, carve, colorize),
   the meshes (regions, wedges, T-junctions, the skin), the rasterizers
   (rect, fill, brush, ants, select), the file formats (PNG chunks, the
   PNG encoder, zip, glTF), undo, the document / workspace / files
   contracts, and layout **rules** (placement, cascade, the pin's fixed
   point, the folder lattice) — rules, never a number against a literal.
   Dense there, and only there.
2. **`tools/drive.mjs`** — user journeys that cross a boundary a unit
   cannot: IndexedDB, trusted input, the real canvas, the menu wiring, a
   reload. A check names an outcome of the app's own — a store value read
   through a control, a texel, a stored record, a window opened, a
   handler having run. It drives **through** kit controls and asserts
   none of them. Ceiling: one hundred checks (about eighty today).
3. **Golden screenshots** (`tools/goldens.sh` over `tools/capture.sh`,
   `docs/goldens/`) — the look, byte-compared, zero assertion code. A
   golden changes only in a commit that changed the look on purpose,
   after an eye on the diff.
4. **`docs/SMOKE-TEST.md`** — the manual residue no tool reaches: chorded
   and right-button drags, feel, the cursor, browser zoom, a dropped file.
   An item says what to do and what should happen, in one breath. It is
   a checklist of behaviors, not a catalogue of features or a description
   of pixels.

## The decision for an enhancement or a feature

Ask these in order and stop at the first that applies. **The default
answer is no new test.** A change ships with a test when it adds a risk
the gates do not already cover.

1. **New pure logic** — a function in `lib/` or `state/` with inputs and
   outputs? One unit test on its contract: the rules, the edge cases, the
   round-trip. Not its constants, not its defaults.
2. **New browser-only wiring** — a menu item to a handler, a kit event
   into app state, a store to a stored record, a gesture to a texel — that
   **no existing journey already crosses**? At most one drive check, on
   the outcome, inside the journey it belongs to. If a journey already
   crosses that wiring, nothing.
3. **A change to the look** — chrome, layout, a rule, a label's position,
   a paper? Nothing in code. If a golden already frames it, the golden
   re-blesses in the shipping commit after an eye on the diff. Otherwise
   the user eyeballs it; say exactly where to look and what to expect.
4. **Markup, constants, layout numbers, copy, a kit attribute** (a
   `header-height`, a `pattern`, a `rule`, a `top`)? Nothing. Never.

## Never

- No test of the kit's rendering: rule positions, header heights, rail
  widths, the pattern raster, baselines, line boxes, focus rings, dialog
  frames, the cursor, a drag's delta, DOM order after a raise.
- No `[part=…]` rect asserted, no `vf-*` element counted, no `--vf-*`
  property read, no `resizable` / `header-height` / size rect pinned.
  Locating a control by its part **to drive it** is fine.
- No constant against a literal, and no constant against another
  constant's arithmetic (`STRIP === LINE + 2` is the kit's anatomy
  restated). No default parameter, no dev-only URL hook, no guard that a
  retired feature stays absent.
- No literal UI copy. A generated value's **shape** is fine (a version
  number's pattern, a count's digits); the words are not.
- No re-derivation: the drive imports nothing from `src/` but the three
  file readers it needs to open the exports (PNG chunks, zip, glb) and
  checks that the app applied its own arithmetic, read off the page.
- No store discipline per setter; it is tested once, in
  `test/store.test.mjs`.
- No precondition logged as a check; a helper that cannot find its target
  throws.
- No one-off verification scripts — a bespoke CDP script to raise a
  dialog and shoot it, a scratch page probe. The standing tools are
  `npm test`, `npm run lint`, `npm run typecheck`, `tools/drive.mjs`,
  `tools/capture.sh`, `tools/goldens.sh`. Beyond those, ask the user to
  look.
- No test or check counts in commit messages. No comment that says "the
  test pins this" or "the drive pins the two" unless one does.
- No per-feature ritual. A feature does not automatically get a drive
  check plus a unit test plus a SMOKE item plus a README catalogue line;
  that ritual is what turned the suites into a change amplifier.

## What earns its place — by example

- **Unit:** _a slope costs the same triangles 1 wide and 4 wide_ — a
  rule. _A record keeps its folder across an in-place save and a rename_
  — a contract. _A folder never moves into itself or a descendant_ — a
  refusal.
- **Drive:** _the Car's icon dragged onto the folder files it: it leaves
  the desktop, and the folder's window opens holding it, the header
  counting one_ — trusted input → model → DOM, one check for the whole
  journey.
- **Golden:** the atlas strip's shot, re-blessed when the mesh changed
  and the diff was listed (47 px, last-bit shading), never asserted in
  code.
- **Smoke:** _press a desktop icon and drag it across a document window,
  a windoid and the menu bar — a dotted outline travels over all of them;
  Esc mid-drag takes it down and nothing moves._

## The line, as drawn in review

- **Aug 26 2026** — a drive check on the About box's "created by" line
  and its link, verbatim: "way too granular". Copy is content, not
  behavior.
- **Sep 2 2026** — "our tests should cover what Sprite Machine
  implements, not what Vintage Frames implements. This is a general
  principle."
- **Sep 5 2026** — "i'm worried we're over testing… we do not need to
  test every single little thing." The drive went from 320 checks to 81,
  the unit suites from 347 cases to 218, SMOKE-TEST from 72 items to 21.
- **Sep 8 2026** — the folder window's header gained the Finder's double
  rule: two kit rules (a `vf-container rule="bottom"` and the header's
  own), `header-height` 20. A layout assertion that the strip equals the
  count line plus two, and a SMOKE line about which rows the count's
  digits sit on, were written and reverted the same hour: both test how
  the kit renders the app's markup. The change ships with no new test;
  the user eyeballs the window.

## Paperwork

A change touches the code, the README passage that describes the
behavior if the behavior changed, and by default nothing else — not the
test catalogue, not SMOKE-TEST, not a tally. Where a number was measured
from (a Finder screenshot at 2×) belongs in a comment beside the number,
so the next reader knows what it means without a test to tell them.
