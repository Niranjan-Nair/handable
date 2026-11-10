// Everything the engine produces for the fixtures, as one JSON-able object. Run
// against two versions of the engine, the results must be identical.
//
//   node test/snapshot.js <engine module> <basefont module> > out.json
import { makeDataset, TEXTS, SCENARIOS } from './fixtures.js';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const load = async (p) => {
  const m = await import(pathToFileURL(path.resolve(p)).href);

  return m.default && (m.default.generate || m.default.glyphs) ? m.default : m;
};

// Date.now() and generated ids differ from run to run
const stable = (v) =>
  JSON.parse(
    JSON.stringify(v, (k, x) =>
      k === 'created' || (k === 'id' && typeof x === 'string' && x.includes(':'))
        ? undefined
        : k === 'seq' && x && x.id
          ? { ...x, id: 'seq' }
          : x,
    ),
  );

export async function snapshot(HW, BASE) {
  const out = {};
  const data = makeDataset(BASE.glyphs);
  const model = HW.buildModel(data);
  const loose = HW.buildModel(data, { variantThreshold: 0.3, sizeConsistency: 0 });
  out.style = model.style;

  out.chars = Object.fromEntries(
    Object.entries(model.chars).map(([c, e]) => [
      c,
      e.variants.map((v) => [v.weight, v.spread, v.recog, v.members.map((m) => m.id)]),
    ]),
  );

  out.units = Object.keys(model.units).sort();
  out.looseVariants = Object.values(loose.chars).map((e) => e.variants.length);
  out.links = HW.linkStats(model);
  out.inferInfo = ['ß', 'é', 'π', 'Ω', '∫', '@', '#', '漢'].map((c) => HW.inferInfo(model, c));
  out.baseChars = HW.baseChars().length;

  out.generate = {};

  for (const s of SCENARIOS) {
    const r = HW.generate(model, TEXTS[s.text] ?? s.text, s.opts);
    out.generate[s.name] = r;
  }

  // typing: each prefix in turn, through the word cache
  const typed = [];
  const t = TEXTS.rich.slice(0, 60);
  for (let i = 0; i <= t.length; i += 7)
    typed.push(
      HW.generate(model, t.slice(0, i), { seed: 'type', paper: 'lined', layers: true, text: t.slice(0, i) }).layers,
    );
  out.typed = typed;
  out.typedLoose = HW.generate(loose, TEXTS.plain, { seed: 'z' }).svg;

  out.glyphs = [];

  for (const c of ['a', 'g', 'ge', 'Ω', '(', '漢']) {
    const g = HW.sampleGlyph(model, c, { seed: 'g' + c, randomness: 1 });
    out.glyphs.push(g && { svg: HW.glyphSVG(g, { box: 64, guides: true }), w: g.width });
  }

  out.prepared = HW.prepareSample(data.samples[3]);

  // text
  const texts = [...Object.values(TEXTS), 'a $b$ $$c$$ \\(d\\) \\[e\\] $ f$ $5 $$', '\\\\(x\\) \\$y$ $z$9 $w$'];
  out.parse = texts.map((x) => [HW.parseRich(x), HW.parseRich(x, true), HW.mathSpans(x)]);
  out.parseRaw = HW.parseRich(TEXTS.math, false, 12);

  out.tex = HW.parseMath(
    '\\frac{1}{2}\\sqrt[n]{x^2_i} \\begin{bmatrix}1&2\\\\3&4\\end{bmatrix} \\mathbf{v} \\text{hi there} \\foo',
  );

  out.listNumbers = [1, 4, 9, 14, 26, 27, 702, 1994, 3999, 4000, 0, -3].map((n) =>
    ['1', 'a', 'A', 'i', 'I'].map((k) => HW.listNumber(n, k)),
  );

  out.markers = ['- x', '• x', '-x', '<ul &gt;&amp;> x', '<ol (i)> x', '<ol (i.> x', '<ol 1. -4> x', 'x'].map((x) =>
    HW.listMarkerAt(x, 0),
  );

  // reading written lines
  const line = [];
  let x = 0;
  let tt = 0;

  for (const ch of 'the cat') {
    if (ch === ' ') {
      x += 0.5;
      continue;
    }

    const s = data.samples.find((q) => q.char === ch && q.source === 'letter');
    for (const st of s.strokes) line.push(st.map((p) => [+(p[0] + x).toFixed(4), p[1], p[2] + tt, p[3]]));
    x += 0.5;
    tt += 500;
  }

  const read = HW.readLine(line, 'the cat', model);
  out.read = read;
  out.relabel = HW.labelGroups(read.groups, 'the cat', model);
  out.segment = [HW.segment(line), HW.segment(line, 6), HW.segment(line, 9)];
  out.split = HW.splitAt(out.segment[0], 0, out.segment[0][0].minX + 0.1);
  out.merge = HW.mergeAt(out.segment[0], 1);
  let n = 0;

  out.toSamples = [
    HW.sentenceToSamples(read.groups, 'the cat', () => 'id' + n++),
    HW.sentenceToSamples(out.segment[1], 'the cat', () => 'id' + n++),
  ];

  out.joins = HW.joinBetween(data.samples[data.samples.length - 2], data.samples[data.samples.length - 1]);
  const r = HW.makeRng('x');

  out.rng = [
    r(),
    r.normal(),
    r.range(2, 3),
    r.pick([1, 2, 3]),
    r.weighted(['a', 'b'], [1, 3]),
    r.shuffle([1, 2, 3, 4]),
  ];

  out.defaults = HW.DEFAULTS;

  return stable(out);
}

if (process.argv[1] && process.argv[1].endsWith('snapshot.js') && process.argv[2]) {
  const HW = await load(process.argv[2]);
  const BASE = await load(process.argv[3]);
  process.stdout.write(JSON.stringify(await snapshot(HW, BASE)));
}
