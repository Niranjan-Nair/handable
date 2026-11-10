// Indents and lists, as in Google Docs. A paragraph's lead is the spaces and tabs it
// starts with (each tab indents the whole paragraph by 4 spaces, spaces only its first
// line), then, for a list item, its marker (see the engine's text/lists.js) and the
// spaces after it. Everything here works on the text alone and returns changes
// (see change.js).
import * as HW from '../../engine/index.js';
import { replaceChange } from './change.js';
import { mathAround } from './markup.js';

const isBlank = (c) => c === ' ' || c === '\t';

// The lead of the paragraph position k is in: { a (the paragraph's start), b (where
// its text starts), ws (its indent), bullet: { ul: marker } or { ol } or null }.
export function leadOf(t, k) {
    const a = Math.max(t.lastIndexOf('\n', k - 1), t.lastIndexOf('\f', k - 1)) + 1;
    let b = a;
    while (isBlank(t[b])) b++;
    const ws = t.slice(a, b);
    const m = HW.listMarkerAt(t, b);
    let bullet = null;

    if (m) {
        bullet = m.ol ? { ol: m.ol } : { ul: m.ch };
        b += m.len;
        while (isBlank(t[b])) b++;
    }

    return { a, b, ws, bullet };
}

// A list item's marker as written in the text, for spec { ul } or { ol } (next: for
// the item after it, which counts on from it rather than starting again).
export function markerText(spec, next) {
    if (spec.ul != null) {
        if ('-•+>'.includes(spec.ul) && spec.ul.length === 1) return spec.ul + ' ';

        return `<ul ${spec.ul.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}> `;
    }

    const o = spec.ol;

    return `<ol ${o.pre}${o.kind}${o.post}${o.start != null && !next ? ' ' + o.start : ''}> `;
}

// The default hierarchy of nested numbered lists, as in Google Docs: 1. a. i. (then
// round again), one step per level. Numbers you picked that aren't in it (A, I) stay
// as they are at every level, and so do bullets.
const KINDS = ['1', 'a', 'i'];
const levelOf = (ws) => (ws.match(/\t/g) || []).length;

// spec moved dir levels in (+) or out (-) of where it is
function stepSpec(spec, dir) {
    if (spec.ul != null) return spec;

    const i = KINDS.indexOf(spec.ol.kind);
    const kind = i < 0 ? spec.ol.kind : KINDS[(((i + dir) % 3) + 3) % 3];

    return { ol: { ...spec.ol, kind, start: dir ? null : spec.ol.start } };
}

// A list item's lead, nested one level further in (dir 1) or out (-1); out from the
// top level, it isn't a list item any more.
function nestLead(L, dir) {
    const spec = L.bullet.ol ? { ol: L.bullet.ol } : { ul: L.bullet.ul };
    if (dir > 0) return '\t' + L.ws + markerText(stepSpec(spec, 1));
    if (!L.ws.includes('\t')) return L.ws;

    return L.ws.replace('\t', '') + markerText(stepSpec(spec, -1));
}

// the start of every paragraph from a to b
export function parasIn(t, a, b) {
    const out = [];
    let k = leadOf(t, a).a;

    for (;;) {
        out.push(k);
        const n = t.slice(k).search(/[\n\f]/);
        if (n < 0 || k + n + 1 > b || (k + n + 1 === b && b > a)) break;

        k += n + 1;
    }

    return out;
}

// Gives each of the paragraphs starting at starts a new lead: fn(lead) -> the new
// lead's text (or null to leave it). The selection a … b stays on the same text.
export function withLeads(t, a, b, starts, fn) {
    const edits = [];

    for (const k of starts) {
        const L = leadOf(t, k);
        const lead = fn(L);
        if (lead != null && lead !== t.slice(L.a, L.b)) edits.push({ a: L.a, b: L.b, s: lead });
    }

    if (!edits.length) return {};

    let out = '';
    let from = 0;

    for (const e of edits) {
        out += t.slice(from, e.a) + e.s;
        from = e.b;
    }

    out += t.slice(from);

    // where a position ends up: inside a lead, at the end of the new one
    const map = (pos) => {
        let off = 0;

        for (const e of edits) {
            if (pos >= e.b) off += e.s.length - (e.b - e.a);
            else if (pos > e.a) return e.a + off + e.s.length;
            else break;
        }

        return pos + off;
    };

    return replaceChange(t, out, map(a), map(b));
}

// Turns the paragraphs of a … b into list items of kind spec ({ ul } or { ol }),
// keeping an item's own start number when only its kind changes, or takes them out
// of lists (spec null). byLevel: each paragraph gets its own level's marker,
// counting from spec at the top.
export function setList(t, a, b, spec, byLevel) {
    return withLeads(t, a, b, parasIn(t, a, b), (L) => {
        if (!spec) return L.bullet ? L.ws : null;
        if (byLevel) return L.ws + markerText(stepSpec(spec, levelOf(L.ws)));

        const own =
            L.bullet && L.bullet.ol && spec.ol
                ? { ol: { ...spec.ol, start: spec.ol.start != null ? spec.ol.start : L.bullet.ol.start } }
                : spec;

        return L.ws + markerText(own);
    });
}

