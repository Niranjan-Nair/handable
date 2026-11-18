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

// where an item's joining stroke starts, and the way it sets off; corner: for a bowl
// that sets off back to the left (o, a, d, g, q), the top left corner of the bowl
function entryOf(it) {
    const st = it.g.strokes[0];
    const p = inRun(it, st[0]);
    const dir = direction(p, inRun(it, st[Math.min(st.length - 1, 3)]));
    if (dir.x >= -0.3) return { p, dir };

    const bowl = st.slice(0, Math.ceil(st.length / 2)).map((q) => inRun(it, q));
    const corner = { x: Math.min(...bowl.map((q) => q.x)), y: Math.min(...bowl.map((q) => q.y)) };

    return { p, dir, corner };
}

// The pen's way from exit E to entry S (each { p, dir }), at scale k, as points from
// E.p to S.p. jit(): a little variation, so no two joins are quite alike.
function penWay(E, S, k, jit) {
    const a = E.p;
    const b = S.p;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const c1 = { x: a.x + E.dir.x * d * 0.35 * jit(), y: a.y + E.dir.y * d * 0.35 * jit() };
    let c2;

    // up from below into a bowl that sets off back to the left (o, a, d, g, q): up its
    // left side and over the top into where it starts, not across the middle of it
    if (S.corner && b.y < a.y - 0.1 * k) c2 = { x: b.x + (S.corner.x - b.x) * jit(), y: S.corner.y };
    // smoothly on into a stroke that sets off upwards (a loop, the rise into n or e)
    else if (S.dir.y < -0.25) c2 = { x: b.x - S.dir.x * d * 0.35 * jit(), y: b.y - S.dir.y * d * 0.35 * jit() };
    // across into a start no higher than the exit (after o or w, at the x-height)
    else if (b.y > a.y - 0.1 * k) c2 = { x: b.x - 0.35 * d * jit(), y: b.y };
    // or up to a point, where the pen turns (i, u, r, the top of a)
    else c2 = { x: b.x - 0.12 * d * jit(), y: b.y + 0.45 * (a.y - b.y) * jit() };

    const n = Math.max(3, Math.ceil(d / (STEP * k)) + 1);

    return Array.from({ length: n }, (_, i) => {
        const t = i / (n - 1);
        const u = 1 - t;

        return {
            x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
            y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
            w: a.w + (b.w - a.w) * t,
        };
    });
}

const jitter = (rng, r) => () => 1 + rng.normal() * 0.12 * Math.min(r, 1.5);

// After a letter that leaves high (b, o, v, w), the next letter is entered where its
// first stroke rises to the exit: the part of its rise still below is left out (so "on"
// doesn't dip to the line and climb back up into the n). Into a tall loop (h, l, b, k,
// f), a little above the exit, so the join sweeps up into the loop rather than meeting
// it where it crosses the stem and turning sharply up. Not e, whose rise makes its loop.
function enterHigh(b, into, exitY) {
    const level = (exitY - b.y) / b.s;
    if (level > -0.3 || b.g.char === 'e') return;

    let top = 0; // the top of the stroke's first rise
    while (top < into.length - 3 && into[top + 1].y <= into[top].y) top++;
    const enter = into[top].y < level - 0.3 ? level - 0.15 : level + 0.06;

    let k = 0;
    while (k < top && into[k].y > enter) k++;
    if (k > 0) into.splice(0, k);
}

// whether glyph a joins on into glyph b, the next letter: both cursive, and not into a
// capital, nor out of one like O or T
const canJoin = (a, b) => a.cursive && b.cursive && joinsOut(a.char) && joinsIn(b.char);

// Joins placed item a to b, the next letter, when a joins on into b: a's joining stroke
// runs on into b's. -> whether they were joined. (They meet without a pen lift, so
// neither end pools ink there.)
export function joinLetters(a, b, rng, r) {
    if (!canJoin(a.g, b.g)) return false;

    const out = a.g.strokes[0];
    const into = b.g.strokes[0];
    const E = exitOf(a);
    enterHigh(b, into, E.p.y);
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
    if (S.corner) return;

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
