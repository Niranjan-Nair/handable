// Laid-out lines put on their pages: every glyph at its final position (in px),
// the ink's landing and lift-off spots, highlighter swipes, and a map of where
// each source character went (for an editor's caret).
import { polyLength } from '../geometry.js';
import { highlightPath } from '../render/highlight.js';
import { HIGHLIGHTS } from '../text/rich.js';
import { clamp } from '../util.js';
import { markGlyph, ruleStroke } from './boxes.js';
import { tabUnits } from './lines.js';
import { isBackPage } from './pages.js';

// Where the marks go. Each placed glyph: { char, strokes (px), opacity, key (for the
// renderer's own randomness), glyph, ox, oy, ps (its origin and scale, px), line }.
function createPlacer(writer, nPages) {
  const { o, rng, r } = writer;
  const pc = clamp(o.penConsistency == null ? 0.6 : +o.penConsistency, 0, 1);
  const penPx = o.penWidth * o.size;
  const pencil = o.pen === 'pencil';
  const endA = 0.05 + 0.4 * (1 - pc);

  const placer = {
    pages: Array.from({ length: nPages }, () => ({ placed: [], inkEnds: [], hls: [], hlLines: [] })),
    ink: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }, // drawn extent, px
    usedW: 0, // units
    page: null,
    line: -1,
    // what's being placed, so the renderer can key its own randomness
    key: '',
    n: 0,
    begin(key) {
      placer.key = key;
      placer.n = 0;
    },
    place(g, gx, gy, sc) {
      const { ink } = placer;

      const strokes = g.strokes.map((s) =>
        s.map((p) => ({ x: (gx + p.x * sc) * o.size, y: (gy + p.y * sc) * o.size, w: p.w })),
      );

      // pencil: pressure (and so darkness) varies more from letter to letter
      const opacity = pencil
        ? clamp(0.9 + rng.normal() * 0.055 * (1.2 - pc), 0.74, 1)
        : clamp(0.97 + rng.normal() * 0.05 * (1 - pc) * Math.min(r, 1), 0.8, 1);

      placer.page.placed.push({
        char: g.char,
        strokes,
        opacity,
        key: placer.key + '|' + placer.n++,
        glyph: g,
        ox: gx * o.size,
        oy: gy * o.size,
        ps: sc * o.size,
        line: placer.line,
      });

      for (const st of strokes) {
        for (const q of st) {
          if (q.x < ink.minX) ink.minX = q.x;
          if (q.x > ink.maxX) ink.maxX = q.x;
          if (q.y < ink.minY) ink.minY = q.y;
          if (q.y > ink.maxY) ink.maxY = q.y;
        }
      }

      // ink pools a little where the pen lands and thins where it lifts off
      // (a pencil doesn't pool)
      for (const s of strokes) {
        if (polyLength(s) < penPx * 1.5) continue;

        const e = s[s.length - 1];
        if (pencil) continue;

        placer.page.inkEnds.push({
          x: s[0].x,
          y: s[0].y,
          r: penPx * rng.range(1.6, 2.6),
          a: endA * rng.range(0.5, 1),
          down: true,
          line: placer.line,
        });

        placer.page.inkEnds.push({
          x: e.x,
          y: e.y,
          r: penPx * rng.range(2, 3.5),
          a: endA * rng.range(0.5, 1.2),
          down: false,
          line: placer.line,
        });
      }

      placer.usedW = Math.max(placer.usedW, gx + (g.width || 0) * sc);
    },
  };

  return placer;
}

// -> { pages: [{ placed, inkEnds, hls, hlLines }], ink, usedW, cmap: { lines, chars } }
export function placeLines(writer, lines, { pg, maxW, nPages }) {
  const placer = createPlacer(writer, nPages);
  const cmap = { lines: [], chars: [] };

  lines.forEach((L, li) => {
    placer.line = li;
    placer.page = placer.pages[L.page];
    placeLine(writer, placer, cmap, L, li, { pg, maxW });
  });

  return { pages: placer.pages, ink: placer.ink, usedW: placer.usedW, cmap };
}

