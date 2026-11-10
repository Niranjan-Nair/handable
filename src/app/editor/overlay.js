// What the editor draws over the written page: the caret, the selection, the box
// around an equation being edited, and a pale hint on an empty page.
import * as HW from '../../engine/index.js';
import { $, $$ } from '../dom.js';
import { data, getModel, settings } from '../store.js';
import { caretAt } from './caret.js';

const sheets = () => $$('#g-preview .sheet');

// The hint on an empty page, in your own handwriting: written once per look and reused.
let hintCache = null;

function hint(size) {
    const g = settings.gen;

    const key = [
        size,
        g.seed,
        g.pen,
        g.penWidth,
        g.slantOn,
        g.slant,
        g.randomness,
        g.smoothness,
        g.formality,
        g.letterSpacing,
        g.wordSpacing,
        data.samples.length,
    ].join('|');

    if (hintCache && hintCache.key === key) return hintCache.v;

    let v = null;

    try {
        // its own seed, so its SVG ids never clash with the page's
        const res = HW.generate(getModel(), 'Click here and start writing', {
            ...g,
            slant: g.slantOn ? g.slant : null,
            seed: g.seed + '|hint',
            paper: 'none',
            color: '#8f8e89',
            penWidth: (+g.penWidth || 0.055) * 1.35,
            size,
            maxWidth: 1e5,
            rawAt: null,
        });

        const L = res.caretMap && res.caretMap.lines[0];
        if (L) v = { svg: res.svg, w: res.width, h: res.height, x: L.x, y: L.y };
    } catch {
        v = null;
    }

    hintCache = { key, v };

    return v;
}

// One layer per sheet, over it (tilted like the scan): box(page, class, x0, y0, x1, y1)
// adds a box to it, in page px.
function makeLayers(res) {
    const M = res.caretMap;

    for (const sh of sheets()) {
        const old = sh.querySelector('.ed-layer');
        if (old) old.remove();
    }

    const layers = sheets().map((sh, i) => {
        const L = document.createElement('div');
        L.className = 'ed-layer';
        const skew = M.skews[i] || 0;
        if (skew) L.style.transform = `rotate(${skew}deg)`;
        sh.appendChild(L);

        return L;
    });

    return (page, cls, x0, y0, x1, y1) => {
        const L = layers[page];
        if (!L) return null;

        const d = document.createElement('div');
        d.className = cls;
        d.style.left = (x0 / res.width) * 100 + '%';
        d.style.top = (y0 / res.height) * 100 + '%';
        d.style.width = (Math.max(0, x1 - x0) / res.width) * 100 + '%';
        d.style.height = (Math.max(0, y1 - y0) / res.height) * 100 + '%';
        L.appendChild(d);

        return d;
    };
}

// the characters in a … b, as one extent per line: { page, line, x0, x1, y (lowest baseline) }
function extentsByLine(M, a, b) {
    const byLine = new Map();

    for (const c of M.chars) {
        if (c.s < a || c.e > b) continue;

        const r = byLine.get(c.line) || { page: c.page, line: c.line, x0: Infinity, x1: -Infinity, y: c.y };
        r.x0 = Math.min(r.x0, c.x0);
        r.x1 = Math.max(r.x1, c.x1);
        r.y = Math.max(r.y, c.y);
        byLine.set(c.line, r);
    }

    return byLine.values();
}

// ta: the editor's text field; raw: the equation being edited, or null
export function drawOverlay(res, ta, raw) {
    const M = res && res.caretMap;

    if (!M) {
        for (const sh of sheets()) sh.querySelector('.ed-layer')?.remove();

        return;
    }

    const box = makeLayers(res);
    const asc = (sc) => (M.asc + 0.08) * M.size * sc;
    const desc = (sc) => 0.26 * M.size * sc;
    const focused = document.activeElement === ta;

    // nothing written yet: a pale hint in your own handwriting, sitting on the first line
    // exactly where the first letter will go
    if (!ta.value && M.lines[0] && !focused) {
        const L0 = M.lines[0];
        const h = hint(M.size);
        const el = h && box(L0.page, 'ed-hint', L0.x - h.x, L0.y - h.y, L0.x - h.x + h.w, L0.y - h.y + h.h);
        if (el) el.innerHTML = h.svg;
    }

    if (!focused) return;

    if (raw) {
        const pad = 0.08 * M.size;
        for (const r of extentsByLine(M, raw.a, raw.b))
            box(r.page, 'ed-math', r.x0 - pad, r.y - asc(1) - pad * 0.5, r.x1 + pad, r.y + desc(1) + pad * 0.5);
    }

    const a = ta.selectionStart;
    const b = ta.selectionEnd;

    if (a !== b) {
        for (const r of extentsByLine(M, a, b)) {
            const y = M.lines[r.line].y;
            box(r.page, 'ed-sel', r.x0, y - asc(1), r.x1, y + desc(1));
        }
    }

    const p = caretAt(M, ta.value, ta.selectionDirection === 'backward' ? a : b);
    if (!p) return;

    const caret = box(p.page, 'ed-caret', p.x, p.y - asc(p.sc), p.x, p.y + desc(p.sc));

    if (caret) {
        caret.style.width = '';
        followCaret(ta, caret);
    }
}

// keep the hidden field (and the IME's window) at the caret, and the caret in view
function followCaret(ta, caret) {
    const wrap = ta.closest('.page-editor');
    const wr = wrap.getBoundingClientRect();
    const cr = caret.getBoundingClientRect();
    ta.style.left = cr.left - wr.left + 'px';
    ta.style.top = cr.top - wr.top + 'px';
    // the preview scrolls on its own: keep the caret inside it (and it inside the window)
    const pv = $('#g-preview');
    const vr = pv.getBoundingClientRect();
    const top = Math.max(0, vr.top);
    const bot = Math.min(window.innerHeight, vr.bottom);
    if (cr.left < vr.left || cr.right > vr.right) caret.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    // vertically, with room to spare: what comes next (a new page's lines) shows too
    const room = Math.min(180, (bot - top) / 3);
    if (cr.bottom > bot) pv.scrollTop += cr.bottom - bot + room;
    else if (cr.top < top) pv.scrollTop -= top - cr.top + room;
}
