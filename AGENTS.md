# AGENTS.md

Guidance for anyone, human or AI agent, changing this codebase. Read `README.md` first for what
the app does and how the code is laid out.

## Principles

Every change should leave the code meeting these three.

### Modularity

- **One level of abstraction per block.** A function either does one thing directly or calls
  helpers that each do one part. It does not mix the two. If a function walks through steps
  (parse, lay out, place, render), each step is a call, not inline detail. If a loop body
  grows its own sub-steps, give it a function with a name.
- **Small modules with one job each.** The engine (`src/engine/`) knows nothing about the page or
  the DOM, and runs in Node as well as the browser. The app (`src/app/`) never reaches into the
  engine's internals: it uses `src/engine/index.js`.
- **Keep coupling low, within reason.** Pass in what a function needs (values or small callbacks)
  rather than having it import app state. Pure functions of their input are preferred, and are
  what gets unit tested (`src/app/editor/leads.js`, `formats.js`, `markup.js` and `caret.js` are
  examples).
- **No import cycles.** If two modules need each other, move the shared part into a third
  (see `glyph/finish.js`, used by both `glyph/synth.js` and `glyph/compose.js`).

### Readability

- **Names are short but descriptive.** Prefer the word the user or the domain would use
  (`baseline`, `stroke`, `caretMap`, `textBox`), not the mechanism. Short names (`g` for a
  glyph, `o` for options, `b` for a box, `M` for a caret map) are fine where they are a
  convention of this codebase and the scope is small. Don't invent new abbreviations.
- **Consistent style.** Prettier does the formatting. Don't fight it, and don't hand-format.
- **Consistent spacing.** One blank line between top-level declarations, before a `return` that
  ends a block of several statements, and around multi-line blocks inside a function. Statements
  that belong together stay together.
- **Comments say what and why, in plain words.** A comment above a function says what it gives
  back or what it's for, in the reader's terms ("the caret position under the pointer"). Explain
  units (px or units), coordinate systems and any non-obvious reason. Don't narrate what the code
  plainly does, and don't leave commented-out code.

### Simplicity

- **Do what the problem requires for correctness: no less and no more.** Handle the cases that
  can really happen (empty text, a missing character, a box on a page that no longer exists).
  Don't add options, layers or generality nobody asked for.
- **Prefer the existing mechanism.** Reuse the engine's pipeline, the editor's change objects
  (`src/app/editor/change.js`) and the existing helpers before writing new ones.
- **No dependencies at runtime and no build step.** The app is plain ES modules served as they
  are. Prettier and ESLint are the only dev dependencies.

## Conventions

- **Language:** modern JavaScript (ES2024 modules). `const` by default, `let` only when the value
  changes, never `var`. One declaration per statement. `===` except `== null`.
- **Formatting:** Prettier, as configured in `.prettierrc`: 4-space indents, single quotes, lines
  up to 120 characters. `.editorconfig` sets the same for editors.
- **Lint:** ESLint 9 with `eslint.config.js`. Code must lint with no errors or warnings.
- **Files:** one module per concern, named for what it holds (`text-boxes.js`, `overlay.js`). Each
  file opens with a short comment saying what it is.
- **Engine coordinates:** glyphs are in units, where 1 unit is the height from baseline to
  ascender and y grows downward. Layout turns units into px with `o.size`. Pages are 192 px per
  inch.
- **Determinism:** the engine's randomness is keyed (see `layout/writer.js`). New randomness
  must come from the writer's `rng`, reseeded by a stable key, so typing changes only what was
  typed. `Math.random()` is used only to pick a seed when none is given (`util.js`,
  `layout/writer.js`). Don't use it anywhere else in the engine.
- **Saved data:** training data and settings live in `localStorage` under the `handwrite.*` keys.
  Don't rename the keys, and keep old saved data loading when the format changes.
- **User-facing text:** sentence case, plain words, written from the user's side. Name a button
  by what it does, and give an error that says how to fix it.

## Checking a change

```sh
npm run check   # formatting, lint and tests
```

- Add or update tests in `test/` (`node:test`) for engine behavior and for the editor's pure
  text functions.
- **Refactors must not change output.** Before the change, run
  `node test/snapshot.js src/engine/index.js src/engine/model/basefont.js > before.json`. Run it
  again after and compare the two files. They should be identical, apart from anything the
  change is meant to alter.
- For app changes, run it (`npm start`) and try the feature in a browser, including the cases
  around it (an empty page, paper and no paper, undo, a reload).

## Commits

- One logical change per commit, with a message that says what changed for the user, in the
  imperative ("Add text boxes and a per-text size control").
- Pushing to `main` deploys the site, so only push work that passes `npm run check`.
