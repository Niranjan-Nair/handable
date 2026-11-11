// Letters written as other letters plus a little more, the way a hand writes them:
// accented letters (é, ñ, ş, ǖ, ệ …) are your own e, n, s, u with the accent put
// above or below; ø ł đ ħ get a stroke drawn through; æ œ are two letters run
// together; ¿ ¡ are ? ! upside down, and „ ‚ are ” ’ dropped to the baseline.
import { bbox } from '../geometry.js';
import { STEP } from '../options.js';
import { finishGlyph, finishStrokes } from './finish.js';

// combining marks -> the accent written for them, and where it goes
const MARKS = {
    '̀': ['`', 'above'], // grave
    '́': ['´', 'above'], // acute
    '̂': ['ˆ', 'above'], // circumflex
    '̃': ['˜', 'above'], // tilde
    '̄': ['¯', 'above'], // macron
    '̆': ['˘', 'above'], // breve
    '̇': ['˙', 'above'], // dot
    '̈': ['¨', 'above'], // diaeresis
    '̊': ['˚', 'above'], // ring
    '̋': ['˝', 'above'], // double acute
    '̌': ['ˇ', 'above'], // caron
    '̛': [null, 'horn'], // ơ ư
    '̣': ['˙', 'below'], // dot below
    '̦': [',', 'below'], // comma below (ș ț)
    '̧': ['¸', 'cedilla'],
    '̨': ['˛', 'ogonek'],
    '̱': ['¯', 'below'], // macron below
};

// letters that don't come apart into a letter and marks
const SPECIAL = {
    ı: { base: 'i', dotless: true },
    ȷ: { base: 'j', dotless: true },
    ø: { base: 'o', slash: true },
    Ø: { base: 'O', slash: true },
    ł: { base: 'l', bar: 0.5, tilt: 0.1 },
    Ł: { base: 'L', bar: 0.45, tilt: 0.1 },
    đ: { base: 'd', bar: 0.78 },
    ħ: { base: 'h', bar: 0.78 },
    ŧ: { base: 't', bar: 0.35 },
    Đ: { base: 'D', bar: 0.5, left: true },
    Ð: { base: 'D', bar: 0.5, left: true },
    Ħ: { base: 'H', bar: 0.76 },
    Ŧ: { base: 'T', bar: 0.5 },
    æ: { pair: 'ae', overlap: 0.04 },
    Æ: { pair: 'AE', overlap: 0.14 },
    œ: { pair: 'oe', overlap: 0.04 },
    Œ: { pair: 'OE', overlap: 0.1 },
    ĳ: { pair: 'ij', overlap: -0.04 },
    Ĳ: { pair: 'IJ', overlap: -0.06 },
    '¿': { base: '?', turn: true },
    '¡': { base: '!', turn: true },
    '„': { base: '”', low: true },
    '‚': { base: '’', low: true },
};

// a ď ť ľ Ľ caron is written like an apostrophe, after the letter
const CARON_AFTER = 'dtlL';
// a cedilla under these is written as a comma (ķ ļ ņ ŗ), and over g as a turned one (ģ)
const CEDILLA_AS_COMMA = 'kKlLnNrRgG';

// letters with a dot, which an accent above replaces
const DOTTED = 'ijіј';

const GAP = 0.07; // between a letter and an accent

// What ch is made of: { base, marks: [[accent, where], …] }, { special }, or null.
export function composition(ch) {
    if (SPECIAL[ch]) return { special: SPECIAL[ch] };

    const [base, ...rest] = Array.from(ch.normalize('NFD'));
    if (!rest.length || !rest.every((m) => MARKS[m])) return null;

    const marks = rest.map((m) => {
        if (m === '̌' && CARON_AFTER.includes(base)) return ['’', 'after'];
        if (m === '̧' && CEDILLA_AS_COMMA.includes(base)) return base === 'g' ? ['‘', 'above'] : [',', 'below'];

        return MARKS[m];
    });

    return { base, marks };
}

