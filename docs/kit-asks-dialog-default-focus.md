# Kit ask #12: a dialog opens on its default button

**Status:** SHIPPED in vintage-frames **0.6.2**, the day it was written
(2026-09-06; applied the same day — below). Written from the About box on
vintage-frames 0.6.1, on the user's report: _"there's a web link to vintage frames on
that dialog - so pressing the 'Enter' key navigates to that web link rather
than triggering the 'OK' button, which is what it should do"_ — on the
mechanism, _"basically the focus is wrong on dialog load"_ — and on the
layer, _"is this really a 'kit' feature then? the auto focusing of the
primary button, if present?"_ It is: the kit owns the open, and the kit
knows which button is the default. The app carried no bridge; the kit
shipped the rule within hours (below).

## What the kit has

- **`VfModalDialog.show()`** sets `open` and, once updated, calls the
  native `<dialog>`'s `showModal()` — top layer, focus trapping, Escape
  through the native `cancel` (`vf-close` reason `escape`) — then
  `settle()`s the box and attaches the light-dismiss listeners. Nothing
  places the focus: the platform's **dialog focusing steps** do, and they
  choose an `autofocus` element in the box if there is one, else the first
  focusable thing in flat-tree order (Chrome walks the slotted content —
  the About box proves it: its blurb's link opened wearing the page's
  dotted focus ring, `docs/goldens/boot-about.png` before this ask), else
  the `<dialog>` itself (whose UA ring `modalDialogStyles` suppresses).
- **`vf-button variant="default"`** draws the ringed default button, and
  its shadow root's `delegatesFocus: true` means `focus()` on the host
  reaches the inner `<button>`; keyboard focus is the dashed rule under
  the label (`vfFocusUnderline`).
- **`vf-dialog`'s `buttons` slot** is the action row — the kit already
  reads it (`_onButtonsSlotChange` counts the assigned buttons for the
  footer), so it can find the default among them.
- **Return in a text control** (`text-control.js`, `requestImplicitSubmit`)
  clicks the enclosing `<form>`'s submit button — the kit's one Return →
  default rule, and only inside a form. A dialog is not a form.

So what Return does in a `vf-dialog` is an accident of body order: the
first focusable thing slotted before the buttons. A link, a checkbox, a
list row, a scrollable region's keyboard stop — any of them opens holding
the focus, and Return acts on it, or on nothing, never on the ringed button
System 7 promised it to.

## The ask

**On open, `vf-dialog` focuses its default button.** The order:

1. A slotted **`autofocus`** element, if the markup names one — the
   platform's own grammar, and what a Save As box wants (the field, with
   Save greyed over it); the kit inherits this for free today, and the
   rule must keep it first.
2. Else the **enabled `variant="default"` `vf-button` in the `buttons`
   slot** — the ringed one, the one Return should fire; a disabled default
   (Save over an empty name) is skipped.
3. Else the platform's own steps, as now.

An app that calls `focus()` after `show()` still wins — it runs after the
open — so no caller changes. The mark is honest: a focused default button
wears the dashed underline where the ring already says "Return", and Tab
from it reaches the rest of the box in order.

The fuller System 7 rule, worth a second thought: **Return anywhere in the
box fires the default button** unless the focused control consumes it (a
focused button or link activates itself; a text control inside a form
submits; a `vf-select`'s open list picks). A keydown listener on the
`<dialog>` — Enter, unmodified, not composing, `defaultPrevented` still
false after the control saw it — that clicks the enabled default button.
Then a list row, a checkbox, a scroll stop or the dialog itself can hold
the focus and Return still means OK, as it did on the Mac, where buttons
never held a keyboard focus at all. The initial-focus rule above is the
smaller ask and fixes the reported case; the router makes every dialog
read the same.

The one-sentence version: _the ringed button is where Return goes; the box
should open with the focus already there._

## In the app meanwhile

Nothing — on the user's call, the day it was found: _"did you HACK the
feature in? as we discussed, this appears to be a Vintage Frames issue. We
should not be hacking around that."_ A `btnAboutOk.focus()` after `show()`
was applied and reverted within the hour, and the README's About passage
carried the known issue until the bump. No drive check either: a dialog's
opening focus is the kit's own mechanic.

## What shipped (0.6.2)

`VfModalDialog` gained `defaultButton` — the enabled `vf-button
variant="default"`, slotted or in the shell's own shadow — and
`initialFocusTarget`, focused on open: a slotted `autofocus` first, else
the first visible enabled text control (`vf-text-field`,
`vf-number-field`, `vf-text-area`, `textarea`, `input`), else the default
button. And the fuller rule with it: a keydown on the `<dialog>` routes an
unmodified Return / Enter to the default button from anywhere in the box,
unless a link in the path takes it (a focused link follows itself), a
textarea or contenteditable does (Return inserts the newline; the keypad's
Enter still fires the button), or a control already `preventDefault`ed it.
The text-control step is the kit's own addition over the ask — a Save As
box opens on its field with no `autofocus` said.

## After the bump (applied 2026-09-06)

- No app change: the About box opens on OK, Return OKs the greet.
- `docs/goldens/boot-about.png` regenerated after an eye: OK holds the
  focus, the link's dotted ring is gone.
- `tools/drive.mjs`: the typed-field journeys follow the grammar. The
  Properties journey Returns its typed size, which commits AND OKs the box
  (the OK click went); the Export Sprite Atlas… journey commits its typed
  view count by Tab (`typeInto(sel, text, 'Tab')`) so the box stays up for
  the moves-the-strip-behind-the-modal check, and Export is clicked with
  the download capture armed (Return had exported before it was).
- The README's About passage states the grammar; the known-issue sentence
  is gone. `package.json` pins `^0.6.2`.
