// Placed glyphs rendered as SVG: whole pages, a page as layers, or one glyph.
import { bbox, centroid, polyLength } from '../geometry.js';
import { animatedInk } from './animate.js';
import { paperSVG, scanClose, scanInkOpen, scanOpen } from './paper.js';
import { centerPath, dotPath, escapeAttr, fmt, glyphInk, inkPath } from './paths.js';
import { pencilSVG } from './pencil.js';
import { clamp } from '../util.js';

// all pages in one SVG, one above the other (for "Download SVG")
export function stackPages(pages, w, h) {
  const gap = Math.round(h * 0.03);
  const total = pages.length * h + (pages.length - 1) * gap;
  const inner = pages.map((p, i) =>
    p.replace(/^<svg[^>]*>/, `<svg x="0" y="${i * (h + gap)}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${total}" viewBox="0 0 ${w} ${total}">\n${inner.join('\n')}\n</svg>`;
}

// The writing itself (and the ink's density mask), drawn within region R of the page
function inkSVG(placed, o, R) {
  const penPx = o.penWidth * o.size;
  const color = escapeAttr(o.color);
  const parts = [];
  let maskAttr = '';
  if (o.inkEnds && o.inkEnds.length) {
    // opacity mask: slightly translucent body, denser where strokes start,
    // fading where they end (soft radial spots, so there are no seams)
    const id = 'hw' + (o.idSuffix || '0');
    const g = Math.round(255 * (1 - o.inkBase));
    parts.push(
      `<defs><radialGradient id="${id}d"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
        `<radialGradient id="${id}u"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>` +
        `<mask id="${id}m" maskUnits="userSpaceOnUse" x="${R.x}" y="${R.y}" width="${R.w}" height="${R.h}">` +
        `<rect x="${R.x}" y="${R.y}" width="${R.w}" height="${R.h}" fill="rgb(${g},${g},${g})"/>` +
        o.inkEnds
          .map(
            (e) =>
              `<circle cx="${fmt(e.x)}" cy="${fmt(e.y)}" r="${fmt(e.r)}" fill="url(#${id}${e.down ? 'd' : 'u'})" opacity="${fmt(clamp(e.a, 0, 1))}"/>`,
          )
          .join('') +
        `</mask></defs>`,
    );
    maskAttr = ` mask="url(#${id}m)"`;
  }
  if (o.pen === 'pencil') {
    parts.push(pencilSVG(placed, { ...o, region: R }, penPx, maskAttr));
  } else if (o.animate) {
    parts.push(animatedInk(placed, o, penPx, color, maskAttr));
  } else if (o.pen === 'uniform') {
    parts.push(
      `<g fill="none" stroke="${color}" stroke-width="${fmt(penPx)}" stroke-linecap="round" stroke-linejoin="round"${maskAttr}>`,
    );
    const dots = [];
    for (const g of placed) {
      const d = g.strokes
        .filter((st) => polyLength(st) >= penPx * 1.2)
        .map(centerPath)
        .join('');
      if (d) parts.push(`<path d="${d}" opacity="${fmt(g.opacity)}"/>`);
      for (const st of g.strokes) if (polyLength(st) < penPx * 1.2) dots.push(dotPath(centroid(st), penPx * 0.8));
    }
    if (dots.length) parts.push(`</g><g fill="${color}"${maskAttr}><path d="${dots.join('')}"/>`);
  } else {
    parts.push(`<g fill="${color}"${maskAttr}>`);
    for (const g of placed) {
      // a glyph's outline is the same wherever it's put: drawn once at its own origin
      // and moved into place (a word that only moved isn't drawn again)
      if (g.glyph) {
        parts.push(
          `<path transform="translate(${fmt(g.ox)} ${fmt(g.oy)})" d="${glyphInk(g.glyph, g.ps, penPx)}" opacity="${fmt(g.opacity)}"/>`,
        );
        continue;
      }
      const d = g.strokes.map((s) => inkPath(s, penPx)).join('');
      parts.push(`<path d="${d}" opacity="${fmt(g.opacity)}"/>`);
    }
  }
  parts.push('</g>');
  return parts.join('\n');
}

// A page as layers, for an editor to stack: { paper, strips: [{ y, h, svg }] }. The
// paper (and on a scanned page, its scan) doesn't change as you type, and each line of
// writing is its own strip, with its effects worked out over just that strip, so a
// change redraws one line, not the page. Stacked (strips multiplied onto the paper),
// they look like renderSVG's page; downloads use renderSVG.
export function renderLayers(P, o) {
  const W = o.width;
  const H = o.height;
  const scanned = o.scan && o.paper !== 'none';
  const svgOpen = (y, h) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 ${y} ${W} ${h}">`;
  const paper = svgOpen(0, H) + (scanned ? scanOpen(o) : '') + paperSVG(o) + (scanned ? scanClose(o) : '') + '</svg>';
  const byLine = new Map();
  const bucket = (li) => {
    let b = byLine.get(li);
    if (!b) byLine.set(li, (b = { placed: [], ends: [], hls: [] }));
    return b;
  };
  for (const g of P.placed) bucket(g.line).placed.push(g);
  for (const e of P.inkEnds || []) bucket(e.line).ends.push(e);
  P.hls.forEach((h, j) => bucket(P.hlLines[j]).hls.push(h));
  const penPx = o.penWidth * o.size;
  // room around the writing for the pen's width, the grain's raggedness and the scan's bend
  const pad = Math.ceil(24 + penPx * 3 + (scanned ? W * 0.006 : 0));
  const strips = [];
  for (const [li, b] of byLine) {
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const g of b.placed)
      for (const st of g.strokes)
        for (const q of st) {
          if (q.y < y0) y0 = q.y;
          if (q.y > y1) y1 = q.y;
        }
    if (y0 > y1) continue;
    const y = Math.max(0, Math.floor(y0 - pad));
    const h = Math.min(H, Math.ceil(y1 + pad)) - y;
    const R = { x: 0, y, w: W, h };
    const so = { ...o, inkEnds: b.ends, idSuffix: o.idSuffix + 'y' + y };
    strips.push({
      line: li,
      y,
      h,
      svg:
        svgOpen(y, h) +
        (scanned ? scanInkOpen(so, R) : '') +
        (b.hls.length ? `<g style="mix-blend-mode:multiply">${b.hls.join('')}</g>` : '') +
        inkSVG(b.placed, so, R) +
        (scanned ? '</g></g>' : '') +
        '</svg>',
    });
  }
  return { paper, strips };
}

export function renderSVG(placed, o) {
  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${o.width}" height="${o.height}" viewBox="0 0 ${o.width} ${o.height}">`,
  );
  const scanned = o.scan && o.paper !== 'none';
  if (scanned) parts.push(scanOpen(o));
  if (o.paper !== 'none') parts.push(paperSVG(o));
  // highlighter goes on first, under the writing, and darkens the paper like real ink would
  if (o.highlights && o.highlights.length)
    parts.push(`<g style="mix-blend-mode:multiply">${o.highlights.join('')}</g>`);
  parts.push(inkSVG(placed, o, { x: 0, y: 0, w: o.width, h: o.height }));
  if (scanned) parts.push(scanClose(o));
  parts.push('</svg>');
  return parts.join('\n');
}

// Render a prepared/synthesized glyph (unit coords) into a small standalone SVG.
export function glyphSVG(glyph, opts = {}) {
  const box = opts.box || 64;
  const color = escapeAttr(opts.color || '#1b2a57');
  const size = box / 1.9; // fits ascender (-1) .. descender (+0.6) with padding
  const width = glyph.width != null ? glyph.width : bbox(glyph.strokes).maxX;
  const W = Math.ceil(Math.max(box, width * size + 0.3 * size)); // multi-letter ligatures get wider boxes
  const ox = (W - width * size) / 2;
  const oy = 1.15 * size;
  const strokes = glyph.strokes.map((s) => s.map((p) => ({ x: ox + p.x * size, y: oy + p.y * size, w: p.w })));
  const penPx = (opts.penWidth || 0.06) * size;
  const d = strokes.map((s) => inkPath(s, penPx)).join('');
  const guide = opts.guides
    ? `<line x1="0" y1="${fmt(oy)}" x2="${W}" y2="${fmt(oy)}" stroke="#d9cfb8" stroke-width="1"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${box}" viewBox="0 0 ${W} ${box}">${guide}<path d="${d}" fill="${color}"/></svg>`;
}
