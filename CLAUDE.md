# sprite-machine

Read `README.md` first; it is the spec. The testing policy is
`docs/TESTING.md`, and it is binding. The short form:

- Tests cover what Sprite Machine implements, never what vintage-frames
  implements or how it renders. A test that would fail because the kit
  changed a pixel, a metric or a rule is not written here.
- The default for an enhancement is **no new test**. Add one only for new
  pure logic (a unit test on its rules) or for new browser-only wiring no
  journey already crosses (one drive check, on the outcome). Never for
  markup, constants, layout numbers, copy or a kit attribute.
- The look is verified by eye, or by an existing golden re-blessed on
  purpose in the shipping commit. Never by an assertion.
- No one-off verification scripts. The standing tools are `npm test`,
  `npm run lint`, `npm run typecheck`, `tools/drive.mjs`,
  `tools/capture.sh` and `tools/goldens.sh`; beyond those, ask the user
  to look.
- Commit messages and comments never report test or check counts, and
  never claim a test pins something unless it does.
- Never edit `~/MyProjects/vintage-frames` from here. A kit behavior that
  needs changing or pinning is a kit ask (`docs/kit-asks-*.md`).
