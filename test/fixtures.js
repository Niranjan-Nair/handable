// A synthetic handwriting dataset and a set of scenarios that exercise the whole
// engine. Used by the tests (and to compare a refactor's output with the original).

// small deterministic PRNG (mulberry32), independent of the engine's own
function prng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.normal = () => Math.sqrt(-2 * Math.log(next() || 1e-9)) * Math.cos(2 * Math.PI * next());
  return next;
}

// One written sample of `ch`, traced from the base font's skeleton with a little
// wobble, slant and pen timing (and pressure when `pen` is set). Strokes start at
// time t0; returns { strokes, t } with t the time the pen lifted.
function trace(glyphs, ch, rand, { x0 = 0, t0 = 0, pen = false, scale = 1 } = {}) {
  const def = glyphs[ch];
  if (!def) return null;
  const slant = 0.12 + rand.normal() * 0.02;
  const sx = scale * (1 + rand.normal() * 0.05);
  const sy = scale * (1 + rand.normal() * 0.05);
  let t = t0;
  const strokes = def.map((segs) => {
    const pts = segs.flat();
    const out = [];
    pts.forEach(([x, y], i) => {
      if (i % 2 && i !== pts.length - 1) return; // thin the skeleton a little
      t += 4 + Math.floor(rand() * 3);
      const X = x0 + (x - slant * y) * sx + rand.normal() * 0.004;
      const Y = y * sy + rand.normal() * 0.004;
      out.push([+X.toFixed(4), +Y.toFixed(4), t, pen ? +(0.4 + 0.3 * rand()).toFixed(3) : null]);
    });
    t += 60; // pen lift
    return out;
  });
  return { strokes, t };
}

const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?\'"-:;()[]{}|+=/&$%';

export function makeDataset(glyphs) {
  const rand = prng(1234);
  const samples = [];
  let id = 0;
  for (const ch of CHARS) {
    const n = 'aeot'.includes(ch) ? 5 : 3;
    for (let k = 0; k < n; k++) {
      const s = trace(glyphs, ch, rand, { pen: k === 0 && 'aeiou'.includes(ch), scale: k === 2 ? 1.25 : 1 });
      if (s) samples.push({ id: 'l' + id++, char: ch, ctx: 'solo', source: 'letter', strokes: s.strokes, created: 1 });
    }
  }
  // sentence words, some letters joined (the pen kept down from one to the next)
  const sentences = [];
  const words = ['the', 'quick', 'ge', 'ge', 'ge', 'then', 'ing', 'll', 'the'];
  words.forEach((w, wi) => {
    let x = 0;
    let t = 0;
    const seqId = 'seq' + wi;
    const chars = Array.from(w);
    chars.forEach((ch, i) => {
      const s = trace(glyphs, ch, rand, { x0: x, t0: t });
      const joined = i > 0 && wi % 3 !== 1;
      if (joined) {
        // the first stroke starts right where the previous letter's last stroke ended
        const prev = samples[samples.length - 1].strokes;
        const e = prev[prev.length - 1][prev[prev.length - 1].length - 1];
        const f = s.strokes[0][0];
        const dt = f[2] - e[2];
        s.strokes.forEach((st) =>
          st.forEach((p) => {
            p[2] -= dt - 10;
          }),
        );
        s.strokes[0][0] = [e[0] + 0.01, e[1], e[2] + 10, null];
      }
      const ctx = chars.length === 1 ? 'solo' : i === 0 ? 'start' : i === chars.length - 1 ? 'end' : 'mid';
      samples.push({
        id: 's' + id++,
        char: ch,
        ctx,
        source: 'sentence',
        seq: { id: seqId, i, w: 0 },
        strokes: s.strokes,
        created: 2,
      });
      x += 0.45;
      t = s.t;
    });
    sentences.push({ text: w, letterGaps: [0.08, 0.1, 0.12], wordGaps: [0.45, 0.5], created: 3 });
  });
  const marks = [
    {
      id: 'm1',
      kind: 'strike',
      word: 'typo',
      ref: { x0: 0.8, x1: 2.4, top: -0.9, bot: 0.3, mid: -0.25 },
      strokes: [
        [
          [0.7, -0.2, 0, null],
          [1.6, -0.28, 40, null],
          [2.5, -0.22, 80, null],
        ],
      ],
    },
    {
      id: 'm2',
      kind: 'box',
      word: 'total',
      ref: { x0: 0.8, x1: 2.4, top: -0.9, bot: 0.3, mid: -0.25 },
      strokes: [
        [
          [0.65, -1, 0, null],
          [2.55, -1.02, 50, null],
          [2.56, 0.42, 90, null],
          [0.64, 0.44, 130, null],
          [0.66, -1.05, 170, null],
        ],
      ],
    },
  ];
  return { version: 1, samples, sentences, excludedUnits: [], marks };
}

