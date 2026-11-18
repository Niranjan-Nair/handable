// Cursive: the strokes between letters. A cursive letter is its body alone (see the
// cursive skeletons in model/basefont.js): its first stroke starts where the pen comes
// into it and ends on a turn heading off to the right. Writing a word, the pen runs on
// from where one letter ends to where the next one starts, so each join is drawn for
// the two letters it joins: on the way the last one was going, and into the next one
// the way its stroke begins, smoothly up into a loop or the rise into n, or up to a
// point where it turns down (i, u, r, the top of a). The first letter of a word gets a
// short lead-in, the last a short exit. Dots and crosses are never joined.
import { joinsIn, joinsOut } from '../model/skeleton.js';
import { STEP } from '../options.js';

// a placed item's point in the run (items are { g, x, y, s }: a glyph at x, y, scale s)
const inRun = (it, p) => ({ x: it.x + p.x * it.s, y: it.y + p.y * it.s, w: p.w == null ? 1 : p.w });
const toItem = (it, p) => ({ x: (p.x - it.x) / it.s, y: (p.y - it.y) / it.s, w: p.w });

// the unit direction from point a to point b
function direction(a, b) {
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;

    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
}

// where an item's joining stroke ends, and the way it's going there
function exitOf(it) {
    const st = it.g.strokes[0];
    const p = inRun(it, st.at(-1));

    return { p, dir: direction(inRun(it, st[Math.max(0, st.length - 4)]), p) };
}

// where an item's joining stroke starts, and the way it sets off; bowl: it sets off
// back to the left, round a bowl (o, a, d, g, q)
function entryOf(it) {
    const st = it.g.strokes[0];
    const p = inRun(it, st[0]);
    const dir = direction(p, inRun(it, st[Math.min(st.length - 1, 3)]));

    return { p, dir, bowl: dir.x < -0.3 };
}

// whether a join runs smoothly on into entry S: a stroke that sets off upwards (a tall
// letter, the rise into n or e)
const runsOn = (S) => S.dir.y < -0.25 && !S.bowl;

// The pen's way from exit E to entry S (each { p, dir }), at scale k, as points from
// E.p to S.p: one curve, bending one way only, on from the way the last letter was
// going. jit(): a little variation, so no two joins are quite alike.
function penWay(E, S, k, jit) {
    const a = E.p;
    const b = S.p;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const c1 = { x: a.x + E.dir.x * d * 0.25 * jit(), y: a.y + E.dir.y * d * 0.25 * jit() };
    const smooth = runsOn(S);
    let c2;

    // up from below into a bowl that sets off back to the left (o, a, d, g, q): rising
    // to where it starts and turning into it there
    if (S.bowl && b.y < a.y - 0.1 * k) c2 = { x: b.x, y: b.y + 0.55 * (a.y - b.y) * jit() };
    else if (smooth) c2 = { x: b.x - S.dir.x * d * 0.25 * jit(), y: b.y - S.dir.y * d * 0.25 * jit() };
    // across into a start no higher than the exit (after o or w, at the x-height)
    else if (b.y > a.y - 0.1 * k) c2 = { x: b.x - 0.35 * d * jit(), y: b.y };
    // or up to a point, where the pen turns (i, u, r, the top of a)
    else c2 = { x: b.x - 0.12 * d * jit(), y: b.y + 0.45 * (a.y - b.y) * jit() };

    const [p1, p2] = oneBend(a, b, c1, c2, E.dir, smooth && S.dir);
    const n = Math.max(3, Math.ceil(d / (STEP * k)) + 1);

    return Array.from({ length: n }, (_, i) => {
        const t = i / (n - 1);
        const u = 1 - t;

        return {
            x: u * u * u * a.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * b.x,
            y: u * u * u * a.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * b.y,
            w: a.w + (b.w - a.w) * t,
        };
    });
}

