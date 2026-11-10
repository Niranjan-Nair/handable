// Finding things on the written page, from the caret map generate() returns
// (M = res.caretMap: lines and characters with their source ranges, in page px).
import { mathRanges, onlyTags } from './markup.js';

// how far a caret sits clear of the letter next to it
const nudge = (M, c) => 0.05 * M.size * c.sc;

// caret position k -> { page, line, x, y, sc }, or null
export function caretAt(M, t, k) {
    const C = M.chars;

    for (const c of C) {
        if (c.math ? k === c.s : k >= c.s && k < c.e) {
            const x = c.x0 - nudge(M, c) + (c.math ? 0 : ((c.x1 - c.x0) * (k - c.s)) / (c.e - c.s));

            return { page: c.page, line: c.line, x, y: c.y, sc: c.sc };
        }
    }

    let prev = null;
    let next = null;

    for (const c of C) {
        if (c.e <= k && (!prev || c.e >= prev.e)) prev = c;
        if (c.s >= k && (!next || c.s < next.s)) next = c;
    }

    if (next && onlyTags(t, k, next.s))
        return { page: next.page, line: next.line, x: next.x0 - nudge(M, next), y: next.y, sc: next.sc };

    if (prev && !/[\n\f]/.test(t.slice(prev.e, k))) {
        const spaces = (
            t
                .slice(prev.e, k)
                .replace(/<[^<>]*>/g, '')
                .match(/[ \t]/g) || []
        ).length;

        return {
            page: prev.page,
            line: prev.line,
            x: prev.x1 + nudge(M, prev) + spaces * 0.3 * M.size,
            y: prev.y,
            sc: prev.sc,
        };
    }

    // an empty line, or the start of a paragraph
    let li = M.lines.findIndex((L) => k >= L.si && k <= L.se);
    if (li < 0) li = k <= 0 ? 0 : M.lines.length - 1;
    const L = M.lines[li];

    return L ? { page: L.page, line: li, x: L.x, y: L.y, sc: 1 } : null;
}

export const charsOn = (M, li) => M.chars.filter((c) => c.line === li);

// a point on line li -> caret position (enterMath: a click inside an equation goes into it)
export function posOnLine(M, t, li, x, enterMath) {
    const cs = charsOn(M, li);
    if (!cs.length) return M.lines[li].si;

    let best = cs[0];
    let bd = Infinity;

    for (const c of cs) {
        const d = x < c.x0 ? c.x0 - x : x > c.x1 ? x - c.x1 : 0;

        if (d < bd) {
            bd = d;
            best = c;
        }
    }

    if (best.math) {
        if (enterMath && bd === 0) {
            const m = mathRanges(t).find((r) => r.a === best.s);

            return m ? m.b - m.open : best.e;
        }

        return x < (best.x0 + best.x1) / 2 ? best.s : best.e;
    }

    const n = best.e - best.s;
    const f = (x - best.x0) / Math.max(1e-6, best.x1 - best.x0);

    return best.s + Math.round(Math.max(0, Math.min(1, f)) * n);
}

// a point on a page -> caret position
export function posAt(M, t, page, x, y, enterMath) {
    if (!M.lines.length) return t.length;

    let li = -1;
    let bd = Infinity;

    M.lines.forEach((L, i) => {
        if (L.page !== page) return;

        const top = L.y - (M.asc + 0.1) * M.size;
        const bot = L.y + M.desc * M.size;
        const d = y < top ? top - y : y > bot ? y - bot : 0;

        if (d < bd || (d === bd && Math.abs(y - L.y) < Math.abs(y - M.lines[li].y))) {
            bd = d;
            li = i;
        }
    });

    if (li < 0) return t.length;

    return posOnLine(M, t, li, x, enterMath);
}

// the next line up (dir -1) or down (1) from caret p the caret can actually be on, at
// x (an equation's lines all lead to its ends, so lines that would leave the caret
// where it is are passed over) -> a caret position
export function lineStep(M, t, p, x, dir) {
    for (let li = p.line + dir; li >= 0 && li < M.lines.length; li += dir) {
        const pos = posOnLine(M, t, li, x, false);
        const q = caretAt(M, t, pos);
        if (q && q.line !== p.line) return pos;
    }

    return dir < 0 ? 0 : t.length;
}
