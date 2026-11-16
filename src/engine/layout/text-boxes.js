// Text boxes: texts written besides the main one, each with its own size and width,
// and put on a page wherever it was placed. Each box is written on its own (its own
// seed, so the same words look different from the main text's), then its glyphs are
// moved onto the page.
import { breakLines } from './lines.js';
import { layOutPages } from './pages.js';
import { emptyPage, placeLines } from './place.js';
import { wordCacheFor } from './word-cache.js';
import { createWriter } from './writer.js';
import { numberLists } from '../text/lists.js';
import { parseRich } from '../text/rich.js';
import { clamp } from '../util.js';

// One text laid out: its writer (and what it noticed), lines, pages and placed glyphs.
// pg: the page geometry, or null to write to the width o.maxWidth.
export function layOutText(model, text, o, pg) {
    const writer = createWriter(model, o);
    const cache = wordCacheFor(model, o);
    const maxW = Math.max(1, (pg ? pg.W - pg.left - pg.right : o.maxWidth) / o.size);
    const paras = numberLists(parseRich(text, !!o.plain, o.rawAt == null ? -1 : o.rawAt));
    const lines = breakLines(writer, paras, String(text), maxW, cache);
    const nPages = layOutPages(writer, lines, pg);
    const placed = placeLines(writer, lines, { pg, maxW, nPages });

    return { writer, lines, nPages, placed };
}

// the height of laid-out lines, in px (from the top of the first line)
export function textHeight(lines, size) {
    const last = lines[lines.length - 1];

    return (last.baseline + Math.max(0.6, last.bot + 0.15)) * size;
}

// A box ({ id, text, x, y (its top left, px), w (px), size, page, rawAt }), written:
// { id, page, x, y, w, h, out (see layOutText) }. onPaper: false puts it on the one page.
export function writeTextBox(model, o, box, onPaper) {
    const size = clamp(+box.size || o.size, 4, 400);

    const bo = {
        ...o,
        size,
        maxWidth: Math.max(size, +box.w || 300),
        margin: 0,
        paper: 'none',
        boxes: null,
        rawAt: box.rawAt == null ? -1 : box.rawAt,
        seed: o.seed == null ? null : o.seed + '|box|' + box.id,
    };

    const out = layOutText(model, String(box.text || ''), bo, null);

    return {
        id: box.id,
        page: onPaper ? Math.max(0, Math.floor(+box.page || 0)) : 0,
        x: +box.x || 0,
        y: +box.y || 0,
        w: bo.maxWidth,
        h: textHeight(out.lines, size),
        out,
    };
}

// Put written box k on its page in placed (from placeLines), and its caret places
// (moved to the page) in cmaps[box id].
export function putOnPage(placed, box, k, cmaps) {
    while (placed.pages.length <= box.page) placed.pages.push(emptyPage());

    const P = placed.pages[box.page];
    const { x: dx, y: dy } = box;
    // its lines are lines of their own on the page (an editor draws each line as a strip)
    const tag = 'b' + k + ':';
    const move = (p) => ({ ...p, x: p.x + dx, y: p.y + dy });

    for (const Q of box.out.placed.pages) {
        for (const g of Q.placed)
            P.placed.push({
                ...g,
                strokes: g.strokes.map((s) => s.map(move)),
                ox: g.ox + dx,
                oy: g.oy + dy,
                key: tag + g.key,
                line: tag + g.line,
            });

        for (const e of Q.inkEnds) P.inkEnds.push({ ...move(e), line: tag + e.line });

        Q.hls.forEach((h, j) => {
            P.hls.push(`<g transform="translate(${dx} ${dy})">${h}</g>`);
            P.hlLines.push(tag + Q.hlLines[j]);
        });
    }

    const ink = box.out.placed.ink;

    if (ink.minX <= ink.maxX) {
        placed.ink.minX = Math.min(placed.ink.minX, ink.minX + dx);
        placed.ink.maxX = Math.max(placed.ink.maxX, ink.maxX + dx);
        placed.ink.minY = Math.min(placed.ink.minY, ink.minY + dy);
        placed.ink.maxY = Math.max(placed.ink.maxY, ink.maxY + dy);
    }

    const cm = box.out.placed.cmap;

    cmaps[box.id] = {
        lines: cm.lines.map((L) => ({ ...L, page: box.page, x: L.x + dx, y: L.y + dy })),
        chars: cm.chars.map((c) => ({ ...c, page: box.page, x0: c.x0 + dx, x1: c.x1 + dx, y: c.y + dy })),
        size: box.out.writer.o.size,
    };
}