// The control points of a curve from a to b that bends one way only (no S), leaving a
// the way `out` points: c1 and c2 as they are when the path a, c1, c2, b turns the same
// way at both corners. Otherwise a simple arc: into a stroke going on the way `into` points, the
// one meeting both directions (through where they cross), if they cross ahead; failing
// that, one heading straight on to b.
function oneBend(a, b, c1, c2, out, into) {
    const turn = (p, q, r) => (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
    if (turn(a, c1, c2) * turn(c1, c2, b) >= 0) return [c1, c2];

    const X = into && crossing(a, out, b, into);
    if (X) return arc(a, X, b);

    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const along = Math.min(0.5 * d, Math.max(0.1 * d, (b.x - a.x) * out.x + (b.y - a.y) * out.y));

    return arc(a, { x: a.x + out.x * along, y: a.y + out.y * along }, b);
}

// Where the line on from a along `out` meets the line back from b against `into`, if
// it's ahead of both and not too far off; else null
function crossing(a, out, b, into) {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const det = out.x * into.y - into.x * out.y;
    if (Math.abs(det) < 1e-6) return null;

    // a + t·out = b − u·into
    const t = ((b.x - a.x) * into.y - into.x * (b.y - a.y)) / det;
    const u = (out.x * (b.y - a.y) - out.y * (b.x - a.x)) / det;
    const ok = (v) => v > 0.15 * d && v < 1.5 * d;

    return ok(t) && ok(u) ? { x: a.x + out.x * t, y: a.y + out.y * t } : null;
}

// a curve from a to b with one control point X (an arc that never turns back), as a
// cubic's two
const arc = (a, X, b) => [
    { x: a.x + ((X.x - a.x) * 2) / 3, y: a.y + ((X.y - a.y) * 2) / 3 },
    { x: b.x + ((X.x - b.x) * 2) / 3, y: b.y + ((X.y - b.y) * 2) / 3 },
];

const jitter = (rng, r) => () => 1 + rng.normal() * 0.12 * Math.min(r, 1.5);

// Where the join meets the next letter: the start of its first stroke left out up to
// there. Into a tall letter (h, l, b, k, f), the join runs straight up most of the way
// and meets its rise a little below the top, so the join and the down stroke make the
// ascender, as "th" and "wh" are written, rather than meeting a loop part way up. After
// a letter that leaves high (b, o, v, w), a letter that starts by rising (n, m, v, y …)
// is met where it reaches that height (or at the top of its rise), so "on" runs across
// into the n rather than dipping and climbing back up into it.
// Not e, whose rise makes its loop.
function enterAt(b, into, exitY) {
    if (b.g.char === 'e') return;

    let top = 0; // the top of the stroke's first rise
    while (top < into.length - 3 && into[top + 1].y <= into[top].y) top++;
    const level = (exitY - b.y) / b.s;
    const tall = into[top].y < -0.75;
    if (!tall && level > -0.3) return;

    const enter = tall ? into[top].y + 0.15 : level;
    let k = 0;
    while (k < top && into[k].y > enter) k++;
    if (k > 0) into.splice(0, k);
}

// Where exit E runs on into item b's rise in one smooth bend, when b starts by rising:
// the earliest point of the rise's first half it can, failing that with b moved on a
// little to the right to make room (a letter that starts by rising steeply just after
// a turn at the line, or e, whose rise is shallow). The rise is left out up to there.
function fitEntry(E, b, into) {
    if (!runsOn(entryOf(b))) return;

    let top = 0;
    while (top < into.length - 4 && into[top + 1].y <= into[top].y) top++;

    for (let dx = 0; dx <= 0.3 * b.s; dx += 0.02 * b.s)
        for (let k = 0; k <= top / 2; k++) {
            const p = inRun(b, into[k]);
            const q = inRun(b, into[k + 3]);

            if (crossing(E.p, E.dir, { ...p, x: p.x + dx }, direction(p, q))) {
                if (k > 0) into.splice(0, k);
                b.x += dx;

                return;
            }
        }
}

// whether glyph a joins on into glyph b, the next letter: both cursive, and not into a
// capital, nor out of one like O or T
const canJoin = (a, b) => a.cursive && b.cursive && joinsOut(a.char) && joinsIn(b.char);

// Joins placed item a to b, the next letter, when a joins on into b: a's joining stroke
// runs on into b's. -> whether they were joined. (They meet without a pen lift, so
// neither end pools ink there.) b may be moved on a little to make room for the join.
export function joinLetters(a, b, rng, r) {
    if (!canJoin(a.g, b.g)) return false;

    const out = a.g.strokes[0];
    const into = b.g.strokes[0];
    const E = exitOf(a);
    enterAt(b, into, E.p.y);
    fitEntry(E, b, into);
    const way = penWay(E, entryOf(b), a.s, jitter(rng, r));
    out.push(...way.slice(1).map((p) => toItem(a, p)));
    out.joinedEnd = true;
    into.joinedStart = true;

    return true;
}

// How far the next letter tucks in under a capital that doesn't join on, in units: most
// of the way under the part of it that overhangs its lower half (T's bar, the tops of
// V and W), so it doesn't stand apart. 0 for other letters.
export function overhang(g) {
    if (!g.cursive || joinsOut(g.char)) return 0;

    let low = -Infinity;
    for (const st of g.strokes) for (const p of st) if (p.y > -0.45) low = Math.max(low, p.x);

    return low > -Infinity ? 0.7 * Math.max(0, g.bodyMaxX - low) : 0;
}

// a letter nothing joins into: a short upstroke into it, from the line (not into a
// capital, which starts itself, nor a bowl like o or a, which starts at its top)
export function leadIn(it, rng, r) {
    if (!it.g.cursive || !joinsIn(it.g.char)) return;

    const S = entryOf(it);
    if (S.bowl) return;

    // (from far enough left that a loop's upstroke crosses its down stroke low, as in l)
    const from = { p: { x: S.p.x - 0.24 * it.s, y: it.y - 0.02 * it.s, w: S.p.w }, dir: { x: 0.8, y: -0.6 } };
    const into = it.g.strokes[0];
    into.unshift(
        ...penWay(from, S, it.s, jitter(rng, r))
            .slice(0, -1)
            .map((p) => toItem(it, p)),
    );
}

// a letter that joins nothing: a short exit, off up to the right (not from a capital
// that doesn't join on)
export function leadOut(it, rng, r) {
    if (!it.g.cursive || !joinsOut(it.g.char)) return;

    const E = exitOf(it);
    const high = E.p.y - it.y < -0.3 * it.s;
    const to = { x: E.p.x + 0.13 * it.s, y: E.p.y - (high ? 0.02 : 0.1) * it.s, w: E.p.w };
    const S = { p: to, dir: { x: 0.8, y: -0.6 } };
    it.g.strokes[0].push(
        ...penWay(E, S, it.s, jitter(rng, r))
            .slice(1)
            .map((p) => toItem(it, p)),
    );
}
