// Cursive: the letters of a word joined up, the way a hand runs on from one letter to
// the next without lifting. A cursive letter's first stroke is the one that joins
// (see the cursive skeletons in model/basefont.js): it's carried on from its exit, in
// a curve, to where the next letter's first stroke starts. Dots and crosses, drawn
// afterwards, are never joined.
import { STEP } from '../options.js';

// a placed item's point in the run (items are { g, x, y, s }: a glyph at x, y, scale s)
const inRun = (it, p) => ({ x: it.x + p.x * it.s, y: it.y + p.y * it.s, w: p.w == null ? 1 : p.w });

// the direction a stroke leaves in, over its last few points (a unit vector)
function exitDirection(st, it) {
    const a = inRun(it, st[Math.max(0, st.length - 4)]);
    const b = inRun(it, st.at(-1));
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;

    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
}

// letters whose upstroke is part of the letter itself (e's makes its loop)
const OWN_UPSTROKE = 'e';

// After a letter that leaves high (b, o, v, w), the next letter is entered at that
// height: the start of its upstroke, still below the exit, is left out (so "on" doesn't
// dip to the line and climb back up into the n).
function enterHigh(b, into, E) {
    const level = (E.y - b.y) / b.s;
    if (level > -0.3 || OWN_UPSTROKE.includes(b.g.char)) return;

    let k = 0;
    while (k < into.length - 3 && into[k].y > level + 0.06 && into[k + 1].y <= into[k].y) k++;
    if (k > 0) into.splice(0, k);
}

// Joins placed item a to item b, the next letter, when both are cursive letters. The
// two strokes meet without a pen lift, so neither end pools ink there.
export function joinLetters(a, b) {
    if (!a.g.cursive || !b.g.cursive) return;

    const out = a.g.strokes[0];
    const into = b.g.strokes[0];
    const E = inRun(a, out.at(-1));
    enterHigh(b, into, E);
    const S = inRun(b, into[0]);
    const d = Math.hypot(S.x - E.x, S.y - E.y);
    if (d < 1e-3) return;

    // on in the direction the exit stroke was going, then into the next letter from
    // below and to the left (as an upstroke meets the top of a, i or n)
    const dir = exitDirection(out, a);
    const c1 = { x: E.x + dir.x * d * 0.4, y: E.y + dir.y * d * 0.4 };
    const c2 = { x: S.x - Math.max(0.3 * (S.x - E.x), 0.02 * a.s), y: S.y + 0.4 * (E.y - S.y) };
    const n = Math.max(3, Math.ceil(d / (STEP * a.s)) + 1);

    for (let i = 1; i < n; i++) {
        const t = i / (n - 1);
        const u = 1 - t;
        const x = u * u * u * E.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * S.x;
        const y = u * u * u * E.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * S.y;
        // (in a's own units, as the rest of its stroke)
        out.push({ x: (x - a.x) / a.s, y: (y - a.y) / a.s, w: E.w + (S.w - E.w) * t });
    }

    out.joinedEnd = true;
    into.joinedStart = true;
}
