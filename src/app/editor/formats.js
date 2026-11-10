// Formats (superscript, subscript, underline, strikethrough, box, highlighter) as
// data. The text is read as a list of atoms (a character, an equation, an escaped \$),
// each with the stack of formats it's inside (outermost first): { k: 'sup' | 'sub' |
// 'u' | 's' | 'box' | 'mark', v } (v: the highlighter color, or which box). Turning a
// format on or off changes the atoms' stacks, and the text is written back out with
// as few tags as possible.
import { replaceChange } from './change.js';
import { leadOf } from './leads.js';
import { cpAt, mathAround, mathRanges, mathTouching, tagAt } from './markup.js';

export const HIGHLIGHT_COLORS = ['yellow', 'pink', 'orange', 'green', 'blue'];

const KIND = { del: 's', strike: 's' };

// The atoms of t: [{ t (its text), stack, a, b (where it is), math, lead }], and the
// stack of formats open at position upto. A paragraph's indent and list marker (lead)
// stay outside any format: a <u> before a marker would stop it being a list.
export function atomize(t, upto = -1) {
    const atoms = [];
    const ms = mathRanges(t);
    // the leads (with the paragraph break before each, so a format closes before the break)
    const leads = [];

    for (let p = 0; p <= t.length;) {
        const L = leadOf(t, p);
        if (L.b > p) leads.push([p > 0 ? p - 1 : p, L.b]);
        const n = t.slice(p).search(/[\n\f]/);
        if (n < 0) break;

        p += n + 1;
    }

    const inLead = (i) => leads.some(([x, y]) => i >= x && i < y);
    let stack = [];
    let boxSeq = 0;
    let mi = 0;
    let at = null;

    for (let i = 0; i <= t.length;) {
        if (i === upto) at = stack;
        if (i >= t.length) break;

        const m = t[i] === '<' && tagAt(t, i);

        if (m) {
            const k = KIND[m.name] || m.name;

            if (m.closing) {
                const j = stack.map((x) => x.k).lastIndexOf(k);
                if (j >= 0) stack = stack.slice(0, j).concat(stack.slice(j + 1));
            } else {
                const v = k === 'mark' ? (m.color || 'yellow').toLowerCase() : k === 'box' ? 'b' + ++boxSeq : '';
                stack = stack.concat({ k, v });
            }

            i = m.end;
            continue;
        }

        while (mi < ms.length && ms[mi].b <= i) mi++;
        const M = ms[mi] && ms[mi].a === i ? ms[mi] : null;
        const n = M ? M.b - M.a : t[i] === '\\' && t[i + 1] === '$' ? 2 : cpAt(t, i);
        const lead = inLead(i);
        atoms.push({ t: t.slice(i, i + n), stack: lead ? [] : stack, a: i, b: i + n, math: !!M, lead });
        i += n;
    }

    return { atoms, at: at || stack };
}

const same = (x, y) => x.k === y.k && x.v === y.v;
const openTag = (x) => (x.k === 'mark' ? `<mark ${x.v}>` : `<${x.k}>`);
const closeTag = (x) => `</${x.k}>`;

// the atoms written back out as text; each atom gets na … nb, where it is in it
export function serialize(atoms) {
    let out = '';
    let open = [];

    for (const A of atoms) {
        const N = A.stack;
        let c = 0;
        while (c < open.length && c < N.length && same(open[c], N[c])) c++;
        for (let j = open.length - 1; j >= c; j--) out += closeTag(open[j]);
        open = open.slice(0, c);

        for (let j = c; j < N.length; j++) {
            out += openTag(N[j]);
            open.push(N[j]);
        }

        A.na = out.length;
        out += A.t;
        A.nb = out.length;
    }

    for (let j = open.length - 1; j >= 0; j--) out += closeTag(open[j]);

    return out;
}

// does a stack carry format k? (a highlighter only counts in the same color, unless
// color is null: any color)
const hasFmt = (stack, k, color) => stack.some((x) => x.k === k && (k !== 'mark' || color == null || x.v === color));

// The formats of the selection a … b (every letter in it has them), or of the caret:
// { sup, sub, u, s, box, mark, color (the highlighter's), math (in an equation) }
export function activeFormats(t, a, b) {
    const math = !!mathTouching(t, a, b);
    let stacks;

    if (a === b) stacks = [atomize(t, a).at];
    else {
        const sel = atomize(t).atoms.filter((A) => A.a >= a && A.b <= b && !A.lead);
        const visible = sel.filter((A) => /\S/.test(A.t));
        stacks = (visible.length ? visible : sel).map((A) => A.stack);
    }

    const all = (k) => stacks.length > 0 && stacks.every((st) => hasFmt(st, k));
    const marks = HIGHLIGHT_COLORS.filter((c) => stacks.length && stacks.every((st) => hasFmt(st, 'mark', c)));

    return {
        sup: all('sup'),
        sub: all('sub'),
        u: all('u'),
        s: all('s'),
        box: all('box'),
        mark: all('mark'),
        color: marks[0] || null,
        math,
    };
}

