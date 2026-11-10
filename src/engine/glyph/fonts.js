// How people hand-write TeX's fonts, applied to a synthesized glyph (units):
//   bb   blackboard bold: the main upright stroke is doubled (ℝ, ℕ, ℤ …)
//   bf   bold: every stroke gone over a second time, slightly offset
//   cal  script / calligraphic: slanted, an entry curl and a swash at the end
//   frak fraktur-ish: curves broken into straight pieces, a little tick at the start
//   it   italic: extra slant
import { bbox, polyLength } from '../geometry.js';
import { STEP } from '../options.js';
import { clamp } from '../util.js';
import { finishGlyph } from './synth.js';

const FONTS = { it: italic, bf: bold, bb: blackboard, cal: script, frak: fraktur };

// g in font (rng and r: the randomness to draw it with); a new glyph
export function styleGlyph(g, font, rng, r = 1) {
    const restyle = FONTS[font];
    if (!restyle) return g;

    const strokes = g.strokes.map((st) => st.map((p) => ({ ...p })));
    const bb = bbox(strokes);

    const shape = {
        strokes,
        bb,
        H: Math.max(0.25, bb.maxY - bb.minY),
        cx: (bb.minX + bb.maxX) / 2,
        cy: (bb.minY + bb.maxY) / 2,
        rng,
        jitter: (a) => rng.normal() * a * Math.min(r, 1.5),
    };

    const keep = {};
    for (const k of ['variant', 'picks', 'inferred']) if (g[k] != null) keep[k] = g[k];

    return finishGlyph(g.char, restyle(shape), keep);
}

// ---- helpers (strokes are lists of { x, y, w } points)
const shear = (strokes, k) =>
    strokes.forEach((st) =>
        st.forEach((p) => {
            p.x -= k * p.y;
        }),
    );

// a curve from parametric f(t), t in 0..1, about len long
function trace(f, len) {
    const n = Math.max(3, Math.ceil(len / STEP));

    return Array.from({ length: n }, (_, i) => ({ ...f(i / (n - 1)), w: 1 }));
}

// the unit direction from point i to point i + k of a stroke
function dirAt(st, i, k) {
    const a = st[Math.max(0, Math.min(st.length - 1, i))];
    const b = st[Math.max(0, Math.min(st.length - 1, i + k))];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;

    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
}

// a circle arc leaving p in direction t, curling toward side n, sweeping `sweep` radians
function curl(p, t, n, rad, sweep) {
    return trace((u) => {
        const ph = u * sweep;

        return {
            x: p.x + n.x * rad + (-n.x * Math.cos(ph) + t.x * Math.sin(ph)) * rad,
            y: p.y + n.y * rad + (-n.y * Math.cos(ph) + t.y * Math.sin(ph)) * rad,
        };
    }, rad * sweep);
}

// the side of a point's tangent that faces away from the glyph's center
function outward(shape, p, t) {
    const n = { x: -t.y, y: t.x };

    return (p.x - shape.cx) * n.x + (p.y - shape.cy) * n.y >= 0 ? n : { x: -n.x, y: -n.y };
}

// ---- the fonts: each returns the restyled strokes
function italic({ strokes, jitter }) {
    shear(strokes, 0.2 + jitter(0.02));

    return strokes;
}

// go over each stroke again: offset by ~half a pen width, drifting slightly
function bold({ strokes, rng, jitter }) {
    const ang = rng.range(-0.9, -0.3);
    const d0 = 0.03;
    const out = [];

    for (const st of strokes) {
        out.push(st);
        let drift = 0;

        out.push(
            st.map((p) => {
                drift = drift * 0.9 + jitter(0.003);
                const d = d0 + drift;

                return { x: p.x + Math.cos(ang) * d, y: p.y + Math.sin(ang) * d, w: p.w };
            }),
        );
    }

    return out;
}

// the main upright stroke doubled, on its inside
function blackboard({ strokes, bb, H, cx, cy, jitter }) {
    const best = longestSteepRun(strokes, bb);
    if (!best || best.len <= 0.3 * H) return strokes;

    const run = best.run;
    const d = clamp(0.1 * H, 0.05, 0.1);

    // offset along the normal, toward the inside of the letter
    const normals = run.map((p, i) => {
        const t = dirAt(run, i - 1, 2);

        return { x: -t.y, y: t.x };
    });

    const sgn = run.reduce((t, p, i) => t + (cx - p.x) * normals[i].x + (cy - p.y) * normals[i].y, 0) >= 0 ? 1 : -1;
    let drift = 0;
    const n = run.length;

    const double = run
        .map((p, i) => {
            drift = drift * 0.9 + jitter(0.002);

            return { x: p.x + normals[i].x * (d + drift) * sgn, y: p.y + normals[i].y * (d + drift) * sgn, w: p.w };
        })
        .filter((_, i) => i >= n * 0.03 && i <= n * 0.97);

    if (double.length > 2) strokes.push(double);

    return strokes;
}