// are all the paragraphs of a … b list items of this type ('ul' or 'ol')?
export const allListed = (t, a, b, type) =>
    parasIn(t, a, b).every((k) => {
        const L = leadOf(t, k);

        return L.bullet && (type === 'ol' ? !!L.bullet.ol : L.bullet.ul != null);
    });

// the item at the selection a … b numbered from start (null: counting on from the item
// before); ol: the numbering, if it isn't a numbered item yet
export function setStart(t, a, b, ol, start) {
    const k = parasIn(t, a, a)[0];

    return withLeads(t, a, b, [k], (L) => L.ws + markerText({ ol: { ...((L.bullet && L.bullet.ol) || ol), start } }));
}

// Tab, Backspace and Enter in a paragraph's lead. Tab at the start of a paragraph
// indents its first line, then (pressed again) the whole paragraph by one more step;
// Backspace there undoes the first-line indent, then the whole indent. Tab anywhere
// else is a wide gap, and with several paragraphs selected moves them all a step.
// Enter carries the indent (and list) on to the new paragraph. In a list item:
// Backspace takes the marker off, Enter on an empty item ends the list (or comes out
// a level), Tab nests it one deeper and Shift+Tab brings it back out.
// -> a change, or null when the key should do what it normally does
export function leadKey(t, a, b, key, shift) {
    const sel = a !== b;
    const L = leadOf(t, a);
    const atStart = !sel && a === L.b && !mathAround(t, a);
    const setLead = (ws) => replaceChange(t, t.slice(0, L.a) + ws + t.slice(L.b), L.a + ws.length);

    if (L.bullet && atStart) {
        const n = t.slice(L.b).search(/[\n\f]/);
        const empty = (n < 0 ? t.length : L.b + n) === L.b;
        if (key === 'Backspace') return setLead(L.ws);
        if (key === 'Enter' && !shift && empty) return setLead(L.ws.includes('\t') ? nestLead(L, -1) : '');
        if (key === 'Tab') return setLead(nestLead(L, shift ? -1 : 1));
    }

    if (key === 'Enter' && L.bullet && !sel && !shift && !mathAround(t, a))
        return { a, b: a, str: '\n' + L.ws + markerText(L.bullet, true) };

    if (key === 'Backspace') {
        if (!atStart || !L.ws) return null;

        return setLead(/ /.test(L.ws) ? L.ws.replace(/ /g, '') : '');
    }

    if (key === 'Enter') {
        if (sel || shift || !L.ws || mathAround(t, a)) return null;

        return { a, b: a, str: '\n' + L.ws }; // a new paragraph after this one, with the same indent
    }

    // Tab
    if (!t.slice(a, b).includes('\n') && !atStart) return { a, b, str: '\t' };

    if (atStart) {
        if (!shift) return setLead(/ /.test(L.ws) ? '\t' + L.ws : L.ws + '    ');

        return setLead(/\t/.test(L.ws) ? L.ws.replace('\t', '') : '');
    }

    // several paragraphs: the whole of each one moves in or out a step (list items
    // taking the marker of their new level)
    return withLeads(t, a, b, parasIn(t, a, b), (P) => {
        if (P.bullet) return nestLead(P, shift ? -1 : 1);
        if (!shift) return '\t' + P.ws;

        return P.ws.includes('\t') ? P.ws.replace('\t', '') : ''; // a tab off (or, with none, the first-line indent)
    });
}

const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

// What "1." "a)" "(iv)" and the like are as a list number: { kind, n }, or null.
function listNumberOf(v) {
    if (/^\d+$/.test(v)) return { kind: '1', n: +v };

    if (/^[ivxlcdm]+$/i.test(v) && (v.length > 1 || /^[iI]$/.test(v))) {
        const ds = [...v.toLowerCase()].map((c) => ROMAN[c]);
        const n = ds.reduce((t, d, j) => t + (d < (ds[j + 1] || 0) ? -d : d), 0);
        if (HW.listNumber(n, 'i') !== v.toLowerCase()) return null; // not a real roman numeral

        return { kind: v === v.toLowerCase() ? 'i' : 'I', n };
    }

    if (v.length === 1) return { kind: v === v.toLowerCase() ? 'a' : 'A', n: v.toLowerCase().charCodeAt(0) - 96 };

    return null;
}

// Space typed at position a, as in Google Docs: "- ", "+ " or "* " (which becomes •)
// at the start of a paragraph makes it a list item, and so do "1. " "a) " "(iv) " and
// the like (counting on from that number). -> { change, ol (the numbering, for a
// numbered list) }, or null
export function listAutoformat(t, a) {
    const L = leadOf(t, a);
    if (mathAround(t, a) || L.bullet) return null;

    const typed = t.slice(L.a, a);
    if (/^[ \t]*\*$/.test(typed)) return { change: { a: a - 1, b: a, str: '• ' } };

    const m = /^([ \t]*)(\(?)(\d{1,6}|[a-zA-Z]|[ivxlcdm]+|[IVXLCDM]+)([.)])$/.exec(typed);
    if (!m || (m[2] && m[4] !== ')')) return null;

    const num = listNumberOf(m[3]);
    if (!num) return null;

    const ol = { pre: m[2], kind: num.kind, post: m[4], start: num.n === 1 ? null : num.n };

    return { change: { a: L.a + m[1].length, b: a, str: markerText({ ol }) }, ol };
}
