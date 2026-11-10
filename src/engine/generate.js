// Text -> handwriting: the text is parsed, written word by word, broken into lines,
// laid out on pages and rendered as SVG.
import { breakLines } from './layout/lines.js';
import { layOutPages, pageGeometry, isBackPage } from './layout/pages.js';
import { placeLines } from './layout/place.js';
import { wordCacheFor } from './layout/word-cache.js';
import { createWriter } from './layout/writer.js';
import { DEFAULTS, PAGE_PPI } from './options.js';
import { scanSkew } from './render/paper.js';
import { renderLayers, renderSVG, stackPages } from './render/svg.js';
import { numberLists } from './text/lists.js';
import { parseRich } from './text/rich.js';
import { clamp } from './util.js';

// The options in full (see DEFAULTS), with the slant as a change to the learned one.
function resolveOptions(model, userOpts) {
  const o = Object.assign({}, DEFAULTS, userOpts || {});
  o.shearDelta = o.slant != null && o.slant !== '' ? Math.tan((+o.slant * Math.PI) / 180) - model.style.shear : 0;
  return o;
}

export function generate(model, text, userOpts) {
  const o = resolveOptions(model, userOpts);
  const writer = createWriter(model, o);
  const cache = wordCacheFor(model, o);
  const pg = pageGeometry(o);
  const maxW = Math.max(1, (pg ? pg.W - pg.left - pg.right : o.maxWidth) / o.size);

  const paras = numberLists(parseRich(text, !!o.plain, o.rawAt == null ? -1 : o.rawAt));
  const lines = breakLines(writer, paras, String(text), maxW, cache);
  const nPages = layOutPages(writer, lines, pg);
  const placed = placeLines(writer, lines, { pg, maxW, nPages });

  const lastLine = lines[lines.length - 1];
  const width = pg ? pg.W : Math.ceil(Math.max(placed.usedW * o.size + o.margin, 2 * o.margin));
  const height = pg ? pg.H : Math.ceil((lastLine.baseline + Math.max(0.6, lastLine.bot + 0.15)) * o.size + o.margin);
  const out = render(writer, placed.pages, { pg, width, height });
  const { found } = writer;
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
    // for editing on the page: lines { page, y (baseline), x (start), si, se (its paragraph) },
    // chars { s, e (source range), page, line, x0, x1, y (baseline), sc (scale), math };
    // caret heights from asc (ascender) and desc; skews: each page's scan tilt in degrees
    caretMap: {
      ...placed.cmap,
      size: o.size,
      asc: model.style.zones.A,
      desc: 0.3,
      skews: placed.pages.map((_, i) => (o.scan && o.paper !== 'none' ? scanSkew(out.grainBase + i * 17) : 0)),
    },
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