const LONG = 'Antidisestablishmentarianismically ';
export const TEXTS = {
  plain: 'The quick brown fox jumps over the lazy dog.\nHow vexingly quick daft zebras jump!',
  rich: 'Some <u>underlined words here</u>, <s>struck</s>, <box>boxed</box> and <mark pink>pink</mark> <mark>hi</mark>.\nx<sup>2</sup> H<sub>2</sub>O ² ₂ "quoted" it\'s \'90s',
  math:
    'Inline $\\frac{a+b}{\\sqrt[3]{x}}$ and \\(\\mathbb{R}^n \\to \\mathcal{L}\\) then\n$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2} \\quad \\lim_{x\\to0} \\int_0^1 f$$\n' +
    '$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$ $f(x) = \\begin{cases} 1 & x > 0 \\\\ 0 & \\text{else} \\end{cases}$ ' +
    '$\\boxed{x = 4}$ $\\sout{no}$ $\\hat{x} \\vec{v} \\not= \\alpha\\beta$ costs $5 and $10 \\$ ' +
    '$a + b + c + d + e + f + g + h + i + j + k + l + m + n + o + p = q \\\\ r$ ℝ 𝐯 $\\mathfrak{g} \\Re \\mathit{x} \\mathbf{v} \\boldsymbol{\\beta}$ $\\overline{AB} \\underset{x}{y}$',
  lists:
    '- dash item\n• dot item\n+ plus\n> chevron\n<ul ★> custom star\n<ol 1.> one\n<ol 1.> two\n\t<ol a.> nested a\n\t<ol a.> nested b\n\t\t<ol i.> deep\n<ol 1.> three\n<ol (i)> roman\n<ol A) 0> zero start\n<ol 1. 9> nine\n<ol 1.> ten\nnot a list',
  indents:
    '    first line indent here with enough words to wrap onto the next line for sure ok\n\tblock indented paragraph with enough words to wrap around as well yes\n\t\t  both\na\t\tgap   spaces  trail   \n\n' +
    LONG.repeat(3) +
    '\nend',
  pages: 'Page one text.\fPage two text.\n' + 'Lots of lines here. '.repeat(120) + '\f$$x=1$$\fafter',
  unknown: 'Unknown 漢字 ✿ and ϖ Α’s “curly” — dash',
};

export const SCENARIOS = [
  { name: 'plain-none', text: 'plain', opts: { seed: 'a' } },
  { name: 'plain-r0', text: 'plain', opts: { seed: 'b', randomness: 0, formality: 1 } },
  {
    name: 'plain-sloppy',
    text: 'plain',
    opts: {
      seed: 'c',
      randomness: 2,
      slant: 15,
      letterSpacing: 1.4,
      wordSpacing: 0.7,
      smoothness: 0.9,
      penConsistency: 0,
    },
  },
  { name: 'plain-noinfer', text: 'unknown', opts: { seed: 'd', infer: false, ligatures: false, blend: false } },
  { name: 'unknown', text: 'unknown', opts: { seed: 'e' } },
  { name: 'rich-lined', text: 'rich', opts: { seed: 'f', paper: 'lined' } },
  { name: 'rich-pencil', text: 'rich', opts: { seed: 'g', paper: 'plain', pen: 'pencil', scan: false } },
  { name: 'rich-uniform', text: 'rich', opts: { seed: 'h', pen: 'uniform', color: '#a00' } },
  { name: 'rich-literal', text: 'rich', opts: { seed: 'i', plain: true } },
  { name: 'math', text: 'math', opts: { seed: 'j', maxWidth: 600 } },
  { name: 'math-raw', text: 'math', opts: { seed: 'k', rawAt: 12 } },
  { name: 'math-raw-paren', text: 'math', opts: { seed: 'k', rawAt: 48 } },
  { name: 'lists', text: 'lists', opts: { seed: 'l', paper: 'lined', doubleSided: true } },
  { name: 'indents', text: 'indents', opts: { seed: 'm', maxWidth: 420 } },
  { name: 'pages-lined', text: 'pages', opts: { seed: 'n', paper: 'lined', doubleSided: true, pageSize: 'a4' } },
  { name: 'pages-layers', text: 'pages', opts: { seed: 'o', paper: 'plain', layers: true } },
  { name: 'pages-layers-pencil', text: 'rich', opts: { seed: 'o2', paper: 'lined', layers: true, pen: 'pencil' } },
  { name: 'animate', text: 'rich', opts: { seed: 'p', animate: true, paper: 'plain' } },
  { name: 'animate-uniform', text: 'plain', opts: { seed: 'q', animate: true, pen: 'uniform' } },
  { name: 'empty', text: '', opts: { seed: 'r' } },
  { name: 'empty-paper', text: '', opts: { seed: 's', paper: 'lined' } },
];
