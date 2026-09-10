# Kit ask #15: a dialog's opening field opens with its text selected

**Status:** OPEN on vintage-frames **0.7.2**. Written 2026-09-09 from the
New box, on the user's ask: _"when the 'new' dialog opens - can we have the
text be all selected?"_ The box opens with the next untitled name already
in the Name field (or a template's name), and the point of seeding a name
is that typing replaces it — the Mac's rule everywhere a box hands you a
name it guessed. The kit places that focus (ask #12, shipped in 0.6.2);
selecting what it focuses is the same mechanic's other half, and no app can
reach it: the `<input>` is inside the field's shadow root.

## What the kit has

- **`VfModalDialog.initialFocusTarget`** (0.6.2, ask #12) — a slotted
  `[autofocus]`, else the first visible enabled text control
  (`vf-text-field`, `vf-number-field`, `vf-text-area`, `textarea`,
  `input`), else the default button — and `#a() { this.initialFocusTarget
?.focus(); }` on open. It **focuses** and stops there, so the caret lands
  where the platform puts it (end of the text in Chrome) and the seeded
  value sits there waiting to be cleared by hand.
- **`vf-icon`'s rename box already does this**: `e?.focus(), e?.select()`
  (`vf-icon.js`) — the Finder's name-selected-for-typing, which is the
  same rule in the same kit, one component over.
- **`VfTextControlBase`** exposes `value`, `placeholder`, `readonly`,
  `name`, `label` — and no `select()`, no `selectionStart`, no
  `select-on-focus`. `shadowRootOptions` has `delegatesFocus`, so a host
  `focus()` reaches the inner control; nothing reaches its selection.

So an app that seeds a field cannot ask for the classic behavior at all —
`field.shadowRoot.querySelector('input').select()` is the only route, which
is reaching past the kit's API into its private markup, and this repository
does not do that (see below).

## The ask

**When the initial focus target is a text control, the kit selects its
text as it focuses it** — `focus()` then `select()`, exactly as `vf-icon`
does for its rename box. Empty field: a no-op. Not a text control (the
default button): unchanged. A `[autofocus]` element the markup names wins
the focus as it does today, and is selected on the same terms if it is a
text control.

That is the whole rule, and it is right for every box the kit can be
handed: a Save As prompt seeded with the document's name, a rename box, a
size field seeded with the current size, the New box's name. In each one
the seeded value is a **suggestion**, and System 7 always handed a
suggestion over selected — the Finder's rename, Standard File's Save As,
every control panel's number field.

If the kit would rather not make it unconditional, the smaller shape is an
opt-in on the dialog — `<vf-dialog select-on-open>` — or on the field
(`<vf-text-field select-on-focus>`); either is fine from here. The
unconditional rule is the ask, because the exceptions are hard to name:
a box that seeds a field and does **not** want typing to replace it is
not a box System 7 shipped.

## In the app meanwhile

**Nothing.** The one app-side route reaches into the kit's shadow root for
its `<input>`, and the standing call on this exact family — ask #12, the
About box's focus — was _"did you HACK the feature in? as we discussed,
this appears to be a Vintage Frames issue. We should not be hacking around
that."_ The New box therefore opens focused on its Name field with the
caret at the end until the kit ships the selection; the name is still
seeded, still following the template popup, and still replaceable by hand.

No test either, in either direction: a dialog's opening focus and selection
are the kit's own mechanic (`docs/TESTING.md`). `tools/drive.mjs` is
unaffected when the rule ships — `typeInto` focuses and `select()`s the
inner input itself before typing.

## After the bump

- No app change expected: the New box, the name prompt (first save and
  rename) and Tile Size all seed a value and all want it selected.
- Worth an eye on the goldens the day it lands: none of the eight shoots a
  box with a seeded field open (`boot-about` is the About box), so none
  should move.
