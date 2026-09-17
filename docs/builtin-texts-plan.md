# Plan: built-in text files read the app's text

**Status:** built 2026-09-17, steps 1 to 3, gates green. The eye checks in
step 2 are not yet confirmed. Every decision was made 2026-09-17. Released
as app v0.3.10. The ask: _"for our in-app
readme and keyboard shortcuts documents - i want to stop persisting those as
user owned content instances... when i update the app and change the readme
or the shortcuts doc - users who already have a local 'state' don't get the
updated copy in those documents - not unless they delete them and 'Restore
Default Files'. i still want users to be able to move them and trash them -
even rename them... BUT - the text content in those docs should ALWAYS be the
latest in the app source."_

The short version: a seeded Read Me or Keyboard Shortcuts record keeps its
name, folder and times but stores a key in place of its text. Opening it reads
the text the app ships. Seeding and Restore Default Files match built-ins by
key, and a boot step links the files an existing profile already holds.

## 1. The model we copy

A System 7 alias: the icon, its name and where it lives belong to the user,
who can rename, move, copy and trash it. What it opens is the original, which
belongs to the system.

## 2. The design

### 2.1 The record

`src/texts/index.js` gives each built-in a key that never changes once
shipped: `read-me`, `keyboard-shortcuts`. A text record holds either `text` or
`builtin`, a key. A built-in record stores no text.

`files.js` runs under Node and cannot import `?raw`, so the text arrives
through `init()` as `builtinText(key)`, a string or null. The files slice
reads a record's text through it:

- `textOf(id)` returns the app's text for a built-in record.
- A listing row carries `builtin` (the key or null), and its `size` is the
  app's text's byte length, so Empty Trash… counts the current text.
- `createText({ name, builtin })` stores a built-in record.
- `copyText` and `copyFolder` copy the record whole, so a copy keeps the key
  (decision 1).
- A row whose key the app does not ship is left out of the listing. The
  record stays in storage and returns if the key does (decision 3).

Rename, move, trash and Empty Trash work on the record as today.

### 2.2 Seeding and Restore Default Files

`seedDefaultTexts` stores built-in records and skips keys already present.
`missingDefaults` finds the built-ins whose key no row carries. A trashed
built-in counts as present, as today. A renamed Read Me counts as present, so
Restore no longer offers a second one.

### 2.3 Existing profiles

`builtinLinks(state, builtins)`, a pure selector, pairs each row with no key
to the built-in whose name it carries, exactly or as a copy name ("Read Me
copy", "Read Me copy 2") (decision 2). `files.linkTexts(links)` sets each
record's key and drops its text. `main.js` runs both at every boot before
seeding. Once a profile is linked the selector finds nothing, so later boots
write nothing. A file renamed to another name keeps its old text until it is
trashed.

## 3. Steps, each landing green

1. **The files slice.** §2.1, `builtinLinks`, `missingBuiltins` and
   `linkTexts`. Tests: §5.
2. **The app.** The keys and `builtinText` in `src/texts/index.js`; the
   injection, the link step and seeding by key in `main.js` and
   `loaders.js`. Verified by eye on the existing profile: after one reload,
   Read Me and Keyboard Shortcuts show the current text, with no Restore.
   A renamed or moved Read Me still opens the current text, so does a copy
   made with Copy and Paste, and Special → Restore Default Files stays
   greyed while both are present, including a renamed one.
3. **The words.** SPEC §Text files, the seeding paragraphs and the Special
   menu; the README's read-me section; the comments in `src/texts/index.js`,
   `loaders.js`, `files.js` and `storage/db.js`; this status line.

## 4. Kit asks

None.

## 5. Tests

By `docs/TESTING.md`, the files slice's new rules get contract tests in
`test/files.test.mjs`:

- A built-in record reads the app's text: `textOf` and the row's `size`
  follow the resolver, the stored record has no text, and a rename, move or
  copy keeps the key. A key the resolver does not know leaves the listing.
- `builtinLinks` pairs exact and copy names, skips a renamed file and a
  linked one; `linkTexts` sets the key and drops the text.
- `missingBuiltins` goes by key: a renamed or trashed built-in is present.

## 6. Decisions

1. **Copies.** A copy of a built-in keeps the key and shows the current text.
   Recommended: nothing edits a text file, so a copy has no text of its own.
   Decided 2026-09-17: as recommended.
2. **Linking existing files.** By the exact name or a copy name. Recommended:
   a file renamed to another name keeps its old text until trashed, and
   Restore adds a current one. Decided 2026-09-17: as recommended.
3. **A retired built-in.** Its records leave the listing and stay in storage.
   Recommended over deleting them at boot. Decided 2026-09-17: as
   recommended.

## 7. Follow-ups

- Put Away ⌘Y and dropping or pasting a `.txt` would make user text files;
  they store `text` as today.

## 8. Files touched

| File                  | What                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `src/state/files.js`  | `builtin` records, `builtinText`, `builtinLinks`, `missingBuiltins`, `linkTexts`, `copyBase` |
| `src/texts/index.js`  | keys, `builtinText`                                                                          |
| `src/loaders.js`      | seeding and `missingDefaults` by key                                                         |
| `src/main.js`         | the injection and the link step                                                              |
| `src/storage/db.js`   | the text record's shape                                                                      |
| `test/files.test.mjs` | the tests in §5                                                                              |
| `docs/SPEC.md`        | §Text files, the seeding paragraphs, the Special menu                                        |
| `README.md`           | the read-me section                                                                          |
