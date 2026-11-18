// A cursive letter as the writer wrote it, cut down to its body. Written alone or cut
// out of a word, a cursive letter comes with some of the stroke into it and the
// stroke out of it, as much or as little as the writer happened to draw. Those are
// the joins, which the app draws itself between letters (see layout/cursive.js), so
// only the body is kept: the part that matches the letter's cursive skeleton, which
// starts where the pen comes into the letter and ends on its last turn.
//
// To find it, the letter's main stroke is lined up with its skeleton (in the writer's
// slant and heights) with a short way in and a short way out added on, by dynamic time
// warping over height and direction. The ink lined up with the skeleton is the body.
import { arcSample } from '../geometry.js';
import { baseGlyph, joinsIn, joinsOut } from './skeleton.js';
import { skeletonTransform } from './style.js';

const STEP = 0.02; // units between compared points

// the letter's strokes (raw [x, y, t, p] points, in units, y down) with its main
// stroke first and cut down to its body; as they were when it has no cursive skeleton
// or the body can't be found clearly
export function cursiveBody(strokes, ch, style) {
    const main = mainStroke(strokes, ch);
    const rest = strokes.filter((s, i) => i !== main);
    const tmpl = template(ch, style);
    const body = tmpl && bodySpan(strokes[main], tmpl);

    return [body ? strokes[main].slice(body[0], body[1] + 1) : strokes[main], ...rest];
}

// The index of the letter's main stroke: for a letter that joins on, the one ending
// furthest right and low (its turn at the line, not a dot, a cross or the first stem
// of H); for the rest, the longest
function mainStroke(strokes, ch) {
    const len = (s) => s.reduce((t, p, k) => t + (k ? Math.hypot(p[0] - s[k - 1][0], p[1] - s[k - 1][1]) : 0), 0);
    const score = joinsOut(ch) ? (s) => s.at(-1)[0] + s.at(-1)[1] : len;
    let best = 0;
    for (let i = 1; i < strokes.length; i++) if (score(strokes[i]) > score(strokes[best])) best = i;

    return best;
}

// The skeleton's main stroke in the writer's style, with a way in from the line before
// it and a way out after it (where it's joined into, and joins on), as compared points: { pts, from, to } (the body is
// pts[from..to]); null without a cursive skeleton
function template(ch, style) {
    const base = baseGlyph(ch, true);
    if (!base) return null;

    const T = skeletonTransform(style, ch);
    const body = base.strokes[0].pts.map((p) => T(p.x, p.y));
    const a = body[0];
    const b = body.at(-1);
    const wayIn = joinsIn(ch) ? [{ x: a.x - 0.2, y: 0 }, a] : [a];
    const wayOut = joinsOut(ch) ? [b, { x: b.x + 0.15, y: b.y - 0.12 }] : [b];
    const raw = (pts) => pts.map((p) => [p.x, p.y]);
    const parts = [wayIn, body, wayOut].map((pts) => withDirs(arcSample(raw(pts), STEP)));

    return {
        pts: [...parts[0], ...parts[1].slice(1), ...parts[2].slice(1)],
        from: parts[0].length - 1,
        to: parts[0].length + parts[1].length - 2,
    };
}

// each point's direction of travel, as a unit vector (dx, dy)
function withDirs(pts) {
    pts.forEach((p, k) => {
        const a = pts[Math.max(0, k - 1)];
        const b = pts[Math.min(pts.length - 1, k + 1)];
        const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        p.dx = (b.x - a.x) / l;
        p.dy = (b.y - a.y) / l;
    });

    return pts;
}

// The raw indices [first, last] of the stroke's body, lined up with the template;
// null when the stroke is too short to tell, or the way in or out would take up so
// much of it that the letter is probably written another way than the skeleton.
function bodySpan(stroke, tmpl) {
    if (stroke.length < 6) return null;

    const ink = withDirs(arcSample(stroke, STEP));
    const path = warp(ink, tmpl.pts);
    const first = path.find(([, j]) => j >= tmpl.from)[0];
    const last = path.findLast(([, j]) => j <= tmpl.to)[0];
    const n = ink.length;
    if (first > 0.45 * n || n - 1 - last > 0.45 * n || last - first < 0.35 * n) return null;

    return [ink[first].i, ink[last].i];
}

// how unlike two compared points are: height, and direction of travel
const cost = (a, b) => 4 * (a.y - b.y) ** 2 + 0.25 * ((a.dx - b.dx) ** 2 + (a.dy - b.dy) ** 2);

// Dynamic time warping of A onto B: the cheapest way through both in order, as
// [i, j] pairs from [0, 0] to the ends
function warp(A, B) {
    const n = A.length;
    const m = B.length;
    const D = Array.from({ length: n }, () => new Float64Array(m).fill(Infinity));

    for (let i = 0; i < n; i++)
        for (let j = 0; j < m; j++) {
            const prev =
                i || j
                    ? Math.min(
                          i ? D[i - 1][j] : Infinity,
                          j ? D[i][j - 1] : Infinity,
                          i && j ? D[i - 1][j - 1] : Infinity,
                      )
                    : 0;
            D[i][j] = prev + cost(A[i], B[j]);
        }

    const path = [[n - 1, m - 1]];
    let i = n - 1;
    let j = m - 1;

    while (i || j) {
        const diag = i && j ? D[i - 1][j - 1] : Infinity;
        const up = i ? D[i - 1][j] : Infinity;
        const left = j ? D[i][j - 1] : Infinity;

        if (diag <= up && diag <= left) {
            i--;
            j--;
        } else if (up <= left) i--;
        else j--;

        path.unshift([i, j]);
    }

    return path;
}
