// A run of plain characters sharing one format, written as letters (and the
// writer's own joined ligatures), or in cursive: slanted, and joined up.
import { unitProb } from '../model/sequences.js';
import { addBox, charBox, emptyBox } from './boxes.js';
import { joinLetters, leadIn, leadOut, overhang } from './cursive.js';

// The run cut into what gets written: single letters, and pairs or triples written
// as one of the writer's ligatures about as often as they join them (not in cursive,
// which has its own letters and joins).
function tokenize(writer, chars, cursive) {
    const { model, rng, o, formality } = writer;
    const n = chars.length;
    const tokens = [];

    for (let i = 0; i < n;) {
        let tok = null;

        if (o.ligatures !== false && !cursive) {
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
// word), prev (the letter before the run), font, sis (source ranges per letter),
// cursive }
export function runBox(writer, chars, s, info) {
    const b = emptyBox();
    const { cursive } = info;
    const font = info.font || (cursive ? 'it' : undefined);
    let x = 0;
    let prev = null;
    // (cursive) the letters nothing joins into, and those that join on into nothing
    const starts = [];
    const ends = [];

    tokenize(writer, chars, cursive).forEach((t, k) => {
        const gi = info.start + t.i;
        const N = info.n;
        const ctx = N === t.L ? 'solo' : gi === 0 ? 'start' : gi + t.L === N ? 'end' : 'mid';
        // (cursive letters are their bodies alone: the joins between them need room)
        if (k > 0) x += (writer.letterGap() + (cursive ? 0.05 : 0)) * s;
        if (cursive && prev && prev.g) x -= overhang(prev.g) * s;
        const extra = { prev: t.i ? chars[t.i - 1] : info.prev, font, cursive };

        // the same letter written back-to-back ("ll", "ee", "ss") keeps the same form
        if (prev && prev.t.s === t.s && prev.g) {
            if (prev.g.variant) extra.variant = prev.g.variant;
            if (prev.g.picks) extra.picks = prev.g.picks;
        }

        const { b: cb, g } = charBox(writer, t.s, s, ctx, extra);
        if (g && t.unit) writer.note('ligatures', t.s);
        addBox(b, cb, x, 0);
        const item = g && b.items.at(-1);
        // in cursive, a letter runs on into the next one
        const joined = cursive && item && prev && prev.item && joinLetters(prev.item, item, writer.rng, writer.r);
        if (prev && prev.item && !joined) ends.push(prev.item);
        if (item && !joined) starts.push(item);
        prev = { t, g, item };

        // a joined pair or triple shares its width between its letters
        if (info.sis) {
            for (let q = 0; q < t.L; q++) {
                const sr = info.sis[t.i + q];
                if (sr && sr[0] != null)
                    b.cmap.push({
                        s: sr[0],
                        e: sr[1],
                        a: x + (cb.w * q) / t.L,
                        b: x + (cb.w * (q + 1)) / t.L,
                        dy: 0,
                        sc: s,
                    });
            }
        }

        x += cb.w;
    });

    if (prev && prev.item) ends.push(prev.item);

    if (cursive) {
        for (const it of starts) leadIn(it, writer.rng, writer.r);
        for (const it of ends) leadOut(it, writer.rng, writer.r);
    }

    b.w = x;

    return b;
}