let boxSeq = 0; // new boxes get their own ids, so two boxes side by side stay two

// Turns format k on or off for the selection a … b (color: for the highlighter; off:
// force it off). At the caret, it's what's typed next that is (or isn't) in the
// format. -> a change, or null
export function toggleFormat(t, a, b, k, color, off) {
    if (k === 'math') return toggleMath(t, a, b);
    if (mathAround(t, a) || (a !== b && mathAround(t, b))) return null; // inside an equation, TeX does the formatting
    const act = activeFormats(t, a, b);
    const on = off ? false : k === 'mark' ? !(act.mark && (color == null || act.color === color)) : !act[k];
    const token = { k, v: k === 'mark' ? color || 'yellow' : k === 'box' ? 'n' + ++boxSeq : '' };
    if (a === b) return on ? formatOnAtCaret(t, a, token) : formatOffAtCaret(t, a, k);

    const { atoms } = atomize(t);
    const sel = atoms.filter((A) => A.a >= a && A.b <= b && !A.lead);
    if (!sel.length) return null;

    for (const A of sel) A.stack = restack(A.stack, token, on);
    const t2 = serialize(atoms);

    return replaceChange(t, t2, sel[0].na, sel[sel.length - 1].nb);
}

// an atom's formats with token's format turned on or off
function restack(st, token, on) {
    const k = token.k;
    let s2 = st;
    if (k === 'mark')
        s2 = s2.filter((x) => x.k !== 'mark'); // one highlighter color at a time
    else if (!on || k !== 'box') s2 = s2.filter((x) => x.k !== k);
    if (on && (k === 'sup' || k === 'sub')) s2 = s2.filter((x) => x.k !== 'sup' && x.k !== 'sub'); // one or the other
    if (on && !(k === 'box' && hasFmt(st, 'box'))) s2 = s2.concat(token);

    return s2;
}

// an empty format opened at the caret, for what's typed next
function formatOnAtCaret(t, a, token) {
    const st = atomize(t, a).at;
    const k = token.k;

    if ((k === 'sup' || k === 'sub') && (hasFmt(st, 'sup') || hasFmt(st, 'sub'))) {
        // swap superscript for subscript (or back): close the other, open this
        const j = st.findIndex((x) => x.k === 'sup' || x.k === 'sub');
        const above = st.slice(j);
        const ins = above.slice().reverse().map(closeTag).join('') + openTag(token);
        const after = closeTag(token) + above.map(openTag).join('');

        return replaceChange(t, t.slice(0, a) + ins + after + t.slice(a), a + ins.length);
    }

    const ins = openTag(token);

    return replaceChange(t, t.slice(0, a) + ins + closeTag(token) + t.slice(a), a + ins.length);
}

// format k closed at the caret (and the formats inside it, opened again after it)
function formatOffAtCaret(t, a, k) {
    const st = atomize(t, a).at;
    const j = st.map((x) => x.k).lastIndexOf(k);
    if (j < 0) return null;

    const inner = st.slice(j + 1);
    const before = st.slice(j).reverse().map(closeTag).join('') + inner.map(openTag).join('');
    const after = inner.slice().reverse().map(closeTag).join('') + st.slice(j).map(openTag).join('');
    let t2 = t.slice(0, a) + before + after + t.slice(a);
    let caret = a + before.length;
    // drop formats left empty, except one the caret is in
    const re = /<(sup|sub|u|s|box|mark)\b[^<>]*><\/\1>/g;

    for (let m = re.exec(t2); m; m = re.exec(t2)) {
        const s0 = m.index;
        const s1 = s0 + m[0].length;
        if (caret > s0 && caret < s1) continue;

        t2 = t2.slice(0, s0) + t2.slice(s1);
        if (caret >= s1) caret -= s1 - s0;
        re.lastIndex = 0;
    }

    return replaceChange(t, t2, caret);
}

// The equation button: puts the selection in an equation, or takes an equation out
// of one. It writes \(…\), which can't be mistaken for anything else: an empty $$
// would open a centered equation, and a $ can pair up with another equation's $.
export function toggleMath(t, a, b) {
    const m = mathTouching(t, a, b);

    if (m) {
        const inner = t.slice(m.a + m.open, m.b - m.open);

        return replaceChange(t, t.slice(0, m.a) + inner + t.slice(m.b), m.a, m.a + inner.length);
    }

    // (after a lone backslash, \( would be an escaped \ and a bracket: a space first)
    let run = 0;
    while (t[a - 1 - run] === '\\') run++;
    const pre = (run % 2 ? ' ' : '') + '\\(';

    return replaceChange(
        t,
        t.slice(0, a) + pre + t.slice(a, b) + '\\)' + t.slice(b),
        a + pre.length,
        a + pre.length + (b - a),
    );
}
