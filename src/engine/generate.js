// Text -> handwriting: the text is parsed, written word by word, broken into lines,
// laid out on pages and rendered as SVG.
import { pageGeometry, isBackPage } from './layout/pages.js';
import { layOutText, putOnPage, textHeight, writeTextBox } from './layout/text-boxes.js';
import { DEFAULTS, PAGE_PPI } from './options.js';
import { scanSkew } from './render/paper.js';
import { renderLayers, renderSVG, stackPages } from './render/svg.js';
import { clamp } from './util.js';

// The options in full (see DEFAULTS), with the slant as a change to the learned one.
function resolveOptions(model, userOpts) {
    const o = Object.assign({}, DEFAULTS, userOpts || {});
    o.shearDelta = o.slant != null && o.slant !== '' ? Math.tan((+o.slant * Math.PI) / 180) - model.style.shear : 0;

    return o;
}

// o.boxes: text boxes besides the main text, [{ id, text, x, y (top left, px), w (width,
// px), size, page, rawAt }] (see layout/text-boxes.js)
export function generate(model, text, userOpts) {
    const o = resolveOptions(model, userOpts);
    const pg = pageGeometry(o);
    const { writer, lines, placed } = layOutText(model, text, o, pg);
    const boxes = (o.boxes || []).map((b) => writeTextBox(model, o, b, !!pg));
    const boxMaps = {};
    boxes.forEach((b, k) => putOnPage(placed, b, k, boxMaps));
    const nPages = placed.pages.length;
    const { found } = writer;

    for (const b of boxes)
        for (const kind of Object.keys(found)) for (const v of b.out.writer.found[kind]) found[kind].add(v);

    let width = pg ? pg.W : Math.ceil(Math.max(placed.usedW * o.size + o.margin, 2 * o.margin));
    let height = pg ? pg.H : Math.ceil(textHeight(lines, o.size) + o.margin);

    // without paper the page grows to take in the boxes
    if (!pg)
        for (const b of boxes) {
            width = Math.max(width, Math.ceil(b.x + b.w + o.margin));
            height = Math.max(height, Math.ceil(b.y + b.h + o.margin));
        }

    const out = render(writer, placed.pages, { pg, width, height });
    const skews = placed.pages.map((_, i) => (o.scan && o.paper !== 'none' ? scanSkew(out.grainBase + i * 17) : 0));
    const caretTraits = { asc: model.style.zones.A, desc: 0.3, skews };
    for (const id of Object.keys(boxMaps)) Object.assign(boxMaps[id], caretTraits);

    return {
        svg: out.svg,
        pages: out.pages,
        layers: out.layers,
        nPages,
        width,
        height,
        page: pg && { widthIn: pg.wIn, heightIn: pg.hIn, ppi: PAGE_PPI },
        baselines: lines.map((L) => +(L.baseline * o.size).toFixed(2)), // px, within its page
        missing: Array.from(found.missing),
        inferred: Array.from(found.inferred),
        ligatures: Array.from(found.ligatures),
        lines: lines.length,
        ink: placed.ink.minX <= placed.ink.maxX ? placed.ink : null,
        animTotal: o.animate ? out.animTotal : 0, // seconds, when animate is on
        // the text boxes, where they ended up: { id, page, x, y, w, h } (px)
        boxes: boxes.map(({ id, page, x, y, w, h }) => ({ id, page, x, y, w, h })),
        // for editing on the page: lines { page, y (baseline), x (start), si, se (its paragraph) },
        // chars { s, e (source range), page, line, x0, x1, y (baseline), sc (scale), math };
        // caret heights from asc (ascender) and desc; skews: each page's scan tilt in degrees.
        // boxes: a map like it for each text box, by its id
        caretMap: { ...placed.cmap, size: o.size, ...caretTraits, boxes: boxMaps },
    };
}

// The pages as SVG: { svg (all pages in one), pages (one SVG each) }, or, with
// o.layers on paper (for an editor), { layers: [{ paper, strips }] } instead.
function render(writer, pages, { pg, width, height }) {
    const { o, rng } = writer;
    const pc = clamp(o.penConsistency == null ? 0.6 : +o.penConsistency, 0, 1);
    const inkBase = o.pen === 'pencil' ? 0.06 : 0.02 + 0.12 * (1 - pc);
    rng.reseed('paper');
    const idBase = Math.floor(rng() * 1e9).toString(36);
    const grainBase = Math.floor(rng() * 1000);
    const animOut = { total: 0 };

    const pageOpts = (P, i) => ({
        ...o,
        width,
        height,
        inkEnds: P.inkEnds,
        inkBase,
        idSuffix: idBase + 'x' + i,
        grainSeed: grainBase + i * 17,
        page: pg && isBackPage(o, i) ? { ...pg, marginLine: pg.W - pg.marginLine } : pg,
        highlights: P.hls,
        animOut,
    });

    const layered = !!o.layers && !!pg && !o.animate;
    const layers = layered ? pages.map((P, i) => renderLayers(P, pageOpts(P, i))) : null;
    const svgs = layered ? null : pages.map((P, i) => renderSVG(P.placed, pageOpts(P, i)));
    const svg = layered ? null : svgs.length === 1 ? svgs[0] : stackPages(svgs, width, height);

    return { svg, pages: svgs, layers, animTotal: animOut.total, grainBase };
}
