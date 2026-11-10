// Paper sizes and the vertical layout: which page each line is on, and where its
// baseline is.
import { PAGE_PPI, PAGE_SIZES } from '../options.js';

// plain / lined paper is a real sheet (Letter or A4), in px; null without paper
export function pageGeometry(o) {
  if (o.paper !== 'plain' && o.paper !== 'lined') return null;

  const [wIn, hIn] = PAGE_SIZES[o.pageSize] || PAGE_SIZES.letter;
  const I = PAGE_PPI;
  const W = Math.round(wIn * I);
  const H = Math.round(hIn * I);
  if (o.paper === 'lined')
    return { W, H, left: 1.42 * I, right: 0.55 * I, top: 1.2 * I, bottom: 0.5 * I, marginLine: 1.25 * I, wIn, hIn };

  return { W, H, left: 1 * I, right: 1 * I, top: 1 * I, bottom: 1 * I, wIn, hIn };
}

// Double-sided lined paper: the back of a sheet (pages 2, 4, …) has its margin line
// on the right, so the writing starts near the left edge and runs up to the line.
// The margins only swap sides, so lines are just as long and wrap the same way.
export const isBackPage = (o, page) => !!(o.paper === 'lined' && o.doubleSided && page % 2 === 1);

// Sets each line's baseline, bot and page (units). Ordinary lines sit exactly
// `lineHeight` apart (one line's descenders and the next one's ascenders share the
// space between, as in real handwriting); only content taller than letters
// (fractions, big operators, stacked limits) pushes lines apart. On paper, lines
// flow onto pages. -> the number of pages
export function layOutPages(writer, lines, pg) {
  const { o, style } = writer;
  const lined = o.paper === 'lined';
  const margin = o.margin / o.size;
  const A = style.zones.A;
  const D = Math.max(style.zones.D, 0.4);
  const rule = o.lineHeight;

  const firstBase = (extraTop) => {
    if (!pg) return margin + A + 0.1 + extraTop;
    if (lined) return pg.top / o.size + rule * Math.max(1, Math.ceil((rule * 0.75 + extraTop) / rule - 1e-6));

    return pg.top / o.size + A + extraTop;
  };

  const pageBottom = pg ? (pg.H - pg.bottom) / o.size : Infinity;
  let baseline = 0;
  let prevExtraBot = 0;
  let page = 0;

  lines.forEach((L, li) => {
    const top = Math.min(0, ...L.words.map((w) => w.top * w.ws));
    const bot = Math.max(0, ...L.words.map((w) => w.bot * w.ws));
    // only genuinely tall content counts (a long g-tail or tall f is normal variation).
    // When it does, make room for all of it: the space between lines is shared by
    // one line's descenders and the next one's ascenders, so a tall line can only
    // use the part of that space the normal letters next to it don't.
    const extraTop = -top > A * 1.3 ? Math.max(0, -top - (rule - D)) + 0.12 : 0;
    const extraBot = bot > D * 1.5 ? Math.max(0, bot - (rule - A)) + 0.12 : 0;

    if (li === 0) baseline = firstBase(extraTop);
    else if (L.newPage && pg) {
      page++;
      baseline = firstBase(extraTop);
    } else {
      const extra = extraTop + prevExtraBot;
      // on ruled paper skip whole lines, and only when the extra room is substantial
      const advance = lined ? rule * (1 + (extra > 0.3 * rule ? Math.ceil(extra / rule - 1e-6) : 0)) : rule + extra;
      baseline += advance;

      if (baseline + Math.min(bot, D) > pageBottom) {
        page++;
        baseline = firstBase(extraTop);
      }
    }

    L.baseline = baseline;
    L.bot = Math.max(bot, D);
    L.page = page;
    prevExtraBot = extraBot;
  });

  return page + 1;
}
