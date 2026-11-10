// Tall brackets around matrices and cases, drawn in your own hand.
import { synthGlyph } from '../glyph/synth.js';
import { clamp } from '../util.js';
import { handStroke } from './boxes.js';

// A tall delimiter in your own hand: one of your ( ) [ ] { } | glyphs (trained,
// or worked out from your writing), stretched to run from T to B the way a
// person draws a taller one: the ends (and a brace's point) keep their shape and
// size, and only the straight runs between them get longer. Parentheses and bars
// stretch evenly, parentheses widening a little as they grow. null if your model
// can't write the character at all.
export function handDelimiter(writer, kind, x0, T, B, s) {
    const { model, o, rng, r } = writer;
    const g = synthGlyph(model, kind, 'solo', rng, { ...o, randomness: r * 0.6, shearDelta: 0 });
    if (!g || !g.strokes.length) return null;
    if (g.inferred) writer.note('inferred', kind);
    const pts = g.strokes.flat();
    const y0 = Math.min(...pts.map((p) => p.y));
    const y1 = Math.max(...pts.map((p) => p.y));
    const h0 = Math.max(1e-3, y1 - y0);
    const H = B - T;
    const hn = h0 * s;
    const ratio = H / hn;
    const fixed = fixedParts(g, kind, y0, h0);
    // piecewise-linear map of a glyph height fraction to the target height
    const segs = [];
    let at = 0;

    for (const [a, b] of fixed) {
        if (a > at) segs.push([at, a, false]);
        segs.push([a, b, true]);
        at = b;
    }

    if (at < 1) segs.push([at, 1, false]);
    const stretchLen = segs.filter((q) => !q[2]).reduce((t, q) => t + q[1] - q[0], 0);
    const fixedLen = 1 - stretchLen;
    // the ends (and a brace's point) grow with the delimiter, but much less than it
    // does, the way a hand draws a bigger curl on a taller brace
    const grow = clamp(Math.pow(ratio, 0.45), 1, Math.min(2, (0.7 * H) / Math.max(1e-6, fixedLen * hn)));
    const extra = H - hn * fixedLen * grow - hn * stretchLen;
    const even = !fixed.length || extra <= 0 || stretchLen <= 0;

    const mapY = (f) => {
        if (even) return T + f * H;

        let y = T;

        for (const [a, b, keep] of segs) {
            const len = b - a;
            const out = keep ? len * hn * grow : len * hn + (extra * len) / stretchLen;
            if (f <= b) return y + ((f - a) / Math.max(1e-6, len)) * out;

            y += out;
        }

        return B;
    };

    const sx = s * (kind === '(' || kind === ')' ? clamp(Math.sqrt(ratio), 1, 1.7) : fixed.length && !even ? grow : 1);
    const strokes = g.strokes.map((st) => st.map((p) => ({ x: x0 + p.x * sx, y: mapY((p.y - y0) / h0), w: p.w })));
    const width = Math.max(...strokes.flat().map((p) => p.x));

    return { char: kind, strokes, width, minY: T, maxY: B, w: width - x0 };
}

// the parts of a bracket glyph's height (fractions) that keep their natural size
function fixedParts(g, kind, y0, h0) {
    if (kind === '[' || kind === ']')
        return [
            [0, 0.2],
            [0.8, 1],
        ];
    if (kind !== '{' && kind !== '}') return [];

    // where the point is: the kink in the middle, the spot that sticks out furthest
    // compared with the stroke just above and below it (the stem itself may lean
    // further out than the point does)
    const st = g.strokes.reduce((a, q) => (q.length > a.length ? q : a), g.strokes[0]);
    const out = kind === '{' ? -1 : 1;
    const span = 0.1 * h0;
    let tip = null;
    let best = -Infinity;

    for (let k = 0; k < st.length; k++) {
        const f = (st[k].y - y0) / h0;
        if (f < 0.25 || f > 0.75) continue;

        let a = k;
        let b = k;
        while (a > 0 && Math.abs(st[a].y - st[k].y) < span) a--;
        while (b < st.length - 1 && Math.abs(st[b].y - st[k].y) < span) b++;
        const prominence = out * (st[k].x - (st[a].x + st[b].x) / 2);

        if (prominence > best) {
            best = prominence;
            tip = st[k];
        }
    }

    const c = tip ? clamp((tip.y - y0) / h0, 0.3, 0.7) : 0.5;

    return [
        [0, 0.17],
        [c - 0.13, c + 0.13],
        [0.83, 1],
    ];
}

// A tall delimiter drawn by hand from x0 (width w) between heights T and B:
// ( ) bow out, [ ] have serifs, { } pinch to a point at the middle, | and ‖ are
// straight. left = the opening side.
export function drawnDelimiter(writer, kind, x0, w, T, B, left) {
    const H = B - T;
    const flip = (pts) => (left ? pts : pts.map(([x, y]) => [2 * x0 + w - x, y]));
    const n = 14;
    const pts = [];

    if (kind === '(' || kind === ')') {
        for (let k = 0; k <= n; k++) {
            const t = k / n;
            pts.push([x0 + w - w * Math.sin(Math.PI * t) * 0.95, T + H * t]);
        }

        return handStroke(writer, flip(pts), 0.3);
    }

    if (kind === '[' || kind === ']') {
        const q = [
            [x0 + w, T],
            [x0 + w * 0.2, T],
            [x0 + w * 0.2, B],
            [x0 + w, B],
        ];

        return handStroke(writer, flip(q), 0.3);
    }

    if (kind === '{' || kind === '}') {
        // two curls meeting in a point at the middle
        const q = [
            [1, 0],
            [0.6, 0.04],
            [0.5, 0.15],
            [0.5, 0.38],
            [0.35, 0.46],
            [0, 0.5],
            [0.35, 0.54],
            [0.5, 0.62],
            [0.5, 0.85],
            [0.6, 0.96],
            [1, 1],
        ];

        for (const [fx, fy] of q) pts.push([x0 + w * fx, T + H * fy]);

        return handStroke(writer, flip(pts), 0.3);
    }

    if (kind === '‖') {
        const g = handStroke(
            writer,
            [
                [x0 + w * 0.25, T],
                [x0 + w * 0.25, B],
            ],
            0.3,
        );

        const g2 = handStroke(
            writer,
            [
                [x0 + w * 0.75, T],
                [x0 + w * 0.75, B],
            ],
            0.3,
        );

        g.strokes.push(...g2.strokes);
        g.width = Math.max(g.width, g2.width);

        return g;
    }

    return handStroke(
        writer,
        [
            [x0 + w / 2, T],
            [x0 + w / 2, B],
        ],
        0.3,
    ); // |
}