// the longest steep run of points (a stem, a diagonal, the left of a bowl),
// preferring ones on the left: { run, score, len } or null
function longestSteepRun(strokes, bb) {
    let best = null;

    strokes.forEach((st) => {
        let a = 0;

        for (let i = 1; i <= st.length; i++) {
            // steep, and not turning a corner (a stem and the diagonal after it are separate runs)
            const steep =
                i < st.length &&
                Math.abs(st[i].y - st[i - 1].y) > 0.55 * Math.hypot(st[i].x - st[i - 1].x, st[i].y - st[i - 1].y) &&
                (i - a < 3 ||
                    (() => {
                        const u = dirAt(st, i - 3, 2);
                        const v = dirAt(st, i - 1, 1);

                        return u.x * v.x + u.y * v.y > 0.6;
                    })());

            if (steep) continue;

            if (i - a > 2) {
                const run = st.slice(a, i);
                const len = polyLength(run);
                const mx = run.reduce((t, p) => t + p.x, 0) / run.length;
                const score = len * (1.3 - (0.6 * (mx - bb.minX)) / Math.max(0.1, bb.maxX - bb.minX));
                if (!best || score > best.score) best = { run, score, len };
            }

            a = i;
        }
    });

    return best;
}

// slanted, with an entry curl sweeping into the first stroke and a swash at the end
function script(shape) {
    const { strokes, H, jitter } = shape;
    shear(strokes, 0.24 + jitter(0.03));
    const first = strokes.find((st) => st.length > 3);

    const last = strokes
        .slice()
        .reverse()
        .find((st) => st.length > 3);

    if (first) {
        const p0 = first[0];
        const t = dirAt(first, 0, 3);
        const n = outward(shape, p0, t);
        const rad = 0.15 * H * (1 + jitter(0.1));
        const loop = curl(p0, { x: -t.x, y: -t.y }, n, rad, Math.PI * 1.15).reverse();
        first.unshift(...loop.slice(0, -1));
    }

    if (last) {
        // the last stroke sweeps out and curls under
        const pe = last[last.length - 1];
        const t = dirAt(last, last.length - 4, 3);
        const n = outward(shape, pe, t);
        const rad = 0.13 * H * (1 + jitter(0.1));
        last.push(...curl(pe, t, n, rad, Math.PI * 0.8).slice(1));
    }

    return strokes;
}

// curves broken into straight pieces, as if drawn with a broad nib, and a lead-in tick
function fraktur({ strokes, H }) {
    shear(strokes, -0.04);
    const out = strokes.map((st) => (st.length < 3 ? st : straighten(st, 0.03 * H)));
    const first = out.find((st) => st.length > 3);

    if (first) {
        const p0 = first[0];
        const tick = trace((u) => ({ x: p0.x - 0.07 * H * (1 - u), y: p0.y + 0.05 * H * (1 - u) }), 0.09 * H);
        first.unshift(...tick.slice(0, -1));
    }

    return out;
}

// a stroke as straight pieces (Douglas-Peucker, to within eps), densely resampled
function straighten(st, eps) {
    const rdp = (pts) => {
        if (pts.length < 3) return pts;

        const a = pts[0];
        const b = pts[pts.length - 1];
        const l = Math.hypot(b.x - a.x, b.y - a.y) || 1e-9;
        let k = -1;
        let dm = 0;

        for (let i = 1; i < pts.length - 1; i++) {
            const d = Math.abs((b.x - a.x) * (a.y - pts[i].y) - (a.x - pts[i].x) * (b.y - a.y)) / l;

            if (d > dm) {
                dm = d;
                k = i;
            }
        }

        return dm > eps
            ? rdp(pts.slice(0, k + 1))
                  .slice(0, -1)
                  .concat(rdp(pts.slice(k)))
            : [a, b];
    };

    const corners = rdp(st);
    const out = [];

    for (let k = 1; k < corners.length; k++) {
        const A = corners[k - 1];
        const B = corners[k];
        const n = Math.max(2, Math.ceil(Math.hypot(B.x - A.x, B.y - A.y) / STEP));
        for (let q = k > 1 ? 1 : 0; q < n; q++)
            out.push({ x: A.x + ((B.x - A.x) * q) / (n - 1), y: A.y + ((B.y - A.y) * q) / (n - 1), w: 1 });
    }

    return out;
}