// Write ch from its parts. pen: { write(ch) -> a glyph or null, rng, o, X (x-height) }.
// -> a glyph, or null when it isn't made of parts (or a part can't be written).
export function composeGlyph(ch, pen) {
    const c = composition(ch);
    if (!c) return null;

    const strokes = c.special ? special(c.special, pen) : accented(c, pen);
    if (!strokes) return null;

    return finishGlyph(ch, strokes.strokes, { inferred: strokes.inferred });
}

function accented({ base, marks }, pen) {
    const g = pen.write(base);
    if (!g) return null;

    let strokes = copy(g.strokes);
    if (DOTTED.includes(base) && marks.some(([, at]) => at === 'above')) strokes = withoutDot(strokes);
    let top = bbox(strokes).minY;

    for (const [accent, at] of marks) {
        if (at === 'horn') {
            strokes.push(drawn(pen, horn(strokes)));
            continue;
        }

        const m = pen.write(accent);
        if (!m) return null;

        const placed = place(m, at, strokes, top);
        strokes.push(...placed);
        if (at === 'above') top = Math.min(top, bbox(placed).minY);
    }

    return { strokes, inferred: g.inferred };
}

// an accent's strokes, moved to its place on the letter (strokes so far); top = the
// highest ink yet, so accents stack
function place(m, at, strokes, top) {
    const bb = bbox(strokes);
    const mb = bbox(m.strokes);
    const mw = mb.maxX - mb.minX;
    const bottom = Math.max(0, bb.maxY);
    let x;
    let y;

    if (at === 'above') {
        x = centerOf(strokes, (p) => p.y < bb.minY + 0.3 * (bb.maxY - bb.minY)) - mw / 2;
        y = top - GAP - mb.maxY;
    } else if (at === 'after') {
        const s = scaled(m.strokes, 0.75);
        const sb = bbox(s);

        return moved(s, inkX(strokes, (p) => p.y < bb.minY + 0.15, Math.max) + 0.06 - sb.minX, bb.minY - sb.minY);
    } else if (at === 'ogonek') {
        x = inkX(strokes, (p) => p.y > bottom - 0.1, Math.max) - 0.6 * mw;
        y = bottom - 0.01 - mb.minY;
    } else {
        x = centerOf(strokes, (p) => p.y > bottom - 0.12) - mw / 2;
        y = (at === 'cedilla' ? bottom - 0.01 : bottom + GAP) - mb.minY;
    }

    return moved(m.strokes, x - mb.minX, y);
}

function special(sp, pen) {
    if (sp.pair) return pair(sp, pen);

    const g = pen.write(sp.base);
    if (!g) return null;

    let strokes = copy(g.strokes);
    const bb = bbox(strokes);

    if (sp.dotless) strokes = withoutDot(strokes);
    else if (sp.turn) strokes = turned(strokes, bb, pen.X);
    else if (sp.low) strokes = moved(strokes, 0, 0.12 - bb.maxY);
    else if (sp.slash)
        strokes.push(
            drawn(pen, [
                [bb.minX - 0.05, bb.maxY + 0.06],
                [bb.maxX + 0.05, bb.minY - 0.06],
            ]),
        );
    else if (sp.bar) strokes.push(drawn(pen, bar(strokes, bb, sp)));

    return { strokes, inferred: g.inferred };
}

// a bar (or a slash, when tilted) through the letter's ink at height bar × its height
function bar(strokes, bb, { bar: f, tilt = 0, left }) {
    const y = f * bb.minY;
    const near = (p) => Math.abs(p.y - y) < 0.05;
    const x0 = inkX(strokes, near, Math.min);
    const x1 = left ? x0 : inkX(strokes, near, Math.max);
    const reach = x1 - x0 < 0.1 ? 0.1 : 0.05;

    return [
        [x0 - (left ? 0.08 : reach), y + tilt],
        [x1 + (left ? 0.16 : reach), y - tilt],
    ];
}

