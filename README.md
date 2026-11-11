# handable

Try it at **[handable.vercel.app](https://handable.vercel.app)**.

Train a model on your own handwriting, then turn any text into an SVG written in your hand.
It runs entirely in the browser, has no runtime dependencies and no build step.

## Use

You don't need to train every character. Anything you skip is inferred from the letters you did
write (see below).

Serve the folder and open it in a browser (the app is made of ES modules, which browsers don't
load from `file://`):

```sh
npm start            # or: python3 -m http.server
```

A stylus or touchscreen works best; a mouse is fine.

1. **Train → Single characters.** Write each character 3–5 times. If you write a character in more
   than one way (a looped and a straight `y`, say), write each form a few times, in roughly the
   proportion you use it.
2. **Train → Sentences** (recommended). Write a short sentence on one line. This is how the app
   learns your letter and word spacing, and which forms you use at the start, middle and end of a
   word. The pad shrinks its guides so the sentence fits, measuring with your own model how wide
   you'll write it. On narrow screens, "Another sentence" only offers sentences that fit.
   When you save, the app reads the sentence (see *Reading a sentence* below) and saves the letters
   it's sure of. If any letter is unclear, it stops first so you can check: unclear letters are
   red, ink that isn't part of any letter is grey.
3. **Train → Joined letters** (optional). Pick a letter pair or group, such as `ge`, `th` or `ing`,
   and write it several times with spaces in between. Keep the pen down wherever you normally join
   letters. The app splits the writing into letters (click a box to split it, shift-click or
   right-click to merge it with the next one), marks the joins it detects, and learns their shape
   and how often you make them. The spaces also count towards your word spacing.
4. **Train → Strikes and boxes** (optional). Cross out, or box, a word written in your own hand.
   The word's extent is saved with your strokes, so the mark can be redrawn over any text.
5. **Library.** Check the learned variants and delete bad samples. The variant sensitivity slider
   controls how readily similar forms are grouped into one variant.
6. **Generate.** Click the page and type: you write straight onto it, and it's written out in your
   hand as you go (see *Writing on the page* below). Adjust the settings, and download an SVG or
   PDF. Each seed gives a different but reproducible result.

Samples are saved in the browser's localStorage. Use **Export data** to back them up or move them.

The app itself is a quiet, document-style interface: a sidebar for the four views, pages that
sit on a soft grey desk under a floating toolbar, and settings in an inspector on the right. It
uses the system fonts (SF Pro, with New York for page titles on a Mac) and loads nothing from
other sites. Only the pages you write on are handwritten.

## CLI

```sh
node cli.js --data handwriting-data.json --out note.svg --seed 3 --paper lined "Dear Sam, thanks!"
cat letter.txt | node cli.js --data handwriting-data.json > letter.svg
```

Run `node cli.js` with no arguments to see all options. The engine can also be used as a library:

```js
import { buildModel, generate } from './src/engine/index.js';

const model = buildModel(JSON.parse(exportedData));
const { svg, missing } = generate(model, 'Hello there', { seed: 3, paper: 'lined' });
```

## Development

```sh
npm install     # Prettier and ESLint, for contributors
npm test        # unit tests (node:test)
npm run lint
npm run format
npm run check   # formatting, lint and tests, as CI would run them
```

The code is plain ES modules with no build step:

| Path | What it is |
| --- | --- |
| `index.html`, `style.css` | the app's page |
| `src/app/` | the app: `main.js` (tabs), `store.js` (data, settings, model), `pad.js` (writing pads), `train/`, `library.js`, `generate/` (settings and preview), `editor/` (writing on the page), `pdf.js` |
| `src/app/editor/` | `editor.js` and `toolbar.js` handle the page and its keys; `leads.js` (indents, lists), `formats.js`, `markup.js` (tags, equations, caret steps) and `caret.js` are pure functions of the text, and are unit tested |
| `src/engine/` | the handwriting engine, used by the app and the CLI; `index.js` is its public API |
| `src/engine/model/` | learning a model from samples: `build.js`, `samples.js` (variants), `style.js`, `sequences.js` (joins and ligatures), `parts.js` (inferring characters), `marks.js`, `basefont.js` |
| `src/engine/glyph/` | writing one glyph: `synth.js` (morphing samples), `compose.js` (accented and other letters made of parts), `finish.js` (smoothing, natural variation, pen), `fonts.js` (TeX font styles) |
| `src/engine/text/` | parsing: `rich.js` (formats, lists, indents), `math-spans.js`, `tex.js`, `lists.js` |
| `src/engine/layout/` | words, equations and lines as boxes, pages, and placing glyphs (`generate.js` runs it all) |
| `src/engine/render/` | SVG output: ink, pencil, paper and scan effects, highlighter, animation |
| `src/engine/reading/` | reading a written sentence: cutting it into letters and labelling them |
| `test/` | tests, and `snapshot.js`, which dumps everything the engine produces for a fixed dataset (to check that a refactor changes no output) |

## How it works (`src/engine/`)

- **Capture:** strokes are recorded as `(x, y, time, pressure)` relative to a baseline. 1 unit is
  the distance from the baseline to the ascender line.
- **Variants:** for each character, samples are resampled into shape signatures and grouped with
  average-linkage clustering. Each cluster is a variant. The model stores how often each variant
  appears, overall and by position in a word.
- **Synthesis:** for every glyph it picks a variant, picks a real sample from it, and morphs that
  sample toward 1–2 other samples of the same variant using a random convex blend. Stroke direction
  and loop start points are aligned first. Then it applies smooth random deformation: rotation,
  slant and scale jitter, a low-frequency warp field, and a slight tremor. The deformation is scaled
  by how consistent you are for that variant.
- **Ink:** stroke width comes from pen pressure if you used a stylus. Otherwise it comes from
  drawing speed (faster strokes are thinner). Strokes taper at both ends.
- **Layout:** letter and word gaps are drawn from the learned distributions. Each line gets a
  slight baseline drift and slope, and each word a small size variation.
- **Size consistency:** every sample is pulled toward a target for its character. The target blends
  your own median for that character with the height the learned zones predict (x-height,
  ascender, descender, caps, digits). Strength is set by `sizeConsistency` (0–1, default 0.8), so
  one oversized `a` gets brought in line with the rest of the alphabet.

## Inferring characters you didn't train (`src/engine/model/parts.js`)

This works like finetuning a pretrained model:

- **Prior:** `src/engine/model/basefont.js` is a single-stroke skeleton font covering printable ASCII. Each stroke
  is split into segments: a bowl, a stem, an arch, a crossbar, and so on.
- **Finetuned style:** your x-height, ascender, descender, cap and digit heights, width ratio,
  and slant are learned from your samples. Each estimate is shrunk toward the prior when it rests
  on few samples, and together they map the skeleton into your proportions.
- **Parts:** each trained sample is aligned to its skeleton with dynamic time warping, and its
  strokes are cut at the segment boundaries. That gives a library of your own bowls, stems, and
  arches. Only slices that actually resemble the skeleton piece they were aligned to are kept.
- **Assembly:** an untrained character's skeleton strokes are matched against that library. The
  engine tries whole strokes first, which may be stretched (a `V` from your `v`), then single
  segments (a `q` from your `a` bowl plus your `p` stem). It picks randomly among equally good
  matches, then moves and scales each piece into place. Segments with no match use the reshaped
  skeleton. The Library tab shows what each inferred character was built from.
- Training a character directly always replaces its inference. Characters with no skeleton
  (emoji, CJK, …) are left blank and reported.

## Other alphabets (`src/engine/glyph/compose.js`)

- **Accented letters** (é, ñ, ş, ą, ő, ǖ, ệ …) are your own letter with the accent written
  above or below it. Any letter Unicode splits into a letter and accents works, including text
  typed with separate combining accents. ı, ø, ł, đ, ħ are your i, o, l, d, h with the dot
  taken off or a stroke drawn through. æ and œ are two of your letters run together, ¿ and ¡
  are your ? and ! turned over, and „ ‚ are your quotes dropped to the baseline.
- **Cyrillic and Greek** letters that look like Latin ones (А, В, Е, о, р …) use your Latin
  letters. The others have their own skeletons, so they are inferred from your writing.
- Training any of these characters (Train → Accents, а to я, or Other) replaces what is
  made for it.

## Ligatures, joins & letter habits

- **Detecting joins:** when writing on the joined-letters pad is split into letters, two
  neighbours count as *joined* if one letter's stroke ends and the next one's begins within a few
  milliseconds. That means the pen never lifted.
- **Reading a sentence:** the app knows what you meant to write, so it reads the ink against the
  text instead of just cutting it into the right number of pieces. The ink is first cut into small
  pieces at every pen lift and wherever a stroke turns: its lowest and highest points, where it
  swings back to the left, and along long straight runs such as a crossbar shared by `tt`. A join
  between two letters always passes through one of those cuts. Then a dynamic program finds the
  grouping of pieces that best matches your letter shapes in order. It uses your own samples for
  letters you've trained and the app's forms for the rest, and puts word breaks at the wide gaps.
  Letters or whole words you left out are skipped and stray marks are left unlabeled, so one slip
  doesn't shift every letter after it. A letter that matches its shape badly was probably cut
  wrong, so it's marked unclear and not saved. Boxes you fix by hand are relabeled and mostly
  taken on trust.
- **Ligatures:** every joined pair or triple you write (e.g. a `g` whose tail swings up into the
  `e`), in a sentence or in joined-letter practice, becomes a ligature, built from your original continuous strokes. Each ligature gets its own
  variants, size normalization, and blending.
- **Frequencies:** for every combo you've written, the app counts how many times you joined it.
  When generating, `ge` is written with one of your joined versions in roughly that share of
  cases (smoothed), and as separate letters otherwise.
- **No guessed joins:** letters are only ever joined inside a ligature you actually wrote joined.
  The app never draws a connector between letters you haven't written joined.
- **Cut-out letters:** a letter cut out of joined writing is often truncated where the split ran
  through the connection. It lives on inside the ligature, but it isn't used as a standalone letter
  form unless that character has no cleaner samples.
- **Letter choice:** letter forms are chosen using the previous letter (some people write an `e`
  differently after a `g`).
- **Deleting ligature forms:** ligature forms are rebuilt from your sentence and joined-letter writing.
  Deleting one in the Library (the × on its thumbnail) adds it to `excludedUnits` in your data.
  It then stops being a training form and drops out of that combo's join count. The individual
  letter samples are kept.
- **Repeated letters:** a letter written back-to-back (`ll`, `ee`, `ss`) always uses the same
  form for both copies.

## Look settings

- **Smoothness** (`smoothness`, 0–1, default 0.25): Gaussian smoothing along each stroke, to remove
  trackpad or mouse jitter. Strokes are split at sharp corners first, so the points of `v`, `k`
  and `M` stay sharp. It also tones down the random tremor added during generation.
- **Pen consistency** (`penConsistency`, 0–1, default 0.6):
  - **Width:** at 0.5 the stroke width varies as it did when you wrote (pressure or speed).
    Lower values exaggerate that variation and add stroke-to-stroke differences; higher values
    even it out.
  - **Ink:** ink opacity varies slightly per letter, and an SVG opacity mask makes ink pool a
    little where each stroke starts and thin out where the pen lifts. Lower consistency
    strengthens both effects.
- **Formality / readability** (`formality`, 0–1, default 0):
  - **Fewer ligatures:** your joined ligatures are used less often, and not at all at 1.
  - **Clearer forms:** letter choice favors your most common form, and the form closest to the
    textbook shape of the letter. Within a form, samples nearest its typical shape are preferred.
  - **Tidier:** random deformation is reduced by up to 40%.
- **Pencil** (`pen: 'pencil'`): graphite is modeled, not just textured.
  - **Pressure along each stroke:** slow strokes and downstrokes press harder, and upstrokes are
    lighter. The line eases in at touch-down and fades at lift-off, while dots and short flicks
    stay fully pressed. Pressure also varies a little from stroke to stroke and letter to letter
    (more at low pen consistency).
  - **Striations:** each stroke is a faint body plus three thin, slightly wandering fibers, like
    the streaks a graphite tip leaves along the direction of travel.
  - **Build-up:** every stroke is its own translucent layer, so crossings and retraced strokes get
    darker.
  - **Paper tooth:** an SVG filter where heavy marks stay nearly solid and light marks break up
    into speckles, so edges come out naturally fuzzy, plus slightly irregular edges.
  - In the app, picking Pencil switches the color to graphite.

## Writing on the page

There's no separate text box: the page in the preview is where you type.

- **How it works:** the text lives in a hidden text field that follows the caret, so typing,
  paste, undo, accents and IME input behave as in any text field. Each change is written out
  again straight away (on a very long document, after a short pause). The engine reports where
  every character of the text landed (`res.caretMap`: lines, plus each character's source range,
  page, position and size). From that, the app draws the caret and selection over the sheet,
  including the scan's tilt.
- **What you've written stays put:** the engine's randomness is keyed, not one running stream.
  - **Words:** each word's letters, size and spacing come from a generator seeded by the seed
    plus the word itself (and which time that word occurs).
  - **Lines:** each line's tilt and drift are seeded by its first word. Each letter's ink pooling
    or graphite grain is seeded the same way.
  - **Paper:** its texture, rules and scan come from the seed alone.
  - **So:** typing changes only the word you're typing. Words that move to another line move but
    keep their shape. The paper never changes. Only **New variation**, which picks a new seed,
    writes everything again.
- **Formatting is shown, not its markup:** subscripts, superscripts, underlines, strikes, boxes
  and highlighter appear as they'll be written. The arrow keys and Backspace step over the tags.
  At the end of a format, the first → steps out of it, so what you type next is plain. A format
  emptied by Backspace is removed with its last letter, in one undo step.
- **The toolbar** (above the pages, like the one in Google Docs): undo and redo, underline,
  strikethrough, superscript, subscript, box, highlighter (with a color menu and None), and
  Equation.
  - **Shows the formats in use:** a button is on when every letter of the selection has that
    format, or, with no selection, when the caret is inside it.
  - **Toggles:** pressing a button that's on takes the format off the selection, even part of a
    formatted run; the rest keeps it. Pressing one that's off puts it on the whole selection.
    With no selection, it starts or ends the format for what you type next. Superscript and
    subscript replace each other, and a highlight takes one color at a time.
  - **Equation:** puts the selection in an equation (`\(…\)`, which can't be mistaken for
    anything else, wherever it goes), or takes the equation the caret is in out of it.
  - **How it works:** the text is read as a list of characters, each with the formats it's inside.
    Only the changed part of the text is rewritten, with as few tags as possible, as one undo step.
  - **Shortcuts:** ⌘U underline, ⌘. superscript, ⌘, subscript, ⌘⇧X strikethrough, ⌘⇧H highlight
    (Ctrl on Windows and Linux).
- **Equations:** an equation is written out as math until the caret goes inside it, by a click
  or the arrow keys. Then its TeX is written instead, in a dashed box, until you leave it again.
  Deleting one of an equation's `$` signs deletes the whole equation, both signs included, as
  one undo step. This applies to Backspace after it or just inside its opening `$`, and to Delete
  before it or just before its closing `$`. Any other edit that would take part of a `$` away is
  widened to the whole equation too: deleting or typing over a selection, deleting a word at a
  time, cutting. So the `$` signs that are left are never paired up differently, and no other
  text turns into math (or stops being math).
- **Mouse:** click to place the caret, drag to select, shift-click to extend, double-click a word.
  Up and down move by written lines, and Home and End go to either end of one.

## Formatting & math

- **Markup:** `<sup>…</sup>`, `<sub>…</sub>`, `<u>…</u>`, or Unicode `x²` `H₂O`.
- **Strikethrough, boxes and highlighter:** `<s>…</s>` crosses words out, and `<box>…</box>` draws a
  box around them. `<mark>…</mark>` highlights them in yellow, and `<mark pink>`, `<mark orange>`,
  `<mark green>` and `<mark blue>` pick other colors. One mark covers a whole run of words.
  Strikes and boxes use the ones you trained, stretched to fit but keeping their overshoot and
  corners. Until you train some, they're a plain line or box in your pen.
- **Quotes:** straight quotes are turned into curly ones, opening or closing depending on what's
  around them. Apostrophes become `’` (it's, dogs', 'tis, '90s), so they share the trained closing
  single quote. `‘ ’ “ ”` are trained as characters of their own. If you haven't trained them, the
  straight quotes you did train are used.
- **TeX:** `$…$` or `\(…\)` inline, `$$…$$` or `\[…\]` on its own centered line. So a `$`
  in ordinary text isn't taken for math: an opening `$` has to be followed by something other
  than a space, a closing `$` can't come right before a digit (so `$5 and $10` are prices),
  `$…$` stays within its paragraph, and a `$$` with nothing to close it is two dollar signs.
  `\$` is always a dollar sign. The editor and the writing find equations the same way. Math uses a TeX subset: scripts, `\frac`,
  `\sqrt[n]{}`, `\overline`, `\text{}`, Greek letters, big operators (`\sum \prod \bigcup`, and integrals `\int \iint \iiint` and
  closed `\oint \oiint \oiiint`) with `\limits` / `\nolimits`,
  `\underset` / `\overset`, `\boxed{}` and `\fbox{}` boxes, `\sout{}` strikethrough, amsmath matrices (`matrix`, `pmatrix`,
  `bmatrix`, `Bmatrix`, `vmatrix`, `Vmatrix`, `smallmatrix`, with `&` and `\\`) and `cases`, `\cdots \vdots \ddots`, function names (`\sin`, `\lim` …) and logic, set and relation
  symbols (`\forall \exists \subseteq \implies \iff \equiv \cong \propto \perp \langle \rangle` …).
- **Fonts**, written the way people write them by hand. Unicode styled letters (`ℝ`, `𝓛`, `𝔤`,
  `𝐯`) work too, also outside `$…$`.
  - `\mathbb`: the main upright stroke is doubled.
  - `\mathcal` / `\mathscr`: slanted, with an entry hook and an exit swash.
  - `\mathfrak`: curves are broken into straight strokes. This is only a hint of fraktur.
  - `\mathbf`, `\textbf`: every stroke is gone over twice.
  - `\mathit`, `\textit`: extra slant.
- **Accents:** `\hat \check \tilde \dot \ddot \acute \breve \vec` sit just above the letter.
- **Long equations wrap:** an equation that doesn't fit carries on to the next line. It breaks
  after a relation or operator at its top level (`=`, `+`, `−`, `\le`, `\to` …), never inside
  braces, `\left … \right` or an environment, and never after a leading sign. Between pieces
  that stay on one line, math spacing is kept rather than a word gap. `\\` and `\newline`
  start a new line yourself, inline or in `$$…$$`, where each line is centered. Inside a matrix,
  `\\` still separates rows.
- **Long words break with a hyphen:** text wraps between words. A word too long for a whole
  line fills the rest of the current line (if at least three letters fit), ends that piece with a
  `-`, and carries on to the next line. The hyphen is only written; it isn't added to your text.
- **Lists, as in Google Docs:** the list button in the toolbar turns the selected paragraphs
  into a list (or back); its menu picks bullets (`•`, `–`, `+`, `>` or your own) or numbers
  (1, a, A, i or I, written `1.`, `1)` or `(1)`), and where numbering starts (0, say).
  ⌘⇧8 and ⌘⇧7 toggle bullets and numbers. Typing `- `, `+ `, `> `, `* ` (which becomes `•`)
  or a number like `1. `, `b) ` or `(iv) ` at the start of a paragraph starts a list too.
  Enter starts the next item, and Enter on an empty item comes out a level (or ends the
  list). Tab at the start of an item nests it, Shift+Tab brings it back out, and Backspace
  there takes the marker off. Nested numbers follow Google Docs' default hierarchy, 1. then
  a. then i. (and round again), whether you nest items or turn nested paragraphs into a
  list; capital letters and roman numerals, and bullets, stay the same at every level. Numbers count up by themselves, each
  level on its own. The text of an item starts a space and a half after its marker, lined
  up through the list. In the text, items start with `- ` `• ` `+ ` `> `, or a tag:
  `<ul →>` for your own bullet, `<ol 1.>` `<ol a)>` `<ol (i)>` for numbers, and
  `<ol 1. 0>` to start again from 0.
- **Page breaks:** on paper, Cmd+Enter (Ctrl+Enter on Windows and Linux) starts a new page;
  what follows goes at the top of the next sheet. In the text it's a form feed (`\f`), so the
  CLI takes it too.
- **Indents and tabs, as in Google Docs:** Tab at the start of a paragraph indents its first
  line; pressed again, it indents the whole paragraph one step (the first line stays a step
  further in). Backspace there takes off the first-line indent, and a second Backspace takes
  off the whole indent. Shift+Tab takes the paragraph out a step, and with several paragraphs
  selected Tab and Shift+Tab move them all. Enter carries the indent on to the new paragraph.
  Every space counts: two spaces between words make a wider gap than one, and a tab
  anywhere else is a gap of 4 spaces. In the text, a paragraph's indent is the
  tabs and spaces it starts with: each tab indents the whole paragraph by 4 spaces, and
  spaces indent only its first line.

## Paper, pages & PDF

- **Pages:** Plain and Lined paper lay the writing out on real sheets, **Letter** or **A4**, at
  192 px per inch, so the default size is realistic handwriting.
  - **Lined:** notebook layout, with a header rule, a red margin line, and writing on the rules.
  - **Plain:** 1-inch margins.
  - Long text continues onto as many pages as needed.
- **Paper texture:** a fine embossed tooth lit from the top left, faint fibers, slightly uneven
  tone and a soft edge shade. The printed rules take on the same texture.
- **Look scanned** (on by default, `scan: true`): the page looks like a scan of a real sheet.
  - **Rules:** each one sits a hair off, tilts and waves slightly, and is printed a little
    unevenly. The red margin is a soft pink band with a stronger core.
  - **Bend and tilt:** the whole page, writing included, is bent very slightly, as a sheet that
    doesn't lie flat on the glass, and turned a quarter to half a degree. It's shaded faintly
    along the side that lifts away.
  - **Scanner:** everything is softened, so fine paper tooth and graphite grain are lost. The
    paper comes out clean and white with barely any noise. A contrast curve darkens the mid
    tones, so pencil reads bold and grey as in a real scan.
  - Turn it off (`scan: false`) for the clean cream paper.
- **Double-sided** (lined paper, off by default, `doubleSided: true` or `--double-sided true`):
  pages 2, 4, … are the backs of sheets, so the red margin line is on the right. The writing
  starts near the left edge and runs up to the line. Lines are the same length on both sides,
  so the text wraps the same way.
- **Line spacing:** ordinary lines are exactly `lineHeight` apart (default 1.55, single-spaced).
  One line's descenders and the next line's ascenders share the space between them, as in real
  writing. Only content taller than letters (fractions, big operators, stacked limits) pushes
  lines apart; on ruled paper that skips a whole rule.
- **PDF** (in the app, `src/app/pdf.js`): each page is rendered at about 240 dpi, so pencil grain and paper
  texture come out exactly as on screen, and embedded in a multi-page PDF. With a transparent
  background, the PDF is one page the size of the writing. The CLI writes SVG only, with pages
  stacked.

## License

[MIT](LICENSE)