function placeLine(writer, placer, cmap, L, li, { pg, maxW }) {
  const { o, rng, r } = writer;
  const last = L.words[L.words.length - 1];
  const lineW = last ? last.x + last.w * last.ws : 0;
  const left = pg ? (isBackPage(o, L.page) ? pg.right : pg.left) / o.size : o.margin / o.size;
  const lineKey = L.words.length ? L.words[0].key : 'empty' + L.psi;
  rng.reseed('L' + lineKey);
  // every line starts a little differently, slopes a little and drifts as it goes
  const x0 = left + (L.indent || 0) + (L.display ? Math.max(0, (maxW - lineW) / 2) : Math.abs(rng.normal()) * 0.05 * r);
  const slope = L.display ? 0 : rng.normal() * 0.008 * r;
  let drift = rng.normal() * 0.02 * r;
  const lineIndex = cmap.lines.push({ page: L.page, y: L.baseline * o.size, x: x0 * o.size, si: L.psi, se: L.pse }) - 1;

  // a caret place for source range s..e, from a to b (units from the line's start)
  const caretSpot = (s, e, a, b, y = L.baseline, sc = 1, math = false) =>
    cmap.chars.push({ s, e, page: L.page, line: lineIndex, math, x0: a * o.size, x1: b * o.size, y: y * o.size, sc });

  if (L.bullet) placeMarker(writer, placer, L, x0, slope, caretSpot);

  // the indent's spaces and tabs, as places for the caret (in the order they were typed)
  if (L.lead) {
    let lx = x0 - L.indent;

    for (const l of L.lead) {
      const w = (l.tab ? 4 : 1) * writer.spaceW;
      caretSpot(l.si, l.si + 1, lx, lx + w);
      lx += w;
    }
  }

  for (const w of L.words) {
    // the gap before a word, shared out between its spaces and tabs (a tab 4 shares)
    if (w.wsp) {
      const n = tabUnits(w.wsp);
      let a = w.x - w.gap;

      for (const c of w.wsp) {
        const b = a + (w.gap * (c.tab ? 4 : 1)) / n;
        caretSpot(c.si, c.si + 1, x0 + a, x0 + b, L.baseline + slope * a);
        a = b;
      }
    }

    for (const c of w.cmap) {
      const a = w.x + c.a * w.ws;
      const b = w.x + c.b * w.ws;
      caretSpot(c.s, c.e, x0 + a, x0 + b, L.baseline + slope * a + c.dy * w.ws, c.sc * w.ws, !!c.math);
    }
  }

  if (L.trail) {
    let a = lineW + (L.words.length ? 0.04 : 0);

    for (const c of L.trail) {
      const b = a + (c.tab ? 4 : 1) * writer.spaceW;
      caretSpot(c.si, c.si + 1, x0 + a, x0 + b, L.baseline + slope * a);
      a = b;
    }
  }

  const spans = [];

  for (const w of L.words) {
    rng.reseed('p' + w.key);
    placer.begin(w.key);

    for (const it of w.items) {
      drift = drift * 0.8 + rng.normal() * 0.012 * r;
      const lx = w.x + it.x * w.ws;
      placer.place(it.g, x0 + lx, L.baseline + drift + slope * lx + it.y * w.ws, it.s * w.ws);
    }

    collectDecorations(writer, spans, w);
  }

  for (const sp of spans) drawDecoration(writer, placer, sp, L, li, lineKey, x0, slope);
}

// a list item's marker, in the space the item hangs from, and the space after it
function placeMarker(writer, placer, L, x0, slope, caretSpot) {
  const B = L.bullet;
  const bx = x0 - L.hang + 0.04;
  writer.rng.reseed('p' + B.key);
  placer.begin(B.key);
  for (const it of B.items) placer.place(it.g, bx + it.x, L.baseline + slope * (bx - x0) + it.y, it.s);
  for (const c of B.cmap) caretSpot(c.s, c.e, bx + c.a, bx + c.b);
  // the space after it, up to where the text starts
  const ws = B.src.ws;
  const a0 = bx + B.w;

  ws.forEach((si, j) =>
    caretSpot(si, si + 1, a0 + ((x0 - a0) * j) / ws.length, a0 + ((x0 - a0) * (j + 1)) / ws.length),
  );
}

// Decorations: one mark across consecutive words that share it (the same box, the
// same highlighter color, a run of underlined or struck-through words).
function collectDecorations(writer, spans, w) {
  const { style, o } = writer;

  for (const d of w.deco) {
    const A = w.x + d.a * w.ws;
    const B = w.x + d.b * w.ws;
    const prev = spans.filter((p) => p.k === d.k && p.id === d.id).pop();
    const near = prev && A - prev.B < style.wordGap.mean * o.wordSpacing * 1.8 + 0.05;
    if (prev && (near || (d.k === 'box' && prev === spans[spans.length - 1]))) {
      prev.B = B;
      prev.top = Math.min(prev.top, d.top * w.ws);
      prev.bot = Math.max(prev.bot, d.bot * w.ws);
      prev.s = Math.max(prev.s, d.s * w.ws);
    } else
      spans.push({ k: d.k, id: d.id, A, B, top: d.top * w.ws, bot: d.bot * w.ws, mid: d.mid * w.ws, s: d.s * w.ws });
  }
}

function drawDecoration(writer, placer, sp, L, li, lineKey, x0, slope) {
  const { rng, r, X, o } = writer;
  const key = 'd' + lineKey + '|' + sp.k + '|' + Math.round(sp.A * 100);
  rng.reseed(key);
  placer.begin(key);
  const base = L.baseline + slope * sp.A;

  if (sp.k === 'u')
    placer.place(ruleStroke(writer, sp.B - sp.A + 0.06), x0 + sp.A - 0.03, base + 0.15 + rng.normal() * 0.01 * r, 1);
  else if (sp.k === 'st')
    placer.place(markGlyph(writer, 'strike', sp.A, sp.B, sp.top, sp.bot, sp.mid, sp.s), x0, base, 1);
  else if (sp.k === 'box')
    placer.place(
      markGlyph(writer, 'box', sp.A, sp.B, Math.min(sp.top, -X * sp.s), Math.max(sp.bot, 0.05 * sp.s), sp.mid, sp.s),
      x0,
      base,
      1,
    );
  else if (sp.k === 'hl') {
    // a highlighter swipe behind the words, x-height and a little above and below
    const y0 = (base - (X * 1.35 + 0.08) * sp.s) * o.size;
    const y1 = (base + 0.14 * sp.s) * o.size;
    placer.page.hlLines.push(li);

    placer.page.hls.push(
      highlightPath(
        (x0 + sp.A - 0.06 * sp.s) * o.size,
        (x0 + sp.B + 0.06 * sp.s) * o.size,
        y0,
        y1,
        HIGHLIGHTS[sp.id],
        rng,
      ),
    );

    placer.usedW = Math.max(placer.usedW, x0 + sp.B + 0.1 * sp.s);
  }
}