// æ, œ: the second letter written on from the first, touching it
function pair({ pair: [a, b], overlap }, pen) {
    const ga = pen.write(a);
    const gb = pen.write(b);
    if (!ga || !gb) return null;

    const dx = ga.bodyMaxX - overlap - gb.bodyMinX;

    return { strokes: copy(ga.strokes).concat(moved(gb.strokes, dx, 0)), inferred: ga.inferred || gb.inferred };
}

// ¿ ¡: turned over, hanging from the x-height to below the baseline
function turned(strokes, bb, X) {
    const cx = (bb.minX + bb.maxX) / 2;
    const cy = (bb.minY + bb.maxY) / 2;
    const out = strokes.map((s) => s.map((p) => ({ ...p, x: 2 * cx - p.x, y: 2 * cy - p.y })).reverse());

    return moved(out, 0, -1.1 * X - bbox(out).minY);
}

// the hook of ơ ư, off the top of the letter's right side
function horn(strokes) {
    const bb = bbox(strokes);
    const x = inkX(strokes, (p) => p.y < bb.minY + 0.25 * (bb.maxY - bb.minY), Math.max);
    const y = bb.minY + 0.04;

    return [
        [x - 0.02, y + 0.03],
        [x + 0.06, y - 0.01],
        [x + 0.1, y - 0.07],
        [x + 0.11, y - 0.15],
    ];
}

// a stroke drawn by hand along polyline pts, with a little of the writer's wobble
function drawn(pen, pts) {
    const dense = [];

    for (let k = 1; k < pts.length; k++) {
        const [x0, y0] = pts[k - 1];
        const [x1, y1] = pts[k];
        const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / STEP) + 1);
        for (let q = k > 1 ? 1 : 0; q < n; q++)
            dense.push({ x: x0 + ((x1 - x0) * q) / (n - 1), y: y0 + ((y1 - y0) * q) / (n - 1), w: 1 });
    }

    // (finishing moves the stroke a little; it's put back where it was drawn)
    const [s] = finishStrokes([dense], pen.rng, { ...pen.o, randomness: pen.o.randomness * 0.3, shearDelta: 0 }, 0.6);
    const dx = dense[0].x - s[0].x;
    const dy = dense[0].y - s[0].y;

    return s.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
}

// i and j without their dot: the small strokes above the rest
function withoutDot(strokes) {
    if (strokes.length < 2) return strokes;

    const boxes = strokes.map((s) => bbox([s]));
    const small = (b) => Math.hypot(b.maxX - b.minX, b.maxY - b.minY) < 0.15;
    const above = (i) => boxes.every((b, j) => j === i || b.minY > (boxes[i].minY + boxes[i].maxY) / 2);
    const kept = strokes.filter((s, i) => !(small(boxes[i]) && above(i)));

    return kept.length ? kept : strokes;
}

// ------------------------------------------------------------------- helpers
const copy = (strokes) => strokes.map((s) => s.map((p) => ({ ...p })));
const moved = (strokes, dx, dy) => strokes.map((s) => s.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })));

// scaled by k about its top left
function scaled(strokes, k) {
    const bb = bbox(strokes);

    return strokes.map((s) =>
        s.map((p) => ({ ...p, x: bb.minX + k * (p.x - bb.minX), y: bb.minY + k * (p.y - bb.minY) })),
    );
}

// the furthest x (pick = Math.min or Math.max) of the ink where keep(point)
function inkX(strokes, keep, pick) {
    const xs = strokes
        .flat()
        .filter(keep)
        .map((p) => p.x);

    return xs.length ? pick(...xs) : pick(...strokes.flat().map((p) => p.x));
}

// the middle of the ink where keep(point), across
const centerOf = (strokes, keep) => (inkX(strokes, keep, Math.min) + inkX(strokes, keep, Math.max)) / 2;
