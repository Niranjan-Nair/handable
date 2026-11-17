// Cursive: the letters of a word joined up, the way a hand runs on from one letter to
// the next without lifting. Each letter's last main stroke is carried on, in a
// curve, to where the next letter starts.
import { polyLength } from '../geometry.js';
import { STEP } from '../options.js';

// a glyph's main strokes, in the order they were drawn (not a dot, or a t's cross
// drawn afterwards: the hand doesn't move on from those)
function mainStrokes(strokes) {
    const lens = strokes.map(polyLength);
    const longest = Math.max(...lens);

    return strokes.filter((_, i) => lens[i] >= 0.35 * longest);
}

// where the pen leaves a glyph: the end of its main stroke that ends furthest right
function exitOf(g) {
    let best = null;

    for (const st of mainStrokes(g.strokes)) if (!best || st.at(-1).x > best.at(-1).x) best = st;

    return best;
}

// where the pen comes into a glyph: the start of its first main stroke
const entryOf = (g) => mainStrokes(g.strokes)[0];

// a placed item's point in the run (items are { g, x, y, s }: a glyph at x, y, scale s)
const inRun = (it, p) => ({ x: it.x + p.x * it.s, y: it.y + p.y * it.s, w: p.w == null ? 1 : p.w });

// Joins placed item a to item b, the next letter: a's exit stroke runs on to b's
// entry. The two strokes meet without a pen lift, so neither end pools ink there.
export function joinLetters(a, b) {
    const out = exitOf(a.g);
    const into = entryOf(b.g);
    if (!out || !into || out === into) return;

    const E = inRun(a, out.at(-1));
    const S = inRun(b, into[0]);
    const dx = S.x - E.x;
    const k = a.s;
    // out of the letter to the right (dipping a little), then up or down into the next
    const c1 = { x: E.x + 0.5 * Math.max(dx, 0.05 * k), y: E.y + 0.04 * k };
    const c2 = { x: S.x - 0.35 * Math.max(dx, 0.05 * k), y: S.y + 0.4 * (E.y - S.y) };
    const n = Math.max(3, Math.ceil(Math.hypot(dx, S.y - E.y) / (STEP * k)) + 1);

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
