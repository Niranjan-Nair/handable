// A run of plain characters sharing one format, written as letters (and the
// writer's own joined ligatures).
import { unitProb } from '../model/sequences.js';
import { addBox, charBox, emptyBox } from './boxes.js';

// The run cut into what gets written: single letters, and pairs or triples written
// as one of the writer's ligatures about as often as they join them.
function tokenize(writer, chars) {
  const { model, rng, o, formality } = writer;
  const n = chars.length;
  const tokens = [];

  for (let i = 0; i < n;) {
    let tok = null;

    if (o.ligatures !== false) {
      for (const L of [3, 2]) {
        if (i + L > n) continue;

        const str = chars.slice(i, i + L).join('');

        if (model.units[str] && rng() < unitProb(model, str) * (1 - formality)) {
          tok = { s: str, i, L, unit: true };
          break;
        }
      }
    }

    tok = tok || { s: chars[i], i, L: 1 };
    tokens.push(tok);
    i += tok.L;
  }

  return tokens;
}

// info: { start (index of the run's first letter in its word), n (letters in the
// word), prev (the letter before the run), font, sis (source ranges per letter) }
export function runBox(writer, chars, s, info) {
  const b = emptyBox();
  let x = 0;
  let prev = null;

  tokenize(writer, chars).forEach((t, k) => {
    const gi = info.start + t.i;
    const N = info.n;
    const ctx = N === t.L ? 'solo' : gi === 0 ? 'start' : gi + t.L === N ? 'end' : 'mid';
    if (k > 0) x += writer.letterGap() * s;
    const extra = { prev: t.i ? chars[t.i - 1] : info.prev, font: info.font };

    // the same letter written back-to-back ("ll", "ee", "ss") keeps the same form
    if (prev && prev.t.s === t.s && prev.g) {
      if (prev.g.variant) extra.variant = prev.g.variant;
      if (prev.g.picks) extra.picks = prev.g.picks;
    }

    const { b: cb, g } = charBox(writer, t.s, s, ctx, extra);
    prev = { t, g };
    if (g && t.unit) writer.note('ligatures', t.s);
    addBox(b, cb, x, 0);

    // a joined pair or triple shares its width between its letters
    if (info.sis) {
      for (let q = 0; q < t.L; q++) {
        const sr = info.sis[t.i + q];
        if (sr && sr[0] != null)
          b.cmap.push({ s: sr[0], e: sr[1], a: x + (cb.w * q) / t.L, b: x + (cb.w * (q + 1)) / t.L, dy: 0, sc: s });
      }
    }

    x += cb.w;
  });

  b.w = x;

  return b;
}
